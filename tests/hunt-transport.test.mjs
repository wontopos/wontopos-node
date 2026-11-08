import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client, ConflictError } from "../dist/wontopos.js";

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
