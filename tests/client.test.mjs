import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { inspect } from "node:util";
import { readFileSync } from "node:fs";
import { Client, WosError } from "../dist/wontopos.js";
const DIST = new URL("../dist/wontopos.js", import.meta.url).href;

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
    for (const bad of [{ user_id: "evil" }, { query: "evil" }, { max_results: 999 }]) {
      await assert.rejects(
        () => mem.search("real-query", "alice", 7, bad),
        /set by the call, not by options/,
        `${Object.keys(bad)[0]} must be refused, not dropped`
      );
    }
    assert.equal(seen.length, 0, "a refused option must not reach the wire");

    await mem.search("real-query", "alice", 7, { filters: { categories: ["x"] } });
    const body = JSON.parse(seen[0].body);
    assert.equal(body.user_id, "alice");
    assert.equal(body.query, "real-query");
    assert.equal(body.max_results, 7);
    assert.deepEqual(body.filters, { categories: ["x"] });
  } finally {
    server.close();
  }
});

test("a POST write without a key is NOT retried on 502 (no duplicate write)", async () => {
  const { server, seen, base } = await scriptedServer([[502, {}, '{"error":"bad gateway"}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.createStore("u"), (e) => e.status === 502);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].headers["idempotency-key"], undefined);
  } finally {
    server.close();
  }
});

test("a memory write IS retried on 502, with the same key on every attempt", async () => {
  const { server, seen, base } = await scriptedServer([
    [502, { "Retry-After": "0" }, '{"error":"bad gateway"}'],
    [200, {}, '{"id":"m1","status":"stored"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const r = await mem.add("hi", "u");
    assert.equal(r.id, "m1");
    assert.equal(seen.length, 2);
    const k = seen[0].headers["idempotency-key"];
    assert.match(k, /^sdk-[0-9a-f]{32}$/);
    assert.equal(seen[1].headers["idempotency-key"], k, "a retry must repeat the key, or it is a second write");
    assert.equal(seen[1].body, seen[0].body, "a retry must repeat the body, or the key is refused");
  } finally {
    server.close();
  }
});

test("each memory write gets a key of its own", async () => {
  const { server, seen, base } = await scriptedServer(Array(4).fill([200, {}, '{"id":"m","status":"stored"}']));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("same text", "u");
    await mem.add("same text", "u");
    await mem.addTurn("hi", "yo", "u");
    await mem.update("m1", "new", "u");
    const keys = seen.map((r) => r.headers["idempotency-key"]);
    for (const k of keys) assert.match(k, /^sdk-[0-9a-f]{32}$/);
    assert.equal(new Set(keys).size, 4, "two writes sharing a key would replay the first and lose the second");
  } finally {
    server.close();
  }
});

test("a key made without crypto.randomUUID still has the right shape", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"id":"m1","status":"stored"}']]);
  const desc = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("x", "u");
    assert.match(seen[0].headers["idempotency-key"], /^sdk-[0-9a-f]{32}$/);
  } finally {
    if (desc) Object.defineProperty(globalThis, "crypto", desc);
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
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("a read sent as POST is retried on 502/503/504 like a GET; a write is not", async () => {
  for (const status of [502, 503, 504]) {
    const { server, seen, base } = await scriptedServer([
      [status, { "Retry-After": "0" }, "{}"],
      [200, {}, '{"memories":[]}'],
    ]);
    try {
      const mem = new Client({ apiKey: KEY, baseUrl: base });
      await mem.search("q", "alice");
      assert.equal(seen.length, 2, `search on ${status}`);
    } finally {
      server.close();
    }
  }
  const { server, seen, base } = await scriptedServer([
    [503, { "Retry-After": "0" }, "{}"],
    [200, {}, '{"status":"created"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(() => mem.createStore("alice"));
    assert.equal(seen.length, 1, "a write without a key may have landed: not sent again");
  } finally {
    server.close();
  }
});

test("engram refuses an option it does not know", async () => {
  const mem = new Client({ apiKey: KEY });
  await assert.rejects(
        () => mem.engram("deep_recall", "q", "u", { fom: "memoir" }),
    (e) => /unknown engram option/i.test(e.message) && /form/.test(e.message)
  );
});

for (const status of [504, 408]) {
  test(`GET is retried on ${status} (idempotent)`, async () => {
    const { server, seen, base } = await scriptedServer([
      [status, { "Retry-After": "0" }, "{}"],
      [200, {}, '{"models":[]}'],
    ]);
    try {
      const mem = new Client({ apiKey: KEY, baseUrl: base });
      await mem.listModels();
      assert.equal(seen.length, 2);
    } finally {
      server.close();
    }
  });

  test(`a POST write without a key is NOT retried on ${status}`, async () => {
    const { server, seen, base } = await scriptedServer([[status, {}, '{"error":"gateway"}']]);
    try {
      const mem = new Client({ apiKey: KEY, baseUrl: base });
      await assert.rejects(mem.addSpeaker("Bob", "u"), (e) => e.status === status);
      assert.equal(seen.length, 1);
    } finally {
      server.close();
    }
  });
}

test("maxRetries: NaN falls back to default (still makes the request)", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: NaN });
    assert.deepEqual(await mem.search("q", "u"), []);
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

test("every loopback and unspecified address stays quiet over plain HTTP, as in Python and Rust", () => {
  const warned = (baseUrl) => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (m) => warnings.push(String(m));
    try {
      new Client({ apiKey: KEY, baseUrl });
    } finally {
      console.warn = orig;
    }
    return warnings.some((w) => w.includes("unencrypted"));
  };
  for (const base of ["http://127.0.0.2:8080", "http://127.255.255.254", "http://[::]:8080", "http://[0:0:0:0:0:0:0:1]", "http://0.0.0.0:1", "http://LOCALHOST"]) {
    assert.equal(warned(base), false, base);
  }
  for (const base of ["http://203.0.113.7","http://[::ffff:127.0.0.1]", "http://[::2]", "http://localhost.example.com", "http://127.0.0.1.example.com"]) {
    assert.equal(warned(base), true, base);
  }
});

test("fromEnv: empty first env var falls back; opts.apiKey cannot override the env key", () => {
  const env = globalThis.process.env;
  const save = { W: env.WONTOPOS_API_KEY, W2: env.WOS_API_KEY };
  try {
    env.WONTOPOS_API_KEY = "   ";
    env.WOS_API_KEY = "wos-fromenv-realkey1234";
    const mem = Client.fromEnv({ apiKey: "wos-attacker-override-9999" });
    assert.ok(mem.toJSON().apiKey.endsWith("1234"));
  } finally {
    if (save.W === undefined) delete env.WONTOPOS_API_KEY;
    else env.WONTOPOS_API_KEY = save.W;
    if (save.W2 === undefined) delete env.WOS_API_KEY;
    else env.WOS_API_KEY = save.W2;
  }
});

test("iterMemories throws when the server repeats a cursor after a non-empty page", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"memories":[{"id":"1"}],"next_cursor":"C"}'],
    [200, {}, '{"memories":[{"id":"2"}],"next_cursor":"C"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const out = [];
    await assert.rejects(async () => {
      for await (const m of mem.iterMemories("u", { pageSize: 1 })) out.push(m.id);
    }, /truncated answer/);
    assert.deepEqual(out, ["1", "2"]);
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("the v6 loopback is loopback — no plaintext warning", () => {
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

test("every loopback or unspecified address is local, as Python and Rust read it: no plaintext warning", () => {
  const warns = [];
  const save = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    for (const base of ["http://127.0.0.2:8080", "http://127.255.255.254", "http://127.1:9", "http://[::]:8080", "http://[0:0:0:0:0:0:0:1]:9", "http://0.0.0.0:9"]) {
      new Client({ apiKey: KEY, baseUrl: base });
      assert.deepEqual(warns, [], base);
    }
    for (const base of ["http://[::ffff:127.0.0.1]:9", "http://128.0.0.1", "http://127.0.0.1.example.com"]) {
      new Client({ apiKey: KEY, baseUrl: base });
      assert.equal(warns.length, 1, base);
      warns.length = 0;
    }
  } finally {
    console.warn = save;
  }
});

test("a control character in the API key is refused here, not at the network", () => {
  for (const bad of ["wos-live-\u0000abc", "wos-live-\u0001abc", "wos-live-\u007fabc"]) {
    assert.throws(() => new Client({ apiKey: bad }), /control character/, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => new Client({ apiKey: KEY }));
});

test("a search count outside 5..20 is refused, not adjusted", async () => {
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
    for await (const m of mem.iterImages("u", { pageSize: 5 })) out.push(m.id);
    assert.deepEqual(out, ["i1", "i2"]);
  } finally {
    server.close();
  }
});

test("iterImages throws when the server repeats a cursor after a non-empty page", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"images":[{"id":"i1"}],"has_more":true,"next_before":"B"}'],
    [200, {}, '{"images":[{"id":"i2"}],"has_more":true,"next_before":"B"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const out = [];
    await assert.rejects(async () => {
      for await (const m of mem.iterImages("u", { pageSize: 5 })) out.push(m.id);
    }, /truncated answer/);
    assert.deepEqual(out, ["i1", "i2"]);
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("timeout applies to a hung response BODY, not just headers", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "100" });
    res.write("{");
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

test("withUser and the constructor refuse an unusable store id, like add() does", () => {
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", userId: "tenant-A" });
  for (const bad of ["", " ", null, 0, 12345, {}, []]) {
    assert.throws(() => mem.withUser(bad), /non-blank string/, `withUser(${JSON.stringify(bad)})`);
    assert.throws(
      () => new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", userId: bad }),
      /non-blank string/,
      `new Client({ userId: ${JSON.stringify(bad)} })`,
    );
  }
  assert.throws(() => mem.withUser(undefined), /withUser\(\) needs a store id/);
  assert.equal(new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9" }).toJSON().userId, "default");
  assert.equal(mem.withModel("tablet-2").toJSON().userId, "tenant-A");
});

test("deleteAll rejects blank/whitespace userId (would wipe the default store)", async () => {
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9" });
  for (const uid of ["", " ", "\t", "\n", "   "]) {
    await assert.rejects(() => mem.deleteAll(uid), /non-blank/);
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
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9" });
  await assert.rejects(() => mem.delete("alice", ""), /memoryId is required/);
  await assert.rejects(() => mem.delete("alice", undefined), /memoryId is required/);
  await assert.rejects(() => mem.deleteAll(""), /userId is required/);
  await assert.rejects(() => mem.deleteStore(""), /userId is required/);
});

test("key is masked in toJSON and inspect", () => {
  const mem = new Client({ apiKey: "wos-live-supersecretkeyvalue1234" });
  const j = JSON.stringify(mem);
  assert.ok(!j.includes("supersecretkeyvalue"));
  assert.ok(j.includes("1234"));
  const i = inspect(mem);
  assert.ok(!i.includes("supersecretkeyvalue"));
  const viaProxy = new Client({ apiKey: KEY, baseUrl: "https://user:pa55w0rd@proxy.example.com" });
  for (const view of [JSON.stringify(viaProxy), inspect(viaProxy)]) {
    assert.ok(!view.includes("pa55w0rd"), view);
    assert.ok(view.includes("***@proxy.example.com"), view);
  }
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

test("a POST without a key is NOT retried on a mid-stream connection drop (no duplicate write)", async () => {
  const { server, conns, base } = await droppingServer();
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 1 });
    await assert.rejects(mem.createStore("u"), (e) => e instanceof WosError && e.status === 0);
    assert.equal(conns.length, 1);
  } finally {
    server.close();
  }
});

test("a memory write IS retried on a mid-stream connection drop (it carries a key)", async () => {
  const { server, conns, base } = await droppingServer();
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 1 });
    await assert.rejects(mem.add("hi", "u"), (e) => e instanceof WosError && e.status === 0);
    assert.equal(conns.length, 2);
  } finally {
    server.close();
  }
});

test("GET IS retried on a mid-stream connection drop (idempotent)", async () => {
  const { server, conns, base } = await droppingServer();
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 1 });
    await assert.rejects(mem.listModels(), (e) => e instanceof WosError && e.status === 0);
    assert.equal(conns.length, 2);
  } finally {
    server.close();
  }
});

test("POST to a refused port IS retried (connect-level — the request never left)", async () => {
  const tmp = net.createServer();
  await new Promise((r) => tmp.listen(0, "127.0.0.1", r));
  const port = tmp.address().port;
  await new Promise((r) => tmp.close(r));
  const mem = new Client({ apiKey: KEY, baseUrl: `http://127.0.0.1:${port}`, maxRetries: 1 });
  const t0 = Date.now();
  await assert.rejects(mem.add("hi", "u"), (e) => e instanceof WosError && e.status === 0);
  assert.ok(Date.now() - t0 >= 450, `elapsed ${Date.now() - t0}ms — expected a retry backoff`);
});

test("add, addTurn and addBulk wait 200s an attempt unless the caller set a timeout; the rest 30s", () => {
  const mem = new Client({ apiKey: KEY });
  assert.deepEqual([mem.timeoutMs, mem.storeTimeoutMs], [30_000, 200_000]);
  const set = new Client({ apiKey: KEY, timeoutMs: 10 });
  assert.deepEqual([set.timeoutMs, set.storeTimeoutMs], [10, 10]);
  assert.equal(set.withModel("tablet-1").storeTimeoutMs, 10);
  assert.equal(mem.withUser("bob").storeTimeoutMs, 200_000);
  assert.equal(mem.withTimeout(5).storeTimeoutMs, 5);
  assert.equal(new Client({ apiKey: KEY, timeoutMs: 0 }).storeTimeoutMs, 200_000);
});

test("each call's attempt is timed by its own default", async () => {
  const { server, base } = await scriptedServer([
    [200, {}, "{}"],
    [200, {}, "{}"],
    [200, {}, "{}"],
    [200, {}, "{}"],
    [200, {}, '{"memories":[]}'],
  ]);
  const waits = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms >= 10_000) waits.push(ms);
    return real(fn, ms, ...rest);
  };
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("x", "alice");
    await mem.addTurn("hi", "yo", "alice");
    await mem.addBulk("blob", "alice", "general");
    await mem.update("m1", "new", "alice");
    await mem.search("q", "alice");
  } finally {
    globalThis.setTimeout = real;
    server.close();
  }
  assert.deepEqual(waits, [200_000, 200_000, 200_000, 30_000, 30_000]);
});

