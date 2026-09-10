// Offline tests: a scripted localhost HTTP responder, no network, no deps.
// Run from sdk/typescript:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { inspect } from "node:util";
import { readFileSync } from "node:fs";
import { Client, WosError } from "../dist/wontopos.js";
const DIST = new URL("../dist/wontopos.js", import.meta.url).href;

/** Serve `script` responses in order, recording each request. */
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
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const KEY = "wos-test-xxxxxxxxxx";

test("retries 429 then succeeds", async () => {
  const { server, seen, base } = await scriptedServer([
    [429, { "Retry-After": "0" }, '{"error":"rate limited"}'],
    [200, {}, '{"memories":[]}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    assert.deepEqual(await mem.search("q", "alice"), []);
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("search opts cannot override reserved fields (user_id / query / max_results)", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    // An app forwarding untrusted input as opts must not be able to steer the store.
    await mem.search("real-query", "alice", 7, {
      user_id: "evil",
      query: "evil",
      max_results: 999,
      filters: { categories: ["x"] },
    });
    const body = JSON.parse(seen[0].body);
    assert.equal(body.user_id, "alice");
    assert.equal(body.query, "real-query");
    assert.equal(body.max_results, 7);
    assert.deepEqual(body.filters, { categories: ["x"] }); // non-reserved opts still pass through
  } finally {
    server.close();
  }
});

test("POST write is NOT retried on 502 (no duplicate store / double bill)", async () => {
  const { server, seen, base } = await scriptedServer([[502, {}, '{"error":"bad gateway"}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.add("hi", "u"), (e) => e.status === 502);
    assert.equal(seen.length, 1); // no retry on a non-idempotent write
  } finally {
    server.close();
  }
});

test("GET is retried on 503 (idempotent)", async () => {
  const { server, seen, base } = await scriptedServer([
    [503, { "Retry-After": "0" }, "{}"],
    [200, {}, '{"models":[]}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.listModels();
    assert.equal(seen.length, 2); // retried
  } finally {
    server.close();
  }
});

test("maxRetries: NaN falls back to default (still makes the request)", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: NaN });
    assert.deepEqual(await mem.search("q", "u"), []); // not "retries exhausted" with 0 requests
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("uppercase HTTP:// still triggers the plaintext-key warning", () => {
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    new Client({ apiKey: KEY, baseUrl: "HTTP://example.com" });
  } finally {
    console.warn = orig;
  }
  assert.ok(warnings.some((w) => w.includes("unencrypted")));
});

test("fromEnv: empty first env var falls back; opts.apiKey cannot override the env key", () => {
  const env = globalThis.process.env;
  const save = { W: env.WONTOPOS_API_KEY, W2: env.WOS_API_KEY };
  try {
    env.WONTOPOS_API_KEY = "   "; // whitespace/empty must NOT shadow the valid one
    env.WOS_API_KEY = "wos-fromenv-realkey1234";
    const mem = Client.fromEnv({ apiKey: "wos-attacker-override-9999" });
    // toJSON masks the key as wos-...<last4>; the env key's last4 must win.
    assert.ok(mem.toJSON().apiKey.endsWith("1234"));
  } finally {
    if (save.W === undefined) delete env.WONTOPOS_API_KEY;
    else env.WONTOPOS_API_KEY = save.W;
    if (save.W2 === undefined) delete env.WOS_API_KEY;
    else env.WOS_API_KEY = save.W2;
  }
});

test("iterMemories stops when the server repeats a cursor (no infinite loop)", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"memories":[{"id":"1"}],"next_cursor":"C"}'],
    [200, {}, '{"memories":[{"id":"2"}],"next_cursor":"C"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const out = [];
    for await (const m of mem.iterMemories("u", { pageSize: 1 })) out.push(m.id);
    assert.deepEqual(out, ["1", "2"]);
    assert.equal(seen.length, 2); // stopped after the cursor repeated
  } finally {
    server.close();
  }
});

/* The ordinary end of a walk is not an error, and for `iterImages` it was.
 *
 * The MAX_PAGES backstop throws "the store did not end". `iterImages` left its
 * loop with `break` when the server said there was no more, and a `break` in
 * JavaScript falls into the statement after the loop — which is that throw. So
 * every complete walk of every store ended in an exception saying the opposite
 * of what had happened. Eighty-one tests passed over it: `iterMemories` was
 * covered and its twin was not.
 *
 * One test per walk, both ends. */
test("the v6 loopback is loopback — no plaintext warning", () => {
  // `new URL("http://[::1]:1").hostname` is "[::1]", brackets included, and the
  // loopback set holds "::1". So a client on the v6 loopback was warned
  // that its key travelled in cleartext, which was false. Python and Rust both strip
  // the brackets; this was the copy that did not.
  const warns = [];
  const save = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    new Client({ apiKey: KEY, baseUrl: "http://[::1]:8080" });
    new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:8080" });
    assert.deepEqual(warns, [], `loopback must not warn: ${warns.join(" | ")}`);
    new Client({ apiKey: KEY, baseUrl: "http://example.com" });
    assert.equal(warns.length, 1, "a real host still warns");
  } finally {
    console.warn = save;
  }
});

test("a control character in the API key is refused here, not at the network", () => {
  // `/\s/` misses NUL, 0x01 and DEL. Python and Rust both refuse them; this client
  // let them into the header, where fetch fails with a 401 that says nothing.
  for (const bad of ["wos-live-\u0000abc", "wos-live-\u0001abc", "wos-live-\u007fabc"]) {
    assert.throws(() => new Client({ apiKey: bad }), /control character/, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => new Client({ apiKey: KEY }));
});

test("a search count outside 5..20 is refused, not adjusted", async () => {
  // `recall` has always been 5..20 and the service refuses anything else. Search
  // had no contract: the three clients sent whatever they were given, the MCP
  // server allowed 1..60, and the service capped at 50 with no floor. Both ends,
  // and every search method — a guard in one of three call sites is the shape of
  // bug this package has shipped before.
  const { server, seen, base } = await scriptedServer([]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const bad of [0, 1, 4, 21, 50, 100]) {
      for (const call of [
        () => mem.search("q", "alice", bad),
        () => mem.searchFull("q", "alice", bad),
        () => mem.searchSelf("q", "alice", bad),
      ]) {
        await assert.rejects(call, (e) => /between 5 and 20/.test(e.message), `limit ${bad}`);
      }
    }
    assert.equal(seen.length, 0, "nothing may reach the network");
  } finally {
    server.close();
  }
});

test("iterImages ends without throwing when the store ends", async () => {
  const { server, base } = await scriptedServer([
    [200, {}, '{"images":[{"id":"i1"}],"has_more":true,"next_before":"B1"}'],
    [200, {}, '{"images":[{"id":"i2"}],"has_more":false}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const out = [];
    for await (const m of mem.iterImages("u", { pageSize: 1 })) out.push(m.id);
    assert.deepEqual(out, ["i1", "i2"]);
  } finally {
    server.close();
  }
});

test("iterImages stops when the server repeats a cursor", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"images":[{"id":"i1"}],"has_more":true,"next_before":"B"}'],
    [200, {}, '{"images":[{"id":"i2"}],"has_more":true,"next_before":"B"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const out = [];
    for await (const m of mem.iterImages("u", { pageSize: 1 })) out.push(m.id);
    assert.deepEqual(out, ["i1", "i2"]);
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("timeout applies to a hung response BODY, not just headers", async () => {
  // Server writes headers + a partial body, then never finishes → the read must
  // time out rather than hang forever.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "100" });
    res.write("{"); // partial body, never ended
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, timeoutMs: 150, maxRetries: 0 });
    await assert.rejects(mem.search("q", "u"), (e) => /timed out/.test(e.message));
  } finally {
    server.close();
  }
});

test("deleteAll rejects blank/whitespace userId (would wipe the default store)", () => {
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9" });
  for (const uid of ["", " ", "\t", "\n", "   "]) {
    assert.throws(() => mem.deleteAll(uid), /non-blank/);
  }
});

test("maxRetries: 0 disables retries", async () => {
  const { server, seen, base } = await scriptedServer([
    [429, { "Retry-After": "0" }, '{"error":"rate limited"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0 });
    await assert.rejects(mem.stats(), (e) => e instanceof WosError && e.status === 429);
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("no retry on 400; parses envelope + requestId", async () => {
  const { server, seen, base } = await scriptedServer([
    [400, {}, JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "boom", request_id: "req_123" } })],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.stats(), (e) => {
      assert.ok(e instanceof WosError);
      assert.equal(e.status, 400);
      assert.match(e.message, /boom/);
      assert.equal(e.requestId, "req_123");
      return true;
    });
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("refuses redirects", async () => {
  const { server, base } = await scriptedServer([[302, { Location: "http://evil.example/" }, ""]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.stats(), (e) => e instanceof WosError && e.status === 302 && /redirect/.test(e.message));
  } finally {
    server.close();
  }
});

test("delete requires memoryId; deleteAll/deleteStore require userId", async () => {
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9" }); // never reached
  assert.throws(() => mem.delete("alice", ""), /memoryId is required/);
  assert.throws(() => mem.delete("alice", undefined), /memoryId is required/);
  assert.throws(() => mem.deleteAll(""), /userId is required/);
  assert.throws(() => mem.deleteStore(""), /userId is required/);
});

test("key is masked in toJSON and inspect", () => {
  const mem = new Client({ apiKey: "wos-live-supersecretkeyvalue1234" });
  const j = JSON.stringify(mem);
  assert.ok(!j.includes("supersecretkeyvalue"));
  assert.ok(j.includes("1234"));
  const i = inspect(mem);
  assert.ok(!i.includes("supersecretkeyvalue"));
});

test("sends model + User-Agent headers", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, model: "scroll-1" });
    await mem.stats();
    assert.equal(seen[0].headers["x-wos-model"], "scroll-1");
    assert.match(seen[0].headers["user-agent"], /^wontopos-node\/2\./);
  } finally {
    server.close();
  }
});

// ----- security round 2 -----

test("key hygiene: trims, rejects inner whitespace", () => {
  const mem = new Client({ apiKey: " wos-test-xxxxxxxxxx\n", baseUrl: "http://127.0.0.1:9" });
  assert.ok(JSON.stringify(mem).includes("wos-"));
  assert.throws(() => new Client({ apiKey: "wos-test xxxxxxxxxx" }), /whitespace/);
  assert.throws(() => new Client({ apiKey: "   " }), /required/);
});

test("model name validation", () => {
  assert.throws(
    () => new Client({ apiKey: KEY, model: "tablet-1\r\nX-Evil: 1" }),
    /invalid model name/
  );
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9" });
  assert.throws(() => mem.withModel("bad model"), /invalid model name/);
});

test("fromEnv reads WONTOPOS_API_KEY", () => {
  const old = process.env.WONTOPOS_API_KEY;
  try {
    process.env.WONTOPOS_API_KEY = "wos-test-envkey12345";
    const mem = Client.fromEnv({ userId: "alice" });
    assert.equal(mem.toJSON().userId, "alice");
    delete process.env.WONTOPOS_API_KEY;
    delete process.env.WOS_API_KEY;
    assert.throws(() => Client.fromEnv(), /WONTOPOS_API_KEY/);
  } finally {
    if (old !== undefined) process.env.WONTOPOS_API_KEY = old;
  }
});

test("refuses oversized responses (content-length)", async () => {
  const { server, base } = await scriptedServer([
    [200, { "Content-Length": String(65 * 1024 * 1024) }, "{}"],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.stats(), (e) => e instanceof WosError && /too large/.test(e.message));
  } finally {
    server.close();
  }
});

// ----- 2.2.14: connection-error retry gating (no double-fired writes) -----

/** Raw TCP server that destroys every connection on first data (a mid-stream drop). */
function droppingServer() {
  const conns = [];
  const server = net.createServer((sock) => {
    conns.push(1);
    sock.on("data", () => sock.destroy());
    sock.on("error", () => {});
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, conns, base: `http://127.0.0.1:${server.address().port}` })
    )
  );
}

test("POST is NOT retried on a mid-stream connection drop (no double store / bill)", async () => {
  const { server, conns, base } = await droppingServer();
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 1 });
    await assert.rejects(mem.add("hi", "u"), (e) => e instanceof WosError && e.status === 0);
    assert.equal(conns.length, 1); // exactly one attempt — the write may have landed
  } finally {
    server.close();
  }
});

