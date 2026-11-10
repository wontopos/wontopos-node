import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { inspect } from "node:util";
import { readFileSync } from "node:fs";
import {
  BadRequestError, Client, ModelCallError, SLEEP_VERSION, SleepSettings, anthropicCaller, openaiCaller,
} from "../dist/wontopos.js";
import * as sleep from "../dist/sleep.js";

const FIX = JSON.parse(readFileSync(new URL("./sleep-attacks.json", import.meta.url), "utf8"));
const KEY = FIX.keys.wontopos;
const PROVIDER_KEY = FIX.keys.provider;
const tok = sleep.sleepTokens;

function expand(v) {
  if (v && typeof v === "object" && !Array.isArray(v) && "$repeat" in v) return (v.prefix ?? "") + v.$repeat.repeat(v.times);
  if (Array.isArray(v)) return v.map(expand);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]));
  if (typeof v === "string") return v.replaceAll("@@ASSISTANT@@", "Wren");
  return v;
}

function answerFor(answers, system, user) {
  const a = { ...FIX.defaults.answers, ...answers };
  let got;
  if (system.includes(" you read part ")) {
    const k = Number(/you read part (\d+) of/.exec(system)[1]);
    got = "read_parts" in a ? a.read_parts[k - 1] : a.read;
  } else if (system.includes("Several readers each read one part")) got = a.combine ?? { items: JSON.parse(user) };
  else if (system.includes(", finishing.")) got = a.merge;
  else if (system.includes("Tonight you rewrote how")) got = a.settle;
  else if (system.includes("lines that are only a note of doubt")) got = a.tidy;
  else if (system.includes("has grown:")) got = a.fold;
  else if (system.includes("there is no room")) got = a.room;
  else throw new Error("a call the fixture does not script: " + system.slice(0, 80));
  got = expand(got);
  return typeof got === "string" ? got : JSON.stringify(got);
}