test("timeoutMs: NaN (an unset env var through Number()) means the default", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, timeoutMs: NaN });
    assert.equal(mem.timeoutMs, 30_000);
    await mem.search("q", "alice");
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

test("withRetries(0) disables retries on the clone", async () => {
  const { server, seen, base } = await scriptedServer([
    [429, { "Retry-After": "0" }, '{"error":"rate limited"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.withRetries(0).stats(), (e) => e instanceof WosError && e.status === 429);
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("withTimeout applies to the clone (hung body times out)", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "100" });
    res.write("{");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0 });
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
    await assert.rejects(() => mem.get("u", ""), /memoryId is required/);
  } finally {
    server.close();
  }
});

test("get() takes the row itself when the model answers without a memory wrapper", async () => {
  const { server, base } = await scriptedServer([
    [200, {}, '{"id":"9b2d","content":"tea","is_superseded":false}'],
    [200, {}, '{"user_id":"u","memory":null}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const m = await mem.get("u", "9b2d");
    assert.equal(m.content, "tea");
    assert.equal(m.id, "9b2d");
    assert.deepEqual(await mem.get("u", "9b2d"), {});
  } finally {
    server.close();
  }
});

test("search, searchSelf and searchFull send form and tz", async () => {
  const ok = [200, {}, '{"memories":[]}'];
  const { server, seen, base } = await scriptedServer([ok, ok, ok]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.search("q", "alice", 10, { form: "memoir", tz: 9 });
    await mem.searchSelf("q", "alice", 10, { form: "archive", tz: -5 });
    await mem.searchFull("q", "alice", 10, { form: "memoir", tz: 0 });
    const sent = seen.map((r) => JSON.parse(r.body));
    assert.deepEqual(sent.map((b) => [b.form, b.tz]), [["memoir", 9], ["archive", -5], ["memoir", 0]]);
  } finally {
    server.close();
  }
});

test("search() returns image rows after the text, each id once", async () => {
  const body = JSON.stringify({
    memories: [{ id: "m1" }, { id: "dup" }],
    self_memories: [{ id: "s1" }],
    images: [{ id: "dup" }, { id: "i1", content: "", image_ref: "r" }],
  });
  const { server, base } = await scriptedServer([[200, {}, body], [200, {}, body]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    assert.deepEqual((await mem.search("q", "alice")).map((m) => m.id), ["m1", "dup", "s1", "i1"]);
    assert.deepEqual(Object.keys(await mem.searchSelf("q", "alice")).sort(), ["memories", "self_memories"]);
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
    [200, {}, '{"count":0,"limit":50}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const hits = await mem.search("q");
    assert.equal(hits[0].speaker, "Bob");
    assert.equal(hits[0].time_bucket, "2026-07");
    assert.equal(hits[0].similarity, 0.9);
    const speakers = await mem.listSpeakers();
    assert.deepEqual(speakers.speakers, []);
    assert.equal(speakers.limit, 50);
  } finally {
    server.close();
  }
});

test("revisions goes to /api/v1/won, not /api/v1/memory", async () => {
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
  const { server, seen, base } = await scriptedServer([[200, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.recall("q", "alice", { limit: 20, context_limit: 0 });
    const body = JSON.parse(seen[0].body);
    assert.equal(body.limit, 20);
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
    assert.ok(!("limit" in body) && !("context_limit" in body), JSON.stringify(body));
  } finally {
    server.close();
  }
});

test("verify and max_images travel as named search options", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.search("q", "alice", 10, { verify: 2, max_images: 5 });
    const body = JSON.parse(seen[0].body);
    assert.equal(body.verify, 2);
    assert.equal(body.max_images, 5);
    assert.equal(body.user_id, "alice");
    assert.equal(body.max_results, 10);
  } finally {
    server.close();
  }
});

test("revisions asks for counts only unless a page is requested", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"revised":3,"unrevised":37,"total":40}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.revisions("alice");
    const body = JSON.parse(seen[0].body);
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
    assert.equal(seen.length, 1);
    assert.equal(seen[0].path, "/api/v1/memory/search");
    const r2 = await mem.searchSelf("q", "u");
    assert.deepEqual(r2.self_memories, []);
    assert.deepEqual(r2.memories.map((m) => m.id), ["m2"]);
  } finally {
    server.close();
  }
});

test("bad elements inside a record array are skipped, valid records survive", async () => {
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
  const { server, base } = await scriptedServer([
    [200, {}, '{"memories":[{"id":"m1","content":"partner said this"}],"self_memories":[{"id":"s1","content":"I said this","speaker":"me"},{"id":"m1","content":"dup"}]}'],
    [200, {}, '{"memories":[{"id":"only"}]}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const out = await mem.search("q", "u");
    assert.deepEqual(out.map((m) => m.id), ["m1", "s1"], "both fields, id-deduplicated");
    assert.equal(out[1].speaker, "me", "self_memories keeps its speaker");
    assert.deepEqual((await mem.search("q", "u")).map((m) => m.id), ["only"]);
  } finally {
    server.close();
  }
});

test("internal plumbing is not part of the published type surface", () => {
  const dts = readFileSync(new URL("../dist/wontopos.d.ts", import.meta.url), "utf8");
  for (const internal of ["request", "send", "post", "readCappedBytes", "backoffMs", "uid", "clone"]) {
    assert.match(
      dts,
      new RegExp(`private\\s+(async\\s+)?${internal}\\b`),
      `${internal} should be declared private in the .d.ts`
    );
  }
  assert.match(dts, /\bsearch\(/, "the real surface is still declared");
});

test("retries: the alias works too, and disables retries when 0", async () => {
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

test("every write can carry a key, and one without gets a key the client made", async () => {
  const { server, seen, base } = await scriptedServer(Array(5).fill([200, {}, "{}"]));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("x", "alice", {}, { idempotencyKey: "k1" });
    await mem.addTurn("hi", "yo", "alice", { idempotencyKey: "k2" });
    await mem.addBulk("blob", "alice", "general", undefined, { idempotencyKey: "k3" });
    await mem.update("m1", "new", "alice", { idempotencyKey: "k4" });
    await mem.add("x", "alice");
    const keys = seen.map((r) => r.headers["idempotency-key"]);
    assert.deepEqual(keys.slice(0, 4), ["k1", "k2", "k3", "k4"]);
    assert.match(keys[4], /^sdk-[0-9a-f]{32}$/);
  } finally {
    server.close();
  }
});

test("a malformed idempotency key fails BEFORE the request", async () => {
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

test("search filters reach the API", async () => {
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

test("store id normalization: one warning naming the normalized form", async () => {
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
    assert.match(warns[0], /cannot be created beside it \(409\)/);
  } finally {
    console.warn = orig;
    server.close();
  }
});

test("add refuses a metadata key that names a store, before sending", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"id":"m1","status":"stored"}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const md of [{ userId: "bob" }, { store_id: "t" }, { "Idempotency-Key": "k" }, { USER_ID: "x" }]) {
      await assert.rejects(mem.add("x", "alice", md), /not a metadata field/);
    }
    assert.equal(seen.length, 0);
    await mem.add("bought milk", "alice", { store: "Costco", user_id_2: "b", model: "m" });
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("an id the API does not accept gets its own warning, naming the 400", async () => {
  const { _resetStoreIdWarnings } = await import("../dist/wontopos.js");
  const { server, base } = await scriptedServer([[200, {}, "{}"], [200, {}, "{}"], [200, {}, "{}"]]);
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    _resetStoreIdWarnings();
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const bad of ["bob.lee@example.com", "_alice", "x".repeat(65)]) await mem.add("x", bad);
    assert.equal(warns.length, 3);
    for (const w of warns) {
      assert.match(w, /is not a valid store id/);
      assert.match(w, /refused \(400\)/);
      assert.doesNotMatch(w, /409/);
    }
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

test("billedTo says when API credit paid, and a used-up week says why and when it resets", async () => {
  const { server, base } = await scriptedServer([
    [200, { "X-WOS-Billed-To": "balance" }, "{}"],
    [200, {}, "{}"],
    [402, {}, `{"type":"error","error":{"type":"billing_error","message":"This week's subscription usage is used up.","reason":"weekly_limit_reached","resets_at":"2026-11-01T01:00:00.000Z"}}`],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    assert.equal(mem.billedTo, null);
    await mem.usage();
    assert.equal(mem.billedTo, "balance");
    await mem.usage();
    assert.equal(mem.billedTo, null);
    const e = await mem.usage().then(() => null, (err) => err);
    assert.ok(e instanceof WosError);
    assert.equal(e.status, 402);
    assert.equal(e.details.reason, "weekly_limit_reached");
    assert.equal(e.details.resets_at, "2026-11-01T01:00:00.000Z");
  } finally {
    server.close();
  }
});

test("whether an idempotent write was replayed shows up in the result", async () => {
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

test("a replay of the client's own retry is not reported as replayed", async () => {
  const { server, seen, base } = await scriptedServer([
    [503, { "Retry-After": "0" }, "{}"],
    [200, { "Idempotent-Replayed": "true" }, '{"id":"m1","status":"stored"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const r = await mem.add("x", "alice");
    assert.equal(seen.length, 2);
    assert.equal(r.id, "m1");
    assert.equal(r.replayed, undefined);
  } finally {
    server.close();
  }
});

test("the published type of replayed says it marks a replay of the key the caller passed", () => {
  for (const file of ["../dist/wontopos.d.ts", "../dist/cjs/wontopos.d.cts"]) {
    const dts = readFileSync(new URL(file, import.meta.url), "utf8");
    const doc = /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*replayed\?: boolean;/.exec(dts);
    assert.ok(doc, `${file}: replayed`);
    assert.match(doc[0], /idempotency key you passed/, file);
  }
});

test("410 is a GoneError, says what to do, and is not retried", async () => {
  const { GoneError } = await import("../dist/wontopos.js");
  const body = JSON.stringify({ type: "error", error: { type: "gone_error", message: "Scroll 1 now exists only in memory.", code: 0, request_id: "req_410" } });
  const { server, seen, base } = await scriptedServer([[410, {}, body], [410, {}, body], [410, {}, body]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 3 });
    const e = await mem.search("q", "alice").then(() => null, (err) => err);
    assert.ok(e instanceof GoneError, `got ${e}`);
    assert.ok(e instanceof WosError);
    assert.equal(e.status, 410);
    assert.equal(e.type, "gone_error");
    assert.match(e.message, /Scroll 1 now exists only in memory\./);
    assert.match(e.message, /listModels\(\)/);
    assert.equal(seen.length, 1, "retrying a retired model can never succeed");
  } finally {
    server.close();
  }
});

test("a sleep's 410 is its own: sleep_expired keeps its message and code, with no word of a retired model", async () => {
  const { GoneError, ConflictError } = await import("../dist/wontopos.js");
  const expired = JSON.stringify({ error: { type: "gone_error", code: "sleep_expired", message: "This sleep was read too long ago to finish: read again." } });
  const conflict = JSON.stringify({ error: { type: "conflict_error", code: "self_version_conflict", message: "the file changed since it was read" } });
  const retired = JSON.stringify({ error: { type: "gone_error", code: "model_retired", message: "Scroll 1 is retired." } });
  const { server, seen, base } = await scriptedServer([[410, {}, expired], [409, {}, conflict], [410, {}, retired]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 3 });
    const write = [{ slot: 1, base_version: 0, title: "Garden", body: "## Roses\n- pruned", evidence: [], day: "2026-10-20" }];
    let e = await mem.writeSleepFiles("s-1", write, "alice").then(() => null, (err) => err);
    assert.ok(e instanceof WosError && !(e instanceof GoneError), `got ${e}`);
    assert.equal(e.name, "WosError");
    assert.equal(e.status, 410);
    assert.equal(e.details?.code, "sleep_expired");
    assert.equal(e.message, "[410] This sleep was read too long ago to finish: read again.");
    assert.doesNotMatch(e.message, /retired|listModels/);
    e = await mem.writeSleepFiles("s-1", write, "alice").then(() => null, (err) => err);
    assert.ok(e instanceof ConflictError, `got ${e}`);
    assert.equal(e.details?.code, "self_version_conflict");
    assert.equal(e.message, "[409] the file changed since it was read");
    e = await mem.search("q", "alice").then(() => null, (err) => err);
    assert.ok(e instanceof GoneError, `got ${e}`);
    assert.equal(e.details?.code, "model_retired");
    assert.match(e.message, /Scroll 1 is retired\. This model is retired; listModels\(\)/);
    assert.equal(seen.length, 3, "none of them is retried");
  } finally {
    server.close();
  }
});

const ADMIN_KEY = "wos-admin-" + "k".repeat(147);
const ADMIN_ONLY = "Only an admin key lists stores; this is a standard API key.";
const ADMIN_SAID = "This is an admin key: it lists stores and reads usage and revision counts, and opens no memory. " +
  "Use a standard API key for this call.";

test("ping and keyScope ask the ping endpoint; an answer with no scope is an error", async () => {
  const ping = JSON.stringify({ ok: true, scope: "admin" });
  const { server, seen, base } = await scriptedServer([[200, {}, ping], [200, {}, ping], [200, {}, '{"ok":true}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    assert.equal(await mem.ping(), true);
    assert.equal(await mem.keyScope(), "admin");
    const e = await mem.keyScope().then(() => null, (err) => err);
    assert.ok(e instanceof WosError, `got ${e}`);
    assert.equal(e.status, 200);
    assert.equal(e.message, "[200] the answer carried no key scope");
    assert.deepEqual(seen.map((s) => `${s.method} ${s.path}`), Array(3).fill("GET /api/v1/memory/ping"));
  } finally {
    server.close();
  }
});

test("listStores: where only an admin key lists stores, a standard key gets a PermissionDeniedError", async () => {
  const { PermissionDeniedError } = await import("../dist/wontopos.js");
  const { server, seen, base } = await scriptedServer([
    [200, {}, JSON.stringify({ collections: [], count: 0, admin_only: true })],
    [200, {}, JSON.stringify({ collections: [{ user_id: "a" }], admin_only: false })],
    [200, {}, JSON.stringify({ collections: [{ user_id: "a" }, null] })],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const e = await mem.listStores().then(() => null, (err) => err);
    assert.ok(e instanceof PermissionDeniedError, `got ${e}`);
    assert.equal(e.status, 403);
    assert.equal(e.message, `[403] ${ADMIN_ONLY}`);
    assert.deepEqual(await mem.listStores(), [{ user_id: "a" }]);
    assert.deepEqual(await mem.listStores(), [{ user_id: "a" }]);
    assert.equal(seen.length, 3);
  } finally {
    server.close();
  }
});

test("usage carries stores_admin_only and throws nothing", async () => {
  const body = { stores: [], stores_admin_only: true, balance_cents: 5 };
  const { server, base } = await scriptedServer([[200, {}, JSON.stringify(body)]]);
  try {
    assert.deepEqual(await new Client({ apiKey: KEY, baseUrl: base }).usage(), body);
  } finally {
    server.close();
  }
});

test("an admin key is sent as given, and its 403 reads as the service said", async () => {
  const { PermissionDeniedError } = await import("../dist/wontopos.js");
  assert.equal(ADMIN_KEY.length, 157);
  const said = JSON.stringify({ type: "error", error: { type: "permission_error", message: ADMIN_SAID, request_id: "req_adm" } });
  const { server, seen, base } = await scriptedServer([[403, {}, said]]);
  try {
    const e = await new Client({ apiKey: ADMIN_KEY, baseUrl: base }).search("q", "alice").then(() => null, (err) => err);
    assert.ok(e instanceof PermissionDeniedError, `got ${e}`);
    assert.equal(e.message, `[403] ${ADMIN_SAID} (request_id: req_adm)`);
    assert.equal(seen[0].headers["x-api-key"], ADMIN_KEY);
  } finally {
    server.close();
  }
});

test("WosError.code is the service's error code, from details; undefined when there is none", async () => {
  const { WosError, ConflictError, GoneError, BadRequestError } = await import("../dist/wontopos.js");
  const expired = JSON.stringify({ error: { type: "gone_error", code: "sleep_expired", message: "read again" } });
  const conflict = JSON.stringify({ error: { type: "conflict_error", code: "self_version_conflict", message: "changed" } });
  const bare = JSON.stringify({ error: { type: "invalid_request_error", message: "bad" } });
  const { server, base } = await scriptedServer([[410, {}, expired], [409, {}, conflict], [400, {}, bare]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0 });
    const write = [{ slot: 1, base_version: 0, title: "Garden", body: "## Roses\n- pruned", evidence: [], day: "2026-10-20" }];
    let e = await mem.writeSleepFiles("s-1", write, "alice").then(() => null, (err) => err);
    assert.ok(e instanceof WosError && !(e instanceof GoneError), `got ${e}`);
    assert.equal(e.code, "sleep_expired");
    e = await mem.writeSleepFiles("s-1", write, "alice").then(() => null, (err) => err);
    assert.ok(e instanceof ConflictError, `got ${e}`);
    assert.equal(e.code, "self_version_conflict");
    assert.equal(e.conflictsWith, undefined, "only a store-id collision names one");
    e = await mem.search("q", "alice").then(() => null, (err) => err);
    assert.ok(e instanceof BadRequestError, `got ${e}`);
    assert.equal(e.code, undefined);
  } finally {
    server.close();
  }
  assert.equal(new WosError(400, "x", undefined, { details: { code: "bad_time" } }).code, "bad_time");
  assert.equal(new WosError(400, "x").code, undefined);
  assert.equal(new WosError(400, "x", undefined, { details: { code: 7 } }).code, undefined);
  assert.equal(new WosError(400, "x", undefined, { details: { code: null } }).code, undefined);
  const c = new ConflictError(409, "collides", undefined, { details: { code: "store_id_collision", conflicts_with: "team-a" } });
  assert.equal(c.code, "store_id_collision");
  assert.equal(c.conflictsWith, "team-a");
  assert.equal(new ConflictError(409, "x", undefined, { details: { conflicts_with: 3 } }).conflictsWith, undefined);
  assert.ok(!Object.keys(new WosError(400, "x", undefined, { details: { code: "a" } })).includes("code"), "a getter, not an own field");
});

test("revisions refuses an include other than revised or unrevised before sending", async () => {
  const { server, seen, base } = await scriptedServer([]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.revisions("alice", { include: "both" }), /include must be "revised" or "unrevised"/);
    assert.equal(seen.length, 0, "nothing may reach the network");
  } finally {
    server.close();
  }
});

test("revisions leaves a null include out of the request", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"revised":0,"unrevised":0,"total":0}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.revisions("alice", { include: null });
    assert.equal(seen.length, 1);
    assert.equal("include" in JSON.parse(seen[0].body), false, `sent ${seen[0].body}`);
  } finally {
    server.close();
  }
});

test("a write option the client does not know is warned about, not dropped silently", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"id":"m1","status":"stored"}'], [200, {}, '{"id":"m2","status":"stored"}'], [200, {}, '{"status":"stored"}']]);
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(String(m));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("x", "alice", {}, { idempotency_key: "job-7" });
    await mem.add("y", "alice", {}, { idempotencyKey: "job-8" });
    assert.match(seen[0].headers["idempotency-key"], /^sdk-[0-9a-f]{32}$/, "only idempotencyKey is the option: job-7 is not sent");
    assert.equal(seen[1].headers["idempotency-key"], "job-8");
    assert.ok(warned.some((m) => m.includes('"idempotency_key"')), `warnings: ${warned}`);
    await mem.addBulk("blob", "alice", null, undefined, { image: { data: "aGk=" } });
    assert.equal(JSON.parse(seen[2].body).category, "general", "a null category goes as general");
    assert.ok(warned.some((m) => m.includes('"image"') && m.includes("addBulk takes idempotencyKey, segments and speaker")), `warnings: ${warned}`);
  } finally {
    console.warn = warn;
    server.close();
  }
});

test("a search option of null is left out, as Python leaves out None", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.search("q", "alice", 10, { speaker: null, cache_control: null });
    const body = JSON.parse(seen[0].body);
    assert.equal("speaker" in body, false);
    assert.equal("cache_control" in body, false);
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

const canned = () => Promise.resolve(new Response('{"memories":[]}', { status: 200, headers: { "Content-Type": "application/json" } }));

test("the warning record does not grow per end user", async () => {
  const { _resetStoreIdWarnings, Client } = await import(DIST);
  _resetStoreIdWarnings();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", fetch: canned });
    for (let i = 0; i < 3000; i++) await mem.search("q", `user.${i}@example.com`);

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

test("a whitespace memory id cannot become a whole-store wipe", async () => {
  const mem = new Client({ apiKey: "wos-live-x", userId: "u", baseUrl: "http://127.0.0.1:9" });
  for (const bad of ["", "   ", "\t\n"]) {
    await assert.rejects(() => mem.delete("store", bad), /non-blank/);
  }
});

test("a store id that was PASSED but is blank throws instead of using the default", async () => {
  const mem = new Client({ apiKey: "wos-live-x", userId: "fallback", baseUrl: "http://127.0.0.1:9" });
  await assert.rejects(() => mem.add("hi", "  "), /blank/);
  await assert.rejects(() => mem.search("q", ""), /blank/);
});

test("a store id that is not a usable string throws instead of using the default", async () => {
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
      await assert.rejects(() => mem.add("hi", bad), /non-blank string/, `add(${JSON.stringify(bad)})`);
    }
    assert.equal(seen.length, 0, "none of them may reach the wire");
    await mem.add("hi");
    assert.equal(seen.at(-1), "fallback");
    await mem.add("hi", "alice");
    assert.equal(seen.at(-1), "alice");
  } finally {
    server.close();
  }
});

test("the destructive calls refuse a non-string id too", async () => {
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", userId: "fallback" });
  for (const bad of [null, 0, undefined, [], {}]) {
    await assert.rejects(() => mem.deleteAll(bad), /non-blank string/);
    await assert.rejects(() => mem.deleteStore(bad), /non-blank string/);
  }
});

test("the API key does not survive an object spread", async () => {
  const mem = new Client({ apiKey: "wos-live-SECRETVALUE", userId: "u", baseUrl: "http://127.0.0.1:9" });
  const spread = { ...mem };
  assert.ok(!("apiKey" in spread), "apiKey must not be enumerable");
  assert.ok(!JSON.stringify(spread).includes("SECRETVALUE"), "spreading must not expose the key");
  assert.ok(!JSON.stringify(spread).includes("X-API-Key"), "nor the prepared header");
});

test("the unknown-filter warning set is bounded", async () => {
  const { _resetFilterWarnings, Client } = await import(DIST);
  _resetFilterWarnings();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", fetch: canned });
    for (let i = 0; i < 1100; i++) await mem.search("q", "alice", 10, { filters: { [`typo_${i}`]: 1 } });
    let warned = 0;
    console.warn = () => { warned++; };
    await mem.search("q", "alice", 10, { filters: { typo_0: 1 } });
    assert.equal(warned, 1, "the oldest key must have been evicted");
    warned = 0;
    await mem.search("q", "alice", 10, { filters: { typo_1099: 1 } });
    assert.equal(warned, 0, "a recent key is still remembered");
  } finally {
    console.warn = origWarn;
  }
});


test("wrapped base64 loses its newlines before it is sent", async () => {
  const src = readFileSync(new URL("../src/wontopos.ts", import.meta.url), "utf8");
  assert.match(src, /replace\(\/\\s\+\/g, ""\)/,
    "nothing strips whitespace from the base64 payload — wrapped input becomes a 400");
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
    const src = readFileSync(new URL("../src/wontopos.ts", import.meta.url), "utf8");
    const declared = src.match(/const DEFAULT_MODEL = "([^"]+)"/)[1];
    assert.equal(seen[0].headers["x-wos-model"], declared);
    assert.equal(seen[1].headers["x-wos-model"], "tablet-1");
  } finally {
    server.close();
  }
});

test("iterImages stops when the server hands back the cursor it was given", async () => {
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
    await assert.rejects(async () => {
      for await (const m of mem.iterImages("alice")) out.push(m);
    }, /truncated answer/);
    assert.equal(out.length, 2, "one page, then one repeat that is detected and stops the walk");
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("searchFull keeps what search merges away (images, verify_used)", async () => {
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

    const merged = await mem.search("q", "alice");
    assert.deepEqual(merged.map((m) => m.id), ["m1", "s1", "i1"]);
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
    await mem.recall("q", "alice", { context_limit: 0, limit: 20 });
    assert.equal(JSON.parse(seen[0].body).context_limit, 0);
    assert.equal(JSON.parse(seen[0].body).limit, 20);
  } finally {
    server.close();
  }
});

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
  const dist = readFileSync(new URL("../dist/wontopos.js", import.meta.url), "utf8");
  const stray = [...dist.matchAll(/new (\w*Error)\(\s*0\s*,/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(stray)].sort(),
    ["APIConnectionError"],
    `these construct status 0 too: ${[...new Set(stray)].join(", ")}`,
  );
});

test("replayed never overwrites a field the service actually sent", async () => {
  const { server, base } = await scriptedServer([
    [200, { "Idempotent-Replayed": "true" }, '{"id":"m1","replayed":false}'],
    [200, { "Idempotent-Replayed": "true" }, '{"id":"m2"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const said = await mem.add("x", "alice", {}, { idempotencyKey: "k1" });
    assert.equal(said.replayed, false, "the service said false; we must not flip it");
    const silent = await mem.add("x", "alice", {}, { idempotencyKey: "k2" });
    assert.equal(silent.replayed, true, "the service said nothing; the header answers");
  } finally {
    server.close();
  }
});

function stallingBodyServer() {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
      res.write('{"memories":');
    });
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
  const { RateLimitError } = await import(DIST);
  const { server, base } = await scriptedServer([
    [429, { "Retry-After": "5" }, '{"error":"rate limited"}'],
    [200, {}, "{}"],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, deadlineMs: 200 });
    const t0 = Date.now();
    await assert.rejects(() => mem.search("q", "alice"), (e) => e instanceof RateLimitError && e.retryAfter === 5);
    const spent = Date.now() - t0;
    assert.ok(spent < 150, `spent ${spent}ms against a 200ms budget`);
  } finally {
    server.close();
  }
});

test("a clone keeps the signal and the deadline", async () => {
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
      `${js} carries ${lines.length} comment line(s). Keep removeComments on in ` +
        `tsconfig.json. First: ${lines[0]?.trim()}`
    );
  }
  const dts = read("../dist/wontopos.d.ts");
  const docs = (dts.match(/\/\*\*/g) ?? []).length;
  assert.ok(
    docs > 150,
    `dist/wontopos.d.ts has ${docs} doc comments. These are the hover text a customer ` +
      `reads in their editor, emitted by tsconfig.types.json with removeComments off. ` +
      `A build that strips them makes the SDK silent on hover.`
  );
  assert.ok(
    !/^\s*\/\//m.test(dts),
    "dist/wontopos.d.ts carries a line comment. Declaration emit should only carry doc " +
      "comments attached to exported declarations; a `//` here means something internal followed."
  );
});