test("GET IS retried on a mid-stream connection drop (idempotent)", async () => {
  const { server, conns, base } = await droppingServer();
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 1 });
    await assert.rejects(mem.listModels(), (e) => e instanceof WosError && e.status === 0);
    assert.equal(conns.length, 2); // dropped once, then retried
  } finally {
    server.close();
  }
});

test("POST to a refused port IS retried (connect-level — the request never left)", async () => {
  // Grab a port with no listener: bind, note the port, close.
  const tmp = net.createServer();
  await new Promise((r) => tmp.listen(0, "127.0.0.1", r));
  const port = tmp.address().port;
  await new Promise((r) => tmp.close(r));
  const mem = new Client({ apiKey: KEY, baseUrl: `http://127.0.0.1:${port}`, maxRetries: 1 });
  const t0 = Date.now();
  await assert.rejects(mem.add("hi", "u"), (e) => e instanceof WosError && e.status === 0);
  // The second attempt is separated by a ≥500ms backoff — its presence proves the retry.
  assert.ok(Date.now() - t0 >= 450, `elapsed ${Date.now() - t0}ms — expected a retry backoff`);
});

test("timeoutMs: NaN falls back to default (request still succeeds)", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, timeoutMs: NaN });
    assert.deepEqual(await mem.search("q", "u"), []);
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("2xx with a corrupt JSON body surfaces as WosError, not a raw SyntaxError", async () => {
  const { server, base } = await scriptedServer([[200, {}, "not valid json{"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.stats(), (e) => e instanceof WosError && /invalid JSON/.test(e.message));
  } finally {
    server.close();
  }
});

// ----- pending release: per-call tuning clones + debug logging -----

test("withRetries(0) disables retries on the clone", async () => {
  const { server, seen, base } = await scriptedServer([
    [429, { "Retry-After": "0" }, '{"error":"rate limited"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base }); // default retries: 2
    await assert.rejects(mem.withRetries(0).stats(), (e) => e instanceof WosError && e.status === 429);
    assert.equal(seen.length, 1); // the clone did not retry
  } finally {
    server.close();
  }
});

test("withTimeout applies to the clone (hung body times out)", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "100" });
    res.write("{"); // partial body, never ended
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0 }); // default 30s timeout
    await assert.rejects(mem.withTimeout(150).search("q", "u"), (e) => /timed out/.test(e.message));
  } finally {
    server.close();
  }
});

