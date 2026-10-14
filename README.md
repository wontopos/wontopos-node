# Wontopos — long-term memory for AI agents

```bash
npm install wontopos
```

Get an API key in the [console](https://wontopos.com). Keys look like `wos-live-...`;
`Client.fromEnv()` reads `WONTOPOS_API_KEY` from the environment instead.

```ts
import { Client } from "wontopos";

const mem = new Client({ apiKey: "wos-live-..." });

// Each end-user / agent / topic gets its own store — create it once.
// (A `default` store already exists, so you can skip this and omit the id.)
await mem.createStore("alice");
await mem.add("she prefers tea over coffee", "alice");

// one call → short-term + long-term + context, ready for your LLM prompt
const ctx = await mem.recall("what does alice drink?", "alice");
```

## Why

- **The same in every language** — identical recall whichever language a memory was written in (Korean · Japanese · Chinese · English).
- **No LLM reads your memories** — no language model reads your stored memories, on any model. You pay retrieval, not generation.
- **Bounded retrieval** — `recall()` returns the recent turns, at most `limit` long-term memories (default 10, up to 20) and at most `context_limit` rows of the surrounding conversation (default 10, up to 20), however much you've stored.

## Methods

| Method | What it does |
|---|---|
| **Write** | |
| `add(content, userId?, metadata?, opts?)` | Store one memory. Alias `store`. `opts.image` attaches a photo. |
| `addTurn(userMsg, assistantMsg, userId?)` | Store one exchange of a conversation. |
| `addBulk(content, userId?, category?, timestamp?)` | Backfill a long history in one call. |
| `update(oldMemoryId, newContent, userId?)` | Replace a fact that changed. The old version stays in its history. |
| **Read** | |
| `recall(query, userId?, opts?)` | The recent turns, the memories that match and the conversation around the best one, in one call. |
| `search(query, userId?, limit?, opts?)` | The memories that match, best first. |
| `searchFull(...)` | The same search with each part kept apart, `images` and `verify_used` included. |
| `searchSelf(...)` | The assistant's own words, kept apart from what others said. |
| `history(userId?)` | The recent conversation. |
| `get(userId, memoryId)` | One memory by id. |
| `listMemories` · `iterMemories` · `exportMemories` | Every memory in a store: a page at a time, as a stream, or all at once. |
| `lineage(userId, memoryId)` | The edits that followed one memory. |
| `revisions(userId?, opts?)` | How many of a store's memories were edited, and which. |
| `stats(userId?)` | Counts for a store. |
| `engram(name, query, userId?)` · `listEngrams()` | Built-in retrieval routines, and the ones a model can run. |
| **Photos** | |
| `listImages` · `iterImages` · `exportImages` | A store's image memories, newest first. |
| `getImage(userId, memoryId)` | The bytes of one image. |
| `forgetImage(userId, memoryId, { preview })` | Remove the photo from a memory. `preview: true` first says whether the memory itself stays. |
| **People** | |
| `addSpeaker` · `listSpeakers` · `removeSpeaker` | Register, list and unregister the people a store hears from. |
| `bySpeaker(speaker, userId?)` | What one person said, newest first. |
| **Stores** | |
| `createStore` · `listStores` · `deleteStore` | One isolated memory space per end-user, agent or topic. |
| `delete(userId, memoryId)` · `deleteAll(userId)` | Delete one memory, or every memory in a store. |
| **Account** | |
| `listModels()` | The models you can use, and what each can do. |
| `usage(days?)` | What this key, its workspace and its stores have spent. Free. |
| `ping()` | Check the key and the connection. |
| **Client** | |
| `withModel` · `withUser` · `withDeadline` · `withTimeout` · `withRetries` · `withSignal` | A copy of the client with another model, store, budget, timeout, retry count or cancel signal. |
| `Client.fromEnv()` · `rateLimit` | A client with the key from the environment; the last call's rate-limit numbers. |

Where the store id goes depends on whether the method takes a payload. A method that
writes or searches puts the payload first and the store second — `mem.add("...", "alice")`,
`mem.search("...", "alice")`. A method that only addresses a store takes it first —
`mem.listMemories("alice")`, `mem.stats("alice")`, `mem.delete("alice", memoryId)`.
Most of them let you leave it out for the client's default store. Five take it
positionally and cannot — `get`, `getImage`, `delete`, `lineage` and `forgetImage` want
an explicit `undefined` there, because a second required argument follows it. Python
omits it in all five, and Rust takes it positionally (`None` for the default store, where there is one).
Let your editor confirm the order: every signature is typed. A store is one isolated memory space per end-user, agent, or topic. WHO said each memory inside a store is the `speaker` tag below — storing the assistant's own words never needs a separate id.

## Putting recall into a prompt

```ts
const ctx = await mem.recall(userMessage, "alice");

const system = [
  "What you remember about this user, most relevant first:",
  ...ctx.long_term.memories.map((m) => `- ${m.content}`),
  "",
  "Around the most relevant memory:",
  ...ctx.context.around_top_memory,
  "",
  "The conversation so far:",
  ...ctx.short_term.turns.map((t) => `${t.role}: ${t.content}`),
].join("\n");

// Call your language model with `system` and the user's message, then store the exchange:
await mem.addTurn(userMessage, reply, "alice");
```

Each row of `around_top_memory` starts with `[before] `, `[match] ` or `[after] `: where it
sits next to the best memory. Keep every list in the order it arrives.

## Who said it (speakers)

Every memory can carry a speaker: `"me"` for the assistant's own words, or a
person's name. Speakers are explicit, like stores: register a person once,
then store under their name — a typo can never silently become a new person.
Search accepts a speaker too, to recall one person's words only.

```ts
await mem.addSpeaker("Bob", "alice");        // once per person
await mem.add("I promised to send the report on Friday", "alice", { speaker: "me" });
await mem.add("Bob said the deadline moved to Tuesday", "alice", { speaker: "Bob" });
await mem.search("what did Bob say about deadlines?", "alice", 10, { speaker: "Bob" });
```

`listSpeakers()` shows the registered people with per-person memory counts;
`removeSpeaker()` unregisters (memories stay; the tag goes, except on `tablet-2`, which keeps it on memories already stored). A store registers
up to 50 people to start (a limit we plan to raise); `"me"` never needs
registration and never counts against it.

## Photos

On a model whose `listModels()` capabilities include `images`, a memory can carry a photo.
The caption is still required.

```ts
import { readFileSync, writeFileSync } from "node:fs";

const data = readFileSync("beach.jpg").toString("base64");
const stored = await mem.add("At the beach with Bob", "alice", {}, { image: { data, taken_at: "2026-08-14" } });

const { bytes, contentType } = await mem.getImage("alice", stored.id!);
writeFileSync(`beach.${contentType.split("/")[1]}`, bytes);
```

Both edges must be 700px or more, the long edge at most 2500px and the file at most 7MB;
anything else is refused (400) with the reason. A long edge over 1568px is stored at
1568px, so keep your own copy of the original. `search` returns image memories after
the others, and `listImages` pages through them newest first. `forgetImage` removes the
photo, and it can remove the whole memory with it: call it with `preview: true` first,
and `memory_kept` says whether the memory stays.

## Export, edit history and usage

- **Export:** `exportMemories(userId)` returns every memory in a store, the text you
  stored and its metadata; `exportImages(userId)` every image memory. For a large store,
  `iterMemories` and `iterImages` stream them a page at a time.
- **Edit history:** `update` replaces a fact that changed. `lineage(userId, memoryId)` lists
  the versions from the id you pass forward, oldest first, and marks the one in force with
  `is_current`; pass the first version's id to see the whole history. `revisions()` counts
  how many of a store's memories were edited.
- **Usage:** `usage(days)` reports this key's spend, the workspace's spend over the window,
  the stores that spent the most, and the balance. It is free, and works at a zero balance.

## Recall caching

Opt in per search and a repeated query reuses the previous result at 10% of the
normal rate; an extended one reuses part of it (Tablet and Scroll models).

It is not free to turn on: the FIRST call writes the cache and bills the query
tokens at 2x for a `5m` TTL, 3x for `1h`. The same query again inside the TTL bills
its query and its results at 0.1x. A query that extends the cached one (its text plus
more) bills the cached part at 0.1x, the new part at the write rate and its results
at the normal rate. A store keeps one cached query per model and set of options, so a
different query replaces it. So it pays for a query you repeat or extend, and costs
more for one you issue once — do not switch it on globally. Any write to the store invalidates its cache
at once, so a hit can never predate a new memory.

```ts
const hits = await mem.search("...the conversation so far...", "alice", 10,
                              { cache_control: { ttl: "5m" } });  // or "1h"
```

## Reliability

Built in, no configuration needed:

- **Automatic retries** — 429 and a 409 for a write already in flight always, and 408 /
  502 / 503 / 504 or a connection error only when a retry cannot double-process a write.
  The calls that are safe to send again retry all four: the reads sent as POST (`search`,
  `recall`, `get`, `listMemories`, `stats`, ...), the GET and DELETE calls (`ping`,
  `listStores`, `listSpeakers`, `listModels`, `listEngrams`, `usage`, `deleteStore`,
  `removeSpeaker`, `forgetImage`), and the memory writes (`add`, `addTurn`, `addBulk`,
  `update`). Those carry an idempotency key, so the service answers a repeat with the
  first attempt's result instead of storing again. The other writes sent as POST
  (`createStore`, `addSpeaker`, `delete`, `deleteAll`) get 429, that 409 and
  connect-level failures only. Twice, with exponential backoff + jitter, honoring the
  server's `Retry-After` up to 30s. Tune with `new Client({ maxRetries })`; `0` disables.
- **Your own retries** — pass `idempotencyKey` when the retry is yours (a job that is
  re-run, a queue that redelivers). The service keeps a key for 24 hours and answers a
  repeat with the first response, marked `replayed: true`. When the first attempt did
  not come back with an answer, so whether it was applied is not known, a repeat
  is refused with a `ConflictError` (409) rather than stored twice: check before sending
  it again under a new key. Derive the key from what you store
  (`` `import:${row.id}` ``), never a constant.
- **Redirects refused** — the API key never follows a 3xx to another host.
- **Timeouts** — 30s per attempt by default (`timeoutMs`), and a total budget for
  the whole call across every retry with `deadlineMs` / `withDeadline(ms)`. At the
  defaults one call can hold for 30s + backoff + 30s + backoff + 30s, which a
  request handler with five seconds cannot use.
- **Cancellable** — pass the caller's `AbortSignal` (`new Client({ signal })` or
  `withSignal(signal)`). Aborting ends the request in flight and any backoff sleep
  waiting to retry it.
