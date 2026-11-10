import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "../dist/wontopos.js";

const KEY = "wos-test-xxxxxxxxxx";

function recorder(answer = "{}") {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    return new Response(answer, { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { seen, mem: new Client({ apiKey: KEY, baseUrl: "https://api.wontopos.com", fetch }) };
}

const said = (want) => (e) => {
  assert.equal(e.message, want);
  return true;
};

async function quiet(fn) {
  const warned = [];
  const was = console.warn;
  console.warn = (...a) => warned.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.warn = was;
  }
  return warned;
}

const AT = "2024-03-01T10:00:00Z";

test("add takes createdAt and sends it as metadata.created_at, with no warning", async () => {
  const { seen, mem } = recorder();
  const warned = await quiet(async () => {
    await mem.add("we met in Busan", "u", {}, { createdAt: AT });
    await mem.add("we met in Busan", "u", { created_at: AT });
    await mem.add("we met in Busan", "u", { speaker: "Mina" }, { createdAt: new Date(AT) });
  });
  assert.deepEqual(warned, []);
  assert.deepEqual(seen.map((s) => s.body.metadata), [
    { created_at: AT }, { created_at: AT }, { speaker: "Mina", created_at: "2024-03-01T10:00:00.000Z" },
  ]);
});

test("add refuses a createdAt that is not an instant", async () => {
  const { seen, mem } = recorder();
  for (const bad of ["2024-03-01", "2024-03-01T10:00:00", "yesterday", "", 5, new Date(NaN)]) {
    await assert.rejects(mem.add("x", "u", {}, { createdAt: bad }), /createdAt/, String(bad));
  }
  await assert.rejects(mem.add("x", "u", { created_at: "2024-03-01" }), /created_at/);
  assert.equal(seen.length, 0);
});

test("add refuses the two sides of a turn", async () => {
  const { seen, mem } = recorder();
  for (const name of ["userSpeaker", "assistantSpeaker"]) {
    await assert.rejects(
      mem.add("x", "u", {}, { [name]: "Mina" }),
      said(`${name} is for addTurn: it names a side of a turn. On add, name who said it in metadata.speaker.`),
    );
  }
  for (const name of ["user_speaker", "assistant_speaker"]) {
    await assert.rejects(
      mem.add("x", "u", { [name]: "Mina" }),
      said(`${name} is for addTurn: it names a side of a turn. On add, name who said it in metadata.speaker.`),
    );
  }
  assert.equal(seen.length, 0);
});

const FAR_OPEN = JSON.stringify({ work_id: "w-1", memories: [
  { n: 1, id: "m-1", content: "The far day.", created_at: "9999-12-31T23:59:59Z" },
  { n: 2, id: "m-2", content: "one\u000btwo\u000cthree\u001cfour\u001dfive\u001esix", created_at: "2024-03-01T10:00:00Z" },
  { n: 3, id: "m-3", content: "Year five.", created_at: "0005-06-01T10:00:00Z" },
] });
const KEPT = "[02] one\n    two\n    three\n    four\n    five\n    six";

test("memory tools: a date past year 9999 is shown whole, and a rare control character does not start a line", async () => {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(FAR_OPEN);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const mem = new Client({ apiKey: KEY, model: "scroll-2", baseUrl: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
    const tools = mem.memoryTools("u", { preset: "S-2", dates: true, tz: 9 });
    assert.equal(await tools.begin("q"), `[01] The far day.\n${KEPT}\n[03] Year five.`);
    assert.equal(
      await tools.run({ name: "memory_timeline", input: {} }),
      `In the order they happened, oldest first:\n0005-06-01\n19:00 [03] Year five.\n2024-03-01\n19:00 ${KEPT}\n+010000-01-01\n08:59 [01] The far day.`,
    );
  } finally {
    server.close();
  }
});

test("a step of the wall clock does not end a call: the deadline is measured on a steady clock", async () => {
  const realNow = Date.now;
  let calls = 0;
  const fetch = async () => {
    calls++;
    if (calls === 1) {
      Date.now = () => realNow() + 3_600_000;
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "busy" } }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Retry-After": "0" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: "https://api.wontopos.com", deadlineMs: 30_000, fetch });
    await mem.search("q", "u");
    assert.equal(calls, 2);
  } finally {
    Date.now = realNow;
  }
});

test("an ask's time is measured on the steady clock too", async () => {
  const { AskClock } = await import("../dist/router.js");
  const realNow = Date.now;
  const run = new AskClock(30_000, []);
  try {
    Date.now = () => realNow() + 3_600_000;
    assert.ok(run.left() > 29_000, String(run.left()));
    assert.equal(run.why(), undefined);
  } finally {
    Date.now = realNow;
    run.close();
  }
});

test("a baseUrl with user:password@ sends them as Basic auth and keeps them out of the URL, as the other clients do", async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, headers: init.headers });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  for (const [base, want] of [
    ["https://u:hunter2@gw.example.com", "https://gw.example.com/api/v1/memory/stats"],
    ["https://u:hunter2@gw.example.com/wos/", "https://gw.example.com/wos/api/v1/memory/stats"],
    ["http://na%40me:p%3Ass@127.0.0.1:9", "http://127.0.0.1:9/api/v1/memory/stats"],
  ]) {
    const mem = new Client({ apiKey: KEY, baseUrl: base, fetch });
    await mem.stats("u");
    const s = seen.at(-1);
    assert.equal(s.url, want);
    const [name, pass] = base.includes("na%40me") ? ["na@me", "p:ss"] : ["u", "hunter2"];
    assert.equal(s.headers.Authorization, `Basic ${Buffer.from(`${name}:${pass}`).toString("base64")}`);
    assert.equal(s.headers["X-API-Key"], KEY);
    assert.equal(String(mem).includes("hunter2"), false);
  }
  const plain = new Client({ apiKey: KEY, baseUrl: "https://gw.example.com", fetch });
  await plain.stats("u");
  assert.equal("Authorization" in seen.at(-1).headers, false);
});

test("a skill's input schema cannot break a line of the router's prompt: the three breaks JSON leaves raw are escapes", async () => {
  const { skillList } = await import("../dist/router.js");
  const skill = {
    name: "lookup", description: "Looks things up.", kind: "code",
    input: { type: "object", description: "a\u2028b\u2029c\u0085d", properties: { "q\u2028": { type: "string" } } },
  };
  assert.equal(
    skillList([skill]),
    "The skills, by name:\n- lookup: Looks things up.\n  input: " +
      '{"type":"object","description":"a\\u2028b\\u2029c\\u0085d","properties":{"q\\u2028":{"type":"string"}}}',
  );
});
