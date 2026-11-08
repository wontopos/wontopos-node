import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../dist/wontopos.js";

const KEY = "wos-test-xxxxxxxxxx";

function recorder(answer = "{}") {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    return new Response(answer, { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { seen, mem: new Client({ apiKey: KEY, baseUrl: "https://api.wontopos.com", fetch }) };
}

const said = (want) => (e) => {
  assert.equal(e.message, want);
  return true;
};

const drain = async (it) => {
  for await (const _ of it);
};

test("update trims the old memory id and refuses a blank one, as get and delete do", async () => {
  const { seen, mem } = recorder();
  for (const bad of ["", "   ", "\t\n", undefined, null, 5]) {
    await assert.rejects(mem.update(bad, "new", "u"), said("oldMemoryId is required."));
  }
  assert.equal(seen.length, 0);
  await mem.update(" m1 ", "new", "u");
  assert.equal(seen[0].body.old_memory_id, "m1");
});

test("update refuses a blank new content, and sends the rest as given", async () => {
  const { seen, mem } = recorder();
  for (const bad of ["", "   ", undefined, null, 5]) {
    await assert.rejects(mem.update("m1", bad, "u"), said("newContent is required."));
  }
  assert.equal(seen.length, 0);
  await mem.update("m1", " the fix ", "u");
  assert.equal(seen[0].body.new_content, " the fix ");
});

test("add checks its metadata speaker as addBulk does: trimmed, not blank, at most 256 bytes", async () => {
  const { seen, mem } = recorder();
  await assert.rejects(mem.add("x", "u", { speaker: "  " }), /: speaker must be a speaker's name/);
  await assert.rejects(mem.add("x", "u", { speaker: "A".repeat(257) }), said("speaker is at most 256 bytes."));
  assert.equal(seen.length, 0);
  const given = { speaker: "\t Ana \n", category: "work" };
  await mem.add("x", "u", given);
  await mem.addBulk("x", "u", undefined, undefined, { speaker: " Ana " });
  assert.deepEqual(seen.map((s) => s.body.metadata.speaker), ["Ana", "Ana"]);
  assert.equal(given.speaker, "\t Ana \n", "the caller's object is left as it was");
});

test("addSpeaker and removeSpeaker trim the name and refuse a blank one, as setSettings does", async () => {
  const { seen, mem } = recorder();
  for (const call of [() => mem.addSpeaker("  ", "u"), () => mem.addSpeaker(undefined, "u"), () => mem.removeSpeaker("  ", "u"), () => mem.removeSpeaker(null, "u")]) {
    await assert.rejects(call(), /: speaker must be a speaker's name \(a non-blank string\)/);
  }
  await assert.rejects(mem.addSpeaker("A".repeat(257), "u"), said("speaker is at most 256 bytes."));
  assert.equal(seen.length, 0);
  await mem.addSpeaker(" Ana ", "u");
  await mem.removeSpeaker(" Ana ", "u");
  assert.deepEqual(seen.map((s) => s.body.speaker), ["Ana", "Ana"]);
});

test("a default or relabelled speaker is at most 256 bytes, as addSpeaker takes", async () => {
  const { seen, mem } = recorder();
  const long = "A".repeat(257);
  await assert.rejects(mem.setSettings("u", { defaultSpeakers: { user: long } }), said("defaultSpeakers.user is at most 256 bytes."));
  await assert.rejects(mem.relabelSpeaker("Ana", long, "u"), said("toSpeaker is at most 256 bytes."));
  assert.equal(seen.length, 0);
  await mem.setSettings("u", { defaultSpeakers: { user: ` ${"A".repeat(256)} ` } });
  assert.equal(seen[0].body.default_speakers.user, "A".repeat(256));
});

test("forgetImage refuses preview: null, as forgetSpeaker and Python do, instead of deleting the photo", async () => {
  const { seen, mem } = recorder();
  await assert.rejects(mem.forgetImage("u", "m1", { preview: null }), said("preview must be true or false, got null."));
  assert.equal(seen.length, 0);
  await mem.forgetImage("u", "m1", { preview: true });
  assert.deepEqual(seen[0].body, { user_id: "u", memory_id: "m1", preview: true });
});

test("a pageSize out of range is refused as pageSize, the option the caller passed", async () => {
  const { seen, mem } = recorder('{"memories": [], "images": []}');
  await assert.rejects(drain(mem.iterMemories("u", { pageSize: 0 })), said("pageSize must be an integer between 1 and 500, got 0."));
  await assert.rejects(drain(mem.iterImages("u", { pageSize: 3 })), said("pageSize must be an integer between 5 and 20, got 3."));
  await assert.rejects(mem.exportImages("u", { pageSize: 21 }), said("pageSize must be an integer between 5 and 20, got 21."));
  assert.equal(seen.length, 0);
  await drain(mem.iterMemories("u", { pageSize: 500 }));
  await drain(mem.iterImages("u", { pageSize: 5 }));
  assert.deepEqual(seen.map((s) => s.body.limit), [500, 5]);
});

test("add sends a null metadata as {}, as Python does", async () => {
  const { seen, mem } = recorder();
  await mem.add("x", "u", null);
  assert.deepEqual(seen[0].body.metadata, {});
});

test("sleepVerify and relabelSpeaker say how long or what kind a bad value is, without quoting it whole", async () => {
  const { seen, mem } = recorder();
  const long = "x".repeat(100_000);
  await assert.rejects(mem.sleepVerify("s", [long], "u"), said("evidence[0] must be 1 to 64 characters, got 100000."));
  await assert.rejects(mem.sleepVerify("s", [7], "u"), said("evidence[0] must be 1 to 64 characters, got number."));
  await assert.rejects(mem.sleepVerify("s", long, "u"), said("evidence must be a list of at most 200 memory ids, got string."));
  await assert.rejects(
    mem.relabelSpeaker("Ana", "Bo", "u", { memoryIds: long }),
    said("memoryIds must be a list of 1 to 1000 memory ids, got string. Leave it out to relabel every memory under fromSpeaker."),
  );
  assert.equal(seen.length, 0);
});

test("a revisions page keeps only records, as every other page does", async () => {
  const answers = ['{"revised": 1, "memories": [null, {"id": "a"}, 2, "b"], "has_more": false}', '{"revised": 0, "unrevised": 3}'];
  const fetch = async () => new Response(answers.shift(), { status: 200, headers: { "Content-Type": "application/json" } });
  const mem = new Client({ apiKey: KEY, baseUrl: "https://api.wontopos.com", fetch });
  assert.deepEqual(await mem.revisions("u", { include: "revised" }), { revised: 1, memories: [{ id: "a" }], has_more: false });
  assert.deepEqual(await mem.revisions("u"), { revised: 0, unrevised: 3 });
});

test("addTurn refuses a createdAt Date outside the years 1 to 9999, as the same time written out is refused", async () => {
  const { seen, mem } = recorder();
  for (const at of ["+010000-01-01T00:00:00Z", "0000-06-01T00:00:00Z", "-000001-01-01T00:00:00Z"]) {
    await assert.rejects(mem.addTurn("a", "b", "u", { createdAt: new Date(at) }), said("createdAt is a Date outside the years 1 to 9999."));
  }
  await assert.rejects(mem.addTurn("a", "b", "u", { createdAt: "+010000-01-01T00:00:00Z" }), /createdAt must be a Date or an RFC 3339 time/);
  assert.equal(seen.length, 0);
  await mem.addTurn("a", "b", "u", { createdAt: new Date("9999-12-31T23:59:59Z") });
  await mem.addTurn("a", "b", "u", { createdAt: new Date("0001-01-01T00:00:00Z") });
  assert.deepEqual(seen.map((s) => s.body.created_at), ["9999-12-31T23:59:59.000Z", "0001-01-01T00:00:00.000Z"]);
});

test("verify is 0 to 3, as max_images is 0 to 5", async () => {
  const { seen, mem } = recorder('{"memories": []}');
  const calls = {
    search: (verify) => mem.search("q", "u", 10, { verify }),
    searchFull: (verify) => mem.searchFull("q", "u", 10, { verify }),
    searchSelf: (verify) => mem.searchSelf("q", "u", 10, { verify }),
    "search extra": (verify) => mem.search("q", "u", 10, { extra: { verify } }),
  };
  const missed = [];
  for (const [name, call] of Object.entries(calls)) {
    for (const bad of [-1, 4, 10, 2.5, NaN, "2", true]) {
      try {
        await call(bad);
        missed.push(`${name} ${String(bad)}: sent`);
      } catch (e) {
        if (!/verify must be an integer between 0 and 3/.test(e.message)) missed.push(`${name} ${String(bad)}: ${e.message}`);
      }
    }
  }
  assert.deepEqual(missed, []);
  assert.equal(seen.length, 0);
  await mem.search("q", "u", 10, { verify: 0 });
  await mem.search("q", "u", 10, { verify: 3 });
  assert.deepEqual(seen.map((s) => s.body.verify), [0, 3]);
});

test("engram trims its name and refuses a blank one", async () => {
  const { seen, mem } = recorder();
  for (const bad of ["", "   ", undefined, null, 5]) {
    await assert.rejects(mem.engram(bad, "q", "u"), said("name is required."));
  }
  assert.equal(seen.length, 0);
  await mem.engram(" timeline ", "q", "u");
  assert.equal(seen[0].body.name, "timeline");
});

test("filters.min_importance is 0 to 1", async () => {
  const { seen, mem } = recorder('{"memories": []}');
  const calls = {
    search: (filters) => mem.search("q", "u", 10, { filters }),
    searchFull: (filters) => mem.searchFull("q", "u", 10, { filters }),
    recall: (filters) => mem.recall("q", "u", { filters }),
    searchExtra: (filters) => mem.search("q", "u", 10, { extra: { filters } }),
    searchFullExtra: (filters) => mem.searchFull("q", "u", 10, { extra: { filters } }),
  };
  const missed = [];
  for (const [name, call] of Object.entries(calls)) {
    for (const bad of [50, -0.1, 1.5, NaN, true, "0.5"]) {
      try {
        await call({ min_importance: bad });
        missed.push(`${name} ${String(bad)}: sent`);
      } catch (e) {
        if (!/filters\.min_importance must be a number between 0 and 1/.test(e.message)) missed.push(`${name} ${String(bad)}: ${e.message}`);
      }
    }
  }
  assert.deepEqual(missed, []);
  assert.equal(seen.length, 0);
  for (const ok of [0, 0.5, 1]) await mem.search("q", "u", 10, { filters: { min_importance: ok } });
  assert.deepEqual(seen.map((s) => s.body.filters.min_importance), [0, 0.5, 1]);
});

test("an export goes on past a cursor that is a number", async () => {
  const answers = [
    '{"memories": [{"id": "a"}], "next_cursor": 7}',
    '{"memories": [{"id": "b"}], "next_cursor": "c2"}',
    '{"memories": [{"id": "c"}], "next_cursor": 0}',
  ];
  const sent = [];
  const fetch = async (url, init) => {
    sent.push(JSON.parse(init.body).cursor);
    return new Response(answers.shift(), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const mem = new Client({ apiKey: KEY, baseUrl: "https://api.wontopos.com", fetch });
  assert.deepEqual((await mem.exportMemories("u")).map((m) => m.id), ["a", "b", "c"]);
  assert.deepEqual(sent, [undefined, 7, "c2"]);
});

test("a per-call tz is checked without rooms, as with them", async () => {
  const { seen, mem } = recorder('{"memories": [], "work_id": "w"}');
  const calls = {
    recall: (tz) => mem.recall("q", "u", { tz }),
    "recall rooms false": (tz) => mem.recall("q", "u", { tz, rooms: false }),
    engram: (tz) => mem.engram("e", "q", "u", { tz }),
    search: (tz) => mem.search("q", "u", 10, { tz }),
    "searchFull extra": (tz) => mem.searchFull("q", "u", 10, { extra: { tz } }),
    searchSelf: (tz) => mem.searchSelf("q", "u", 10, { tz }),
    openWork: (tz) => mem.openWork("q", "u", { tz }),
    workSearch: (tz) => mem.workSearch("w", "q", "u", { tz }),
  };
  const missed = [];
  for (const [name, call] of Object.entries(calls)) {
    for (const bad of [15, -14.5, NaN, "9", true]) {
      try {
        await call(bad);
        missed.push(`${name} ${String(bad)}: sent`);
      } catch (e) {
        if (!/between -14 and 14/.test(e.message)) missed.push(`${name} ${String(bad)}: ${e.message}`);
      }
    }
  }
  assert.deepEqual(missed, []);
  assert.equal(seen.length, 0);
  await mem.engram("e", "q", "u", { tz: 5.5 });
  await mem.openWork("q", "u", { tz: 9 });
  assert.equal(seen[0].body.tz, 5.5);
  assert.deepEqual(seen[1].body, { user_id: "u", question: "q" });
});