- **CommonJS and ESM** — `require("wontopos")` and `import` both resolve.
- **Key never in logs** — `JSON.stringify(client)` and Node's `console.log(client)`
  print a masked key.
- **Wipe guard** — `delete()` without a `memoryId` throws instead of silently
  meaning "delete everything"; wiping a store is only ever the explicit
  `deleteAll(userId)` / `deleteStore(userId)`.

### Behind a corporate proxy

Node's global `fetch` (undici) ignores `HTTP_PROXY` / `HTTPS_PROXY`, so behind an
egress proxy no request leaves at all. Pass a proxy-aware `fetch` and they go through:

This one needs `npm i undici` — Node's global `fetch` is built on undici, but the
package itself is not installed for you.

```ts
import { Client } from "wontopos";
import { ProxyAgent } from "undici";

const agent = new ProxyAgent(process.env.HTTPS_PROXY!);
const mem = new Client({
  apiKey: process.env.WONTOPOS_API_KEY!,
  fetch: (url, init) => fetch(url, { ...init, dispatcher: agent } as any),
});
```

The same option is how you add instrumentation or drive the client without a
network in tests. It replaces the transport, not the client's rules — retries,
timeouts, redirect refusal and the response cap all still apply.

## Security

Built in:

- **No key in a browser page** — anyone who opens a page can read a key in it, and with
  it every memory in its workspace. A client in a browser page that would send the key to
  the service is refused: call Wontopos from your server, or point `baseUrl` at a proxy of
  your own that holds the key. `dangerouslyAllowBrowser: true` turns the refusal off, for
  a local demo with a key you will revoke.
