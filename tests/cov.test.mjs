import { test } from "node:test";
import assert from "node:assert/strict";
import { APIConnectionError, Client, ModelCallError, WosError, anthropicCaller, openaiCaller } from "../dist/wontopos.js";

const KEY = "wos-test-xxxxxxxxxx";
const LLM_KEY = "sk-test-0000000000000000";
const MODEL_MAX = 32 * 1024 * 1024;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const modelCall = () => ({ purpose: "router", model: "m", system: ["s"], user: "u", maxTokens: 10, signal: new AbortController().signal });
const callError = (status, message) => (e) => e instanceof ModelCallError && e.status === status && e.message === message;

function rfc850(year) {
  const day = DAYS[new Date(Date.UTC(year, 0, 1)).getUTCDay()];
  return `${day}, 01-Jan-${String(year % 100).padStart(2, "0")} 00:00:00 GMT`;
}

const decided = (d) => ({ text: JSON.stringify({ action: "skill", skill: "", input: "", note: "", text: "", ...d }), stop: "end" });

function recorder(replies = []) {
  const calls = [];
  const caller = {
    async call(c) {
      calls.push(c);
      const r = replies.length ? replies.shift() : decided({ action: "cannot", text: "no" });
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { caller, calls };
}

const make = (router) => new Client({ apiKey: KEY, tz: 9, userId: "u", router });

const PLAN_INPUT = {
  type: "object",
  properties: {
    tags: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
    mode: { enum: ["fast", { at: 1, by: [true, null] }] },
    fixed: { const: { a: 1, b: "x" } },
    size: { anyOf: [{ type: "number", minimum: 1 }, { type: "null" }] },
    flag: { type: "boolean" },
    extra: { type: "object", additionalProperties: { type: "integer" } },
  },
  additionalProperties: false,
};

test("a skill's input is checked against lists, enums, consts, anyOf, types and extra fields", async () => {
  const ran = [];
  const wos = make({ routerCaller: recorder().caller, handlers: { plan: (input) => (ran.push(input), "planned") } });
  await wos.addSkill({ name: "plan", description: "Plan it.", kind: "code", input: PLAN_INPUT });
  const refused = [
    [{ tags: [] }, "input.tags must hold at least 1 items"],
    [{ tags: ["a", "b", "c"] }, "input.tags must hold at most 2 items"],
    [{ tags: ["a", 2] }, "input.tags[1] must be string"],
    [{ tags: "a" }, "input.tags must be array"],
    [{ mode: "slow" }, 'input.mode must be one of ["fast",{"at":1,"by":[true,null]}]'],
    [{ mode: { at: 1, by: [true] } }, 'input.mode must be one of ["fast",{"at":1,"by":[true,null]}]'],
    [{ fixed: { a: 1 } }, 'input.fixed must be {"a":1,"b":"x"}'],
    [{ size: 0 }, "input.size fits none of the shapes it may take"],
    [{ size: "big" }, "input.size fits none of the shapes it may take"],
    [{ flag: "yes" }, "input.flag must be boolean"],
    [{ extra: { n: 1.5 } }, "input.extra.n must be integer"],
    [{ other: 1 }, "input.other is not a field this skill takes"],
  ];
  for (const [input, why] of refused) {
    await assert.rejects(wos.runSkill("plan", input), (e) => e.message === `plan: ${why}.`, JSON.stringify(input));
  }
  assert.deepEqual(ran, []);
  const input = { tags: ["a"], mode: { by: [true, null], at: 1 }, fixed: { b: "x", a: 1 }, size: null, flag: false, extra: { n: 2 } };
  const r = await wos.runSkill("plan", input);
  assert.deepEqual([r.ok, r.text, ran], [true, "planned", [input]], r.detail);
  assert.equal((await wos.runSkill("plan", { size: 2.5, mode: "fast" })).ok, true);
});

test("a skill's input schema is refused where a list keyword holds no list or a sub-schema is not one", async () => {
  const wos = make({ routerCaller: recorder().caller, handlers: { plan: () => "ok" } });
  const refused = [
    [{ type: "object", properties: { tags: { type: "array", items: "string" } } }, "input.tags[]: a schema is an object."],
    [{ type: "object", properties: { mode: { enum: [] } } }, "input.mode: enum must be a non-empty list."],
    [{ type: "object", properties: { mode: { enum: "fast" } } }, "input.mode: enum must be a non-empty list."],
    [{ type: "object", properties: { size: { anyOf: [] } } }, "input.size: anyOf must be a non-empty list of schemas."],
    [{ type: "object", properties: { size: { anyOf: [{ type: "nope" }] } } },
      "input.size.anyOf[0]: type must be one of object, array, string, number, integer, boolean, null, or a list of them."],
    [{ type: "object", additionalProperties: 1 }, "input.*: a schema is an object."],
  ];
  for (const [input, why] of refused) {
    await assert.rejects(wos.addSkill({ name: "plan", description: "Plan it.", kind: "code", input }), (e) => e.message === why, why);
  }
  assert.deepEqual(await wos.listSkills(), []);
});

test("SKILL.md frontmatter skips comments and blank lines, joins a value's indented lines and reads single quotes", async () => {
  const wos = make({ routerCaller: recorder().caller });
  const text = [
    "---",
    "# kept out",
    "name: plan-trip",
    "",
    "description: Plans a trip",
    "  over two lines",
    "",
    "note: 'It''s fine'",
    "empty: |",
    "tags: [a, 'b c']",
    "---",
    "Plan it.",
  ].join("\n");
  const def = await wos.importSkillMd(undefined, text);
  assert.equal(def.description, "Plans a trip over two lines");
  assert.deepEqual(def.metadata.frontmatter, { note: "It's fine", empty: "", tags: ["a", "b c"] });
  const refused = [
    ["---\n  name: a\ndescription: x\n---\nDo it.", "SKILL.md frontmatter, line 2: an indented line with no key above it."],
    ["---\nname: a\ndescription: \"quoted\"\n  continued\n---\nDo it.",
      "SKILL.md frontmatter, line 3: a quoted value cannot go on over the indented lines below it."],
    ["---\nname: a\ndescription: \"bad \\q\"\n---\nDo it.", "SKILL.md frontmatter, line 3: the double-quoted value is not valid."],
  ];
  for (const [md, why] of refused) await assert.rejects(wos.importSkillMd(undefined, md), (e) => e.message === why, why);
});

test("a code skill's answer that is not JSON is said as its text, and its throw is a tool_error from runSkill", async () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const wos = make({
    routerCaller: recorder().caller,
    handlers: { loop: () => cyclic, fail: () => { throw new Error("the oven is off"); } },
  });
  for (const name of ["loop", "fail"]) await wos.addSkill({ name, description: "Do it.", kind: "code", input: { type: "object" } });
  const r = await wos.runSkill("loop", {});
  assert.deepEqual([r.ok, r.text], [true, "[object Object]"], r.detail);
  const f = await wos.runSkill("fail", {});
  assert.deepEqual([f.ok, f.reason, f.detail, f.skill], [false, "tool_error", "fail threw: the oven is off", "fail"]);
  assert.equal(typeof f.text, "string");
});

test("an llm skill with no caller is not_configured, and one answering no text failed", async () => {
  const lonely = make({ routerCaller: recorder().caller });
  await lonely.addSkill({ name: "lookup", description: "Look it up.", kind: "llm", instructions: "Answer.", input: { type: "object" } });
  const r = await lonely.runSkill("lookup", {});
  assert.deepEqual([r.ok, r.reason, r.detail], [false, "not_configured", "an llm skill needs router.key, router.skillKey or router.skillCaller"]);
  const mute = recorder([{ text: "  ", stop: "end", usage: { input_tokens: 3, cache: { read: 1 }, tier: "standard" } }]);
  const wos = make({ routerCaller: recorder().caller, skillCaller: mute.caller });
  await wos.addSkill({ name: "lookup", description: "Look it up.", kind: "llm", instructions: "Answer.", input: { type: "object" } });
  const e = await wos.runSkill("lookup", {});
  assert.deepEqual([e.ok, e.reason, e.detail], [false, "failed", "the skill model answered with no text"]);
  assert.deepEqual(e.usage, { skill: { input_tokens: 3, cache: { read: 1 }, tier: "standard" } });
});

test("a provider error with a status the router has no reason for is failed, with the status in the detail", async () => {
  const wos = make({ routerCaller: recorder([new ModelCallError(409, "busy elsewhere")]).caller });
  await wos.addSkill({ name: "lookup", description: "Look it up.", kind: "llm", instructions: "Answer.", input: { type: "object" } });
  const r = await wos.ask("q", { history: "none" });
  assert.deepEqual([r.ok, r.reason, r.detail], [false, "failed", "409: busy elsewhere"]);
});

test("a router decision inside prose is found past escaped quotes and escaped letters in strings", async () => {
  const said = 'Thinking {"x":"{\\"y", z} then {"action":"cannot","skill":"","input":"","note":"a\\tb","text":"no \\"way\\"\\n"} done';
  const wos = make({ routerCaller: recorder([{ text: said, stop: "end" }]).caller });
  await wos.addSkill({ name: "lookup", description: "Look it up.", kind: "llm", instructions: "Answer.", input: { type: "object" } });
  const r = await wos.ask("q", { history: "none" });
  assert.deepEqual([r.ok, r.action, r.text], [true, "cannot", 'no "way"'], r.detail);
});

test("a blank router prompt is refused", () => {
  for (const prompt of ["", "  \n", 7]) {
    assert.throws(() => make({ routerCaller: recorder().caller, prompt }), (e) => e.message === "router.prompt must be the whole router prompt: a non-blank string.");
  }
});

test("an ask id is made without crypto.randomUUID too", async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
  try {
    const wos = make({ routerCaller: recorder().caller, handlers: { plan: () => "ok" } });
    await wos.addSkill({ name: "plan", description: "Plan it.", kind: "code", input: { type: "object" } });
    const r = await wos.runSkill("plan", {});
    assert.match(r.askId, /^ask-[0-9a-f]{24}$/);
  } finally {
    Object.defineProperty(globalThis, "crypto", had);
  }
});