test("a misspelled search option is refused before the wire", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const [bad, meant] of [["verfy", "verify"], ["max_image", "max_images"], ["speakr", "speaker"]]) {
      await assert.rejects(
        () => mem.search("q", "alice", 10, { [bad]: 1 }),
        (e) => e.message.includes(bad) && e.message.includes(meant),
        `${bad} must be refused and name ${meant}`
      );
    }
    assert.equal(seen.length, 0, "a refused option must not reach the wire");

    await mem.search("q", "alice", 10, { extra: { future_option: 1 } });
    const body = JSON.parse(seen[0].body);
    assert.equal(body.future_option, 1);
    assert.equal("extra" in body, false, "the wrapper itself must not travel");
  } finally {
    server.close();
  }
});

test("an argument the client refuses arrives as a rejection, never as a synchronous throw", async () => {
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9" });
  const calls = [
    ["delete", () => mem.delete("alice", "")],
    ["deleteAll", () => mem.deleteAll("")],
    ["deleteStore", () => mem.deleteStore("")],
    ["get", () => mem.get("alice", "")],
    ["getImage", () => mem.getImage("alice", "")],
    ["forgetImage", () => mem.forgetImage("alice", "")],
    ["lineage", () => mem.lineage("alice", "")],
    ["add", () => mem.add("hi", "   ")],
    ["engram", () => mem.engram("deep_recall", "q", "u", { fom: "memoir" })],
    ["add (bad image)", () => mem.add("hi", "alice", {}, { image: { data: 5 } })],
    ["add (bad key)", () => mem.add("hi", "alice", {}, { idempotencyKey: "no spaces allowed" })],
  ];
  for (const [name, call] of calls) {
    let sync = null;
    try {
      const p = call();
      assert.ok(p && typeof p.then === "function", `${name} did not return a promise`);
      await p.then(() => assert.fail(`${name} resolved`), () => {});
    } catch (e) {
      sync = e;
    }
    assert.equal(sync, null, `${name} threw synchronously: .catch() would not see it`);
  }
});