- **Redirects refused** — a 3xx is an error, so the key never follows one to
  another host.
- **Response size cap** — anything over 64MB is refused instead of buffered.
- **Key hygiene** — keys are trimmed (a stray newline from an env var otherwise
  becomes a mystery 401) and inner whitespace is rejected; model names are
  validated before they reach a header.
- **`Client.fromEnv()`** reads `WONTOPOS_API_KEY` (or `WOS_API_KEY`) — keep
  keys out of source code.
- TLS certificate verification is never touched (runtime defaults; Node 18+
  floors TLS at 1.2). Plain-HTTP base URLs on non-local hosts warn.
  Zero runtime dependencies.

## Typed responses

Every method returns a documented shape — `StoreResult`, `UpdateResult`,
`RecallResult`, `EngramResult`, `StatsResult`, `SpeakersList`, `Memory[]`, ... —
each with an index signature, so new server fields flow through without an SDK
update. `searchSelf`'s result and `getImage`'s bytes are built by the client and
carry only their own fields. `search` options are typed too (`SearchOptions`: `cache_control`,
`speaker`, plus `extra` for pass-through).

```ts
import { type Memory } from "wontopos";

const hits: Memory[] = await mem.search("what did Bob say?", "alice", 10, { speaker: "Bob" });
console.log(hits[0].speaker, hits[0].time_bucket);   // typed: string | undefined
```

