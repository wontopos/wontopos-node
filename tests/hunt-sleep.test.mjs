import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../dist/wontopos.js";

const KEY = "wos-test-xxxxxxxxxx";

function quiet() {
  const seen = [];
  const mem = new Client({ apiKey: KEY, baseUrl: "https://api.wontopos.com", fetch: (url) => { seen.push(url); throw new Error("nothing is sent"); } });
  return [mem, seen];
}

test("hunt sleep: today takes a clock of hours 0 to 23 and minutes 0 to 59", async () => {
  const [mem, seen] = quiet();
  const calls = [];
  const llm = (c) => { calls.push(c); return { text: "{}" }; };
  for (const [today, want] of [
    ["2026-10-20 24:00", /: today must be "YYYY-MM-DD HH:MM"/],
    ["2026-10-20 23:60", /: today must be "YYYY-MM-DD HH:MM"/],
    ["2026-10-20 99:99", /: today must be "YYYY-MM-DD HH:MM"/],
    ["2026-10-20 23:59", /: maxTokens must be/],
    ["2026-10-20 00:00", /: maxTokens must be/],
    ["2026-10-20 19:05", /: maxTokens must be/],
  ]) {
    await assert.rejects(mem.sleep("u", { llm, today, maxTokens: 0 }), want, today);
  }
  assert.deepEqual(seen, []);
  assert.deepEqual(calls, []);
});

test("hunt sleep: settings that are not SleepSettings are named by their type, not printed", async () => {
  const [mem, seen] = quiet();
  const llm = () => ({ text: "{}" });
  const settings = { readers: 2, token: "SECRET-MARKER-1234" };
  for (const call of [() => mem.sleep("u", { llm, settings }), () => mem.sleepEstimate("u", { settings })]) {
    await assert.rejects(call(), (e) => {
      assert.match(e.message, /^settings must be SleepSettings, got /);
      assert.ok(!e.message.includes("SECRET-MARKER"), e.message);
      return true;
    });
  }
  assert.deepEqual(seen, []);
});