function fixtureModel(answers, baseUrl) {
  const calls = [];
  const caller = {
    call: (c) => {
      calls.push([c.system[0], c.user]);
      const text = answerFor(answers, c.system[0], c.user);
      return { text, stop: "end", usage: { input_tokens: tok(c.user), output_tokens: tok(text) } };
    },
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
  return { caller, calls };
}

const pad = (n) => String(n).padStart(2, "0");

function nightRows(n, night) {
  const day = night.today.slice(0, 10);
  return night.memories.map(([who, text, name], i) => ({
    id: `m${n + 1}-${i + 1}`, content: text, created_at: `${day}T09:${pad(i)}:00Z`,
    speaker: name ?? (who === "user" ? "Alex" : "Wren"), tokens: tok(text),
  }));
}

function section(body, heading) {
  const out = new Map();
  let cur = null;
  for (const ln of body.split("\n")) {
    if (ln.startsWith("## ")) {
      cur = ln.slice(3).trim();
      out.set(cur, []);
    } else if (cur !== null) out.get(cur).push(ln);
  }
  return out.has(heading) ? out.get(heading).join("\n").trim() : null;
}

function label(e) {
  const named = e.section || e.title || "";
  return `${e.file} ${e.op}` + (named ? ` ${named}` : "");
}

const SETTING_NAMES = { core_tokens: "coreTokens", box_tokens: "boxTokens", part_tokens: "partTokens", readers: "readers", group: "group", sleepy_tokens: "sleepyTokens" };
const settingsOf = (scenario) => new SleepSettings(Object.fromEntries(
  Object.entries({ ...FIX.defaults.settings, ...(scenario.settings ?? {}) }).map(([k, v]) => [SETTING_NAMES[k], v])));

const TAKES = {
  "sleep/done": ["user_id", "sleep_id"], self: ["user_id"], "self/open": ["user_id", "slot", "version"],
  "self/write": ["user_id", "sleep_id", "writes"], "self/notes": ["user_id"], "self/notes/write": ["user_id", "base_version", "notes"],
};
const WRITE_TAKES = ["slot", "base_version", "title", "body", "evidence", "day"];

class Service {
  constructor() {
    this.rows = [];
    this.last = 0;
    this.sleeps = new Map();
    this.slots = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    this.notes = null;
    this.notesVersion = 0;
    this.caps = { 0: 70_000, 1: 20_000, 2: 20_000, 3: 20_000, 4: 20_000 };
    this.fail = [];
    this.seen = [];
  }

  give(rows) { this.rows.push(...rows); }

  latest(k) { return this.slots[k].at(-1) ?? null; }

  static coded(status, code, message) { return [status, { error: { code, message } }]; }

  handle(path, body, headers) {
    this.seen.push({ path, body, headers });
    const i = this.fail.findIndex(([p]) => p === path);
    if (i >= 0) {
      const [, status, payload] = this.fail.splice(i, 1)[0];
      return [status, payload];
    }
    const route = path.replace("/api/v1/memory/", "").split("?")[0];
    const takes = TAKES[route] ?? Object.keys(body);
    const extra = new Set(Object.keys(body).filter((k) => !takes.includes(k)));
    if (route === "self/write") for (const w of body.writes ?? []) for (const k of Object.keys(w)) if (!WRITE_TAKES.includes(k)) extra.add(k);
    if (extra.size) return Service.coded(400, "invalid_request", `unknown fields ${JSON.stringify([...extra].sort())}`);
    return this[`on_${route.replace(/\//g, "_")}`](body);
  }

  on_settings() {
    return [200, { user_id: "u", time_zone: null, default_speakers: { user: "Alex", assistant: "Wren" }, speakers: ["Alex", "Wren"] }];
  }

  on_sleep(b) {
    let sid = b.sleep_id;
    if (sid === undefined) {
      sid = `s-${this.sleeps.size + 1}`;
      this.sleeps.set(sid, { since: this.last, until: this.rows.length, handed: new Set() });
    }
    const r = this.sleeps.get(sid);
    let i = b.cursor?.after ?? r.since;
    const page = [];
    let used = 0;
    while (i < r.until) {
      const t = this.rows[i].tokens;
      if (page.length && used + t > (b.budget_tokens ?? 5000)) break;
      page.push(this.rows[i]);
      used += t;
      i++;
    }
    for (const x of page) r.handed.add(x.id);
    const exhausted = i >= r.until;
    return [200, {
      user_id: b.user_id, sleep_id: sid, memories: page, count: page.length, tokens: used, exhausted,
      next_cursor: exhausted ? null : { after: i }, clock: { local_now: "2026-10-20T09:30:00+09:00" },
    }];
  }

  on_sleep_done(b) {
    const r = this.sleeps.get(b.sleep_id);
    const changed = r.until > this.last;
    this.last = Math.max(this.last, r.until);
    return [200, { user_id: b.user_id, sleep_id: b.sleep_id, changed, last_sleep: { until: this.last } }];
  }

  entry(k, v) {
    if (!v) return { slot: k, title: "", version: 0, tokens: 0, written_at: null, day: null };
    return { slot: k, title: v.title, version: v.version, tokens: v.tokens, written_at: "2026-10-20T00:00:00Z", day: v.day };
  }

  on_self(b) {
    const core = this.entry(0, this.latest(0));
    delete core.slot;
    core.body = this.latest(0)?.body ?? "";
    return [200, { user_id: b.user_id, core, files: [1, 2, 3, 4].map((k) => this.entry(k, this.latest(k))), notes_version: this.notesVersion }];
  }

  on_self_open(b) {
    const v = this.slots[b.slot].at(-1) ?? null;
    return [200, { user_id: b.user_id, ...this.entry(b.slot, v), latest_version: this.slots[b.slot].length, body: v ? v.body : "", evidence: v ? v.evidence : [], sleep_id: null }];
  }

  on_self_write(b) {
    const r = this.sleeps.get(b.sleep_id);
    if (!r) return Service.coded(404, "sleep_not_found", "no sleep of this store has that sleep_id");
    for (const w of b.writes) {
      if (!(w.evidence ?? []).every((x) => r.handed.has(x))) return Service.coded(400, "self_evidence_unknown", "evidence the sleep was not handed");
      const have = this.latest(w.slot);
      if ((have ? have.version : 0) !== w.base_version) return Service.coded(409, "self_version_conflict", "the file changed since it was read");
      const n = tok(w.body);
      if (n > this.caps[w.slot]) return Service.coded(400, "self_no_room", "there is no room");
    }
    const out = [];
    for (const w of b.writes) {
      const v = { version: w.base_version + 1, title: w.title ?? "", body: w.body, tokens: tok(w.body), evidence: w.evidence ?? [], day: w.day ?? null };
      this.slots[w.slot].push(v);
      out.push({ ...this.entry(w.slot, v), evidence_count: v.evidence.length, sleep_id: b.sleep_id });
    }
    return [200, { user_id: b.user_id, sleep_id: b.sleep_id, written: out }];
  }

  on_self_notes(b) {
    const notes = this.notes ?? { proposals: [], mixed: [] };
    return [200, { user_id: b.user_id, version: this.notesVersion, written_at: null, bytes: JSON.stringify(notes).length, notes }];
  }

  on_self_notes_write(b) {
    if (b.base_version !== this.notesVersion) return Service.coded(409, "self_notes_conflict", "the notes changed since they were read");
    this.notes = { proposals: b.notes.proposals ?? [], mixed: b.notes.mixed ?? [] };
    this.notesVersion++;
    return [200, { user_id: b.user_id, version: this.notesVersion, written_at: "2026-10-20T00:00:00Z" }];
  }
}

async function listen(t, handler) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => handler(req, raw, res));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function served(t, svc = new Service()) {
  const base = await listen(t, (req, raw, res) => {
    const [status, payload] = svc.handle(req.url, raw ? JSON.parse(raw) : {}, req.headers);
    const data = JSON.stringify(payload);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
    res.end(data);
  });
  return [svc, new Client({ apiKey: KEY, baseUrl: base }), base];
}

