import { CONTEXT_LIMIT_MAX, CONTEXT_LIMIT_MIN, SEARCH_LIMIT_MAX, SEARCH_LIMIT_MIN } from "./wontopos.js";
import { addCapped } from "./http.js";
import { SPEAKER_MAX_BYTES, byteLength, isPlainObject } from "./router.js";
import { sleepDate } from "./sleep.js";
import type { ImageInput, SearchOptions, SleepFileWrite, WriteOptions } from "./types.js";

const MAX_TIMER_MS = 2_147_483_647;

function normalizeStoreId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}
const WARNED_FILTER_KEYS_MAX = 1024;

function checkCount(limit: number, name: string): void {
  if (!Number.isInteger(limit) || limit < SEARCH_LIMIT_MIN || limit > SEARCH_LIMIT_MAX) {
    throw new Error(
      `${name} must be an integer between ${SEARCH_LIMIT_MIN} and ${SEARCH_LIMIT_MAX}, got ${limit}. ` +
        `Out of range is refused rather than adjusted, so a short answer always means ` +
        `the store was short.`
    );
  }
}

function checkContextLimit(n: number): void {
  if (!Number.isInteger(n) || n < CONTEXT_LIMIT_MIN || n > CONTEXT_LIMIT_MAX) {
    throw new Error(`context_limit must be an integer between ${CONTEXT_LIMIT_MIN} and ${CONTEXT_LIMIT_MAX}, got ${n}.`);
  }
}

const PAGE_LIMIT_MIN = 5;
const PAGE_LIMIT_MAX = 20;
const LIST_LIMIT_MAX = 500;
const MAX_IMAGES_MAX = 5;
const VERIFY_MAX = 3;
const RECALL_COUNTS = [
  ["roomLimit", "room_limit", 1, 20],
  ["roomExpandTokens", "room_expand_tokens", 0, 20_000],
  ["shortTermLimit", "short_term_limit", 0, 500],
  ["shortTermBudgetTokens", "short_term_budget_tokens", 0, 8_000],
  ["maxImages", "max_images", 0, MAX_IMAGES_MAX],
] as const;
const RELABEL_IDS_MAX = 1_000;
const SLEEP_EVIDENCE_MAX = 200;
const SLEEP_EVIDENCE_CHARS_MAX = 64;
const RESEND_MAX = 3;

function checkRange(n: unknown, name: string, min: number, max: number): void {
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got ${String(n)}.`);
  }
}

function optRange(n: unknown, name: string, min: number, max: number): number | undefined {
  if (n === undefined || n === null) return undefined;
  checkRange(n, name, min, max);
  return n as number;
}

function pageFields(opts: { limit?: number; before?: string; skipIds?: string[] }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const limit = optRange(opts.limit, "limit", PAGE_LIMIT_MIN, PAGE_LIMIT_MAX);
  if (limit !== undefined) out.limit = limit;
  if (opts.before != null) out.before = opts.before;
  if (opts.skipIds != null) out.skip_ids = opts.skipIds;
  return out;
}

function tzMinutes(tz: unknown, name = "tz"): number {
  if (typeof tz !== "number" || !Number.isFinite(tz) || Math.abs(tz) > 14) {
    throw new Error(`${name} must be a UTC offset in hours between -14 and 14 (e.g. 9, -4, 5.5), got ${String(tz)}.`);
  }
  return Math.round(tz * 60);
}

const ROOM_NAME = /^[man][0-2]$/;

function checkRooms(rooms: unknown): void {
  if (rooms === true || rooms === false || rooms === "all") return;
  const list = Array.isArray(rooms) ? rooms : [rooms];
  if (list.length === 0 || list.length > 9 || !list.every((r) => typeof r === "string" && ROOM_NAME.test(r))) {
    throw new Error(
      `rooms must be "all" or room names like "m0" (this morning) or "a1" and "n1" ` +
        `(yesterday afternoon and night), got ${JSON.stringify(rooms)}.`,
    );
  }
}

function roomArg(room: unknown): { days_ago: number; slot: number } {
  if (typeof room !== "string" || !ROOM_NAME.test(room)) {
    throw new Error(`room must be one room name like "m0" or "n1", got ${JSON.stringify(room)}.`);
  }
  return { days_ago: Number(room[1]), slot: "man".indexOf(room[0]) };
}

function optBool(v: unknown, name: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new Error(`${name} must be true or false, got ${JSON.stringify(v)}.`);
  return v;
}

function checkName(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`${name} must be a speaker's name (a non-blank string), got ${JSON.stringify(v)}.`);
  }
  return v.trim();
}

