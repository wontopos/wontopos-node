# Wontopos — long-term memory for AI agents

```bash
npm install wontopos
```

Get an API key in the [console](https://wontopos.com). Keys look like `wos-live-...`;
the client also reads `WONTOPOS_API_KEY` from the environment.

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
- **No LLM in the loop** — `store` / `search` / `recall` never call a language model. You pay retrieval, not generation.
- **Bounded retrieval** — `recall()` returns a small, fixed-size slice regardless of how much you've stored (~1,000 tokens on `tablet-2`, the default engine).

## Methods

`add` · `addTurn` · `addBulk` · `update` · `search` · `searchFull` · `recall` · `history` · `stats` · `get` · `listMemories` · `delete` · `deleteAll`

Where the store id goes depends on whether the method takes a payload. A method that
writes or searches puts the payload first and the store second — `mem.add("...", "alice")`,
`mem.search("...", "alice")`. A method that only addresses a store takes it first —
`mem.listMemories("alice")`, `mem.stats("alice")`, `mem.delete("alice", memoryId)`.
Most of them let you leave it out for the client's default store. Four take it
positionally and cannot — `get`, `delete`, `lineage` and `forgetImage` want an explicit
`undefined` there, because a second required argument follows it. Python omits it in
all four; this is the one place the three clients differ in shape rather than meaning.
Let your editor confirm the order: every signature is typed. A store is one isolated memory space per end-user, agent, or topic. WHO said each memory inside a store is the `speaker` tag below — storing the assistant's own words never needs a separate id.

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
`removeSpeaker()` unregisters (memories stay, the tag goes). A store registers
up to 50 people to start (a limit we plan to raise); `"me"` never needs
registration and never counts against it.

## Recall caching

Opt in per search and repeated or extended queries reuse the previous result
at 10% of the normal rate (Tablet and Scroll models).

It is not free to turn on: the FIRST call writes the cache and bills the query
tokens at 2x for a `5m` TTL, 3x for `1h`. Only hits inside the TTL bill at 0.1x.
So it pays for a query you repeat or extend, and costs more for one you issue
once — do not switch it on globally. Any write to the store invalidates its cache
at once, so a hit can never predate a new memory.

```ts
const hits = await mem.search("...the conversation so far...", "alice", 10,
                              { cache_control: { ttl: "5m" } });  // or "1h"
```

## Reliability

Built in, no configuration needed:

- **Automatic retries** — 429 always, and 502 / 503 or a connection error only when a
  retry cannot double-process a write. The writes and the searches are POSTs, and a
  502 on one of those may have been returned *after* the service already stored and
  billed it, so those get 429 and connect-level failures only. The reads and the
  deletes that address a whole store — `listStores`, `listSpeakers`, `deleteStore`,
  `removeSpeaker`, `forgetImage` — are GET or DELETE and do retry a 502. Twice, with
  exponential backoff + jitter, honoring the server's `Retry-After`. Tune with
  `new Client({ maxRetries })`; `0` disables.
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
egress proxy this SDK could not connect at all — while the Python and Rust SDKs went
through, because `requests` and `reqwest` both read those variables. Pass a
proxy-aware `fetch` and the three behave the same:

This one needs `npm i undici` — Node's global `fetch` is built on undici, but the
package itself is not installed for you.

```ts
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

Built in, none of it configurable off:

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
update. `search` options are typed too (`SearchOptions`: `cache_control`,
`speaker`, plus pass-through).

```ts
import { type Memory } from "wontopos";

const hits: Memory[] = await mem.search("what did Bob say?", "alice", 10, { speaker: "Bob" });
console.log(hits[0].speaker, hits[0].time_bucket);   // typed: string | undefined
```

`hits` arrives best-first — take it in the order given. `similarity` is a raw
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

Include the SDK version (`the version in package.json`) and the language. If it involves a store id or a
memory, describe the shape rather than pasting the contents — we do not need your
data to fix it.

## Changelog

The three clients release in lockstep — same version, same surface, same day. Patch
releases are additive. Four inside 2.2 were not, deliberately and each with its
reason; the changelog lists them.

See [CHANGELOG.md](https://github.com/wontopos/wontopos-node/blob/main/CHANGELOG.md).