test("no promise-returning method is left synchronous", async () => {
  const src = readFileSync(new URL("../src/wontopos.ts", import.meta.url), "utf8");
  const lines = src.split("\n");
  const missed = [];
  const from = lines.findIndex((l) => l.startsWith("export class Client"));
  assert.ok(from > 0, "the Client class was not found");
  for (let i = from; i < lines.length; i++) {
    const m = /^  ([a-z][A-Za-z0-9_]*)\(/.exec(lines[i]);
    if (!m) continue;
    const head = lines[i].trimStart();
    if (/^(async|get |set |private|static|constructor)/.test(head)) continue;
    const ahead = lines.slice(i, i + 60).join("\n");
    const sig = ahead.slice(0, ahead.indexOf(" {\n") + 1);
    if (/\)\s*:\s*Promise</.test(sig)) missed.push(`${m[1]} (line ${i + 1})`);
  }
  assert.deepEqual(missed, [], `these return a promise and throw synchronously: ${missed.join(", ")}`);
});

test("listEngrams keeps a field this version does not name", async () => {
  const { server, base } = await scriptedServer([[200, {}, JSON.stringify({
    engrams: [{ name: "deep_recall" }],
    forms: [{ name: "memoir" }],
    note: null,
    a_field_added_later: { n: 7 },
  })]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const r = await mem.listEngrams();
    assert.deepEqual(r.a_field_added_later, { n: 7 }, "a field added later was dropped");
    assert.equal(r.engrams[0].name, "deep_recall", "the named shape still normalises");
    assert.equal(r.note, undefined, "a non-string note is still undefined");
  } finally {
    server.close();
  }
});

const errBody = (type, message, extra = {}) =>
  JSON.stringify({ type: "error", error: { type, message, request_id: "req_1", ...extra } });

test("a 409 that says another write was in flight is retried, writes included", async () => {
  const { server, seen, base } = await scriptedServer([
    [409, {}, errBody("conflict_error", "Another write is already in flight. Nothing was stored or changed.", { retry_after_ms: 100 })],
    [200, {}, '{"id":"m1","status":"stored"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const t0 = Date.now();
    const r = await mem.add("x", "alice");
    const spent = Date.now() - t0;
    assert.equal(r.id, "m1");
    assert.equal(seen.length, 2);
    assert.ok(spent >= 450, `retried after ${spent}ms`);
  } finally {
    server.close();
  }
});

test("a write-lock 409 waits retry_after_ms when that is longer than the backoff", async () => {
  const { server, seen, base } = await scriptedServer([
    [409, {}, errBody("conflict_error", "in flight", { retry_after_ms: 1200 })],
    [200, {}, '{"status":"stored"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const t0 = Date.now();
    await mem.addTurn("hi", "hello", "alice");
    assert.ok(Date.now() - t0 >= 1150, `retried after ${Date.now() - t0}ms`);
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("a 409 naming the store it collides with is not retried and says which", async () => {
  const { ConflictError } = await import(DIST);
  const { server, seen, base } = await scriptedServer([
    [409, {}, errBody("conflict_error", "Store id 'team_a' collides with existing store 'team-a'.", { conflicts_with: "team-a" })],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 3 });
    await assert.rejects(mem.createStore("team_a"), (e) => {
      assert.ok(e instanceof ConflictError);
      assert.equal(e.conflictsWith, "team-a");
      assert.equal(e.type, "conflict_error");
      assert.equal(e.requestId, "req_1");
      return true;
    });
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("a 409 without retry_after_ms, or with conflicts_with beside it, is not retried", async () => {
  const { ConflictError } = await import(DIST);
  const { server, seen, base } = await scriptedServer([
    [409, {}, errBody("conflict_error", "conflict")],
    [409, {}, errBody("conflict_error", "collides", { retry_after_ms: 100, conflicts_with: "team-a" })],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 3 });
    await assert.rejects(mem.add("x", "alice"), (e) => e instanceof ConflictError && e.conflictsWith === undefined);
    assert.equal(seen.length, 1);
    await assert.rejects(mem.add("x", "alice"), (e) => e instanceof ConflictError && e.conflictsWith === "team-a");
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("a write-lock 409 that the deadline cannot wait out is reported as the 409", async () => {
  const { ConflictError } = await import(DIST);
  const { server, seen, base } = await scriptedServer([
    [409, {}, errBody("conflict_error", "in flight", { retry_after_ms: 100 })],
    [200, {}, "{}"],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, deadlineMs: 300 });
    await assert.rejects(mem.add("x", "alice"), (e) => e instanceof ConflictError && e.status === 409);
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("a 429 whose Retry-After does not fit the deadline is reported as the 429", async () => {
  const { RateLimitError } = await import(DIST);
  const { server, seen, base } = await scriptedServer([
    [429, { "Retry-After": "5" }, errBody("rate_limit_error", "slow down")],
    [200, {}, "{}"],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, deadlineMs: 1000 });
    const t0 = Date.now();
    await assert.rejects(mem.add("x", "alice"), (e) => {
      assert.ok(e instanceof RateLimitError, String(e));
      assert.equal(e.status, 429);
      assert.equal(e.requestId, "req_1");
      assert.equal(e.retryAfter, 5);
      assert.match(e.message, /slow down/);
      return true;
    });
    assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0}ms`);
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("a GET whose backoff does not fit the deadline is reported as the 503", async () => {
  const { ServerError } = await import(DIST);
  const { server, seen, base } = await scriptedServer([
    [503, {}, errBody("overloaded_error", "busy")],
    [200, {}, '{"models":[]}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, deadlineMs: 200 });
    await assert.rejects(mem.listModels(), (e) => e instanceof ServerError && e.status === 503 && /busy/.test(e.message));
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("a deadline spent with no answer to report stays a status-0 deadline error", async () => {
  const tmp = net.createServer();
  await new Promise((r) => tmp.listen(0, "127.0.0.1", r));
  const port = tmp.address().port;
  await new Promise((r) => tmp.close(r));
  const mem = new Client({ apiKey: KEY, baseUrl: `http://127.0.0.1:${port}`, deadlineMs: 200 });
  await assert.rejects(mem.add("x", "alice"), (e) => e.status === 0 && /deadline of 200ms exhausted/.test(e.message));
});

function answerOnceThenHang(first) {
  const seen = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen.push(req.method);
      if (seen.length > 1) return;
      const [status, headers, payload] = first;
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(payload);
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  const close = () => {
    for (const s of sockets) s.destroy();
    server.close();
  };
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ seen, close, base: `http://127.0.0.1:${server.address().port}` })),
  );
}

test("a read whose retry the deadline cuts short reports the answer that led to it", async () => {
  const { RateLimitError } = await import(DIST);
  const { seen, close, base } = await answerOnceThenHang([429, { "Retry-After": "1" }, errBody("rate_limit_error", "slow down")]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, deadlineMs: 1500 });
    await assert.rejects(mem.listModels(), (e) => {
      assert.ok(e instanceof RateLimitError, String(e));
      assert.equal(e.status, 429);
      assert.equal(e.requestId, "req_1");
      assert.equal(e.retryAfter, 1);
      assert.match(e.message, /slow down/);
      return true;
    });
    assert.equal(seen.length, 2);
  } finally {
    close();
  }
});

test("getImage, a POST that only reads, reports the answer its cut-short retry followed", async () => {
  const { RateLimitError } = await import(DIST);
  const { seen, close, base } = await answerOnceThenHang([429, { "Retry-After": "1" }, errBody("rate_limit_error", "slow down")]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, deadlineMs: 1500 });
    await assert.rejects(mem.getImage("alice", "m1"), (e) => e instanceof RateLimitError && e.status === 429);
    assert.equal(seen.length, 2);
  } finally {
    close();
  }
});

test("a retry that drops with no time to back off reports the answer before it", async () => {
  const { RateLimitError } = await import(DIST);
  let n = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (n++ > 0) return req.socket.destroy();
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "0" });
      res.end(errBody("rate_limit_error", "slow down"));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: `http://127.0.0.1:${server.address().port}`, deadlineMs: 600 });
    await assert.rejects(mem.listModels(), (e) => e instanceof RateLimitError && e.status === 429);
    assert.equal(n, 2);
  } finally {
    server.close();
  }
});

test("a search, a POST that only reads, reports the answer its cut-short retry followed", async () => {
  const { RateLimitError } = await import(DIST);
  const { seen, close, base } = await answerOnceThenHang([429, { "Retry-After": "1" }, errBody("rate_limit_error", "slow down")]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, deadlineMs: 1500 });
    await assert.rejects(mem.search("q", "alice"), (e) => e instanceof RateLimitError && e.status === 429);
    assert.equal(seen.length, 2);
  } finally {
    close();
  }
});

test("a write whose retry the deadline cuts short stays a status-0 deadline error", async () => {
  const { seen, close, base } = await answerOnceThenHang([429, { "Retry-After": "1" }, errBody("rate_limit_error", "slow down")]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, deadlineMs: 1500 });
    await assert.rejects(mem.add("x", "alice"), (e) => e.status === 0 && /deadline of 1500ms exhausted/.test(e.message));
    assert.equal(seen.length, 2);
  } finally {
    close();
  }
});

test("a retry the deadline leaves no time to send reports the answer that led to it, writes included", async () => {
  const { RateLimitError } = await import(DIST);
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    let calls = 0;
    const canned = async () => {
      calls++;
      setTimeout(() => (skew = 120_000), 300);
      return new Response(errBody("rate_limit_error", "slow down"), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "1" },
      });
    };
    const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", deadlineMs: 60_000, fetch: canned });
    await assert.rejects(mem.add("x", "alice"), (e) => {
      assert.ok(e instanceof RateLimitError, String(e));
      assert.equal(e.status, 429);
      assert.equal(e.requestId, "req_1");
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    Date.now = realNow;
  }
});

function brokenErrorBodyServer(status, { stall = false } = {}) {
  const conns = [];
  const sockets = new Set();
  const server = net.createServer((sock) => {
    conns.push(1);
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {});
    sock.once("data", () => {
      sock.write(
        `HTTP/1.1 ${status} X\r\nContent-Type: application/json\r\nContent-Length: 400\r\n\r\n` +
          '{"type":"error","error":{"type":"conflict_error","message":"cut',
      );
      if (!stall) setTimeout(() => sock.destroy(), 20);
    });
  });
  const close = () => {
    for (const s of sockets) s.destroy();
    server.close();
  };
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ conns, close, base: `http://127.0.0.1:${server.address().port}` })),
  );
}

test("an error answer whose body is cut off keeps its status", async () => {
  const { ConflictError, NotFoundError, ServerError } = await import(DIST);
  let s = await brokenErrorBodyServer(409);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: s.base, maxRetries: 2 });
    await assert.rejects(mem.add("x", "alice"), (e) => {
      assert.ok(e instanceof ConflictError, String(e));
      assert.equal(e.status, 409);
      assert.match(e.message, /HTTP 409 \(the error body could not be read: /);
      return true;
    });
    assert.equal(s.conns.length, 1);
  } finally {
    s.close();
  }
  s = await brokenErrorBodyServer(404);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: s.base, maxRetries: 2 });
    await assert.rejects(mem.listModels(), (e) => e instanceof NotFoundError && e.status === 404);
    assert.equal(s.conns.length, 1);
  } finally {
    s.close();
  }
  s = await brokenErrorBodyServer(503);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: s.base, maxRetries: 1 });
    await assert.rejects(mem.listModels(), (e) => e instanceof ServerError && e.status === 503);
    assert.equal(s.conns.length, 2);
  } finally {
    s.close();
  }
});

test("an error answer whose body stalls past the timeout keeps its status", async () => {
  const { ConflictError } = await import(DIST);
  const s = await brokenErrorBodyServer(409, { stall: true });
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: s.base, timeoutMs: 150 });
    await assert.rejects(mem.add("x", "alice"), (e) => {
      assert.ok(e instanceof ConflictError, String(e));
      assert.match(e.message, /could not be read: request timed out after 150ms/);
      return true;
    });
    assert.equal(s.conns.length, 1);
  } finally {
    s.close();
  }
});

test("a cancel while an error body is streaming still says cancelled", async () => {
  const s = await brokenErrorBodyServer(409, { stall: true });
  try {
    const ctrl = new AbortController();
    const mem = new Client({ apiKey: KEY, baseUrl: s.base, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 80);
    await assert.rejects(mem.add("x", "alice"), (e) => e.status === 0 && /cancelled/.test(e.message));
  } finally {
    s.close();
  }
});

function stalledErrorThenOkServer(status, ok) {
  const seen = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen.push(req.method);
      if (seen.length === 1) {
        res.writeHead(status, { "Content-Type": "application/json", "Content-Length": "50", "Retry-After": "0" });
        res.write("{");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(ok);
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  const close = () => {
    for (const s of sockets) s.destroy();
    server.close();
  };
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ seen, close, base: `http://127.0.0.1:${server.address().port}` })),
  );
}

test("a retried answer does not wait out its stalled error body", async () => {
  const cases = [
    [429, (m) => m.add("x", "alice"), '{"id":"m1","status":"stored"}'],
    [503, (m) => m.listModels(), '{"models":[]}'],
  ];
  for (const [status, call, ok] of cases) {
    const s = await stalledErrorThenOkServer(status, ok);
    try {
      const mem = new Client({ apiKey: KEY, baseUrl: s.base, timeoutMs: 6_000 });
      const t0 = Date.now();
      await call(mem);
      const spent = Date.now() - t0;
      assert.equal(s.seen.length, 2);
      assert.ok(spent < 2_500, `${status}: the retry went out after ${spent}ms`);
    } finally {
      s.close();
    }
  }
});

