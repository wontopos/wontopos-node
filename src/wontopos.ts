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
 * jitter, honoring `Retry-After` — 429 always; 502/503 and connection errors only
 * when a retry can never double-process a write (idempotent calls, or a failure
 * at connect time). Tune with `maxRetries` (0 disables) and `timeoutMs`, or per
 * call site via the `withTimeout()` / `withRetries()` clones.
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

const VERSION = "2.2.37";
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
/** The engine every call uses unless the caller names another.
 *
 *  Tablet 2 costs the same per token as Tablet 1 and is the one that
 *  serves images, re-ask passes (`verify`), and `self_memories`, so a caller who
 *  names nothing gets the engine that can answer the most. Models on the shared
 *  pool read the same memory, so switching between them is a header, not a
 *  migration. Pin an older one explicitly with
 *  `new Client({ apiKey, model: "tablet-1" })` or `withModel("tablet-1")`. */
const DEFAULT_MODEL = "tablet-2";
/** 429 = rate-limited BEFORE processing → always safe to retry (no write, no bill). */
const RETRY_ALWAYS = new Set([429]);
/** 502/503 are ambiguous for a write (gateway may return them AFTER the backend
 *  processed + billed the request), so retry them only for idempotent methods —
 *  a retried POST could double-store / double-bill. */
const RETRY_IF_IDEMPOTENT = new Set([502, 503]);
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
/** Refuse to buffer absurd responses (real ones are a few KB) — protects the
 * process if a custom baseUrl points somewhere broken or hostile. */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
/** Model names travel in a header — only header-safe characters. */
const MODEL_RE = /^[A-Za-z0-9._-]+$/;
/** Cap a server-controlled error message so a hostile body can't blow up a log. */
const MAX_ERR_MSG = 4096;
/** What the API accepts as an `Idempotency-Key`. Checked client-side so a bad key
 *  fails before the request instead of coming back as a 400 mid-retry. */
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:\-]{1,128}$/;

/**
 * The API normalizes a store id: lowercased, and every character outside
 * `[a-z0-9_]` becomes `_`. So `Alice.Smith`, `alice-smith` and `alice_smith` are
 * ALL the same store.
 *
 * That is a data-exposure hazard for the most common way this SDK is used — one
 * store per end user. Two accounts whose ids differ only by punctuation or case
 * (`bob.lee@x.com` / `bob-lee@x.com`) silently share every memory, and nothing in
 * the response says so: the note only appears when `createStore` creates one, and
 * an app that reuses an existing store never sees it.
 *
 * We cannot refuse the id — the API accepts it, and callers may have written it
 * this way for a year. So we say it once, loudly, at the moment it happens.
 */
function normalizeStoreId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}
/** Ids already warned about, so each is reported once.
 *
 *  Bounded on purpose. The warning fires on ids that fold, and the shape it exists
 *  to catch is an email — which this SDK's own documented pattern ("one store per
 *  end user") turns into one entry PER USER, held for the life of the process and
 *  never released, even when the client is. A server that forwards 50,000 distinct user
 *  ids would grow this to 50,000 entries, leaking in exactly the case the warning
 *  exists to catch. A `Set`
 *  keeps insertion order, so the oldest entry is the one evicted; dropping the
 *  oldest rather than refusing new ones means a collision that first shows up late
 *  still gets its one warning. */
const WARNED_STORE_IDS_MAX = 1024;
/** Same cap, same reason, for the unknown-filter warn set. */
const WARNED_FILTER_KEYS_MAX = 1024;
const warnedStoreIds = new Set<string>();
function warnIfStoreIdCollapses(id: string): void {
  if (!id || warnedStoreIds.has(id)) return;
  const normalized = normalizeStoreId(id);
  if (normalized === id) return;
  warnedStoreIds.add(id);
  while (warnedStoreIds.size > WARNED_STORE_IDS_MAX) {
    const oldest = warnedStoreIds.values().next().value;
    if (oldest === undefined) break;
    warnedStoreIds.delete(oldest);
  }
  console.warn(
    `wontopos: store id ${JSON.stringify(id)} is stored as ${JSON.stringify(normalized)} ` +
      `(lowercased, and anything outside [a-z0-9_] becomes "_"). Ids that differ only by case or ` +
      `punctuation share ONE store and therefore one set of memories — if these ids come from your ` +
      `end users, normalize them yourself first so two people can never collide.`,
  );
}
/** Test hook — the warn-once set is process-global by design. */
export function _resetStoreIdWarnings(): void {
  warnedStoreIds.clear();
}
/** Statuses that legitimately carry NO body (RFC 9110). Everything else must
 *  answer with a JSON object — see the empty-body check in `request`. */
const NO_BODY_STATUS = new Set([204, 205, 304]);
/** Paging backstop: bound the walk so a fresh-cursor-forever server can't loop us. */
// A page walk has to stop somewhere, and 1,000,000 pages was not a stop: at 100 per
// page that is 100 million memories, so a server minting a fresh cursor every time
// would spend hours and a million billed requests before it fired. 20,000 pages is two
// million memories — past any real store, reached in minutes.
//
// ★And it has to be LOUD. Falling out of the loop yielded a truncated list that looks
// exactly like a complete one; the caller writes it to a file believing it is the
// whole store. Hitting this now throws.
const MAX_PAGES = 20_000;

export const SEARCH_LIMIT_MIN = 5;
export const SEARCH_LIMIT_MAX = 20;

/** `recall`'s surrounding-context count. 0 to 20 inclusive; 0 attaches none. */
export const CONTEXT_LIMIT_MIN = 0;
export const CONTEXT_LIMIT_MAX = 20;

/** The 5-to-20 count shared by `search` and `recall`, refused out of range rather
 * than quietly adjusted.
 *
 * The service has refused anything else from the start, because asking for 20 and
 * silently getting 10 reads as "that is all there is". Search had no contract at
 * all: the three clients sent whatever they were given, the MCP server allowed 1 to
 * 60, and the service quietly capped at 50 with no floor. Four surfaces, four
 * answers, and the caller could not tell which one they got.
 *
 * ★ `recall` said it enforced this and did not. Its doc comment promised "out of
 * range is refused, not clamped" while the value went straight to the wire in all
 * three SDKs — so `limit: 500` travelled to the engine and died there. A comment
 * that describes a guard is not a guard, and this is the shape of defect a reviewer
 * reading one diff can never see: the promise and the missing code were written
 * months apart.
 *
 * Thrown as a plain `Error`, like every other argument check in this file. It is
 * NOT a `WosError` — nothing was sent, and `WosError` with status 0 means
 * `APIConnectionError`, "the request never got a response". Reusing that status for
 * a typo told a caller with `if (e.status === 0) retry()` to retry a bad argument
 * forever.
 *
 * Refusing rather than clamping is the same decision as 2.2.35's, where a Rust
 * `limit` of 0 had been rewritten to 10 and the caller was handed ten memories they
 * had not asked for, and the bill for them. */
function checkCount(limit: number, name: string): void {
  if (!Number.isInteger(limit) || limit < SEARCH_LIMIT_MIN || limit > SEARCH_LIMIT_MAX) {
    throw new Error(
      `${name} must be an integer between ${SEARCH_LIMIT_MIN} and ${SEARCH_LIMIT_MAX}, got ${limit}. ` +
        `Out of range is refused rather than adjusted, so a short answer always means ` +
        `the store was short.`
    );
  }
}

/** `recall`'s `context_limit`, 0 to 20. Same reason as the count above: the doc
 *  comment on `recall` promises out-of-range is refused, and a promise the client
 *  does not keep is worse than no promise — the caller reads the doc, sends 50, and
 *  the failure arrives from the service with no hint that the SDK knew all along. */