test("a skill that cannot be kept as JSON is refused with the reason", async () => {
  const wos = make({ routerCaller: recorder().caller, handlers: { plan: () => "ok" } });
  await assert.rejects(
    wos.addSkill({ name: "plan", description: "Plan it.", kind: "code", input: { type: "object" }, metadata: { n: 1n } }),
    (e) => e.message === "plan: the skill cannot be kept as JSON (Do not know how to serialize a BigInt).",
  );
});

test("a provider answer that is not JSON, or too large by its length, its bytes or its stream, is refused", async () => {
  const via = (res) => anthropicCaller({ apiKey: LLM_KEY, fetch: async () => res });
  await assert.rejects(via(new Response("not json", { status: 200 })).call(modelCall()), callError(200, "the provider's answer is not JSON"));
  await assert.rejects(via(new Response("[1]", { status: 200 })).call(modelCall()), callError(200, "the provider's answer is not a JSON object"));
  const long = new Response("{}", { status: 200, headers: { "content-length": String(MODEL_MAX + 1) } });
  await assert.rejects(via(long).call(modelCall()), callError(200, `the provider's answer is too large (${MODEL_MAX + 1} bytes)`));
  const bare = (bytes) => ({ status: 200, ok: true, type: "basic", redirected: false, headers: new Headers(), body: null, arrayBuffer: async () => bytes });
  const hi = new TextEncoder().encode(JSON.stringify({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }));
  assert.equal((await via(bare(hi.buffer)).call(modelCall())).text, "hi");
  await assert.rejects(via(bare(new ArrayBuffer(MODEL_MAX + 1))).call(modelCall()), callError(200, "the provider's answer is too large"));
  let pulls = 0;
  let cancelled = false;
  const endless = new ReadableStream({
    pull(c) {
      pulls++;
      c.enqueue(new Uint8Array(1 << 20));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(via(new Response(endless, { status: 200 })).call(modelCall()), callError(200, "the provider's answer is too large"));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(cancelled && pulls <= 34, `cancelled ${cancelled} after ${pulls} pulls`);
});

test("an OpenAI-compatible error whose status has no reason keeps none, and its message is found where the server put it", async () => {
  const via = (status, body, headers = {}) =>
    openaiCaller({ baseUrl: "https://llm.example", model: "m", apiKey: LLM_KEY, fetch: async () => new Response(body, { status, headers }) });
  const failed = async (status, body, check) => {
    try {
      await via(status, body).call(modelCall());
    } catch (e) {
      assert.ok(e instanceof ModelCallError, String(e));
      return check(e);
    }
    assert.fail("no error");
  };
  await failed(409, JSON.stringify({ error: { message: "conflict" } }), (e) => assert.deepEqual([e.status, e.reason, e.message], [409, undefined, "conflict"]));
  await failed(409, "plain words", (e) => assert.equal(e.message, "plain words"));
  await failed(409, "[1, 2]", (e) => assert.equal(e.message, "[1, 2]"));
  await failed(409, JSON.stringify({ error: "said as a string" }), (e) => assert.equal(e.message, "said as a string"));
  await failed(409, JSON.stringify({ message: "said at the top" }), (e) => assert.equal(e.message, "said at the top"));
});

test("a Retry-After in the old RFC 850 form reads its two-digit year as at most 50 years ahead", async () => {
  const year = new Date().getUTCFullYear();
  const waitOf = async (ra) => {
    const c = openaiCaller({
      baseUrl: "https://llm.example", model: "m", apiKey: LLM_KEY,
      fetch: async () => new Response("{}", { status: 429, headers: { "retry-after": ra } }),
    });
    try {
      await c.call(modelCall());
    } catch (e) {
      return e.retryAfterMs;
    }
    assert.fail("no error");
  };
  const ahead = await waitOf(rfc850(year + 49));
  assert.ok(ahead > 48 * 365 * 86_400_000, `${rfc850(year + 49)} waits ${ahead} ms`);
  assert.equal(await waitOf(rfc850(year - 49)), 0, rfc850(year - 49));
  assert.equal(await waitOf(rfc850(year - 1)), 0, rfc850(year - 1));
});

const answered = (body, init = {}) =>
  new Response(typeof body === "string" || body instanceof ReadableStream ? body : JSON.stringify(body), { status: 200, ...init });

function service(answer, extra = {}) {
  const seen = [];
  const fetch = async (url, init) => {
    if (init?.signal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
    const path = new URL(url).pathname;
    seen.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    return answer(path, seen.length);
  };
  return { seen, wos: new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", userId: "u", maxRetries: 0, fetch, ...extra }) };
}

const SELF = {
  user_id: "u",
  core: { title: "", version: 0, tokens: 0, written_at: null, day: null, body: "" },
  files: [1, 2, 3, 4].map((slot) => ({ slot, title: "", version: 0, tokens: 0, written_at: null, day: null })),
  notes_version: 0,
};
const NIGHT = [{ id: "m-1", content: "Dana planted roses today.", created_at: "2026-10-19T09:00:00Z", speaker: "Dana", tokens: 8 }];

test("a sleep estimate reads from a given time, and a cursor repeated with memories or a walk past the page limit is a truncated answer", async () => {
  let pages = [];
  const { seen, wos } = service((path, n) => answered(path.endsWith("/sleep") ? (pages.length ? pages.shift() : { memories: [], next_cursor: `c${n}` }) : SELF));
  pages = [{ memories: NIGHT, next_cursor: "c1" }, { memories: [], next_cursor: "c1" }];
  const est = await wos.sleepEstimate("u", { since: "2026-10-19T00:00:00Z" });
  assert.equal(est.memories, 1);
  assert.deepEqual([seen[0].body.since, seen[0].body.since_last_sleep, seen[1].body.cursor], ["2026-10-19T00:00:00Z", undefined, "c1"]);
  pages = [{ memories: NIGHT, next_cursor: "c1" }, { memories: NIGHT, next_cursor: "c1" }];
  await assert.rejects(wos.sleepEstimate("u"),
    (e) => e.message === "the service returned a page cursor it had already returned. This is a truncated answer, not the whole store.");
  const before = seen.length;
  await assert.rejects(wos.sleepEstimate("u"), (e) => e.message === "the sleep's reading passed its page limit. This is a truncated answer, not the whole store.");
  assert.equal(seen.length - before, 20_001);
});

test("a sleep model's error with no status and no dropped connection ends the sleep after one call", async () => {
  const night = { user_id: "u", sleep_id: "s-1", memories: NIGHT, count: 1, tokens: 8, exhausted: true, next_cursor: null };
  const { seen, wos } = service((path) =>
    answered(path.endsWith("/sleep") ? night : path.endsWith("/self/notes") ? { notes: { proposals: [], mixed: [] } } : SELF));
  let calls = 0;
  const llm = async () => {
    calls++;
    throw new Error("the model is not there");
  };
  await assert.rejects(wos.sleep("u", { llm, assistant: "Kai", today: "2026-10-20 09:30" }), (e) => e.message === "the model is not there");
  assert.equal(calls, 1);
  assert.ok(!seen.some((r) => r.path.endsWith("/sleep/done")));
});

test("a sleep whose signal stops while it reads the assistant's name, or just before its first model call, asks no model", async () => {
  const night = { user_id: "u", sleep_id: "s-1", memories: NIGHT, count: 1, tokens: 8, exhausted: true, next_cursor: null };
  for (const [stopAt, assistant] of [["/settings", undefined], ["/self/notes", "Kai"]]) {
    const stop = new AbortController();
    const { wos } = service((path) => {
      if (path.endsWith(stopAt)) stop.abort();
      if (path.endsWith("/settings")) throw new DOMException("This operation was aborted", "AbortError");
      return answered(path.endsWith("/sleep") ? night : path.endsWith("/self/notes") ? { notes: { proposals: [], mixed: [] } } : SELF);
    });
    let calls = 0;
    const llm = async () => {
      calls++;
      return { text: "{}", stop: "end" };
    };
    await assert.rejects(wos.withSignal(stop.signal).sleep("u", { llm, assistant, today: "2026-10-20 09:30" }), stopAt);
    assert.equal(calls, 0, stopAt);
  }
});

test("a sleep refuses a rewrite with no section, a dated box section, a core remake and a remake with no title", async () => {
  const lines = [...NIGHT, { id: "m-2", content: "Dana said the roses need water.", created_at: "2026-10-19T09:01:00Z", speaker: "Dana", tokens: 9 }];
  const night = { user_id: "u", sleep_id: "s-1", memories: lines, count: 2, tokens: 17, exhausted: true, next_cursor: null };
  const { wos } = service((path) =>
    answered(path.endsWith("/sleep") ? night : path.endsWith("/self/notes") ? { notes: { proposals: [], mixed: [] } } : SELF));
  const evidence = ["e1", "e2"];
  const edits = [
    { file: "core", op: "rewrite", section: "", text: "Dana gardens.", evidence },
    { file: "1", op: "rewrite", section: "2026-10-20", text: "Roses went in.", evidence },
    { file: "core", op: "remake", title: "Core", text: "Everything anew.", evidence },
    { file: "1", op: "remake", title: "", text: "## Garden\nRoses.", evidence },
  ];
  const read = { items: [{ kind: "person", topic: "Dana", text: "Dana planted roses and waters them.", evidence }], mixed: [] };
  const llm = async (c) => ({
    text: JSON.stringify(c.user.includes("<items>") ? { edits, notes: [] } : c.user.includes("<memories>") ? read : { add: [], op: "none", drop: [], text: "" }),
    stop: "end",
  });
  const res = await wos.sleep("u", { llm, assistant: "Kai", today: "2026-10-20 09:30" });
  assert.deepEqual(res.refused.map((r) => r.why), [
    "rewrite needs a section and text",
    "a box section is a matter, not its state on a date: rewrite the matter's section",
    "the core is rewritten by sections, not remade",
    "remake needs a title and the whole file",
  ]);
});

test("an image walk ends when the service repeats its cursor on an empty page", async () => {
  const { seen, wos } = service(() => answered({ images: [], has_more: true, next_before: "b", next_skip_ids: ["i1"] }));
  for await (const m of wos.iterImages()) assert.fail(String(m));
  assert.equal(seen.length, 2);
});

test("a page whose globals throw when read is no browser page", () => {
  Object.defineProperty(globalThis, "window", { get() { throw new Error("blocked"); }, configurable: true });
  try {
    assert.equal(typeof anthropicCaller({ apiKey: LLM_KEY }).call, "function");
  } finally {
    delete globalThis.window;
  }
});

test("memory tools say a service error that is no 404 from memory_photo and memory_seen as a refusal", async () => {
  const opened = { work_id: "w-1", memories: [{ n: 1, id: "a", content: "Dinner at Mina's.", image_ref: "img-1" }] };
  const turns = { turns: [{ role: "user", content: "hi", timestamp: "2026-10-20T09:00:00Z" }] };
  const { wos } = service((path) =>
    path.endsWith("/image") || path.endsWith("/seen") ? answered({ error: { message: "broken" } }, { status: 500 })
    : answered(path.endsWith("/history") ? turns : opened), { model: "scroll-2", tz: 9 });
  const photos = wos.memoryTools("u", { images: true });
  await photos.begin("dinner");
  assert.equal(await photos.run({ name: "memory_photo", input: { n: 1 } }), "Refused: [500] broken");
  const recent = wos.memoryTools("u", { seen: true });
  assert.match(await recent.run({ name: "memory_recent", input: {} }), /#1 user: hi/);
  assert.equal(await recent.run({ name: "memory_seen", input: { n: 1 } }), "Refused: [500] broken");
});

test("usage takes a whole number of days from 1 to 365 and sends nothing otherwise", async () => {
  const { seen, wos } = service(() => answered({}));
  for (const bad of [0, 366, 1.5]) {
    await assert.rejects(wos.usage(bad), (e) => e.message === `days must be an integer between 1 and 365, got ${bad}.`);
  }
  assert.deepEqual(seen, []);
});

test("an image answer with no bytes is an error, and an image that is no object is refused before sending", async () => {
  const { seen, wos } = service(() => answered("", { headers: { "content-type": "image/png" } }));
  await assert.rejects(wos.getImage("u", "m1"), (e) => e instanceof WosError && e.message === "[200] empty image body — the service returned no bytes");
  await assert.rejects(wos.add("a photo", "u", {}, { image: "abc" }), (e) => e.message === "image must be an object — { data: '<base64>' }.");
  assert.equal(seen.length, 1);
});

test("a page cursor the service repeats as an object ends the walk as a repeated string cursor does", async () => {
  let rows = [];
  const { seen, wos } = service(() => answered({ memories: rows, next_cursor: { page: 2 } }));
  assert.deepEqual(await wos.exportMemories(), []);
  assert.equal(seen.length, 2);
  rows = [{ id: "m1", content: "x" }];
  await assert.rejects(wos.exportMemories(), (e) => e.message.startsWith("stopped at page 2: the service repeated a cursor"));
  assert.equal(seen.length, 4);
});

test("a walk whose every page brings a new cursor stops after 20000 pages", async () => {
  const { seen, wos } = service((path, n) =>
    answered(path.endsWith("/images") ? { images: [], has_more: true, next_before: `b${n}` } : { memories: [], next_cursor: `c${n}` }));
  const said = (e) => e.message === "stopped after 20000 pages — the store did not end. This is a truncated answer, not the whole store.";
  await assert.rejects(wos.exportMemories(), said);
  assert.equal(seen.length, 20000);
  await assert.rejects((async () => { for await (const m of wos.iterImages()) assert.fail(String(m)); })(), said);
  assert.equal(seen.length, 40000);
});

test("store is add by another name, and withSignal binds a signal that stops the call", async () => {
  const { seen, wos } = service(() => answered({ status: "ok", id: "m1" }));
  await wos.store("Dana planted roses.");
  assert.deepEqual([seen[0].path, seen[0].body.content], ["/api/v1/memory/store", "Dana planted roses."]);
  const stop = new AbortController();
  stop.abort();
  const bound = wos.withSignal(stop.signal);
  assert.ok(bound instanceof Client);
  await assert.rejects(bound.stats());
  assert.equal(seen.length, 1);
});

test("a client is refused when the runtime has no fetch and none is given", () => {
  const had = globalThis.fetch;
  globalThis.fetch = undefined;
  try {
    assert.throws(() => new Client({ apiKey: KEY }), (e) => e.message.startsWith("no fetch available in this runtime"));
  } finally {
    globalThis.fetch = had;
  }
});

test("a body that breaks while it is read is a network error, and one too large without a stream is refused", async () => {
  const broken = service(() => answered(new ReadableStream({ pull(c) { c.error(new Error("socket hang up")); } })));
  await assert.rejects(broken.wos.stats(), (e) => e instanceof APIConnectionError && e.message === "[0] network error: socket hang up");
  const big = 64 * 1024 * 1024 + 1;
  const bare = { status: 200, ok: true, type: "basic", redirected: false, headers: new Headers(), body: null, arrayBuffer: async () => new ArrayBuffer(big) };
  const huge = service(() => bare);
  await assert.rejects(huge.wos.stats(), (e) => e instanceof WosError && e.message === `[200] response too large (${big} bytes) — refusing it`);
});

test("an error body nested too deep to measure keeps its message and drops its details", async () => {
  let nest = "0";
  for (let i = 0; i < 200_000; i++) nest = `[${nest}]`;
  const { wos } = service(() => answered(`{"error":{"message":"deep","nest":${nest}}}`, { status: 400 }));
  await assert.rejects(wos.stats(), (e) => e instanceof WosError && e.message === "[400] deep" && e.details === undefined);
});

test("a Node process with importScripts defined is still no browser worker", () => {
  globalThis.importScripts = () => {};
  try {
    assert.equal(typeof anthropicCaller({ apiKey: LLM_KEY }).call, "function");
  } finally {
    delete globalThis.importScripts;
  }
});

test("the plain-HTTP warning forgets its oldest host past 1024 and warns for it again", () => {
  const warned = [];
  const was = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    const fetch = async () => answered({});
    for (let i = 0; i <= 1024; i++) new Client({ apiKey: KEY, baseUrl: `http://cov-${i}.example`, fetch });
    assert.equal(warned.length, 1025);
    new Client({ apiKey: KEY, baseUrl: "http://cov-1024.example", fetch });
    assert.equal(warned.length, 1025);
    new Client({ apiKey: KEY, baseUrl: "http://cov-0.example", fetch });
    assert.equal(warned.length, 1026);
  } finally {
    console.warn = was;
  }
});

test("an earlier exchange's time with an offset is shown on the router's clock, and an offset past 23 hours as ?", async () => {
  const exchanges = [
    { request: "east", answer: "a", at: "2026-10-20T09:00:00+09:00" },
    { request: "west", answer: "b", at: "2026-10-20T09:00:00-05:30" },
    { request: "bad", answer: "c", at: "2026-10-20T09:00:00+24:00" },
  ];
  const calls = [];
  const fetch = async (url) => answered(new URL(url).pathname.endsWith("/channel/read") ? { exchanges } : { status: "ok" });
  const wos = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", tz: 9, userId: "u", fetch, router: { routerCaller: async (c) => (calls.push(c), decided({ action: "cannot", text: "no" })) } });
  await wos.addSkill({ name: "lookup", description: "Look it up.", kind: "llm", instructions: "Answer.", input: { type: "object" } });
  const r = await wos.ask("q");
  assert.equal(r.ok, true, r.detail);
  const shown = "[2026-10-20 09:00:00] request: east\nanswer: a\n[2026-10-20 23:30:00] request: west\nanswer: b\n[?] request: bad\nanswer: c";
  assert.ok(calls[0].user.includes(shown), calls[0].user);
});
