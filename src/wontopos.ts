/**
 * Wontopos — long-term memory for AI, in three lines.
 *
 *   npm install wontopos
 *
 *   import { Client } from "wontopos";
 *   const mem = new Client({ apiKey: "wos-...", userId: "alice" }); // set the store once
 *   await mem.createStore();                              // create it (uses the client's userId)
 *   await mem.add("she prefers tea over coffee");         // no userId needed
 *   const hits = await mem.search("what does alice drink?");
 *
 * Set `userId` once on the client and every call uses it; override any single call
 * by passing `userId` to it. Stores are explicit: the store must exist first
 * (`createStore`) or calls return 404. Every account starts with a `default` store,
 * so with no `userId` anywhere the zero-setup path just works.
 *
 * The API key picks *which memory* (your account); `model` picks *which engine*
 * reads it. Models on the shared pool read the same memory, so you can store with
 * one and recall with another; `listModels()` reports each model's `memory` as
 * `"shared"` or `"isolated"`, and an isolated one starts empty. Set a default in
 * the constructor, or override a single call with
 * `mem.withModel("tablet-1").recall(...)`.
 *
 * Recall quality does not depend on which language a memory was written in: a
 * memory stored in one language is found by a question asked in another. Storing
 * and searching call no LLM.
 *
 * Reliability: every call retries transient failures with exponential backoff +
 * jitter, honoring `Retry-After` up to 30s — 429 and a 409 that says another write
 * to the store was in flight, always; 408/502/503/504 and connection errors only when
 * a retry can never double-process a write (idempotent calls, or a failure at connect
 * time). Tune with `maxRetries` (0 disables) and `timeoutMs`, or per call site via
 * the `withTimeout()` / `withRetries()` clones.
 *
 * Debugging: set `WONTOPOS_LOG=debug` to log method/path/status/timing/retries
 * to stderr — never memory content, request bodies, or the API key.
 *
 * Security posture (not configurable off): redirects are refused so the API key
 * can never follow one to another host; responses over 64MB are refused; the key
 * is masked in `toJSON`/inspect output. TLS certificate verification is the
 * runtime's (never disabled by this SDK; Node 18+ floors TLS at 1.2). Prefer
 * `Client.fromEnv()` over keys in source code.
 */

const VERSION = "2.2.44";
/** Runtime info helps support debug a report ("node 18 on Windows...") —
 * platform only, never anything identifying. Browsers have no `process` (and
 * silently drop the UA header anyway). */
const RUNTIME = (() => {
  const p = (globalThis as any)?.process;
  return p?.version ? ` (node/${p.version}; ${p.platform}-${p.arch})` : "";
})();
const USER_AGENT = `wontopos-node/${VERSION}${RUNTIME}`;

/** Wire-level debug logging: set WONTOPOS_LOG=debug. Logs method/path/status/
 * timing/retries to stderr — NEVER memory content, request bodies, or the key. */
function logDebug(msg: string): void {
  const env = (globalThis as any)?.process?.env;
  if (typeof env?.WONTOPOS_LOG === "string" && env.WONTOPOS_LOG.toLowerCase() === "debug") {
    console.error(`wontopos: ${msg}`);
  }
}
const DEFAULT_BASE_URL = "https://api.wontopos.com";
/** The engine every call uses unless the caller names another. Pin a different one
 *  with `new Client({ apiKey, model: "tablet-1" })` or `withModel("tablet-1")`;
 *  `listModels()` reports what each model can do in `capabilities`. */
const DEFAULT_MODEL = "tablet-2";
/** 429 is refused before the request is processed → always safe to retry, nothing
 *  was stored. */
const RETRY_ALWAYS = new Set([429]);
/** The longest wait before a retry. A `Retry-After` asking for more is not waited
 *  out: the call fails at once with the server's error. */
const MAX_RETRY_WAIT_MS = 30_000;
/** setTimeout's ceiling; a longer delay fires after 1ms. */
const MAX_TIMER_MS = 2_147_483_647;
/** 502/503 are ambiguous for a write — they can arrive after the write already
 *  landed, and a retried POST would store it twice — so retry them only for
 *  idempotent methods. 504 is the same shape. 408 sits here rather than in
 *  RETRY_ALWAYS because an intermediary can answer it without knowing what
 *  happened further along. */