async function provider(t, answers, kind, { fail, redirect, raw } = {}) {
  const seen = [];
  const base = await listen(t, (req, body, res) => {
    seen.push({ path: req.url, headers: req.headers, raw: body + JSON.stringify(req.headers) });
    const send = (status, payload, extra = {}) => {
      const data = JSON.stringify(payload);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...extra });
      res.end(data);
    };
    if (redirect !== undefined) return send(307, {}, { Location: redirect });
    if (fail !== undefined) return send(fail[0], fail[1]);
    const b = JSON.parse(body);
    const [system, user] = kind === "anthropic"
      ? [b.system.map((x) => x.text).join(""), b.messages[0].content]
      : [b.messages[0].content, b.messages[1].content];
    const text = raw ?? answerFor(answers, system, user);
    const usage = { input_tokens: tok(user), output_tokens: tok(text) };
    if (kind === "anthropic") return send(200, { content: [{ type: "text", text }], stop_reason: "end_turn", usage });
    return send(200, { choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens } });
  });
  const caller = kind === "anthropic"
    ? anthropicCaller({ apiKey: PROVIDER_KEY, baseUrl: base, model: "m" })
    : openaiCaller({ baseUrl: `${base}/v1`, apiKey: PROVIDER_KEY, model: "m" });
  return { seen, caller };
}

