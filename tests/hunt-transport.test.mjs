import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Session } from "node:inspector";
import { Client, ConflictError, ModelCallError, WosError, anthropicCaller, openaiCaller } from "../dist/wontopos.js";

const KEY = "wos-test-xxxxxxxxxx";

function scriptedServer(script) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, path: req.url, headers: req.headers, body });
      const [status, headers, payload] = script[seen.length - 1] ?? [200, {}, "{}"];
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(payload);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test("a long request id and type are cut as Python and Rust cut them", async () => {
  const body = JSON.stringify({ error: { type: "t".repeat(1000), message: "bad key", request_id: "r".repeat(1000) } });
  const typeOnly = JSON.stringify({ error: { type: "t".repeat(1000) } });
  const cutId = `${"r".repeat(256)}\u{2026}(truncated)`;
  const cutType = `${"t".repeat(256)}\u{2026}(truncated)`;
  const { server, base } = await scriptedServer([[401, {}, body], [401, {}, typeOnly]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.stats("alice"), (e) => {
      assert.deepEqual([e.status, e.requestId, e.type], [401, cutId, cutType]);
      assert.equal(e.message, `[401] bad key (request_id: ${cutId})`);
      return true;
    });
    await assert.rejects(mem.stats("alice"), (e) => {
      assert.deepEqual([e.message, e.type], [`[401] ${"t".repeat(1000)}`, cutType]);
      return true;
    });
  } finally {
    server.close();
  }
});

test("a bad key names the same fault as Python and Rust", () => {
  for (const [key, want] of [
    ["wos-abc\ndef", "apiKey contains whitespace"],
    ["wos-abc\u{a0}def", "apiKey contains whitespace"],
    ["wos-abc\u{85}def", "apiKey contains a non-ASCII character"],
    ["wos-abc\u{1}def", "apiKey contains a control character"],
  ]) {
    assert.throws(() => new Client({ apiKey: key }), (e) => e.message.startsWith(want), JSON.stringify(key));
  }
});

test("a blank answer is an empty body, not invalid JSON, as in Python and Rust", async () => {
  const { server, base } = await scriptedServer([[200, {}, "  \r\n"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0 });
    await assert.rejects(mem.stats("alice"), (e) => e.message.startsWith("[200] empty response body "));
  } finally {
    server.close();
  }
});