test("WONTOPOS_LOG=debug logs status/timing but never content or the key", async () => {
  const { server, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  const lines = [];
  const origErr = console.error;
  const origEnv = process.env.WONTOPOS_LOG;
  console.error = (m) => lines.push(String(m));
  process.env.WONTOPOS_LOG = "debug";
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.search("super secret query text", "u");
  } finally {
    console.error = origErr;
    if (origEnv === undefined) delete process.env.WONTOPOS_LOG;
    else process.env.WONTOPOS_LOG = origEnv;
    server.close();
  }
  assert.ok(lines.some((l) => l.includes("POST /api/v1/memory/search -> 200")), lines.join("\n"));
  assert.ok(!lines.join("\n").includes("super secret query text"));
  assert.ok(!lines.join("\n").includes(KEY));
});

test("get() fetches one memory by id and unwraps it; empty id throws before the network", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"user_id":"u","memory":{"id":"9b2d","content":"tea","is_superseded":false}}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const m = await mem.get("u", "9b2d");
    assert.equal(m.content, "tea");
    assert.equal(JSON.parse(seen[0].body).memory_id, "9b2d");
    assert.throws(() => mem.get("u", ""), /memoryId is required/);
  } finally {
    server.close();
  }
});

test("a hostile server's giant error body is capped in the message", async () => {
  const { server, base } = await scriptedServer([[400, {}, JSON.stringify({ error: "Z".repeat(100000) })]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.stats(), (e) => {
      assert.ok(e.message.length <= 4096 + 40);
      assert.match(e.message, /truncated/);
      return true;
    });
  } finally {
    server.close();
  }
});

test("redirect refusal cancels the response body (no stream leak)", async () => {
  const { server, base } = await scriptedServer([[302, { Location: "http://evil.example/" }, "x".repeat(1000)]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.stats(), (e) => e instanceof WosError && e.status === 302);
  } finally {
    server.close();
  }
});

test("a non-object 2xx body (null / number / string / array) is a WosError, not a crash", async () => {
  for (const body of ["null", "12345", '"hi"', "[1,2,3]"]) {
    const { server, base } = await scriptedServer([[200, {}, body]]);
    try {
      const mem = new Client({ apiKey: KEY, baseUrl: base });
      await assert.rejects(mem.search("q", "u"), (e) => e instanceof WosError && /object/.test(e.message));
      const r2 = await scriptedServer([[200, {}, body]]);
      await assert.rejects(new Client({ apiKey: KEY, baseUrl: r2.base }).get("u", "id"), (e) => e instanceof WosError);
      r2.server.close();
    } finally {
      server.close();
    }
  }
});

test("typed responses: search returns Memory[], listSpeakers always has speakers[]", async () => {
  const { server, base } = await scriptedServer([
    [200, {}, '{"memories":[{"id":"m1","content":"c","similarity":0.9,"speaker":"Bob","time_bucket":"2026-07"}]}'],
    [200, {}, '{"count":0,"limit":50}'], // speakers field absent -> defaulted
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const hits = await mem.search("q");
    assert.equal(hits[0].speaker, "Bob");
    assert.equal(hits[0].time_bucket, "2026-07");
    assert.equal(hits[0].similarity, 0.9); // the relevance field is `similarity`, not `score`
    const speakers = await mem.listSpeakers();
    assert.deepEqual(speakers.speakers, []);
    assert.equal(speakers.limit, 50);
  } finally {
    server.close();
  }
});

test("revisions goes to the Won surface, not the memory plane", async () => {
  // Won is a separate address, not a rename: calls a model makes ABOUT its memory live
  // under /api/v1/won/*. The old /memory path still answers, so a drift back here fails
  // nothing at runtime — it just makes the docs teach an address the SDK never calls.
  const { server, seen, base } = await scriptedServer([[200, {}, '{"revised":3,"total":40}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const r = await mem.revisions("alice");
    assert.equal(r.revised, 3);
    assert.equal(seen[0].path, "/api/v1/won/revisions");
  } finally {
    server.close();
  }
});

test("recall limit and context_limit travel under their wire names", async () => {
  // The engine has taken both since tablet-2 (5-20 / 0-20), but they were in neither the
  // spec nor the SDKs, so only someone writing raw HTTP could reach them. Pinned here
  // while the three layers were brought into line.
  const { server, seen, base } = await scriptedServer([[200, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.recall("q", "alice", { limit: 20, context_limit: 0 });
    const body = JSON.parse(seen[0].body);
    assert.equal(body.limit, 20);
    // 0 means "attach no context", so dropping it as falsy silently restores the
    // default of 10.
    assert.equal(body.context_limit, 0);
    assert.equal(body.user_id, "alice");
  } finally {
    server.close();
  }
});

test("recall sends neither key when they are not asked for", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.recall("q", "alice");
    const body = JSON.parse(seen[0].body);
    // Sending what was never passed draws a 403 from a model that does not know limit —
    // a caller who changed nothing is suddenly refused.
    assert.ok(!("limit" in body) && !("context_limit" in body), JSON.stringify(body));
  } finally {
    server.close();
  }
});

test("verify and max_images travel as named search options", async () => {
  // Both could already be sent through the pass-through (`[key: string]: unknown`).
  // Unnamed, they just never appeared in autocomplete and no typo was caught. Now that
  // they are named, pin that they actually go out.
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.search("q", "alice", 10, { verify: 2, max_images: 5 });
    const body = JSON.parse(seen[0].body);
    assert.equal(body.verify, 2);
    assert.equal(body.max_images, 5);
    // Reserved fields sit on top of opts — search already orders them that way.
    assert.equal(body.user_id, "alice");
    assert.equal(body.max_results, 10);
  } finally {
    server.close();
  }
});

// These three protect one property: **the response to this call stays the same size
//   for a store of a hundred million memories.** No assertion on a value can catch that;
//   only looking at what was NOT sent can.
test("revisions asks for counts only unless a page is requested", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"revised":3,"unrevised":37,"total":40}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.revisions("alice");
    const body = JSON.parse(seen[0].body);
    // With no include the engine attaches no list. The moment the SDK slips one in as a
    // default, calls that requested nothing start carrying twenty rows.
    assert.deepEqual(Object.keys(body).sort(), ["user_id"],
      "a default call carried include/limit — a list nobody asked for rides along");
  } finally {
    server.close();
  }
});

test("revisions maps the page options onto the wire names", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.revisions("alice", {
      include: "unrevised",
      limit: 20,
      before: "2026-08-20T01:00:00Z",
      skipIds: ["11111111-1111-1111-1111-111111111111"],
    });
    const body = JSON.parse(seen[0].body);
    assert.equal(body.include, "unrevised");
    assert.equal(body.limit, 20);
    assert.equal(body.before, "2026-08-20T01:00:00Z");
    // The cursor goes out as snake_case. Leak camelCase and the engine reads "no
    // cursor", and the caller gets **page one forever** — without an error.
    assert.deepEqual(body.skip_ids, ["11111111-1111-1111-1111-111111111111"]);
    assert.ok(!("skipIds" in body), "skipIds went out as-is — the cursor does nothing");
  } finally {
    server.close();
  }
});