function checkTurnSpeaker(v: unknown, name: string): string {
  const s = checkName(v, name);
  if (byteLength(s) > SPEAKER_MAX_BYTES) throw new Error(`${name} is at most ${SPEAKER_MAX_BYTES} bytes.`);
  return s;
}

function checkWrittenSpeaker(v: unknown, name: string): string {
  return checkOneLine(checkTurnSpeaker(v, name), name);
}

function checkAssistant(v: unknown): string {
  return checkOneLine(checkTurnSpeaker(v, "assistant"), "assistant");
}

const RFC3339_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function checkTime(v: unknown, name: string): string {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error(`${name} is an invalid Date.`);
    const year = v.getUTCFullYear();
    if (year < 1 || year > 9999) throw new Error(`${name} is a Date outside the years 1 to 9999.`);
    return v.toISOString();
  }
  const s = typeof v === "string" ? v.trim() : "";
  const m = RFC3339_TIME.exec(s);
  const [y, mo, d, h, mi, sec, oh, om] = (m ?? []).slice(1, 9).map((x) => Number(x ?? 0));
  const day = new Date(0);
  day.setUTCFullYear(y, mo - 1, d);
  const ok =
    m !== null && y >= 1 && day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d &&
    h < 24 && mi < 60 && sec < 60 && oh < 24 && om < 60;
  if (!ok) {
    throw new Error(
      `${name} must be a Date or an RFC 3339 time with Z or a ±hh:mm offset, such as 2026-05-02T09:00:00Z ` +
        `(a date alone or a time with no offset is refused), got ${JSON.stringify(v)}.`,
    );
  }
  return s;
}

function checkWindowRole(role: unknown): string {
  if (typeof role !== "string" || !/^[A-Za-z0-9_]{1,32}$/.test(role)) {
    throw new Error("windowRole must be 1-32 characters of [A-Za-z0-9_].");
  }
  return role;
}

function refuseWindow(opts: WriteOptions, why: string): void {
  if (opts.window !== undefined || opts.windowRole !== undefined) throw new Error(`window is for add: ${why}.`);
}

