import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { Client } from "../dist/wontopos.js";

const SEARCH_ANSWER = {
  memories: [{ id: "w1", content: "The office moves to the fourth floor.", category: "work" }],
  self_memories: [
    { id: "s1", content: "You like green tea.", speaker: "me", category: "general" },
    { id: "s2", content: "hello", speaker: "me", category: "general" },
  ],
};

const NIGHT = [
  { id: "m-1", content: "Dana planted roses today.", created_at: "2026-10-19T09:00:00Z", speaker: "Dana", tokens: 8 },
  { id: "m-2", content: "Kai said the roses need water.", created_at: "2026-10-19T09:01:00Z", speaker: "Kai", tokens: 9 },
];

const SLEEP_ANSWERS = {
  sleep: { user_id: "u", sleep_id: "s-1", memories: NIGHT, count: 2, tokens: 17, exhausted: true, next_cursor: null, clock: { local_now: "2026-10-20T09:30:00+09:00" } },
  self: {
    user_id: "u",
    core: { title: "", version: 0, tokens: 0, written_at: null, day: null, body: "" },
    files: [1, 2, 3, 4].map((slot) => ({ slot, title: "", version: 0, tokens: 0, written_at: null, day: null })),
    notes_version: 0,
  },
  "self/notes": { user_id: "u", version: 0, written_at: null, bytes: 30, notes: { proposals: [], mixed: [] } },
  "sleep/done": { user_id: "u", sleep_id: "s-1", changed: true, last_sleep: { until: 2 } },
};

async function served(t, answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = req.url.split("?")[0].replace("/api/v1/memory/", "");
      seen.push({ path, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(answer(path)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const mem = new Client({ apiKey: "wos-test-xxxxxxxxxx", baseUrl: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
  return { seen, mem };
}

test("a filtered search leaves out the assistant's words the filter did not narrow", async (t) => {
  const { mem } = await served(t, () => SEARCH_ANSWER);
  const filtered = await mem.search("office", "u", 5, { filters: { categories: ["work"] } });
  assert.deepEqual(filtered.map((m) => m.id), ["w1"]);
  const plain = await mem.search("office", "u", 5);
  assert.deepEqual(plain.map((m) => m.id), ["w1", "s1", "s2"]);
});

test("a turn with both sides blank is refused before anything is sent", async (t) => {
  const { seen, mem } = await served(t, () => ({ status: "ok" }));
  for (const [a, b] of [["", ""], ["  ", "\n"]]) {
    await assert.rejects(mem.addTurn(a, b, "u"), (e) => e.message === "userMsg and assistantMsg are both blank: there is no turn to store.");
  }
  assert.deepEqual(seen, []);
  await mem.addTurn("hello", "", "u");
  assert.equal(seen[0].body.user_msg, "hello");
});

test("update refuses a blank oldMemoryId as the other id calls do", async (t) => {
  const { seen, mem } = await served(t, () => ({}));
  for (const bad of ["", "   "]) {
    await assert.rejects(mem.update(bad, "new text", "u"), (e) => e.message === "oldMemoryId is required.");
  }
  assert.deepEqual(seen, []);
});

test("a sleep whose reading failed does not end the last sleep", async (t) => {
  const { seen, mem } = await served(t, (path) => SLEEP_ANSWERS[path] ?? {});
  const res = await mem.sleep("u", { llm: async () => ({ text: "", stop: "end" }), assistant: "Kai", today: "2026-10-20 09:30" });
  assert.equal(res.memories, 2);
  assert.ok(res.log.some((x) => x.call === "unread parts" && JSON.stringify(x.parts) === "[1]"), JSON.stringify(res.log));
  assert.equal(res.done, null);
  assert.deepEqual(seen.map((x) => x.path), ["sleep", "self", "self/notes"]);
});

test("a sleep whose merge came back unreadable twice does not end the last sleep", async (t) => {
  const { seen, mem } = await served(t, (path) => SLEEP_ANSWERS[path] ?? {});
  const read = { items: [{ kind: "person", topic: "Dana", text: "Dana planted roses.", evidence: ["e1", "e2"] }], mixed: [] };
  const llm = async (c) => ({ text: c.system[0].includes("you read part") ? JSON.stringify(read) : "", stop: "end" });
  const res = await mem.sleep("u", { llm, assistant: "Kai", today: "2026-10-20 09:30" });
  assert.equal(res.items.length, 1);
  assert.deepEqual(res.log.filter((x) => x.failed).map((x) => x.call), ["merge", "merge shorter"]);
  assert.equal(res.done, null);
  assert.deepEqual(seen.map((x) => x.path), ["sleep", "self", "self/notes"]);
});

test("ServerError's doc says a 501 is a call the model does not serve", () => {
  const dts = readFileSync(new URL("../dist/wontopos.d.ts", import.meta.url), "utf8");
  const at = dts.indexOf("export declare class ServerError");
  assert.ok(at > 0);
  assert.match(dts.slice(Math.max(0, dts.lastIndexOf("/**", at)), at), /501/);
});
