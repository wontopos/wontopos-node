import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "../dist/wontopos.js";

const KEY = "wos-test-xxxxxxxxxx";

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

async function withServer(script, fn, opts = {}) {
  const { server, seen, base } = await scriptedServer(script);
  try {
    await fn(new Client({ apiKey: KEY, baseUrl: base, ...opts }), seen);
  } finally {
    server.close();
  }
}

const drained = async (it) => {
  const out = [];
  for await (const m of it) out.push(m);
  return out;
};

test("a sleep file answer that leaves its list out or mixes in non-objects holds only its objects", async () => {
  const write = { slot: 1, base_version: 0, title: "t", body: "b" };
  await withServer(
    [
      [200, '{"core": {"slot": 0}, "files": [null, 3, {"slot": 1}]}'],
      [200, '{"slot": 2}'],
      [200, '{"written": "x"}'],
    ],
    async (mem) => {
      assert.deepEqual((await mem.sleepFiles("u")).files, [{ slot: 1 }]);
      assert.deepEqual((await mem.sleepFileHistory(2, "u")).versions, []);
      assert.deepEqual((await mem.writeSleepFiles("s1", [write], "u")).written, []);
    },
  );
});

test("a preview of null is refused and nothing is deleted", async () => {
  await withServer([], async (mem, seen) => {
    for (const call of [() => mem.forgetImage("u", "m1", { preview: null }), () => mem.forgetSpeaker("Dana", "u", { preview: null })]) {
      await assert.rejects(call(), (e) => e.message === "preview must be true or false, got null.");
    }
    assert.equal(seen.length, 0, "nothing was sent, and nothing was deleted");
  });
});

test("answered with no number closes the work without an answer", async () => {
  const opened = '{"work_id": "w1", "memories": [{"n": 1, "id": "m1", "content": "x"}]}';
  await withServer([[200, opened], [200, '{"closed": true}']], async (mem, seen) => {
    const tools = mem.memoryTools("u", { preset: "S-2" });
    await tools.begin("q");
    assert.deepEqual(await tools.answered(null), { closed: true });
    assert.equal(seen[1].path, "/api/v1/memory/work/close");
    assert.deepEqual(seen[1].body, { user_id: "u", work_id: "w1" });
    assert.equal(await tools.answered(null), undefined, "nothing is open any more");
  });
});

test("a key with a stray newline, a no-break space or a control character is refused for what it holds", () => {
  const spaced = "apiKey contains whitespace - check for a stray newline or paste error";
  for (const [key, said] of [
    ["wos-test\nxxxxxxxxxx", spaced],
    ["wos-test\u{a0}xxxxxxxxxx", spaced],
    ["wos-test\u{1}xxxxxxxxxx", "apiKey contains a control character - check for a stray byte or paste error"],
  ]) {
    assert.throws(() => new Client({ apiKey: key }), (e) => e.message === said, JSON.stringify(key));
  }
  assert.throws(
    () => new Client({ apiKey: "wos-test\u{85}xxxxxxxxxx" }),
    (e) => e.message.startsWith("apiKey contains a non-ASCII character ("),
  );
});

test("a retry-after given as a date is kept in whole seconds", async () => {
  const when = new Date(Date.now() + 30_000).toUTCString();
  await withServer(
    [[429, '{"error": "slow down"}', { "Retry-After": when }]],
    async (mem) => {
      await assert.rejects(mem.stats("u"), (e) => {
        assert.equal(e.name, "RateLimitError");
        assert.equal(e.retryAfter, Math.ceil(e.retryAfter));
        assert.ok(e.retryAfter >= 28 && e.retryAfter <= 31, String(e.retryAfter));
        return true;
      });
    },
    { maxRetries: 0 },
  );
});

test("an answer of only whitespace is refused as an empty body", async () => {
  await withServer([[200, "  \n"]], async (mem) => {
    await assert.rejects(mem.stats("u"), (e) => e.status === 200 && e.message.startsWith("[200] empty response body"));
  });
});

test("a blank store id is refused without a store id warning", async () => {
  await withServer([], async (mem, seen) => {
    const warned = [];
    const warn = console.warn;
    console.warn = (...a) => warned.push(a.join(" "));
    try {
      for (const call of [
        () => mem.deleteStore("\u{3000}"),
        () => mem.deleteAll("\u{3000}"),
        () => mem.forgetSpeaker("Dana", "\u{3000}"),
      ]) {
        await assert.rejects(call(), (e) => e.message.startsWith("userId is required"));
      }
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(warned, []);
    assert.equal(seen.length, 0);
  });
});

test("a page size out of range is refused under its own name", async () => {
  await withServer([], async (mem, seen) => {
    for (const [call, said] of [
      [() => drained(mem.iterMemories("u", { pageSize: 0 })), "pageSize must be an integer between 1 and 500, got 0."],
      [() => drained(mem.iterImages("u", { pageSize: 3 })), "pageSize must be an integer between 5 and 20, got 3."],
      [() => mem.exportImages("u", { pageSize: 21 }), "pageSize must be an integer between 5 and 20, got 21."],
    ]) {
      await assert.rejects(call(), (e) => e.message === said, said);
    }
    assert.equal(seen.length, 0);
  });
});
