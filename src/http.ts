import type { RateLimit } from "./types.js";

const DEFAULT_BASE_URL = "https://api.wontopos.com";
const MAX_ERR_MSG = 4096;
const MAX_ERR_DETAILS = 8192;

const CONNECT_FAIL_CODES = new Set([
  "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "EADDRNOTAVAIL", "UND_ERR_CONNECT_TIMEOUT",
]);
const CONNECT_SYSCALLS = new Set(["connect", "getaddrinfo"]);
const CONNECT_ONLY_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

function isConnectFailure(e: unknown): boolean {
  const stack: unknown[] = [e];
  for (let steps = 0; stack.length && steps < 24; steps++) {
    const cur = stack.pop() as any;
    if (!cur || typeof cur !== "object") continue;
    const code = typeof cur.code === "string" ? cur.code : "";
    if (CONNECT_ONLY_CODES.has(code) || (CONNECT_FAIL_CODES.has(code) && CONNECT_SYSCALLS.has(cur.syscall))) return true;
    if (cur.cause) stack.push(cur.cause);
    if (Array.isArray(cur.errors)) stack.push(...cur.errors.slice(0, 8));
  }
  return false;
}

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

function cleanServerText(s: string, max = MAX_ERR_MSG): string {
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u001f\u007f]/g, "");
  return clean.length > max ? clean.slice(0, max) + "…(truncated)" : clean;
}

function cleanDetails(d: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!d) return undefined;
  const clean = (v: unknown): unknown => {
    if (typeof v === "string") return cleanServerText(v);
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [cleanServerText(k), clean(x)]));
    }
    return v;
  };
  let entries: [string, unknown, number][];
  try {
    JSON.stringify(d);
    entries = Object.entries(clean(d) as Record<string, unknown>).map(([k, v]) => [k, v, JSON.stringify(k).length + JSON.stringify(v).length + 2]);
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

function parseErrorText(text: string, keepBlank = false): { message: string; requestId?: string; type?: string; details?: Record<string, unknown> } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { message: text };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { message: text };
  const said = (s: unknown): s is string => typeof s === "string" && (keepBlank || cleanServerText(s).trim() !== "");
  const err = (data as any).error;
  if (err && typeof err === "object" && !Array.isArray(err)) {
    const { message, type, request_id, ...rest } = err as Record<string, unknown>;
    return {
      message: said(message) ? message : said(type) ? type : text,
      requestId: said(request_id) ? request_id : undefined,
      type: said(type) ? type : undefined,
      details: Object.keys(rest).length ? rest : undefined,
    };
  }
  if (typeof err === "string") return { message: err };
  if (said((data as any).message)) return { message: (data as any).message };
  return { message: text };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IMF_FIXDATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const RFC850_DATE =
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const ASCTIME_DATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;

function httpDateMs(s: string, now = Date.now()): number | undefined {
  let parts: [string, string, number, string, string, string] | undefined;
  let m: RegExpExecArray | null;
  if ((m = IMF_FIXDATE.exec(s))) parts = [m[1], m[2], Number(m[3]), m[4], m[5], m[6]];
  else if ((m = RFC850_DATE.exec(s))) {
    let year = 2000 + Number(m[3]);
    if (year > new Date(now).getUTCFullYear() + 50) year -= 100;
    parts = [m[1], m[2], year, m[4], m[5], m[6]];
  } else if ((m = ASCTIME_DATE.exec(s))) parts = [m[2].trim(), m[1], Number(m[6]), m[3], m[4], m[5]];
  if (!parts) return undefined;
  const [day, mon, year, hh, mm, ss] = parts;
  const month = MONTHS.indexOf(mon);
  const d = Number(day), h = Number(hh), mi = Number(mm), se = Number(ss);
  if (month < 0 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) return undefined;
  return Date.UTC(year, month, d, h, mi, se);
}

function retryAfterMs(v: string | null, now = Date.now()): number | undefined {
  if (v == null) return undefined;
  const s = v.trim();
  if (/^\d+$/.test(s)) return Math.min(Number(s), Number.MAX_SAFE_INTEGER / 1000) * 1000;
  const at = httpDateMs(s, now);
  return at === undefined ? undefined : Math.max(0, at - now);
}

const BRIEF_BODY_MS = 1_000;

const timing = {
  now: (): number => Date.now(),
  pause: (ms: number): number => ms,
  timer: (fn: () => void, ms: number): (() => void) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

class SlowBody extends Error {}

const DEFAULT_TRANSPORTS = new WeakSet<object>();
function defaultTransport(): unknown {
  const g = (globalThis as any).fetch;
  if (typeof g !== "function") return undefined;
  const bound = g.bind(globalThis);
  DEFAULT_TRANSPORTS.add(bound);
  return bound;
}

function discard(res: { body?: { cancel(): Promise<void> } | null }): void {
  res.body?.cancel().catch(() => {});
}

function finiteNumbers(_key: string, v: unknown): unknown {
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`${v} is not a JSON number`);
  return v;
}

function tryUrl(s: string, base?: string): URL | undefined {
  try {
    return base === undefined ? new URL(s) : new URL(s, base);
  } catch {
    return undefined;
  }
}

function inBrowserPage(): boolean {
  try {
    const g = globalThis as any;
    if (typeof g.window !== "undefined" && typeof g.window.document !== "undefined" && typeof g.navigator !== "undefined") return true;
    return inBrowserWorker(g);
  } catch {
    return false;
  }
}

function inBrowserWorker(g: any): boolean {
  if (typeof g.importScripts !== "function" || typeof g.navigator === "undefined") return false;
  if (g.process?.versions?.node !== undefined || g.Deno !== undefined || g.Bun !== undefined || g.EdgeRuntime !== undefined) return false;
  if (g.navigator?.userAgent === "Cloudflare-Workers") return false;
  return typeof g.WorkerGlobalScope === "function" && g instanceof g.WorkerGlobalScope;
}

function isServiceHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "wontopos.com" || h.endsWith(".wontopos.com");
}