function checkNight(scenario, n, night, res, svc, start, reads = [], calls = []) {
  const where = `${scenario.name} night ${n + 1}`;
  const want = night.expect;
  for (const s of want.read_has ?? []) assert.ok(reads.some((r) => r.includes(s)), `${where}: a reader was sent ${JSON.stringify(s)}`);
  for (const s of want.read_lacks ?? []) assert.ok(!reads.some((r) => r.includes(s)), `${where}: no reader was sent ${JSON.stringify(s)}`);
  for (const s of want.calls_have ?? []) assert.ok(calls.some((c) => c.includes(s)), `${where}: a model call held ${JSON.stringify(s)}`);
  for (const s of want.calls_lack ?? []) assert.ok(!calls.some((c) => c.includes(s)), `${where}: no model call held ${JSON.stringify(s)}`);
  const latest = Object.keys(svc.slots).map((k) => svc.latest(k)?.body).filter((b) => typeof b === "string");
  for (const s of want.files_have ?? []) assert.ok(latest.some((f) => f.includes(s)), `${where}: a file holds ${JSON.stringify(s)}`);
  const core = svc.latest(0)?.body ?? "";
  const files = Object.values(svc.slots).flat().map((v) => `${v.body}\n${v.title}`);
  const notes = JSON.stringify(svc.notes ?? {});
  if ("refused" in want) assert.deepEqual(res.refused.map((r) => r.why), want.refused, where);
  if ("applied" in want) assert.deepEqual(res.applied.map(label), want.applied, where);
  if ("items" in want) assert.deepEqual(res.items.map((it) => `${it.kind} ${it.topic} ${it.evidence.join(",")}`), want.items, where);
  if ("dropped" in want) assert.equal(res.items_dropped_by_check, want.dropped, where);
  if ("me" in want) assert.equal(section(core, "Me"), want.me, where);
  for (const s of want.core_has ?? []) assert.ok(core.includes(s), `${where}: the core has ${JSON.stringify(s)}`);
  for (const s of want.core_lacks ?? []) assert.ok(!core.includes(s), `${where}: the core lacks ${JSON.stringify(s)}`);
  for (const s of want.files_lack ?? []) for (const f of files) assert.ok(!f.includes(s), `${where}: no file has ${JSON.stringify(s)}`);
  if ("mixed" in want) assert.deepEqual(res.mixed.map((m) => m.kind), want.mixed, where);
  for (const s of want.notes_have ?? []) assert.ok(notes.includes(s), `${where}: the notes have ${JSON.stringify(s)}`);
  for (const s of want.notes_lack ?? []) assert.ok(!notes.includes(s), `${where}: the notes lack ${JSON.stringify(s)}`);
  if ("proposals" in want) assert.deepEqual(res.proposals.map((p) => `${p.id} ${p.sleeps} ${p.applied || "-"}`), want.proposals, where);
  if ("ripe" in want) assert.deepEqual(res.ripe, want.ripe, where);
  if ("written" in want) assert.deepEqual(Object.keys(res.written).map(Number).sort((a, b) => a - b), want.written, where);
  if ("rooms" in want) assert.deepEqual(res.rooms.map((r) => `${r.file} ${r.after === null || r.after === undefined ? "kept" : "after"}`), want.rooms, where);
  const handed = new Set(nightRows(n, night).map((r) => r.id));
  for (const x of svc.seen.slice(start)) {
    if (x.path.endsWith("/self/write")) for (const w of x.body.writes) for (const e of w.evidence) assert.ok(handed.has(e), `${where}: ${e} was handed out`);
  }
}

test("sleep attacks: planted instructions meet the rules as the fixture says", async (t) => {
  assert.equal(FIX.sleep_version, SLEEP_VERSION, "the fixture is for this sleep");
  for (const scenario of FIX.scenarios) {
    const [svc, mem] = await served(t);
    if (scenario.before?.proposals) svc.notes = { proposals: structuredClone(scenario.before.proposals), mixed: [] };
    for (const [k, f] of Object.entries(scenario.before?.files ?? {})) {
      svc.slots[k].push({ version: 1, title: f.title ?? "", body: f.body, tokens: tok(f.body), evidence: [], day: f.day ?? null });
    }
    for (const [n, night] of scenario.nights.entries()) {
      svc.give(nightRows(n, night));
      const start = svc.seen.length;
      const model = fixtureModel(night.answers);
      const res = await mem.sleep("u", { llm: model.caller, prompt: scenario.prompt, today: night.today, settings: settingsOf(scenario) });
      checkNight(scenario, n, night, res, svc, start, model.calls.filter(([system]) => system.includes(" you read part ")).map(([, user]) => user),
        model.calls.map(([system, user]) => `${system}\n${user}`));
    }
  }
});