function checkContextLimit(n: number): void {
  if (!Number.isInteger(n) || n < CONTEXT_LIMIT_MIN || n > CONTEXT_LIMIT_MAX) {
    throw new Error(
      `context_limit must be an integer between ${CONTEXT_LIMIT_MIN} and ${CONTEXT_LIMIT_MAX}, got ${n}.`
    );
  }
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
  // `data:image/png;base64,` travels as part of the base64. The engine answers 400
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
/** Error codes that only occur while ESTABLISHING a connection — the request
 * never reached the server, so a retry can't double-process a write. Mid-stream
 * codes (ECONNRESET, EPIPE, UND_ERR_SOCKET, ETIMEDOUT) are ambiguous: the server
 * may already have processed (and billed) the request, so they're excluded. */
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

/** Walk an error's `cause` chain (and AggregateError members — happy-eyeballs
 * connects) looking for a connect-level failure code. */
function isConnectFailure(e: unknown): boolean {
  const stack: unknown[] = [e];
  for (let steps = 0; stack.length && steps < 24; steps++) {
    const cur = stack.pop() as any;
    if (!cur || typeof cur !== "object") continue;
    if (typeof cur.code === "string" && CONNECT_FAIL_CODES.has(cur.code)) return true;
    if (cur.cause) stack.push(cur.cause);
    if (Array.isArray(cur.errors)) stack.push(...cur.errors.slice(0, 8));
  }
  return false;
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

/** Every memory a search returned, from both fields, as one array.
 *
 * Some models answer with the assistant's own words in `self_memories`, not
 * repeated in `memories`. `search()` used to return `memories` alone, so an
 * assistant turn stored with `addTurn` was missing from its results on those
 * models while the same query returned it on others — upgrading made search
 * return LESS, and what went missing had already been retrieved and paid for.
 *
 * Both fields are returned here, de-duplicated by id, each memory keeping its
 * `speaker` so a caller can still tell who said what. Callers who want them kept
 * apart use `searchSelf()`, which is what that method is for. */
function mergeResults(r: { memories?: unknown; self_memories?: unknown }): Memory[] {
  const main = asRecords<Memory>(r?.memories);
  const mine = asRecords<Memory>(r?.self_memories);
  if (mine.length === 0) return main;
  const seen = new Set(main.map((m) => m.id).filter((id): id is string => typeof id === "string"));
  return main.concat(mine.filter((m) => !(typeof m.id === "string" && seen.has(m.id))));
}

/** Attach a delivery-form override ("memoir"/"archive") + tz to a request body, the
 * way search passes them; on Scroll 1.2+ this renders each returned memory's time in
 * that form. The server validates the form (400 on an unknown one). */
function withForm(body: Record<string, unknown>, form?: string, tz?: number): Record<string, unknown> {
  if (form !== undefined) body.form = form;
  if (tz !== undefined) body.tz = tz;
  return body;
}

export class WosError extends Error {
  readonly status: number;
  /** The server's id for the request when it sent one — include it when contacting support. */
  readonly requestId?: string;
  constructor(status: number, message: string, requestId?: string) {
    super(`[${status}] ${message}${requestId ? ` (request_id: ${requestId})` : ""}`);
    this.name = new.target.name; // the concrete subclass name (RateLimitError, …)
    this.status = status;
    this.requestId = requestId;
  }
}

// Typed subclasses so callers can branch on the failure — `catch (e) { if (e instanceof
// RateLimitError) … }`. Each is a WosError, so a broad `instanceof WosError` still works.
/** The request never got a response (DNS/TLS/timeout/connection). `status` is 0. */
export class APIConnectionError extends WosError {}
/** 400 — the request was malformed (bad arguments). */
export class BadRequestError extends WosError {}
/** 401 — the API key is missing, wrong, or revoked. */
export class AuthenticationError extends WosError {}
/** 402 — no card on file or the balance is depleted. Top up to continue. */
export class PaymentRequiredError extends WosError {}
/** 403 — the key/model isn't allowed to do this. */
export class PermissionDeniedError extends WosError {}
/** 404 — the store or resource doesn't exist (create the store first). */
export class NotFoundError extends WosError {}
/** 409 — a concurrent write to the same store. Retry. */
export class ConflictError extends WosError {}
/** 429 — too many requests. Back off and retry (the client already retries these). */
export class RateLimitError extends WosError {}
/**
 * 5xx — the service failed.
 *
 * `502` / `503` are transient: the client already retries them for calls where a
 * retry cannot double-process a write, and retrying yourself is reasonable.
 *
 * `501` is NOT transient. It means the engine behind the model you selected does
 * not implement that endpoint at all (the error carries `model` and `endpoint`).
 * Retrying can never succeed — pick a model that supports it (`listModels`) or
 * drop the call. Treating the whole 5xx range as retryable sends a caller into a
 * loop that cannot end.
 */
export class ServerError extends WosError {}

const STATUS_ERRORS: Record<number, new (s: number, m: string, r?: string) => WosError> = {
  400: BadRequestError,
  401: AuthenticationError,
  402: PaymentRequiredError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  429: RateLimitError,
};

/** Build the most specific WosError subclass for an HTTP status. */
// Internal factory — the typed error CLASSES are the public surface.
function errorFor(status: number, message: string, requestId?: string): WosError {
  const Cls =
    status === 0
      ? APIConnectionError
      : STATUS_ERRORS[status] ?? (status >= 500 && status < 600 ? ServerError : WosError);
  return new Cls(status, message, requestId);
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

/** `add` / `store` → `{ id, status }` (`status: "stored" | "stored (async)" | "duplicate"`). */
export interface StoreResult {
  id?: string;
  /** `"stored"`, or `"duplicate"` when nothing was saved. */
  status?: string;
  /**
   * Present when `status` is `"duplicate"`: the id of the memory this write collided with.
   *
   * A genuinely new fact that only varies a detail of one already stored ("no meetings
   * before 10am" next to "no meetings on Fridays") can land here too, so a duplicate is
   * not always a harmless no-op: read this id, and either store one sentence that states
   * both or `update()` the existing memory with the combined statement. Without it a
   * dropped write gave the caller nothing to act on.
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

// ----- images (Tablet 2 and newer) -----

/**
 * An image attached to a memory, passed to `add`/`store` via `opts.image`.
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
 * Keep your own copy if you need the full-resolution file. Either archive it
 * yourself, or put its URL in `reference` — we store that string and never open it.
 *
 * You are billed for the picture we keep, so downscaling never costs you more.
 */
export interface ImageInput {
  /** base64 of the image. A `data:image/...;base64,` prefix is accepted and stripped. */
  data: string;
  /** Where YOUR copy of the original lives. Stored as-is; the service never fetches it. */
  reference?: string;
  /**
   * When the image was TAKEN (RFC3339), if you know it — usually from EXIF.
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
   * Whether the MEMORY survives losing its image.
   *
   * A captioned image keeps its text and only loses the image. An image stored with no
   * caption IS the memory, so deleting the image deletes the memory — and the service
   * says so here rather than silently taking more than you asked for. Call with
   * `preview: true` first if that distinction matters to you.
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
  /** Every memory in the store. Internal records nobody stored directly are not counted. */
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
  /** How many underlying records a delete would actually remove, beyond what was returned. */
  chunks?: number;
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

/** `searchFull` → everything one search answered with, not just the merged memories.
 *
 *  `search` returns the memories and nothing else, which is the right answer for
 *  almost every call. Two options make it the wrong one: `max_images` asks for
 *  photos, which arrive in their own field, and `verify` is reported on by
 *  `verify_used`. Merging away both means paying for a
 *  search you shaped and never seeing what came of it. */
export interface SearchResult {
  /** What others said, and general memories. */
  memories: Memory[];
  /** The assistant's own words (speaker "me"); `[]` on a model that does not keep
   *  them apart. */
  self_memories: Memory[];
  /** Image memories, when `max_images` asked for any; `[]` otherwise. */
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

export interface HistoryTurn {
  user_msg?: string;
  assistant_msg?: string;
  timestamp?: string;
  [key: string]: unknown;
}

/** `usage` → what this key has spent, and what is left to spend. */
export interface UsageResult {
  window_days?: number;
  /** This API key's LIFETIME spend. Never another key's. */
  key?: { requests?: number; cost_cents?: number; input_tokens?: number; output_tokens?: number; since?: string };
  /** The workspace this key belongs to, over the window. */
  workspace?: { workspace_id?: string | null; requests?: number; cost_cents?: number };
  /** Per-store spend over the window, busiest first, and at most 50 rows — a longer
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
  /** Pass back as `cursor` for the next page; `null` on the last page. */
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

export interface ModelInfo {
  id: string;
  name: string;
  available: boolean;
  /** "shared" — reads the common memory pool; "isolated" — its own dedicated store. */
  memory: "shared" | "isolated";
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
}

/** `createStore` / `deleteStore` → `{ user_id, status }`. */
export interface StoreOpResult {
  /** The store id the API actually used — NOT necessarily the one you sent.
   *  Ids are normalized (see the `note`), so compare this against your input. */
  user_id?: string;
  status?: string;
  /** Present when the API changed your id, explaining how. Read it: two of your
   *  end users can land in one store if their ids differ only by punctuation. */
  note?: string;
  [key: string]: unknown;
}

export interface StoreInfo {
  user_id: string;
  created_at: string;
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
 */
export interface SearchFilters {
  /** Only these categories (the `category` you see on `listMemories` results). */
  categories?: string[];
  /** Ingestion-time window, as the API stores it. Plain strings, matched as given. */
  time_from?: string;
  time_to?: string;
  /** WHEN THE CONTENT HAPPENED (`metadata.event_date`), not when it was written —
   *  this is the one you usually want. RFC3339, or a plain `YYYY-MM-DD`. */
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
function warnOnUnknownFilters(filters: unknown): void {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return;
  for (const k of Object.keys(filters)) {
    if (KNOWN_FILTER_KEYS.has(k) || warnedFilterKeys.has(k)) continue;
    warnedFilterKeys.add(k);
    // 2.2.27 capped the store-id warn set and left this sibling unbounded. An app that
    // forwards user-supplied filter keys grows it forever, one entry per distinct typo.
    while (warnedFilterKeys.size > WARNED_FILTER_KEYS_MAX) {
      const oldest = warnedFilterKeys.values().next().value;
      if (oldest === undefined) break;
      warnedFilterKeys.delete(oldest);
    }
    console.warn(
      `wontopos: unknown search filter ${JSON.stringify(k)} — the API drops keys it does not know, ` +
        `so this filter has NO effect and the search is wider than you think. ` +
        `Known keys: ${[...KNOWN_FILTER_KEYS].join(", ")}.`,
    );
  }
}
/** Test hook — the warn-once set is process-global by design. */
export function _resetFilterWarnings(): void {
  warnedFilterKeys.clear();
}

/** Known `search` options; extra fields pass through to the API untouched. */
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
   * Requires a re-ask-capable model. Older ones REFUSE the call (403) rather than
   * quietly charging you for passes that never happened.
   */
  verify?: number;
  /**
   * How many image memories the answer may carry, 0–5. Default 1; 0 asks for none.
   * Out of range is refused, not clamped — silently cutting 5 to 1 would leave you
   * believing you got five.
   *
   * Requires an image-capable model, and is refused (403) on one without it rather
   * than answering with no images.
   */
  max_images?: number;
  [key: string]: unknown;
}

/**
 * Per-call options for a write.
 *
 * `idempotencyKey` makes repeating THIS EXACT write safe: the API replays the first
 * response instead of storing again, for 10 minutes, and answers 422 if the same key
 * arrives with a different body. Use it when a retry is your own (a job that died and
 * was re-run, a queue that redelivers). The SDK retries a write on exactly one
 * status: 429, which the service answers before it processes anything, so nothing
 * was stored. It never retries a write on 502 / 503 or a dropped body, where the
 * request may already have been stored and billed — without a key it cannot know
 * whether that first attempt landed.
 *
 * The key must be UNIQUE PER LOGICAL WRITE — derive it from the thing being stored
 * (`` `import:${row.id}` ``), never a constant, or the second write replays the first
 * and is silently lost. Format: 1-128 chars of `[A-Za-z0-9._:-]`, checked locally.
 *
 * The window is in-memory on the API, so a deploy or restart clears it early. It is a
 * guard against a retry storm, not a durable ledger.
 */
export interface WriteOptions {
  idempotencyKey?: string;
  /**
   * An image to store alongside the text (Tablet 2 and newer).
   *
   * `content` may be empty when you pass one — then the image IS the memory and is
   * searchable on its own. Older models have no image channel and will reject the
   * write rather than store the caption and quietly drop the image.
   */
  image?: ImageInput;
}

export interface ClientOptions {
  apiKey: string;
  /** API base URL (defaults to the hosted service). */
  baseUrl?: string;
  /** Per-request timeout in ms, applied to each retry attempt (default 30000). */
  timeoutMs?: number;
  /** Default model for every call (sent as `X-WOS-Model`). See `listModels()`. */
  model?: string;
  /** Default store for every call. Override per call by passing `userId`. Defaults
   * to the account's built-in `default` store. */
  userId?: string;
  /** How many times to retry transient failures before throwing — 429 always;
   * 502/503 and connection errors only when a retry can never double-process a
   * write. 0 disables retries (default 2). */
  maxRetries?: number;
  /** Alias of `maxRetries`. The Python SDK calls this option `retries`, and these
   *  SDKs are published in lockstep as "the same surface" — so code ported between
   *  them silently lost its retry setting instead of failing loudly (an unknown
   *  key on an options object is not an error in TS at runtime). Both names work;
   *  `maxRetries` wins if somehow both are given. */
  retries?: number;
  /** A total budget for one call, in ms, across every attempt.
   *
   *  `timeoutMs` bounds ONE attempt. At the defaults — 30s, two retries — a single
   *  call can hold a connection for 30s + backoff + 30s + backoff + 30s, over a
   *  minute, and a server handler awaiting it has no way to say "I only have five
   *  seconds". This is that way. Unset means no overall budget. */
  deadlineMs?: number;
  /** The caller's `AbortSignal` — cancel work already in flight.
   *
   *  The SDK aborts on its own timeout; this is the seam for the caller's reason.
   *  When someone closes the chat window, the recall that window asked for should
   *  end, and the backoff sleep waiting to retry it should end too, instead of
   *  running to completion and billing for an answer nobody will read.
   *
   *  Per call, clone: `mem.withSignal(ctrl.signal).recall(...)`. */
  signal?: AbortSignal;
  /** The `fetch` used for every request (default: the global `fetch`).
   *
   *  This is the seam for anything the runtime cannot express through options.
   *  The one that matters in practice is a corporate egress proxy: Node's global
   *  fetch (undici) IGNORES `HTTP_PROXY` / `HTTPS_PROXY`, so behind such a proxy
   *  this SDK could not connect at all — while the Python and Rust SDKs went
   *  through, because `requests` and `reqwest` both read those variables. Pass a
   *  proxy-aware fetch and the three behave the same again:
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
   *  apply — this replaces the transport, not the client's rules. */
  fetch?: typeof fetch;
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
  private readonly signal?: AbortSignal;
  /** Transport. Held as a field (not read off `globalThis` per call) so a caller
   * who passes one gets it for every request, including from cloned clients. */
  private readonly fetchImpl: typeof fetch;
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
    // deep inside fetch as the mystery 401 this check exists to prevent. Python has
    // `_HEADER_CTL_RE` and Rust tests `is_control`; this was the client that did not,
    // while all three READMEs announced the guard without naming a language.
    if (/[\x00-\x1f\x7f]/.test(key))
      throw new Error("apiKey contains a control character - check for a stray byte or paste error");
    this.apiKey = key;
    this.base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    // Coerce a non-finite or non-positive timeout back to the default — NaN
    // (e.g. Number() of an unset env var) would otherwise make the abort timer
    // fire immediately and every request "time out after NaNms".
    const tm = opts.timeoutMs;
    this.timeoutMs = typeof tm === "number" && Number.isFinite(tm) && tm > 0 ? tm : 30_000;
    this.model = opts.model ?? DEFAULT_MODEL;
    if (this.model && !MODEL_RE.test(this.model)) {
      throw new Error(`invalid model name: ${JSON.stringify(this.model)} (letters, digits, '.', '_', '-' only)`);
    }
    this.defaultUser = opts.userId || DEFAULT_USER;
    // Coerce a non-finite maxRetries (NaN/Infinity) back to the default — otherwise
    // NaN makes `attempts = NaN + 1` and the loop runs zero requests then throws
    // "retries exhausted"; Infinity would retry forever.
    const mr = opts.maxRetries ?? opts.retries;
    this.maxRetries = typeof mr === "number" && Number.isFinite(mr) ? Math.max(0, Math.floor(mr)) : 2;
    const dl = opts.deadlineMs;
    // A zero or negative budget would fail every call before it starts — treat it as
    // "no budget", the same way a non-positive timeout falls back to the default.
    this.deadlineMs = typeof dl === "number" && Number.isFinite(dl) && dl > 0 ? dl : undefined;
    this.signal = opts.signal;
    // Bind the global so `fetch` is not called as a method of `globalThis`, which
    // throws "Illegal invocation" on some runtimes. A caller-supplied fetch is
    // taken as given — it is already whatever they meant to hand us.
    const f = opts.fetch;
    if (f !== undefined && typeof f !== "function") {
      throw new Error("fetch must be a function (a fetch-compatible transport)");
    }
    this.fetchImpl = f ?? ((globalThis as any).fetch ? (globalThis as any).fetch.bind(globalThis) : undefined);
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
    // warning, not an error, so private-network gateways keep working.
    // Parse, don't split. `http://127.0.0.1:9@evil.example` splits to "127.0.0.1" — the
    // USERINFO, not the host — so this check called it loopback and stayed quiet while
    // the key travelled in cleartext to evil.example. `new URL()` knows the difference.
    // (Python already used urlsplit here; this was the copy that did not.)
    let host: string;
    try {
      // `URL.hostname` keeps the brackets on an IPv6 literal — `http://[::1]:8080`
      // gives back "[::1]", which was never in LOOPBACK_HOSTS, so a local
      // client on the v6 loopback was told its key was travelling in cleartext when
      // it was not. Python's urlsplit strips them and Rust strips them by hand; this
      // was the copy that did not. Strip them here so all three agree.
      host = new URL(this.base).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    } catch {
      host = ""; // unparseable → not loopback → warn, which is the safe direction
    }
    // Scheme compare is case-insensitive — `HTTP://` connects in plaintext too.
    if (/^http:\/\//i.test(this.base) && !LOOPBACK_HOSTS.has(host)) {
      console.warn(
        "wontopos: baseUrl uses plain HTTP on a non-local host, so the API key travels unencrypted. Use https://."
      );
    }

    // TypeScript `private` is erased at runtime: `apiKey` is an ordinary enumerable
    // property, so `{...client}` copies it and `JSON.stringify({...client})` prints the
    // key in full. The existing masking covers `JSON.stringify(client)` and
    // `util.inspect(client)` — but spreading an object into a log record is the common
    // shape in structured logging, and it went straight past both. Make the key and the
    // prepared auth header non-enumerable so a spread cannot pick them up; they stay
    // readable inside the class, which is all the code needs.
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

  /** Never expose the key: `JSON.stringify(client)` gets the redacted view. */
  toJSON(): Record<string, string> {
    return { baseUrl: this.base, model: this.model, userId: this.defaultUser, apiKey: maskKey(this.apiKey) };
  }

  /** Never expose the key: Node's `console.log(client)` gets the redacted view. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Client(${this.base}, model=${this.model}, userId=${this.defaultUser}, apiKey=${maskKey(this.apiKey)})`;
  }

  /** Resolve a call's store: the explicit userId, else the client default. */
  private uid(userId?: string): string {
    // An OMITTED id means "use the client's default" — that is the documented shortcut.
    // An id that was PASSED but is blank is a different thing: the caller computed a
    // tenant id and got nothing. Falling back there writes one customer's memories into
    // whatever store this client defaults to, silently. Omission is a choice; a blank
    // string is a bug, and it should say so where it happened.
    //
    // The check is `typeof !== "string"`, not `!String(userId).trim()`. The old form
    // only caught a blank STRING, and the value a failed lookup actually produces in
    // JavaScript is `null` — `String(null)` is the truthy "null", so it sailed through
    // the guard and then `null || default` sent the write to the client's default
    // store. `0` (an integer primary key) did the same. Both are the exact outcome the
    // guard was written to stop, and both were still silent.
    //
    // `undefined` alone means "omitted", because that is what an absent argument is.
    if (userId !== undefined && (typeof userId !== "string" || !userId.trim())) {
      throw new Error(
        `userId must be a non-blank string; got ${JSON.stringify(userId)}. Omit it to use the client's ` +
          "default store, or pass a real store id — anything else would silently write into the default store.",
      );
    }
    const id = userId || this.defaultUser;
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
      // Carry the transport across clones. Without this, `withModel(...)` and
      // friends would silently fall back to the global fetch and a proxy-bound
      // client would stop connecting the moment it was cloned.
      fetch: this.fetchImpl,
      // Carried for the same reason as `fetch` above: a clone that quietly dropped
      // the caller's signal would keep working right up until the moment someone
      // needed to cancel it.
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
    return this.clone({ userId });
  }

  /** A client bound to a caller's `AbortSignal` (everything else kept).
   *
   *     const ctrl = new AbortController();
   *     req.on("close", () => ctrl.abort());
   *     const r = await mem.withSignal(ctrl.signal).recall(q, user);
   *
   * Aborting ends the request in flight AND any backoff sleep waiting to retry it. */
  withSignal(signal: AbortSignal): Client {
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
  /** Store one memory. `metadata` optional — e.g. `{ event_date: "2026-03-01" }` for when the
   * content actually happened. A plain date works (read as UTC midnight); a full RFC3339
   * timestamp also works; older examples here show the long form.
   * `metadata.speaker`: "me" = the assistant's own words, or a person's name (up to 50 per store).
   *
   * `opts.idempotencyKey`: see {@link WriteOptions} — pass one to make YOUR retry
   * of this exact write safe to repeat. */
  add(content: string, userId?: string, metadata: Record<string, unknown> = {}, opts: WriteOptions = {}): Promise<StoreResult> {
    const body: Record<string, unknown> = { user_id: this.uid(userId), content, metadata };
    if (opts.image !== undefined) body.image = normalizeImage(opts.image);
    return this.post("/api/v1/memory/store", body, opts.idempotencyKey);
  }
  /** Alias of `add` — store one memory. Same surface as the Python SDK's `store`. */
  store(content: string, userId?: string, metadata: Record<string, unknown> = {}, opts: WriteOptions = {}): Promise<StoreResult> {
    return this.add(content, userId, metadata, opts);
  }
  /** Store a conversation turn (user + assistant). Payload first, userId last — same shape as add/search. */
  addTurn(userMsg: string, assistantMsg: string, userId?: string, opts: WriteOptions = {}): Promise<StatusResult> {
    return this.post(
      "/api/v1/memory/store-turn",
      { user_id: this.uid(userId), user_msg: userMsg, assistant_msg: assistantMsg },
      opts.idempotencyKey,
    );
  }
  /** Bulk-ingest a large blob of text in one call. For backfilling.
   *  The call most worth an `opts.idempotencyKey`: a backfill that dies halfway and is
   *  re-run would otherwise re-ingest and re-bill the whole blob. */
  addBulk(content: string, userId?: string, category = "general", timestamp?: string, opts: WriteOptions = {}): Promise<StatusResult> {
    const body: Record<string, unknown> = { user_id: this.uid(userId), content, category };
    if (timestamp) body.timestamp = timestamp;
    return this.post("/api/v1/memory/bulk-store", body, opts.idempotencyKey);
  }
  /** Supersede an old memory with new content. Payload first, userId last — same shape as add/search. */
  update(oldMemoryId: string, newContent: string, userId?: string, opts: WriteOptions = {}): Promise<UpdateResult> {
    return this.post(
      "/api/v1/memory/supersede",
      { user_id: this.uid(userId), old_memory_id: oldMemoryId, new_content: newContent },
      opts.idempotencyKey,
    );
  }

  // ----- read -----
  /** Search a store's memories. Returns them most relevant first.
   *
   *  `limit` bounds `memories`, not the returned array. On a model that keeps the
   *  assistant's own words separate (Scroll 1.2+) those come back as well, so the
   *  array can hold more than `limit`. They were retrieved and billed either way;
   *  dropping them would only hide what you already paid for. Size a prompt window
   *  on the array you get back, not on `limit`. `searchSelf()` hands the two back
   *  apart. */
  async search(query: string, userId?: string, limit = 10, opts: SearchOptions = {}): Promise<Memory[]> {
    // Reserved fields win over ...opts: an app that forwards untrusted input as
    // opts must not be able to override the store (user_id), query, or limit.
    warnOnUnknownFilters(opts.filters);
    checkCount(limit, "limit");
    const r = await this.post("/api/v1/memory/search", { ...opts, user_id: this.uid(userId), query, max_results: limit });
    return mergeResults(r);
  }
  /** Search a self-memory model (Scroll 1.2+): both fields from ONE call. Returns
   * `{ memories, self_memories }` — `memories` is what others said and general
   * memories, `self_memories` is the assistant's OWN words (stored with speaker
   * "me"), kept apart so whoever reads them never confuses who said what. On a model
   * that does not keep them apart, `self_memories` is `[]`. `userId` may be omitted. */
  async searchSelf(query: string, userId?: string, limit = 10, opts: SearchOptions = {}): Promise<SelfSearchResult> {
    warnOnUnknownFilters(opts.filters);
    checkCount(limit, "limit");
    const r = await this.post("/api/v1/memory/search", { ...opts, user_id: this.uid(userId), query, max_results: limit });
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
   *     r.images.length;   // the photos, which `search` drops
   *     r.verify_used;     // how many re-ask passes actually ran (you are billed per pass)
   *
   * Both options need Tablet 2 or newer and are refused (403) on an older engine
   * rather than accepted and ignored.
   */
  async searchFull(query: string, userId?: string, limit = 10, opts: SearchOptions = {}): Promise<SearchResult> {
    warnOnUnknownFilters(opts.filters);
    checkCount(limit, "limit");
    const r = await this.post("/api/v1/memory/search", { ...opts, user_id: this.uid(userId), query, max_results: limit });
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
   * `form` ("memoir"/"archive", Scroll 1.2+) renders each long-term memory's time in
   * that form; `tz` is your UTC-offset hours for that rendering. */
  // `async` so an argument mistake arrives the way every other failure does — a
  // rejected promise. Validating inside a non-async method threw synchronously, so
  // `mem.recall(...).catch(h)` walked straight past the handler while the identical
  // mistake in `search` (which is async) landed in it. Two shapes for one error.
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
       * Needs a limit-aware model. An older one recalls a fixed ten no matter what you
       * send, so the API refuses the call (403) rather than answering with a number you
       * did not ask for.
       */
      limit?: number;
      /** How much surrounding context is attached around the best match, 0–20. Default 10;
       *  0 attaches none. Same model floor as `limit`. */
      context_limit?: number;
    } = {},
  ): Promise<RecallResult> {
    const body: Record<string, unknown> = { user_id: this.uid(userId), query };
    if (opts.limit !== undefined) {
      checkCount(opts.limit, "limit");
      body.limit = opts.limit;
    }
    if (opts.context_limit !== undefined) {
      checkContextLimit(opts.context_limit);
      body.context_limit = opts.context_limit;
    }
    return this.post("/api/v1/memory/recall", withForm(body, opts.form, opts.tz));
  }
  /** Run a built-in engram ("deep_recall" | "timeline" | "gather" | "equilibrium" |
   * "tone_stabilizer"; the service is the authority — an unknown name comes back with
   * the list it accepts). Returns the merged result.
   * `form`/`tz` render memory times (memoir/archive) on Scroll 1.2+, same as search/recall. */
  engram(name: string, query: string, userId?: string, opts: { form?: string; tz?: number } = {}): Promise<EngramResult> {
    return this.post("/api/v1/engram/run", withForm({ name, user_id: this.uid(userId), query }, opts.form, opts.tz));
  }
  /** Recent conversation turns (short-term memory). */
  async history(userId?: string): Promise<HistoryTurn[]> {
    const r = await this.post("/api/v1/memory/history", { user_id: this.uid(userId) });
    return asRecords<HistoryTurn>(r.turns);
  }
  /** Memory counts for a store: { total_memories, short_term_turns }. */
  stats(userId?: string): Promise<StatsResult> {
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
   * `listMemories`: an id from another store, an internal record id, or an
   * invalidated memory rejects with `NotFoundError`. Pass `undefined` as `userId` for
   * the default store — it is positional here, not omittable as it is in Python. */
  get(userId: string | undefined, memoryId: string): Promise<Memory> {
    // Sync throw (same shape as `delete`), so a missing id fails loudly even
    // when the caller forgets to await.
    if (!memoryId || typeof memoryId !== "string") {
      throw new Error("memoryId is required — the id that add/store or listMemories returned.");
    }
    return this.post("/api/v1/memory/get", { user_id: this.uid(userId), memory_id: memoryId }).then(
      (r) => asObj<Memory>(r.memory)
    );
  }
  /** List a store's stored memories — the text you stored, plus its metadata.
   * Paginated: pass the returned `next_cursor` back as `cursor` for the next
   * page; a `null` cursor means the last page. Use it to browse or export a store.
   *
   *     let cursor: string | null = null;
   *     const all: Memory[] = [];
   *     do {
   *       const page = await mem.listMemories(undefined, { cursor: cursor ?? undefined });
   *       all.push(...page.memories);
   *       cursor = page.next_cursor;
   *     } while (cursor);
   */
  listMemories(userId?: string, opts: { limit?: number; cursor?: string } = {}): Promise<MemoryPage> {
    const body: Record<string, unknown> = { user_id: this.uid(userId), limit: opts.limit ?? 100 };
    if (opts.cursor) body.cursor = opts.cursor;
    return this.post("/api/v1/memory/list", body);
  }
  /** Async-iterate every stored memory in a store, paging under the hood — no cursor
   * bookkeeping. The text you stored and its metadata only.
   *
   *     for await (const m of mem.iterMemories()) console.log(m.id, m.content);
   */
  async *iterMemories(userId?: string, opts: { pageSize?: number } = {}): AsyncGenerator<Memory> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    // Backstop: the cursor-repeat guard catches a repeated cursor, but not a
    // server that mints a FRESH cursor every page forever — bound the walk.
    for (let page = 0; page < MAX_PAGES; page++) {
      const p = await this.listMemories(userId, { limit: opts.pageSize ?? 100, cursor });
      for (const m of asRecords<Memory>(p.memories)) yield m;
      const next = p.next_cursor ?? undefined;
      if (!next || seen.has(next)) return;
      seen.add(next);
      cursor = next;
    }
    throw new Error(
      `stopped after ${MAX_PAGES} pages — the store did not end. This is a truncated ` +
        `answer, not the whole store.`
    );
  }
  /** Collect ALL of a store's memories into an array (the text you stored, and its metadata). */
  async exportMemories(userId?: string): Promise<Memory[]> {
    const out: Memory[] = [];
    for await (const m of this.iterMemories(userId)) out.push(m);
    return out;
  }
  // ----- images (Tablet 2 and newer) -----

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
   * When the format changed, the response also carries `x-wos-image-converted-from`
   * naming what you uploaded. Rejects with `NotFoundError` when this memory has no
   * image, or when the service keeps no image bytes at all — it says "no" instead of
   * handing back something empty, so "a memory with no image" never looks the same as
   * "an image we lost".
   *
   *     const { bytes, contentType } = await mem.getImage(undefined, id);
   *     const ext = contentType.split("/")[1];   // "webp" for a downscaled PNG
   *     await fs.writeFile(`image.${ext}`, bytes);
   */
  getImage(userId: string | undefined, memoryId: string): Promise<ImageBytes> {
    if (!memoryId || typeof memoryId !== "string") {
      throw new Error("memoryId is required — the id that add/store or listImages returned.");
    }
    return this.requestBytes("/api/v1/memory/image", { user_id: this.uid(userId), memory_id: memoryId });
  }

  /**
   * Remove the PHOTO from a memory, keeping its text.
   *
   * Except when there is no text: an image stored without a caption *is* the memory, so
   * deleting the image deletes it. That is the one case worth checking before you
   * commit, which is what `preview` is for — it reports `memory_kept` and changes
   * nothing.
   *
   *     const p = await mem.forgetImage(undefined, id, { preview: true });
   *     if (p.memory_kept === false) { /* this would delete the whole memory *\/ }
   */
  forgetImage(
    userId: string | undefined,
    memoryId: string,
    opts: { preview?: boolean } = {},
  ): Promise<ImageDeleteResult> {
    if (!memoryId || typeof memoryId !== "string") {
      throw new Error("memoryId is required — the id of the memory whose image you want removed.");
    }
    const body: Record<string, unknown> = { user_id: this.uid(userId), memory_id: memoryId };
    if (opts.preview) body.preview = true;
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
   */
  listImages(
    userId?: string,
    opts: { limit?: number; before?: string; skipIds?: string[] } = {},
  ): Promise<ImagePage> {
    const body: Record<string, unknown> = { user_id: this.uid(userId) };
    if (opts.limit !== undefined) body.limit = opts.limit;
    if (opts.before !== undefined) body.before = opts.before;
    if (opts.skipIds !== undefined) body.skip_ids = opts.skipIds;
    return this.post("/api/v1/memory/images", body);
  }

  /** Async-iterate every image memory, paging under the hood. */
  async *iterImages(userId?: string, opts: { pageSize?: number } = {}): AsyncGenerator<Memory> {
    let before: string | undefined;
    let skipIds: string[] | undefined;
    // Same repeat-cursor guard as `iterMemories`. A server that hands back the
    // cursor it was just given would otherwise re-yield one page MAX_PAGES times,
    // and the caller reads those repeats as more images. The page cap alone bounds
    // the walk; it does not stop the duplicates.
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const p = await this.listImages(userId, { limit: opts.pageSize, before, skipIds });
      for (const m of asRecords<Memory>(p.images)) yield m;
      // `return`, not `break`: the throw below is the MAX_PAGES backstop, and a
      // `break` fell straight into it — so the ordinary end of a walk raised
      // "the store did not end" on a store that had just ended. Python is safe
      // here by using for/else and Rust by carrying an `ended` flag; TypeScript
      // has neither, so the exit has to leave the function outright.
      if (!p.has_more || !p.next_before) return;
      // The cursor is the PAIR: several images can share a timestamp, so `before`
      // alone repeats across pages legitimately.
      const key = `${p.next_before}|${(Array.isArray(p.next_skip_ids) ? p.next_skip_ids : []).join(",")}`;
      if (seen.has(key)) return;
      seen.add(key);
      before = p.next_before;
      skipIds = Array.isArray(p.next_skip_ids) ? p.next_skip_ids : undefined;
    }
    throw new Error(
      `stopped after ${MAX_PAGES} pages — the store did not end. This is a truncated ` +
        `answer, not the whole store.`
    );
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
   * Deletions are NOT counted: a deleted memory leaves nothing to count. Neither are
   * the internal records derived from what you stored — nobody stored those directly,
   * so they do not belong in a ratio that answers "how much of MY memory changed".
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
   * Served from `/api/v1/won/*`, not `/api/v1/memory/*`. Won is the surface for calls
   * a model makes ABOUT its memory rather than calls an application makes WITH it, and
   * the address says so. The old path still answers, for clients published before
   * 2026-08-18, and both share one rate-limit budget.
   */
  revisions(
    userId?: string,
    opts: {
      /**
       * Omit for counts only. Set it to ALSO get one page of the memories behind that
       * number. One side per call — there is no way to ask for both lists at once.
       */
      include?: "revised" | "unrevised";
      /** Memories per page. 20 is both the default and the ceiling; more is rejected. */
      limit?: number;
      /** Cursor: `next_before` from the previous page. */
      before?: string;
      /** Cursor: `next_skip_ids` from the previous page. Hand back what you were given. */
      skipIds?: string[];
    } = {},
  ): Promise<RevisionsResult> {
    const body: Record<string, unknown> = {};
    if (opts.include !== undefined) body.include = opts.include;
    if (opts.limit !== undefined) body.limit = opts.limit;
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
  lineage(userId: string | undefined, memoryId: string): Promise<LineageResult> {
    if (!memoryId || typeof memoryId !== "string") {
      throw new Error("memoryId is required — the memory whose history you want.");
    }
    return this.post("/api/v1/memory/lineage", { user_id: this.uid(userId), memory_id: memoryId });
  }

  /**
   * What one person said, newest first.
   *
   * `speaker` is the tag written at store time (`metadata.speaker`) — `"me"` for the
   * assistant's own words, otherwise a person's name. Same cursor paging as
   * `listImages`.
   *
   * `chunks` / `points_to_delete` report how many internal records a delete would
   * actually remove — usually more than `returned`, and worth showing to whoever is
   * about to confirm one.
   */
  bySpeaker(
    speaker: string,
    userId?: string,
    opts: { limit?: number; before?: string; skipIds?: string[] } = {},
  ): Promise<SpeakerPage> {
    if (!speaker || typeof speaker !== "string" || speaker.trim() === "") {
      throw new Error('speaker is required — "me" for the assistant, or a person\'s name.');
    }
    const body: Record<string, unknown> = { user_id: this.uid(userId), speaker: speaker.trim() };
    if (opts.limit !== undefined) body.limit = opts.limit;
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
  /** Available models: `[{ id, name, available, memory }, ...]`. Needs no API key. */
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
   * service is the authority. What
   * comes back depends on the model (delivery forms need Scroll 1.2+), so pass
   * `withModel()` if you want another model's catalogue.
   *
   *   const { engrams, forms } = await mem.listEngrams();
   */
  async listEngrams(): Promise<EngramCatalog> {
    const data = await this.request("GET", "/api/v1/engram");
    return {
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
  createStore(userId?: string): Promise<StoreOpResult> {
    return this.post("/api/v1/memory/collection", { user_id: this.uid(userId) });
  }
  /** List your stores: `[{ user_id, created_at }, ...]` (`default` first). */
  async listStores(): Promise<StoreInfo[]> {
    const r = await this.request("GET", "/api/v1/memory/collections");
    return asRecords<StoreInfo>(r.collections);
  }
  /** Delete a store and ALL its memories. Returns `{ user_id, status }`. */
  deleteStore(userId: string): Promise<StoreOpResult> {
    // Validate before warning. The warning helper lowercases the id, so a non-string
    // reaches it and dies as "id.toLowerCase is not a function" — a TypeError from
    // inside the SDK instead of a sentence about the id.
    if (typeof userId !== "string" || !userId.trim()) throw new Error("userId is required (a non-blank string) — deleteStore never falls back to the default store.");
    warnIfStoreIdCollapses(userId); // destructive: the collision warning belongs here too
    return this.request("DELETE", "/api/v1/memory/collection", { user_id: userId });
  }

  // ----- speakers (who said it) -----

  /** Register a person for this store. Speakers are explicit: register once, then
   * store with `{ speaker }`. `"me"` (the assistant itself) never needs
   * registration. A store registers up to 50 people to start. */
  addSpeaker(speaker: string, userId?: string): Promise<SpeakerOpResult> {
    return this.post("/api/v1/memory/speakers", { user_id: this.uid(userId), speaker });
  }
  /** The store's registered people, each with its memory count. */
  async listSpeakers(userId?: string): Promise<SpeakersList> {
    const r = await this.request("GET", `/api/v1/memory/speakers?user_id=${encodeURIComponent(this.uid(userId))}`);
    // The spread came second, so a present-but-null `speakers` overwrote the default
    // and the caller got null typed as an array. Every other list route goes through
    // asRecords; this one did not.
    return { ...r, speakers: asRecords(r?.speakers) } as SpeakersList;
  }
  /** Unregister a person. Their memories stay; the name tag goes. */
  removeSpeaker(speaker: string, userId?: string): Promise<SpeakerOpResult> {
    return this.request("DELETE", "/api/v1/memory/speakers", { user_id: this.uid(userId), speaker });
  }

  // ----- delete -----
  /** Delete a single memory by id. Pass `undefined` as `userId` for the default
   *  store — it is positional here, not omittable as it is in Python. */
  delete(userId: string | undefined, memoryId: string): Promise<StatusResult> {
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
  deleteAll(userId: string): Promise<StatusResult> {
    if (typeof userId !== "string" || !userId.trim()) throw new Error("userId is required (a non-blank string) for deleteAll — anything else would wipe the default store.");
    // These two take the store id directly instead of going through uid(), so the
    // collision warning — the one that says `Alice.Smith` and `alice_smith` are ONE
    // store — never fired on the two calls that DESTROY data. Erasing the wrong
    // tenant's memories is exactly the outcome that warning exists to prevent.
    warnIfStoreIdCollapses(userId);
    return this.post("/api/v1/memory/forget", { user_id: userId });
  }

  // ----- internal -----
  private post(path: string, body: unknown, idempotencyKey?: string): Promise<any> {
    return this.request("POST", path, body, idempotencyKey);
  }

  /**
   * One request that answers with BYTES rather than JSON.
   *
   * Only `/memory/image` does this, and it is why this cannot go through `request()`:
   * that path reads the body as text and insists the result parses to a JSON object.
   * Feeding it a JPEG would throw "invalid JSON in response" — a confusing error for a
   * call that actually succeeded.
   *
   * Errors still arrive as JSON, so those are handed back to the normal machinery: on
   * a non-2xx we re-read the body as text and reuse `errorFor`, which keeps 404
   * (`NotFoundError`) and 401 behaving the same as everywhere else.
   */
  /** Where this call's budget runs out, or `undefined` when it has none. Computed
   *  once per call, not per attempt — a budget recomputed each attempt is not a
   *  budget. */
  private deadlineAt(): number | undefined {
    return this.deadlineMs === undefined ? undefined : Date.now() + this.deadlineMs;
  }

  /** The abort wiring for ONE attempt: this SDK's per-attempt timeout, the caller's
   *  signal, and whatever is left of the overall deadline — whichever fires first.
   *
   *  One function, two callers (`request` and `requestBytes`), because a guard living
   *  in one of two request paths is exactly how `getImage` ended up with no retry loop
   *  while the module doc promised every call had one. */
  private beginAttempt(deadlineAt?: number): {
    signal: AbortSignal;
    clear: () => void;
    why: () => "timeout" | "deadline" | "caller";
  } {
    let why: "timeout" | "deadline" | "caller" = "timeout";
    let budget = this.timeoutMs;
    if (deadlineAt !== undefined) {
      const left = deadlineAt - Date.now();
      // Refuse rather than open a socket there is no time to use. Python's
      // `_attempt_budget` and Rust's `attempt_budget` have raised here from the start.
      // This path instead clamped the budget to 0 and began the attempt anyway, which
      // left `setTimeout(…, 0)` — it fires on the next timer phase — racing a fetch
      // that a fast server answers first. The same call then sometimes reported its
      // deadline and sometimes returned a result: one run in three, measured.
      if (left <= 0) throw new APIConnectionError(0, this.abortMessage("deadline"));
      if (left < budget) {
        budget = left;
        why = "deadline";
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), budget);
    const outer = this.signal;
    const onCaller = () => {
      why = "caller";
      ctrl.abort();
    };
    if (outer) {
      if (outer.aborted) onCaller();
      // Removed in clear(). `{ once: true }` would not be enough: one long-lived
      // signal per user session would still collect one listener per request until
      // the session ended.
      else outer.addEventListener("abort", onCaller);
    }
    return {
      signal: ctrl.signal,
      clear: () => {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onCaller);
      },
      why: () => why,
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

  /** Sleep between attempts — but wake the moment the caller aborts, and give up
   *  rather than wait out a backoff the budget cannot cover. A backoff that runs to
   *  completion after the caller gave up wastes exactly as long as the request it was
   *  waiting to repeat.
   *
   *  Clamping the wait to what is left and retrying anyway is the same answer as
   *  having no deadline at all: the call still spends the whole allowance, and the one
   *  attempt it buys has nothing left to finish in. If the wait does not fit, the
   *  budget is already decided. */
  private async backoffSleep(ms: number, deadlineAt?: number): Promise<void> {
    if (deadlineAt !== undefined && ms > deadlineAt - Date.now()) {
      throw new APIConnectionError(0, this.abortMessage("deadline"));
    }
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

  private async requestBytes(path: string, body: unknown): Promise<ImageBytes> {
    // This route had no retry loop at all, while the module doc promised "every call
    // retries transient failures … 429 always". Measured with maxRetries: 4 against a
    // server answering 429 — stats() made five requests, getImage() made one. The
    // largest and most rate-limit-prone call in the SDK was the one that gave up
    // immediately. The loop lives inside the function because honouring `Retry-After`
    // means still holding the response.
    const attempts = this.maxRetries + 1;
    const deadlineAt = this.deadlineAt();
    for (let attempt = 0; ; attempt++) {
    const att = this.beginAttempt(deadlineAt);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
        signal: att.signal,
        redirect: "manual",
      });
    } catch (e: any) {
      att.clear();
      const timedOut = e?.name === "AbortError" || att.signal.aborted;
      // Same rule as `request()`: a connect-level failure never reached the server,
      // so re-sending cannot double-process anything. The 429 loop below was added
      // in 2.2.35 and this branch was not, which left the module doc's promise —
      // "every call retries transient failures" — still false for `getImage` on
      // exactly the failure a retry is for. A timeout is ambiguous and stays final.
      if (!timedOut && isConnectFailure(e) && attempt + 1 < attempts) {
        await this.backoffSleep(this.backoffMs(attempt), deadlineAt);
        continue;
      }
      throw new APIConnectionError(0, timedOut ? this.abortMessage(att.why()) : `network error: ${e?.message ?? e}`);
    }
    try {
      this._rateLimit = parseRateLimit(res.headers) ?? this._rateLimit;
      if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
        void res.body?.cancel();
        throw errorFor(res.status, "the API answered with a redirect; refusing to follow it");
      }
      if (!res.ok) {
        if (RETRY_ALWAYS.has(res.status) && attempt + 1 < attempts) {
          const retryAfter = res.headers.get("Retry-After");
          void res.body?.cancel();
          att.clear();
          await this.backoffSleep(this.backoffMs(attempt, retryAfter), deadlineAt);
          continue;
        }
        let msg = await this.readCapped(res).catch(() => "");
        try {
          const data = JSON.parse(msg);
          const err = (data as any)?.error;
          if (err && typeof err === "object") msg = err.message ?? err.type ?? msg;
          else if (typeof err === "string") msg = err;
        } catch {
          /* keep raw text */
        }
        if (msg.length > MAX_ERR_MSG) msg = msg.slice(0, MAX_ERR_MSG) + "…(truncated)";
        throw errorFor(res.status, msg || `HTTP ${res.status}`);
      }
      // Translated, not raw. A timeout that fires while the body is streaming used to
      // escape as `AbortError` — not a WosError, not an APIConnectionError — so a
      // caller's `catch (e) { if (e instanceof WosError) … }` handled every JSON route
      // and let this one through unclassified. The JSON path already translated it.
      let buf: Uint8Array;
      try {
        buf = await this.readCappedBytes(res);
      } catch (e: any) {
        if (e?.name === "AbortError" || att.signal.aborted) {
          // ★Say WHICH abort. `ctrl` could only ever be aborted by the per-attempt
          //  timer, so a fixed "timed out" was true when this line read `ctrl`. It
          //  now reads `att`, which also fires for the caller's AbortSignal and for
          //  an exhausted deadline — and this branch kept reporting both as a 30s
          //  timeout the caller never set. Two sibling sites were moved to
          //  abortMessage and these two were not; the tests abort before the fetch
          //  resolves, so they only ever reached the sites that were fixed.
          throw new APIConnectionError(0, this.abortMessage(att.why()));
        }
        throw e;
      }
      if (buf.byteLength === 0) {
        // An empty 200 would otherwise read as "here is your image" and write a
        // zero-byte file — indistinguishable from an image we lost.
        throw new WosError(res.status, "empty image body — the service returned no bytes");
      }
      return { bytes: buf, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
    } finally {
      att.clear();
    }
    }
  }

  /** Validate an idempotency key BEFORE the network. The API answers a malformed
   *  key with a 400, which on a retry path reads as "my write failed" when in fact
   *  it was never attempted — cheaper and clearer to reject it here. */
  private idemHeader(key?: string): Record<string, string> | undefined {
    // `=== undefined` let `null` through: RegExp.test stringifies its argument, so
    // `null` became the literal key "null" and passed the format check. A key read
    // from JSON or a database row arrives as null, not undefined, and every write on
    // that path then shared one key — the second onward returned the first response
    // and stored nothing. Python guards with `is None`; Rust's Option makes it
    // unrepresentable.
    if (key === undefined || key === null) return undefined;
    if (!IDEMPOTENCY_KEY_RE.test(key)) {
      throw new Error(
        `invalid idempotencyKey: ${JSON.stringify(key)} — 1-128 chars of [A-Za-z0-9._:-]`,
      );
    }
    return { "Idempotency-Key": key };
  }

  /** Seconds→ms to sleep before retry `attempt` (0-based). Honors Retry-After. */
  private backoffMs(attempt: number, retryAfter?: string | null): number {
    if (retryAfter) {
      const s = Number(retryAfter);
      if (Number.isFinite(s) && s >= 0) return Math.min(30_000, s * 1000);
      // HTTP-date form (RFC 9110), e.g. "Wed, 21 Oct 2015 07:28:00 GMT".
      const t = Date.parse(retryAfter);
      if (Number.isFinite(t)) return Math.min(30_000, Math.max(0, t - Date.now()));
    }
    return Math.min(8_000, 500 * 2 ** attempt) + Math.random() * 250;
  }

  /** Read the body with a hard size cap, so a broken/hostile endpoint can't
   * make the process buffer gigabytes. */
  private async readCapped(res: Response): Promise<string> {
    return new TextDecoder().decode(await this.readCappedBytes(res));
  }

  /** The same cap, for a body that is not text.
   *
   * `arrayBuffer()` would buffer whatever arrives. The cap exists for a hostile or
   * broken `baseUrl`, and an endpoint that returns megabytes is where that costs the
   * most. One implementation, two callers, so they cannot drift. */
  private async readCappedBytes(res: Response): Promise<Uint8Array> {
    const cl = res.headers.get("content-length");
    if (cl && Number(cl) > MAX_RESPONSE_BYTES) {
      throw new WosError(res.status, `response too large (${cl} bytes) — refusing to buffer it`);
    }
    if (!res.body) {
      // `arrayBuffer()` has no ceiling, and only the content-length pre-check stands
      // in front of it — which a server simply omits. Reachable through the documented
      // `fetch` seam (test doubles, polyfills, wrappers that rebuild the Response),
      // and the option's own doc promises "the size cap still applies". Measured: a
      // body-less Response with no content-length buffered 73MB past the 64MB cap.
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_RESPONSE_BYTES) {
        throw new WosError(res.status, `response too large (${buf.byteLength} bytes) — refusing it`);
      }
      return buf;
    }
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel();
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
  }

  private async request(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<any> {
    const extraHeaders = this.idemHeader(idempotencyKey);
    const attempts = this.maxRetries + 1;
    // Debug logging shows the path WITHOUT its query string — a query can carry
    // a store id (listSpeakers), and logs must never carry data.
    const logPath = path.split("?")[0];
    const deadlineAt = this.deadlineAt();
    for (let attempt = 0; attempt < attempts; attempt++) {
      const start = Date.now();
      const att = this.beginAttempt(deadlineAt);
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.base}${path}`, {
          method,
          headers: extraHeaders ? { ...this.headers, ...extraHeaders } : this.headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: att.signal,
          // Never follow a redirect: fetch would forward the API key to
          // wherever a 3xx points. The API never legitimately redirects.
          redirect: "manual",
        });
      } catch (e: any) {
        att.clear();
        // Timeouts are ambiguous (the write may have landed) — don't retry those.
        const timedOut = e?.name === "AbortError" || att.signal.aborted;
        // Other network errors retry only when a retry can't double-process a
        // write: idempotent methods always; writes only for connect-level
        // failures (the request never reached the server). A mid-stream drop on
        // a POST may already have stored + billed server-side.
        const safe = IDEMPOTENT_METHODS.has(method.toUpperCase()) || isConnectFailure(e);
        if (!timedOut && safe && attempt + 1 < attempts) {
          const delay = this.backoffMs(attempt);
          logDebug(`${method} ${logPath}: ${e?.code ?? e?.name ?? "network error"} — retrying in ${delay}ms (attempt ${attempt + 1}/${attempts})`);
          await this.backoffSleep(delay, deadlineAt);
          continue;
        }
        throw new APIConnectionError(0, timedOut ? this.abortMessage(att.why()) : `network error: ${e?.message ?? e}`);
      }
      const retryable =
        RETRY_ALWAYS.has(res.status) ||
        (RETRY_IF_IDEMPOTENT.has(res.status) && IDEMPOTENT_METHODS.has(method.toUpperCase()));
      if (retryable && attempt + 1 < attempts) {
        att.clear();
        const retryAfter = res.headers.get("Retry-After");
        void res.body?.cancel();
        const delay = this.backoffMs(attempt, retryAfter);
        logDebug(`${method} ${logPath} -> ${res.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${attempts})`);
        await this.backoffSleep(delay, deadlineAt);
        continue;
      }
      if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
        att.clear();
        void res.body?.cancel(); // release the stream — otherwise the connection leaks
        throw new WosError(
          res.status,
          "unexpected redirect — refused (the API key never follows a redirect). Check baseUrl: exact host, https://."
        );
      }
      this._rateLimit = parseRateLimit(res.headers) ?? this._rateLimit;
      // Keep the abort timer alive THROUGH the body read: fetch resolves on
      // headers, so a server that sends headers then trickles/hangs the body
      // would otherwise stall forever. An abort mid-body surfaces as a timeout.
      let text: string;
      try {
        text = await this.readCapped(res);
      } catch (e: any) {
        if (e?.name === "AbortError" || att.signal.aborted) {
          // ★Say WHICH abort. `ctrl` could only ever be aborted by the per-attempt
          //  timer, so a fixed "timed out" was true when this line read `ctrl`. It
          //  now reads `att`, which also fires for the caller's AbortSignal and for
          //  an exhausted deadline — and this branch kept reporting both as a 30s
          //  timeout the caller never set. Two sibling sites were moved to
          //  abortMessage and these two were not; the tests abort before the fetch
          //  resolves, so they only ever reached the sites that were fixed.
          throw new APIConnectionError(0, this.abortMessage(att.why()));
        }
        if (e instanceof WosError) throw e; // the size cap — already the right error
        // A drop while READING the body is a transport failure — surface it as
        // APIConnectionError, not a raw fetch TypeError. Ambiguous, never retried.
        throw new APIConnectionError(0, `network error: ${e?.message ?? e}`);
      } finally {
        att.clear();
      }
      logDebug(`${method} ${logPath} -> ${res.status} in ${Date.now() - start}ms (attempt ${attempt + 1}/${attempts})`);
      if (!res.ok) {
        // Server returns either Anthropic-style envelope
        //   {"type":"error","error":{"type":...,"message":...,"request_id":...}}
        // or simple {"error":"reason"}. Fall back to raw text.
        let msg = text;
        let requestId: string | undefined;
        try {
          const data = JSON.parse(text);
          if (data && typeof data === "object") {
            const err = (data as any).error;
            if (err && typeof err === "object") {
              msg = err.message ?? err.type ?? msg;
              if (typeof err.request_id === "string") requestId = err.request_id;
            } else if (typeof err === "string") msg = err;
            else if (typeof (data as any).message === "string") msg = (data as any).message;
          }
        } catch {
          /* keep raw text */
        }
        // Cap the FINAL message (a string `error` field can be as huge as the body),
        // so a hostile server can't turn our exception/log into a giant string.
        if (typeof msg === "string" && msg.length > MAX_ERR_MSG) msg = msg.slice(0, MAX_ERR_MSG) + "…(truncated)";
        throw errorFor(res.status, msg, requestId);
      }
      // An empty body is only legal when the STATUS says there is no body. Accepting
      // any empty 2xx would make an `add()` answered by a truncating proxy return `{}`,
      // which reads as a successful write with no id. All three SDKs apply this rule.
      if (!text) {
        if (NO_BODY_STATUS.has(res.status)) return {};
        throw new WosError(res.status, "empty response body — expected a JSON object");
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch (e: any) {
        // A 2xx with a corrupt body is a real failure — surface it, don't leak
        // a raw SyntaxError (parity with the Rust SDK).
        throw new WosError(res.status, `invalid JSON in response: ${e?.message ?? e}`);
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
      // coming back again?
      //
      // Only when the body does not already carry the field. These responses are
      // widening — a response may carry fields this client has never seen —
      // and a client that writes into a server's object is one release away from
      // overwriting a real answer with its own guess. What the service said wins.
      if (res.headers.get("Idempotent-Replayed") === "true" && !("replayed" in data)) {
        (data as Record<string, unknown>).replayed = true;
      }
      return data;
    }
    throw new Error("retries exhausted"); // unreachable; keeps the compiler happy
  }
}

/** Back-compat alias: older code used `WME`. */
export const WME = Client;
export default Client;