function isLocalHost(host: string): boolean {
  if (host === "localhost" || host === "::" || host === "::1" || host === "0.0.0.0") return true;
  return /^127\.\d+\.\d+\.\d+$/.test(host);
}

const WARNED_PLAIN_HTTP = new Set<string>();
const WARNED_PLAIN_HTTP_MAX = 1024;

function plainHttpOnce(key: string, url: URL | undefined): boolean {
  const host = url?.hostname.toLowerCase().replace(/^\[|\]$/g, "") ?? "";
  if (url?.protocol !== "http:" || isLocalHost(host) || WARNED_PLAIN_HTTP.has(key)) return false;
  addCapped(WARNED_PLAIN_HTTP, key, WARNED_PLAIN_HTTP_MAX);
  return true;
}

function addCapped(set: Set<string>, key: string, max: number): void {
  set.add(key);
  for (const oldest of set) {
    if (set.size <= max) break;
    set.delete(oldest);
  }
}

const BROWSER_REFUSAL =
  "wontopos: refusing to run in a browser page. The API key would be readable by anyone who " +
  "opens the page, and with it every memory in its workspace. Call Wontopos from your server, " +
  "or put a proxy of your own in front of it and point baseUrl there. For a local demo with a " +
  "key you will revoke, pass dangerouslyAllowBrowser: true.";

function pageHref(): string | undefined {
  try {
    const href = (globalThis as any).location?.href;
    return typeof href === "string" ? href : undefined;
  } catch {
    return undefined;
  }
}

function parseBase(base: string): URL | undefined {
  let url = tryUrl(base);
  if (!url) {
    const page = pageHref();
    if (page !== undefined) url = tryUrl(base, page);
  }
  return url && (url.protocol === "http:" || url.protocol === "https:") ? url : undefined;
}