test("revisions opts cannot take over the store id", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    // The JS example for `search` put `...opts` last and so allowed exactly this. Here
    // user_id is written last, so it must not be overridable.
    await mem.revisions("alice", { user_id: "bob", include: "revised" });
    assert.equal(JSON.parse(seen[0].body).user_id, "alice",
      "opts swapped the store out — that is a path to reading someone else's");
  } finally {
    server.close();
  }
});

test("searchSelf returns both fields from one call; missing/null self_memories -> []", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"memories":[{"id":"m1"}],"self_memories":[{"id":"s1"}]}'],
    [200, {}, '{"memories":[{"id":"m2"}],"self_memories":null}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const r = await mem.searchSelf("q", "alice");
    assert.deepEqual(r.memories.map((m) => m.id), ["m1"]);
    assert.deepEqual(r.self_memories.map((m) => m.id), ["s1"]);
    assert.equal(seen.length, 1); // one round-trip
    assert.equal(seen[0].path, "/api/v1/memory/search");
    const r2 = await mem.searchSelf("q", "u"); // non-self model: self_memories null -> []
    assert.deepEqual(r2.self_memories, []);
    assert.deepEqual(r2.memories.map((m) => m.id), ["m2"]);
  } finally {
    server.close();
  }
});

test("bad elements inside a record array are skipped, valid records survive", async () => {
  // The CONTAINER guard (memories is an array) is not enough: a hostile or broken
  // server can put non-objects INSIDE it. Unfiltered, those reach the caller typed as
  // Memory[], so the first `m.content` threw a raw TypeError from inside user code.
  const { server, base } = await scriptedServer([
    [200, {}, '{"memories":[null,1,"x",[],{"id":"ok","content":"c"}]}'],
    [200, {}, '{"memories":[null,{"id":"m1"}],"self_memories":[2,{"id":"s1"}]}'],
    [200, {}, '{"turns":[null,"x",{"role":"user"}]}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    assert.deepEqual((await mem.search("q", "u")).map((m) => m.id), ["ok"]);
    const r = await mem.searchSelf("q", "u");
    assert.deepEqual(r.memories.map((m) => m.id), ["m1"]);
    assert.deepEqual(r.self_memories.map((m) => m.id), ["s1"]);
    assert.deepEqual(await mem.history("u"), [{ role: "user" }]);
  } finally {
    server.close();
  }
});

test("VERSION const matches package.json — the User-Agent is built from it", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  const src = readFileSync(new URL("../src/wontopos.ts", import.meta.url), "utf8");
  const m = src.match(/const VERSION = "([^"]+)"/);
  assert.ok(m, "VERSION const should exist in wontopos.ts");
  assert.equal(m[1], pkg.version, `VERSION const (${m[1]}) must match package.json (${pkg.version}) — the User-Agent uses it`);
});

test("search returns BOTH fields — the assistant's own words are not dropped", async () => {
  // Some models answer with the assistant's OWN words in `self_memories`, not
  // repeated in `memories`. search() read
  // only `memories`, so on Scroll 1.2 an assistant turn stored with addTurn was
  // silently missing from search while the same query on tablet-1 returned it —
  // and the dropped memories were already on the wire and already paid for.
  const { server, base } = await scriptedServer([
    [200, {}, '{"memories":[{"id":"m1","content":"partner said this"}],"self_memories":[{"id":"s1","content":"I said this","speaker":"me"},{"id":"m1","content":"dup"}]}'],
    [200, {}, '{"memories":[{"id":"only"}]}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const out = await mem.search("q", "u");
    assert.deepEqual(out.map((m) => m.id), ["m1", "s1"], "both fields, id-deduplicated");
    assert.equal(out[1].speaker, "me", "self_memories keeps its speaker");
    // a model that does not keep them apart is unchanged
    assert.deepEqual((await mem.search("q", "u")).map((m) => m.id), ["only"]);
  } finally {
    server.close();
  }
});

test("internal plumbing is not part of the published type surface", () => {
  // `private` in TypeScript is compile-time: the method still exists on the runtime
  // prototype, so asserting on that proves nothing. What a consumer actually sees is
  // the emitted .d.ts — autocomplete, type errors, docs — so pin that instead.
  const dts = readFileSync(new URL("../dist/wontopos.d.ts", import.meta.url), "utf8");
  for (const internal of ["request", "post", "readCapped", "backoffMs", "uid", "clone"]) {
    assert.match(
      dts,
      new RegExp(`private\\s+(async\\s+)?${internal}\\b`),
      `${internal} should be declared private in the .d.ts`
    );
  }
  assert.match(dts, /\bsearch\(/, "the real surface is still declared");
});

// `retries` (Python) and `maxRetries` (TypeScript) are one option that had two names.
// The docs say the three SDKs ship together as "one surface", yet porting Python to
// TypeScript meant TypeScript ignored the unknown key on the options object at runtime —
// with no error — so **the retry setting vanished silently.** A quiet failure like that
// was never going to be found.
test("retries: the Python name works too, and disables retries when 0", async () => {
  const { server, seen, base } = await scriptedServer([[503, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, retries: 0 });
    await assert.rejects(() => mem.listModels());
    assert.equal(seen.length, 1, "retries:0 must mean one attempt, not the default 3");
  } finally {
    server.close();
  }
});

test("retries: the alias sets the count, not just on/off", async () => {
  const { server, seen, base } = await scriptedServer([[503, {}, "{}"], [503, {}, "{}"], [503, {}, "{}"], [503, {}, "{}"], [503, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, retries: 4 });
    await assert.rejects(() => mem.listModels());
    assert.equal(seen.length, 5, "4 retries = 5 attempts");
  } finally {
    server.close();
  }
});

test("maxRetries wins when both names are given", async () => {
  const { server, seen, base } = await scriptedServer([[503, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0, retries: 9 });
    await assert.rejects(() => mem.listModels());
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

// engram() could run one but never ask what exists. So callers copied names out of the
// docs and hardcoded them, and every engram added afterwards stayed invisible to them.
// MCP dropped its enum for the same reason and asks the service instead (1.0.6).
test("listEngrams: the service is the authority — the list can be asked for", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, JSON.stringify({
    engrams: [{ name: "deep_recall", description: "…" }, { name: "timeline", description: "…" }],
    forms: [{ name: "memoir", description: "…" }],
  })]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const cat = await mem.listEngrams();
    assert.equal(seen[0].method, "GET");
    assert.equal(seen[0].path, "/api/v1/engram");
    assert.deepEqual(cat.engrams.map((e) => e.name), ["deep_recall", "timeline"]);
    assert.deepEqual(cat.forms.map((f) => f.name), ["memoir"]);
  } finally {
    server.close();
  }
});

test("listEngrams: a model with no engrams gives an empty list plus a note", async () => {
  const { server, base } = await scriptedServer([[200, {}, JSON.stringify({
    engrams: [], forms: [], note: "The selected model does not support engrams.",
  })]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const cat = await mem.listEngrams();
    assert.deepEqual(cat.engrams, []);
    assert.match(cat.note ?? "", /does not support/);
  } finally {
    server.close();
  }
});

test("listEngrams: a malformed response still yields an array (so for…of survives)", async () => {
  const { server, base } = await scriptedServer([[200, {}, JSON.stringify({ engrams: "oops", forms: null })]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const cat = await mem.listEngrams();
    assert.deepEqual(cat.engrams, []);
    assert.deepEqual(cat.forms, []);
  } finally {
    server.close();
  }
});

// A write is dropped when a close-enough memory already exists. The field naming what
// it collided with was missing from the types, so a TypeScript user had no way to
// discover the value — it was there at runtime all along.
test("duplicate: duplicate_of arrives as a typed field", async () => {
  const { server, base } = await scriptedServer([[200, {}, JSON.stringify({
    status: "duplicate", duplicate_of: "11111111-2222-4333-8444-555555555555",
  })]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, userId: "u" });
    const r = await mem.add("a memory that overlaps");
    assert.equal(r.status, "duplicate");
    assert.equal(r.duplicate_of, "11111111-2222-4333-8444-555555555555");
    assert.equal(r.id, undefined, "nothing was stored, so there is no id");
  } finally {
    server.close();
  }
});

// The three SDKs treated a body-less response differently: on the same `204 No Content`
// TypeScript succeeded with `{}` while Python and Rust raised "invalid JSON". They ship
// as one surface, so both directions are settled — a body may be absent only when the
// status code says so (204/205/304).
test("204 No Content is a success, not a parse error", async () => {
  const { server, base } = await scriptedServer([[204, {}, ""]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    assert.deepEqual(await mem.delete("alice", "m1"), {});
  } finally {
    server.close();
  }
});

test("an empty 200 is an error, not a silent ok", async () => {
  // Returning `{}` here makes add() read as a success with no id — the caller never
  // sees that the write went missing.
  const { server, base } = await scriptedServer([[200, {}, ""]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.add("x", "alice"), (e) => {
      assert.ok(e instanceof WosError);
      assert.equal(e.status, 200);
      assert.match(e.message, /empty response body/);
      return true;
    });
  } finally {
    server.close();
  }
});

// Pin that the idempotency-key header actually goes out on a write, and that a
// malformed key is refused locally before any request leaves the process.
test("idempotency key rides on the write as a header", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"id":"m1","status":"stored"}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("x", "alice", {}, { idempotencyKey: "import:row-42" });
    assert.equal(seen[0].headers["idempotency-key"], "import:row-42");
  } finally {
    server.close();
  }
});

test("every write can carry a key, and no key means no header", async () => {
  const { server, seen, base } = await scriptedServer(Array(5).fill([200, {}, "{}"]));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("x", "alice", {}, { idempotencyKey: "k1" });
    await mem.addTurn("hi", "yo", "alice", { idempotencyKey: "k2" });
    await mem.addBulk("blob", "alice", "general", undefined, { idempotencyKey: "k3" });
    await mem.update("m1", "new", "alice", { idempotencyKey: "k4" });
    await mem.add("x", "alice");
    assert.deepEqual(
      seen.map((r) => r.headers["idempotency-key"]),
      ["k1", "k2", "k3", "k4", undefined],
    );
  } finally {
    server.close();
  }
});

test("a malformed idempotency key fails BEFORE the request", async () => {
  // A server-side 400 reads as "my write failed" to a caller that was retrying — when it
  // never left the machine. So refuse it locally.
  const { server, seen, base } = await scriptedServer([[200, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const bad of ["caf\u00e9 key", "a".repeat(129), "", "has space"]) {
      await assert.rejects(mem.add("x", "alice", {}, { idempotencyKey: bad }), /invalid idempotencyKey/);
    }
    assert.equal(seen.length, 0, "no request may go out at all");
  } finally {
    server.close();
  }
});

test("search filters reach the API (they were in neither the spec nor any SDK)", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.search("q", "alice", 10, {
      filters: { categories: ["work"], event_from: "2026-01-01", event_to: "2026-06-30" },
    });
    assert.deepEqual(JSON.parse(seen[0].body).filters, {
      categories: ["work"],
      event_from: "2026-01-01",
      event_to: "2026-06-30",
    });
  } finally {
    server.close();
  }
});