function filledText(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required.`);
  return v;
}

function checkId(id: unknown, name: string): string {
  return filledText(id, name).trim();
}

function requiredId(v: unknown, refusal: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(refusal);
  return v.trim();
}

function shownArg(v: unknown): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

function checkMs(v: unknown, name: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || Number.isNaN(v) || v < 0) {
    throw new Error(`${name} must be a number of milliseconds, 0 or more, got ${shownArg(v)}.`);
  }
  return v === 0 ? undefined : Math.min(v, MAX_TIMER_MS);
}

function checkRetries(v: unknown, name: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new Error(`${name} must be a whole number, 0 or more, got ${shownArg(v)}.`);
  }
  return v;
}

function checkOneLine(name: string, what: string): string {
  if (/[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/u.test(name)) throw new Error(`${what} contains a line break or a control character.`);
  return name;
}

function normalizeImage(image: ImageInput): Record<string, unknown> {
  if (!image || typeof image !== "object") {
    throw new Error("image must be an object — { data: '<base64>' }.");
  }
  if (typeof image.data !== "string" || image.data.trim() === "") {
    throw new Error("image.data is required — base64 of the image (a data: URL is fine).");
  }
  const raw = image.data.trim();
  const comma = raw.startsWith("data:") ? raw.indexOf(",") : -1;
  const data = (comma === -1 ? raw : raw.slice(comma + 1)).replace(/\s+/g, "");
  if (data === "") throw new Error("image.data is empty after stripping its data: prefix.");
  const out: Record<string, unknown> = { data };
  if (image.reference !== undefined) out.reference = image.reference;
  if (image.taken_at !== undefined) out.taken_at = image.taken_at;
  return out;
}

const SEGMENT_KEYS = new Set(["content", "speaker", "created_at"]);

function bulkSegments(segments: unknown): Record<string, unknown>[] {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("segments must be a list of at least one { content, speaker?, created_at? }.");
  }
  return segments.map((s, i) => {
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      throw new Error(`segments[${i}] must be an object: { content, speaker?, created_at? }.`);
    }
    for (const k of Object.keys(s)) {
      if (!SEGMENT_KEYS.has(k)) {
        throw new Error(`segments[${i}] has ${JSON.stringify(k)}: a segment takes content, speaker and created_at only.`);
      }
    }
    const seg = s as Record<string, unknown>;
    if (typeof seg.content !== "string" || !seg.content.trim()) {
      throw new Error(`segments[${i}].content is required: the text of that part, not blank.`);
    }
    const out: Record<string, unknown> = { content: seg.content };
    if (seg.speaker != null) out.speaker = checkWrittenSpeaker(seg.speaker, `segments[${i}].speaker`);
    if (seg.created_at != null) out.created_at = checkId(seg.created_at, `segments[${i}].created_at`);
    return out;
  });
}

const KNOWN_FILTER_KEYS = new Set(["categories", "event_from", "event_to", "time_from", "time_to", "min_importance", "speakers"]);
const warnedFilterKeys = new Set<string>();
const KNOWN_SEARCH_KEYS = new Set(["cache_control", "speaker", "filters", "verify", "max_images", "form", "tz", "extra"]);
const RESERVED_SEARCH_KEYS = new Set(["user_id", "query", "max_results"]);
const KNOWN_RECALL_KEYS = new Set([
  "form", "tz", "limit", "context_limit", "rooms", "room", "roomLimit", "roomExpandTokens", "longTerm",
  "longTermCutoff", "todayStart", "now", "shortTermLimit", "shortTermBudgetTokens", "maxImages", "filters",
  "speaker", "includeSuperseded",
]);
const KNOWN_AROUND_KEYS = new Set(["from", "to", "center", "held"]);
const KNOWN_RETRIEVALS_KEYS = new Set(["limit", "before"]);
const KNOWN_LOOK_KEYS = new Set(["rooms", "tz"]);
const KNOWN_OPEN_WORK_KEYS = new Set(["rooms", "tz", "maxImages", "ownWords", "diversity"]);
const KNOWN_MEMORY_TOOLS_KEYS = new Set([
  "preset", "rooms", "tz", "speakers", "assistant", "dates", "images", "sleep", "today", "seen", "usage", "ownWords",
  "diversity",
]);
const KNOWN_WORK_AROUND_KEYS = new Set(["from", "to", "center"]);
const KNOWN_SLEEP_KEYS = new Set([
  "tz", "daysAgo", "room", "todayStart", "now", "budgetTokens", "cursor", "includeSuperseded", "sleepId",
  "sinceLastSleep", "since",
]);
const KNOWN_SLEEP_RUN_KEYS = new Set([
  "llm", "mergeLlm", "being", "assistant", "prompt", "settings", "today", "since", "sleepId", "done", "lineTime",
  "countTokens", "maxTokens", "progress",
]);
const KNOWN_SLEEP_ESTIMATE_KEYS = new Set(["inputPrice", "outputPrice", "settings", "since", "countTokens"]);
const KNOWN_ENGRAM_KEYS = new Set(["form", "tz"]);
const KNOWN_SET_SETTINGS_KEYS = new Set(["timeZone", "defaultSpeakers", "confirmedByUser"]);
const KNOWN_RELABEL_KEYS = new Set(["memoryIds"]);
const KNOWN_FORGET_SPEAKER_KEYS = new Set(["preview"]);
const KNOWN_FORGET_IMAGE_KEYS = new Set(["preview"]);
const KNOWN_LIST_MEMORIES_KEYS = new Set(["limit", "cursor"]);
const KNOWN_PAGE_SIZE_KEYS = new Set(["pageSize"]);
const KNOWN_PAGE_KEYS = new Set(["limit", "before", "skipIds"]);
const KNOWN_REVISIONS_KEYS = new Set(["include", "limit", "before", "skipIds"]);
const KNOWN_CLEAR_WINDOW_KEYS = new Set(["upTo"]);

function checkSearchOpts(opts: object): void {
  checkOpts(opts, KNOWN_SEARCH_KEYS, "search");
  const o = opts as SearchOptions;
  optRange(o.max_images != null ? o.max_images : o.extra?.max_images, "max_images", 0, MAX_IMAGES_MAX);
  optRange(o.verify != null ? o.verify : o.extra?.verify, "verify", 0, VERIFY_MAX);
  const tz = o.tz != null ? o.tz : o.extra?.tz;
  if (tz != null) tzMinutes(tz);
}

function checkOpts(opts: object, known: Set<string>, what: string): void {
  for (const k of Object.keys(opts)) {
    if (RESERVED_SEARCH_KEYS.has(k))
      throw new Error(
        `${JSON.stringify(k)} is set by the call, not by options — pass it as an argument. ` +
          `An app forwarding untrusted input as options cannot steer the store, the query ` +
          `or the count, and this says so rather than dropping it silently.`
      );
    if (known.has(k)) continue;
    const flat = (s: string) => s.replace(/_/g, "").toLowerCase();
    const near =
      [...known].find((n) => n !== "extra" && flat(n) === flat(k)) ??
      [...known].find((n) => n !== "extra" && editWithin(k, n, 2));
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

function warnOnceUnknownKeys(obj: unknown, known: Set<string>, warned: Set<string>, message: (key: string) => string): void {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const k of Object.keys(obj)) {
    if (known.has(k) || warned.has(k)) continue;
    addCapped(warned, k, WARNED_FILTER_KEYS_MAX);
    console.warn(message(k));
  }
}

function givenOpts(known: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(known).filter(([, v]) => v !== null));
}

const WRITE_KEYS = {
  add: [
    new Set(["idempotencyKey", "image", "tz", "workId", "window", "windowRole"]),
    "add takes idempotencyKey, image, tz, workId, window and windowRole.",
  ],
  addTurn: [
    new Set(["idempotencyKey", "tz", "workId", "createdAt", "userSpeaker", "assistantSpeaker"]),
    "addTurn takes idempotencyKey, tz, workId, createdAt, userSpeaker and assistantSpeaker.",
  ],
  update: [new Set(["idempotencyKey", "tz"]), "update takes idempotencyKey and tz."],
  addBulk: [new Set(["idempotencyKey", "segments", "speaker"]), "addBulk takes idempotencyKey, segments and speaker."],
} as const;
const warnedWriteKeys = new Set<string>();

function writeKey(opts: WriteOptions, call: keyof typeof WRITE_KEYS): string | undefined {
  const [takes, says] = WRITE_KEYS[call];
  warnOnceUnknownKeys(opts, takes, warnedWriteKeys, (k) => `wontopos: write option ${JSON.stringify(k)} is not sent. ${says}`);
  return opts.idempotencyKey;
}

function newIdempotencyKey(): string {
  const c = (globalThis as any).crypto;
  if (typeof c?.randomUUID === "function") return `sdk-${String(c.randomUUID()).replace(/-/g, "")}`;
  let hex = "";
  for (let i = 0; i < 4; i++) hex += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  return `sdk-${hex}`;
}

function warnOnUnknownFilters(filters: unknown): void {
  warnOnceUnknownKeys(filters, KNOWN_FILTER_KEYS, warnedFilterKeys, (k) =>
    `wontopos: unknown search filter ${JSON.stringify(k)} — the API drops keys it does not know, ` +
      `so this filter has NO effect and the search is wider than you think. ` +
      `Known keys: ${[...KNOWN_FILTER_KEYS].join(", ")}.`,
  );
}

function checkFilters(filters: unknown): void {
  warnOnUnknownFilters(filters);
  const m = filters && typeof filters === "object" ? (filters as Record<string, unknown>).min_importance : undefined;
  if (m != null && (typeof m !== "number" || !(m >= 0 && m <= 1))) {
    throw new Error(`filters.min_importance must be a number between 0 and 1, got ${shownArg(m)}.`);
  }
}

const KNOWN_METADATA_KEYS = new Set(["speaker", "event_date", "category", "conversation_id"]);
const warnedMetadataKeys = new Set<string>();

function warnOnUnknownMetadata(metadata: unknown): void {
  warnOnceUnknownKeys(metadata, KNOWN_METADATA_KEYS, warnedMetadataKeys, (k) =>
    `wontopos: metadata key ${JSON.stringify(k)} is not kept: the service keeps only ` +
      `${[...KNOWN_METADATA_KEYS].join(", ")} and drops the rest, so this value is not stored.`,
  );
}

const MODEL_RE = /^[A-Za-z0-9._-]+$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:\-]{1,128}$/;

const WARNED_STORE_IDS_MAX = 1024;
function assertUsableStoreId(userId: unknown): asserts userId is string | undefined {
  if (userId !== undefined && (typeof userId !== "string" || !userId.trim())) {
    throw new Error(
      `userId must be a non-blank string; got ${JSON.stringify(userId)}. Omit it to use the client's ` +
        "default store, or pass a real store id — anything else would silently write into the default store.",
    );
  }
}

