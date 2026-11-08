import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "../dist/wontopos.js";

const KEY = "wos-test-xxxxxxxxxx";
const Q = "what did we plan";
const OPEN = JSON.stringify({ work_id: "w-1", steps_left: 5, deeper_left: 3, memories: [{ n: 1, id: "a", content: "Theo visits Friday." }] });
const DEEPER = JSON.stringify({ work_id: "w-1", memories: [{ n: 2, id: "b", content: "Milo brings the cake." }], deeper_left: 2 });
const SEARCH = JSON.stringify({ work_id: "w-1", memories: [], none: true, steps_left: 4 });
const WORK = "/api/v1/memory/work/";
const HISTORY = "/api/v1/memory/history";
const RESULTS = [
  "[01] Theo visits Friday.\n(steps left 5 \u{b7} deeper left 3)",
  "[02] Milo brings the cake.\n(deeper left 2)",
  "Nothing new for that.\n(steps left 4)",
];
const PLAIN = '{"user_id":"u","question":"what did we plan"}';
const LATER = ['{"user_id":"u","work_id":"w-1"}', '{"user_id":"u","work_id":"w-1","query":"the cake"}'];
const OTHERS = ',"filters":{"source_types":["user_said","ai_thought","inferred","system"]}';
const LIVE = `${OTHERS},"diversity":"full"`;

const history = (...lines) => {
  const now = Date.now();
  const turns = lines.map(([content, minutes], i) => ({
    role: i % 2 ? "assistant" : "user",
    content,
    timestamp: new Date(now - minutes * 60_000).toISOString(),
  }));
  return JSON.stringify({ turns });
};
const asked = (question, tail = LIVE) => `{"user_id":"u","question":${JSON.stringify(question)}${tail}}`;