function asPageRelative(base: string): URL | undefined {
  return tryUrl(base) ? undefined : tryUrl(base, "http://page.invalid/");
}

const BASE_URL_ENDS = /^\s+|\s+$/g;

function notAUrl(base: string): string {
  return `baseUrl is not a URL: ${JSON.stringify(shownBase(base))} (expected e.g. ${DEFAULT_BASE_URL})`;
}

function maskBase(raw: string): string {
  const u = tryUrl(raw);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) {
    const at = raw.lastIndexOf("@");
    if (at === -1) return raw;
    const from = /^(?:[a-z][a-z0-9+.-]*:)?[\\/]*/i.exec(raw)![0].length;
    return `${raw.slice(0, from)}***@${raw.slice(at + 1)}`;
  }
  const from = /^[\u0000- ]*(?:[a-z][a-z0-9+.-]*:)?[\\/]*/i.exec(raw)![0].length;
  const end = raw.slice(from).search(/[\\/?#]/);
  const at = raw.slice(from, end === -1 ? raw.length : from + end).lastIndexOf("@");
  if (at === -1) return raw;
  return `${raw.slice(0, from)}***@${raw.slice(from + at + 1)}`;
}

function shownBase(raw: string): string {
  return maskBase(raw).replace(/([?#])[\s\S]*/, "$1");
}

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

function maskKey(key: string): string {
  return key.length >= 24 ? `***${key.slice(-4)}` : "***";
}

function parseRateLimit(h: Headers): RateLimit | null {
  const num = (name: string): number | null => {
    const v = (h.get(name) ?? "").replace(/^[ \t]+|[ \t]+$/g, "");
    if (!/^[0-9]+$/.test(v)) return null;
    const n = Number(v);
    return n <= Number.MAX_SAFE_INTEGER ? n : null;
  };
  const limit = num("X-RateLimit-Limit");
  const remaining = num("X-RateLimit-Remaining");
  const reset = num("X-RateLimit-Reset");
  if (limit === null && remaining === null && reset === null) return null;
  return { limit, remaining, reset };
}

function weekUsedOf(h: Headers): number | null {
  const v = (h.get("X-WOS-Week-Used") ?? "").replace(/^[ \t]+|[ \t]+$/g, "");
  if (!/^[0-9]+$/.test(v)) return null;
  const n = Number(v);
  return n <= 100 ? n : null;
}

const asList = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const asObj = <T>(x: unknown): T => (x != null && typeof x === "object" && !Array.isArray(x) ? (x as T) : ({} as T));
const INSTANT_RE =
  /^([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?(?:[Tt ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]+))?)?(?:[Zz]|([+-])([0-9]{2}):?([0-9]{2}))?)?$/;

function instantMs(s: unknown): number | undefined {
  const m = typeof s === "string" ? INSTANT_RE.exec(s) : null;
  if (!m) return undefined;
  const [month, day, hour, minute, second] = [m[2] ?? "1", m[3] ?? "1", m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  const milli = Number((m[7] ?? "").slice(0, 3).padEnd(3, "0"));
  let offset = 0;
  if (m[8]) {
    if (Number(m[9]) > 23 || Number(m[10]) > 59) return undefined;
    offset = (m[8] === "+" ? 1 : -1) * (Number(m[9]) * 60 + Number(m[10]));
  }
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31 && minute <= 59 && second <= 59 &&
    (hour < 24 || (hour === 24 && minute === 0 && second === 0 && milli === 0)))) return undefined;
  const first = new Date(0).setUTCFullYear(Number(m[1]), month - 1, 1);
  return first + (day - 1) * 86_400_000 + ((hour * 60 + minute - offset) * 60 + second) * 1000 + milli;
}

function keptIn(text: string): string {
  return text.replace(/\r\n|[\r\n\u0085\u{2028}\u{2029}]/gu, "\n    ");
}

const IGNORABLE =
  /[\u{ad}\u{34f}\u{61c}\u{115f}\u{1160}\u{17b4}\u{17b5}\u{180b}-\u{180f}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{206f}\u{3164}\u{fe00}-\u{fe0f}\u{feff}\u{ffa0}\u{fff0}-\u{fff8}\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]/gu;

function shownSpeaker(name: string): string {
  const shown = name.replace(/\r\n|[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/gu, " ");
  const label = shown.replace(IGNORABLE, "").trim().toLowerCase().replace(/\u{17f}/gu, "s");
  return ["you", "user", "note"].includes(label) ? `"${shown}"` : shown;
}

const RETRY_ALWAYS = new Set([429]);
const MAX_RETRY_WAIT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const STORE_TIMEOUT_MS = 200_000;
const STORE_PATHS = new Set(["/api/v1/memory/store", "/api/v1/memory/store-turn", "/api/v1/memory/bulk-store"]);
const RETRY_IF_IDEMPOTENT = new Set([408, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const READ_POSTS = new Set([
  "/api/v1/memory/search", "/api/v1/memory/recall", "/api/v1/memory/get", "/api/v1/memory/list", "/api/v1/memory/stats",
  "/api/v1/memory/history", "/api/v1/memory/lineage", "/api/v1/memory/by-speaker", "/api/v1/memory/images",
  "/api/v1/memory/image", "/api/v1/engram/run", "/api/v1/won/revisions", "/api/v1/memory/around", "/api/v1/memory/why",
  "/api/v1/memory/retrievals", "/api/v1/memory/sleep", "/api/v1/memory/sleep/verify", "/api/v1/memory/seen",
  "/api/v1/memory/work/state", "/api/v1/memory/self", "/api/v1/memory/self/open", "/api/v1/memory/self/history",
  "/api/v1/memory/self/notes", "/api/v1/memory/channel/read",
]);
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const NO_BODY_STATUS = new Set([204, 205, 304]);

const warnedRetirements = new Set<string>();
const WARNED_RETIREMENTS_MAX = 64;

function warnIfRetiring(model: string, h: { get(name: string): string | null }): void {
  const v = h.get("Sunset");
  if (!v) return;
  const at = httpDateMs(v.trim());
  if (at === undefined) return;
  const day = new Date(at).toISOString().slice(0, 10);
  const k = `${model}|${day}`;
  if (warnedRetirements.has(k) || warnedRetirements.size >= WARNED_RETIREMENTS_MAX) return;
  warnedRetirements.add(k);
  const which = model ? `model ${JSON.stringify(model)}` : "the model this client uses";
  console.warn(
    `wontopos: ${which} retires on ${day} (UTC). From then on its calls answer 410, except ` +
      "deleteStore. listModels() lists the models you can move to.",
  );
}

export {
  BASE_URL_ENDS, BRIEF_BODY_MS, BROWSER_REFUSAL, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, DEFAULT_TRANSPORTS, IDEMPOTENT_METHODS,
  MAX_RESPONSE_BYTES, MAX_RETRY_WAIT_MS, NO_BODY_STATUS, READ_POSTS, RETRY_ALWAYS, RETRY_IF_IDEMPOTENT, STORE_PATHS,
  STORE_TIMEOUT_MS, SlowBody, addCapped, asList, asObj, asPageRelative, causeCode, cleanDetails, cleanServerText, defaultTransport,
  discard, finiteNumbers, httpDateMs, inBrowserPage, instantMs, isConnectFailure, isServiceHost, keptIn,
  maskBase, maskKey, maskUserinfo, notAUrl, pageHref, parseBase, parseErrorText, parseRateLimit, plainHttpOnce,
  retryAfterMs, shownBase, shownSpeaker, timing, tryUrl, warnIfRetiring, warnedRetirements, weekUsedOf,
};