const warnedStoreIds = new Set<string>();
function warnIfStoreIdCollapses(id: string): void {
  if (!id || warnedStoreIds.has(id)) return;
  const valid = STORE_ID_FORMAT.test(id);
  const normalized = normalizeStoreId(id);
  if (valid && normalized === id) return;
  addCapped(warnedStoreIds, id, WARNED_STORE_IDS_MAX);
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
const STORE_ID_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
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

function namedStore(userId: unknown, refusal: string): string {
  requiredId(userId, refusal);
  warnIfStoreIdCollapses(userId as string);
  return userId as string;
}

const SLEEP_WRITE_KEYS = new Set(["slot", "base_version", "title", "body", "evidence", "day"]);

function sleepSlot(slot: unknown, what = "slot"): number {
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot > 4) {
    throw new Error(`${what} must be 0 (the core) or 1 to 4 (a box), got ${JSON.stringify(slot) ?? String(slot)}.`);
  }
  return slot;
}

function sleepOpenBody(store: string, slot: unknown, version: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = { user_id: store, slot: sleepSlot(slot) };
  if (version !== undefined && version !== null) {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      throw new Error(`version must be a whole number of 1 or more, got ${JSON.stringify(version)}.`);
    }
    body.version = version;
  }
  return body;
}

function sleepWrites(writes: unknown): SleepFileWrite[] {
  if (!Array.isArray(writes) || writes.length < 1 || writes.length > 5) {
    throw new Error("writes must be a list of 1 to 5 writes, one a file.");
  }
  const slots = new Set<number>();
  return writes.map((w: unknown, i) => {
    const what = `writes[${i}]`;
    if (!isPlainObject(w)) throw new Error(`${what} must be an object.`);
    checkOpts(w, SLEEP_WRITE_KEYS, what);
    const slot = sleepSlot(w.slot, `${what}.slot`);
    if (slots.has(slot)) throw new Error(`${what}.slot ${slot} is written twice: one write a file.`);
    slots.add(slot);
    const base = w.base_version;
    if (typeof base !== "number" || !Number.isInteger(base) || base < 0) {
      throw new Error(`${what}.base_version must be the version read, 0 or more, got ${JSON.stringify(base) ?? String(base)}.`);
    }
    const title = w.title === undefined ? "" : w.title;
    if (typeof title !== "string") throw new Error(`${what}.title must be a string.`);
    if (typeof w.body !== "string") throw new Error(`${what}.body must be a string.`);
    const ev = w.evidence === undefined ? [] : w.evidence;
    if (!Array.isArray(ev) || !ev.every((x) => typeof x === "string" && x)) throw new Error(`${what}.evidence must be a list of memory ids.`);
    const entry: SleepFileWrite = { slot, base_version: base, title, body: w.body, evidence: [...ev] };
    if (w.day !== undefined && w.day !== null) {
      if (sleepDate(w.day) === undefined) throw new Error(`${what}.day must be "YYYY-MM-DD", got ${JSON.stringify(w.day)}.`);
      entry.day = w.day as string;
    }
    return entry;
  });
}