test("a retried answer whose custom body never finishes is not waited on either", async () => {
  let calls = 0;
  const never = () => new Promise(() => {});
  const stub = async () => {
    calls++;
    const headers = new Headers({ "Retry-After": "0" });
    if (calls === 1) return { status: 429, ok: false, headers, body: null, arrayBuffer: never };
    if (calls === 2) {
      const body = { getReader: () => ({ read: never, cancel: async () => {} }), cancel: async () => {} };
      return { status: 503, ok: false, headers, body, arrayBuffer: never };
    }
    return new Response('{"models":[]}', { status: 200 });
  };
  const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", timeoutMs: 6_000, fetch: stub });
  const t0 = Date.now();
  assert.deepEqual(await mem.listModels(), []);
  assert.equal(calls, 3);
  assert.ok(Date.now() - t0 < 4_000, `took ${Date.now() - t0}ms`);
});

test("a final error answer still waits for its body under the attempt's timeout", async () => {
  const { RateLimitError } = await import(DIST);
  const s = await stalledErrorThenOkServer(429, "{}");
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: s.base, timeoutMs: 1_500, maxRetries: 0 });
    const t0 = Date.now();
    await assert.rejects(mem.add("x", "alice"), (e) => {
      assert.ok(e instanceof RateLimitError, String(e));
      assert.match(e.message, /could not be read: request timed out after 1500ms/);
      return true;
    });
    assert.ok(Date.now() - t0 >= 1_400);
    assert.equal(s.seen.length, 1);
  } finally {
    s.close();
  }
});

test("a 409 reads its whole body, however slowly it arrives, to learn whether to retry", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen.push(req.method);
      if (seen.length > 1) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"id":"m1","status":"stored"}');
        return;
      }
      res.writeHead(409, { "Content-Type": "application/json" });
      res.write('{"type":"error",');
      setTimeout(() => res.end(`"error":${JSON.stringify({ type: "conflict_error", message: "busy", retry_after_ms: 0 })}}`), 1_300);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 6_000 });
    const r = await mem.add("x", "alice");
    assert.equal(r.id ?? r.memory_id, "m1");
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("conflictsWith survives an error object too big to keep whole", async () => {
  const { ConflictError } = await import(DIST);
  const { server, base } = await scriptedServer([
    [409, {}, errBody("conflict_error", "collides", { hint: "h".repeat(9000), conflicts_with: "team-a" })],
    [409, {}, errBody("conflict_error", "collides", {
      a: "a".repeat(4000), b: "b".repeat(4000), c: "c".repeat(4000), conflicts_with: "team-a",
    })],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.createStore("team_a"), (e) => {
      assert.ok(e instanceof ConflictError, String(e));
      assert.equal(e.conflictsWith, "team-a");
      assert.ok(e.details.hint.length <= 4096 + "…(truncated)".length);
      return true;
    });
    await assert.rejects(mem.createStore("team_a"), (e) => {
      assert.equal(e.conflictsWith, "team-a");
      assert.ok(JSON.stringify(e.details).length <= 8192, `${JSON.stringify(e.details).length} chars`);
      assert.deepEqual(Object.keys(e.details), ["a", "b", "conflicts_with"]);
      return true;
    });
  } finally {
    server.close();
  }
});

test("a Retry-After beyond the backoff cap raises at once, with retryAfter", async () => {
  const { RateLimitError } = await import(DIST);
  const later = new Date(Date.now() + 3_600_000).toUTCString();
  const { server, seen, base } = await scriptedServer([
    [429, { "Retry-After": "3600" }, errBody("rate_limit_error", "hourly cap")],
    [429, { "Retry-After": later }, errBody("rate_limit_error", "hourly cap")],
    [200, {}, "{}"],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const t0 = Date.now();
    await assert.rejects(mem.usage(7), (e) => e instanceof RateLimitError && e.retryAfter === 3600);
    assert.equal(seen.length, 1);
    await assert.rejects(mem.usage(7), (e) => e instanceof RateLimitError && e.retryAfter > 3590 && e.retryAfter <= 3601);
    assert.equal(seen.length, 2);
    assert.ok(Date.now() - t0 < 1000, `slept ${Date.now() - t0}ms`);
  } finally {
    server.close();
  }
});

test("RateLimitError carries the Retry-After it was given, and nothing when there was none", async () => {
  const { RateLimitError } = await import(DIST);
  const { server, base } = await scriptedServer([
    [429, { "Retry-After": "7" }, errBody("rate_limit_error", "slow down")],
    [429, {}, errBody("rate_limit_error", "slow down")],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0 });
    await assert.rejects(mem.stats("alice"), (e) => e instanceof RateLimitError && e.retryAfter === 7);
    await assert.rejects(mem.stats("alice"), (e) => e instanceof RateLimitError && e.retryAfter === undefined);
  } finally {
    server.close();
  }
});

test("a Retry-After that is neither seconds nor an HTTP-date falls back to the backoff", async () => {
  await Promise.all(
    ["-5", "5, 10", "0x2", "garbage", "1.5", ""].map(async (v) => {
      const { server, seen, base } = await scriptedServer([
        [429, { "Retry-After": v }, "{}"],
        [200, {}, "{}"],
      ]);
      try {
        const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 1 });
        const t0 = Date.now();
        await mem.stats("alice");
        const spent = Date.now() - t0;
        assert.equal(seen.length, 2);
        assert.ok(spent >= 450 && spent < 1500, `${JSON.stringify(v)}: waited ${spent}ms`);
      } finally {
        server.close();
      }
    }),
  );
});

test("an error keeps the service's type and the rest of its error object", async () => {
  const { ServerError } = await import(DIST);
  const { server, base } = await scriptedServer([
    [501, {}, JSON.stringify({ type: "error", error: { type: "api_error", message: "not on this model", model: "tablet-1", endpoint: "images", request_id: "req_9" } })],
    [400, {}, '{"error":"plain reason"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.listMemories("alice"), (e) => {
      assert.ok(e instanceof ServerError);
      assert.equal(e.type, "api_error");
      assert.deepEqual(e.details, { model: "tablet-1", endpoint: "images" });
      assert.equal(e.requestId, "req_9");
      return true;
    });
    await assert.rejects(mem.stats("alice"), (e) => {
      assert.equal(e.type, undefined);
      assert.equal(e.details, undefined);
      assert.match(e.message, /plain reason/);
      return true;
    });
  } finally {
    server.close();
  }
});

test("413 and 422 are BadRequestError; an object message falls back to the type", async () => {
  const { BadRequestError, NotFoundError } = await import(DIST);
  const { server, base } = await scriptedServer([
    [413, {}, errBody("invalid_request_error", "Request body too large (max 10MB)")],
    [422, {}, errBody("invalid_request_error", "Idempotency-Key reused with a different request body.")],
    [404, {}, JSON.stringify({ type: "error", error: { type: "not_found_error", message: { nested: true } } })],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.add("x", "alice"), (e) => e instanceof BadRequestError && e.status === 413);
    await assert.rejects(mem.add("x", "alice"), (e) => e instanceof BadRequestError && e.status === 422);
    await assert.rejects(mem.stats("alice"), (e) =>
      e instanceof NotFoundError && /not_found_error/.test(e.message) && !/object Object/.test(e.message));
  } finally {
    server.close();
  }
});

test("a blank error field is skipped and a top-level message is read", async () => {
  const cases = [
    ['{"error":{"type":"invalid_request_error","message":"","request_id":"req_e"}}', "[400] invalid_request_error (request_id: req_e)"],
    ['{"error":""}', "[400] HTTP 400"],
    ['{"error":{"type":"t","message":"  ","request_id":"  "}}', "[400] t"],
    ['{"error":"  "}', "[400] HTTP 400"],
    ["  ", "[400] HTTP 400"],
    ['{"message":"m"}', "[400] m"],
    ['{"message":""}', '[400] {"message":""}'],
  ];
  const { server, base } = await scriptedServer(cases.map(([body]) => [400, {}, body]));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const [body, want] of cases) {
      await assert.rejects(mem.add("x", "alice"), (e) => e instanceof WosError && e.message === want, body);
    }
  } finally {
    server.close();
  }
});

test("getImage errors carry the request id and type like every other call", async () => {
  const { NotFoundError } = await import(DIST);
  const { server, base } = await scriptedServer([[404, {}, errBody("not_found_error", "Not found.")]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.getImage("alice", "m1"), (e) =>
      e instanceof NotFoundError && e.requestId === "req_1" && e.type === "not_found_error");
  } finally {
    server.close();
  }
});

test("control characters in the service's error text do not reach the message", async () => {
  const hostile = JSON.stringify({ error: { message: "boom\u001b[31mRED\r\nInjected: line\u007f", request_id: "r\u001b-1" } });
  const { server, base } = await scriptedServer([[500, {}, hostile], [500, {}, hostile]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const call of [() => mem.stats("alice"), () => mem.getImage("alice", "m1")]) {
      await assert.rejects(call(), (e) => {
        assert.ok(!/[\u0000-\u001f\u007f]/.test(e.message), JSON.stringify(e.message));
        assert.match(e.message, /boom/);
        return true;
      });
    }
  } finally {
    server.close();
  }
});