test("sleep attacks: the rule of the by-name scenario gives the length each match needs", () => {
  const { rule } = FIX.scenarios.find((s) => s.name === "a-person-is-spoken-of-by-name-not-by-a-piece-of-one");
  for (const says of ["its name with something joined to its end when the name has two letters or more",
    "the first three letters or more of its name", "a longer topic that starts with a one-letter name"]) {
    assert.ok(rule.includes(says), `the rule says ${JSON.stringify(says)}: ${rule}`);
  }
});

test("sleep attacks: a caller that sends its key to Wontopos is refused before anything is sent", async (t) => {
  const night = FIX.provider_night;
  for (const c of FIX.provider_hosts) {
    const refused = c.refused;
    for (const slot of ["llm", "mergeLlm"]) {
      const [svc, mem, base] = await served(t);
      svc.give(nightRows(0, night));
      const url = c.url === "$client" ? base : c.url;
      const hostile = fixtureModel(night.answers, url);
      const plain = fixtureModel(night.answers);
      const opts = slot === "llm" ? { llm: hostile.caller } : { llm: plain.caller, mergeLlm: hostile.caller };
      const where = `${c.url} as ${slot}`;
      if (refused) {
        await assert.rejects(mem.sleep("u", { today: night.today, ...opts }), /Wontopos host|this client's baseUrl/, where);
        assert.deepEqual(svc.seen, [], `${where}: nothing was sent`);
        assert.deepEqual([...hostile.calls, ...plain.calls], [], `${where}: no model was called`);
      } else {
        const res = await mem.sleep("u", { today: night.today, ...opts });
        assert.deepEqual(res.written, { 0: 1 }, where);
        assert.ok(hostile.calls.length > 0, where);
      }
    }
    if (c.url !== "$client") {
      for (const make of [() => anthropicCaller({ apiKey: PROVIDER_KEY, baseUrl: c.url }),
        () => openaiCaller({ baseUrl: c.url, apiKey: PROVIDER_KEY, model: "m" })]) {
        if (refused) assert.throws(make, /Wontopos host/, c.url);
        else make();
      }
    }
  }
});

test("sleep attacks: a caller that sends its key where this client sends its own is refused", async () => {
  const night = FIX.provider_night;
  for (const c of FIX.client_bases) {
    for (const slot of ["llm", "mergeLlm"]) {
      const mem = new Client({ apiKey: KEY, baseUrl: c.client });
      const hostile = fixtureModel(night.answers, c.url);
      const plain = fixtureModel(night.answers);
      const opts = slot === "llm" ? { llm: hostile.caller } : { llm: plain.caller, mergeLlm: hostile.caller };
      await assert.rejects(mem.sleep("u", { today: night.today, ...opts }), /this client's baseUrl/, `${c.url} as ${slot}`);
      assert.deepEqual([...hostile.calls, ...plain.calls], [], "no model was called");
    }
  }
});

test("sleep attacks: the provider key goes to the provider, and the Wontopos key to Wontopos", async (t) => {
  const night = FIX.provider_night;
  for (const kind of ["anthropic", "openai"]) {
    const [svc, mem] = await served(t);
    const prov = await provider(t, night.answers, kind);
    svc.give(nightRows(0, night));
    const heard = [];
    const res = await mem.sleep("u", { llm: prov.caller, today: night.today, progress: (line) => heard.push(line) });
    assert.deepEqual(res.written, { 0: 1 });
    assert.ok(prov.seen.length >= 3, "read, merge and tidy went to the provider");
    for (const x of prov.seen) {
      if (kind === "anthropic") {
        assert.equal(x.headers["x-api-key"], PROVIDER_KEY);
        assert.ok(!("authorization" in x.headers));
      } else {
        assert.equal(x.headers.authorization, `Bearer ${PROVIDER_KEY}`);
        assert.ok(!("x-api-key" in x.headers));
      }
      assert.ok(!x.raw.includes(KEY), "the Wontopos key never goes to the provider");
    }
    assert.ok(svc.seen.length > 0);
    for (const x of svc.seen) {
      assert.equal(x.headers["x-api-key"], KEY);
      assert.ok(!JSON.stringify([x.headers, x.body]).includes(PROVIDER_KEY), "the provider key never goes to Wontopos");
    }
    assertQuiet(heard, res.log, []);
  }
});

test("sleep attacks: a redirect from the provider is not followed with the key", async (t) => {
  const night = FIX.provider_night;
  const [svc, mem, base] = await served(t);
  const prov = await provider(t, night.answers, "anthropic", { redirect: `${base}/api/v1/memory/self` });
  svc.give(nightRows(0, night));
  const e = await mem.sleep("u", { llm: prov.caller, today: night.today }).then(() => null, (x) => x);
  assert.ok(e instanceof ModelCallError, String(e));
  assert.match(e.message, /redirect refused/);
  assert.equal(prov.seen.length, 1, "not tried again");
  for (const x of svc.seen) assert.ok(!JSON.stringify([x.headers, x.body]).includes(PROVIDER_KEY));
  assert.ok(!svc.seen.some((x) => x.path.endsWith("/self/write")));
});

test("sleep attacks: progress, the log and errors carry no key, and no memory outside a failed answer", async (t) => {
  const night = FIX.provider_night;
  let [svc, mem] = await served(t);
  let prov = await provider(t, night.answers, "anthropic", { fail: [400, { error: { type: "invalid_request_error", message: "bad request" } }] });
  svc.give(nightRows(0, night));
  let heard = [];
  let e = await mem.sleep("u", { llm: prov.caller, today: night.today, progress: (l) => heard.push(l) }).then(() => null, (x) => x);
  assert.ok(e instanceof ModelCallError, String(e));
  assertQuiet(heard, [], [e]);
  [svc, mem] = await served(t);
  prov = await provider(t, night.answers, "anthropic");
  svc.give(nightRows(0, night));
  svc.fail = [["/api/v1/memory/self/write", 400, { error: { code: "self_evidence_unknown", message: "evidence the sleep was not handed" } }]];
  heard = [];
  e = await mem.sleep("u", { llm: prov.caller, today: night.today, progress: (l) => heard.push(l) }).then(() => null, (x) => x);
  assert.ok(e instanceof BadRequestError, String(e));
  assertQuiet(heard, [], [e]);
  [svc, mem] = await served(t);
  prov = await provider(t, night.answers, "anthropic", { raw: night.unparsable });
  svc.give(nightRows(0, night));
  heard = [];
  const res = await mem.sleep("u", { llm: prov.caller, today: night.today, progress: (l) => heard.push(l) });
  const failed = res.log.filter((x) => x.failed);
  assert.deepEqual(failed.map((x) => x.call), ["read 1", "read 1 again 2", "read 1 again 3"]);
  assert.ok(failed.every((x) => x.head === night.unparsable));
  assertQuiet(heard, res.log.filter((x) => !x.failed), []);
  for (const x of failed) for (const secret of [PROVIDER_KEY, KEY]) assert.ok(!JSON.stringify(x).includes(secret));
});

function assertQuiet(progress, log, errors) {
  const night = FIX.provider_night;
  const said = [...progress, ...log.map((x) => JSON.stringify(x)), ...errors.flatMap((e) => [String(e), e.message, e.stack ?? "", inspect(e)])];
  for (const s of said) {
    for (const secret of [PROVIDER_KEY, KEY, night.memory_marker, night.answer_marker]) assert.ok(!s.includes(secret), `${JSON.stringify(secret)} in ${JSON.stringify(s.slice(0, 200))}`);
  }
}
