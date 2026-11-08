import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "../dist/wontopos.js";

function scriptedServer(script) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : undefined });
      const [status, payload, headers] = script[seen.length - 1] ?? [200, "{}"];
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(payload);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function withServer(script, fn) {
  const { server, seen, base } = await scriptedServer(script);
  try {
    await fn(seen, base);
  } finally {
    server.close();
  }
}

const KEY = "wos-test-xxxxxxxxxx";
const NOTHING_OPEN = "Nothing is open: memory tools answer within a turn that began with begin().";
const OPEN_TEA = JSON.stringify({ work_id: "w-1", memories: [{ n: 1, id: "m-1", content: "Tea at nine." }] });
const OPEN_COFFEE = JSON.stringify({ work_id: "w-2", memories: [{ n: 1, id: "m-9", content: "Coffee at ten." }] });
const LATE = { work_id: "w-1", memories: [{ n: 2, id: "m-2", content: "Green tea." }], deeper_left: 2 };
const scroll2 = (base) => new Client({ apiKey: KEY, model: "scroll-2", baseUrl: base, maxRetries: 0 });

test("a reply for a turn that has ended is kept out of the turn open now", async () => {
  await withServer([[200, OPEN_TEA], [200, OPEN_COFFEE]], async (seen, base) => {
    const mem = scroll2(base);
    const tools = mem.memoryTools("u", { preset: "S-2", dates: true });
    await tools.begin("tea");
    mem.workDeeper = async () => {
      await tools.begin("coffee");
      return LATE;
    };
    assert.equal(await tools.run({ name: "memory_deeper", input: {} }), "[02] Green tea.\n(deeper left 2)");
    assert.equal(tools.workId, "w-2");
    assert.equal(
      await tools.run({ name: "memory_timeline", input: {} }),
      "In the order they happened, oldest first:\n(no date)\n[01] Coffee at ten.",
    );
    await assert.rejects(tools.answered(2), { message: "[02] is not a number this turn gave." });
    assert.equal(seen.length, 2);
  });
});

test("a blank question is refused before anything is sent", async () => {
  await withServer([], async (seen, base) => {
    const tools = scroll2(base).memoryTools("u", { speakers: true, sleep: true });
    for (const blank of ["", " \t", undefined]) {
      await assert.rejects(tools.begin(blank), { message: "question is required." }, String(blank));
    }
    assert.equal(seen.length, 0);
  });
});

test("a memory with an empty id is neither a photo nor an answer", async () => {
  const opened = JSON.stringify({ work_id: "w-1", memories: [
    { n: 1, id: "", content: "The beach.", image_ref: "img-1" },
    { n: 2, id: "m-2", content: "The dunes.", image_ref: "img-2" },
  ] });
  await withServer([[200, opened]], async (seen, base) => {
    const tools = scroll2(base).memoryTools("u", { preset: "S-2", images: true });
    assert.equal(await tools.begin("beach"), "[01] The beach.\n[02] (photo) The dunes.");
    assert.equal(await tools.run({ name: "memory_photo", input: { n: 1 } }), "Refused: [01] is not a number this turn gave.");
    await assert.rejects(tools.answered(1), { message: "[01] is not a number this turn gave." });
    assert.equal(seen.length, 1);
  });
});

test("answered with null closes the turn with no answer, as Python's None does", async () => {
  await withServer([[200, OPEN_TEA], [200, JSON.stringify({ work_id: "w-1", closed: true })]], async (seen, base) => {
    const tools = scroll2(base).memoryTools("u", { preset: "S-2" });
    await tools.begin("tea");
    assert.deepEqual(await tools.answered(null), { work_id: "w-1", closed: true });
    assert.equal(tools.workId, undefined);
    assert.deepEqual(seen[1].body, { user_id: "u", work_id: "w-1" });
  });
});

test("workId is undefined when the open reply names no work", async () => {
  const replies = ['{"work_id": 5, "memories": []}', '{"work_id": "", "memories": []}', '{"memories": []}', OPEN_TEA];
  await withServer(replies.map((r) => [200, r]), async (seen, base) => {
    const tools = scroll2(base).memoryTools("u", { preset: "S-2" });
    for (const want of [undefined, undefined, undefined, "w-1"]) {
      await tools.begin("tea");
      assert.equal(tools.workId, want);
    }
  });
});

test("a name that reads as a label once its invisible characters are gone is quoted", async () => {
  const names = ["you\u{200b}", "\u{200d}user", "no\u{ad}te", "U\u{2060}SER", "Yo\u{34f}u", "you\u{fe0f}", "\u{200b} you", "y\u{e0020}ou", "Da\u{200b}na"];
  const opened = JSON.stringify({ work_id: "w-1", memories: names.map((s, i) => ({ n: i + 1, id: `m-${i + 1}`, content: "Paid.", speaker: s })) });
  const history = JSON.stringify({ turns: names.map((s) => ({ role: "user", speaker: s, content: "Paid." })) });
  await withServer([[200, opened], [200, history]], async (seen, base) => {
    const tools = scroll2(base).memoryTools("u", { preset: "S-2", speakers: true, seen: true, assistant: "Kai" });
    const shown = [...names.slice(0, -1).map((s) => `"${s}"`), names[names.length - 1]];
    assert.equal(await tools.begin("paid"), shown.map((s, i) => `[${String(i + 1).padStart(2, "0")}] ${s}: Paid.`).join("\n"));
    assert.equal(
      await tools.run({ name: "memory_recent", input: {} }),
      `The recent conversation, newest first:\n${[...shown].reverse().map((s, i) => `#${i + 1} ${s}: Paid.`).join("\n")}`,
    );
  });
});

test("each schema in the definitions is its own object", () => {
  for (const format of ["anthropic", "openai"]) {
    const defs = scroll2("http://127.0.0.1:9").memoryTools("u").definitions(format);
    const schema = format === "anthropic" ? defs[1].input_schema : defs[1].function.parameters;
    schema.properties.from.description = "Where to start.";
    assert.deepEqual(Object.keys(schema.properties).filter((k) => "description" in schema.properties[k]), ["from"]);
  }
});

test("a turn that failed to begin leaves nothing open", async () => {
  const closed = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "that store is closed", request_id: "req_1" } });
  await withServer([[200, OPEN_TEA], [400, closed]], async (seen, base) => {
    const tools = scroll2(base).memoryTools("u", { preset: "S-2", dates: true });
    await tools.begin("tea");
    await assert.rejects(tools.begin("coffee"), /that store is closed/);
    assert.equal(tools.workId, undefined);
    assert.equal(await tools.run({ name: "memory_timeline", input: {} }), NOTHING_OPEN);
    assert.equal(await tools.answered(1), undefined);
    assert.equal(seen.length, 2);
  });
});