const RETRY_IF_IDEMPOTENT = new Set([408, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
/** POST routes that only read. When the deadline cuts short a retry of one, the answer
 *  before it still describes the call, as for an idempotent method. */
const READ_POSTS = new Set([
  "/api/v1/memory/search",
  "/api/v1/memory/recall",
  "/api/v1/memory/get",
  "/api/v1/memory/list",
  "/api/v1/memory/stats",
  "/api/v1/memory/history",
  "/api/v1/memory/lineage",
  "/api/v1/memory/by-speaker",
  "/api/v1/memory/images",
  "/api/v1/memory/image",
  "/api/v1/engram/run",
  "/api/v1/won/revisions",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
/** Refuse to buffer absurd responses (real ones are a few KB) — protects the
 * process if a custom baseUrl points somewhere broken or hostile. */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
/** Model names travel in a header — only header-safe characters. */
const MODEL_RE = /^[A-Za-z0-9._-]+$/;
/** Cap a server-controlled error message so a hostile body can't blow up a log. */
const MAX_ERR_MSG = 4096;
/** `WosError.details` JSON stays at most this long (its biggest fields are dropped), for the same reason. */
const MAX_ERR_DETAILS = 8192;
/** What the API accepts as an `Idempotency-Key`. Checked client-side so a bad key
 *  fails before the request instead of coming back as a 400 mid-retry. */
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:\-]{1,128}$/;

/**
 * A store id is 1-64 ASCII letters, digits, `.`, `_` and `-`, starting with a letter or
 * digit. Creating any other id (an email address, a name in another script) is refused
 * (400), so key stores on an id of your own. Store ids compare without regard to case:
 * `Alice` and `alice` name one store. Ids that differ only in `.`, `_` or `-` cannot
 * both exist: once `alice-smith` exists, creating `alice.smith` is refused (409) and
 * using it answers 404. With one store per end user, derive the ids so two users never
 * differ only in those three characters.
 */
function normalizeStoreId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}
/** Ids already warned about, so each is reported once. Bounded: with one store per end
 *  user it sees one id per user, so past the cap the oldest entry is evicted and an id
 *  that first shows up late still gets its warning. */
const WARNED_STORE_IDS_MAX = 1024;
/** A store id is usable when it was omitted, or is a non-blank string. `null`, `0`
 *  and other non-strings are refused: `String(null)` is the truthy "null". */
function assertUsableStoreId(userId: unknown): asserts userId is string | undefined {
  if (userId !== undefined && (typeof userId !== "string" || !userId.trim())) {
    throw new Error(
      `userId must be a non-blank string; got ${JSON.stringify(userId)}. Omit it to use the client's ` +
        "default store, or pass a real store id — anything else would silently write into the default store.",
    );
  }
}

/** Same cap, same reason, for the unknown-filter warn set. */
const WARNED_FILTER_KEYS_MAX = 1024;
const warnedStoreIds = new Set<string>();
function warnIfStoreIdCollapses(id: string): void {
  if (!id || warnedStoreIds.has(id)) return;
  const valid = STORE_ID_FORMAT.test(id);
  const normalized = normalizeStoreId(id);
  if (valid && normalized === id) return;
  warnedStoreIds.add(id);
  while (warnedStoreIds.size > WARNED_STORE_IDS_MAX) {
    const oldest = warnedStoreIds.values().next().value;
    if (oldest === undefined) break;
    warnedStoreIds.delete(oldest);
  }
  if (!valid) {
    console.warn(
      `wontopos: store id ${JSON.stringify(id)} is not a valid store id: use 1-64 ASCII letters, ` +
        `digits, ".", "_" and "-", starting with a letter or digit. Creating it is refused (400).`,
    );
    return;
  }
  console.warn(
    `wontopos: store id ${JSON.stringify(id)} normalizes to ${JSON.stringify(normalized)}. ` +
      `Ids that differ only by case name this same store; one that differs only by punctuation ` +
      `cannot be created beside it (409) and is not found when used (404). If these ids come from ` +
      `your end users, normalize them yourself first so two people never compete for one name.`,
  );
}
/** The store ids the API accepts. */
const STORE_ID_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Metadata keys that spell a store id or the idempotency key, compared in any case with
 *  spaces, `_`, `-` and `.` ignored. Those values have their own parameters. */
const NOT_METADATA = new Set(["userid", "storeid", "idempotencykey"]);
function checkMetadataKeys(metadata: unknown): void {
  if (metadata == null || typeof metadata !== "object") return;
  for (const k of Object.keys(metadata)) {
    if (NOT_METADATA.has(k.toLowerCase().replace(/[\s_.-]/g, ""))) {
      throw new Error(
        `${JSON.stringify(k)} is not a metadata field: pass the store as userId and an ` +
          `idempotency key as opts.idempotencyKey. Nothing was sent.`,
      );
    }
  }
}
/** @deprecated Test hook. The warn-once set is process-global by design. */
export function _resetStoreIdWarnings(): void {
  warnedStoreIds.clear();
}
/** Statuses that legitimately carry NO body (RFC 9110). Everything else must
 *  answer with a JSON object — see the empty-body check in `request`. */
const NO_BODY_STATUS = new Set([204, 205, 304]);
// Paging backstop: 20,000 pages is two million memories at 100 a page, past any real
// store. A walk that reaches it throws, because a truncated list looks exactly like a
// complete one to whoever writes it to a file.
const MAX_PAGES = 20_000;

/** The error a page walk throws when it cannot reach the end of the store. */
function truncatedWalk(why: string): Error {
  return new Error(`${why} This is a truncated answer, not the whole store.`);
}

export const SEARCH_LIMIT_MIN = 5;
export const SEARCH_LIMIT_MAX = 20;

/** `recall`'s surrounding-context count. 0 to 20 inclusive; 0 attaches none. */
export const CONTEXT_LIMIT_MIN = 0;
export const CONTEXT_LIMIT_MAX = 20;

/** The 5-to-20 count shared by `search` and `recall`, refused out of range rather
 * than quietly adjusted: asking for 20 and silently getting 10 reads as "that is
 * all there is".
 *
 * Thrown as a plain `Error`, like every other argument check in this file. It is
 * NOT a `WosError` — nothing was sent, and status 0 is reserved for
 * `APIConnectionError`, "the request never got a response", which a caller may
 * retry. */
function checkCount(limit: number, name: string): void {
  if (!Number.isInteger(limit) || limit < SEARCH_LIMIT_MIN || limit > SEARCH_LIMIT_MAX) {
    throw new Error(
      `${name} must be an integer between ${SEARCH_LIMIT_MIN} and ${SEARCH_LIMIT_MAX}, got ${limit}. ` +
        `Out of range is refused rather than adjusted, so a short answer always means ` +
        `the store was short.`
    );
  }
}

/** `recall`'s `context_limit`, 0 to 20, refused out of range like the count above. */
function checkContextLimit(n: number): void {
  if (!Number.isInteger(n) || n < CONTEXT_LIMIT_MIN || n > CONTEXT_LIMIT_MAX) {
    throw new Error(
      `context_limit must be an integer between ${CONTEXT_LIMIT_MIN} and ${CONTEXT_LIMIT_MAX}, got ${n}.`
    );
  }
}

/** Page sizes the service takes for images, `bySpeaker` and `revisions`. */
const PAGE_LIMIT_MIN = 5;
const PAGE_LIMIT_MAX = 20;
/** The most memories one `listMemories` page returns. */
const LIST_LIMIT_MAX = 500;
/** How many image memories a search may carry. */
const MAX_IMAGES_MAX = 5;

/** An integer in `min..=max`, or a plain `Error` naming the range. Booleans, strings
 *  and non-finite numbers are refused rather than sent. */
function checkRange(n: unknown, name: string, min: number, max: number): void {
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got ${String(n)}.`);
  }
}

/** An optional count: `undefined` when not given (`undefined` or `null`), otherwise
 *  checked by `checkRange`. */
function optRange(n: unknown, name: string, min: number, max: number): number | undefined {
  if (n === undefined || n === null) return undefined;
  checkRange(n, name, min, max);
  return n as number;
}

/** A timeout or deadline in ms. Anything that is not a positive number means "not set";
 *  a value past the timer ceiling is clamped. */
function checkMs(v: unknown): number | undefined {
  if (typeof v !== "number" || Number.isNaN(v) || v <= 0) return undefined;
  return Math.min(v, MAX_TIMER_MS);
}

/**
 * Put an image into the shape the API expects, and fail loudly on the parts we can
 * check from here.
 *
 * Deliberately NOT checked: the byte ceiling. It is a service setting, so a number
 * baked in here would drift the first time the service is reconfigured and would
 * reject an image the service would have taken.
 * What we do check is what cannot change: an empty payload, and a `data:` URL
 * prefix — browsers and file pickers hand you `data:image/jpeg;base64,…`, the API
 * wants the part after the comma, and the difference is invisible until the write
 * fails with "not a readable image".
 */
function normalizeImage(image: ImageInput): Record<string, unknown> {
  if (!image || typeof image !== "object") {
    throw new Error("image must be an object — { data: '<base64>' }.");
  }
  if (typeof image.data !== "string" || image.data.trim() === "") {
    throw new Error("image.data is required — base64 of the image (a data: URL is fine).");
  }
  // Trim before looking for the prefix. Checked against the raw string, one leading
  // space (` data:image/png;base64,…`) hides the prefix, and the literal
  // `data:image/png;base64,` travels as part of the base64. The service answers 400
  // "image could not be read" and the caller has no way to tell why.
  const raw = image.data.trim();
  const comma = raw.startsWith("data:") ? raw.indexOf(",") : -1;
  // Strip whitespace in the middle as well. `base64` and `openssl base64` wrap at 76
  // columns, and trimming only the ends leaves those line breaks in the payload. The
  // base64 alphabet contains no whitespace, so removing all of it is safe.
  const data = (comma === -1 ? raw : raw.slice(comma + 1)).replace(/\s+/g, "");
  if (data === "") throw new Error("image.data is empty after stripping its data: prefix.");
  const out: Record<string, unknown> = { data };
  if (image.reference !== undefined) out.reference = image.reference;
  if (image.taken_at !== undefined) out.taken_at = image.taken_at;
  return out;
}
/** Error codes that can come from ESTABLISHING a connection. They count as a
 * connect failure (the request never reached the server, so a retry can't
 * double-process a write) only when the failing syscall is the connect or the DNS
 * lookup: the same codes on a `read` or `write` mean the request may already have
 * been sent. Mid-stream codes (ECONNRESET, EPIPE, UND_ERR_SOCKET, ETIMEDOUT) never
 * count. */
const CONNECT_FAIL_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EADDRNOTAVAIL",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const CONNECT_SYSCALLS = new Set(["connect", "getaddrinfo"]);
/** Codes that only a DNS lookup or a connect timeout produce, whatever the syscall. */
const CONNECT_ONLY_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

/** Walk an error's `cause` chain (and AggregateError members — happy-eyeballs
 * connects) looking for a connect-level failure. */
function isConnectFailure(e: unknown): boolean {
  const stack: unknown[] = [e];
  for (let steps = 0; stack.length && steps < 24; steps++) {
    const cur = stack.pop() as any;
    if (!cur || typeof cur !== "object") continue;
    if (
      typeof cur.code === "string" &&
      (CONNECT_ONLY_CODES.has(cur.code) || (CONNECT_FAIL_CODES.has(cur.code) && CONNECT_SYSCALLS.has(cur.syscall)))
    ) {
      return true;
    }
    if (cur.cause) stack.push(cur.cause);
    if (Array.isArray(cur.errors)) stack.push(...cur.errors.slice(0, 8));
  }
  return false;
}

/** The first `code` in an error's cause chain (`ECONNREFUSED`, `CERT_HAS_EXPIRED`, …). */
function causeCode(e: unknown): string | undefined {
  const queue: unknown[] = [e];
  for (let steps = 0; queue.length && steps < 24; steps++) {
    const cur = queue.shift() as any;
    if (!cur || typeof cur !== "object") continue;
    if (typeof cur.code === "string" && /^[A-Z0-9_]{1,64}$/.test(cur.code)) return cur.code;
    if (cur.cause) queue.push(cur.cause);
    if (Array.isArray(cur.errors)) queue.push(...cur.errors.slice(0, 8));
  }
  return undefined;
}

/** Server-provided text as it may appear in an error message: C0 control characters
 *  and DEL removed, so it cannot fake log lines or drive a terminal, and capped. */
function cleanServerText(s: string, max = MAX_ERR_MSG): string {
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u001f\u007f]/g, "");
  return clean.length > max ? clean.slice(0, max) + "…(truncated)" : clean;
}

/** The rest of a server's error object as `WosError.details`, with control characters
 *  removed from every key and string and each string capped. When its JSON is still
 *  over `MAX_ERR_DETAILS`, the biggest fields are dropped until it fits, so a short
 *  field such as `conflicts_with` survives a long one beside it. */
function cleanDetails(d: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!d) return undefined;
  const clean = (v: unknown): unknown => {
    if (typeof v === "string") return cleanServerText(v);
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") {
      // fromEntries defines own properties, so a "__proto__" key stays a plain key.
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [cleanServerText(k), clean(x)]));
    }
    return v;
  };
  let entries: [string, unknown, number][];
  try {
    // Stringify first: it throws on nesting too deep for `clean` to walk.
    JSON.stringify(d);
    entries = Object.entries(clean(d) as Record<string, unknown>).map(([k, v]) => [
      k,
      v,
      JSON.stringify(k).length + JSON.stringify(v).length + 2,
    ]);
  } catch {
    return undefined;
  }
  const keep = new Set<string>();
  let size = 2;
  for (const [k, , n] of [...entries].sort((a, b) => a[2] - b[2])) {
    if (size + n > MAX_ERR_DETAILS) break;
    keep.add(k);
    size += n;
  }
  if (!keep.size) return undefined;
  return Object.fromEntries(entries.filter(([k]) => keep.has(k)).map(([k, v]) => [k, v]));
}

/** What an error body says, from the envelope
 *  `{"type":"error","error":{"type","message","request_id",…}}`, a bare
 *  `{"error":"reason"}`, or `{"message":"…"}`; otherwise the raw text. */
function parseErrorText(text: string): {
  message: string;
  requestId?: string;
  type?: string;
  details?: Record<string, unknown>;
} {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { message: text };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { message: text };
  const err = (data as any).error;
  if (err && typeof err === "object" && !Array.isArray(err)) {
    const { message, type, request_id, ...rest } = err as Record<string, unknown>;
    return {
      message: typeof message === "string" ? message : typeof type === "string" ? type : text,
      requestId: typeof request_id === "string" ? request_id : undefined,
      type: typeof type === "string" ? type : undefined,
      details: Object.keys(rest).length ? rest : undefined,
    };
  }
  if (typeof err === "string") return { message: err };
  if (typeof (data as any).message === "string") return { message: (data as any).message };
  return { message: text };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IMF_FIXDATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const RFC850_DATE =
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const ASCTIME_DATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;

/** Milliseconds a `Retry-After` value asks for, or `undefined` when it is neither
 *  delta-seconds nor an HTTP-date (RFC 9110). A date in the past asks for 0. */
function retryAfterMs(v: string | null, now = Date.now()): number | undefined {
  if (v == null) return undefined;
  const s = v.trim();
  if (/^\d+$/.test(s)) return Math.min(Number(s), Number.MAX_SAFE_INTEGER / 1000) * 1000;
  let parts: [string, string, number, string, string, string] | undefined;
  let m: RegExpExecArray | null;
  if ((m = IMF_FIXDATE.exec(s))) parts = [m[1], m[2], Number(m[3]), m[4], m[5], m[6]];
  else if ((m = RFC850_DATE.exec(s))) {
    // A two-digit year more than 50 years ahead is the most recent past one.
    let year = 2000 + Number(m[3]);
    if (year > new Date(now).getUTCFullYear() + 50) year -= 100;
    parts = [m[1], m[2], year, m[4], m[5], m[6]];
  } else if ((m = ASCTIME_DATE.exec(s))) parts = [m[2].trim(), m[1], Number(m[6]), m[3], m[4], m[5]];
  if (!parts) return undefined;
  const [day, mon, year, hh, mm, ss] = parts;
  const month = MONTHS.indexOf(mon);
  const d = Number(day), h = Number(hh), mi = Number(mm), se = Number(ss);
  if (month < 0 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) return undefined;
  return Math.max(0, Date.UTC(year, month, d, h, mi, se) - now);
}

/** How long the error body of an answer that will be retried gets to arrive. The retry
 *  does not need it; it only fills in the error reported if the retry cannot be made. */
const BRIEF_BODY_MS = 1_000;

/** A body that did not arrive within the time it was given. */
class SlowBody extends Error {}

/** The global fetch bound to `globalThis`. Clones pass it back in as `fetch`, so each
 *  one is remembered as not the caller's own. */
const DEFAULT_TRANSPORTS = new WeakSet<object>();
function defaultTransport(): unknown {
  const g = (globalThis as any).fetch;
  if (typeof g !== "function") return undefined;
  const bound = g.bind(globalThis);
  DEFAULT_TRANSPORTS.add(bound);
  return bound;
}

/** Release a response body that will not be read; a failed cancel has nothing to report. */
function discard(res: { body?: { cancel(): Promise<void> } | null }): void {
  res.body?.cancel().catch(() => {});
}

/** `new URL(s, base)`, or `undefined` when it does not parse. */
function tryUrl(s: string, base?: string): URL | undefined {
  try {
    return base === undefined ? new URL(s) : new URL(s, base);
  } catch {
    return undefined;
  }
}

/** The page a relative URL resolves against (`location.href`), where the runtime has one. */
function pageHref(): string | undefined {
  try {
    const href = (globalThis as any).location?.href;
    return typeof href === "string" ? href : undefined;
  } catch {
    return undefined; // a runtime whose `location` throws when it has none
  }
}

/** `baseUrl` read the way fetch will read it: an absolute http(s) URL, or, where the
 *  runtime has a page (`location`), a URL relative to that page. `undefined` when
 *  fetch cannot send to it. */
function parseBase(base: string): URL | undefined {
  let url = tryUrl(base);
  if (!url) {
    const page = pageHref();
    if (page !== undefined) url = tryUrl(base, page);
  }
  return url && (url.protocol === "http:" || url.protocol === "https:") ? url : undefined;
}

/** `baseUrl` read as relative to a page, when it has no scheme of its own. */
function asPageRelative(base: string): URL | undefined {
  return tryUrl(base) ? undefined : tryUrl(base, "http://page.invalid/");
}

/** Whitespace at either end of a string. A control character there is refused. */
const BASE_URL_ENDS = /^\s+|\s+$/g;

/** The error for a `baseUrl` fetch cannot send to. */
function notAUrl(base: string): string {
  return `baseUrl is not a URL: ${JSON.stringify(maskBase(base))} (expected e.g. ${DEFAULT_BASE_URL})`;
}

/** A base URL as an error message may show it: everything from after the scheme and
 *  its slashes up to the last `@` (userinfo, which can hold a password) becomes `***@`. */
function maskBase(raw: string): string {
  const at = raw.lastIndexOf("@");
  if (at === -1) return raw;
  const from = /^(?:[a-z][a-z0-9+.-]*:)?[\\/]*/i.exec(raw)![0].length;
  return `${raw.slice(0, from)}***@${raw.slice(at + 1)}`;
}

/** Text that may quote a URL, with every userinfo in it masked: the run of characters
 *  before an `@` becomes `***` when it follows a slash or holds a `:` (after a leading
 *  scheme, which stays). One pass, so a long message costs no more than its length. */
function maskUserinfo(text: string): string {
  let out = "";
  let done = 0;
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    let start = at;
    while (start > 0 && !/[\s\\/@]/.test(text[start - 1])) start--;
    const run = text.slice(start, at);
    const afterSlash = start > 0 && (text[start - 1] === "/" || text[start - 1] === "\\");
    if (!afterSlash && !run.includes(":")) continue;
    const scheme = afterSlash ? "" : (/^[a-z][a-z0-9+.-]*:/i.exec(run)?.[0] ?? "");
    out += `${text.slice(done, start + scheme.length)}***`;
    done = at;
  }
  return out + text.slice(done);
}

/** `wos-abc...wxyz` — enough to tell keys apart, never enough to use. */
function maskKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "***";
}

/** Quota from a response's `X-RateLimit-*` headers, or `null` if absent. */
export interface RateLimit {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

function parseRateLimit(h: Headers): RateLimit | null {
  const num = (name: string): number | null => {
    const v = h.get(name);
    if (v == null || v.trim() === "") return null; // Number("") is 0 — treat blank as absent
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const limit = num("X-RateLimit-Limit");
  const remaining = num("X-RateLimit-Remaining");
  const reset = num("X-RateLimit-Reset");
  if (limit === null && remaining === null && reset === null) return null;
  return { limit, remaining, reset };
}

// A list/object field the API promises. `x ?? []` only replaces null/undefined — a
// broken or hostile server sending a truthy wrong type (`"memories": "oops"`) would
// slip through as a string and blow up the caller's `for (…of…)`. Coerce anything
// that isn't actually an array/object to the empty value.
const asList = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const asObj = <T>(x: unknown): T => (x != null && typeof x === "object" && !Array.isArray(x) ? (x as T) : ({} as T));
// A list of API records (memories, turns, models...) — every element is an object
// by contract. `asList` only fixes the CONTAINER: a hostile/broken server sending
// `{"memories": [null, 1, "x", {...}]}` still handed the caller those non-objects,
// typed as Memory[], and the first `m.content` threw a raw TypeError from inside
// user code. Drop elements that aren't objects and keep the valid records, so one
// bad element never poisons the batch (and never destroys it).
const asRecords = <T>(x: unknown): T[] =>
  asList<unknown>(x).filter((m): m is T => m != null && typeof m === "object" && !Array.isArray(m));
// `get` answers `{memory: {...}}` on some models and the row itself on others.
const memoryFromGet = (r: unknown): Memory => {
  const o = asObj<Record<string, unknown>>(r);
  if (o.memory != null && typeof o.memory === "object" && !Array.isArray(o.memory)) return o.memory as Memory;
  return typeof o.id === "string" ? (o as unknown as Memory) : ({} as Memory);
};

/** Every memory a search returned — `memories`, then `self_memories`, then
 * `images` — as one array, de-duplicated by id. Each keeps its `speaker` and, for a
 * photo, its `image_ref`, so a caller can still tell them apart. */
function mergeResults(r: { memories?: unknown; self_memories?: unknown; images?: unknown }): Memory[] {
  const out = asRecords<Memory>(r?.memories);
  const seen = new Set(out.map((m) => m.id).filter((id): id is string => typeof id === "string"));
  for (const m of [...asRecords<Memory>(r?.self_memories), ...asRecords<Memory>(r?.images)]) {
    if (typeof m.id === "string") {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
    }
    out.push(m);
  }
  return out;
}

/** Attach a delivery-form override ("memoir"/"archive") + tz to a request body, the
 * way search passes them; on a model that lists `forms` in its capabilities this
 * renders each returned memory's time in that form. The server validates the form
 * (400 on an unknown one). */
function withForm(body: Record<string, unknown>, form?: string, tz?: number): Record<string, unknown> {
  if (form !== undefined) body.form = form;
  if (tz !== undefined) body.tz = tz;
  return body;
}

/** What a `WosError` carries beyond its status, message and request id. */
export interface WosErrorInit {
  /** `error.type` from the service's answer. */
  type?: string;
  /** The rest of the service's error object. */
  details?: Record<string, unknown>;
  /** `Retry-After`, in seconds (read by `RateLimitError`). */
  retryAfter?: number;
  /** The underlying error, kept as the standard `cause`. */
  cause?: unknown;
}

export class WosError extends Error {
  readonly status: number;
  /** The server's id for the request when it sent one — include it when contacting support. */
  readonly requestId?: string;
  /** `error.type` from the service's answer (e.g. `"conflict_error"`), when it sent one.
   *  Control characters are removed and it is capped, like the message. */
  readonly type?: string;
  /** Every other field of the service's error object — all but `message`, `type` and
   *  `request_id` — when there is any. Control characters are removed from its keys
   *  and strings, each string is capped, and when its JSON is over 8192 characters the
   *  biggest fields are left out. A 501 carries `model` and `endpoint` here. */
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, requestId?: string, init?: WosErrorInit) {
    super(
      `[${status}] ${message}${requestId ? ` (request_id: ${requestId})` : ""}`,
      init?.cause === undefined ? undefined : { cause: init.cause },
    );
    this.name = new.target.name; // the concrete subclass name (RateLimitError, …)
    this.status = status;
    this.requestId = requestId;
    this.type = init?.type;
    this.details = init?.details;
  }
}

// Typed subclasses so callers can branch on the failure — `catch (e) { if (e instanceof
// RateLimitError) … }`. Each is a WosError, so a broad `instanceof WosError` still works.
/** The request never got a response (DNS/TLS/timeout/connection). `status` is 0. */
export class APIConnectionError extends WosError {}
/** 400 — the request was malformed (bad arguments). 413 (body too large) and 422
 *  (an idempotency key reused with a different body) arrive as this class too. */
export class BadRequestError extends WosError {}
/** 401 — the API key is missing, wrong, or revoked. */
export class AuthenticationError extends WosError {}
/** 402 — no card on file or the balance is depleted. Top up to continue. */
export class PaymentRequiredError extends WosError {}
/** 403 — the key/model isn't allowed to do this. */
export class PermissionDeniedError extends WosError {}
/** 404 — the store or resource doesn't exist. */
export class NotFoundError extends WosError {}
/** 409: another write to this store was in flight (retried automatically; nothing was
 *  stored), or the store id collides with an existing one (not retried). */
export class ConflictError extends WosError {
  /** The existing store id this one collides with. Set only on a collision, which
   *  retrying cannot fix. */
  readonly conflictsWith?: string;
  constructor(status: number, message: string, requestId?: string, init?: WosErrorInit) {
    super(status, message, requestId, init);
    const c = init?.details?.conflicts_with;
    this.conflictsWith = typeof c === "string" ? c : undefined;
  }
}
/** 410 — the model this call named is retired. Retrying cannot succeed: name a live
 *  model instead (`listModels()` lists them). `deleteStore` still works under a
 *  retired model. */
export class GoneError extends WosError {}
/** 429 — too many requests. Back off and retry (the client already retries these,
 *  unless `Retry-After` asks for more than 30 seconds). */
export class RateLimitError extends WosError {
  /** Seconds the service asked to wait (`Retry-After`), when it said. */
  readonly retryAfter?: number;
  constructor(status: number, message: string, requestId?: string, init?: WosErrorInit) {
    super(status, message, requestId, init);
    const r = init?.retryAfter;
    this.retryAfter = typeof r === "number" && Number.isFinite(r) && r >= 0 ? r : undefined;
  }
}
/**
 * 5xx — the service failed.
 *
 * `502` / `503` / `504` are transient: the client already retries them for calls
 * where a retry cannot double-process a write, and retrying yourself is reasonable.
 *
 * `501` is NOT transient. It means the model you selected does not implement that
 * endpoint at all (`details` carries `model` and `endpoint`). Retrying can never
 * succeed — pick a model that supports it (`listModels`) or drop the call.
 */
export class ServerError extends WosError {}

const GONE_HINT = "This model is retired; listModels() lists the ones you can use.";

const STATUS_ERRORS: Record<number, new (s: number, m: string, r?: string, i?: WosErrorInit) => WosError> = {
  400: BadRequestError,
  401: AuthenticationError,
  402: PaymentRequiredError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  410: GoneError,
  413: BadRequestError,
  422: BadRequestError,
  429: RateLimitError,
};

/** Build the most specific WosError subclass for an HTTP status. */
// Internal factory — the typed error CLASSES are the public surface.
function errorFor(status: number, message: string, requestId?: string, init?: WosErrorInit): WosError {
  const Cls =
    status === 0
      ? APIConnectionError
      : STATUS_ERRORS[status] ?? (status >= 500 && status < 600 ? ServerError : WosError);
  return new Cls(status, message, requestId, init);
}

// ----- response shapes (per https://wontopos.com/llms.txt) -----
// Every interface keeps an index signature: fields the server adds later still
// come through without an SDK update.

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

export interface Memory {
  id?: string;
  content?: string;
  /** Cognitive category, e.g. "general". */
  category?: string;
  /** Raw closeness to the query — higher is closer. NOT the ranking key: results already
   *  arrive best-first, and what produces that order is internal and not returned, so
   *  re-sorting by `similarity` overrides the ranking and makes results worse. Take the
   *  list in the order given. There is no `score` field. */
  similarity?: number;
  /** Importance weight the service assigns to the memory. */
  importance?: number;
  /** Month bucket the memory belongs to (e.g. "2026-07"). Omitted when temporal fields are stripped. */
  time_bucket?: string;
  /** True if a later memory has superseded this one. */
  is_superseded?: boolean;
  /** Id of the memory that superseded this one, or null. */
  superseded_by?: string | null;
  /** When the memory was stored (RFC3339). Omitted when temporal fields are stripped. */
  created_at?: string;
  /** When the content actually happened (RFC3339), if known. */
  event_date?: string;
  /** WHO said it: "me" (the assistant) or a registered person's name. Absent = untagged. */
  speaker?: string;
  [key: string]: unknown;
}

/** `add` / `store` → `{ id, status }`. `status` starts with `"stored"` (more text can
 *  follow) or is `"duplicate"`; match on the prefix. */
export interface StoreResult {
  id?: string;
  /** Starts with `"stored"`, or is `"duplicate"` when nothing was saved. */
  status?: string;
  /**
   * On a duplicate, the id of the memory this write collided with, when the reply has
   * it. A duplicate can arrive with an empty `id` and no `duplicate_of`; then search with
   * the same text to find the memory it matched.
   *
   * A genuinely new fact that only varies a detail of one already stored ("no meetings
   * before 10am" next to "no meetings on Fridays") can land here too, so a duplicate is
   * not always a harmless no-op: read this id, and either store one sentence that states
   * both or `update()` the existing memory with the combined statement.
   */
  duplicate_of?: string;
  /** Present when the store was a duplicate and something (e.g. a speaker tag) was dropped. */
  note?: string;
  /** `true` when this response was REPLAYED from a previous request with the same
   *  `idempotencyKey` — nothing new was stored. Absent on a fresh write. Read it to
   *  tell "my retry landed" from "my retry was a no-op". */
  replayed?: boolean;
  [key: string]: unknown;
}

/** `addTurn` / `addBulk` / `delete` / `deleteAll` → `{ status }`. */
export interface StatusResult {
  status?: string;
  [key: string]: unknown;
}

// ----- images (models that list `images` in their capabilities) -----

/**
 * An image attached to a memory, passed to `add`/`store` via `opts.image`.
 *
 * Both edges must be 700px or more; a smaller image is refused (400). A request
 * body is capped at 10MB.
 *
 * What the service keeps is NOT your original. An image whose long edge is over
 * 1568px is downscaled to 1568 before anything else happens, and that smaller
 * picture is what gets stored, and handed back by `getImage`. Nothing on our side
 * ever uses more than 1568, so the extra pixels would be bytes nobody reads. This
 * is a memory
 * service, not a photo host: the picture it holds has the resolution of a memory.
 *
 * It can also come back in a different FORMAT. Downscaling means re-encoding, and
 * we write lossless formats as WebP — send a PNG or a GIF over 1568px and `getImage`
 * hands back `image/webp`; JPEG stays JPEG. So do not name the file from the
 * extension you uploaded: read `contentType`. Nothing is re-encoded when the image
 * already fits within 1568px, and a re-encode that would make the file BIGGER is
 * thrown away and your bytes kept as they were.
 *
 * Keep your own copy if you need the full-resolution file.
 *
 * You are billed for the picture we keep, so downscaling never costs you more.
 */
export interface ImageInput {
  /** base64 of the image. A `data:image/...;base64,` prefix is accepted and stripped. */
  data: string;
  /**
   * Where YOUR copy of the image lives. Stored as-is; the service never fetches it.
   *
   * When you send one, the service keeps no image bytes: `getImage` answers 404 for
   * this memory, and you fetch the picture from your own reference.
   */
  reference?: string;
  /**
   * When the image was TAKEN, if you know it — usually from EXIF. RFC3339 or a plain
   * date (`YYYY-MM-DD`); anything else is refused (400) naming the field.
   *
   * Worth passing: an image knows a moment that its caption does not. This fills
   * `metadata.event_date` when that is empty, so "the day we moved" sorts by when it
   * happened rather than by when it was uploaded.
   */
  taken_at?: string;
}

/** `getImage` → the picture the service holds, plus what it actually is. */
export interface ImageBytes {
  /**
   * The image as stored. Write it to a file, or wrap it in a Blob to show it.
   *
   * This is the service's copy, not necessarily your upload: anything over 1568px
   * on its long edge was downscaled on the way in, and re-encoded to WebP unless it
   * was a JPEG (see `ImageInput`). Take the file extension from `contentType`.
   */
  bytes: Uint8Array;
  /** Sniffed from the BYTES, not from whatever the upload was named — e.g. `image/jpeg`. */
  contentType: string;
}

/** `forgetImage` → what happened, or (with `preview`) what would happen. */
export interface ImageDeleteResult {
  /** `"image_deleted"`, or `"preview"` when nothing was touched. */
  status?: string;
  memory_id?: string;
  /**
   * Whether the MEMORY survives losing its image. `false` means the delete removed
   * the whole memory; call with `preview: true` first to find out before it happens.
   */
  memory_kept?: boolean;
  /** Plain-language note about the above, when there is something to say. */
  note?: string | null;
  /** Only on a preview. */
  would_delete_image?: boolean;
  [key: string]: unknown;
}

/** `listImages` → one page of image memories, newest first. */
export interface ImagePage {
  images: Memory[];
  /** TOTAL images in the store, not the size of this page. */
  count?: number;
  has_more?: boolean;
  /** Hand these two back as `before` / `skipIds` to get the next page. */
  next_before?: string | null;
  next_skip_ids?: string[];
  [key: string]: unknown;
}

/** `revisions` → how much of this store has been edited since it was written. */
export interface RevisionsResult {
  /** Memories a transform has touched (supersede, update, retract, image removed). */
  revised?: number;
  /** Memories nothing has touched since they were written. Always `total - revised`. */
  unrevised?: number;
  /** The memories you stored. */
  total?: number;
  /** What `revised` counts, spelled out by the service. */
  counts?: string;
  /** What it does NOT count — deletions leave nothing to count. */
  excludes?: string;
  /** Which side was paged, echoed back. Only present when you asked for a page. */
  include?: "revised" | "unrevised";
  /** TOTAL memories behind this page, not the size of the page. Only with `include`. */
  matched?: number;
  /** One page, at most 20. **Absent unless you asked for it** — see `revisions()`. */
  memories?: Memory[];
  has_more?: boolean;
  /** Hand these two back as `before` / `skipIds` to get the next page. */
  next_before?: string | null;
  next_skip_ids?: string[];
  /** Which order the page is in — by when each memory was STORED, not when it was edited. */
  ordered_by?: string;
  [key: string]: unknown;
}

/** One link in a memory's supersede chain. */
export interface LineageStep {
  memory_id?: string;
  content?: string;
  speaker?: string | null;
  created_at?: string | null;
  /** When this link was superseded (RFC3339), or null while it is still current. */
  changed_at?: string | null;
  /** What happened here — e.g. how the replacement related to this version. */
  action?: string | null;
  confidence?: number | null;
  superseded_by?: string | null;
  /** True for the one version that is still in force. */
  is_current?: boolean;
  [key: string]: unknown;
}

/** `lineage` → the full chain of edits behind one memory, oldest first. */
export interface LineageResult {
  memory_id?: string;
  chain: LineageStep[];
  count?: number;
  /** True when the chain was longer than the service would walk. */
  truncated?: boolean;
  [key: string]: unknown;
}

/** `bySpeaker` → one page of what a given person said. */
export interface SpeakerPage {
  speaker?: string;
  memories: Memory[];
  chunks?: number;
  /** The count to show before anyone confirms a delete of this speaker's memories. */
  records_to_delete?: number;
  /** @deprecated The same number as `records_to_delete`, under its old name. */
  points_to_delete?: number;
  returned?: number;
  has_more?: boolean;
  next_before?: string | null;
  next_skip_ids?: string[];
  [key: string]: unknown;
}

/** `update` (supersede) → old and new memory ids. */
export interface UpdateResult {
  old_memory_id?: string;
  new_memory_id?: string;
  status?: string;
  [key: string]: unknown;
}

/** `searchFull` → everything one search answered with. `search` returns every memory
 *  as one array; this keeps the fields apart and adds `verify_used`, the report on
 *  the `verify` option. */
export interface SearchResult {
  /** What others said, and general memories. */
  memories: Memory[];
  /** The assistant's own words (speaker "me"); `[]` on a model that does not keep
   *  them apart. */
  self_memories: Memory[];
  /** Image memories the answer carried (one by default on an image-capable model,
   *  up to `max_images`); `[]` when there were none. */
  images: Memory[];
  /** Re-ask passes actually performed. Present only when `verify` was sent; lower
   *  than you asked for means the store had nothing further to add. */
  verify_used?: number;
  [key: string]: unknown;
}

export interface RecallResult {
  short_term: { turns: unknown[]; count: number };
  long_term: { memories: Memory[]; count: number };
  context: { around_top_memory: unknown[]; count: number };
  [key: string]: unknown;
}

/** `engram` → the merged multi-hop result. */
export interface EngramResult {
  engram?: string;
  form?: string;
  user_id?: string;
  hops?: number;
  count?: number;
  memories?: Memory[];
  usage?: Usage;
  [key: string]: unknown;
}

/** One turn of the short-term window, as `history()` returns it. */
export interface HistoryTurn {
  /** `"user"` or `"assistant"`. */
  role?: string;
  content?: string;
  timestamp?: string;
  /** @deprecated Not sent: a turn comes back as `role` and `content`. */
  user_msg?: string;
  /** @deprecated Not sent: a turn comes back as `role` and `content`. */
  assistant_msg?: string;
  [key: string]: unknown;
}

/** `usage` → what this key has spent, and what is left to spend. */
export interface UsageResult {
  window_days?: number;
  /** This API key's LIFETIME spend. Never another key's. */
  key?: { requests?: number; cost_cents?: number; input_tokens?: number; output_tokens?: number; since?: string };
  /** The workspace this key belongs to, over the window. */
  workspace?: { workspace_id?: string | null; requests?: number; cost_cents?: number };
  /** Per-store spend over the window, highest spend first, and at most 50 rows — a longer
   *  list is cut, so these need not sum to `workspace`. `other`, when present, is an
   *  overflow bucket rather than a store. */
  stores?: { store?: string; requests?: number; cost_cents?: number }[];
  /** Prepaid balance left on the ACCOUNT. Negative means overdrawn. */
  balance_cents?: number;
  expiring_soon_cents?: number;
  [key: string]: unknown;
}

export interface StatsResult {
  total_memories?: number;
  short_term_turns?: number;
  [key: string]: unknown;
}

/** `listMemories` → one page of a store's raw memories (the text you stored, and its metadata). */
export interface MemoryPage {
  memories: Memory[];
  count: number;
  /** Pass back as `cursor` for the next page; `null` means there is none. It can be
   *  non-null on the last page, and the next call then returns an empty page. Pass
   *  back only a cursor the service returned. */
  next_cursor: string | null;
  [key: string]: unknown;
}

/** `searchSelf` result: general memories and the assistant's own, kept apart. */
export interface SelfSearchResult {
  /** What others said, and general memories. */
  memories: Memory[];
  /** The assistant's own words (stored with speaker "me"); `[]` on non-self models. */
  self_memories: Memory[];
}

/** What a model can do, as `listModels()` reports it. A model without a feature
 *  refuses the call that needs it (usually 403) or answers without that part. */
export interface ModelCapabilities {
  /** Image memories: `opts.image` on `add`, `max_images`, `getImage`, `listImages`. */
  images?: boolean;
  /** `engram()`; `listEngrams()` names the ones this model runs. */
  engrams?: boolean;
  /** Delivery forms (`form` / `tz`) on search, recall and engram. */
  forms?: boolean;
  /** Re-ask passes (`verify`) on search. */
  re_ask?: boolean;
  /** The assistant's own words apart, in `self_memories`. */
  self_memories?: boolean;
  /** Speaker names, as the service reports them. */
  speaker_names?: boolean;
  [key: string]: boolean | undefined;
}

export interface ModelInfo {
  id: string;
  name: string;
  available: boolean;
  /** "shared" — reads the common memory pool; "isolated" — its own dedicated store. */
  memory: "shared" | "isolated";
  /** What this model can do. Check it before relying on a feature. */
  capabilities?: ModelCapabilities;
  /** Present on a live model that is scheduled to retire (RFC3339). From that instant
   *  the model leaves this list and calls naming it are refused. */
  retires_at?: string;
  [key: string]: unknown;
}

/** One entry of the engram / delivery-form catalogue (`listEngrams`). */
export interface EngramInfo {
  name: string;
  description: string;
  [key: string]: unknown;
}

/** `listEngrams` → what the SELECTED model can run. `forms` is empty on models
 *  without delivery forms; `note` explains an empty `engrams`. */
export interface EngramCatalog {
  engrams: EngramInfo[];
  forms: EngramInfo[];
  note?: string;
  /** Anything else the reply carried. Responses widen; the runtime keeps those fields
   *  and this is what lets a typed caller read them. */
  [key: string]: unknown;
}

/** `createStore` / `deleteStore` → `{ user_id, status }`. */
export interface StoreOpResult {
  /** The store id. `createStore` answers with the id as you sent it. */
  user_id?: string;
  /** The normalized form the store is filed under, when it differs from `user_id`. */
  canonical_id?: string;
  status?: string;
  /** Present when the API filed your id under a normalized form, explaining how. */
  note?: string;
  [key: string]: unknown;
}

export interface StoreInfo {
  /** The id the store was created with — pass it back as `userId`. */
  user_id: string;
  created_at: string;
  /** The normalized form the store is filed under, when it differs from `user_id`. */
  canonical_id?: string;
  [key: string]: unknown;
}

/** `addSpeaker` / `removeSpeaker` → `{ user_id, speaker, status }`. */
export interface SpeakerOpResult {
  user_id?: string;
  speaker?: string;
  status?: string;
  [key: string]: unknown;
}

export interface SpeakerInfo {
  speaker: string;
  memories: number;
  created_at?: string;
  [key: string]: unknown;
}

/** `listSpeakers` → registered people with per-person memory counts. */
export interface SpeakersList {
  speakers: SpeakerInfo[];
  count?: number;
  /** The registration cap for this store (50 to start). */
  limit?: number;
  [key: string]: unknown;
}

/**
 * Narrow a search to part of a store. The filter chooses what is searched, not what
 * is kept afterwards — so a narrow filter still returns your full `limit` when that
 * many matches sit inside it.
 *
 * Retrieval behaves the same in every language, so these behave
 * identically in every language. Unlisted keys are dropped by the API rather than
 * rejected, so a typo silently widens the search — spell them exactly.
 *
 * Filters apply to `memories`. The assistant's own words (`self_memories`) are not
 * filtered, and `search` merges them into its answer, so read `searchFull` when a
 * filtered answer must hold only what matched.
 *
 * Every date takes RFC3339 or a plain date (`YYYY-MM-DD`). A plain end date
 * (`time_to`, `event_to`) covers that whole day in UTC. A value that is not a date
 * is refused (400) naming the field.
 */
export interface SearchFilters {
  /** Only these categories (the `category` you see on `listMemories` results). */
  categories?: string[];
  /** When the memory was stored. */
  time_from?: string;
  time_to?: string;
  /** WHEN THE CONTENT HAPPENED (`metadata.event_date`), not when it was written —
   *  this is the one you usually want. */
  event_from?: string;
  event_to?: string;
  /** Drop matches the engine scored below this importance (0–1). */
  min_importance?: number;
}

/** The filter keys the API acts on. Anything else it DROPS silently, so a typo
 *  widens the search instead of failing — we warn rather than reject, because the
 *  API may grow a key before this package is updated. */
const KNOWN_FILTER_KEYS = new Set([
  "categories",
  "event_from",
  "event_to",
  "time_from",
  "time_to",
  "min_importance",
]);
const warnedFilterKeys = new Set<string>();
const KNOWN_SEARCH_KEYS = new Set([
  "cache_control", "speaker", "filters", "verify", "max_images", "form", "tz", "extra",
]);
/** Named arguments of the call. Reaching the body through options would let forwarded
 *  input choose someone else's store. */
const RESERVED_SEARCH_KEYS = new Set(["user_id", "query", "max_results"]);
const KNOWN_RECALL_KEYS = new Set(["form", "tz", "limit", "context_limit"]);
const KNOWN_ENGRAM_KEYS = new Set(["form", "tz"]);

/** Refuse a search option this client does not know.
 *
 * The service drops keys it does not recognise and answers normally, so a misspelled
 * option is indistinguishable from one that worked: `verify` asks for extra retrieval
 * passes, and `verfy` asks for nothing while the reply still looks complete. Filters
 * only warn because a wrong filter still returns memories; a wrong option silently
 * turns a paid feature off. `extra` carries anything this version has not learned yet.
 */
function checkSearchOpts(opts: object): void {
  checkOpts(opts, KNOWN_SEARCH_KEYS, "search");
  // The value that is sent: the typed field, else one in `extra`.
  const o = opts as SearchOptions;
  optRange(o.max_images !== undefined ? o.max_images : o.extra?.max_images, "max_images", 0, MAX_IMAGES_MAX);
}

/** The same check for any option bag: `contextLimit: 0`, the camelCase typo of
 *  `context_limit`, would otherwise vanish and the service would attach its default of
 *  10. TypeScript catches the object-literal form; JS callers and anything forwarded
 *  as `any` do not. */
function checkOpts(opts: object, known: Set<string>, what: string): void {
  for (const k of Object.keys(opts)) {
    if (RESERVED_SEARCH_KEYS.has(k))
      throw new Error(
        `${JSON.stringify(k)} is set by the call, not by options — pass it as an argument. ` +
          `An app forwarding untrusted input as options cannot steer the store, the query ` +
          `or the count, and this says so rather than dropping it silently.`
      );
    if (known.has(k)) continue;
    const near = [...known].find((n) => n !== "extra" && editWithin(k, n, 2));
    throw new Error(
      `unknown ${what} option ${JSON.stringify(k)}` +
        (near ? ` — did you mean ${JSON.stringify(near)}?` : "") +
        `. It would have had no effect, and the call would have looked like it worked.` +
        (known.has("extra")
          ? ` Pass it under \`extra\` if the service accepts it and this client does not know it yet.`
          : "")
    );
  }
}

/** Within `max` single-character edits of each other. Small strings, called once per
 *  bad key, so the full matrix is cheaper than being clever. */
function editWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length] <= max;
}

/** Warn once per key of `obj` that is not in `known`. The record of keys already
 *  warned about is capped, so an app that forwards user-supplied keys cannot grow it
 *  without bound. */
function warnOnceUnknownKeys(
  obj: unknown,
  known: Set<string>,
  warned: Set<string>,
  message: (key: string) => string,
): void {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const k of Object.keys(obj)) {
    if (known.has(k) || warned.has(k)) continue;
    warned.add(k);
    while (warned.size > WARNED_FILTER_KEYS_MAX) {
      const oldest = warned.values().next().value;
      if (oldest === undefined) break;
      warned.delete(oldest);
    }
    console.warn(message(k));
  }
}

function warnOnUnknownFilters(filters: unknown): void {
  warnOnceUnknownKeys(filters, KNOWN_FILTER_KEYS, warnedFilterKeys, (k) =>
    `wontopos: unknown search filter ${JSON.stringify(k)} — the API drops keys it does not know, ` +
      `so this filter has NO effect and the search is wider than you think. ` +
      `Known keys: ${[...KNOWN_FILTER_KEYS].join(", ")}.`,
  );
}

/** The metadata keys the service keeps on a memory. It drops every other key. */
const KNOWN_METADATA_KEYS = new Set(["speaker", "event_date", "category", "conversation_id"]);
const warnedMetadataKeys = new Set<string>();

function warnOnUnknownMetadata(metadata: unknown): void {
  warnOnceUnknownKeys(metadata, KNOWN_METADATA_KEYS, warnedMetadataKeys, (k) =>
    `wontopos: metadata key ${JSON.stringify(k)} is not kept: the service keeps only ` +
      `${[...KNOWN_METADATA_KEYS].join(", ")} and drops the rest, so this value is not stored.`,
  );
}

/** @deprecated Test hook. The warn-once set is process-global by design. */
export function _resetFilterWarnings(): void {
  warnedFilterKeys.clear();
}

/** Known `search` options. An unknown key is refused before anything is sent — the
 *  service drops keys it does not recognise and answers normally, so a misspelling
 *  could not be told from an option that worked. Put a genuinely new one under
 *  `extra`. */
export interface SearchOptions {
  /** Recall caching. A hit inside the TTL bills at 0.1× — but the FIRST call
   *  writes the cache and bills the query tokens at 2× (`5m`) or 3× (`1h`), so
   *  this only pays for a query you repeat or extend. Do not enable it globally. */
  cache_control?: { ttl: "5m" | "1h" };
  /** Recall only this person's words ("me" or a registered name). */
  speaker?: string;
  /** Restrict the search to part of the store — see {@link SearchFilters}. */
  filters?: SearchFilters;
  /**
   * Re-ask passes, 0–3. After the first retrieval the service asks the engine again up
   * to this many times, each time telling it what was already returned so it skips
   * those and reaches further back. No LLM runs at any
   * value. Stops early when a pass finds nothing new; `verify_used` in the response
   * says how many actually ran.
   *
   * Each pass is another engine call and can add up to `limit` more memories, so it
   * costs more — you are billed for what is delivered. Default 0. Worth it on questions
   * that need several distinct memories from far apart in the history; it does little
   * on a single-fact lookup.
   *
   * Requires a model that lists `re_ask` in its `listModels()` capabilities; any
   * other refuses the call (403) rather than charging for passes that never happened.
   */
  verify?: number;
  /**
   * How many image memories the answer may carry, 0–5. Omit it and the service uses
   * 1; `0` asks for none. Out of range is refused before the request, not clamped —
   * silently cutting 6 to 5 would leave you believing you got six.
   *
   * Requires a model that lists `images` in its capabilities, and is refused (403)
   * on one without it rather than answering with no images.
   */
  max_images?: number;
  /** Delivery form, "memoir" or "archive": how each memory's time is rendered. Needs a
   *  model that lists `forms` in its capabilities. The service refuses an unknown
   *  form (400). */
  form?: string;
  /** Your UTC offset in hours, for rendering times in `form`. */
  tz?: number;
  /**
   * Fields the service accepts that this version does not know about, merged into the
   * request as written. Every other key is refused, so a typo cannot reach the wire.
   * The store, the query and the count always win over a copy in here.
   */
  extra?: Record<string, unknown>;
}

/**
 * Per-call options for a write.
 *
 * `idempotencyKey` makes repeating THIS EXACT write safe: the API replays the first
 * response instead of storing again, for up to 10 minutes, and answers 422 if the
 * same key arrives with a different body. Use it when a retry is your own (a job that
 * died and was re-run, a queue that redelivers). The SDK retries a write on 429, and
 * on a 409 that says another write to the store was in flight: the service answers
 * both before it processes anything, so nothing was stored. It never retries a write
 * on 408 / 502 / 503 / 504 or a dropped body, where the write may already have been
 * applied — without a key the client cannot know whether it was.
 *
 * The key covers a retry sent after the first attempt finished. A retry that overlaps
 * a first attempt still running can run twice, so wait for the first to fail before
 * re-sending.
 *
 * The key must be UNIQUE PER LOGICAL WRITE — derive it from the thing being stored
 * (`` `import:${row.id}` ``), never a constant, or the second write replays the first
 * and is silently lost. Format: 1-128 chars of `[A-Za-z0-9._:-]`, checked locally.
 *
 * The window is best-effort and can be shorter than 10 minutes; it is not a durable
 * de-duplication record.
 */
export interface WriteOptions {
  idempotencyKey?: string;
  /**
   * An image to store alongside the text. Needs a model that lists `images` in its
   * `listModels()` capabilities; any other refuses the write rather than store the
   * caption and quietly drop the image.
   *
   * A caption is required: the service refuses empty `content` (400) even with an
   * image attached.
   */
  image?: ImageInput;
}

/** The part of an `AbortSignal` the client uses, for a runtime that declares none. */
export interface AbortSignalShape {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** The runtime's own `AbortSignal` type when it declares one (the DOM lib,
 *  `@types/node`), otherwise {@link AbortSignalShape}. `AbortController#signal` fits. */
export type AbortSignalLike = typeof globalThis extends { AbortSignal: { prototype: infer S } }
  ? S
  : AbortSignalShape;

/** The `init` the client passes to `fetch`. */
export interface FetchInitLike {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignalLike;
  redirect: "manual";
}

/** The part of a `fetch` response the client reads. */
export interface FetchResponseLike {
  readonly status: number;
  readonly ok: boolean;
  readonly type?: string;
  readonly url?: string;
  readonly redirected?: boolean;
  readonly headers: { get(name: string): string | null };
  readonly body?: {
    getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(reason?: unknown): Promise<void> };
    cancel(reason?: unknown): Promise<void>;
  } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The runtime's own `fetch` type when it declares one (the DOM lib, `@types/node`),
 *  otherwise a structural signature, so these types need neither. */
export type FetchLike = typeof globalThis extends { fetch: infer F }
  ? F
  : (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

export interface ClientOptions {
  apiKey: string;
  /** API base URL (defaults to the hosted service): an http or https URL or, where
   *  the runtime has a page, a URL relative to it. Whitespace at either end is
   *  trimmed; whitespace, a control character or a backslash left in it after that is
   *  refused.
   *  A relative URL where the runtime has no page (server-side rendering) fails the
   *  first call that uses it, or goes to `fetch` as given when you pass one. */
  baseUrl?: string;
  /** Per-request timeout in ms, applied to each retry attempt (default 30000). A
   *  value that is not a positive number means the default; values above 2147483647
   *  are clamped to it. */
  timeoutMs?: number;
  /** Default model for every call (sent as `X-WOS-Model`). See `listModels()`. */
  model?: string;
  /** Default store for every call. Override per call by passing `userId`. Leave it
   * out to use the account's built-in `default` store; passing it as `undefined` is
   * refused, because that is usually a lookup that found nothing. */
  userId?: string;
  /** How many times to retry transient failures before throwing — 429 and a 409
   * that says another write was in flight, always; 408/502/503/504 and connection
   * errors only when a retry can never double-process a write. 0 disables retries
   * (default 2). */
  maxRetries?: number;
  /** Alias of `maxRetries`. `maxRetries` wins when both are given. */
  retries?: number;
  /** A total budget for one call, in ms, across every attempt.
   *
   *  `timeoutMs` bounds ONE attempt. At the defaults — 30s, two retries — a single
   *  call can hold a connection for 30s + backoff + 30s + backoff + 30s, over a
   *  minute. Unset means no overall budget. A retry whose wait does not fit in what
   *  is left is not made: the call fails with the error of the last response. A
   *  value that is not a positive number means no budget; values above 2147483647
   *  are clamped to it. */
  deadlineMs?: number;
  /** The caller's `AbortSignal` — cancel work already in flight.
   *
   *  The SDK aborts on its own timeout; this is the seam for the caller's reason.
   *  When someone closes the chat window, the recall that window asked for ends, and
   *  so does a backoff sleep waiting to retry it.
   *
   *  Per call, clone: `mem.withSignal(ctrl.signal).recall(...)`. */
  signal?: AbortSignalLike;
  /** The `fetch` used for every request (default: the global `fetch`).
   *
   *  This is the seam for anything the runtime cannot express through options.
   *  The one that matters in practice is a corporate egress proxy: Node's global
   *  fetch (undici) IGNORES `HTTP_PROXY` / `HTTPS_PROXY`, so behind such a proxy no
   *  request leaves at all. Pass a proxy-aware fetch and they go through:
   *
   *      import { ProxyAgent } from "undici";
   *      const agent = new ProxyAgent(process.env.HTTPS_PROXY!);
   *      const mem = new Client({
   *        apiKey,
   *        fetch: (url, init) => fetch(url, { ...init, dispatcher: agent } as any),
   *      });
   *
   *  It is also how you add instrumentation or drive the client in a test without
   *  a network. Retries, timeouts, redirect refusal and the size cap all still
   *  apply — this replaces the transport, not the client's rules. Pass
   *  `init.redirect` through unchanged: a fetch that follows a redirect sends the
   *  key to wherever it points, and an answer it reports as redirected
   *  (`res.redirected`) is refused. A fetch that sends the request to another URL
   *  on purpose, such as a proxy that rewrites it, is fine. */
  fetch?: FetchLike;
}

const DEFAULT_USER = "default";

/** Wontopos memory client. Store and recall memories, isolated per `userId`. */
export class Client {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly deadlineMs?: number;
  private readonly signal?: AbortSignalLike;
  /** Transport. Held as a field (not read off `globalThis` per call) so a caller
   * who passes one gets it for every request, including from cloned clients. */
  private readonly fetchImpl: (url: string, init: FetchInitLike) => Promise<Response>;
  /** Whether `baseUrl` carries userinfo, which network errors must not show. */
  private readonly userinfo: boolean;
  /** Whether `baseUrl` did not resolve to a URL at construction: a relative one where
   *  the runtime had no page. */
  private readonly pageRelative: boolean;
  /** Whether the caller supplied `fetch`. */
  private readonly customFetch: boolean;
  /** The store every call uses unless one passes `userId`. */
  private readonly defaultUser: string;
  private _rateLimit: RateLimit | null = null;

  /** Quota from the MOST RECENT call: `{ limit, remaining, reset }` (or `null` before
   * the first call). Read it to self-throttle — the client already retries 429s, but
   * this lets you slow down before hitting the wall. */
  get rateLimit(): RateLimit | null {
    return this._rateLimit;
  }

  constructor(opts: ClientOptions) {
    // Trim the key and reject inner whitespace — a stray newline from a file or
    // env var otherwise turns into a mystery 401 (or a mangled header).
    const key = (opts?.apiKey ?? "").trim();
    if (!key) throw new Error("apiKey is required");
    if (/\s/.test(key)) throw new Error("apiKey contains whitespace - check for a stray newline or paste error");
    // `\s` does not cover NUL, 0x01 or DEL, and those travel into the header and fail
    // deep inside fetch as the mystery 401 this check exists to prevent.
    if (/[\x00-\x1f\x7f]/.test(key))
      throw new Error("apiKey contains a control character - check for a stray byte or paste error");
    // Keys are ASCII by construction. A key pasted from a rich-text doc, Slack or a PDF
    // has had its hyphen turned into an en dash, which then travels into the header and
    // fails as the same mystery 401.
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7f]/.test(key)) {
      const bad = key.match(/[^\x00-\x7f]/)?.[0];
      throw new Error(
        `apiKey contains a non-ASCII character (${JSON.stringify(bad)}) - rich text turns '-' into an ` +
          "en dash; copy the key from a plain-text field",
      );
    }
    this.apiKey = key;
    const rawBase = opts.baseUrl ?? DEFAULT_BASE_URL;
    if (typeof rawBase !== "string") throw new Error("baseUrl must be a string");
    // A value read from a file or an env var often ends in a newline.
    const trimmed = rawBase.replace(BASE_URL_ENDS, "");
    // Inside the URL, the parser drops tabs and newlines and reads `\` as `/`, so the
    // host a request reaches is not the one the string shows. Userinfo may hold a
    // password, so no message shows it.
    // eslint-disable-next-line no-control-regex
    if (/[\s\\\u0000-\u001f\u007f]/.test(trimmed)) {
      throw new Error(
        `baseUrl contains whitespace, a backslash or a control character: ${JSON.stringify(maskBase(trimmed))}`,
      );
    }
    this.base = trimmed.replace(/\/+$/, "");
    // A base fetch cannot send to fails every call before it leaves, as a status-0
    // network error that retries and then reads like an outage. A relative base in a
    // runtime with no page (server-side rendering of browser code) is checked when a
    // call uses it instead, and a caller-supplied fetch receives it as given.
    const url = parseBase(this.base);
    const parsed = url ?? (pageHref() === undefined ? asPageRelative(this.base) : undefined);
    if (!parsed) throw new Error(notAUrl(trimmed));
    this.pageRelative = !url;
    this.userinfo = Boolean(parsed.username || parsed.password);
    this.timeoutMs = checkMs(opts.timeoutMs) ?? 30_000;
    this.model = opts.model ?? DEFAULT_MODEL;
    if (this.model && !MODEL_RE.test(this.model)) {
      throw new Error(`invalid model name: ${JSON.stringify(this.model)} (letters, digits, '.', '_', '-' only)`);
    }
    // The same guard uid() applies per call, so the default store cannot become the
    // shared one by accident either. Leaving `userId` out means the default store;
    // passing it as `undefined` is a lookup that found nothing.
    if (opts && "userId" in opts && opts.userId === undefined) {
      throw new Error(
        "new Client() needs a store id in userId, or no userId option at all. It was given " +
          "undefined. That is usually a lookup that found nothing. Leave userId out to use the default store.",
      );
    }
    assertUsableStoreId(opts.userId);
    this.defaultUser = opts.userId ?? DEFAULT_USER;
    // A non-finite maxRetries (NaN/Infinity) falls back to the default: NaN would run
    // zero attempts and Infinity would retry forever.
    const mr = opts.maxRetries ?? opts.retries;
    this.maxRetries = typeof mr === "number" && Number.isFinite(mr) ? Math.max(0, Math.floor(mr)) : 2;
    this.deadlineMs = checkMs(opts.deadlineMs);
    this.signal = opts.signal;
    // Bind the global so `fetch` is not called as a method of `globalThis`, which
    // throws "Illegal invocation" on some runtimes. A caller-supplied fetch is
    // taken as given — it is already whatever they meant to hand us.
    const f = opts.fetch as unknown;
    if (f !== undefined && typeof f !== "function") {
      throw new Error("fetch must be a function (a fetch-compatible transport)");
    }
    this.customFetch = f !== undefined && !DEFAULT_TRANSPORTS.has(f as object);
    this.fetchImpl = (f ?? defaultTransport()) as any;
    if (typeof this.fetchImpl !== "function") {
      throw new Error(
        "no fetch available in this runtime — pass one as `fetch` (Node 18+ has it built in; older Node needs undici)"
      );
    }
    this.headers = {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
      // Browsers silently drop User-Agent (forbidden header) — harmless.
      "User-Agent": USER_AGENT,
    };
    if (this.model) this.headers["X-WOS-Model"] = this.model;
    // An API key on plain HTTP travels readable by anyone on the path. Loopback
    // is fine (local dev, or a proxy on the same box); anything else gets a
    // warning, not an error, so private-network gateways keep working. The scheme
    // and host come from the same parser fetch uses, so `http:/host` or
    // `http://127.0.0.1:9@evil.example` are read the way the request travels.
    // `URL.hostname` keeps the brackets on an IPv6 literal (`[::1]`).
    const host = url?.hostname.toLowerCase().replace(/^\[|\]$/g, "") ?? "";
    if (url?.protocol === "http:" && !LOOPBACK_HOSTS.has(host)) {
      console.warn(
        "wontopos: baseUrl uses plain HTTP on a non-local host, so the API key travels unencrypted. Use https://."
      );
    }

    // TypeScript `private` is erased at runtime, so `{...client}` would copy the key.
    // `toJSON` and inspect cover the direct forms; spreading into a log record is the
    // common shape in structured logging, so the key and the prepared auth header are
    // non-enumerable. They stay readable inside the class.
    Object.defineProperty(this, "apiKey", { enumerable: false });
    Object.defineProperty(this, "headers", { enumerable: false });
  }

  /** A client whose key comes from `WONTOPOS_API_KEY` (or `WOS_API_KEY`) — keeps
   * keys out of source code. Node/Bun/Deno-with-env only. */
  static fromEnv(opts: Omit<ClientOptions, "apiKey"> = {}): Client {
    const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined;
    // First env var with a NON-EMPTY value wins — an empty WONTOPOS_API_KEY must
    // not shadow a valid WOS_API_KEY (`??` only skips null/undefined, not "").
    const key = [env?.WONTOPOS_API_KEY, env?.WOS_API_KEY].find((v) => v && v.trim());
    if (!key) throw new Error("set WONTOPOS_API_KEY (or WOS_API_KEY) in the environment");
    // apiKey LAST so a stray apiKey in opts can't override the env key.
    return new Client({ ...opts, apiKey: key });
  }

  /** Never expose the key or a URL password: `JSON.stringify(client)` gets the redacted view. */
  toJSON(): Record<string, string> {
    return { baseUrl: maskBase(this.base), model: this.model, userId: this.defaultUser, apiKey: maskKey(this.apiKey) };
  }

  /** Never expose the key or a URL password: Node's `console.log(client)` gets the redacted view. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Client(${maskBase(this.base)}, model=${this.model}, userId=${this.defaultUser}, apiKey=${maskKey(this.apiKey)})`;
  }

  /** Resolve a call's store: the explicit userId, else the client default. */
  private uid(userId?: string): string {
    // An OMITTED id means "use the client's default" — that is the documented shortcut.
    // An id that was PASSED but is blank, `null` or not a string is a tenant lookup
    // that found nothing, and falling back would write one customer's memories into
    // whatever store this client defaults to. `undefined` alone means "omitted",
    // because that is what an absent argument is.
    assertUsableStoreId(userId);
    const id = userId ?? this.defaultUser;
    warnIfStoreIdCollapses(id);
    return id;
  }

  private clone(overrides: Partial<ClientOptions>): Client {
    return new Client({
      apiKey: this.apiKey,
      baseUrl: this.base,
      timeoutMs: this.timeoutMs,
      model: this.model,
      userId: this.defaultUser,
      maxRetries: this.maxRetries,
      // Carry the transport, the budget and the caller's signal across clones, so a
      // proxy-bound or cancellable client stays that way after `withModel(...)`.
      fetch: this.fetchImpl as unknown as FetchLike,
      deadlineMs: this.deadlineMs,
      signal: this.signal,
      ...overrides,
    });
  }

  /**
   * A client that uses `model` (sent as `X-WOS-Model`). Use it to set the default
   * (`new Client({ apiKey, model })`) or to override one call
   * (`client.withModel("tablet-1").recall(...)`).
   */
  withModel(model: string): Client {
    return this.clone({ model });
  }

  /** A client bound to `userId` as its default store (everything else kept). */
  withUser(userId: string): Client {
    // CALLING withUser means "bind this store", and the value a failed lookup hands you
    // is as often `undefined` as `null`.
    if (userId === undefined) {
      throw new Error(
        "withUser() needs a store id. It was called with undefined — usually a lookup that " +
          "found nothing. Use the client's own default instead of calling withUser at all.",
      );
    }
    return this.clone({ userId });
  }

  /** A client bound to a caller's `AbortSignal` (everything else kept).
   *
   *     const ctrl = new AbortController();
   *     req.on("close", () => ctrl.abort());
   *     const r = await mem.withSignal(ctrl.signal).recall(q, user);
   *
   * Aborting ends the request in flight AND any backoff sleep waiting to retry it. */
  withSignal(signal: AbortSignalLike): Client {
    return this.clone({ signal });
  }

  /** A client with a total budget per call, across every retry (everything else
   * kept). `mem.withDeadline(5_000).search(q)` inside a handler that has five
   * seconds. */
  withDeadline(deadlineMs: number): Client {
    return this.clone({ deadlineMs });
  }

  /** A client with a different per-request timeout in ms (everything else kept).
   * `mem.withTimeout(120_000).addBulk(bigBlob)` — this slow call only. */
  withTimeout(timeoutMs: number): Client {
    return this.clone({ timeoutMs });
  }

  /** A client with a different retry budget (everything else kept). 0 disables retries. */
  withRetries(maxRetries: number): Client {
    return this.clone({ maxRetries });
  }

  // ----- write -----
  // `userId` is optional in every call below - omit it to use the client's default
  // store (set via `new Client({ apiKey, userId })` or `withUser`).
  /** Store one memory. `metadata` optional — the service keeps only these keys and
   * drops any other (this client warns once per unknown key):
   * - `event_date`: when the content actually happened, RFC3339 or a plain date
   *   (`YYYY-MM-DD`, read as UTC midnight); anything else is refused (400) naming the field.
   * - `speaker`: "me" = the assistant's own words, or a person's name (up to 50 per store).
   * - `category`, `conversation_id`.
   *
   * `opts.idempotencyKey`: see {@link WriteOptions} — pass one to make YOUR retry
   * of this exact write safe to repeat. */
  async add(content: string, userId?: string, metadata: Record<string, unknown> = {}, opts: WriteOptions = {}): Promise<StoreResult> {
    checkMetadataKeys(metadata);
    const body: Record<string, unknown> = { user_id: this.uid(userId), content, metadata };
    if (opts.image !== undefined) body.image = normalizeImage(opts.image);
    warnOnUnknownMetadata(metadata);
    return this.post("/api/v1/memory/store", body, opts.idempotencyKey);
  }
  /** Alias of `add` — store one memory. */
  async store(content: string, userId?: string, metadata: Record<string, unknown> = {}, opts: WriteOptions = {}): Promise<StoreResult> {
    return this.add(content, userId, metadata, opts);
  }
  /** Store a conversation turn (user + assistant). Payload first, userId last — same shape as add/search. */
  async addTurn(userMsg: string, assistantMsg: string, userId?: string, opts: WriteOptions = {}): Promise<StatusResult> {
    return this.post(
      "/api/v1/memory/store-turn",
      { user_id: this.uid(userId), user_msg: userMsg, assistant_msg: assistantMsg },
      opts.idempotencyKey,
    );
  }
  /** Bulk-ingest a large blob of text in one call. For backfilling.
   *  `timestamp` must be RFC3339 (`2026-05-02T09:00:00Z`): a plain date or any other
   *  string is ignored, and the memory is filed at upload time.
   *  The call most worth an `opts.idempotencyKey`: a backfill that dies halfway and is
   *  re-run would otherwise ingest the whole blob a second time. */
  async addBulk(content: string, userId?: string, category = "general", timestamp?: string, opts: WriteOptions = {}): Promise<StatusResult> {
    const body: Record<string, unknown> = { user_id: this.uid(userId), content, category };
    if (timestamp) body.timestamp = timestamp;
    return this.post("/api/v1/memory/bulk-store", body, opts.idempotencyKey);
  }
  /** Supersede an old memory with new content. Payload first, userId last — same shape as add/search. */
  async update(oldMemoryId: string, newContent: string, userId?: string, opts: WriteOptions = {}): Promise<UpdateResult> {
    return this.post(
      "/api/v1/memory/supersede",
      { user_id: this.uid(userId), old_memory_id: oldMemoryId, new_content: newContent },
      opts.idempotencyKey,
    );
  }

  // ----- read -----
  /** Search a store's memories. Returns them most relevant first.
   *
   *  `limit` is 5-20, and out of range is refused rather than clamped: asking for 50
   *  and silently receiving 20 reads as "that is all there is". The default is 10.
   *
   *  `limit` bounds `memories`, not the returned array. The assistant's own words (on
   *  a model that lists `self_memories` in its capabilities) and image memories (one
   *  unless `max_images` says otherwise, on a model that lists `images`) come back in
   *  it as well, so it can hold more than `limit`. They are billed either way. Size a
   *  prompt window on the array you get back, not on `limit`. `searchFull()` hands the
   *  fields back apart.
   *
   *  `filters` apply to `memories` only; the assistant's own words merged in here are
   *  not filtered. */
  async search(query: string, userId?: string, limit = 10, opts: SearchOptions = {}): Promise<Memory[]> {
    // Reserved fields win over ...opts: an app that forwards untrusted input as
    // opts must not be able to override the store (user_id), query, or limit.
    checkSearchOpts(opts);
    warnOnUnknownFilters(opts.filters);
    limit ??= 10; // `null`, like `undefined`, means the default
    checkCount(limit, "limit");
    const { extra, ...known } = opts;
    const r = await this.post("/api/v1/memory/search", { ...extra, ...known, user_id: this.uid(userId), query, max_results: limit });
    return mergeResults(r);
  }
  /** Search, with the assistant's own words kept apart: both fields from ONE call.
   * Returns `{ memories, self_memories }` — `memories` is what others said and general
   * memories, `self_memories` is the assistant's OWN words (stored with speaker
   * "me"), kept apart so whoever reads them never confuses who said what. On a model
   * that does not list `self_memories` in its capabilities, `self_memories` is `[]`.
   * Image memories are not included; `search` and `searchFull` carry them. `filters`
   * apply to `memories` only. `userId` may be omitted. */
  async searchSelf(query: string, userId?: string, limit = 10, opts: SearchOptions = {}): Promise<SelfSearchResult> {
    checkSearchOpts(opts);
    warnOnUnknownFilters(opts.filters);
    limit ??= 10;
    checkCount(limit, "limit");
    const { extra, ...known } = opts;
    const r = await this.post("/api/v1/memory/search", { ...extra, ...known, user_id: this.uid(userId), query, max_results: limit });
    return { memories: asRecords<Memory>(r.memories), self_memories: asRecords<Memory>(r.self_memories) };
  }
  /**
   * Search, and keep every field the answer came with.
   *
   * Same request as {@link Client.search} — reach for this one when the options make
   * the merged array an incomplete answer:
   *
   *     const r = await mem.searchFull("the day we moved", "alice", 10,
   *                                    { max_images: 3, verify: 2 });
   *     r.images.length;   // the photos, apart from the text memories
   *     r.verify_used;     // how many re-ask passes actually ran (you are billed per pass)
   *
   * Each option needs a model that lists it in its `listModels()` capabilities
   * (`images`, `re_ask`) and is refused (403) on any other rather than accepted and
   * ignored. `filters` apply to `memories`; `self_memories` are not filtered.
   */
  async searchFull(query: string, userId?: string, limit = 10, opts: SearchOptions = {}): Promise<SearchResult> {
    checkSearchOpts(opts);
    warnOnUnknownFilters(opts.filters);
    limit ??= 10;
    checkCount(limit, "limit");
    const { extra, ...known } = opts;
    const r = await this.post("/api/v1/memory/search", { ...extra, ...known, user_id: this.uid(userId), query, max_results: limit });
    // Spread first so a field added later still arrives; the known ones are then
    // normalized, because a broken proxy can null any of them.
    return {
      ...r,
      memories: asRecords<Memory>(r.memories),
      self_memories: asRecords<Memory>(r.self_memories),
      images: asRecords<Memory>(r.images),
    };
  }
  /** One-call LLM context: short-term turns + long-term matches + surrounding context.
   * `form` ("memoir"/"archive", on a model that lists `forms` in its capabilities)
   * renders each long-term memory's time in that form; `tz` is your UTC-offset hours
   * for that rendering. */
  // `async` so an argument mistake arrives the way every other failure does — a
  // rejected promise, which `.catch()` sees.
  async recall(
    query: string,
    userId?: string,
    opts: {
      form?: string;
      tz?: number;
      /**
       * Long-term memories to recall, 5–20. Default 10. Out of range is refused, not
       * clamped — asking for 20 and silently getting 10 reads as "that is all there is".
       *
       * A model that does not take a recall count refuses the call (403) rather than
       * answering with a number you did not ask for.
       */
      limit?: number;
      /** How much surrounding context is attached around the best match, 0–20. Default 10;
       *  0 attaches none. Refused (403) by the same models as `limit`. */
      context_limit?: number;
    } = {},
  ): Promise<RecallResult> {
    checkOpts(opts, KNOWN_RECALL_KEYS, "recall");
    const body: Record<string, unknown> = { user_id: this.uid(userId), query };
    if (opts.limit != null) {
      checkCount(opts.limit, "limit");
      body.limit = opts.limit;
    }
    if (opts.context_limit != null) {
      checkContextLimit(opts.context_limit);
      body.context_limit = opts.context_limit;
    }
    return this.post("/api/v1/memory/recall", withForm(body, opts.form, opts.tz));
  }
  /** Run a built-in engram ("deep_recall" | "timeline" | "gather" | "equilibrium" |
   * "tone_stabilizer"; the service is the authority — an unknown name comes back with
   * the list it accepts). Returns the merged result.
   * `form`/`tz` render memory times (memoir/archive) on a model that lists `forms` in
   * its capabilities, same as search/recall. */
  async engram(name: string, query: string, userId?: string, opts: { form?: string; tz?: number } = {}): Promise<EngramResult> {
    // `engram` takes the same two options as `recall`, so it gets the same guard.
    checkOpts(opts, KNOWN_ENGRAM_KEYS, "engram");
    return this.post("/api/v1/engram/run", withForm({ name, user_id: this.uid(userId), query }, opts.form, opts.tz));
  }
  /** Recent conversation turns (short-term memory). */
  async history(userId?: string): Promise<HistoryTurn[]> {
    const r = await this.post("/api/v1/memory/history", { user_id: this.uid(userId) });
    return asRecords<HistoryTurn>(r.turns);
  }
  /** Memory counts for a store: { total_memories, short_term_turns }. */
  async stats(userId?: string): Promise<StatsResult> {
    return this.post("/api/v1/memory/stats", { user_id: this.uid(userId) });
  }

  /**
   * What this key has spent, and what is left — the numbers behind "can I keep going?".
   *
   * Free: it carries no charge and skips the balance gate, because an account at zero
   * still has to be able to find out why. Rate-limited instead.
   *
   * Scoped to THIS key: its own lifetime spend, its workspace and stores over the
   * window. It never returns another key's spend. `balance_cents` is account-wide,
   * because that is what gates the next call whichever key makes it.
   *
   *     const u = await mem.usage(7);
   *     if (u.balance_cents! < 100) stop();
   */
  // `async` for the same reason `recall` is: an argument mistake has to arrive as a
  // rejected promise, not a synchronous throw that `.catch()` walks straight past.
  async usage(days = 7): Promise<UsageResult> {
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error(`days must be an integer between 1 and 365, got ${days}.`);
    }
    return this.request("GET", `/api/v1/won/usage?days=${days}`);
  }
  /** Fetch ONE memory by id — the text you stored, and its metadata.
   * The id is what `add`/`store` or `listMemories` returned. Same visibility as
   * `listMemories`: an id from another store, an id `listMemories` does not return,
   * or an invalidated memory rejects with `NotFoundError`. Pass `undefined` as
   * `userId` for the default store — it is positional here. */
  async get(userId: string | undefined, memoryId: string): Promise<Memory> {
    // Refusals arrive as rejections, like every other method here.
    if (typeof memoryId !== "string" || !memoryId.trim()) {
      throw new Error("memoryId is required — the id that add/store or listMemories returned.");
    }
    return this.post("/api/v1/memory/get", { user_id: this.uid(userId), memory_id: memoryId.trim() }).then(memoryFromGet);
  }
  /** List a store's stored memories — the text you stored, plus its metadata.
   * Paginated: pass the returned `next_cursor` back as `cursor` for the next
   * page, and only a cursor the service returned, with the model that returned it. A
   * `null` cursor means there is no next page; a non-null one can still be followed by
   * an empty page. Use it to browse or export a store.
   *
   * `limit` is 1-500 (default 100); anything else is refused before the request.
   *
   *     let cursor: string | null = null;
   *     const all: Memory[] = [];
   *     do {
   *       const page = await mem.listMemories(undefined, { cursor: cursor ?? undefined });
   *       all.push(...page.memories);
   *       cursor = page.next_cursor;
   *     } while (cursor);
   */
  async listMemories(userId?: string, opts: { limit?: number; cursor?: string } = {}): Promise<MemoryPage> {
    const limit = optRange(opts.limit, "limit", 1, LIST_LIMIT_MAX);
    const body: Record<string, unknown> = { user_id: this.uid(userId), limit: limit ?? 100 };
    if (opts.cursor) body.cursor = opts.cursor;
    return this.post("/api/v1/memory/list", body);
  }
  /** Async-iterate every stored memory in a store, paging under the hood — no cursor
   * bookkeeping. The text you stored and its metadata only. `pageSize` is 1-500.
   *
   * A walk that cannot reach the end of the store (the service hands back a cursor it
   * already gave after a non-empty page, or the page ceiling is reached) throws rather
   * than end with part of the store.
   *
   *     for await (const m of mem.iterMemories()) console.log(m.id, m.content);
   */
  async *iterMemories(userId?: string, opts: { pageSize?: number } = {}): AsyncGenerator<Memory> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    // The repeat check catches a cursor cycle; the page ceiling catches a server that
    // mints a fresh cursor every page forever.
    for (let page = 0; page < MAX_PAGES; page++) {
      const p = await this.listMemories(userId, { limit: opts.pageSize ?? 100, cursor });
      const rows = asRecords<Memory>(p.memories);
      for (const m of rows) yield m;
      const next = p.next_cursor ?? undefined;
      if (!next) return;
      if (seen.has(next)) {
        if (rows.length) throw truncatedWalk(`stopped at page ${page + 1}: the service repeated a cursor, so the store did not end.`);
        return;
      }
      seen.add(next);
      cursor = next;
    }
    throw truncatedWalk(`stopped after ${MAX_PAGES} pages — the store did not end.`);
  }
  /** Collect ALL of a store's memories into an array (the text you stored, and its metadata). */
  async exportMemories(userId?: string): Promise<Memory[]> {
    const out: Memory[] = [];
    for await (const m of this.iterMemories(userId)) out.push(m);
    return out;
  }
  /** Collect ALL of a store's image memories into an array — the image-side pair of
   *  `exportMemories`. `pageSize` is 5-20. */
  async exportImages(userId?: string, opts: { pageSize?: number } = {}): Promise<Memory[]> {
    const out: Memory[] = [];
    for await (const m of this.iterImages(userId, opts)) out.push(m);
    return out;
  }
  // ----- images (models that list `images` in their capabilities) -----

  /**
   * Fetch the bytes of an image memory — the picture the SERVICE holds.
   *
   * Not necessarily your upload, in size OR in format: an image whose long edge was
   * over 1568px was downscaled to 1568 on the way in and re-encoded — lossless
   * formats as WebP, so a PNG comes back as `image/webp`; JPEG stays JPEG — and that
   * smaller picture is what is stored and comes back here. Nothing on our side ever
   * uses more than 1568, so the extra pixels would be bytes nobody reads.
   * Keep your own copy for the full-resolution file.
   *
   * The type is sniffed from the bytes themselves rather than from whatever the file
   * was called, so name the file from `contentType` rather than from what you sent.
   * Rejects with `NotFoundError` when this memory has no image, or when the service
   * keeps no image bytes for it — which is always the case for an image stored with
   * `reference`: fetch that one from your own reference. It says "no" instead of
   * handing back something empty, so "a memory with no image" never looks the same as
   * "an image we lost".
   *
   *     const { bytes, contentType } = await mem.getImage(undefined, id);
   *     const ext = contentType.split("/")[1];   // "webp" for a downscaled PNG
   *     await fs.writeFile(`image.${ext}`, bytes);
   */
  async getImage(userId: string | undefined, memoryId: string): Promise<ImageBytes> {
    if (typeof memoryId !== "string" || !memoryId.trim()) {
      throw new Error("memoryId is required — the id that add/store or listImages returned.");
    }
    return this.requestBytes("/api/v1/memory/image", { user_id: this.uid(userId), memory_id: memoryId.trim() });
  }

  /**
   * Remove the PHOTO from a memory, keeping its text.
   *
   * `preview: true` reports what would happen, including `memory_kept`, and changes
   * nothing. Retried like `deleteStore`; without `preview`, a 404 after an ambiguous
   * failure carries the same note.
   *
   *     const p = await mem.forgetImage(undefined, id, { preview: true });
   *     if (p.memory_kept === false) { /* this would delete the whole memory *\/ }
   */
  async forgetImage(
    userId: string | undefined,
    memoryId: string,
    opts: { preview?: boolean } = {},
  ): Promise<ImageDeleteResult> {
    if (typeof memoryId !== "string" || !memoryId.trim()) {
      throw new Error("memoryId is required — the id of the memory whose image you want removed.");
    }
    const body: Record<string, unknown> = { user_id: this.uid(userId), memory_id: memoryId.trim() };
    if (!opts.preview) return this.remove("/api/v1/memory/image", body);
    body.preview = true;
    return this.request("DELETE", "/api/v1/memory/image", body);
  }

  /**
   * List a store's image memories, newest first, and count them.
   *
   * `count` is the TOTAL in the store, not the size of the page — so you can show
   * "142 images" without walking every page. Paging is by cursor, not offset: hand
   * `next_before` and `next_skip_ids` back as `before` / `skipIds`. The pair exists
   * because several images can share a timestamp, and a timestamp alone would either
   * repeat them or skip them.
   *
   * `limit` is 5-20; anything else is refused before the request.
   */
  async listImages(
    userId?: string,
    opts: { limit?: number; before?: string; skipIds?: string[] } = {},
  ): Promise<ImagePage> {
    const limit = optRange(opts.limit, "limit", PAGE_LIMIT_MIN, PAGE_LIMIT_MAX);
    const body: Record<string, unknown> = { user_id: this.uid(userId) };
    if (limit !== undefined) body.limit = limit;
    if (opts.before !== undefined) body.before = opts.before;
    if (opts.skipIds !== undefined) body.skip_ids = opts.skipIds;
    return this.post("/api/v1/memory/images", body);
  }

  /** Async-iterate every image memory, paging under the hood. `pageSize` is 5-20.
   *  Like `iterMemories`, a walk that cannot reach the end throws. */
  async *iterImages(userId?: string, opts: { pageSize?: number } = {}): AsyncGenerator<Memory> {
    let before: string | undefined;
    let skipIds: string[] | undefined;
    // A server that hands back the cursor it was just given would re-yield one page
    // until the page ceiling, and the caller would read the repeats as more images.
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const p = await this.listImages(userId, { limit: opts.pageSize, before, skipIds });
      const rows = asRecords<Memory>(p.images);
      for (const m of rows) yield m;
      if (!p.has_more || !p.next_before) return;
      // The cursor is the PAIR: several images can share a timestamp, so `before`
      // alone repeats across pages legitimately.
      const key = `${p.next_before}|${(Array.isArray(p.next_skip_ids) ? p.next_skip_ids : []).join(",")}`;
      if (seen.has(key)) {
        if (rows.length) throw truncatedWalk(`stopped at page ${page + 1}: the service repeated a cursor, so the store did not end.`);
        return;
      }
      seen.add(key);
      before = p.next_before;
      skipIds = Array.isArray(p.next_skip_ids) ? p.next_skip_ids : undefined;
    }
    throw truncatedWalk(`stopped after ${MAX_PAGES} pages — the store did not end.`);
  }

  // ----- how much has this memory been edited -----

  /**
   * How much of this store has been altered since it was written.
   *
   * This one is aimed at the MODEL, not at you. An assistant leaning on its own memory
   * should be able to ask how far that memory has been edited underneath it — a store
   * nobody has touched reads differently from one where a third of the facts were
   * rewritten. Free, and it never reaches the retrieval path.
   *
   * Counts memories a transform touched (supersede, update, retract, image removed).
   * Deletions are NOT counted: a deleted memory leaves nothing to count. `total`
   * counts the memories you stored.
   *
   * By default this returns COUNTS ONLY, and the answer is the same size for a store
   * of a hundred memories and a store of a hundred million. That is deliberate: a model
   * asks this mid-conversation, and an answer that grew with the store would be
   * unusable for exactly the customers who most need to ask.
   *
   * To see WHICH memories, ask for one side and page through it — at most 20 per call,
   * and never both sides in one response:
   *
   * ```ts
   * const { revised, unrevised, total } = await mem.revisions();   // numbers only
   *
   * let before: string | undefined, skipIds: string[] | undefined;
   * for (;;) {
   *   const p = await mem.revisions(undefined, { include: "revised", before, skipIds });
   *   for (const m of p.memories ?? []) console.log(m.content);
   *   if (!p.has_more || !p.next_before) break;
   *   before = p.next_before;
   *   skipIds = p.next_skip_ids;
   * }
   * ```
   *
   * Pages are ordered by when each memory was STORED, not by when it was edited.
   * The response says so in `ordered_by`.
   *
   * Served from `/api/v1/won/revisions`: `/api/v1/won/*` holds the calls a model makes
   * ABOUT its memory rather than calls an application makes WITH it.
   */
  async revisions(
    userId?: string,
    opts: {
      /**
       * Omit for counts only. Set it to ALSO get one page of the memories behind that
       * number. One side per call — there is no way to ask for both lists at once.
       */
      include?: "revised" | "unrevised";
      /** Memories per page, 5-20; 20 is the default. Anything else is refused before
       *  the request. */
      limit?: number;
      /** Cursor: `next_before` from the previous page. */
      before?: string;
      /** Cursor: `next_skip_ids` from the previous page. Hand back what you were given. */
      skipIds?: string[];
    } = {},
  ): Promise<RevisionsResult> {
    const limit = optRange(opts.limit, "limit", PAGE_LIMIT_MIN, PAGE_LIMIT_MAX);
    const body: Record<string, unknown> = {};
    if (opts.include !== undefined) body.include = opts.include;
    if (limit !== undefined) body.limit = limit;
    if (opts.before !== undefined) body.before = opts.before;
    if (opts.skipIds !== undefined) body.skip_ids = opts.skipIds;
    // `user_id` LAST, after the caller's fields — an `opts` spread that can land on top
    // of it is how a client ends up reading another store. Same order as `search`.
    body.user_id = this.uid(userId);
    return this.post("/api/v1/won/revisions", body);
  }

  /**
   * The full chain of edits behind one memory, oldest first.
   *
   * `is_current` marks the version in force. Use it to answer "what did this used to
   * say, and when did it change" — `revisions()` tells you HOW MUCH a store moved,
   * this tells you what happened to one fact.
   */
  async lineage(userId: string | undefined, memoryId: string): Promise<LineageResult> {
    if (typeof memoryId !== "string" || !memoryId.trim()) {
      throw new Error("memoryId is required — the memory whose history you want.");
    }
    return this.post("/api/v1/memory/lineage", { user_id: this.uid(userId), memory_id: memoryId.trim() });
  }

  /**
   * What one person said, newest first.
   *
   * `speaker` is the tag written at store time (`metadata.speaker`) — `"me"` for the
   * assistant's own words, otherwise a person's name. Same cursor paging as
   * `listImages`; `limit` is 5-20.
   *
   * `records_to_delete` is the count to show before anyone confirms a delete of this
   * speaker's memories; `points_to_delete` is the same number under its old name.
   */
  async bySpeaker(
    speaker: string,
    userId?: string,
    opts: { limit?: number; before?: string; skipIds?: string[] } = {},
  ): Promise<SpeakerPage> {
    if (!speaker || typeof speaker !== "string" || speaker.trim() === "") {
      throw new Error('speaker is required — "me" for the assistant, or a person\'s name.');
    }
    const limit = optRange(opts.limit, "limit", PAGE_LIMIT_MIN, PAGE_LIMIT_MAX);
    const body: Record<string, unknown> = { user_id: this.uid(userId), speaker: speaker.trim() };
    if (limit !== undefined) body.limit = limit;
    if (opts.before !== undefined) body.before = opts.before;
    if (opts.skipIds !== undefined) body.skip_ids = opts.skipIds;
    return this.post("/api/v1/memory/by-speaker", body);
  }

  /** Check connectivity AND that the API key works. Resolves `true`, or rejects — an
   * `AuthenticationError` (bad key), `PaymentRequiredError` (valid key but no card /
   * depleted balance), or `APIConnectionError` (unreachable). Makes one metered request. */
  async ping(): Promise<boolean> {
    await this.request("GET", "/api/v1/memory/collections");
    return true;
  }

  // ----- models -----
  /** Available models: `[{ id, name, available, memory, capabilities, retires_at? }, ...]`.
   *  Needs no API key. */
  async listModels(): Promise<ModelInfo[]> {
    const data = await this.request("GET", "/api/v1/models");
    return asRecords<ModelInfo>(data.models);
  }

  // ----- engrams -----
  /**
   * The engrams (and delivery forms) the selected model can actually run.
   *
   * Ask rather than hard-code: a name copied from the docs freezes a caller to the
   * catalogue as it was that day, and anything added later stays invisible. The
   * service is the authority. What comes back depends on the model (`forms` is empty
   * on one that does not list `forms` in its capabilities), so pass `withModel()` if
   * you want another model's catalogue.
   *
   *   const { engrams, forms } = await mem.listEngrams();
   */
  async listEngrams(): Promise<EngramCatalog> {
    const data = await this.request("GET", "/api/v1/engram");
    // Spread the reply first so fields this version does not name still reach the
    // caller; only the promised shapes are normalised.
    return {
      ...(data as Record<string, unknown>),
      engrams: asRecords<EngramInfo>(data.engrams),
      forms: asRecords<EngramInfo>(data.forms),
      // Present when the selected model has no engram support — the service explains
      // rather than returning a bare empty list.
      note: typeof data.note === "string" ? data.note : undefined,
    };
  }

  // ----- stores -----
  /** Create a store — the `userId` you read and write under. Stores are explicit:
   * a store must exist before you `add` to or `search` it, otherwise those calls
   * return 404. Idempotent. Every account starts with a `default` store.
   * Returns `{ user_id, status }` (`status` is `"created"` or `"exists"`). */
  async createStore(userId?: string): Promise<StoreOpResult> {
    return this.post("/api/v1/memory/collection", { user_id: this.uid(userId) });
  }
  /** List your stores: `[{ user_id, created_at, canonical_id? }, ...]` (`default`
   *  first). Each `user_id` is the id the store was created with. */
  async listStores(): Promise<StoreInfo[]> {
    const r = await this.request("GET", "/api/v1/memory/collections");
    return asRecords<StoreInfo>(r.collections);
  }
  /** Delete a store and ALL its memories. Returns `{ user_id, status }`.
   *  A delete retried after an ambiguous failure (408/502/503/504 or a dropped
   *  connection) that then answers 404 rejects with a `NotFoundError` saying an
   *  earlier attempt may already have deleted it. */
  async deleteStore(userId: string): Promise<StoreOpResult> {
    // Validate before warning: the warning helper lowercases the id.
    if (typeof userId !== "string" || !userId.trim()) throw new Error("userId is required (a non-blank string) — deleteStore never falls back to the default store.");
    warnIfStoreIdCollapses(userId); // destructive: the collision warning belongs here too
    return this.remove("/api/v1/memory/collection", { user_id: userId });
  }

  // ----- speakers (who said it) -----

  /** Register a person for this store. Speakers are explicit: register once, then
   * store with `{ speaker }`. `"me"` (the assistant itself) never needs
   * registration. A store registers up to 50 people to start. */
  async addSpeaker(speaker: string, userId?: string): Promise<SpeakerOpResult> {
    return this.post("/api/v1/memory/speakers", { user_id: this.uid(userId), speaker });
  }
  /** The store's registered people, each with its memory count. */
  async listSpeakers(userId?: string): Promise<SpeakersList> {
    const r = await this.request("GET", `/api/v1/memory/speakers?user_id=${encodeURIComponent(this.uid(userId))}`);
    // The normalized list goes last, so a present-but-null `speakers` still arrives as [].
    return { ...r, speakers: asRecords(r?.speakers) } as SpeakersList;
  }
  /** Unregister a person. Their memories stay; the name tag goes. Retried like
   *  `deleteStore`, with the same note on a 404 after an ambiguous failure. */
  async removeSpeaker(speaker: string, userId?: string): Promise<SpeakerOpResult> {
    return this.remove("/api/v1/memory/speakers", { user_id: this.uid(userId), speaker });
  }

  // ----- delete -----
  /** Delete a single memory by id. Pass `undefined` as `userId` for the default
   *  store — it is positional here. */
  async delete(userId: string | undefined, memoryId: string): Promise<StatusResult> {
    // Guard: without a memory_id the API's forget endpoint means "delete the
    // whole store". An undefined/"" slipping in here must never become a wipe.
    //
    // `.trim()` matters as much as the emptiness check: "   " is truthy, so without it
    // a blank string passes the guard and travels as memory_id. A server that trims it
    // back to nothing reads the request as the whole-store form, which is the most
    // destructive way for this SDK to be wrong.
    if (typeof memoryId !== "string" || !memoryId.trim()) {
      throw new Error("memoryId is required (non-blank). To delete every memory in a store, call deleteAll(userId) explicitly.");
    }
    return this.post("/api/v1/memory/forget", { user_id: this.uid(userId), memory_id: memoryId.trim() });
  }
  /** Delete ALL memories for a store (GDPR erase). `userId` is required on purpose -
   * this is destructive, so it never falls back to the default store. */
  async deleteAll(userId: string): Promise<StatusResult> {
    if (typeof userId !== "string" || !userId.trim()) throw new Error("userId is required (a non-blank string) for deleteAll — anything else would wipe the default store.");
    // Takes the store id directly instead of through uid(), so it warns here.
    warnIfStoreIdCollapses(userId);
    return this.post("/api/v1/memory/forget", { user_id: userId });
  }

  // ----- internal -----
  private post(path: string, body: unknown, idempotencyKey?: string): Promise<any> {
    return this.request("POST", path, body, idempotencyKey);
  }
  /** A DELETE that removes something: a 404 after an ambiguous failure says an earlier
   *  attempt may already have removed it. */
  private remove(path: string, body: unknown): Promise<any> {
    return this.request("DELETE", path, body, undefined, true);
  }

  /** Where this call's budget runs out, or `undefined` when it has none. Computed
   *  once per call, not per attempt — a budget recomputed each attempt is not a
   *  budget. */
  private deadlineAt(): number | undefined {
    return this.deadlineMs === undefined ? undefined : Date.now() + this.deadlineMs;
  }

  /** The abort wiring for ONE attempt: this SDK's per-attempt timeout, the caller's
   *  signal, and whatever is left of the overall deadline — whichever fires first.
   *  With no time left it throws `answer` (the refusal that led here), or the
   *  deadline error when there is none. */
  private beginAttempt(deadlineAt?: number, answer?: WosError): {
    signal: AbortSignal;
    clear: () => void;
    why: () => "timeout" | "deadline" | "caller";
    /** When this attempt's time runs out (ms since the epoch). */
    endsAt: number;
  } {
    let why: "timeout" | "deadline" | "caller" = "timeout";
    let budget = this.timeoutMs;
    if (deadlineAt !== undefined) {
      const left = deadlineAt - Date.now();
      // Refuse rather than open a socket there is no time to use: a 0ms timer races a
      // fast server, and the same call would sometimes report its deadline and
      // sometimes return a result.
      if (left <= 0) throw answer ?? new APIConnectionError(0, this.abortMessage("deadline"));
      if (left < budget) {
        budget = left;
        why = "deadline";
      }
    }
    const ctrl = new AbortController();
    const endsAt = Date.now() + budget;
    const timer = setTimeout(() => ctrl.abort(), budget);
    const outer = this.signal;
    const onCaller = () => {
      why = "caller";
      ctrl.abort();
    };
    if (outer) {
      if (outer.aborted) onCaller();
      // Removed in clear(), so one long-lived signal per user session does not collect
      // a listener per request.
      else outer.addEventListener("abort", onCaller);
    }
    return {
      signal: ctrl.signal,
      clear: () => {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onCaller);
      },
      why: () => why,
      endsAt,
    };
  }

  /** What to say when an attempt was cut short. The three reasons need different
   *  words: a timeout may have landed server-side, a cancellation certainly did not
   *  matter to the caller, and an exhausted budget is the caller's own setting. */
  private abortMessage(why: "timeout" | "deadline" | "caller"): string {
    if (why === "caller") return "cancelled — the caller's AbortSignal fired";
    if (why === "deadline") return `deadline of ${this.deadlineMs}ms exhausted`;
    return `request timed out after ${this.timeoutMs}ms`;
  }

  /** Whether a wait of `ms` still leaves time before the deadline. */
  private fits(ms: number, deadlineAt?: number): boolean {
    return deadlineAt === undefined || ms <= deadlineAt - Date.now();
  }

  /** Sleep between attempts, waking the moment the caller aborts. */
  private async pause(ms: number): Promise<void> {
    const outer = this.signal;
    if (!outer) {
      await new Promise((r) => setTimeout(r, ms));
      return;
    }
    if (outer.aborted) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        outer.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      outer.addEventListener("abort", done);
    });
  }

  /** The error for a request that got no answer. The message names the cause code
   *  (ECONNREFUSED, ENOTFOUND, CERT_HAS_EXPIRED, …) and never carries the query
   *  string, which can hold a store id, or the base URL's userinfo. With either in
   *  the URL the transport error is not kept as the cause, since its own message can
   *  quote the URL. */
  private networkError(e: any, path: string): APIConnectionError {
    let text = typeof e?.message === "string" && e.message ? e.message : String(e);
    const q = path.indexOf("?");
    if (q !== -1) {
      const query = path.slice(q);
      text = text.split(query).join("");
      try {
        text = text.split(decodeURIComponent(query)).join("");
      } catch {
        /* the query was not percent-encoded */
      }
    }
    text = cleanServerText(maskUserinfo(text), 512);
    const code = causeCode(e);
    if (code && !text.includes(code)) text += ` (${code})`;
    const quotable = this.userinfo || q !== -1;
    return new APIConnectionError(0, `network error: ${text}`, undefined, quotable ? undefined : { cause: e });
  }

  /** A redirect: a 3xx, or one a custom fetch followed. Where a custom fetch sent the
   *  request (`res.url`) is its own business. */
  private isRedirected(res: Response): boolean {
    return (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect" || res.redirected === true;
  }

  /** The error an answer carries: the service's message (control characters removed,
   *  capped), request id, `type` and the rest of its error object. `unread` says why
   *  the body is missing, when it could not be read. */
  private errorFromAnswer(
    res: Response,
    body: Uint8Array,
    retryAfter?: number,
    mayBeDeleted = false,
    unread?: string,
  ): WosError {
    const e = parseErrorText(new TextDecoder().decode(body));
    let msg = cleanServerText(e.message) || `HTTP ${res.status}`;
    if (res.status === 410) msg += ` ${GONE_HINT}`;
    if (unread) msg += ` (the error body could not be read: ${cleanServerText(unread, 512)})`;
    const requestId = e.requestId === undefined ? undefined : cleanServerText(e.requestId, 256) || undefined;
    const err = errorFor(res.status, msg, requestId, {
      type: e.type === undefined ? undefined : cleanServerText(e.type, 256) || undefined,
      details: cleanDetails(e.details),
      retryAfter: retryAfter === undefined ? undefined : Math.ceil(retryAfter / 1000),
    });
    if (mayBeDeleted && err instanceof NotFoundError) {
      err.message += " (an earlier attempt may already have deleted it)";
    }
    return err;
  }

  /**
   * Send one call, retrying what can be retried, and return the answer with its body
   * read (under the same timeout, so a body that trickles in cannot stall the call).
   * The error body of an answer about to be retried gets at most a second.
   *
   * Retried: 429, and a 409 whose error carries `retry_after_ms` (another write to the
   * store was in flight; nothing was stored), on every method; 408/502/503/504 and
   * dropped connections on idempotent methods; connect failures on every method. A
   * retry whose wait is over the cap, or does not fit the deadline, is not made: the
   * call fails with the error of the response it has. So does a retry the deadline
   * leaves no time to send, and the retry of an idempotent method or of a POST that
   * only reads that the deadline cuts short. Any other retry cut short stays a status-0
   * deadline error: a write may have been applied.
   */
  private async send(
    method: string,
    path: string,
    payload: string | undefined,
    extraHeaders?: Record<string, string>,
    removes = false,
    // A POST that only reads: a deadline that cuts its retry short reports the answer
    // before it, as for an idempotent method.
    reads = false,
  ): Promise<{ res: Response; body: Uint8Array }> {
    // A relative base with no page to resolve it against cannot be sent anywhere. An
    // argument error, like the other refusals before sending: status 0 would read as
    // a transport failure worth retrying.
    if (this.pageRelative && !this.customFetch && !parseBase(this.base)) {
      throw new Error(
        `${notAUrl(this.base)}. A relative baseUrl needs a page to resolve against, and this runtime has none.`,
      );
    }
    const attempts = this.maxRetries + 1;
    const upper = method.toUpperCase();
    const idempotent = IDEMPOTENT_METHODS.has(upper);
    // Debug logging shows the path WITHOUT its query string — a query can carry
    // a store id (listSpeakers), and logs must never carry data.
    const logPath = path.split("?")[0];
    const deadlineAt = this.deadlineAt();
    const headers = extraHeaders ? { ...this.headers, ...extraHeaders } : this.headers;
    // Set once an attempt may have reached the service without an answer we could read.
    let ambiguous = false;
    // The refused answer that led to the next attempt. It is what the call reports when
    // the deadline leaves that attempt nothing of its own to report.
    let refused: WosError | undefined;
    for (let attempt = 0; ; attempt++) {
      const last = attempt + 1 >= attempts;
      const tag = `(attempt ${attempt + 1}/${attempts})`;
      const start = Date.now();
      const previous = refused;
      refused = undefined;
      // No time left to send this attempt: the answer before it is the result.
      const att = this.beginAttempt(deadlineAt, previous);
      /** Wait out a failure that left no answer. A wait the deadline cannot fit ends the
       *  call with the answer before it, or with the deadline when there is none. */
      const pauseWithoutAnswer = async (why: string): Promise<void> => {
        const delay = this.backoffMs(attempt);
        if (!this.fits(delay, deadlineAt)) throw previous ?? new APIConnectionError(0, this.abortMessage("deadline"));
        logDebug(`${method} ${logPath}: ${why}. Retrying in ${Math.round(delay)}ms ${tag}`);
        await this.pause(delay);
      };
      /** The error for an attempt cut short. A read the deadline cut reports the answer
       *  before it; a write reports the deadline, since it may have been applied. */
      const cutShort = (): WosError => {
        const why = att.why();
        if (why === "deadline" && (idempotent || reads || (upper === "POST" && READ_POSTS.has(logPath))) && previous) {
          return previous;
        }
        return new APIConnectionError(0, this.abortMessage(why));
      };
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.base}${path}`, {
          method,
          headers,
          body: payload,
          signal: att.signal,
          // Never follow a redirect: fetch would forward the API key to
          // wherever a 3xx points. The API never legitimately redirects.
          redirect: "manual",
        });
      } catch (e: any) {
        att.clear();
        // Timeouts are ambiguous (the write may have landed) — don't retry those.
        const timedOut = e?.name === "AbortError" || att.signal.aborted;
        if (timedOut) throw cutShort();
        // Other network errors retry only when a retry can't double-process a write:
        // idempotent methods always; writes only when the connection never opened.
        const connect = isConnectFailure(e);
        if ((idempotent || connect) && !last) {
          if (!connect) ambiguous = true;
          await pauseWithoutAnswer(e?.code ?? e?.name ?? "network error");
          continue;
        }
        throw this.networkError(e, path);
      }
      /** The body, or `null` when the connection dropped mid-body and the call can be retried. */
      const readBody = async (): Promise<Uint8Array | null> => {
        try {
          return await this.readCappedBytes(res);
        } catch (e: any) {
          if (e?.name === "AbortError" || att.signal.aborted) throw cutShort();
          if (e instanceof WosError) throw e; // the size cap — already the right error
          // A drop while READING the body is a transport failure. Retried on an
          // idempotent method; a write may already have been applied.
          if (idempotent && !last) return null;
          throw this.networkError(e, path);
        }
      };
      /** An error answer's body, within `withinMs` when given. The status is the answer,
       *  so a body that cannot be read (dropped, cut off by the timeout, too slow, over
       *  the size cap) is reported as missing rather than turning the answer into "no
       *  answer". Only a cancel still wins. */
      const readErrorBody = async (withinMs?: number): Promise<{ body: Uint8Array; unread?: string }> => {
        try {
          return { body: await this.readCappedBytes(res, withinMs) };
        } catch (e: any) {
          const aborted = e?.name === "AbortError" || att.signal.aborted;
          if (aborted && att.why() === "caller") throw new APIConnectionError(0, this.abortMessage("caller"));
          const unread = aborted
            ? this.abortMessage(att.why())
            : e instanceof SlowBody
              ? e.message
              : (e instanceof WosError ? e : this.networkError(e, path)).message.replace(/^\[\d+\] /, "");
          return { body: new Uint8Array(0), unread };
        }
      };
      try {
        if (this.isRedirected(res)) {
          discard(res);
          throw new WosError(
            res.status,
            "unexpected redirect — refused (the API key never follows a redirect). Check baseUrl: exact host, https://."
          );
        }
        this._rateLimit = parseRateLimit(res.headers) ?? this._rateLimit;
        if (!res.ok) {
          const ra = retryAfterMs(res.headers.get("Retry-After"));
          // How long to wait before retrying this status; undefined when it is not
          // retried. A 409's comes from its body, below.
          let wait =
            RETRY_ALWAYS.has(res.status) || (RETRY_IF_IDEMPOTENT.has(res.status) && idempotent)
              ? ra ?? this.backoffMs(attempt)
              : undefined;
          // The retry does not need the body, so a stalled one gets a moment, not the
          // rest of the attempt.
          const retrying = wait !== undefined && !last && wait <= MAX_RETRY_WAIT_MS && this.fits(wait, deadlineAt);
          const { body, unread } = await readErrorBody(
            retrying ? Math.max(0, Math.min(BRIEF_BODY_MS, att.endsAt - Date.now())) : undefined,
          );
          if (res.status === 409) {
            // Only a 409 that says so is a write lock; one whose body was lost is final.
            const d = parseErrorText(new TextDecoder().decode(body)).details;
            const ms = d?.retry_after_ms;
            if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && d?.conflicts_with === undefined) {
              wait = Math.max(ms, this.backoffMs(attempt));
            }
          }
          if (wait !== undefined && !last) {
            if (wait > MAX_RETRY_WAIT_MS) {
              logDebug(`${method} ${logPath} -> ${res.status}: asked to wait ${Math.round(wait)}ms, over the cap. Not retrying ${tag}`);
            } else if (!this.fits(wait, deadlineAt)) {
              logDebug(`${method} ${logPath} -> ${res.status}: a ${Math.round(wait)}ms wait does not fit the deadline. Not retrying ${tag}`);
            } else {
              if (RETRY_IF_IDEMPOTENT.has(res.status)) ambiguous = true;
              refused = this.errorFromAnswer(res, body, ra, ambiguous && removes, unread);
              att.clear();
              logDebug(`${method} ${logPath} -> ${res.status}. Retrying in ${Math.round(wait)}ms ${tag}`);
              await this.pause(wait);
              continue;
            }
          }
          logDebug(`${method} ${logPath} -> ${res.status} in ${Date.now() - start}ms ${tag}`);
          throw this.errorFromAnswer(res, body, ra, ambiguous && removes, unread);
        }
        const body = await readBody();
        if (body === null) {
          ambiguous = true;
          att.clear();
          await pauseWithoutAnswer("body dropped mid-stream");
          continue;
        }
        logDebug(`${method} ${logPath} -> ${res.status} in ${Date.now() - start}ms ${tag}`);
        return { res, body };
      } finally {
        att.clear();
      }
    }
  }

  /**
   * One request that answers with BYTES rather than JSON.
   *
   * Only `/memory/image` does this: `request()` insists the body parses to a JSON
   * object, and a JPEG would come back as "invalid JSON in response" for a call that
   * succeeded. Retries, timeouts and errors are the same as every other call's.
   */
  private async requestBytes(path: string, body: unknown): Promise<ImageBytes> {
    const { res, body: buf } = await this.send("POST", path, JSON.stringify(body), undefined, false, true);
    if (buf.byteLength === 0) {
      // An empty 200 would otherwise read as "here is your image" and write a
      // zero-byte file — indistinguishable from an image we lost.
      throw new WosError(res.status, "empty image body — the service returned no bytes");
    }
    return { bytes: buf, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  /** Validate an idempotency key BEFORE the network. The API answers a malformed
   *  key with a 400, which on a retry path reads as "my write failed" when in fact
   *  it was never attempted — cheaper and clearer to reject it here. */
  private idemHeader(key?: string): Record<string, string> | undefined {
    // `null` is "no key" too: RegExp.test would stringify it into the literal key
    // "null", and every write sharing it would replay the first.
    if (key === undefined || key === null) return undefined;
    if (!IDEMPOTENCY_KEY_RE.test(key)) {
      throw new Error(
        `invalid idempotencyKey: ${JSON.stringify(key)} — 1-128 chars of [A-Za-z0-9._:-]`,
      );
    }
    return { "Idempotency-Key": key };
  }

  /** Milliseconds to sleep before retry `attempt` (0-based): exponential with jitter,
   *  or what a valid `Retry-After` asks for. */
  private backoffMs(attempt: number, retryAfter?: string | null): number {
    const ra = retryAfterMs(retryAfter ?? null);
    if (ra !== undefined) return ra;
    return Math.min(8_000, 500 * 2 ** attempt) + Math.random() * 250;
  }

  /** Read the body with a hard size cap, so a broken/hostile endpoint can't
   * make the process buffer gigabytes. With `withinMs`, a body still arriving after
   * that long is dropped and the read fails. */
  private async readCappedBytes(res: Response, withinMs?: number): Promise<Uint8Array> {
    const cl = res.headers.get("content-length");
    if (cl && Number(cl) > MAX_RESPONSE_BYTES) {
      discard(res);
      throw new WosError(res.status, `response too large (${cl} bytes) — refusing to buffer it`);
    }
    const slow = () => new SlowBody(`not received within ${withinMs}ms`);
    // With `withinMs`, every wait below races `stopped`, which rejects once it has passed.
    let late = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let stop = () => {};
    const stopped = new Promise<never>((_, reject) => (stop = () => reject(slow())));
    stopped.catch(() => {});
    const timer =
      withinMs === undefined
        ? undefined
        : setTimeout(() => {
            late = true;
            stop();
            reader?.cancel().catch(() => {});
          }, withinMs);
    const within = <T>(p: Promise<T>): Promise<T> => (timer === undefined ? p : Promise.race([p, stopped]));
    try {
      if (!res.body) {
        // A body-less Response (test doubles, polyfills, wrappers that rebuild the
        // Response) has only `arrayBuffer()`, which has no ceiling of its own.
        const buf = new Uint8Array(await within(res.arrayBuffer()));
        if (buf.byteLength > MAX_RESPONSE_BYTES) {
          throw new WosError(res.status, `response too large (${buf.byteLength} bytes) — refusing it`);
        }
        return buf;
      }
      reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await within(reader.read());
        // The cancel above ends a pending read with `done`; that is not the real end.
        if (late) throw slow();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          reader.cancel().catch(() => {});
          throw new WosError(res.status, "response too large — refusing to buffer it");
        }
        parts.push(value);
      }
      const buf = new Uint8Array(size);
      let off = 0;
      for (const p of parts) {
        buf.set(p, off);
        off += p.byteLength;
      }
      return buf;
    } catch (e) {
      throw late && !(e instanceof SlowBody) ? slow() : e;
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    removes = false,
  ): Promise<any> {
    const extraHeaders = this.idemHeader(idempotencyKey);
    // Serialized ONCE, before any attempt. A value JSON cannot carry (an ORM entity, a
    // BigInt, a circular reference) is an argument mistake: a plain Error, not a
    // status-0 APIConnectionError that a caller would retry.
    let payload: string | undefined;
    try {
      payload = body === undefined ? undefined : JSON.stringify(body);
    } catch (e) {
      throw new Error(
        `request body could not be serialized: ${e instanceof Error ? e.message : String(e)}. ` +
          "Pass plain JSON values — an ORM entity, a BigInt or a circular reference cannot be sent.",
      );
    }
    const { res, body: buf } = await this.send(method, path, payload, extraHeaders, removes);
    const text = new TextDecoder().decode(buf);
    // An empty body is only legal when the STATUS says there is no body. Accepting
    // any empty 2xx would make an `add()` answered by a truncating proxy return `{}`,
    // which reads as a successful write with no id.
    if (!text) {
      if (NO_BODY_STATUS.has(res.status)) return {};
      throw new WosError(res.status, "empty response body — expected a JSON object");
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e: any) {
      // A 2xx with a corrupt body is a real failure — surface it, don't leak
      // a raw SyntaxError.
      throw new WosError(res.status, `invalid JSON in response: ${cleanServerText(String(e?.message ?? e), 512)}`);
    }
    // Enforce a JSON OBJECT: every method reads the result with `.field`, so a
    // body that parses to null / a number / a string / an array (a broken or
    // hostile server) must be a clean WosError, not a `null.memories` TypeError.
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      const got = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
      throw new WosError(res.status, `expected a JSON object in the response, got ${got}`);
    }
    // Surface whether the write was stored or replayed. The server says so with
    // `Idempotent-Replayed: true`, and it answers the question someone using an
    // idempotency key is asking: did my retry write, or is this the first response
    // coming back again? Only when the body does not already carry the field: what
    // the service said wins.
    if (res.headers.get("Idempotent-Replayed") === "true" && !("replayed" in data)) {
      (data as Record<string, unknown>).replayed = true;
    }
    return data;
  }
}

/** Back-compat alias: older code used `WME`. */
export const WME = Client;
export default Client;