test("a 2xx body that is not JSON: its text reaches the message without control characters", async () => {
  const { server, base } = await scriptedServer([[200, {}, "\u001b[31mFAKE\nwontopos: ok\u007f"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.stats("alice"), (e) => {
      assert.ok(e instanceof WosError);
      assert.match(e.message, /invalid JSON in response/);
      assert.ok(!/[\u0000-\u001f\u007f]/.test(e.message), JSON.stringify(e.message));
      return true;
    });
  } finally {
    server.close();
  }
});

test("an error's type and details are cleaned and bounded like its message", async () => {
  const bigType = "t\u001b[2J".repeat(200);
  const { server, base } = await scriptedServer([
    [500, {}, JSON.stringify({ error: { message: "x", type: bigType, blob: "A".repeat(200_000) } })],
    [500, {}, JSON.stringify({ error: { message: "x", type: "api_error", hint: "a\u001b[31m\nb", nested: { "k\u0007": ["c\rd"] } } })],
    [500, {}, '{"error":{"message":"x","__proto__":{"polluted":true}}}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0 });
    await assert.rejects(mem.stats("alice"), (e) => {
      assert.ok(!/[\u0000-\u001f\u007f]/.test(e.type), JSON.stringify(e.type));
      assert.ok(e.type.length <= 256 + "…(truncated)".length, `type is ${e.type.length} chars`);
      const logged = JSON.stringify(e);
      assert.ok(logged.length < 16_384, `the serialized error is ${logged.length} chars`);
      return true;
    });
    await assert.rejects(mem.stats("alice"), (e) => {
      assert.equal(e.type, "api_error");
      assert.deepEqual(e.details, { hint: "a[31mb", nested: { k: ["cd"] } });
      return true;
    });
    await assert.rejects(mem.stats("alice"), (e) => {
      assert.equal(Object.getPrototypeOf(e.details), Object.prototype);
      assert.equal(e.details.polluted, undefined);
      assert.deepEqual(Object.keys(e.details), ["__proto__"]);
      return true;
    });
  } finally {
    server.close();
  }
});

test("a DELETE retried after a 502 that then answers 404 says it may already be gone", async () => {
  const { NotFoundError } = await import(DIST);
  const { server, seen, base } = await scriptedServer([
    [502, { "Retry-After": "0" }, errBody("api_error", "bad gateway")],
    [404, {}, errBody("not_found_error", "Store not found.")],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.deleteStore("tenant_a"), (e) =>
      e instanceof NotFoundError && e.message.endsWith("(an earlier attempt may already have deleted it)"));
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("a DELETE retried after a dropped connection that then answers 404 says so too", async () => {
  let n = 0;
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      n += 1;
      if (n === 1) return req.socket.destroy();
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(errBody("not_found_error", "speaker 'Bob' is not registered"));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: `http://127.0.0.1:${server.address().port}` });
    await assert.rejects(mem.removeSpeaker("Bob", "alice"), (e) =>
      e.status === 404 && e.message.endsWith("(an earlier attempt may already have deleted it)"));
    assert.equal(n, 2);
  } finally {
    server.close();
  }
});

test("removing the store's default speaker is a ConflictError carrying speaker_is_default, not retried", async () => {
  const { ConflictError } = await import(DIST);
  const { server, seen, base } = await scriptedServer([
    [409, {}, errBody("conflict_error", "Wren is the store's default speaker.", { code: "speaker_is_default" })],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.removeSpeaker("Wren", "alice"), (e) =>
      e instanceof ConflictError && e.status === 409 && e.details?.code === "speaker_is_default");
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("a forgetImage preview retried into a 404 carries no note; a real forgetImage does", async () => {
  const { NotFoundError } = await import(DIST);
  const { server, seen, base } = await scriptedServer([
    [503, { "Retry-After": "0" }, errBody("api_error", "unavailable")],
    [404, {}, errBody("not_found_error", "no")],
    [503, { "Retry-After": "0" }, errBody("api_error", "unavailable")],
    [404, {}, errBody("not_found_error", "no")],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.forgetImage("alice", "m1", { preview: true }), (e) =>
      e instanceof NotFoundError && !/earlier attempt/.test(e.message));
    assert.equal(JSON.parse(seen[1].body).preview, true);
    await assert.rejects(mem.forgetImage("alice", "m1"), (e) =>
      e instanceof NotFoundError && e.message.endsWith("(an earlier attempt may already have deleted it)"));
    assert.equal(seen.length, 4);
  } finally {
    server.close();
  }
});

test("a 404 on a DELETE's first attempt, or after a 429, carries no such note", async () => {
  const { server, base } = await scriptedServer([
    [404, {}, errBody("not_found_error", "Store not found.")],
    [429, { "Retry-After": "0" }, errBody("rate_limit_error", "slow down")],
    [404, {}, errBody("not_found_error", "Store not found.")],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.deleteStore("tenant_a"), (e) => e.status === 404 && !/earlier attempt/.test(e.message));
    await assert.rejects(mem.deleteStore("tenant_a"), (e) => e.status === 404 && !/earlier attempt/.test(e.message));
  } finally {
    server.close();
  }
});

test("the constructor refuses userId: undefined, like withUser(undefined)", () => {
  assert.throws(() => new Client({ apiKey: KEY, userId: undefined }), /needs a store id/);
  assert.throws(() => new Client({ apiKey: KEY, userId: process.env.WONTOPOS_TEST_UNSET_STORE }), /needs a store id/);
  assert.equal(new Client({ apiKey: KEY }).toJSON().userId, "default", "leaving the option out is still the default store");
});

test("a timeout that is not a positive number means the default; Infinity is clamped", () => {
  for (const unset of [NaN, -Infinity, 0, -1, "30000", null, undefined]) {
    assert.equal(new Client({ apiKey: KEY, timeoutMs: unset }).timeoutMs, 30_000, `timeoutMs ${String(unset)}`);
    assert.equal(new Client({ apiKey: KEY, deadlineMs: unset }).deadlineMs, undefined, `deadlineMs ${String(unset)}`);
  }
  assert.equal(new Client({ apiKey: KEY, timeoutMs: Infinity }).timeoutMs, 2_147_483_647);
  const mem = new Client({ apiKey: KEY });
  assert.equal(mem.withTimeout(NaN).timeoutMs, 30_000);
  assert.equal(mem.withDeadline(0).deadlineMs, undefined);
});

test("a timeout past the timer ceiling is clamped, not turned into 1ms", async () => {
  const { server, base } = await scriptedServer([[200, {}, '{"memories":[]}']]);
  const warnings = [];
  const onWarning = (w) => warnings.push(w.name);
  process.on("warning", onWarning);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, timeoutMs: 3e9, deadlineMs: 1e12 });
    assert.deepEqual(await mem.search("q", "alice"), []);
    await new Promise((r) => setImmediate(r));
    assert.ok(!warnings.includes("TimeoutOverflowWarning"), warnings.join(","));
  } finally {
    process.off("warning", onWarning);
    server.close();
  }
});

test("a baseUrl without two slashes after its scheme is refused, as Python and Rust refuse it", () => {
  const warns = [];
  const save = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    for (const bad of ["http:/example.net:9", "http:example.net", "HTTPS:api.wontopos.com", "https:///api.wontopos.com", "http:127.0.0.1:9"]) {
      assert.throws(() => new Client({ apiKey: KEY, baseUrl: bad }), /^Error: baseUrl is not a URL/, bad);
    }
    assert.equal(warns.length, 0);
    new Client({ apiKey: KEY, baseUrl: "http://example.net:9" });
    new Client({ apiKey: KEY, baseUrl: "https://example.com" });
    new Client({ apiKey: KEY, baseUrl: "http://localhost:9" });
    assert.equal(warns.length, 1);
  } finally {
    console.warn = save;
  }
});

test("a baseUrl with whitespace, a control character or a backslash inside it is refused", () => {
  for (const bad of [
    "http://example.net:9\\@localhost",
    "http://exa\tmple.com",
    "http://a.exa\nmple",
    "http://exa mple.com",
    "http://example.com/a b",
    "http://a.example\u0000/x",
    "http://a.example/x\u0000",
    "\u0001http://a.example",
    "\thttp://exa\r\nmple.com\n",
  ]) {
    assert.throws(
      () => new Client({ apiKey: KEY, baseUrl: bad }),
      /^Error: baseUrl contains whitespace, a backslash or a control character/,
      JSON.stringify(bad),
    );
  }
});

test("a baseUrl read from a file or an env var works: whitespace at its ends is trimmed", async () => {
  const { server, seen, base } = await scriptedServer([]);
  const shapes = [`${base}\n`, `${base}\r\n`, `${base}/\n`, `\t${base}`, ` ${base} `, `\n${base}//\r\n`];
  try {
    for (const raw of shapes) {
      const mem = new Client({ apiKey: KEY, baseUrl: raw, maxRetries: 0 });
      assert.equal(mem.toJSON().baseUrl, base, JSON.stringify(raw));
      assert.deepEqual(await mem.listModels(), [], JSON.stringify(raw));
    }
    assert.deepEqual(
      seen.map((r) => r.path),
      shapes.map(() => "/api/v1/models"),
    );
  } finally {
    server.close();
  }
});

test("a baseUrl fetch cannot parse is refused at construction, not retried as an outage", () => {
  for (const bad of ["http://[bad", "http://exa%mple.com", "https://api.wontopos.com:port", "//[bad"]) {
    let calls = 0;
    const counting = async () => {
      calls++;
      return new Response("{}", { status: 200 });
    };
    assert.throws(() => new Client({ apiKey: KEY, baseUrl: bad, fetch: counting }), /baseUrl is not a URL/, JSON.stringify(bad));
    assert.equal(calls, 0);
  }
  assert.throws(
    () => new Client({ apiKey: KEY, baseUrl: "http://me:hunter2@[bad" }),
    (e) => /baseUrl is not a URL/.test(e.message) && !e.message.includes("hunter2"),
  );
});

test("a page-relative baseUrl is accepted where the runtime has a page to resolve it against", async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value: { href: "https://app.example/dash/page" }, configurable: true });
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: "/wos" });
    assert.equal(mem.toJSON().baseUrl, "/wos");
    for (const rel of ["./proxy", "proxy", "../wos/", "/wos", "", "api.wontopos.com"]) {
      const urls = [];
      const paged = new Client({
        apiKey: KEY,
        baseUrl: rel,
        fetch: async (u) => {
          urls.push(u);
          return new Response('{"collections":[]}', { status: 200 });
        },
      });
      assert.deepEqual(await paged.listStores(), [], JSON.stringify(rel));
      assert.deepEqual(urls, [`${rel.replace(/\/+$/, "")}/api/v1/memory/collections`]);
    }
    assert.throws(() => new Client({ apiKey: KEY, baseUrl: "localhost:8080" }), /baseUrl is not a URL/);
  } finally {
    if (had) Object.defineProperty(globalThis, "location", had);
    else delete globalThis.location;
  }
});

test("a runtime whose location throws when read still gets the baseUrl message", async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    get() {
      throw new ReferenceError('Access to "location", run again with --location <href>.');
    },
    configurable: true,
  });
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: "api.wontopos.com" });
    await assert.rejects(mem.listStores(), (e) => !(e instanceof WosError) && /baseUrl is not a URL/.test(e.message));
    assert.throws(() => new Client({ apiKey: KEY, baseUrl: "http://[bad" }), /^Error: baseUrl is not a URL/);
    assert.equal(new Client({ apiKey: KEY, baseUrl: "https://api.wontopos.com" }).toJSON().baseUrl, "https://api.wontopos.com");
  } finally {
    if (had) Object.defineProperty(globalThis, "location", had);
    else delete globalThis.location;
  }
});

test("a relative baseUrl where the runtime has no page constructs, and its first call fails before sending", async () => {
  const { WosError } = await import(DIST);
  assert.equal(globalThis.location, undefined);
  const had = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"collections":[]}', { status: 200 });
  };
  try {
    for (const rel of ["/api/wos", "./api", "mock", "api.wontopos.com", "", "//u:hunter2@proxy.example.com"]) {
      const mem = new Client({ apiKey: KEY, baseUrl: rel, maxRetries: 3 });
      for (const c of [mem, mem.withModel("scroll-1")]) {
        const t0 = Date.now();
        await assert.rejects(
          c.listStores(),
          (e) => {
            assert.ok(e instanceof Error && !(e instanceof WosError), e.message);
            assert.match(e.message, /baseUrl is not a URL: .* \(expected e\.g\. https:\/\/api\.wontopos\.com\)/);
            assert.ok(!e.message.includes("hunter2"), e.message);
            return true;
          },
          JSON.stringify(rel),
        );
        assert.ok(Date.now() - t0 < 150, "the call was retried");
      }
    }
    assert.equal(calls, 0, "a request was sent");
  } finally {
    globalThis.fetch = had;
  }
});

test("a relative baseUrl where the runtime has no page goes to a caller-supplied fetch as given", async () => {
  for (const rel of ["/api/wos", "./api", "mock", ""]) {
    const urls = [];
    const mem = new Client({
      apiKey: KEY,
      baseUrl: rel,
      fetch: async (u) => {
        urls.push(u);
        return new Response('{"collections":[]}', { status: 200 });
      },
    });
    assert.deepEqual(await mem.listStores(), [], JSON.stringify(rel));
    assert.deepEqual(await mem.withModel("scroll-1").listStores(), [], JSON.stringify(rel));
    assert.deepEqual(urls, [`${rel}/api/v1/memory/collections`, `${rel}/api/v1/memory/collections`]);
  }
});

test("a baseUrl whose scheme is not http or https is refused at construction", () => {
  for (const bad of ["localhost:8080", "ftp://api.wontopos.com", "mailto:ops@example.com", "file:///tmp/wos", "data:,x"]) {
    let calls = 0;
    const counting = async () => {
      calls++;
      return new Response("{}", { status: 200 });
    };
    assert.throws(
      () => new Client({ apiKey: KEY, baseUrl: bad, fetch: counting }),
      (e) => /^baseUrl is not a URL: .* \(expected e\.g\. https:\/\/api\.wontopos\.com\)$/.test(e.message),
      JSON.stringify(bad),
    );
    assert.equal(calls, 0);
  }
});

test("no error shows the password in a baseUrl's userinfo", async () => {
  for (const bad of [
    "https://u:hunter2@proxy.exa\nmple.com",
    "https://u:hun ter2@proxy.example.com",
    "https://u:hunter2@proxy.example.com\\x",
    "ftp://u:hunter2@proxy.example.com",
    "u:hunter2@proxy.example.com:8080",
    "http://me:hunter2@[bad",
    "http:/u:hunter2@proxy.exa mple.com",
    "http:u:hunter2@proxy.exa mple.com",
    "//u:hunter2@proxy.exa mple.com",
    "https://u:hunter2/x@proxy.example.com",
    "http:/u:hunter2@127.0.0.1:9",
    "http:u:hunter2@127.0.0.1:9",
    "HTTP:///u:hunter2@127.0.0.1:9",
    "http:/u:hunter2@127.0.0.1:9\n",
    "https:/u:hunter2@proxy.example.com",
    "https:u:hunter2@proxy.example.com",
  ]) {
    assert.throws(
      () => new Client({ apiKey: KEY, baseUrl: bad }),
      (e) => /baseUrl/.test(e.message) && !/hun|ter2/.test(e.message) && e.message.includes("***@"),
      JSON.stringify(bad),
    );
  }
  for (const base of ["http://u:hunter2@127.0.0.1:9", "HTTP://u:hunter2@127.0.0.1:9\n"]) {
    const mem = new Client({ apiKey: KEY, baseUrl: base, maxRetries: 0 });
    await assert.rejects(
      mem.stats("alice"),
      (e) => {
        assert.equal(e.status, 0);
        assert.ok(!e.message.includes("hunter2"), e.message);
        assert.ok(e.message.includes("***@"), e.message);
        assert.ok(!String(e.cause?.message ?? "").includes("hunter2"), "the cause carries the password");
        return true;
      },
      JSON.stringify(base),
    );
  }
  for (const base of ["https://u:hunter2@proxy.example.com", "HTTPS://u:hunter2@proxy.example.com/"]) {
    const custom = new Client({
      apiKey: KEY,
      baseUrl: base,
      maxRetries: 0,
      fetch: async (u) => {
        throw new Error(`request to ${u} failed`);
      },
    });
    await assert.rejects(
      custom.stats("alice"),
      (e) => !e.message.includes("hunter2") && e.message.includes("***@"),
      JSON.stringify(base),
    );
  }
  for (const filler of ["a".repeat(200_000), "a:".repeat(100_000), `${"a:".repeat(100_000)}/`]) {
    const long = new Client({
      apiKey: KEY,
      baseUrl: "https://u:hunter2@proxy.example.com",
      maxRetries: 0,
      fetch: async (u) => {
        throw new Error(`http:/u:hunter2@h ${filler}@x ${u}`);
      },
    });
    const t0 = Date.now();
    await assert.rejects(long.stats("alice"), (e) => !e.message.includes("hunter2") && e.message.startsWith("[0] network error: http:/***@h "));
    assert.ok(Date.now() - t0 < 1_000, `masking took ${Date.now() - t0}ms`);
  }
  const plain = new Client({
    apiKey: KEY,
    baseUrl: "http://127.0.0.1:9",
    maxRetries: 0,
    fetch: async () => {
      throw new Error("mail ops@example.com");
    },
  });
  await assert.rejects(plain.stats("alice"), (e) => e.message.includes("ops@example.com"));
});

test("a POST without a key whose socket failed after connecting is not re-sent", async () => {
  const { APIConnectionError } = await import(DIST);
  for (const [code, syscall] of [["EHOSTUNREACH", "read"], ["ECONNREFUSED", "write"], ["ENETUNREACH", undefined]]) {
    let calls = 0;
    const mem = new Client({
      apiKey: KEY,
      baseUrl: "http://127.0.0.1:9",
      maxRetries: 2,
      fetch: async () => {
        calls += 1;
        throw new TypeError("fetch failed", { cause: Object.assign(new Error(`${syscall} ${code}`), { code, syscall }) });
      },
    });
    await assert.rejects(mem.createStore("alice"), (e) => e instanceof APIConnectionError);
    assert.equal(calls, 1, `${code}/${syscall} was re-sent`);
  }
});

test("a memory write whose socket failed after connecting is re-sent under the same key", async () => {
  const { APIConnectionError } = await import(DIST);
  const keys = [];
  const mem = new Client({
    apiKey: KEY,
    baseUrl: "http://127.0.0.1:9",
    maxRetries: 2,
    fetch: async (_url, init) => {
      keys.push(init.headers["Idempotency-Key"]);
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("read EHOSTUNREACH"), { code: "EHOSTUNREACH", syscall: "read" }) });
    },
  });
  await assert.rejects(mem.add("hi", "alice"), (e) => e instanceof APIConnectionError);
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys).size, 1);
  assert.match(keys[0], /^sdk-[0-9a-f]{32}$/);
});

test("a POST that never connected is re-sent", async () => {
  const cases = [
    ["EHOSTUNREACH", "connect"],
    ["ECONNREFUSED", "connect"],
    ["ENOTFOUND", "getaddrinfo"],
    ["EAI_AGAIN", undefined],
    ["UND_ERR_CONNECT_TIMEOUT", undefined],
    ["aggregate", undefined],
  ];
  await Promise.all(
    cases.map(async ([code, syscall]) => {
      let calls = 0;
      const cause =
        code === "aggregate"
          ? Object.assign(
              new AggregateError([
                Object.assign(new Error("connect ECONNREFUSED ::1"), { code: "ECONNREFUSED", syscall: "connect" }),
                Object.assign(new Error("connect ECONNREFUSED 127.0.0.1"), { code: "ECONNREFUSED", syscall: "connect" }),
              ]),
              { code: "ECONNREFUSED" },
            )
          : Object.assign(new Error(code), { code, syscall });
      const mem = new Client({
        apiKey: KEY,
        baseUrl: "http://127.0.0.1:9",
        maxRetries: 1,
        fetch: async () => {
          calls += 1;
          throw new TypeError("fetch failed", { cause });
        },
      });
      await assert.rejects(mem.add("hi", "alice"));
      assert.equal(calls, 2, `${code}/${syscall} was not retried`);
    }),
  );
});