async function withServer(script, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ path: req.url, model: req.headers["x-wos-model"], body });
      const next = script[seen.length - 1] ?? "{}";
      const [status, out] = typeof next === "string" ? [200, next] : [next.status, next.body];
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(out);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(seen, `http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const client = (base, model = "scroll-2", more = {}) => new Client({ apiKey: KEY, baseUrl: base, tz: 9, model, ...more });

async function turn(tools) {
  return [
    await tools.begin(Q),
    await tools.run({ name: "memory_deeper", input: {} }),
    await tools.run({ name: "memory_search", input: { query: "the cake" } }),
  ];
}

async function firstLook(lines, question = Q, settings = {}) {
  return withServer([history(...lines), OPEN], async (seen, base) => {
    assert.equal(await client(base).memoryTools("u", settings).begin(question), RESULTS[0]);
    assert.deepEqual(seen.map((s) => s.path), [HISTORY, `${WORK}open`]);
    assert.equal(seen[0].body, '{"user_id":"u"}');
    return seen[1].body;
  });
}

test("S-2 named sends and answers byte for byte as before", async () => {
  for (const model of ["scroll-2", "tablet-2"]) {
    await withServer([OPEN, DEEPER, SEARCH], async (seen, base) => {
      const tools = client(base, model).memoryTools("u", { preset: "S-2" });
      assert.equal(tools.preset, "S-2");
      assert.deepEqual(await turn(tools), RESULTS);
      assert.deepEqual(seen.map((s) => s.path), [`${WORK}open`, `${WORK}deeper`, `${WORK}search`]);
      assert.deepEqual(seen.map((s) => s.body), [PLAIN, ...LATER]);
      assert.deepEqual([...new Set(seen.map((s) => s.model))], ["scroll-2"]);
    });
  }
});

test("no preset on scroll-2 is S-2-live", async () => {
  await withServer([], async (seen, base) => {
    assert.equal(client(base).memoryTools("u").preset, "S-2-live");
    assert.equal(client(base, "tablet-2").memoryTools("u", { preset: "S-2-live" }).preset, "S-2-live");
  });
  assert.equal(await firstLook([]), asked(Q));
  await withServer([history(), OPEN], async (seen, base) => {
    await client(base, "tablet-2").memoryTools("u", { preset: "S-2-live" }).begin(Q);
    assert.deepEqual(seen.map((s) => s.model), ["scroll-2", "scroll-2"]);
  });
});

test("the first look reads the last two lines of the last five minutes", async () => {
  const cases = [
    [[], Q],
    [[["we booked the cabin", 1]], `we booked the cabin\n${Q}`],
    [[["we booked the cabin", 2], ["Theo drives up Friday", 1]], `we booked the cabin\nTheo drives up Friday\n${Q}`],
    [[["first", 3], ["second", 2], ["third", 1]], `second\nthird\n${Q}`],
    [[["last week", 60 * 24 * 7], ["too early", 6], ["just now", 4]], `just now\n${Q}`],
    [[["we booked the cabin", 2], ["Theo drives up Friday", 1], [Q, 0]], `we booked the cabin\nTheo drives up Friday\n${Q}`],
  ];
  for (const [lines, want] of cases) assert.equal(await firstLook(lines), asked(want), JSON.stringify(lines));
});

test("a long line is cut from its start and a long question goes whole alone", async () => {
  const line = `start ${"x".repeat(600)}`;
  const body = await firstLook([["Theo drives up Friday", 2], [line, 1]]);
  const sent = JSON.parse(body).question;
  assert.equal(sent, `${line.slice(-(500 - Q.length - 1))}\n${Q}`);
  assert.equal(sent.length, 500);
  assert.equal(body, asked(sent));
  const cut = "x".repeat(500 - Q.length - 2);
  assert.equal(await firstLook([[`start ${cut}`, 1]]), asked(`${cut}\n${Q}`));
  const question = "y".repeat(600);
  assert.equal(await firstLook([["we booked the cabin", 1]], question), asked(question));
});

test("a failed recent read opens with the question alone", async () => {
  await withServer([{ status: 500, body: '{"error":"down"}' }, OPEN], async (seen, base) => {
    assert.equal(await client(base, "scroll-2", { retries: 0 }).memoryTools("u").begin(Q), RESULTS[0]);
    assert.deepEqual(seen.map((s) => s.path), [HISTORY, `${WORK}open`]);
    assert.equal(seen[1].body, asked(Q));
  });
});

test("the filter and diversity go on the open and later looks send nothing new", async () => {
  await withServer([history(["we booked the cabin", 1]), OPEN, DEEPER, SEARCH], async (seen, base) => {
    assert.deepEqual(await turn(client(base).memoryTools("u")), RESULTS);
    assert.deepEqual(seen.map((s) => s.path), [HISTORY, `${WORK}open`, `${WORK}deeper`, `${WORK}search`]);
    const opened = JSON.parse(seen[1].body);
    assert.deepEqual(opened.filters, { source_types: ["user_said", "ai_thought", "inferred", "system"] });
    assert.equal(opened.diversity, "full");
    assert.equal(seen[1].body, asked(`we booked the cabin\n${Q}`));
    assert.deepEqual(seen.slice(2).map((s) => s.body), LATER);
  });
});

test("own words and diversity set on top of the preset win", async () => {
  for (const [settings, tail] of [
    [{ ownWords: true }, ',"diversity":"full"'],
    [{ diversity: "mmr" }, `${OTHERS},"diversity":"mmr"`],
    [{ ownWords: true, diversity: "none" }, ',"diversity":"none"'],
    [{ ownWords: null, diversity: null }, LIVE],
  ]) {
    assert.equal(await firstLook([], Q, settings), asked(Q, tail), JSON.stringify(settings));
  }
  for (const [settings, tail] of [[{ ownWords: false }, OTHERS], [{ diversity: "full" }, ',"diversity":"full"'], [{ ownWords: null, diversity: null }, ""]]) {
    await withServer([OPEN], async (seen, base) => {
      await client(base).memoryTools("u", { preset: "S-2", ...settings }).begin(Q);
      assert.equal(seen[0].body, asked(Q, tail), JSON.stringify(settings));
    });
  }
});

test("refusals name both presets and the model sees the same tools", async () => {
  await withServer([], async (seen, base) => {
    const mem = client(base);
    assert.throws(() => mem.memoryTools("u", { preset: "S-3" }), (e) => e.message === 'unknown memory tools preset "S-3": the presets are "S-2", "S-2-live".');
    assert.throws(
      () => mem.withModel("tablet-2").memoryTools("u"),
      (e) => e.message === 'model "tablet-2" has no memory tools preset: pass preset "S-2" (scroll-2) or "S-2-live" (scroll-2).',
    );
    for (const flags of [{}, { speakers: true, dates: true, images: true, seen: true, usage: true }]) {
      const live = mem.memoryTools("u", flags);
      const s2 = mem.memoryTools("u", { preset: "S-2", ...flags });
      assert.equal(live.note, s2.note);
      for (const format of ["anthropic", "openai"]) assert.deepEqual(live.definitions(format), s2.definitions(format));
    }
    assert.equal(seen.length, 0);
  });
});