// ── 2.2.25: what the attack and bug hunts turned up ─────────────────────────

test("store id collision — warn when two end users fold into one store", async () => {
  // Measured against production: what was stored under alice-smith comes back from a
  // search on alice_smith and on Alice.Smith. In an app with one store per end user,
  // bob.lee@x and bob-lee@x become one person.
  const { _resetStoreIdWarnings } = await import("../dist/wontopos.js");
  const { server, base } = await scriptedServer([[200, {}, "{}"]]);
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    _resetStoreIdWarnings();
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("x", "Alice.Smith");
    assert.equal(warns.length, 1, "exactly one warning");
    assert.match(warns[0], /Alice\.Smith/);
    assert.match(warns[0], /alice_smith/);
    assert.match(warns[0], /share ONE store/);
  } finally {
    console.warn = orig;
    server.close();
  }
});

test("a store id already in normal form stays quiet", async () => {
  const { _resetStoreIdWarnings } = await import("../dist/wontopos.js");
  const { server, base } = await scriptedServer([[200, {}, "{}"]]);
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    _resetStoreIdWarnings();
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("x", "alice_smith");
    assert.deepEqual(warns, [], "warning on the normal form is noise, and noise buries the real one");
  } finally {
    console.warn = orig;
    server.close();
  }
});

test("a typo in filters widens the search silently — warn about it", async () => {
  const { _resetFilterWarnings } = await import("../dist/wontopos.js");
  const { server, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    _resetFilterWarnings();
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.search("q", "alice", 10, { filters: { catagories: ["work"] } });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /catagories/);
    assert.match(warns[0], /NO effect/);
  } finally {
    console.warn = orig;
    server.close();
  }
});

test("a filter key we know draws no warning", async () => {
  const { _resetFilterWarnings } = await import("../dist/wontopos.js");
  const { server, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    _resetFilterWarnings();
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.search("q", "alice", 10, {
      filters: { categories: ["work"], event_from: "2026-01-01", min_importance: 0.5 },
    });
    assert.deepEqual(warns, []);
  } finally {
    console.warn = orig;
    server.close();
  }
});