test("a network error names its cause code and keeps the cause", async () => {
  const { APIConnectionError } = await import(DIST);
  const tmp = net.createServer();
  await new Promise((r) => tmp.listen(0, "127.0.0.1", r));
  const port = tmp.address().port;
  await new Promise((r) => tmp.close(r));
  const mem = new Client({ apiKey: KEY, baseUrl: `http://127.0.0.1:${port}`, maxRetries: 0 });
  await assert.rejects(mem.add("hi", "alice"), (e) => {
    assert.ok(e instanceof APIConnectionError);
    assert.match(e.message, /network error: fetch failed \(ECONNREFUSED\)/);
    assert.ok(e.cause, "the transport error is kept as the cause");
    return true;
  });
});

test("a network error never carries the query string", async () => {
  const mem = new Client({
    apiKey: KEY,
    baseUrl: "http://127.0.0.1:9",
    maxRetries: 0,
    fetch: async (url) => {
      throw new Error(`request to ${url} failed, reason: socket hang up`);
    },
  });
  await assert.rejects(mem.listSpeakers("jane.doe@example.com"), (e) => {
    assert.match(e.message, /network error/);
    assert.ok(!/jane|user_id=|\?/.test(e.message), e.message);
    assert.equal(e.cause, undefined, "the transport error quotes the URL, so it is not kept");
    assert.ok(!/jane|user_id=/.test(inspect(e)), "the printed error carries the query");
    return true;
  });
});

test("a custom fetch that follows a redirect cannot hand back the redirected answer", async () => {
  const b = await scriptedServer([[200, {}, '{"collections":[]}']]);
  const a = await scriptedServer([[302, { Location: `${b.base}/elsewhere` }, ""]]);
  try {
    const mem = new Client({
      apiKey: KEY,
      baseUrl: a.base,
      fetch: (u, init) => fetch(u, { method: init.method, headers: init.headers, body: init.body, signal: init.signal }),
    });
    await assert.rejects(mem.listStores(), (e) => e instanceof WosError && /redirect/.test(e.message));
  } finally {
    a.server.close();
    b.server.close();
  }
});

test("a custom fetch may send the request elsewhere; a redirect it followed is still refused", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, '{"collections":[]}']]);
  try {
    const rewrite = new Client({
      apiKey: KEY,
      baseUrl: "http://wos.invalid:1",
      fetch: (u, init) => fetch(u.replace("http://wos.invalid:1", base), init),
    });
    assert.deepEqual(await rewrite.listStores(), []);
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
  const answer = (props) => async () => {
    const r = new Response('{"collections":[]}', { status: 200, headers: { "Content-Type": "application/json" } });
    for (const [k, v] of Object.entries(props)) Object.defineProperty(r, k, { value: v });
    return r;
  };
  const away = new Client({
    apiKey: KEY,
    baseUrl: "http://127.0.0.1:9",
    fetch: answer({ url: "https://elsewhere.example/api/v1/memory/collections" }),
  });
  assert.deepEqual(await away.listStores(), []);
  for (const props of [{ redirected: true }, { type: "opaqueredirect" }]) {
    const mem = new Client({ apiKey: KEY, baseUrl: "http://127.0.0.1:9", fetch: answer(props) });
    await assert.rejects(mem.listStores(), (e) => e instanceof WosError && /redirect/.test(e.message), JSON.stringify(props));
  }
});

test("page sizes outside the service's range are refused before the wire", async () => {
  const { server, seen, base } = await scriptedServer([]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const bad of [0, 4, 21, 100, 2.5, NaN, true, "10"]) {
      const at = `limit ${JSON.stringify(bad)}`;
      await assert.rejects(() => mem.listImages("alice", { limit: bad }), /between 5 and 20/, at);
      await assert.rejects(() => mem.bySpeaker("me", "alice", { limit: bad }), /between 5 and 20/, at);
      await assert.rejects(() => mem.revisions("alice", { limit: bad }), /between 5 and 20/, at);
      await assert.rejects(() => mem.exportImages("alice", { pageSize: bad }), /between 5 and 20/, at);
    }
    for (const bad of [-1, 6, 1.5, true, NaN, "2"]) {
      await assert.rejects(() => mem.search("q", "alice", 10, { max_images: bad }), /max_images/);
      await assert.rejects(() => mem.searchFull("q", "alice", 10, { max_images: bad }), /max_images/);
      await assert.rejects(() => mem.search("q", "alice", 10, { extra: { max_images: bad } }), /max_images/);
      const nul = { max_images: null, extra: { max_images: bad } };
      await assert.rejects(() => mem.search("q", "alice", 10, nul), /max_images/);
    }
    for (const bad of [0, -1, 1e9, NaN, Infinity, 2.5, true, 501]) {
      await assert.rejects(() => mem.listMemories("alice", { limit: bad }), /between 1 and 500/, `limit ${bad}`);
    }
    await assert.rejects(async () => {
      for await (const m of mem.iterMemories("alice", { pageSize: 0 })) void m;
    }, /between 1 and 500/);
    assert.equal(seen.length, 0, "nothing may reach the wire");
  } finally {
    server.close();
  }
});

test("the edges of each page-size range go through", async () => {
  const { server, seen, base } = await scriptedServer(Array.from({ length: 12 }, () => [200, {}, "{}"]));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const n of [5, 20]) {
      await mem.listImages("alice", { limit: n });
      await mem.bySpeaker("me", "alice", { limit: n });
      await mem.revisions("alice", { limit: n });
    }
    await mem.search("q", "alice", 10, { max_images: 0 });
    await mem.search("q", "alice", 10, { max_images: 5 });
    await mem.listMemories("alice", { limit: 1 });
    await mem.listMemories("alice", { limit: 500 });
    const limits = seen.map((r) => JSON.parse(r.body)).map((b) => b.limit ?? b.max_images);
    assert.deepEqual(limits, [5, 5, 5, 20, 20, 20, 0, 5, 1, 500]);
  } finally {
    server.close();
  }
});

test("a null or undefined page size or limit means the default, as if left out", async () => {
  const { server, seen, base } = await scriptedServer(Array.from({ length: 40 }, () => [200, {}, "{}"]));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const v of [null, undefined]) {
      seen.length = 0;
      await mem.listMemories("alice", { limit: v });
      await mem.listImages("alice", { limit: v });
      await mem.bySpeaker("me", "alice", { limit: v });
      await mem.revisions("alice", { limit: v });
      await mem.recall("q", "alice", { limit: v, context_limit: v });
      await mem.search("q", "alice", v, { max_images: v });
      await mem.exportImages("alice", { pageSize: v });
      await mem.exportMemories("alice");
      for await (const m of mem.iterMemories("alice", { pageSize: v })) void m;
      const [list, images, speaker, revisions, recall, search, walkImages, , walkMemories] = seen.map((r) =>
        JSON.parse(r.body),
      );
      const at = String(v);
      assert.equal(list.limit, 100, at);
      assert.equal(walkMemories.limit, 100, at);
      for (const b of [images, speaker, revisions, walkImages]) assert.ok(!("limit" in b), `${at}: ${JSON.stringify(b)}`);
      assert.ok(!("limit" in recall) && !("context_limit" in recall), `${at}: ${JSON.stringify(recall)}`);
      assert.equal(search.max_results, 10, at);
      assert.ok(search.max_images == null, at);
    }
  } finally {
    server.close();
  }
});

test("a cursor cycle after non-empty pages ends the walk with the truncated error", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"memories":[{"id":"1"}],"next_cursor":"B"}'],
    [200, {}, '{"memories":[{"id":"2"}],"next_cursor":"A"}'],
    [200, {}, '{"memories":[{"id":"3"}],"next_cursor":"B"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.exportMemories("alice"), /truncated answer/);
    assert.equal(seen.length, 3);
  } finally {
    server.close();
  }
});

test("an empty page with a repeated cursor ends the walk quietly", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"memories":[{"id":"1"}],"next_cursor":"C"}'],
    [200, {}, '{"memories":[],"next_cursor":"C"}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    assert.deepEqual((await mem.exportMemories("alice")).map((m) => m.id), ["1"]);
    assert.equal(seen.length, 2);
  } finally {
    server.close();
  }
});

test("an image walk whose cursor repeats after a non-empty page is truncated, not complete", async () => {
  const page = (id) => JSON.stringify({ images: [{ id }], has_more: true, next_before: "B", next_skip_ids: ["x"] });
  const { server, base } = await scriptedServer([[200, {}, page("i1")], [200, {}, page("i2")]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.exportImages("alice"), /truncated answer/);
  } finally {
    server.close();
  }
});

test("a metadata key the service does not keep draws one warning", async () => {
  const { server, base } = await scriptedServer(Array.from({ length: 3 }, () => [200, {}, '{"id":"m","status":"stored"}']));
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("x", "alice", { speakr_meta_test: "Bob" });
    await mem.add("x", "alice", { speakr_meta_test: "Bob" });
    assert.equal(warns.length, 1, warns.join("\n"));
    assert.match(warns[0], /speakr_meta_test/);
    assert.match(warns[0], /speaker, event_date, category, conversation_id/);
    await mem.add("x", "alice", { speaker: "me", event_date: "2026-03-01", category: "work", conversation_id: "c1" });
    assert.equal(warns.length, 1, "the kept keys draw no warning");
  } finally {
    console.warn = orig;
    server.close();
  }
});

test("retry, walk, metadata-warning and constructor messages carry no em-dash", async () => {
  const texts = [];
  try {
    new Client({ apiKey: KEY, userId: undefined });
  } catch (e) {
    texts.push(e.message);
  }
  const { server, base } = await scriptedServer([
    [200, {}, '{"id":"m","status":"stored"}'],
    [200, {}, '{"memories":[{"id":"1"}],"next_cursor":"B"}'],
    [200, {}, '{"memories":[{"id":"2"}],"next_cursor":"B"}'],
    [429, { "Retry-After": "60" }, errBody("rate_limit_error", "slow down")],
    [429, { "Retry-After": "5" }, errBody("rate_limit_error", "slow down")],
    [503, { "Retry-After": "0" }, errBody("api_error", "busy")],
    [200, {}, '{"models":[]}'],
  ]);
  const closed = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(`http://127.0.0.1:${port}`));
    });
  });
  const warn = console.warn;
  const error = console.error;
  const env = process.env.WONTOPOS_LOG;
  console.warn = (...a) => texts.push(a.join(" "));
  console.error = (...a) => texts.push(a.join(" "));
  process.env.WONTOPOS_LOG = "debug";
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.add("x", "alice", { em_dash_probe_key: 1 });
    await mem.exportMemories("alice").catch((e) => texts.push(e.message));
    await mem.listModels().catch(() => {});
    await mem.withDeadline(1_000).listModels().catch(() => {});
    await mem.listModels();
    await new Client({ apiKey: KEY, baseUrl: closed, maxRetries: 1 }).listModels().catch(() => {});
  } finally {
    console.warn = warn;
    console.error = error;
    if (env === undefined) delete process.env.WONTOPOS_LOG;
    else process.env.WONTOPOS_LOG = env;
    server.close();
  }
  const probes = [
    /needs a store id/,
    /em_dash_probe_key/,
    /store did not end/,
    /over the cap/,
    /does not fit the deadline/,
    /-> 503.*etrying in/,
    /models: .*etrying in/,
  ];
  for (const want of probes) {
    assert.ok(texts.some((t) => want.test(t)), `${want} was not produced:\n${texts.join("\n")}`);
  }
  for (const t of texts.filter((t) => probes.some((want) => want.test(t)))) {
    assert.ok(!t.includes(" — "), t);
  }
});

test("the test hooks stay in the published types, marked deprecated", () => {
  for (const file of ["../dist/wontopos.d.ts", "../dist/cjs/wontopos.d.cts"]) {
    const dts = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const name of ["_resetStoreIdWarnings", "_resetFilterWarnings"]) {
      assert.match(
        dts,
        new RegExp(`@deprecated Test hook[^/]*\\*/\\s*export declare function ${name}\\(\\): void;`),
        `${file}: ${name}`,
      );
    }
  }
});

test("the published types need neither the DOM lib nor @types/node", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const dist = fileURLToPath(new URL("../dist/wontopos.js", import.meta.url));
  const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "wontopos-types-"));
  try {
    writeFileSync(join(dir, "package.json"), '{"type":"module"}');
    const check = (lib, code) => {
      writeFileSync(join(dir, "consumer.ts"), `import { Client, WosError, type ClientOptions } from ${JSON.stringify(dist)};\n${code}\n`);
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          target: "ES2022", module: "nodenext", moduleResolution: "nodenext", lib, types: [],
          strict: true, noEmit: true, skipLibCheck: false,
        },
        files: ["consumer.ts"],
      }));
      const r = spawnSync(process.execPath, [tsc, "-p", dir], { encoding: "utf8" });
      assert.equal(r.status, 0, `lib ${lib.join("+")}:\n${r.stdout}${r.stderr}`);
    };
    check(["ES2022"], [
      'const mem = new Client({ apiKey: "wos-x", timeoutMs: 1000 });',
      "const o: ClientOptions = { apiKey: \"wos-x\" };",
      "mem.search(\"q\").then((m) => m.length).catch((e) => e instanceof WosError);",
      "mem.recall(\"q\").then((r) => { const t: string | undefined = r.short_term.turns[0]?.content; const c: string = r.context.around_top_memory[0] ?? \"\"; return [t, c]; });",
      "void o;",
    ].join("\n"));
    check(["ES2022", "DOM"], [
      "const ctrl = new AbortController();",
      'const mem = new Client({ apiKey: "wos-x", fetch, signal: ctrl.signal });',
      "mem.withSignal(ctrl.signal);",
      'new Client({ apiKey: "wos-x", fetch: (url, init) => fetch(url, { ...init }) });',
    ].join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Sunset header warns once per model and day", async () => {
  const { _resetRetirementWarnings } = await import(DIST);
  _resetRetirementWarnings();
  const sunset = { Sunset: "Sat, 07 Nov 2026 00:00:00 GMT" };
  const { server, base } = await scriptedServer([
    [200, sunset, '{"memories":[]}'],
    [200, sunset, '{"memories":[]}'],
    [200, { Sunset: "Sun, 08 Nov 2026 00:00:00 GMT" }, '{"memories":[]}'],
  ]);
  const said = [];
  const orig = console.warn;
  console.warn = (m) => said.push(String(m));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base, model: "scroll-1" });
    await mem.search("q", "alice");
    await mem.search("q", "alice");
    assert.equal(said.length, 1, "once per model and day, not on every call");
    assert.match(said[0], /"scroll-1" retires on 2026-11-07/);
    assert.match(said[0], /410/);
    await mem.search("q", "alice");
    assert.equal(said.length, 2, "a new day is news");
  } finally {
    console.warn = orig;
    server.close();
    _resetRetirementWarnings();
  }
});

