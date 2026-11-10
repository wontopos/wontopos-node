import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "../dist/wontopos.js";

const KEY = "wos-test-xxxxxxxxxx";
const OPEN = JSON.stringify({ work_id: "w-1", steps_left: 5, deeper_left: 3, memories: [{ n: 1, id: "a", content: "Theo visits Friday." }] });
const DEEPER = JSON.stringify({ work_id: "w-1", memories: [{ n: 2, id: "b", content: "Milo brings the cake." }], deeper_left: 2 });
const SEARCH = JSON.stringify({ work_id: "w-1", memories: [], none: true, steps_left: 4 });
const PATHS = ["/api/v1/memory/work/open", "/api/v1/memory/work/deeper", "/api/v1/memory/work/search"];
const PLAIN = '{"user_id":"u","question":"what did we plan"}';
const OTHERS = '"own_words":false';
const DIVERSITIES = ["none", "mmr", "temporal", "full"];
const plus = (...parts) => `${PLAIN.slice(0, -1)}${parts.map((p) => `,${p}`).join("")}}`;
const refused = (name, bad) =>
  name === "diversity"
    ? `diversity must be "none", "mmr", "temporal" or "full", got ${JSON.stringify(bad)}.`
    : `${name} must be true or false, got ${JSON.stringify(bad)}.`;

async function withServer(script, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ path: req.url, model: req.headers["x-wos-model"], body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(script[seen.length - 1] ?? "{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(seen, `http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

async function turn(settings = {}) {
  return withServer([OPEN, DEEPER, SEARCH], async (seen, base) => {
    const tools = new Client({ apiKey: KEY, baseUrl: base, tz: 9, model: "scroll-2" }).memoryTools("u", { preset: "S-2", ...settings });
    await tools.begin("what did we plan");
    await tools.run({ name: "memory_deeper", input: {} });
    await tools.run({ name: "memory_search", input: { query: "the cake" } });
    assert.deepEqual(seen.map((s) => s.path), PATHS);
    return seen.map((s) => s.body);
  });
}

test("defaults: the work/open body is byte for byte what it was, with or without the settings named", async () => {
  const plain = await turn();
  assert.equal(plain[0], PLAIN);
  assert.deepEqual(await turn({ ownWords: true, diversity: undefined }), plain);
  assert.deepEqual(await turn({ diversity: null }), plain);
  await withServer([OPEN], async (seen, base) => {
    const mem = new Client({ apiKey: KEY, baseUrl: base, tz: 9, model: "scroll-2" });
    await mem.memoryTools("u", { preset: "S-2", rooms: "all", images: true }).begin("what did we plan");
    assert.equal(seen[0].body, '{"user_id":"u","question":"what did we plan","rooms":"all","tz_offset_minutes":540,"max_images":3}');
  });
});

test("own words off: own_words false is sent, with no filters, and memory_deeper and memory_search send nothing new", async () => {
  const plain = await turn();
  const off = await turn({ ownWords: false });
  assert.equal(off[0], plus(OTHERS));
  assert.equal(JSON.parse(off[0]).own_words, false);
  assert.equal("filters" in JSON.parse(off[0]), false);
  assert.deepEqual(off.slice(1), plain.slice(1));
});

test("each diversity goes through; an unknown one, a non-string and an empty string are refused before anything is sent", async () => {
  const plain = await turn();
  for (const d of DIVERSITIES) {
    const sent = await turn({ diversity: d });
    assert.equal(sent[0], plus(`"diversity":"${d}"`), d);
    assert.deepEqual(sent.slice(1), plain.slice(1), d);
  }
  await withServer([], async (seen, base) => {
    const mem = new Client({ apiKey: KEY, baseUrl: base, model: "scroll-2" });
    for (const bad of ["nope", "MMR", " mmr", "", 3, true, ["mmr"], { mode: "mmr" }]) {
      assert.throws(() => mem.memoryTools("u", { diversity: bad }), (e) => e.message === refused("diversity", bad));
      await assert.rejects(mem.openWork("q", "u", { diversity: bad }), (e) => e.message === refused("diversity", bad));
    }
    for (const bad of [0, "no", null]) {
      if (bad !== null) assert.throws(() => mem.memoryTools("u", { ownWords: bad }), (e) => e.message === refused("ownWords", bad));
      await assert.rejects(mem.openWork("q", "u", { ownWords: bad }), (e) => e.message === refused("ownWords", bad));
    }
    assert.throws(() => mem.memoryTools("u", { own_words: false }), /unknown memoryTools option "own_words" .* did you mean "ownWords"/);
    assert.equal(seen.length, 0);
  });
});

test("both together, from memoryTools and from openWork alike", async () => {
  const plain = await turn();
  const both = await turn({ ownWords: false, diversity: "temporal" });
  assert.equal(both[0], plus(OTHERS, '"diversity":"temporal"'));
  assert.deepEqual(both.slice(1), plain.slice(1));
  await withServer([OPEN, OPEN, OPEN], async (seen, base) => {
    const mem = new Client({ apiKey: KEY, baseUrl: base, model: "scroll-2" });
    await mem.openWork("what did we plan", "u", { ownWords: false, diversity: "temporal" });
    await mem.openWork("what did we plan", "u", { ownWords: true });
    await mem.openWork("what did we plan", "u");
    assert.deepEqual(seen.map((s) => s.body), [both[0], PLAIN, PLAIN]);
  });
});

test("a copy keeps them: tools on another model's client, and on a with* copy of it", async () => {
  const want = plus('"max_images":3', OTHERS, '"diversity":"mmr"');
  await withServer([OPEN, OPEN], async (seen, base) => {
    const t2 = new Client({ apiKey: KEY, baseUrl: base, tz: 9, model: "tablet-2" });
    const settings = { preset: "S-2", images: true, ownWords: false, diversity: "mmr" };
    await t2.memoryTools("u", settings).begin("what did we plan");
    await t2.withUser("x").withTz(5).memoryTools("u", settings).begin("what did we plan");
    assert.deepEqual(seen.map((s) => s.body), [want, want]);
    assert.deepEqual(seen.map((s) => s.model), ["scroll-2", "scroll-2"]);
  });
});

test("nothing the model sees changes: the note and both formats' definitions stay as they are", async () => {
  await withServer([], async (seen, base) => {
    const mem = new Client({ apiKey: KEY, baseUrl: base, model: "scroll-2" });
    for (const flags of [{}, { speakers: true, dates: true, images: true, seen: true, usage: true }]) {
      const plain = mem.memoryTools("u", flags);
      for (const settings of [{ ownWords: false }, { diversity: "full" }, { ownWords: false, diversity: "none" }]) {
        const tools = mem.memoryTools("u", { ...flags, ...settings });
        assert.equal(tools.note, plain.note);
        for (const format of ["anthropic", "openai"]) assert.deepEqual(tools.definitions(format), plain.definitions(format));
      }
    }
    assert.equal(seen.length, 0);
  });
});