test("whether an idempotent write was replayed shows up in the result", async () => {
  // The server says so with Idempotent-Replayed; the SDK was swallowing it.
  const { server, base } = await scriptedServer([
    [200, { "Idempotent-Replayed": "true" }, '{"id":"m1","status":"stored"}'],
    [200, {}, '{"id":"m2","status":"stored"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const replayed = await mem.add("x", "alice", {}, { idempotencyKey: "k1" });
    assert.equal(replayed.replayed, true,
      "a replay that is not reported leaves the caller unable to tell whether the retry wrote");
    const fresh = await mem.add("y", "alice");
    assert.equal(fresh.replayed, undefined, "a fresh write must carry no replay marker");
  } finally {
    server.close();
  }
});

test("501 is not retried (pinned by behaviour, not by wording)", async () => {
  const { server, seen, base } = await scriptedServer([
    [501, {}, '{"type":"error","error":{"type":"api_error","message":"no endpoint"}}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 3 });
    await assert.rejects(mem.listMemories("alice"));
    assert.equal(seen.length, 1, "retrying a 501 can never succeed");
  } finally {
    server.close();
  }
});

// --- injected fetch (corporate proxy) ---------------------------------------
// Node's global fetch (undici) ignores HTTP_PROXY. Python (requests) and Rust
// (reqwest) both read it, so behind a proxy only the TS client failed to connect.
// This seam removes that difference — instrumentation and tests use it too.

test("every request goes out through the injected fetch", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    let calls = 0;
    const mem = new Client({
      apiKey: KEY,
      baseUrl: base,
      fetch: (url, init) => {
        calls += 1;
        return fetch(url, init);
      },
    });
    assert.deepEqual(await mem.search("q", "alice"), []);
    assert.equal(calls, 1, "leaking to the global fetch means bypassing the proxy");
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("clones keep the injected fetch", async () => {
  const { server, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    let calls = 0;
    const mem = new Client({
      apiKey: KEY,
      baseUrl: base,
      fetch: (url, init) => {
        calls += 1;
        return fetch(url, init);
      },
    });
    // If withModel/withUser/withTimeout/withRetries fall back to the global, a
    // proxy-bound client silently loses its connection the moment it is cloned.
    await mem.withModel("tablet-1").withUser("bob").withRetries(0).search("q");
    assert.equal(calls, 1, "the clone lost the injected fetch");
  } finally {
    server.close();
  }
});

test("client rules still apply through an injected fetch (retries, redirect refusal)", async () => {
  const { server, seen, base } = await scriptedServer([
    [429, { "Retry-After": "0" }, '{"error":"rate limited"}'],
    [200, {}, '{"memories":[]}'],
  ]);
  try {
    let calls = 0;
    const mem = new Client({
      apiKey: KEY,
      baseUrl: base,
      fetch: (url, init) => {
        calls += 1;
        return fetch(url, init);
      },
    });
    assert.deepEqual(await mem.search("q", "alice"), []);
    assert.equal(calls, 2, "swapping the transport does not switch off the retry rule");
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("a non-function fetch is refused at construction, not at the first call", () => {
  assert.throws(
    () => new Client({ apiKey: KEY, fetch: "nope" }),
    /fetch must be a function/,
    "a bad transport must surface before any request"
  );
});

// --- bound on the store-id warning record ----------------------------------
// The warning fires on ids that fold, i.e. email-shaped ones. But the pattern this
// SDK recommends is one store per end user, so without a cap the record grows one
// entry per user and is never released for the life of the process — a leak in the
// very case the warning describes.
//
// The warning only fires when a request resolves a store (cloning does not do it),
// so the injected fetch stands in for the network: thousands of calls, no sockets.

const canned = () => Promise.resolve(new Response('{"memories":[]}', { status: 200, headers: { "Content-Type": "application/json" } }));

test("the warning record does not grow per end user", async () => {
  const { _resetStoreIdWarnings, Client } = await import(DIST);
  _resetStoreIdWarnings();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", fetch: canned });
    for (let i = 0; i < 3000; i++) await mem.search("q", `user.${i}@example.com`);

    // The set is not exported, so observe behaviour rather than the heap: the very
    // oldest id must have been evicted (warns again) and a recent one must not be.
    let warned = 0;
    console.warn = () => { warned++; };
    await mem.search("q", "user.0@example.com");
    assert.equal(warned, 1, "if the oldest is not evicted, the record grows without bound");
    warned = 0;
    await mem.search("q", "user.2999@example.com");
    assert.equal(warned, 0, "losing recent entries too makes the warning repeat every request");
  } finally {
    console.warn = origWarn;
  }
});

test("an id that does not fold is neither recorded nor warned about", async () => {
  const { _resetStoreIdWarnings, Client } = await import(DIST);
  _resetStoreIdWarnings();
  let warned = 0;
  const origWarn = console.warn;
  console.warn = () => { warned++; };
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", fetch: canned });
    for (let i = 0; i < 100; i++) await mem.search("q", `user_${i}`);
    assert.equal(warned, 0, "an already-canonical id has nothing to warn about");
  } finally {
    console.warn = origWarn;
  }
});

// ── hardening pass, 2026-08-13 ───────────────────────────────────────────────
// Four findings that reproduced. Each is pinned here because each was a guard that
// existed and did not cover the case that mattered.

test("a whitespace memory id cannot become a whole-store wipe", () => {
  // delete_all already trimmed; delete did not. "   " is truthy, so it passed the
  // emptiness check and travelled as memory_id — and a server that trims it back to
  // nothing reads the request as the delete-everything form.
  const mem = new Client({ apiKey: "wos-live-x", userId: "u", baseUrl: "http://127.0.0.1:9" });
  // The guard throws SYNCHRONOUSLY on purpose — the SDK does that so a missing id
  // fails loudly even when the caller forgets to await. assert.rejects would not catch it.
  for (const bad of ["", "   ", "\t\n"]) {
    assert.throws(() => mem.delete("store", bad), /non-blank/);
  }
});

test("a store id that was PASSED but is blank throws instead of using the default", async () => {
  // Omission means "the default" — that is the documented shortcut. A blank string is a
  // caller whose tenant lookup returned nothing, and falling back writes that customer's
  // memories into whatever this client defaults to, silently.
  const mem = new Client({ apiKey: "wos-live-x", userId: "fallback", baseUrl: "http://127.0.0.1:9" });
  // add() is not async, so its guard throws synchronously; search() is async, so the
  // same guard surfaces as a rejection. Both must refuse — the shape differs by method.
  assert.throws(() => mem.add("hi", "  "), /blank/);
  await assert.rejects(() => mem.search("q", ""), /blank/);
});

test("a store id that is not a usable string throws instead of using the default", async () => {
  // The blank-string case was already covered. The value a failed lookup actually
  // produces in JavaScript is `null` — String(null) is the truthy "null", so it walked
  // straight past the old guard and `null || default` sent the write to the client's
  // default store. `0` (an integer primary key) did the same. Both are the outcome the
  // guard exists to prevent, and both were silent.
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      seen.push(JSON.parse(b || "{}").user_id);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, userId: "fallback" });
    for (const bad of [null, 0, 42, false, [], {}]) {
      assert.throws(() => mem.add("hi", bad), /non-blank string/, `add(${JSON.stringify(bad)})`);
    }
    assert.equal(seen.length, 0, "none of them may reach the wire");
    // The documented shortcut must still work: omitted means the client default.
    await mem.add("hi");
    assert.equal(seen.at(-1), "fallback");
    await mem.add("hi", "alice");
    assert.equal(seen.at(-1), "alice");
  } finally {
    server.close();
  }
});

test("the destructive calls refuse a non-string id too", () => {
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", userId: "fallback" });
  for (const bad of [null, 0, undefined, [], {}]) {
    assert.throws(() => mem.deleteAll(bad), /non-blank string/);
    assert.throws(() => mem.deleteStore(bad), /non-blank string/);
  }
});

test("the API key does not survive an object spread", async () => {
  // TypeScript `private` is erased at runtime. The masking covered JSON.stringify(client)
  // and inspect(client), but structured logging usually spreads the object first, and
  // {...client} copied both the key and the prepared auth header in the clear.
  const mem = new Client({ apiKey: "wos-live-SECRETVALUE", userId: "u", baseUrl: "http://127.0.0.1:9" });
  const spread = { ...mem };
  assert.ok(!("apiKey" in spread), "apiKey must not be enumerable");
  assert.ok(!JSON.stringify(spread).includes("SECRETVALUE"), "spreading must not expose the key");
  assert.ok(!JSON.stringify(spread).includes("X-API-Key"), "nor the prepared header");
});

test("the unknown-filter warning set is bounded", async () => {
  // 2.2.27 capped the store-id warn set and left this sibling unbounded — an app that
  // forwards user-supplied filter keys grows it forever, one entry per distinct typo.
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/wontopos.ts", import.meta.url), "utf8"));
  assert.match(src, /WARNED_FILTER_KEYS_MAX/, "the filter warn set needs a cap like the store-id one");
  assert.match(src, /warnedFilterKeys\.delete\(/, "and eviction, not just a constant");
});


// `base64 image.jpg` wraps at 76 columns. Left in the payload, those line breaks draw a
// 400 from the engine — measured against production (2026-08-16): one line 200, wrapped
// at 76 **400**. Producing an image's base64 from a file and pasting it in is a common
// route, so the SDK strips them here.
test("wrapped base64 loses its newlines before it is sent", async () => {
  const src = readFileSync(new URL("../src/wontopos.ts", import.meta.url), "utf8");
  assert.match(src, /replace\(\/\\s\+\/g, ""\)/,
    "nothing strips whitespace from the base64 payload — wrapped input becomes a 400");
  // And that the prefix check comes **after** the trim. Reverse the order and one leading
  // space is enough to miss the prefix.
  const i = src.indexOf("const raw = image.data.trim()");
  const j = src.indexOf('raw.startsWith("data:")');
  assert.ok(i !== -1 && j !== -1 && i < j, "the trim has to come before the prefix check");
});

test("a call that names no model carries the SDK default", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, "{}"], [200, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.stats("alice");
    await mem.withModel("tablet-1").stats("alice");
    // Read the default out of the source rather than repeating the string: a literal
    // here keeps passing the day the default changes, which is the day it matters.
    const src = readFileSync(new URL("../src/wontopos.ts", import.meta.url), "utf8");
    const declared = src.match(/const DEFAULT_MODEL = "([^"]+)"/)[1];
    assert.equal(seen[0].headers["x-wos-model"], declared);
    assert.equal(seen[1].headers["x-wos-model"], "tablet-1");
  } finally {
    server.close();
  }
});

test("iterImages stops when the server hands back the cursor it was given", async () => {
  // Without the repeat guard the same page comes back MAX_PAGES times and the
  // caller reads the duplicates as more images.
  const page = JSON.stringify({
    images: [{ id: "img-1", content: "a" }],
    has_more: true,
    next_before: "2026-08-01T00:00:00Z",
    next_skip_ids: ["img-1"],
  });
  const { server, seen, base } = await scriptedServer(Array.from({ length: 40 }, () => [200, {}, page]));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const out = [];
    for await (const m of mem.iterImages("alice")) out.push(m);
    assert.equal(out.length, 2, "one page, then one repeat that is detected and stops the walk");
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("searchFull keeps what search merges away (images, verify_used)", async () => {
  // `search` answers with one merged array, so the photos — which Tablet 2 returns
  // BESIDE the text — and the count of re-ask passes actually run had nowhere to land.
  // Both are billable, and both were being paid for and discarded.
  const body = JSON.stringify({
    memories: [{ id: "m1", content: "text" }],
    self_memories: [{ id: "s1", content: "mine" }],
    images: [{ id: "i1", content: "the day we moved" }],
    verify_used: 2,
  });
  const { server, seen, base } = await scriptedServer([[200, {}, body], [200, {}, body]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const full = await mem.searchFull("q", "alice", 10, { max_images: 3, verify: 2 });
    assert.deepEqual(full.images.map((m) => m.id), ["i1"]);
    assert.deepEqual(full.self_memories.map((m) => m.id), ["s1"]);
    assert.equal(full.verify_used, 2);
    assert.deepEqual(full.memories.map((m) => m.id), ["m1"]);
    const sent = JSON.parse(seen[0].body);
    assert.equal(sent.max_images, 3);
    assert.equal(sent.verify, 2);

    // And the merged call is unchanged: one list, no images, no verify_used.
    const merged = await mem.search("q", "alice");
    assert.deepEqual(merged.map((m) => m.id), ["m1", "s1"]);
  } finally {
    server.close();
  }
});

test("searchFull normalizes a field a broken proxy nulled", async () => {
  const { server, base } = await scriptedServer([[200, {}, '{"memories":null,"images":null}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const r = await mem.searchFull("q", "alice");
    assert.deepEqual(r.memories, []);
    assert.deepEqual(r.images, []);
    assert.deepEqual(r.self_memories, []);
    assert.equal("verify_used" in r, false, "absent means it was never asked for");
  } finally {
    server.close();
  }
});

// ── recall's promise, kept ─────────────────────────────────────────────────
// `recall`'s own doc comment said "out of range is refused, not clamped" and the
// value went straight to the wire. `limit: 500` travelled to the engine and died
// there; from the caller's side that is a service error for a mistake the client
// knew about before it opened a socket. These pin the promise, in both directions.
test("recall refuses a limit outside 5-20 without sending anything", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(() => mem.recall("q", "alice", { limit: 500 }), /between 5 and 20/);
    await assert.rejects(() => mem.recall("q", "alice", { limit: 0 }), /between 5 and 20/);
    await assert.rejects(() => mem.recall("q", "alice", { limit: 7.5 }), /must be an integer/);
    assert.equal(seen.length, 0, "nothing may reach the wire");
  } finally {
    server.close();
  }
});

test("recall refuses a context_limit outside 0-20, and lets the whole range through", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, "{}"], [200, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(() => mem.recall("q", "alice", { context_limit: 50 }), /between 0 and 20/);
    await assert.rejects(() => mem.recall("q", "alice", { context_limit: -1 }), /between 0 and 20/);
    // 0 is a real answer ("attach none"), not a missing value — it must not be refused.
    await mem.recall("q", "alice", { context_limit: 0, limit: 20 });
    assert.equal(JSON.parse(seen[0].body).context_limit, 0);
    assert.equal(JSON.parse(seen[0].body).limit, 20);
  } finally {
    server.close();
  }
});

// ── status 0 means one thing ───────────────────────────────────────────────
test("an argument mistake is a plain Error, never a WosError", async () => {
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:1" });
  for (const call of [
    () => mem.search("q", "alice", 500),
    () => mem.recall("q", "alice", { limit: 500 }),
  ]) {
    const e = await call().then(
      () => null,
      (err) => err,
    );
    assert.ok(e instanceof Error, "still an Error");
    assert.ok(
      !(e instanceof WosError),
      `a WosError says the service answered. Nothing was sent: ${inspect(e)}`,
    );
  }
});

test("status 0 is reserved for APIConnectionError — nothing else constructs it", () => {
  // Read the shipped file, not the source: this is about what callers receive.
  // `catch (e) { if (e.status === 0) retry() }` is documented behaviour for a request
  // that never got a response. Any other failure wearing status 0 sends that caller
  // into a retry loop it can never leave.
  const dist = readFileSync(new URL("../dist/wontopos.js", import.meta.url), "utf8");
  const stray = [...dist.matchAll(/new (\w*Error)\(\s*0\s*,/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(stray)].sort(),
    ["APIConnectionError"],
    `these construct status 0 too: ${[...new Set(stray)].join(", ")}`,
  );
});

// ── the server's answer wins ───────────────────────────────────────────────
test("replayed never overwrites a field the service actually sent", async () => {
  const { server, base } = await scriptedServer([
    [200, { "Idempotent-Replayed": "true" }, '{"id":"m1","replayed":false}'],
    [200, { "Idempotent-Replayed": "true" }, '{"id":"m2"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    // These bodies are widening — a response may carry fields this client has
    // never seen. If a name ever collides, the service's value is the true one
    // and ours is a guess.
    const said = await mem.add("x", "alice", { idempotencyKey: "k1" });
    assert.equal(said.replayed, false, "the service said false; we must not flip it");
    const silent = await mem.add("x", "alice", { idempotencyKey: "k2" });
    assert.equal(silent.replayed, true, "the service said nothing; the header answers");
  } finally {
    server.close();
  }
});

// ── cancellation and the total budget ──────────────────────────────────────
// `timeoutMs` bounded one attempt, so a call could hold a connection for 30s +
// backoff + 30s + backoff + 30s with no way for the caller to say "I have five
// seconds" or "the user closed the window". Both arrive through the same wiring:
// what cuts this attempt short.
/** Headers first, then a body that never finishes. The abort has to land while the
 *  client is READING, which is the branch the tests below this one never reach:
 *  they abort before fetch resolves, so they only ever exercised the two sites that
 *  were already using abortMessage. 2.2.36 shipped with the other two still saying
 *  "request timed out after 30000ms" for a cancel and for an exhausted deadline. */
function stallingBodyServer() {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
      res.write('{"memories":');           // enough to resolve fetch(), not enough to parse
    });                                     // and then nothing, ever
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` })
    );
  });
}

test("a cancel while the body is streaming says cancelled, not timed out", async () => {
  const { server, base } = await stallingBodyServer();
  try {
    const ctrl = new AbortController();
    const mem = new Client({ apiKey: KEY, baseUrl: base, signal: ctrl.signal, timeoutMs: 30_000 });
    const p = mem.search("q", "alice");
    setTimeout(() => ctrl.abort(), 60);
    // The number in the wrong message is the timeout the caller never hit.
    await assert.rejects(p, (e) => /cancelled/.test(e.message) && !/30000/.test(e.message));
  } finally {
    server.close();
  }
});

test("a deadline expiring while the body is streaming says deadline, not timed out", async () => {
  const { server, base } = await stallingBodyServer();
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, deadlineMs: 120, timeoutMs: 30_000 });
    await assert.rejects(
      () => mem.search("q", "alice"),
      (e) => /deadline/.test(e.message) && !/30000/.test(e.message)
    );
  } finally {
    server.close();
  }
});

test("the caller's signal cancels a request in flight", async () => {
  const { server, base } = await scriptedServer([[200, {}, "{}"]]);
  try {
    const ctrl = new AbortController();
    ctrl.abort();
    const mem = new Client({ apiKey: KEY, baseUrl: base, signal: ctrl.signal });
    await assert.rejects(() => mem.search("q", "alice"), /cancelled/);
  } finally {
    server.close();
  }
});

test("aborting during a backoff wakes immediately instead of sleeping it out", async () => {
  // A 2s Retry-After, abandoned 60ms in. A backoff that runs to completion after the
  // caller gave up wastes exactly as long as the request it was waiting to repeat.
  const { server, base } = await scriptedServer([
    [429, { "Retry-After": "2" }, '{"error":"rate limited"}'],
    [200, {}, "{}"],
  ]);
  try {
    const ctrl = new AbortController();
    const mem = new Client({ apiKey: KEY, baseUrl: base, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 60);
    const t0 = Date.now();
    await assert.rejects(() => mem.search("q", "alice"), /cancelled/);
    const spent = Date.now() - t0;
    assert.ok(spent < 1000, `woke after ${spent}ms — it slept through the abort`);
  } finally {
    server.close();
  }
});

test("a deadline bounds the whole call, not one attempt", async () => {
  const { server, base } = await scriptedServer([
    [429, { "Retry-After": "5" }, '{"error":"rate limited"}'],
    [200, {}, "{}"],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, deadlineMs: 200 });
    const t0 = Date.now();
    await assert.rejects(() => mem.search("q", "alice"), /deadline of 200ms exhausted/);
    const spent = Date.now() - t0;
      // Under the budget, not merely under some larger number: the bound here was
      // 1500ms, which a run that slept out the remaining budget and then gave up
      // passed just as well as one that refused at once. That looseness is what let
      // the race sit here unnoticed.
    assert.ok(spent < 150, `spent ${spent}ms against a 200ms budget`);
  } finally {
    server.close();
  }
});

test("a clone keeps the signal and the deadline", async () => {
  // The same trap `fetch` fell into: a clone that quietly drops these keeps working
  // right up to the moment someone needs to cancel.
  const { server, base } = await scriptedServer([[200, {}, "{}"], [200, {}, "{}"]]);
  try {
    const ctrl = new AbortController();
    ctrl.abort();
    const mem = new Client({ apiKey: KEY, baseUrl: base, signal: ctrl.signal, deadlineMs: 5_000 });
    await assert.rejects(() => mem.withModel("tablet-2").search("q", "alice"), /cancelled/);
    await assert.rejects(() => mem.withUser("bob").recall("q"), /cancelled/);
  } finally {
    server.close();
  }
});

test("a long-lived signal does not collect one listener per request", async () => {
  // One AbortController per user session, many calls on it: `{ once: true }` would
  // still leave a listener behind for every request that finished normally.
  const { getEventListeners } = await import("node:events");
  const { server, base } = await scriptedServer(Array.from({ length: 8 }, () => [200, {}, "{}"]));
  try {
    const ctrl = new AbortController();
    const mem = new Client({ apiKey: KEY, baseUrl: base, signal: ctrl.signal });
    for (let i = 0; i < 8; i++) await mem.search("q", "alice");
    assert.equal(
      getEventListeners(ctrl.signal, "abort").length,
      0,
      "listeners survived their requests",
    );
  } finally {
    server.close();
  }
});

test("dist ships no source comments in JS and keeps the doc comments in .d.ts", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  for (const js of ["../dist/wontopos.js", "../dist/cjs/wontopos.js"]) {
    const lines = read(js).split("\n").filter((l) => /^\s*(\/\/|\/\*|\*)/.test(l));
    assert.equal(
      lines.length,
      0,
      `${js} carries ${lines.length} comment line(s). Body comments are internal — an ` +
        `unreleased engine and three response fields shipped this way once. Keep ` +
        `removeComments on in tsconfig.json. First: ${lines[0]?.trim()}`
    );
  }
  const dts = read("../dist/wontopos.d.ts");
  const docs = (dts.match(/\/\*\*/g) ?? []).length;
  assert.ok(
    docs > 150,
    `dist/wontopos.d.ts has ${docs} doc comments. These are the hover text a customer ` +
      `reads in their editor, emitted by tsconfig.types.json with removeComments off. ` +
      `2.2.36 published 170; a build that strips them makes the SDK silent on hover.`
  );
  assert.ok(
    !/^\s*\/\//m.test(dts),
    "dist/wontopos.d.ts carries a line comment. Declaration emit should only carry doc " +
      "comments attached to exported declarations; a `//` here means something internal followed."
  );
});