test("no Sunset header, or one that is not a date, says nothing", async () => {
  const { _resetRetirementWarnings } = await import(DIST);
  _resetRetirementWarnings();
  const { server, base } = await scriptedServer([
    [200, {}, '{"memories":[]}'],
    [200, { Sunset: "soon" }, '{"memories":[]}'],
  ]);
  const said = [];
  const orig = console.warn;
  console.warn = (m) => said.push(String(m));
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.search("q", "alice");
    await mem.search("q", "alice");
    assert.deepEqual(said, []);
  } finally {
    console.warn = orig;
    server.close();
  }
});

function asBrowserPage(fn) {
  const hadWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const hadNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "window", { value: { document: {} }, configurable: true, writable: true });
  if (!hadNavigator) Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (hadWindow) Object.defineProperty(globalThis, "window", hadWindow);
    else delete globalThis.window;
    if (!hadNavigator) delete globalThis.navigator;
  }
}

test("a browser page that would send the key to the service is refused", () => {
  asBrowserPage(() => {
    assert.throws(() => new Client({ apiKey: KEY }), /refusing to run in a browser page/);
    assert.throws(() => new Client({ apiKey: KEY, baseUrl: "https://api.wontopos.com" }), /dangerouslyAllowBrowser/);
  });
});

test("a service host written with a trailing dot is refused in a browser page too", () => {
  asBrowserPage(() => {
    for (const base of ["https://api.wontopos.com.", "https://API.Wontopos.COM./", "https://wontopos.com."]) {
      assert.throws(() => new Client({ apiKey: KEY, baseUrl: base }), /refusing to run in a browser page/, base);
    }
  });
});

test("dangerouslyAllowBrowser, or a base of the caller's own, lets a page through", () => {
  asBrowserPage(() => {
    const demo = new Client({ apiKey: KEY, dangerouslyAllowBrowser: true });
    demo.withModel("tablet-2");
    new Client({ apiKey: "placeholder", baseUrl: "https://proxy.example.com/wos" });
  });
});

test("outside a browser page nothing changes", () => {
  new Client({ apiKey: KEY });
});

test("recall hands back its lists as typed: rows of another kind are dropped", async () => {
  const body = JSON.stringify({
    short_term: { turns: [{ role: "user", content: "hi" }, "not a turn", null], count: 3 },
    long_term: { memories: [{ id: "m1", content: "tea" }, 7], count: 2 },
    context: { around_top_memory: ["[before] a", 3, { x: 1 }, "[match] b"], count: 4 },
    instruction: "kept",
  });
  const { server, base } = await scriptedServer([[200, {}, body], [200, {}, "{}"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const r = await mem.recall("q", "alice");
    assert.deepEqual(r.short_term.turns, [{ role: "user", content: "hi" }]);
    assert.deepEqual(r.long_term.memories, [{ id: "m1", content: "tea" }]);
    assert.deepEqual(r.context.around_top_memory, ["[before] a", "[match] b"]);
    assert.equal(r.short_term.count, 3, "what the service said is kept");
    assert.equal(r.instruction, "kept");
    const empty = await mem.recall("q", "alice");
    assert.deepEqual([empty.short_term.turns, empty.long_term.memories, empty.context.around_top_memory], [[], [], []]);
  } finally {
    server.close();
  }
});

test("the page calls hand back their lists as typed, even from an answer that leaves them out", async () => {
  const { server, base } = await scriptedServer([
    [200, {}, "{}"],
    [200, {}, "{}"],
    [200, {}, "{}"],
    [200, {}, "{}"],
    [200, {}, '{"memories":[{"id":"a"},7,null],"count":3,"next_cursor":"C","note":"kept"}'],
    [200, {}, '{"images":[{"id":"i"},"x"],"count":9,"has_more":false}'],
    [200, {}, '{"speaker":"Dana","memories":[null,{"id":"b"}]}'],
    [200, {}, '{"memory_id":"c","chain":[{"memory_id":"c"},[1]],"count":1}'],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    assert.deepEqual((await mem.listMemories("u")).memories, []);
    assert.deepEqual(await mem.listImages("u"), { images: [] });
    assert.deepEqual(await mem.bySpeaker("Dana", "u"), { memories: [] });
    assert.deepEqual(await mem.lineage("u", "m1"), { chain: [] });
    assert.deepEqual(await mem.listMemories("u"), { memories: [{ id: "a" }], count: 3, next_cursor: "C", note: "kept" });
    assert.deepEqual(await mem.listImages("u"), { images: [{ id: "i" }], count: 9, has_more: false });
    assert.deepEqual(await mem.bySpeaker("Dana", "u"), { speaker: "Dana", memories: [{ id: "b" }] });
    assert.deepEqual(await mem.lineage("u", "c"), { memory_id: "c", chain: [{ memory_id: "c" }], count: 1 });
  } finally {
    server.close();
  }
});

test("listMemories says null when there is no next page, so a typed loop over next_cursor ends", async () => {
  const { server, seen, base } = await scriptedServer([
    [200, {}, '{"memories":[{"id":"a"}],"count":1,"next_cursor":"C"}'],
    [200, {}, '{"memories":[{"id":"b"}]}'],
    [200, {}, '{"memories":[],"next_cursor":""}'],
    [200, {}, "{}"],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    let page = await mem.listMemories("u");
    let pages = 1;
    while (page.next_cursor !== null && pages < 4) {
      page = await mem.listMemories("u", { cursor: page.next_cursor });
      pages++;
    }
    assert.equal(pages, 2, "the page without a next_cursor is the last");
    assert.deepEqual(page, { memories: [{ id: "b" }], count: 1, next_cursor: null });
    assert.deepEqual(await mem.listMemories("u"), { memories: [], count: 0, next_cursor: null });
    assert.deepEqual(await mem.listMemories("u"), { memories: [], count: 0, next_cursor: null });
    assert.equal(seen.length, 4);
  } finally {
    server.close();
  }
});

test("recall's counts are numbers and its rooms and images hold lists, even when the service leaves them out", async () => {
  const body = JSON.stringify({
    short_term: { turns: [{ role: "user", content: "hi" }] },
    long_term: { memories: [{ id: "m1" }, { id: "m2" }], count: 7 },
    context: {},
    rooms: { rooms: [{ name: "m0", found: 1 }], memories: [{ id: "r1" }, "x"] },
    images: { count: 0 },
  });
  const { server, base } = await scriptedServer([[200, {}, body], [200, {}, '{"rooms":null,"rooms_off":"no clock"}']]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    const r = await mem.recall("q", "alice");
    assert.deepEqual([r.short_term.count, r.long_term.count, r.context.count], [1, 7, 0]);
    assert.deepEqual(r.rooms, { rooms: [{ name: "m0", found: 1 }], memories: [{ id: "r1" }], count: 1 });
    assert.deepEqual(r.images, { memories: [], count: 0 });
    const off = await mem.recall("q", "alice");
    assert.equal(off.rooms, null);
    assert.equal(off.images, undefined);
    assert.deepEqual([off.short_term.count, off.long_term.count, off.context.count], [0, 0, 0]);
  } finally {
    server.close();
  }
});

test("what a call is given is trimmed as JavaScript trims it, in every client", async () => {
  const { server, seen, base } = await scriptedServer([]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.get("u", "﻿m1");
    await mem.delete("u", "m1\u0085");
    await mem.lineage("u", "﻿m1　");
    await mem.seen("﻿2026-10-19T09:00:00Z", "u");
    await mem.setSettings("u", { timeZone: "Asia/Seoul﻿" });
    await mem.workDeeper("﻿w-1\x1c", "u");
    await mem.add("x", "u", {}, { image: { data: "﻿aG﻿k=\u0085" } });
    await mem.deleteAll("\x1c");
    const got = seen.map((s) => JSON.parse(s.body));
    assert.deepEqual(got.slice(0, 3).map((g) => g.memory_id), ["m1", "m1\u0085", "m1"]);
    assert.deepEqual([got[3].at, got[4].time_zone, got[5].work_id], ["2026-10-19T09:00:00Z", "Asia/Seoul", "w-1\x1c"]);
    assert.deepEqual([got[6].image.data, got[7].user_id], ["aGk=\u0085", "\x1c"]);
    for (const [call, message] of [
      [() => mem.get("u", "﻿"), /memoryId is required/],
      [() => mem.seen("﻿", "u"), /at is required/],
      [() => mem.stats("﻿"), /userId must be a non-blank string/],
      [() => mem.deleteStore(" ﻿"), /userId is required/],
      [() => mem.forgetSpeaker("Dana", "﻿"), /userId is required/],
    ]) {
      await assert.rejects(call, message);
    }
    assert.equal(seen.length, 8);
    await new Client({ apiKey: `﻿${KEY} `, baseUrl: `﻿${base}　` }).stats("u");
    assert.equal(seen[8].headers["x-api-key"], KEY);
    for (const apiKey of [`${KEY}\u0085`, `\x1c${KEY}`]) {
      assert.throws(() => new Client({ apiKey, baseUrl: base }), /apiKey contains/);
    }
    assert.throws(() => new Client({ apiKey: KEY, baseUrl: `${base}\u0085` }), /baseUrl/);
    assert.equal(seen.length, 9);
  } finally {
    server.close();
  }
});

test("an answer that starts with a byte order mark is read, in every client", async () => {
  const lock = JSON.stringify({
    type: "error",
    error: { type: "conflict_error", message: "in flight", request_id: "req_lock", retry_after_ms: 100 },
  });
  const expired = JSON.stringify({
    type: "error",
    error: { type: "gone_error", message: "This sleep ran out: read it again.", request_id: "req_exp", code: "sleep_expired" },
  });
  const { server, seen, base } = await scriptedServer([
    [200, {}, '﻿{"total_memories": 3}'],
    [409, {}, `﻿${lock}`],
    [200, {}, '﻿{"id": "m1"}'],
    [410, {}, `﻿${expired}`],
  ]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    assert.equal((await mem.stats("u")).total_memories, 3);
    assert.equal((await mem.add("x", "u")).id, "m1");
    await assert.rejects(
      mem.sleepDone("s-1", "u"),
      (e) => e.constructor === WosError && e.code === "sleep_expired" && e.requestId === "req_exp",
    );
    assert.equal(seen.length, 4);
  } finally {
    server.close();
  }
});

test("a model of null or undefined is the default model, in every client", async () => {
  const { server, seen, base } = await scriptedServer([]);
  try {
    const declared = readFileSync(new URL("../src/wontopos.ts", import.meta.url), "utf8").match(/const DEFAULT_MODEL = "([^"]+)"/)[1];
    const mem = new Client({ apiKey: KEY, baseUrl: base, model: null });
    await mem.stats("u");
    await mem.withModel(null).stats("u");
    await mem.withModel(undefined).stats("u");
    await mem.withModel("").stats("u");
    assert.deepEqual(seen.map((s) => s.headers["x-wos-model"]), [declared, declared, declared, undefined]);
  } finally {
    server.close();
  }
});

test("a redirect is refused before anything is read from it, in every client", async () => {
  const moved = { Location: "https://example.com/", "X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "59" };
  const { server, base } = await scriptedServer([[302, moved, ""]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await assert.rejects(mem.stats("u"), /unexpected redirect/);
    assert.equal(mem.rateLimit, null);
  } finally {
    server.close();
  }
});

test("a rate-limit header is read as a whole number, as every client reads it", async () => {
  const cases = [["60", 60], ["007", 7], ["9007199254740991", 9007199254740991], ["9007199254740992", null],
    ["-3", null], ["1.5", null], ["1e3", null], ["0x10", null], ["+5", null], ["1_000", null], ["12abc", null], ["", null]];
  const { server, base } = await scriptedServer(
    cases.map(([v]) => [200, { "X-RateLimit-Limit": v, "X-RateLimit-Remaining": "1", "X-RateLimit-Reset": "2" }, "{}"]),
  );
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    for (const [v, want] of cases) {
      await mem.stats("u");
      assert.deepEqual(mem.rateLimit, { limit: want, remaining: 1, reset: 2 }, v);
    }
  } finally {
    server.close();
  }
});

test("a control character inside an id is sent in the body, in every client", async () => {
  const { server, seen, base } = await scriptedServer([[200, {}, "PNG"]]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.getImage("u", "m\x01a");
    await mem.forgetImage("u", "m\x01a");
    await mem.lineage("u", "m\x01a");
    await mem.bySpeaker("Da\x01na", "u");
    const got = seen.map((s) => JSON.parse(s.body));
    assert.deepEqual([...got.slice(0, 3).map((g) => g.memory_id), got[3].speaker], ["m\x01a", "m\x01a", "m\x01a", "Da\x01na"]);
  } finally {
    server.close();
  }
});

test("an empty cursor is left out, in every client", async () => {
  const { server, seen, base } = await scriptedServer([]);
  try {
    const mem = new Client({ apiKey: KEY, baseUrl: base });
    await mem.listMemories("u", { cursor: "" });
    await mem.listMemories("u", { cursor: "c-2" });
    const got = seen.map((s) => JSON.parse(s.body));
    assert.deepEqual([got[0], got[1].cursor], [{ user_id: "u", limit: 100 }, "c-2"]);
  } finally {
    server.close();
  }
});