function sleepNotesBody(store: string, baseVersion: unknown, notes: unknown): Record<string, unknown> {
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) {
    throw new Error(`baseVersion must be the version read, 0 or more, got ${JSON.stringify(baseVersion) ?? String(baseVersion)}.`);
  }
  if (!isPlainObject(notes)) throw new Error("notes must be an object: proposals and mixed.");
  return { user_id: store, base_version: baseVersion, notes: { ...notes } };
}

export {
  KNOWN_AROUND_KEYS, KNOWN_CLEAR_WINDOW_KEYS, KNOWN_ENGRAM_KEYS, KNOWN_FORGET_IMAGE_KEYS, KNOWN_FORGET_SPEAKER_KEYS,
  KNOWN_LIST_MEMORIES_KEYS, KNOWN_LOOK_KEYS, KNOWN_MEMORY_TOOLS_KEYS, KNOWN_OPEN_WORK_KEYS, KNOWN_PAGE_KEYS,
  KNOWN_PAGE_SIZE_KEYS, KNOWN_RECALL_KEYS, KNOWN_RELABEL_KEYS, KNOWN_RETRIEVALS_KEYS, KNOWN_REVISIONS_KEYS,
  KNOWN_SET_SETTINGS_KEYS, KNOWN_SLEEP_ESTIMATE_KEYS, KNOWN_SLEEP_KEYS, KNOWN_SLEEP_RUN_KEYS, KNOWN_WORK_AROUND_KEYS,
  IDEMPOTENCY_KEY_RE, LIST_LIMIT_MAX, MAX_IMAGES_MAX, MAX_TIMER_MS, MODEL_RE, PAGE_LIMIT_MAX, PAGE_LIMIT_MIN, RECALL_COUNTS,
  RELABEL_IDS_MAX, RESEND_MAX, SLEEP_EVIDENCE_CHARS_MAX, SLEEP_EVIDENCE_MAX, assertUsableStoreId, bulkSegments,
  checkAssistant, checkContextLimit, checkCount, checkFilters, checkId, checkMetadataKeys, checkMs, filledText, checkName,
  checkOneLine, checkOpts, checkRange, checkRetries, checkRooms, checkSearchOpts, checkTime, checkWindowRole, checkWrittenSpeaker, editWithin, givenOpts, namedStore, newIdempotencyKey, normalizeImage,
  normalizeStoreId, optBool, optRange, pageFields, refuseWindow, requiredId, roomArg, sleepNotesBody, sleepOpenBody,
  sleepSlot, sleepWrites, tzMinutes, warnIfStoreIdCollapses, warnOnUnknownMetadata,
  warnedFilterKeys, warnedStoreIds, writeKey,
};