test("a 409 asking for an endless wait is a conflict, not retried", async () => {
  const body = `{"error":{"type":"conflict_error","message":"busy","retry_after_ms":${"9".repeat(400)}}}`;
  const { server, seen, base } = await scriptedServer([[409, {}, body]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.add("x", "alice"), (e) => e instanceof ConflictError && e.message === "[409] busy");
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("a number JSON cannot carry is refused before sending, as in Python", async () => {
  const { server, seen, base } = await scriptedServer([]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const bad of [NaN, Infinity, -Infinity]) {
      await assert.rejects(mem.add("x", "alice", { category: bad }), /request body could not be serialized/, String(bad));
      await assert.rejects(mem.search("q", "alice", 10, { filters: { min_importance: bad } }), Error, String(bad));
    }
    assert.equal(seen.length, 0);
  } finally {
    server.close();
  }
});

test("a number JSON cannot carry in an answer is refused", async () => {
  const past = "[200] invalid JSON in response: a number past the range of a JSON number";
  const bodies = [
    ['{"total_memories": NaN}', undefined], ['{"total_memories": Infinity}', undefined],
    ['{"total_memories": -Infinity}', undefined], ['{"total_memories": 1e999}', past],
    ['{"total_memories": -1e999}', past], [`{"total_memories": ${"9".repeat(400)}}`, past],
    ['{"rows": [{"at": 1, "score": 1e999}]}', past],
  ];
  const fine = '{"total_memories": 2.5, "largest": 1e300}';
  const { server, seen, base } = await scriptedServer([...bodies.map(([b]) => [200, {}, b]), [200, {}, fine]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0 });
    for (const [body, said] of bodies) {
      await assert.rejects(mem.stats("alice"), (e) => {
        assert.ok(e instanceof WosError, `${body}: ${e}`);
        assert.ok(e.message.startsWith("[200] invalid JSON in response: "), `${body}: ${e.message}`);
        if (said !== undefined) assert.equal(e.message, said, body);
        return true;
      });
    }
    assert.deepEqual(await mem.stats("alice"), { total_memories: 2.5, largest: 1e300 });
    assert.equal(seen.length, bodies.length + 1);
  } finally {
    server.close();
  }
});

test("a failed model call leaves its key in no local variable of the frames that raise", async () => {
  const key = `sk-ant-${"Z9".repeat(30)}TAIL`;
  const session = new Session();
  session.connect();
  const held = [];
  const note = (frame, name, value) => {
    if (typeof value === "string" && value.includes(key)) held.push(`${frame.functionName || "(anonymous)"}: ${name}`);
  };
  session.on("Debugger.paused", ({ params }) => {
    for (const frame of params.callFrames) {
      for (const scope of frame.scopeChain.filter((s) => s.type === "local")) {
        session.post("Runtime.getProperties", { objectId: scope.object.objectId, ownProperties: true }, (_e, locals) => {
          for (const p of locals?.result ?? []) {
            note(frame, p.name, p.value?.value);
            if (p.value?.type !== "object" || !p.value.objectId) continue;
            session.post("Runtime.getProperties", { objectId: p.value.objectId, ownProperties: true }, (_e2, inner) => {
              for (const q of inner?.result ?? []) note(frame, `${p.name}.${q.name}`, q.value?.value);
            });
          }
        });
      }
    }
  });
  const refuse = async () => new Response(JSON.stringify({ error: { type: "authentication_error", message: "bad key" } }), { status: 401 });
  const callers = [
    anthropicCaller({ apiKey: key, fetch: refuse }),
    openaiCaller({ baseUrl: "https://llm.example/v1", model: "m", apiKey: key, fetch: refuse }),
  ];
  session.post("Debugger.enable");
  session.post("Debugger.setPauseOnExceptions", { state: "all" });
  try {
    for (const caller of callers) {
      const call = { purpose: "skill", model: "m", system: ["s"], user: "hi", maxTokens: 10, signal: new AbortController().signal };
      await assert.rejects(caller.call(call), ModelCallError);
    }
  } finally {
    session.post("Debugger.disable");
    session.disconnect();
  }
  assert.deepEqual(held, []);
});

test("an out-of-range tz is shown as JavaScript shows it", () => {
  for (const [tz, shown] of [[Infinity, "Infinity"], [-Infinity, "-Infinity"], [1e300, "1e+300"]]) {
    assert.throws(() => new Client({ apiKey: KEY, tz }), (e) => e.message.endsWith(`got ${shown}.`), String(tz));
  }
});

test("a long retry budget keeps waiting about 8s", () => {
  const mem = new Client({ apiKey: KEY });
  for (const attempt of [4, 1023, 1024, 1e6]) {
    const ms = mem.backoffMs(attempt);
    assert.ok(ms >= 8000 && ms <= 8250, `${attempt}: ${ms}`);
  }
});

test("an error's text loses the C1 controls and the Unicode line separators too", async () => {
  const body = JSON.stringify({ error: { type: "ty\u0085pe", message: "a\u0085b\u009bc d e\u001bf", request_id: "r\u009d1" } });
  const { server, base } = await scriptedServer([[400, {}, body]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0 });
    await assert.rejects(mem.stats("alice"), (e) => {
      assert.deepEqual([e.status, e.requestId, e.type], [400, "r1", "type"]);
      assert.equal(e.message, "[400] abcdef (request_id: r1)");
      return true;
    });
  } finally {
    server.close();
  }
});

test("a picture's type is one bare type and subtype, or octet-stream", async () => {
  const cases = [
    ["image/png", "image/png"],
    ["IMAGE/JPEG; charset=binary", "image/jpeg"],
    [" image/svg+xml\t", "image/svg+xml"],
    ["text/html; charset=utf-8", "text/html"],
    ["image/x\\..\\..\\Users\\Public\\run.bat", "application/octet-stream"],
    ["image/../../etc", "application/octet-stream"],
    ["image/", "application/octet-stream"],
    ["/png", "application/octet-stream"],
    ["image/.png", "application/octet-stream"],
    ["image/p\u00f1g", "application/octet-stream"],
    ["", "application/octet-stream"],
    ["application/json, image/webp", "image/webp"],
    ["image/png, ../x", "image/png"],
    ['text/plain; title="a,b"', "text/plain"],
    [null, "application/octet-stream"],
  ];
  for (const [given, want] of cases) {
    const fetch = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: given === null ? {} : { "Content-Type": given } });
    const mem = new Client({ apiKey: KEY, baseUrl: "https://api.wontopos.com", fetch });
    const got = await mem.getImage("alice", "11111111-1111-1111-1111-111111111111");
    assert.deepEqual([got.contentType, got.bytes.length], [want, 3], JSON.stringify(given));
  }
});

test("the blanks around a header's value are trimmed in one pass", async () => {
  const { trimBlanks } = await import("../dist/http.js");
  for (const [given, want] of [["", ""], [" \t ", ""], ["\t 91 ", "91"], ["a b", "a b"], [" a \t b\t", "a \t b"], ["\n1\n", "\n1\n"]]) {
    assert.equal(trimBlanks(given), want, JSON.stringify(given));
  }
  const started = performance.now();
  assert.equal(trimBlanks(`x${" ".repeat(400_000)}x`).length, 400_002);
  assert.ok(performance.now() - started < 2_000, `${performance.now() - started} ms`);
});