`hits` holds memories best-first, then the assistant's own words and image memories in
their own order. Take it in the order given. `similarity` is a raw
closeness score, not the ranking key: what produces the order is internal and is
not returned, so sorting by `similarity` overrides the ranking and makes results
worse. There is no `score` field.

## Errors

Any non-2xx response throws `WosError` with `status`, `message`, and — when the
server sent one — `requestId` (include it when contacting support).

```ts
import { Client, WosError } from "wontopos";

try {
  await mem.search("...", "alice");
} catch (e) {
  if (e instanceof WosError) {
    if (e.status === 401) console.error("API key invalid or revoked");
    else if (e.status === 429) console.error("Rate limited");   // already retried twice by then
    else console.error(e.status, e.message, e.requestId);
  }
}
```

A retired model answers `410`, thrown as `GoneError`: retrying cannot succeed, so name a
live model (`listModels()` lists them, with `retires_at` on one that is scheduled to
retire). Before the day, the client warns once with the date the model you use retires.
`deleteStore` still works under a retired model.

## A different API host

Point the client somewhere other than the default endpoint - a dedicated region,
a proxy of your own, or a local test server:

```ts
const mem = new Client({ apiKey: "...", baseUrl: "https://api.example.com" });
```

## Links

- Homepage: <https://wontopos.com>
- API reference: <https://wontopos.com/en/why> (Developers tab)

## Reporting a bug

Found something wrong, or something that looks unsafe? Tell us — every report gets read.

- Bugs: <https://wontopos.com/contact?topic=bug>
- Security: <https://wontopos.com/contact?topic=security> (also published at
  [`/.well-known/security.txt`](https://wontopos.com/.well-known/security.txt))

Include the SDK version (the one in package.json) and the language. If it involves a store id or a
memory, describe the shape rather than pasting the contents — we do not need your
data to fix it.

## Changelog

The three clients release in lockstep — same version, same surface, same day. Patch
releases are additive. Ten inside 2.2 were not, deliberately and each with its
reason; the changelog lists them.

See [CHANGELOG.md](https://github.com/wontopos/wontopos-node/blob/main/CHANGELOG.md).
