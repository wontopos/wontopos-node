
import {
  SLEEP_READER_NOTE, SleepSettings, parseFiniteJson, sleepBoxIndex, sleepBoxPick, sleepBoxText, sleepDate,
  sleepEstimateFlow, sleepEstimateSetup, sleepFile, sleepFlow, sleepHasBody, sleepOpenBox, sleepRender, sleepSetup,
  sleepView,
} from "./sleep.js";
import type { SleepHost, SleepViewFile } from "./sleep.js";
export { SLEEP_VERSION, SleepSettings } from "./sleep.js";
export type { SleepSettingsOptions } from "./sleep.js";
import {
  BASE_URL_ENDS, BRIEF_BODY_MS, BROWSER_REFUSAL, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, DEFAULT_TRANSPORTS, IDEMPOTENT_METHODS,
  MAX_RESPONSE_BYTES, MAX_RETRY_WAIT_MS, NO_BODY_STATUS, READ_POSTS, RETRY_ALWAYS, RETRY_IF_IDEMPOTENT, STORE_PATHS,
  STORE_TIMEOUT_MS, SlowBody, asPageRelative, causeCode, cleanDetails, cleanServerText, defaultTransport, discard,
  finiteNumbers, inBrowserPage, instantMs, isConnectFailure, isServiceHost, keptIn, maskBase, maskKey,
  maskUserinfo, notAUrl, pageHref, parseBase, parseErrorText, parseRateLimit, plainHttpOnce, retryAfterMs, shownBase,
  shownSpeaker, timing, tryUrl, warnIfRetiring, warnedRetirements, weekUsedOf,
} from "./http.js";
import {
  MAX_PAGES, asRecords, memoryFromGet, memoryRecords, mergeResults, recallShape, truncatedWalk, withCount, withForm,
  withRecords,
} from "./memory.js";
import {
  MEMORY_TOOLS_PRESETS, MEMORY_TOOL_NAMES, NOT_ASSISTANT_SOURCES, PHOTO_TYPES, RUN_TAPS, SEEN_STATES, SEEN_TEXT, USAGE_TEXT,
  base64, budgetLine, checkDiversity, checkOwnWords, liveQuestion, memoryNote, memoryToolsPreset, namedPreset, pad2, roomsFrom,
  tappedClient, usageLine, usageText, utcLabel,
} from "./memory-tools.js";
import type { MemoryToolsPreset, OpenWork, Said, SaidFields } from "./memory-tools.js";
import {
  KNOWN_AROUND_KEYS, KNOWN_CLEAR_WINDOW_KEYS, KNOWN_ENGRAM_KEYS, KNOWN_FORGET_IMAGE_KEYS, KNOWN_FORGET_SPEAKER_KEYS,
  KNOWN_LIST_MEMORIES_KEYS, KNOWN_LOOK_KEYS, KNOWN_MEMORY_TOOLS_KEYS, KNOWN_OPEN_WORK_KEYS, KNOWN_PAGE_KEYS,
  KNOWN_PAGE_SIZE_KEYS, KNOWN_RECALL_KEYS, KNOWN_RELABEL_KEYS, KNOWN_RETRIEVALS_KEYS, KNOWN_REVISIONS_KEYS,
  KNOWN_SET_SETTINGS_KEYS, KNOWN_SLEEP_ESTIMATE_KEYS, KNOWN_SLEEP_KEYS, KNOWN_SLEEP_RUN_KEYS, KNOWN_WORK_AROUND_KEYS,
  LIST_LIMIT_MAX, MAX_IMAGES_MAX, PAGE_LIMIT_MAX, PAGE_LIMIT_MIN, RECALL_COUNTS, RELABEL_IDS_MAX, RESEND_MAX,
  SLEEP_EVIDENCE_CHARS_MAX, SLEEP_EVIDENCE_MAX, bulkSegments, checkAssistant, checkContextLimit, checkCount, checkFilters,
  checkId, checkMs, filledText, checkName, checkOpts, checkRange, checkRetries, checkRooms, checkSearchOpts, checkTime,
  checkWindowRole, checkWrittenSpeaker, givenOpts, newIdempotencyKey, normalizeImage, normalizeStoreId, optBool, optRange,
  pageFields, refuseWindow, requiredId, roomArg, tzMinutes, warnOnUnknownMetadata, warnedFilterKeys,
  writeKey, IDEMPOTENCY_KEY_RE, MODEL_RE, assertUsableStoreId, checkMetadataKeys, namedStore, sleepNotesBody, sleepOpenBody,
  sleepSlot, sleepWrites, warnIfStoreIdCollapses, warnedStoreIds,
} from "./checks.js";
import {
  FORMAT_REFUSED, KNOWN_ANTHROPIC_CALLER_KEYS, KNOWN_OPENAI_CALLER_KEYS, MODEL_KEY_BROWSER_REFUSAL, anthropicBody, anthropicReply, checkModelKey, hostKey, openaiBody,
  openaiReason, openaiReply, providerBase, providerPost, providerTransport, providerUnreachable, providerUrl,
} from "./callers.js";
import {
  ANTHROPIC_BASE_URL, ANTHROPIC_VERSION, AskClock, EXCHANGE_MAX_CHARS, FRAME_TOKENS, KNOWN_ASK_KEYS,
  KNOWN_ROUTER_HISTORY_KEYS, KNOWN_ROUTER_TOOLS_KEYS, KNOWN_RUN_SKILL_KEYS, KNOWN_SKILL_MD_KEYS, MODEL_MAX_TOKENS,
  ROUTER_PROMPT_MAX_TOKENS, ROUTER_STABLE_MAX_TOKENS, ROUTER_TEXT, RouterState, SKILLS_EXPORT_VERSION, SKILL_MAX_TOKENS,
  SKILL_MD_INPUT, SKILL_MD_NOT_RUN, SKILL_NAME_RE, SLEEP_MODEL, asCaller, askHistory, askSpeaker, askTurn, byteLength,
  checkModelName, checkSkill, clockParts, copyJson, countTokens, cutChars, exchangeAnswer, inputError, isPlainObject,
  modelFailure, newAskId, parseDecision, parseSkillMd, raceAbort, replyShape, routerSchema, routerTurn, skillList,
  skillText, skillTurn, sleepUnless, sumUsage, toolFormat,
} from "./router.js";
import type { AskOutcome, Failure, RouterClock } from "./router.js";
import type {
  AddTurnOptions, AroundResult, AskHistory, AskReadiness, AskResult, AskUsage, BulkOptions, ClearWindowResult,
  EngramCatalog, EngramInfo, EngramResult, ForgetSpeakerResult, HistoryTurn, ImageBytes, ImageDeleteResult, ImagePage,
  LineageResult, Memory, MemoryPage, ModelInfo, RateLimit, RecallResult, RelabelResult, RetrievalsPage, RevisionsResult,
  RouterExchange, SearchFilters, SearchOptions, SearchResult, SeenResult, SelfSearchResult, SkillDefinition,
  SkillMdOptions, SleepCursor, SleepDoneResult, SleepFile, SleepFileHistory, SleepFileWrite, SleepFiles, SleepNotes,
  SleepNotesWriteResult, SleepPage, SleepVerifyResult, SleepWriteResult, SpeakerOpResult, SpeakerPage, SpeakersList,
  StatsResult, StatusResult, StoreInfo, StoreOpResult, StoreResult, StoreSettings, UpdateResult, UsageResult, WhyResult,
  WorkAroundResult, WorkCloseResult, WorkResult, WorkState, WriteOptions,
} from "./types.js";
export type {
  AddTurnOptions, AroundPiece, AroundResult, AskHistory, AskReadiness, AskReason, AskResult, AskUsage, BulkOptions,
  BulkSegment, ClearWindowResult, Clock, DefaultSpeakers, EngramCatalog, EngramInfo, EngramResult, ForgetSpeakerResult,
  HistoryTurn, ImageBytes, ImageDeleteResult, ImageInput, ImagePage, LineageResult, LineageStep, Memory, MemoryPage,
  ModelCapabilities, ModelInfo, NumberedMemory, RateLimit, RecallResult, RecallRoom, RelabelResult, Repeated,
  RetrievalsPage, RevisionsResult, RoomLanding, RouterExchange, SearchFilters, SearchOptions, SearchResult, SeenMemory,
  SeenResult, SelfSearchResult, SettingsChange, SkillDefinition, SkillMdOptions, SleepCursor, SleepDoneResult, SleepFile,
  SleepFileHistory, SleepFileWrite, SleepFiles, SleepNotes, SleepNotesWriteResult, SleepPage, SleepVerifyResult,
  SleepWriteResult, SpeakerInfo, SpeakerOpResult, SpeakerPage, SpeakersList, StatsResult, StatusResult, StoreInfo,
  StoreOpResult, StoreResult, StoreSettings, UpdateResult, Usage, UsageResult, WhyResult, WorkAroundResult,
  WorkCloseResult, WorkResult, WorkRoom, WorkState, WriteOptions,
} from "./types.js";

const VERSION = "2.2.50";
const RUNTIME = (() => {
  const p = (globalThis as any)?.process;
  return p?.version ? ` (node/${p.version}; ${p.platform}-${p.arch})` : "";
})();
const USER_AGENT = `wontopos-node/${VERSION}${RUNTIME}`;

function logDebug(msg: string): void {
  const env = (globalThis as any)?.process?.env;
  if (typeof env?.WONTOPOS_LOG === "string" && env.WONTOPOS_LOG.toLowerCase() === "debug") {
    console.error(`wontopos: ${msg}`);
  }
}
const DEFAULT_MODEL = "tablet-2";

/** @deprecated Test hook. */
export function _resetStoreIdWarnings(): void {
  warnedStoreIds.clear();
}
export const SEARCH_LIMIT_MIN = 5;
export const SEARCH_LIMIT_MAX = 20;

export const CONTEXT_LIMIT_MIN = 0;
export const CONTEXT_LIMIT_MAX = 20;

/** @deprecated Test hook. */
export function _resetRetirementWarnings(): void {
  warnedRetirements.clear();
}

/** What a `WosError` carries beyond its status, message and request id. */
export interface WosErrorInit {
  type?: string;
  details?: Record<string, unknown>;
  retryAfter?: number;
  cause?: unknown;
}

/** Thrown when a call gets no response, an answer with a non-2xx status, or an answer this client cannot use. */
export class WosError extends Error {
  readonly status: number;
  readonly requestId?: string;
  readonly type?: string;
  /** The rest of the service's error object. */
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, requestId?: string, init?: WosErrorInit) {
    super(
      `[${status}] ${message}${requestId ? ` (request_id: ${requestId})` : ""}`,
      init?.cause === undefined ? undefined : { cause: init.cause },
    );
    this.name = new.target.name;
    this.status = status;
    this.requestId = requestId;
    this.type = init?.type;
    this.details = init?.details;
  }

  /** The service's own code for the error, or `undefined` when it sent none. */
  get code(): string | undefined {
    const c = this.details?.code;
    return typeof c === "string" ? c : undefined;
  }
}

/** The request got no response. `status` is 0. */
export class APIConnectionError extends WosError {}
/** 400, 413 or 422: the request was not accepted as sent. */
export class BadRequestError extends WosError {}
/** 401: the API key is missing, wrong or revoked. */
export class AuthenticationError extends WosError {}
/** 402: no card on file, the balance is used up, or a spend limit is reached. */
export class PaymentRequiredError extends WosError {}
/** 403: the key or model may not do this. */
export class PermissionDeniedError extends WosError {}
/** 404: the store or resource does not exist. */
export class NotFoundError extends WosError {}
/** 409: the request conflicts with another write or with the store's current state. */
export class ConflictError extends WosError {
  /** The existing store id this one collides with, set only on that conflict. */
  readonly conflictsWith?: string;
  constructor(status: number, message: string, requestId?: string, init?: WosErrorInit) {
    super(status, message, requestId, init);
    const c = init?.details?.conflicts_with;
    this.conflictsWith = typeof c === "string" ? c : undefined;
  }
}
/** 410: the model this call named is retired. */
export class GoneError extends WosError {}
/** 429: too many requests. */
export class RateLimitError extends WosError {
  /** Seconds the service asked to wait, when it said. */
  readonly retryAfter?: number;
  constructor(status: number, message: string, requestId?: string, init?: WosErrorInit) {
    super(status, message, requestId, init);
    const r = init?.retryAfter;
    this.retryAfter = typeof r === "number" && Number.isFinite(r) && r >= 0 ? r : undefined;
  }
}
/** 5xx: the service failed, or (501) the model does not serve the call. */
export class ServerError extends WosError {}

const GONE_HINT = "This model is retired; listModels() lists the ones you can use.";
const ADMIN_ONLY = "Only an admin key lists stores; this is a standard API key.";

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

function errorFor(status: number, message: string, requestId?: string, init?: WosErrorInit): WosError {
  const Cls =
    status === 0
      ? APIConnectionError
      : status === 410 && init?.details?.code === "sleep_expired"
        ? WosError
        : STATUS_ERRORS[status] ?? (status >= 500 && status < 600 ? ServerError : WosError);
  return new Cls(status, message, requestId, init);
}

/** Options of `sleep`. */
export interface SleepOptions {
  /** The caller that reads; its model defaults to `claude-sonnet-5-5`. */
  llm: ModelCallerLike;
  /** The caller that combines, writes and tidies (default `llm`). */
  mergeLlm?: ModelCallerLike;
  /** The name the sleep calls the being by (default `"the assistant"`). */
  being?: string;
  /** The assistant's speaker name; default the store's `default_speakers.assistant`, else the sleep is refused. */
  assistant?: string;
  /** The being's prompt, which becomes the core's `## Me` the first time. */
  prompt?: string;
  settings?: SleepSettings;
  /** The sleep's day, "YYYY-MM-DD HH:MM" or "YYYY-MM-DD" (default the person's now). */
  today?: string;
  since?: string;
  sleepId?: string;
  /** End the store's last sleep here, unless a part went unread or the merge came back unshaped (default `true`). */
  done?: boolean;
  lineTime?: "created_at" | "event_date";
  /** Counts text for the files' sizes (default an estimate) and, when given, for the lines read. */
  countTokens?: (text: string) => number;
  /** What one call may write (default 16,000). */
  maxTokens?: number;
  progress?: (line: string) => void;
}

/** Options of `sleepEstimate`. */
export interface SleepEstimateOptions {
  /** USD per million input tokens; give both prices or neither (default Claude Sonnet 5.5's). */
  inputPrice?: number;
  /** USD per million output tokens; give both prices or neither (default Claude Sonnet 5.5's). */
  outputPrice?: number;
  settings?: SleepSettings;
  since?: string;
  countTokens?: (text: string) => number;
}

export interface SleepEstimate {
  /** Pass to `sleep` as `sleepId` to read the same memories. */
  sleep_id: string | null;
  memories: number;
  tokens: number;
  parts: number;
  readers: number;
  input_tokens: number;
  output_tokens: number;
  /** In USD. */
  cost: number;
  basis: {
    sleep_version: string;
    model: string;
    effort: string;
    prompt_caching: boolean;
    prices: [number, number];
    margin: number;
  };
  sleepy: boolean;
}

export interface SleepResult {
  sleep_id: string;
  sleep_version: string;
  today: string;
  memories: number;
  tokens: number;
  seeded: boolean;
  readers?: number;
  combine_rounds?: number;
  items: { kind: string; topic: string; text: string; evidence: string[] }[];
  items_dropped_by_check?: number;
  applied: Record<string, unknown>[];
  refused: { edit?: Record<string, unknown>; proposal?: Record<string, unknown>; why: string }[];
  written: Record<string, number>;
  proposals?: Record<string, unknown>[];
  ripe?: string[];
  notes?: string[];
  folds?: Record<string, unknown>[];
  settled?: { section: string; how: string }[];
  deduped?: { file: number; section: string }[];
  tidied?: Record<string, unknown>[];
  rooms?: { file: number; before: number; after: number | null }[];
  mixed?: Record<string, unknown>[];
  /** Every model call, with its tokens. */
  log: Record<string, unknown>[];
  secs: number;
  llm_in: number;
  llm_out: number;
  done: SleepDoneResult | null;
  [key: string]: unknown;
}

/** @deprecated Test hook. */
export function _resetFilterWarnings(): void {
  warnedFilterKeys.clear();
}

/** The part of an `AbortSignal` the client uses. */
export interface AbortSignalShape {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** The runtime's `AbortSignal` type, or `AbortSignalShape` where it has none. */
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

/** The runtime's `fetch` type, or a structural signature where it has none. */
export type FetchLike = typeof globalThis extends { fetch: infer F }
  ? F
  : (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

export interface ClientOptions {
  apiKey: string;
  /** API base URL (default the hosted service). */
  baseUrl?: string;
  /** Per-attempt timeout in ms. */
  timeoutMs?: number;
  model?: string;
  /** The person's clock, UTC offset in hours. */
  tz?: number;
  userId?: string;
  /** Retries of a failed call before throwing; 0 disables them (default 2). */
  maxRetries?: number;
  /** Alias of `maxRetries`. */
  retries?: number;
  /** A total time budget for one call across every retry, in ms. */
  deadlineMs?: number;
  signal?: AbortSignalLike;
  fetch?: FetchLike;
  /** Run in a browser page against a Wontopos host, and with the router's `key` or `skillKey`, both refused by default because a key would be readable there. */
  dangerouslyAllowBrowser?: boolean;
  router?: RouterOptions;
}

/** What a code skill's function gets beside its input. */
export interface SkillContext {
  store: string;
  request: string;
  /** What the router added for the skill, or `""`. */
  note: string;
  askId: string;
  speaker?: string;
  /** Aborted when the ask's time runs out or its caller cancels it. */
  signal: AbortSignalLike;
}

/** A code skill's function: the checked input in, the result out. */
export type SkillHandler = (input: Record<string, unknown>, ctx: SkillContext) => unknown;

/** One call to a language model, in no provider's terms. */
export interface ModelCall {
  purpose: "router" | "skill" | "sleep";
  model: string;
  /** The system prompt in parts, the most stable first. */
  system: string[];
  user: string;
  maxTokens: number;
  effort?: string;
  /** The JSON Schema the answer must fit. */
  schema?: Record<string, unknown>;
  systemTokens?: number;
  /** Aborted when the ask's time runs out or its caller cancels it. */
  signal: AbortSignalLike;
}

/** What a caller returns for one call. */
export interface ModelReply {
  text: string;
  /** Why it stopped: `"end"`, `"max_tokens"`, `"refusal"` or the provider's own word. */
  stop: string;
  usage?: Record<string, unknown>;
}

/** Calls a language model for the router, LLM skills or a sleep.
 *  Throw a `ModelCallError` for a provider's error answer. */
export interface ModelCaller {
  call(call: ModelCall): Promise<ModelReply>;
  /** The input tokens `call` would send, without running it. */
  countTokens?(call: ModelCall): Promise<number>;
  /** The model this caller uses when the client names none. */
  model?: string;
  /** Where the caller sends its key; the client refuses a Wontopos host. */
  baseUrl?: string;
}

/** A caller, or just its `call` function. */
export type ModelCallerLike = ModelCaller | ((call: ModelCall) => Promise<ModelReply>);

/** A provider's error answer, as a caller reports it. */
export class ModelCallError extends Error {
  readonly status: number;
  readonly type?: string;
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly reason?: string;
  constructor(
    status: number,
    message: string,
    init: { type?: string; retryAfterMs?: number; requestId?: string; reason?: string; cause?: unknown } = {},
  ) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ModelCallError";
    this.status = status;
    this.type = init.type;
    this.retryAfterMs = init.retryAfterMs;
    this.requestId = init.requestId;
    this.reason = init.reason;
  }
}

/** The router's limits. */
export interface RouterLimits {
  /** Asks per answer, the same store and `turn` (default 3). */
  perAnswer?: number;
  /** Asks per store within `windowMs`, for asks without a `turn` (default 3). */
  perWindow?: number;
  /** Default 60000. */
  windowMs?: number;
  /** Time the asks of one answer may take together, in ms (default 75000). */
  timeMs?: number;
  /** Asks per store per day (default 200). */
  perDay?: number;
}

/** The router behind `ask`: its callers, models, prompt, skill functions and limits. */
export interface RouterOptions {
  /** The Anthropic key of the router's default caller, and of the skills' too unless `skillKey` is set. */
  key?: string;
  /** A separate Anthropic key for LLM skills (default `key`). */
  skillKey?: string;
  /** The router's model (default the caller's own, else `claude-haiku-5-5`). */
  routerModel?: string;
  /** The router's caller (default the Anthropic caller with `key`). */
  routerCaller?: ModelCallerLike;
  /** The model of LLM skills (default the skill caller's own, else `claude-haiku-5-5`). */
  skillModel?: string;
  /** The caller of LLM skills (default the Anthropic caller with `skillKey`, else `key`). */
  skillCaller?: ModelCallerLike;
  callers?: Record<string, ModelCallerLike>;
  /** The router's output budget, 2000 (the default) to 128000. */
  maxTokens?: number;
  prompt?: string;
  name?: string;
  /** The person's IANA time zone; default the client's `tz`, and `ask` refuses without either. */
  timeZone?: string;
  handlers?: Record<string, SkillHandler>;
  limits?: RouterLimits;
  /** The API origin of the callers made from `key` and `skillKey` (default `https://api.anthropic.com`). */
  providerBaseUrl?: string;
  providerFetch?: FetchLike;
}

/** Per-call options for `ask`. */
export interface AskOptions {
  userId?: string;
  /** Your id for the answer this ask belongs to; asks with the same turn share its limits. */
  turn?: string | number;
  speaker?: string;
  history?: "use" | "none";
  signal?: AbortSignalLike;
}

/** Per-call options for `runSkill`. */
export interface RunSkillOptions {
  userId?: string;
  request?: string;
  note?: string;
  speaker?: string;
  /** The `askId` of the `needs_confirmation` answer. */
  askId?: string;
  signal?: AbortSignalLike;
}

const DEFAULT_USER = "default";

/** The Wontopos memory client. */
export class Client {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutSet?: number;
  private readonly timeoutMs: number;
  private readonly storeTimeoutMs: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly deadlineMs?: number;
  private readonly signal?: AbortSignalLike;
  private readonly fetchImpl: (url: string, init: FetchInitLike) => Promise<Response>;
  private readonly userinfo: boolean;
  private readonly pageRelative: boolean;
  private readonly customFetch: boolean;
  private readonly allowBrowser: boolean;
  private readonly defaultUser: string;
  private readonly tz?: number;
  private routerState: RouterState;
  private _rateLimit: RateLimit | null = null;
  private _billedTo: "balance" | null = null;
  private _weekUsed: number | null = null;

  /** Quota from the most recent call, or `null` before the first call. */
  get rateLimit(): RateLimit | null {
    return this._rateLimit;
  }

  /** `"balance"` when the most recent call was paid from API credit after a plan's week ran out. */
  get billedTo(): "balance" | null {
    return this._billedTo;
  }

  /** The percent of the plan's week used, from the latest answer of any status with a valid `X-WOS-Week-Used`, or `null` after a successful answer without one.
   *  `null` before the first such answer, and on a fresh copy. */
  get weekUsed(): number | null {
    return this._weekUsed;
  }

  constructor(opts: ClientOptions) {
    const key = (opts?.apiKey ?? "").trim();
    if (!key) throw new Error("apiKey is required");
    if (/\s/.test(key)) throw new Error("apiKey contains whitespace - check for a stray newline or paste error");
    if (/[\x00-\x1f\x7f]/.test(key))
      throw new Error("apiKey contains a control character - check for a stray byte or paste error");
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7f]/.test(key)) {
      const bad = key.match(/[^\x00-\x7f]/)?.[0];
      throw new Error(
        `apiKey contains a non-ASCII character (${JSON.stringify(bad)}) - rich text turns '-' into an ` +
          "en dash; copy the key from a plain-text field",
      );
    }
    if (key.startsWith("sk-")) {
      throw new Error("apiKey starts with sk-, so it is a model provider's key: give the Wontopos key here (it starts with wos-).");
    }
    this.apiKey = key;
    const rawBase = opts.baseUrl ?? DEFAULT_BASE_URL;
    if (typeof rawBase !== "string") throw new Error("baseUrl must be a string");
    const trimmed = rawBase.replace(BASE_URL_ENDS, "");
    // eslint-disable-next-line no-control-regex
    if (/[\s\\\u0000-\u001f\u007f]/.test(trimmed)) {
      throw new Error(`baseUrl contains whitespace, a backslash or a control character: ${JSON.stringify(shownBase(trimmed))}`);
    }
    this.base = trimmed.replace(/\/+$/, "");
    if (/[?#]/.test(this.base)) {
      throw new Error("baseUrl has a ? query or a # anchor: give the service root without them, e.g. https://api.wontopos.com");
    }
    const url = parseBase(this.base);
    const parsed = url ?? (pageHref() === undefined ? asPageRelative(this.base) : undefined);
    if (!parsed || (tryUrl(this.base) && !/^[^:]*:\/\/[^/]/.test(this.base))) throw new Error(notAUrl(trimmed));
    this.pageRelative = !url;
    this.userinfo = Boolean(parsed.username || parsed.password);
    this.allowBrowser = optBool(opts.dangerouslyAllowBrowser, "dangerouslyAllowBrowser") === true;
    if (!this.allowBrowser && inBrowserPage() && isServiceHost(hostKey(parsed.hostname))) {
      throw new Error(BROWSER_REFUSAL);
    }
    this.timeoutSet = checkMs(opts.timeoutMs, "timeoutMs");
    this.timeoutMs = this.timeoutSet ?? DEFAULT_TIMEOUT_MS;
    this.storeTimeoutMs = this.timeoutSet ?? STORE_TIMEOUT_MS;
    this.model = opts.model ?? DEFAULT_MODEL;
    if (this.model && !MODEL_RE.test(this.model)) {
      throw new Error(`invalid model name: ${JSON.stringify(this.model)} (letters, digits, '.', '_', '-' only)`);
    }
    if (opts && "userId" in opts && opts.userId === undefined) {
      throw new Error(
        "new Client() needs a store id in userId, or no userId option at all. It was given " +
          "undefined. That is usually a lookup that found nothing. Leave userId out to use the default store.",
      );
    }
    assertUsableStoreId(opts.userId);
    this.defaultUser = opts.userId ?? DEFAULT_USER;
    if (opts.tz != null) tzMinutes(opts.tz);
    this.tz = opts.tz ?? undefined;
    const retries = checkRetries(opts.retries, "retries");
    this.maxRetries = checkRetries(opts.maxRetries, "maxRetries") ?? retries ?? 2;
    this.deadlineMs = checkMs(opts.deadlineMs, "deadlineMs");
    this.signal = opts.signal;
    const f = opts.fetch as unknown;
    if (f !== undefined && typeof f !== "function") {
      throw new Error("fetch must be a function (a fetch-compatible transport)");
    }
    this.customFetch = f !== undefined && !DEFAULT_TRANSPORTS.has(f as object);
    this.fetchImpl = (f ?? defaultTransport()) as any;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("no fetch available in this runtime — pass one as `fetch` (Node 18+ has it built in; older Node needs undici)");
    }
    this.routerState = new RouterState(opts.router, this.base, this.allowBrowser, this.apiKey);
    this.headers = {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    };
    if (this.model) this.headers["X-WOS-Model"] = this.model;
    if (plainHttpOnce(`baseUrl\u0000${this.base}`, url)) {
      console.warn(
        "wontopos: baseUrl uses plain HTTP on a non-local host, so the API key travels unencrypted. Use https://."
      );
    }

    Object.defineProperty(this, "apiKey", { enumerable: false });
    Object.defineProperty(this, "headers", { enumerable: false });
    Object.defineProperty(this, "routerState", { enumerable: false });
  }

  /** A client whose key comes from `WONTOPOS_API_KEY` (or `WOS_API_KEY`). */
  static fromEnv(opts: Omit<ClientOptions, "apiKey"> = {}): Client {
    const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined;
    const key = [env?.WONTOPOS_API_KEY, env?.WOS_API_KEY].find((v) => v && v.trim());
    if (!key) throw new Error("set WONTOPOS_API_KEY (or WOS_API_KEY) in the environment");
    return new Client({ ...opts, apiKey: key });
  }

  /** The client with its key and any URL password redacted. */
  toJSON(): Record<string, string> {
    return { baseUrl: maskBase(this.base), model: this.model, userId: this.defaultUser, apiKey: maskKey(this.apiKey) };
  }

  /** The client with its key and any URL password redacted. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Client(${maskBase(this.base)}, model=${this.model}, userId=${this.defaultUser}, apiKey=${maskKey(this.apiKey)})`;
  }

  private clock(tz?: number): number | undefined {
    const t = tz ?? this.tz;
    return t === undefined ? undefined : tzMinutes(t);
  }

  private defaultTz(body: Record<string, unknown>): Record<string, unknown> {
    if (body.tz === undefined && this.tz !== undefined) body.tz = this.tz;
    return body;
  }

  private writeExtras(body: Record<string, unknown>, opts: WriteOptions): Record<string, unknown> {
    const m = this.clock(opts.tz);
    if (m !== undefined) body.tz_offset_minutes = m;
    if (opts.workId != null) body.work_id = checkId(opts.workId, "workId");
    return body;
  }

  private look(body: Record<string, unknown>, opts: { rooms?: unknown; tz?: number }): Record<string, unknown> {
    const m = this.clock(opts.tz);
    if (opts.rooms == null) return body;
    if (opts.rooms === false) {
      body.rooms = false;
      return body;
    }
    checkRooms(opts.rooms);
    body.rooms = opts.rooms;
    if (m !== undefined) body.tz_offset_minutes = m;
    return body;
  }

  private async work(op: string, body: Record<string, unknown>): Promise<any> {
    return memoryRecords(await this.post(`/api/v1/memory/work/${op}`, body));
  }

  private uid(userId?: string): string {
    assertUsableStoreId(userId);
    const id = userId ?? this.defaultUser;
    warnIfStoreIdCollapses(id);
    return id;
  }

  private clone(overrides: Partial<ClientOptions>): Client {
    const c = new Client({
      apiKey: this.apiKey,
      baseUrl: this.base,
      timeoutMs: this.timeoutSet,
      model: this.model,
      userId: this.defaultUser,
      tz: this.tz,
      maxRetries: this.maxRetries,
      fetch: this.fetchImpl as unknown as FetchLike,
      deadlineMs: this.deadlineMs,
      signal: this.signal,
      dangerouslyAllowBrowser: this.allowBrowser,
      ...overrides,
    });
    c.routerState = this.routerState;
    return c;
  }

  /** A copy of this client that uses `model` for every call. */
  withModel(model: string): Client {
    return this.clone({ model });
  }

  /** A copy of this client on the person's clock, `tz` hours from UTC. */
  withTz(tz: number): Client {
    tzMinutes(tz);
    return this.clone({ tz });
  }

  /** A copy of this client with `userId` as its default store. */
  withUser(userId: string): Client {
    if (userId === undefined) {
      throw new Error(
        "withUser() needs a store id. It was called with undefined — usually a lookup that " +
          "found nothing. Use the client's own default instead of calling withUser at all.",
      );
    }
    return this.clone({ userId });
  }

  /** A copy of this client bound to a caller's `AbortSignal`. */
  withSignal(signal: AbortSignalLike): Client {
    return this.clone({ signal });
  }

  /** A copy of this client with a total time budget per call across every retry, in ms. */
  withDeadline(deadlineMs: number): Client {
    return this.clone({ deadlineMs });
  }

  /** A copy of this client with another per-attempt timeout, in ms. */
  withTimeout(timeoutMs: number): Client {
    return this.clone({ timeoutMs });
  }

  /** A copy of this client with another retry budget; 0 disables retries. */
  withRetries(maxRetries: number): Client {
    return this.clone({ maxRetries });
  }

  /** Store one memory. */
  async add(content: string, userId?: string, metadata: Record<string, unknown> = {}, opts: WriteOptions = {}): Promise<StoreResult> {
    metadata ??= {};
    checkMetadataKeys(metadata);
    if (typeof metadata.speaker === "string") metadata = { ...metadata, speaker: checkWrittenSpeaker(metadata.speaker, "speaker") };
    const body = this.writeExtras({ user_id: this.uid(userId), content, metadata }, opts);
    optBool(opts.window, "window");
    if (opts.windowRole != null && opts.window !== true) {
      throw new Error("windowRole needs window: true: it names who said the line in the window.");
    }
    if (opts.window === true) {
      body.window = true;
      if (opts.windowRole != null) body.window_role = checkWindowRole(opts.windowRole);
    }
    if (opts.image != null) body.image = normalizeImage(opts.image);
    warnOnUnknownMetadata(metadata);
    return this.write("/api/v1/memory/store", body, writeKey(opts, "add"));
  }
  /** Alias of `add`. */
  async store(content: string, userId?: string, metadata: Record<string, unknown> = {}, opts: WriteOptions = {}): Promise<StoreResult> {
    return this.add(content, userId, metadata, opts);
  }
  /** Store a conversation turn: the person's message and the assistant's reply. */
  async addTurn(userMsg: string, assistantMsg: string, userId?: string, opts: AddTurnOptions = {}): Promise<StatusResult> {
    refuseWindow(opts, "a turn always enters the window");
    if (![userMsg, assistantMsg].some((m) => typeof m === "string" && m.trim())) {
      throw new Error("userMsg and assistantMsg are both blank: there is no turn to store.");
    }
    const body = this.writeExtras({ user_id: this.uid(userId), user_msg: userMsg, assistant_msg: assistantMsg }, opts);
    if (opts.createdAt != null) body.created_at = checkTime(opts.createdAt, "createdAt");
    if (opts.userSpeaker != null) body.user_speaker = checkWrittenSpeaker(opts.userSpeaker, "userSpeaker");
    if (opts.assistantSpeaker != null) body.assistant_speaker = checkWrittenSpeaker(opts.assistantSpeaker, "assistantSpeaker");
    return this.write("/api/v1/memory/store-turn", body, writeKey(opts, "addTurn"));
  }
  /** Bulk-ingest a large blob of text in one call. */
  async addBulk(
    content?: string | null,
    userId?: string,
    category = "general",
    timestamp?: string,
    opts: BulkOptions = {},
  ): Promise<StatusResult> {
    const hasContent = content !== undefined && content !== null;
    const hasSegments = opts.segments !== undefined && opts.segments !== null;
    if (hasContent && hasSegments) throw new Error("addBulk takes content or segments, not both.");
    if (!hasContent && !hasSegments) {
      throw new Error("addBulk needs content, or segments: a list of { content, speaker?, created_at? }.");
    }
    if (hasSegments && opts.speaker != null) {
      throw new Error("speaker goes with content: with segments, each segment names its own speaker.");
    }
    const body: Record<string, unknown> = { user_id: this.uid(userId) };
    if (hasSegments) body.segments = bulkSegments(opts.segments);
    else body.content = content;
    if (opts.speaker != null) body.metadata = { speaker: checkWrittenSpeaker(opts.speaker, "speaker") };
    body.category = category ?? "general";
    if (timestamp) body.timestamp = timestamp;
    return this.write("/api/v1/memory/bulk-store", body, writeKey(opts, "addBulk"));
  }
  /** Supersede an old memory with new content. */
  async update(oldMemoryId: string, newContent: string, userId?: string, opts: WriteOptions = {}): Promise<UpdateResult> {
    if (opts.workId != null) throw new Error("workId is for add and addTurn: a correction does not answer a work.");
    refuseWindow(opts, "a correction is not a new line in the window");
    return this.write(
      "/api/v1/memory/supersede",
      this.writeExtras(
        { user_id: this.uid(userId), old_memory_id: checkId(oldMemoryId, "oldMemoryId"), new_content: filledText(newContent, "newContent") },
        opts,
      ),
      writeKey(opts, "update"),
    );
  }

  /** Search a store's memories. */
  async search(query: string, userId?: string, limit = 10, opts: SearchOptions = {}): Promise<Memory[]> {
    const body = this.searchBody(query, userId, limit, opts);
    const r = await this.post("/api/v1/memory/search", body);
    return mergeResults(r, isPlainObject(body.filters) && Object.keys(body.filters).length > 0);
  }
  private searchBody(query: string, userId: string | undefined, limit: number | undefined, opts: SearchOptions): Record<string, unknown> {
    checkSearchOpts(opts);
    const { extra, ...known } = opts;
    const fields: Record<string, unknown> = { ...extra, ...givenOpts(known) };
    checkFilters(fields.filters);
    limit ??= 10;
    checkCount(limit, "limit");
    return this.defaultTz({ ...fields, user_id: this.uid(userId), query, max_results: limit });
  }
  /** Search, with the assistant's own words kept apart from the other memories. */
  async searchSelf(query: string, userId?: string, limit = 10, opts: SearchOptions = {}): Promise<SelfSearchResult> {
    const r = await this.post("/api/v1/memory/search", this.searchBody(query, userId, limit, opts));
    return { memories: asRecords<Memory>(r.memories), self_memories: asRecords<Memory>(r.self_memories) };
  }
  /** Search, and keep every field the answer came with. */
  async searchFull(query: string, userId?: string, limit = 10, opts: SearchOptions = {}): Promise<SearchResult> {
    const r = await this.post("/api/v1/memory/search", this.searchBody(query, userId, limit, opts));
    return {
      ...r,
      memories: asRecords<Memory>(r.memories),
      self_memories: asRecords<Memory>(r.self_memories),
      images: asRecords<Memory>(r.images),
    };
  }
  /** One-call context for an LLM: recent turns, long-term memories and the context around them. */
  async recall(
    query: string,
    userId?: string,
    opts: {
      form?: string;
      tz?: number;
      /** Long-term memories, 5-20 (default 10). */
      limit?: number;
      /** Context around the best memory, 0-20 (default 10). */
      context_limit?: number;
      /** Rooms to look in too: `"all"`, a name such as `"m0"`, or a list. */
      rooms?: string | string[] | boolean;
      /** One room to look in, such as `"m0"`. */
      room?: string;
      /** Memories from the rooms, 1-20. */
      roomLimit?: number;
      /** Tokens of context around each memory from the rooms, 0-20000. */
      roomExpandTokens?: number;
      /** Whether to look in long-term too. */
      longTerm?: boolean;
      /** End long-term where today begins. */
      longTermCutoff?: boolean;
      /** When today began (RFC3339). */
      todayStart?: string;
      /** Answer as of this time (RFC3339). */
      now?: string;
      /** Lines of the recent conversation, 0-500. */
      shortTermLimit?: number;
      /** Tokens of those lines, 0-8000; 0 sets no limit. */
      shortTermBudgetTokens?: number;
      /** Image memories, 0-5. */
      maxImages?: number;
      filters?: SearchFilters;
      /** Only this person's words. */
      speaker?: string;
      /** Also recall memories a later one replaced. */
      includeSuperseded?: boolean;
    } = {},
  ): Promise<RecallResult> {
    checkOpts(opts, KNOWN_RECALL_KEYS, "recall");
    checkFilters(opts.filters);
    const body: Record<string, unknown> = { user_id: this.uid(userId), query };
    if (opts.limit != null) {
      checkCount(opts.limit, "limit");
      body.limit = opts.limit;
    }
    if (opts.context_limit != null) {
      checkContextLimit(opts.context_limit);
      body.context_limit = opts.context_limit;
    }
    for (const [k, wire, min, max] of RECALL_COUNTS) {
      const v = optRange(opts[k], k, min, max);
      if (v !== undefined) body[wire] = v;
    }
    for (const [k, wire] of [
      ["longTerm", "long_term"],
      ["longTermCutoff", "long_term_cutoff"],
      ["includeSuperseded", "include_superseded"],
    ] as const) {
      const v = optBool(opts[k], k);
      if (v !== undefined) body[wire] = v;
    }
    for (const [k, wire] of [["todayStart", "today_start"], ["now", "now"]] as const) {
      if (opts[k] != null) body[wire] = checkId(opts[k], k);
    }
    if (opts.filters != null) body.filters = opts.filters;
    if (opts.speaker != null) body.speaker = opts.speaker;
    if (opts.room != null) {
      if (opts.rooms === false) throw new Error("room looks in one room and rooms: false in none: pass one or the other.");
      body.room = roomArg(opts.room);
      const m = this.clock(opts.tz);
      if (m !== undefined) body.tz_offset_minutes = m;
    }
    this.look(body, opts);
    return recallShape(await this.post("/api/v1/memory/recall", withForm(body, opts.form, opts.tz ?? this.tz)));
  }

  /** What was said around a memory, counted from it. */
  async around(
    memoryId: string,
    userId?: string,
    opts: { from?: number; to?: number; center?: number; held?: [number, number] } = {},
  ): Promise<AroundResult> {
    checkOpts(opts, KNOWN_AROUND_KEYS, "around");
    const body: Record<string, unknown> = { user_id: this.uid(userId), memory_id: checkId(memoryId, "memoryId") };
    putOffsets(body, opts);
    if (opts.held != null) {
      if (!Array.isArray(opts.held) || opts.held.length !== 2) throw new Error("held must be [first, last].");
      opts.held.forEach((v, i) => checkRange(v, `held[${i}]`, -200, 200));
      body.held = opts.held;
    }
    return withRecords(await this.post("/api/v1/memory/around", body), "pieces");
  }

  /** How a memory was reached, when it answered a work of three steps or more. */
  async why(memoryId: string, userId?: string): Promise<WhyResult> {
    return this.post("/api/v1/memory/why", { user_id: this.uid(userId), memory_id: checkId(memoryId, "memoryId") });
  }

  /** What this store handed out, newest first. */
  async retrievals(userId?: string, opts: { limit?: number; before?: string } = {}): Promise<RetrievalsPage> {
    checkOpts(opts, KNOWN_RETRIEVALS_KEYS, "retrievals");
    const body: Record<string, unknown> = { user_id: this.uid(userId) };
    const limit = optRange(opts.limit, "limit", 1, 200);
    if (limit !== undefined) body.limit = limit;
    if (opts.before != null) body.before = checkId(opts.before, "before");
    return withRecords(await this.post("/api/v1/memory/retrievals", body), "entries");
  }

  /** Run a built-in engram. */
  async engram(name: string, query: string, userId?: string, opts: { form?: string; tz?: number } = {}): Promise<EngramResult> {
    checkOpts(opts, KNOWN_ENGRAM_KEYS, "engram");
    this.clock(opts.tz);
    const body = { name: checkId(name, "name"), user_id: this.uid(userId), query };
    return this.post("/api/v1/engram/run", withForm(body, opts.form, opts.tz ?? this.tz));
  }
  /** Recent conversation turns (short-term memory). */
  async history(userId?: string): Promise<HistoryTurn[]> {
    const r = await this.post("/api/v1/memory/history", { user_id: this.uid(userId) });
    return asRecords<HistoryTurn>(r.turns);
  }
  /** The memories a line of the recent conversation had in hand when it was said. */
  async seen(at: string, userId?: string): Promise<SeenResult> {
    return withRecords(await this.post("/api/v1/memory/seen", { user_id: this.uid(userId), at: checkId(at, "at") }), "seen");
  }
  /** Empty the recent conversation, or with `upTo` only the lines last seen at or before it. */
  async clearWindow(userId?: string, opts: { upTo?: string } = {}): Promise<ClearWindowResult> {
    checkOpts(opts, KNOWN_CLEAR_WINDOW_KEYS, "clearWindow");
    const body: Record<string, unknown> = { user_id: this.uid(userId) };
    if (opts.upTo !== undefined && opts.upTo !== null) body.up_to = checkId(opts.upTo, "upTo");
    return this.post("/api/v1/memory/clear-window", body);
  }
  /** Memory counts for a store. */
  async stats(userId?: string): Promise<StatsResult> {
    return this.post("/api/v1/memory/stats", { user_id: this.uid(userId) });
  }

  /** What this key has spent, and what is left. */
  async usage(days = 7): Promise<UsageResult> {
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error(`days must be an integer between 1 and 365, got ${days}.`);
    }
    return this.request("GET", `/api/v1/won/usage?days=${days}`);
  }
  /** Fetch one memory by id. An unknown id rejects with `NotFoundError`. */
  async get(userId: string | undefined, memoryId: string): Promise<Memory> {
    const id = requiredId(memoryId, "memoryId is required — the id that add/store or listMemories returned.");
    return this.post("/api/v1/memory/get", { user_id: this.uid(userId), memory_id: id }).then(memoryFromGet);
  }
  /** One page of a store's memories. Pass `next_cursor` back as `cursor` for the next page. */
  async listMemories(userId?: string, opts: { limit?: number; cursor?: string } = {}): Promise<MemoryPage> {
    checkOpts(opts, KNOWN_LIST_MEMORIES_KEYS, "listMemories");
    const limit = optRange(opts.limit, "limit", 1, LIST_LIMIT_MAX);
    const body: Record<string, unknown> = { user_id: this.uid(userId), limit: limit ?? 100 };
    if (opts.cursor) body.cursor = opts.cursor;
    const r = await this.post("/api/v1/memory/list", body);
    const next = r.next_cursor === "" ? null : r.next_cursor ?? null;
    return { ...withCount(r, "memories", asRecords<Memory>(r.memories)), next_cursor: next } as MemoryPage;
  }
  /** Every memory in a store, one at a time, paging as it goes. */
  async *iterMemories(userId?: string, opts: { pageSize?: number } = {}): AsyncGenerator<Memory> {
    checkOpts(opts, KNOWN_PAGE_SIZE_KEYS, "iterMemories");
    const pageSize = optRange(opts.pageSize, "pageSize", 1, LIST_LIMIT_MAX) ?? 100;
    yield* walkPages(
      (cursor) => this.listMemories(userId, { limit: pageSize, cursor }),
      (p) => asRecords<Memory>(p.memories),
      (p) => (p.next_cursor ? [p.next_cursor, JSON.stringify(p.next_cursor)] : undefined),
    );
  }
  /** All of a store's memories, as a list. */
  async exportMemories(userId?: string): Promise<Memory[]> {
    const out: Memory[] = [];
    for await (const m of this.iterMemories(userId)) out.push(m);
    return out;
  }
  /** How many of this store's memories were edited after they were written (storing new ones never edits an old one), out of all of them: 0 means every memory is as it was first stored. */
  async revisions(
    userId?: string,
    opts: {
      /** Also return one page of the memories behind that count. */
      include?: "revised" | "unrevised";
      /** Memories per page, 5-20 (default 20). */
      limit?: number;
      /** `next_before` from the previous page. */
      before?: string;
      /** `next_skip_ids` from the previous page. */
      skipIds?: string[];
    } = {},
  ): Promise<RevisionsResult> {
    checkOpts(opts, KNOWN_REVISIONS_KEYS, "revisions");
    const inc: unknown = opts.include;
    if (inc !== undefined && inc !== null && inc !== "revised" && inc !== "unrevised") {
      throw new Error(`include must be "revised" or "unrevised", got ${JSON.stringify(inc)}.`);
    }
    const body = { ...(opts.include != null ? { include: opts.include } : {}), ...pageFields(opts), user_id: this.uid(userId) };
    return memoryRecords(await this.post("/api/v1/won/revisions", body));
  }

  /** The edits that followed one memory, oldest first. */
  async lineage(userId: string | undefined, memoryId: string): Promise<LineageResult> {
    const id = requiredId(memoryId, "memoryId is required — the memory whose history you want.");
    return withRecords(await this.post("/api/v1/memory/lineage", { user_id: this.uid(userId), memory_id: id }), "chain");
  }

  /** What one person said, newest first. */
  async bySpeaker(
    speaker: string,
    userId?: string,
    opts: { limit?: number; before?: string; skipIds?: string[] } = {},
  ): Promise<SpeakerPage> {
    checkOpts(opts, KNOWN_PAGE_KEYS, "bySpeaker");
    const who = requiredId(speaker, 'speaker is required — "me" for the assistant, or a person\'s name.');
    const page = pageFields(opts);
    return withRecords(await this.post("/api/v1/memory/by-speaker", { user_id: this.uid(userId), speaker: who, ...page }), "memories");
  }

  /** Check that the service is reachable and the API key works. */
  async ping(): Promise<boolean> {
    await this.request("GET", "/api/v1/memory/ping");
    return true;
  }

  /** What this API key may do: `"full"`, `"read"` or `"admin"`. */
  async keyScope(): Promise<string> {
    const r = await this.request("GET", "/api/v1/memory/ping");
    if (typeof r?.scope !== "string" || !r.scope) throw new WosError(200, "the answer carried no key scope");
    return r.scope;
  }

  /** The available models, each with its capabilities. */
  async listModels(): Promise<ModelInfo[]> {
    const data = await this.request("GET", "/api/v1/models");
    return asRecords<ModelInfo>(data.models);
  }

  /** The engrams and delivery forms the selected model can run. */
  async listEngrams(): Promise<EngramCatalog> {
    const data = await this.request("GET", "/api/v1/engram");
    return {
      ...(data as Record<string, unknown>),
      engrams: asRecords<EngramInfo>(data.engrams),
      forms: asRecords<EngramInfo>(data.forms),
      note: typeof data.note === "string" ? data.note : undefined,
    };
  }

  /** Create a store. A store must exist before it is written to or searched. */
  async createStore(userId?: string): Promise<StoreOpResult> {
    return this.post("/api/v1/memory/collection", { user_id: this.uid(userId) });
  }
  /** List your stores. */
  async listStores(): Promise<StoreInfo[]> {
    const r = await this.request("GET", "/api/v1/memory/collections");
    if (r?.admin_only === true) throw new PermissionDeniedError(403, ADMIN_ONLY);
    return asRecords<StoreInfo>(r.collections);
  }
  /** Delete a store and all its memories. */
  async deleteStore(userId: string): Promise<StoreOpResult> {
    const store = namedStore(userId, "userId is required (a non-blank string) — deleteStore never falls back to the default store.");
    return this.remove("/api/v1/memory/collection", { user_id: store });
  }

  /** Delete one memory by id. */
  async delete(userId: string | undefined, memoryId: string): Promise<StatusResult> {
    const id = requiredId(memoryId, "memoryId is required (non-blank). To delete every memory in a store, call deleteAll(userId) explicitly.");
    return this.post("/api/v1/memory/forget", { user_id: this.uid(userId), memory_id: id });
  }
  /** Delete all memories in a store; it also clears the store's time zone and speakers.
   *  On Scroll 2, set them again with `setSettings` and `addSpeaker` before the next write. */
  async deleteAll(userId: string): Promise<StatusResult> {
    const store = namedStore(userId, "userId is required (a non-blank string) for deleteAll — anything else would wipe the default store.");
    return this.post("/api/v1/memory/forget", { user_id: store });
  }

  /** All of a store's image memories, as a list. */
  async exportImages(userId?: string, opts: { pageSize?: number } = {}): Promise<Memory[]> {
    checkOpts(opts, KNOWN_PAGE_SIZE_KEYS, "exportImages");
    const out: Memory[] = [];
    for await (const m of this.iterImages(userId, opts)) out.push(m);
    return out;
  }

  /** Fetch the bytes of an image memory. */
  async getImage(userId: string | undefined, memoryId: string): Promise<ImageBytes> {
    const id = requiredId(memoryId, "memoryId is required — the id that add/store or listImages returned.");
    return this.requestBytes("/api/v1/memory/image", { user_id: this.uid(userId), memory_id: id });
  }

  /** Remove the photo from a memory; it can take the whole memory with it. */
  async forgetImage(
    userId: string | undefined,
    memoryId: string,
    opts: { preview?: boolean } = {},
  ): Promise<ImageDeleteResult> {
    checkOpts(opts, KNOWN_FORGET_IMAGE_KEYS, "forgetImage");
    const preview = previewOf(opts);
    const id = requiredId(memoryId, "memoryId is required — the id of the memory whose image you want removed.");
    const body: Record<string, unknown> = { user_id: this.uid(userId), memory_id: id };
    if (!preview) return this.remove("/api/v1/memory/image", body);
    body.preview = true;
    return this.request("DELETE", "/api/v1/memory/image", body);
  }

  /** One page of image memories, newest first, with the store's total count. */
  async listImages(
    userId?: string,
    opts: { limit?: number; before?: string; skipIds?: string[] } = {},
  ): Promise<ImagePage> {
    checkOpts(opts, KNOWN_PAGE_KEYS, "listImages");
    const page = pageFields(opts);
    return withRecords(await this.post("/api/v1/memory/images", { user_id: this.uid(userId), ...page }), "images");
  }

  /** Every image memory in a store, one at a time, paging as it goes. */
  async *iterImages(userId?: string, opts: { pageSize?: number } = {}): AsyncGenerator<Memory> {
    checkOpts(opts, KNOWN_PAGE_SIZE_KEYS, "iterImages");
    const pageSize = optRange(opts.pageSize, "pageSize", PAGE_LIMIT_MIN, PAGE_LIMIT_MAX);
    yield* walkPages(
      (at?: { before: string; skipIds?: string[] }) => this.listImages(userId, { limit: pageSize, ...at }),
      (p) => asRecords<Memory>(p.images),
      (p) => {
        if (!p.has_more || !p.next_before) return undefined;
        const skipIds = Array.isArray(p.next_skip_ids) ? p.next_skip_ids : undefined;
        return [{ before: p.next_before, skipIds }, `${p.next_before}|${(skipIds ?? []).join(",")}`];
      },
    );
  }

  /** The store's settings: its time zone, its speakers and every change to them. */
  async settings(userId?: string): Promise<StoreSettings> {
    return this.request("GET", `/api/v1/memory/settings?user_id=${encodeURIComponent(this.uid(userId))}`);
  }

  /** Set the store's time zone, its default speakers, or both. */
  async setSettings(
    userId?: string,
    opts: {
      timeZone?: string;
      defaultSpeakers?: { user?: string | null; assistant?: string | null };
      confirmedByUser?: boolean;
    } = {},
  ): Promise<StoreSettings> {
    checkOpts(opts, KNOWN_SET_SETTINGS_KEYS, "setSettings");
    const body: Record<string, unknown> = { user_id: this.uid(userId) };
    if (opts.timeZone !== undefined && opts.timeZone !== null) body.time_zone = checkId(opts.timeZone, "timeZone");
    const d: unknown = opts.defaultSpeakers;
    if (d !== undefined && d !== null) {
      if (typeof d !== "object" || Array.isArray(d)) {
        throw new Error(`defaultSpeakers must be an object such as { user: "Alice", assistant: "Wren" }, got ${JSON.stringify(d)}.`);
      }
      const named: Record<string, string | null> = {};
      for (const [role, name] of Object.entries(d)) {
        if (role !== "user" && role !== "assistant") {
          throw new Error(`defaultSpeakers takes user and assistant only, not ${JSON.stringify(role)}.`);
        }
        if (name === undefined) continue;
        named[role] = name === null ? null : checkWrittenSpeaker(name, `defaultSpeakers.${role}`);
      }
      if (!Object.keys(named).length) throw new Error("defaultSpeakers must name user, assistant or both.");
      body.default_speakers = named;
    }
    if (body.time_zone === undefined && body.default_speakers === undefined) {
      throw new Error("setSettings needs timeZone or defaultSpeakers: there is nothing else to set.");
    }
    const confirmed = optBool(opts.confirmedByUser, "confirmedByUser");
    if (confirmed !== undefined) body.confirmed_by_user = confirmed;
    return this.post("/api/v1/memory/settings", body);
  }

  /** Register a person for this store, before storing what they said. */
  async addSpeaker(speaker: string, userId?: string): Promise<SpeakerOpResult> {
    const who = checkWrittenSpeaker(speaker, "speaker");
    return this.post("/api/v1/memory/speakers", { user_id: this.uid(userId), speaker: who });
  }
  /** The store's registered people, each with its memory count. */
  async listSpeakers(userId?: string): Promise<SpeakersList> {
    return withRecords(await this.request("GET", `/api/v1/memory/speakers?user_id=${encodeURIComponent(this.uid(userId))}`), "speakers");
  }
  /** Unregister a person; their memories stay. */
  async removeSpeaker(speaker: string, userId?: string): Promise<SpeakerOpResult> {
    const who = checkName(speaker, "speaker");
    return this.remove("/api/v1/memory/speakers", { user_id: this.uid(userId), speaker: who });
  }

  /** Move memories from one speaker to another. */
  async relabelSpeaker(
    fromSpeaker: string,
    toSpeaker: string,
    userId?: string,
    opts: { memoryIds?: string[] } = {},
  ): Promise<RelabelResult> {
    checkOpts(opts, KNOWN_RELABEL_KEYS, "relabelSpeaker");
    const body: Record<string, unknown> = {
      user_id: this.uid(userId),
      from: checkName(fromSpeaker, "fromSpeaker"),
      to: checkWrittenSpeaker(toSpeaker, "toSpeaker"),
    };
    const ids: unknown = opts.memoryIds;
    if (ids !== undefined && ids !== null) {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > RELABEL_IDS_MAX) {
        const got = Array.isArray(ids) ? `${ids.length} ids` : typeof ids;
        throw new Error(
          `memoryIds must be a list of 1 to ${RELABEL_IDS_MAX} memory ids, got ${got}. ` +
            "Leave it out to relabel every memory under fromSpeaker.",
        );
      }
      body.memory_ids = ids.map((id, i) => checkId(id, `memoryIds[${i}]`));
    }
    return this.untilComplete("/api/v1/memory/speakers/relabel", body);
  }

  /** Delete everything a person said in this store. */
  async forgetSpeaker(
    speaker: string | string[],
    userId: string,
    opts: { preview?: boolean } = {},
  ): Promise<ForgetSpeakerResult> {
    checkOpts(opts, KNOWN_FORGET_SPEAKER_KEYS, "forgetSpeaker");
    requiredId(
      userId,
      "userId is required (a non-blank string) for forgetSpeaker: it deletes everything that person said in " +
        "the store, so it never falls back to the default store.",
    );
    const list: unknown[] = Array.isArray(speaker) ? speaker : [speaker];
    if (!list.length) throw new Error("speaker is required: one name, or a list of at least one name.");
    const speakers = list.map((s, i) => checkName(s, Array.isArray(speaker) ? `speaker[${i}]` : "speaker"));
    const preview = previewOf(opts);
    warnIfStoreIdCollapses(userId);
    const body: Record<string, unknown> = { user_id: userId, speakers };
    if (preview) return this.post("/api/v1/memory/forget", { ...body, preview: true });
    return this.untilComplete("/api/v1/memory/forget", body);
  }

  /** Open a working memory for one question. */
  async openWork(
    question: string,
    userId?: string,
    opts: {
      rooms?: string | string[] | boolean;
      tz?: number;
      maxImages?: number;
      /** Whether this work may bring the assistant's own lines (default on). */
      ownWords?: boolean;
      /** The diversity this work asks for, "none", "mmr", "temporal" or "full" (default unset: none is sent). */
      diversity?: "none" | "mmr" | "temporal" | "full";
    } = {},
  ): Promise<WorkResult> {
    checkOpts(opts, KNOWN_OPEN_WORK_KEYS, "openWork");
    const body = this.look({ user_id: this.uid(userId), question: checkId(question, "question") }, opts);
    const maxImages = optRange(opts.maxImages, "maxImages", 0, MAX_IMAGES_MAX);
    if (maxImages !== undefined) body.max_images = maxImages;
    if (checkOwnWords(opts.ownWords) === false) body.filters = { source_types: [...NOT_ASSISTANT_SOURCES] };
    const diversity = checkDiversity(opts.diversity);
    if (diversity !== undefined) body.diversity = diversity;
    return this.work("open", body);
  }

  /** A step: search again with a question of your own. */
  async workSearch(
    workId: string,
    query: string,
    userId?: string,
    opts: { rooms?: string | string[] | boolean; tz?: number } = {},
  ): Promise<WorkResult> {
    checkOpts(opts, KNOWN_LOOK_KEYS, "workSearch");
    const body = { user_id: this.uid(userId), work_id: checkId(workId, "workId"), query: checkId(query, "query") };
    return this.work("search", this.look(body, opts));
  }

  /** The next 20 memories for the work's question, at most three times. */
  async workDeeper(workId: string, userId?: string): Promise<WorkResult> {
    return this.work("deeper", { user_id: this.uid(userId), work_id: checkId(workId, "workId") });
  }

  /** A step: what was said around memory [n] that this work does not have yet. */
  async workAround(
    workId: string,
    n: number,
    userId?: string,
    opts: { from?: number; to?: number; center?: number } = {},
  ): Promise<WorkAroundResult> {
    checkOpts(opts, KNOWN_WORK_AROUND_KEYS, "workAround");
    checkRange(n, "n", 1, 200);
    const body: Record<string, unknown> = { user_id: this.uid(userId), work_id: checkId(workId, "workId"), n };
    putOffsets(body, opts);
    return withRecords(await this.work("around", body), "pieces");
  }

  /** Mark the work as waiting on the person. Pass their reply to `workConfirm`. */
  async workAsk(workId: string, userId?: string): Promise<WorkResult> {
    return this.work("ask", { user_id: this.uid(userId), work_id: checkId(workId, "workId") });
  }

  /** Answer a work waiting on the person with their yes or no. */
  async workConfirm(workId: string, confirmed: boolean, userId?: string): Promise<WorkResult> {
    if (typeof confirmed !== "boolean") throw new Error(`confirmed must be true or false, got ${JSON.stringify(confirmed)}.`);
    return this.work("confirm", { user_id: this.uid(userId), work_id: checkId(workId, "workId"), confirmed });
  }

  /** Close a work, with the memory that answered if one did. */
  async closeWork(workId: string, userId?: string, opts: { answerId?: string } = {}): Promise<WorkCloseResult> {
    checkOpts(opts, new Set(["answerId"]), "closeWork");
    const body: Record<string, unknown> = { user_id: this.uid(userId), work_id: checkId(workId, "workId") };
    if (opts.answerId != null) body.answer_id = checkId(opts.answerId, "answerId");
    return this.work("close", body);
  }

  /** The open works on this store, and the traces of recent ones. */
  async workState(userId?: string): Promise<WorkState> {
    return this.post("/api/v1/memory/work/state", { user_id: this.uid(userId) });
  }

  /** Memory tools an LLM uses to look through a store by itself. */
  memoryTools<Images extends boolean = false>(
    userId?: string,
    opts: {
      /**
       * "S-2-live" is for everyday conversation: its first look searches with the question and the last two lines
       * said in the last five minutes, leaves out the assistant's own lines and asks for full diversity.
       * "S-2" is for measuring memory performance: it answers one question at a time, as a benchmark asks.
       * Default: the preset of the client's model, "S-2-live" on scroll-2.
       */
      preset?: string;
      tz?: number;
      rooms?: string | string[] | boolean;
      speakers?: boolean;
      assistant?: string;
      dates?: boolean;
      images?: Images;
      sleep?: boolean;
      today?: string;
      seen?: boolean;
      usage?: boolean;
      /** Whether every work these tools open may bring the assistant's own lines (default: off on S-2-live, on on S-2). */
      ownWords?: boolean;
      /** The diversity every work these tools open asks for, "none", "mmr", "temporal" or "full" (default: "full" on S-2-live; unset on S-2, so none is sent). */
      diversity?: "none" | "mmr" | "temporal" | "full";
    } = {},
  ): MemoryTools<Images> {
    checkOpts(opts, KNOWN_MEMORY_TOOLS_KEYS, "memoryTools");
    const rooms = opts.rooms ?? undefined;
    if (rooms !== undefined) checkRooms(rooms);
    const assistant = opts.assistant === undefined || opts.assistant === null ? undefined : checkAssistant(opts.assistant);
    const tz = opts.tz ?? this.tz;
    if (tz !== undefined) tzMinutes(tz);
    for (const key of ["speakers", "dates", "images", "sleep", "seen", "usage"] as const) {
      if (opts[key] !== undefined && typeof opts[key] !== "boolean") {
        throw new Error(`${key} must be true or false, got ${JSON.stringify(opts[key])}.`);
      }
    }
    const ownWords = checkOwnWords(opts.ownWords ?? undefined);
    const diversity = checkDiversity(opts.diversity);
    const preset = memoryToolsPreset(opts.preset, this.model);
    let day: number | undefined;
    if (opts.today !== undefined && opts.today !== null) {
      day = sleepDate(opts.today);
      if (day === undefined) throw new Error(`today must be a day, "YYYY-MM-DD", got ${JSON.stringify(opts.today)}.`);
      if (!opts.sleep) throw new Error("today is the day the sleep's files are dated to: it goes with sleep: true.");
    }
    const model = (MEMORY_TOOLS_PRESETS.get(preset) as MemoryToolsPreset).model;
    return new MemoryTools<Images>(
      model === this.model ? this : this.withModel(model), this.uid(userId), tz, rooms,
      opts.speakers ?? false, opts.dates ?? false, opts.images ?? false, preset, opts.sleep ?? false, day, assistant,
      opts.seen ?? false, opts.usage ?? false, ownWords, diversity,
    );
  }

  /** One page of a day's raw memories, oldest first: what a sleep reads. */
  async sleepRead(
    userId?: string,
    opts: {
      tz?: number;
      daysAgo?: number;
      room?: string;
      todayStart?: string;
      now?: string;
      budgetTokens?: number;
      cursor?: SleepCursor;
      includeSuperseded?: boolean;
      sleepId?: string;
      sinceLastSleep?: boolean;
      since?: string;
    } = {},
  ): Promise<SleepPage> {
    checkOpts(opts, KNOWN_SLEEP_KEYS, "sleepRead");
    const sinceLast = optBool(opts.sinceLastSleep, "sinceLastSleep");
    const since = opts.since ?? undefined;
    if (sinceLast && since !== undefined) {
      throw new Error("sinceLastSleep reads from the end of the store's last sleep and since from the instant given: pass one of them.");
    }
    if ((sinceLast || since !== undefined) && (opts.daysAgo != null || opts.room != null || opts.todayStart != null)) {
      throw new Error("a sleep since the last one reads what the store was given since then: not with daysAgo, room or todayStart.");
    }
    const m = this.clock(opts.tz);
    const body: Record<string, unknown> = { user_id: this.uid(userId) };
    if (m !== undefined) body.tz_offset_minutes = m;
    const days = optRange(opts.daysAgo, "daysAgo", 0, 14);
    if (days !== undefined) body.days_ago = days;
    if (opts.room != null) body.room = roomArg(opts.room);
    if (opts.todayStart != null) body.today_start = checkId(opts.todayStart, "todayStart");
    if (opts.now != null) body.now = checkId(opts.now, "now");
    const budget = optRange(opts.budgetTokens, "budgetTokens", 500, 20000);
    if (budget !== undefined) body.budget_tokens = budget;
    if (opts.cursor !== undefined && opts.cursor !== null) body.cursor = opts.cursor;
    const superseded = optBool(opts.includeSuperseded, "includeSuperseded");
    if (superseded !== undefined) body.include_superseded = superseded;
    if (opts.sleepId !== undefined && opts.sleepId !== null) body.sleep_id = checkId(opts.sleepId, "sleepId");
    if (sinceLast) body.since_last_sleep = true;
    if (since !== undefined) body.since = checkId(since, "since");
    return withRecords(await this.post("/api/v1/memory/sleep", body), "memories");
  }

  /** Check what a sleep's write cites against what that sleep read. */
  async sleepVerify(sleepId: string, evidence: string[], userId?: string): Promise<SleepVerifyResult> {
    if (!Array.isArray(evidence) || evidence.length > SLEEP_EVIDENCE_MAX) {
      const got = Array.isArray(evidence) ? `${evidence.length} entries` : typeof evidence;
      throw new Error(`evidence must be a list of at most ${SLEEP_EVIDENCE_MAX} memory ids, got ${got}.`);
    }
    evidence.forEach((e, i) => {
      const n = typeof e === "string" ? Array.from(e).length : 0;
      if (n < 1 || n > SLEEP_EVIDENCE_CHARS_MAX) {
        throw new Error(`evidence[${i}] must be 1 to ${SLEEP_EVIDENCE_CHARS_MAX} characters, got ${typeof e === "string" ? n : typeof e}.`);
      }
    });
    return this.post("/api/v1/memory/sleep/verify", {
      user_id: this.uid(userId),
      sleep_id: checkId(sleepId, "sleepId"),
      evidence,
    });
  }

  /** End the store's last sleep at this one, once what it wrote is kept. */
  async sleepDone(sleepId: string, userId?: string): Promise<SleepDoneResult> {
    return this.write("/api/v1/memory/sleep/done", { user_id: this.uid(userId), sleep_id: checkId(sleepId, "sleepId") });
  }

  /** The being's files: the core whole, and the four boxes without their bodies. */
  async sleepFiles(userId?: string): Promise<SleepFiles> {
    return withRecords(await this.post("/api/v1/memory/self", { user_id: this.uid(userId) }), "files");
  }

  /** One of the being's files whole: the latest version, or `version`. */
  async openSleepFile(slot: number, userId?: string, opts: { version?: number } = {}): Promise<SleepFile> {
    checkOpts(opts, new Set(["version"]), "openSleepFile");
    return this.post("/api/v1/memory/self/open", sleepOpenBody(this.uid(userId), slot, opts.version));
  }

  /** Every version of one file, without their bodies. */
  async sleepFileHistory(slot: number, userId?: string): Promise<SleepFileHistory> {
    return withRecords(await this.post("/api/v1/memory/self/history", { user_id: this.uid(userId), slot: sleepSlot(slot) }), "versions");
  }

  /** Write new versions of the being's files, all or none. */
  async writeSleepFiles(sleepId: string, writes: SleepFileWrite[], userId?: string): Promise<SleepWriteResult> {
    const body = { user_id: this.uid(userId), sleep_id: checkId(sleepId, "sleepId"), writes: sleepWrites(writes) };
    return withRecords(await this.write("/api/v1/memory/self/write", body), "written");
  }

  /** The sleep's own notes and their version. */
  async sleepNotes(userId?: string): Promise<SleepNotes> {
    return this.post("/api/v1/memory/self/notes", { user_id: this.uid(userId) });
  }

  /** Replace the sleep's notes. */
  async writeSleepNotes(baseVersion: number, notes: Record<string, unknown>, userId?: string): Promise<SleepNotesWriteResult> {
    return this.write("/api/v1/memory/self/notes/write", sleepNotesBody(this.uid(userId), baseVersion, notes));
  }

  /** What a sleep would read, and about what it would cost, before it runs. */
  async sleepEstimate(userId?: string, opts: SleepEstimateOptions = {}): Promise<SleepEstimate> {
    checkOpts(opts, KNOWN_SLEEP_ESTIMATE_KEYS, "sleepEstimate");
    const host = this.sleepHost(userId);
    const run = sleepEstimateSetup(host, opts);
    return sleepEstimateFlow(host, run, opts.inputPrice ?? undefined, opts.outputPrice ?? undefined);
  }

  /** One sleep: the app's own model rewrites the being's files from what is new since the last sleep. */
  async sleep(userId: string | undefined, opts: SleepOptions): Promise<SleepResult> {
    const given = opts ?? ({} as SleepOptions);
    checkOpts(given, KNOWN_SLEEP_RUN_KEYS, "sleep");
    const host = this.sleepHost(userId);
    return sleepFlow(host, sleepSetup(host, given));
  }

  private sleepHost(userId?: string): SleepHost {
    return {
      store: this.uid(userId),
      clock: this.clock(),
      signal: this.signal ?? new AbortController().signal,
      modelMaxTokens: MODEL_MAX_TOKENS,
      maxPages: MAX_PAGES,
      post: (path, body) => this.post(path, body),
      settings: () => this.settings(userId),
      write: (path, body) => this.write(path, body),
      caller: (c, what) => sleepCaller(c, what, this.base),
      unreachable: providerUnreachable,
    };
  }

  /** Add a skill to a store, kept in this process. A name the store already has is refused. */
  async addSkill(def: SkillDefinition, userId?: string): Promise<SkillDefinition> {
    const store = this.uid(userId);
    const st = this.routerState;
    const d = checkSkill(def, st);
    if (st.skills.get(store, d.name)) {
      throw new Error(`store ${JSON.stringify(store)} already has a skill named ${JSON.stringify(d.name)}: remove it first to replace it.`);
    }
    st.skills.add(store, [d]);
    return copyJson(d);
  }

  /** A store's skills, by name. */
  async listSkills(userId?: string): Promise<SkillDefinition[]> {
    return this.routerState.skills.list(this.uid(userId)).map((d) => copyJson(d));
  }

  /** Remove a skill from a store; false when it had none of that name. */
  async removeSkill(name: string, userId?: string): Promise<boolean> {
    const store = this.uid(userId);
    return this.routerState.skills.remove(store, checkId(name, "name"));
  }

  /** Copy a skill from one store to others. */
  async copySkill(name: string, from: string, to: string | string[]): Promise<string[]> {
    const skill = checkId(name, "name");
    if (typeof from !== "string" || !from.trim()) {
      throw new Error("from is required: the store to copy from. A copy never falls back to the default store.");
    }
    const targets = Array.isArray(to) ? to : [to];
    if (!targets.length) throw new Error("to is required: a store, or a list of stores.");
    for (const t of targets) {
      if (typeof t !== "string" || !t.trim()) throw new Error(`to holds ${JSON.stringify(t)}, which is not a store id.`);
      warnIfStoreIdCollapses(t);
    }
    warnIfStoreIdCollapses(from);
    const st = this.routerState;
    const src = st.skills.get(from, skill);
    if (!src) throw new Error(`store ${JSON.stringify(from)} has no skill named ${JSON.stringify(skill)}.`);
    const seen = new Set<string>([normalizeStoreId(from)]);
    for (const t of targets) {
      const k = normalizeStoreId(t);
      if (seen.has(k)) {
        throw new Error(`${JSON.stringify(t)} is ${k === normalizeStoreId(from) ? "the store copied from" : "in the list twice"}; nothing was copied.`);
      }
      seen.add(k);
      if (st.skills.get(t, src.name)) {
        throw new Error(`store ${JSON.stringify(t)} already has a skill named ${JSON.stringify(src.name)}; nothing was copied.`);
      }
    }
    for (const t of targets) st.skills.add(t, [copyJson(src)]);
    return [...targets];
  }

  /** A store's skills as JSON text, for `importSkills`. */
  async exportSkills(userId?: string): Promise<string> {
    const store = this.uid(userId);
    return JSON.stringify({ wontopos_skills: SKILLS_EXPORT_VERSION, store, skills: this.routerState.skills.list(store) });
  }

  /** Add the skills of an `exportSkills` text to a store, all or none. */
  async importSkills(data: string | Record<string, unknown>, userId?: string): Promise<string[]> {
    let parsed: unknown = data;
    if (typeof data === "string") {
      try {
        parsed = parseFiniteJson(data);
      } catch (e) {
        throw new Error(`the skills are not JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const o = parsed as { wontopos_skills?: unknown; skills?: unknown } | null;
    if (!isPlainObject(o) || o.wontopos_skills !== SKILLS_EXPORT_VERSION || !Array.isArray(o.skills)) {
      throw new Error(`not an exportSkills text: expected {"wontopos_skills": ${SKILLS_EXPORT_VERSION}, "skills": [...]}.`);
    }
    const store = this.uid(userId);
    const st = this.routerState;
    const defs = o.skills.map((s, i) => {
      try {
        return checkSkill(s, st);
      } catch (e) {
        throw new Error(`skills[${i}]: ${e instanceof Error ? e.message : String(e)} Nothing was imported.`);
      }
    });
    const names = new Set<string>();
    for (const d of defs) {
      if (names.has(d.name)) throw new Error(`${JSON.stringify(d.name)} is in the skills twice; nothing was imported.`);
      names.add(d.name);
      if (st.skills.get(store, d.name)) {
        throw new Error(`store ${JSON.stringify(store)} already has a skill named ${JSON.stringify(d.name)}; nothing was imported.`);
      }
    }
    st.skills.add(store, defs);
    return defs.map((d) => d.name);
  }

  /** Add an LLM skill from an Agent Skills `SKILL.md`. */
  async importSkillMd(store: string | undefined, text: string, opts: SkillMdOptions = {}): Promise<SkillDefinition> {
    checkOpts(opts, KNOWN_SKILL_MD_KEYS, "importSkillMd");
    const md = parseSkillMd(text);
    const name = opts.name ?? md.name.replace(/-/g, "_");
    if (opts.name == null && !SKILL_NAME_RE.test(name)) {
      throw new Error(
        `SKILL.md: the name ${JSON.stringify(md.name)} makes the skill name ${JSON.stringify(name)}, which is not 1-32 of ` +
          "[a-z0-9_] starting with a letter: pass another as opts.name.",
      );
    }
    const def: SkillDefinition = {
      name,
      description: md.description,
      kind: "llm",
      instructions: md.body,
      input: opts.input ?? copyJson(SKILL_MD_INPUT),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.caller !== undefined ? { caller: opts.caller } : {}),
      ...(opts.max_tokens !== undefined ? { max_tokens: opts.max_tokens } : {}),
      ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
      ...(opts.confirm !== undefined ? { confirm: opts.confirm } : {}),
      metadata: {
        source: "SKILL.md",
        skill_md_name: md.name,
        ...(Object.keys(md.rest).length ? { frontmatter: md.rest } : {}),
        not_run: SKILL_MD_NOT_RUN,
      },
    };
    return this.addSkill(def, store);
  }

  /** Ask the router for something outside memory.
   *  Only a mistake in the arguments throws; any other failure comes back as `ok: false`. */
  async ask(request: string, opts: AskOptions = {}): Promise<AskResult> {
    checkOpts(opts, KNOWN_ASK_KEYS, "ask");
    if (typeof request !== "string" || !request.trim()) {
      throw new Error("request is required: what the model asks for, in its own words.");
    }
    const turn = askTurn(opts.turn);
    const speaker = askSpeaker(opts.speaker);
    const useHistory = askHistory(opts.history);
    const store = this.uid(opts.userId);
    const st = this.routerState;
    const askId = newAskId();
    const history: AskHistory = { read: useHistory ? "skipped" : "off", pushed: useHistory ? "skipped" : "off" };
    const usage: AskUsage = {};
    const end = (r: AskOutcome): AskResult => ({ ...r, store, askId, history, ...(usage.router || usage.skill ? { usage } : {}) });
    const refuse = (f: Failure, extra: Partial<AskOutcome> = {}): AskResult =>
      end({ ok: false, text: ROUTER_TEXT.failed[f.reason], reason: f.reason, ...extra, ...(f.detail ? { detail: f.detail } : {}) });

    const pre = await this.askPrecheck(store);
    if (pre) return refuse(pre);
    const clock = this.routerClock() as RouterClock;
    const t0 = Date.now();
    const lim = st.reserve(normalizeStoreId(store), turn, clockParts(clock, t0).date, t0);
    if ("full" in lim) return refuse({ reason: "limit", detail: lim.full });
    const run = new AskClock(lim.budgetMs, [this.signal, opts.signal]);
    try {
      let exchanges: RouterExchange[] = [];
      if (useHistory) {
        try {
          exchanges = await this.channelRead(store, speaker, run);
          history.read = "ok";
        } catch {
          history.read = "failed";
        }
      }
      if (run.why()) return refuse(run.failure());
      const d = await this.routerDecide(store, request, exchanges, clock, run, usage);
      if ("reason" in d) return refuse(d);
      let result: AskResult;
      if (d.action !== "skill") {
        result = end({ ok: true, action: d.action, text: d.text });
      } else if (d.def.confirm) {
        result = refuse({ reason: "needs_confirmation" }, { action: "skill", skill: d.def.name, input: d.input });
      } else {
        const ran = await this.runSkillDef(d.def, d.input, { store, request, note: d.note, askId, speaker }, run, usage);
        const at = { action: "skill" as const, skill: d.def.name, input: d.input };
        result = "reason" in ran ? refuse(ran, at) : end({ ok: true, ...at, ...ran });
      }
      if (useHistory) {
        if (run.why() || run.left() <= 0) history.pushed = "skipped";
        else {
          try {
            await this.channelPush(store, speaker, request, exchangeAnswer(result), run);
            history.pushed = "ok";
          } catch {
            history.pushed = "failed";
          }
        }
      }
      return result;
    } finally {
      run.close();
      lim.done(Date.now() - t0);
    }
  }

  /** Whether `ask` can run for this store now. */
  async canAsk(userId?: string): Promise<AskReadiness> {
    const f = await this.askPrecheck(this.uid(userId));
    if (!f) return { ok: true };
    return { ok: false, reason: f.reason, text: ROUTER_TEXT.failed[f.reason], ...(f.detail ? { detail: f.detail } : {}) };
  }

  /** Run a skill the router chose, once a person agreed to it; never offer this to a model. */
  async runSkill(name: string, input: Record<string, unknown>, opts: RunSkillOptions = {}): Promise<AskResult> {
    checkOpts(opts, KNOWN_RUN_SKILL_KEYS, "runSkill");
    const store = this.uid(opts.userId);
    const st = this.routerState;
    const def = st.skills.get(store, checkId(name, "name"));
    if (!def) throw new Error(`store ${JSON.stringify(store)} has no skill named ${JSON.stringify(name)}.`);
    if (!isPlainObject(input)) throw new Error("input must be an object: the input the skill takes.");
    try {
      input = copyJson(input);
    } catch (e) {
      throw new Error(`input must be JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    const bad = inputError(input, def.input, "input");
    if (bad) throw new Error(`${def.name}: ${bad}.`);
    const speaker = askSpeaker(opts.speaker);
    const askId = opts.askId == null ? newAskId() : checkId(opts.askId, "askId");
    const request = opts.request == null ? "" : String(opts.request);
    const note = opts.note == null ? "" : String(opts.note);
    const usage: AskUsage = {};
    const run = new AskClock(st.limits.timeMs, [this.signal, opts.signal]);
    try {
      const ran = await this.runSkillDef(def, copyJson(input), { store, request, note, askId, speaker }, run, usage);
      const at = {
        action: "skill" as const,
        skill: def.name,
        input: copyJson(input),
        store,
        askId,
        history: { read: "off", pushed: "off" } as AskHistory,
        ...(usage.skill ? { usage } : {}),
      };
      if ("reason" in ran) {
        return { ...at, ok: false, reason: ran.reason, text: ROUTER_TEXT.failed[ran.reason], ...(ran.detail ? { detail: ran.detail } : {}) };
      }
      return { ...at, ok: true, ...ran };
    } finally {
      run.close();
    }
  }

  /** The router's last exchanges with a store, oldest first. */
  async routerHistory(userId?: string, opts: { speaker?: string } = {}): Promise<RouterExchange[]> {
    checkOpts(opts, KNOWN_ROUTER_HISTORY_KEYS, "routerHistory");
    const store = this.uid(userId);
    const speaker = askSpeaker(opts.speaker);
    try {
      return await this.channelRead(store, speaker);
    } catch (e) {
      if (e instanceof WosError && (e.status === 404 || e.status === 501)) return [];
      throw e;
    }
  }

  /** The `ask` tool for a model that calls tools. */
  routerTools(userId?: string, opts: Omit<AskOptions, "userId" | "signal"> = {}): RouterTools {
    checkOpts(opts, KNOWN_ROUTER_TOOLS_KEYS, "routerTools");
    askTurn(opts.turn);
    askSpeaker(opts.speaker);
    askHistory(opts.history);
    return new RouterTools(this, this.uid(userId), { ...opts });
  }

  private async askPrecheck(store: string): Promise<Failure | undefined> {
    const st = this.routerState;
    if (!st.router) {
      return { reason: "not_configured", detail: "pass router.key (the model provider's key) or router.routerCaller to the client" };
    }
    if (!this.routerClock()) {
      return {
        reason: "no_time_zone",
        detail:
          "the client has no time zone: set router.timeZone to an IANA name such as \"Asia/Seoul\", " +
          "or tz to the UTC offset in hours, such as 9",
      };
    }
    if (!st.skills.list(store).length) {
      return { reason: "no_skills", detail: `store ${JSON.stringify(store)} has no skills: add one with addSkill` };
    }
    return undefined;
  }

  private routerClock(): RouterClock | undefined {
    const zone = this.routerState.timeZone;
    if (zone !== undefined) return { label: zone, iana: zone };
    if (this.tz === undefined) return undefined;
    const m = tzMinutes(this.tz);
    return { label: utcLabel(m), offsetMinutes: m };
  }

  private async channelRead(store: string, speaker: string | undefined, run?: AskClock): Promise<RouterExchange[]> {
    const c = run ? this.clone({ signal: run.signal, deadlineMs: Math.max(1, run.left()) }) : this;
    const body: Record<string, unknown> = { user_id: store, channel: "router" };
    if (speaker !== undefined) body.speaker = speaker;
    const r = await c.post("/api/v1/memory/channel/read", body);
    return asRecords<RouterExchange>(r.exchanges).filter((e) => typeof e.request === "string" && typeof e.answer === "string");
  }

  private async channelPush(store: string, speaker: string | undefined, request: string, answer: string, run: AskClock): Promise<void> {
    const c = this.clone({ signal: run.signal, deadlineMs: Math.max(1, run.left()) });
    const body: Record<string, unknown> = {
      user_id: store,
      channel: "router",
      request: cutChars(request, EXCHANGE_MAX_CHARS),
      answer: cutChars(answer, EXCHANGE_MAX_CHARS),
    };
    if (speaker !== undefined) body.speaker = speaker;
    await c.post("/api/v1/memory/channel/push", body);
  }

  private async routerDecide(
    store: string, request: string, exchanges: RouterExchange[], clock: RouterClock, run: AskClock, usage: AskUsage,
  ): Promise<Failure | { action: "explain" | "cannot"; text: string } | { action: "skill"; def: SkillDefinition; input: Record<string, unknown>; note: string }> {
    const st = this.routerState;
    const caller = st.router as ModelCaller;
    const skills = st.skills.list(store);
    const base: ModelCall = {
      purpose: "router",
      model: st.routerModel,
      system: [st.prompt, skillList(skills)],
      user: "-",
      maxTokens: st.maxTokens,
      effort: "low",
      schema: routerSchema(skills.map((s) => s.name)),
      signal: run.signal,
    };
    const stable = await st.stableTokens(caller, base);
    if (run.why()) return run.failure();
    if (stable.n > ROUTER_STABLE_MAX_TOKENS) {
      return { reason: "too_large", detail: `the router prompt and this store's skills come to ${stable.n} tokens, over ${ROUTER_STABLE_MAX_TOKENS}` };
    }
    let held = exchanges;
    let call: ModelCall;
    for (;;) {
      const turnText = routerTurn(held, clock, Date.now(), st.name, request);
      call = { ...base, user: turnText, ...(stable.counted ? { systemTokens: stable.n } : {}) };
      if (stable.n + byteLength(turnText) + FRAME_TOKENS <= ROUTER_PROMPT_MAX_TOKENS) break;
      const exact = await countTokens(caller, call);
      if (run.why()) return run.failure();
      if (exact !== undefined && exact <= ROUTER_PROMPT_MAX_TOKENS) break;
      if (!held.length) {
        return { reason: "too_large", detail: `the request does not fit the router's ${ROUTER_PROMPT_MAX_TOKENS} tokens` };
      }
      held = held.slice(1);
    }
    const reply = await this.callModel(caller, call, run, usage, "router");
    if ("reason" in reply) return reply;
    if (reply.stop === "refusal") return { reason: "refusal", detail: "the router declined" };
    if (reply.stop === "max_tokens") return { reason: "truncated", detail: "the router's answer was cut off before it was whole" };
    const d = parseDecision(reply.text);
    if (!d) return { reason: "bad_choice", detail: "the router's answer holds no decision" };
    if (d.action !== "skill") {
      const text = d.text.trim() || (d.action === "explain" ? `${ROUTER_TEXT.explainFallback} ${skills.map((s) => s.name).join(", ")}` : ROUTER_TEXT.cannot);
      return { action: d.action, text };
    }
    const def = st.skills.get(store, d.skill);
    if (!def) return { reason: "bad_choice", detail: `the router chose ${JSON.stringify(d.skill)}, which this store has no skill of` };
    let input: unknown;
    try {
      input = d.input.trim() ? parseFiniteJson(d.input) : {};
    } catch {
      return { reason: "bad_choice", detail: `the router's input for ${def.name} is not JSON` };
    }
    if (!isPlainObject(input)) return { reason: "bad_choice", detail: `the router's input for ${def.name} is not an object` };
    const bad = inputError(input, def.input, "input");
    if (bad) return { reason: "bad_choice", detail: `the router's input for ${def.name}: ${bad}` };
    return { action: "skill", def, input, note: d.note.trim() };
  }

  private async runSkillDef(
    def: SkillDefinition, input: Record<string, unknown>, ctx: Omit<SkillContext, "signal">, run: AskClock, usage: AskUsage,
  ): Promise<Failure | { text: string; truncated?: boolean }> {
    const st = this.routerState;
    if (def.kind === "code") {
      const fn = st.handlers.get(def.name);
      if (!fn) return { reason: "tool_error", detail: `no function is registered for ${def.name} (router.handlers)` };
      let value: unknown;
      try {
        value = await raceAbort(Promise.resolve().then(() => fn(copyJson(input), { ...ctx, signal: run.signal })), run.signal);
      } catch (e) {
        if (run.why()) return run.failure();
        return { reason: "tool_error", detail: `${def.name} threw: ${cleanServerText(String((e as Error)?.message ?? e), 512)}` };
      }
      return { text: skillText(value) };
    }
    const caller = def.caller !== undefined ? st.callers.get(def.caller) : st.skill;
    if (!caller) {
      return {
        reason: "not_configured",
        detail: def.caller !== undefined
          ? `${def.name} names the caller ${JSON.stringify(def.caller)}, which router.callers does not have`
          : "an llm skill needs router.key, router.skillKey or router.skillCaller",
      };
    }
    const call: ModelCall = {
      purpose: "skill",
      model: def.model ?? (def.caller !== undefined ? caller.model?.trim() : undefined) ?? st.skillModel,
      system: [def.instructions ?? ""],
      user: skillTurn(ctx.request, ctx.note, input),
      maxTokens: def.max_tokens ?? SKILL_MAX_TOKENS,
      signal: run.signal,
    };
    if (def.effort !== undefined) call.effort = def.effort;
    const got = await this.callModel(caller, call, run, usage, "skill");
    if ("reason" in got) return got;
    if (got.stop === "refusal") return { reason: "refusal", detail: "the skill model declined" };
    if (!got.text.trim()) {
      if (got.stop === "max_tokens") return { reason: "truncated", detail: "the skill model ran out of tokens before it wrote anything" };
      return { reason: "failed", detail: "the skill model answered with no text" };
    }
    return { text: got.text, ...(got.stop === "max_tokens" ? { truncated: true } : {}) };
  }

  private async callModel(caller: ModelCaller, call: ModelCall, run: AskClock, usage: AskUsage, purpose: "router" | "skill"): Promise<ModelReply | Failure> {
    for (let attempt = 0; ; attempt++) {
      if (run.why()) return run.failure();
      try {
        const reply = replyShape(await raceAbort(Promise.resolve().then(() => caller.call(call)), run.signal));
        if (reply.usage) usage[purpose] = sumUsage(usage[purpose] ?? {}, reply.usage);
        return reply;
      } catch (e) {
        if (run.why()) return run.failure();
        const f = modelFailure(e);
        if (f.reason === "rate_limit" && attempt === 0 && f.retryAfterMs !== undefined && f.retryAfterMs < run.left()) {
          await sleepUnless(f.retryAfterMs, run.signal);
          continue;
        }
        return f;
      }
    }
  }

  private post(path: string, body: unknown): Promise<any> {
    return this.request("POST", path, body);
  }
  private write(path: string, body: unknown, idempotencyKey?: string): Promise<any> {
    const made = idempotencyKey == null;
    return this.request("POST", path, body, made ? newIdempotencyKey() : idempotencyKey, false, made);
  }
  private remove(path: string, body: unknown): Promise<any> {
    return this.request("DELETE", path, body, undefined, true);
  }
  private async untilComplete(path: string, body: Record<string, unknown>): Promise<any> {
    let r = await this.post(path, body);
    for (let i = 0; i < RESEND_MAX && r?.complete === false; i++) {
      logDebug(`POST ${path}: answered complete: false. Sending it again (${i + 1}/${RESEND_MAX})`);
      r = await this.post(path, body);
    }
    return r;
  }

  private deadlineAt(): number | undefined {
    return this.deadlineMs === undefined ? undefined : timing.now() + this.deadlineMs;
  }

  private beginAttempt(timeoutMs: number, deadlineAt?: number, answer?: WosError): {
    signal: AbortSignal;
    clear: () => void;
    why: () => "timeout" | "deadline" | "caller";
    endsAt: number;
  } {
    let why: "timeout" | "deadline" | "caller" = "timeout";
    let budget = timeoutMs;
    if (deadlineAt !== undefined) {
      const left = deadlineAt - timing.now();
      if (left <= 0) throw answer ?? new APIConnectionError(0, this.abortMessage("deadline"));
      if (left < budget) {
        budget = left;
        why = "deadline";
      }
    }
    const ctrl = new AbortController();
    const endsAt = timing.now() + budget;
    const stopTimer = timing.timer(() => ctrl.abort(), budget);
    const outer = this.signal;
    const onCaller = () => {
      why = "caller";
      ctrl.abort();
    };
    if (outer) {
      if (outer.aborted) onCaller();
      else outer.addEventListener("abort", onCaller);
    }
    return {
      signal: ctrl.signal,
      clear: () => {
        stopTimer();
        outer?.removeEventListener("abort", onCaller);
      },
      why: () => why,
      endsAt,
    };
  }

  private abortMessage(why: "timeout" | "deadline" | "caller", timeoutMs = this.timeoutMs): string {
    if (why === "caller") return "cancelled — the caller's AbortSignal fired";
    if (why === "deadline") return `deadline of ${this.deadlineMs}ms exhausted`;
    return `request timed out after ${timeoutMs}ms`;
  }

  private fits(ms: number, deadlineAt?: number): boolean {
    return deadlineAt === undefined || ms <= deadlineAt - timing.now();
  }

  private async pause(ms: number): Promise<void> {
    const outer = this.signal;
    if (!outer) {
      await new Promise((r) => setTimeout(r, timing.pause(ms)));
      return;
    }
    if (outer.aborted) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        outer.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, timing.pause(ms));
      outer.addEventListener("abort", done);
    });
  }

  private networkError(e: any, path: string): APIConnectionError {
    let text = typeof e?.message === "string" && e.message ? e.message : String(e);
    const q = path.indexOf("?");
    if (q !== -1) {
      const query = path.slice(q);
      text = text.split(query).join("");
      try {
        text = text.split(decodeURIComponent(query)).join("");
      } catch {
      }
    }
    text = cleanServerText(maskUserinfo(text), 512);
    const code = causeCode(e);
    if (code && !text.includes(code)) text += ` (${code})`;
    const quotable = this.userinfo || q !== -1;
    return new APIConnectionError(0, `network error: ${text}`, undefined, quotable ? undefined : { cause: e });
  }

  private isRedirected(res: Response): boolean {
    return (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect" || res.redirected === true;
  }

  private errorFromAnswer(res: Response, body: Uint8Array, retryAfter?: number, mayBeDeleted = false, unread?: string): WosError {
    const e = parseErrorText(new TextDecoder().decode(body));
    const shown = cleanServerText(e.message);
    let msg = shown.trim() ? shown : `HTTP ${res.status}`;
    if (res.status === 410 && e.details?.code !== "sleep_expired") msg += ` ${GONE_HINT}`;
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

  private async send(
    method: string, path: string, payload: string | undefined, extraHeaders?: Record<string, string>, removes = false, reads = false,
  ): Promise<{ res: Response; body: Uint8Array }> {
    if (this.pageRelative && !this.customFetch && !parseBase(this.base)) {
      throw new Error(`${notAUrl(this.base)}. A relative baseUrl needs a page to resolve against, and this runtime has none.`);
    }
    const attempts = this.maxRetries + 1;
    const upper = method.toUpperCase();
    const logPath = path.split("?")[0];
    const idempotent = IDEMPOTENT_METHODS.has(upper) || reads || (upper === "POST" && READ_POSTS.has(logPath));
    const replaySafe = idempotent || extraHeaders?.["Idempotency-Key"] !== undefined;
    const timeoutMs = STORE_PATHS.has(logPath) ? this.storeTimeoutMs : this.timeoutMs;
    const deadlineAt = this.deadlineAt();
    const headers = extraHeaders ? { ...this.headers, ...extraHeaders } : this.headers;
    let ambiguous = false;
    let refused: WosError | undefined;
    for (let attempt = 0; ; attempt++) {
      const last = attempt + 1 >= attempts;
      const tag = `(attempt ${attempt + 1}/${attempts})`;
      const start = timing.now();
      const previous = refused;
      refused = undefined;
      const att = this.beginAttempt(timeoutMs, deadlineAt, previous);
      const pauseWithoutAnswer = async (why: string): Promise<void> => {
        const delay = this.backoffMs(attempt);
        if (!this.fits(delay, deadlineAt)) throw previous ?? new APIConnectionError(0, this.abortMessage("deadline"));
        logDebug(`${method} ${logPath}: ${why}. Retrying in ${Math.round(delay)}ms ${tag}`);
        await this.pause(delay);
      };
      const cutShort = (): WosError => {
        const why = att.why();
        return why === "deadline" && idempotent && previous ? previous : new APIConnectionError(0, this.abortMessage(why, timeoutMs));
      };
      let res: Response;
      const transport = this.fetchImpl;
      try {
        res = await transport(`${this.base}${path}`, { method, headers, body: payload, signal: att.signal, redirect: "manual" });
      } catch (e: any) {
        att.clear();
        const timedOut = e?.name === "AbortError" || att.signal.aborted;
        if (timedOut) throw cutShort();
        const connect = isConnectFailure(e);
        if ((replaySafe || connect) && !last) {
          if (!connect) ambiguous = true;
          await pauseWithoutAnswer(e?.code ?? e?.name ?? "network error");
          continue;
        }
        throw this.networkError(e, path);
      }
      const readBody = async (): Promise<Uint8Array | null> => {
        try {
          return await this.readCappedBytes(res);
        } catch (e: any) {
          if (e?.name === "AbortError" || att.signal.aborted) throw cutShort();
          if (e instanceof WosError) throw e;
          if (replaySafe && !last) return null;
          throw this.networkError(e, path);
        }
      };
      const readErrorBody = async (withinMs?: number): Promise<{ body: Uint8Array; unread?: string }> => {
        try {
          return { body: await this.readCappedBytes(res, withinMs) };
        } catch (e: any) {
          const aborted = e?.name === "AbortError" || att.signal.aborted;
          if (aborted && att.why() === "caller") throw new APIConnectionError(0, this.abortMessage("caller"));
          const unread = aborted
            ? this.abortMessage(att.why(), timeoutMs)
            : e instanceof SlowBody
              ? e.message
              : (e instanceof WosError ? e : this.networkError(e, path)).message.replace(/^\[\d+\] /, "");
          return { body: new Uint8Array(0), unread };
        }
      };
      try {
        const week = weekUsedOf(res.headers);
        if (week !== null || res.ok) this._weekUsed = week;
        if (this.isRedirected(res)) {
          discard(res);
          throw new WosError(res.status, "unexpected redirect — refused (the API key never follows a redirect). Check baseUrl: exact host, https://.");
        }
        this._rateLimit = parseRateLimit(res.headers) ?? this._rateLimit;
        warnIfRetiring(this.model, res.headers);
        if (res.ok) this._billedTo = res.headers.get("X-WOS-Billed-To")?.trim().toLowerCase() === "balance" ? "balance" : null;
        const tap = res.ok && this._billedTo === "balance" ? RUN_TAPS.get(this) : undefined;
        if (tap) tap.paid = true;
        if (!res.ok) {
          const ra = retryAfterMs(res.headers.get("Retry-After"));
          let wait =
            RETRY_ALWAYS.has(res.status) || (RETRY_IF_IDEMPOTENT.has(res.status) && replaySafe)
              ? ra ?? this.backoffMs(attempt)
              : undefined;
          const retrying = wait !== undefined && !last && wait <= MAX_RETRY_WAIT_MS && this.fits(wait, deadlineAt);
          const { body, unread } = await readErrorBody(
            retrying ? Math.max(0, Math.min(BRIEF_BODY_MS, att.endsAt - timing.now())) : undefined,
          );
          if (res.status === 409) {
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
          logDebug(`${method} ${logPath} -> ${res.status} in ${timing.now() - start}ms ${tag}`);
          throw this.errorFromAnswer(res, body, ra, ambiguous && removes, unread);
        }
        const body = await readBody();
        if (body === null) {
          ambiguous = true;
          att.clear();
          await pauseWithoutAnswer("body dropped mid-stream");
          continue;
        }
        logDebug(`${method} ${logPath} -> ${res.status} in ${timing.now() - start}ms ${tag}`);
        return { res, body };
      } finally {
        att.clear();
      }
    }
  }

  private async requestBytes(path: string, body: unknown): Promise<ImageBytes> {
    const { res, body: buf } = await this.send("POST", path, JSON.stringify(body), undefined, false, true);
    if (buf.byteLength === 0) {
      throw new WosError(res.status, "empty image body — the service returned no bytes");
    }
    return { bytes: buf, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  private idemHeader(key?: string): Record<string, string> | undefined {
    if (key === undefined || key === null) return undefined;
    if (!IDEMPOTENCY_KEY_RE.test(key)) throw new Error(`invalid idempotencyKey: ${JSON.stringify(key)} — 1-128 chars of [A-Za-z0-9._:-]`);
    return { "Idempotency-Key": key };
  }

  private backoffMs(attempt: number, retryAfter?: string | null): number {
    const ra = retryAfterMs(retryAfter ?? null);
    if (ra !== undefined) return ra;
    return Math.min(8_000, 500 * 2 ** attempt) + Math.random() * 250;
  }

  private async readCappedBytes(res: Response, withinMs?: number): Promise<Uint8Array> {
    const cl = res.headers.get("content-length");
    if (cl && Number(cl) > MAX_RESPONSE_BYTES) {
      discard(res);
      throw new WosError(res.status, `response too large (${cl} bytes) — refusing to buffer it`);
    }
    const slow = () => new SlowBody(`not received within ${withinMs}ms`);
    let late = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let stop = () => {};
    const stopped = new Promise<never>((_, reject) => (stop = () => reject(slow())));
    stopped.catch(() => {});
    const stopTimer =
      withinMs === undefined
        ? undefined
        : timing.timer(() => {
            late = true;
            stop();
            reader?.cancel().catch(() => {});
          }, withinMs);
    const within = <T>(p: Promise<T>): Promise<T> => (stopTimer === undefined ? p : Promise.race([p, stopped]));
    try {
      if (!res.body) {
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
      stopTimer?.();
    }
  }

  private async request(method: string, path: string, body?: unknown, idempotencyKey?: string, removes = false, madeKey = false): Promise<any> {
    const extraHeaders = this.idemHeader(idempotencyKey);
    let payload: string | undefined;
    try {
      payload = body === undefined ? undefined : JSON.stringify(body, finiteNumbers);
    } catch (e) {
      throw new Error(
        `request body could not be serialized: ${e instanceof Error ? e.message : String(e)}. ` +
          "Pass plain JSON values — an ORM entity, a BigInt or a circular reference cannot be sent.",
      );
    }
    const { res, body: buf } = await this.send(method, path, payload, extraHeaders, removes);
    const text = new TextDecoder().decode(buf);
    if (!text.trim()) {
      if (NO_BODY_STATUS.has(res.status)) return {};
      throw new WosError(res.status, "empty response body — expected a JSON object");
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e: any) {
      throw new WosError(res.status, `invalid JSON in response: ${cleanServerText(String(e?.message ?? e), 512)}`);
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      const got = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
      throw new WosError(res.status, `expected a JSON object in the response, got ${got}`);
    }
    if (!madeKey && res.headers.get("Idempotent-Replayed") === "true" && !("replayed" in data)) {
      (data as Record<string, unknown>).replayed = true;
    }
    return data;
  }
}

/** A picture as `memory_photo` answers with it, in the format the call came in. */
export type MemoryPhotoBlock =
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } }
  | { type: "image_url"; image_url: { url: string } };

/** What `MemoryTools.run` answers with. */
export type MemoryToolResult<Images extends boolean = boolean> = Images extends true ? string | MemoryPhotoBlock[] : string;

/** A tool call as a model returns it: Anthropic (`input`) or OpenAI (`arguments`, JSON). */
export interface MemoryToolCall {
  name: string;
  input?: unknown;
  arguments?: string;
}

/** The memory tools for one store, from `Client.memoryTools`. */
export class MemoryTools<Images extends boolean = false> {
  /** The preset these run on, such as `"S-2"`. */
  readonly preset: string;
  private readonly toolsNote: string;
  private readonly photos: number;
  private work?: OpenWork;
  private readonly names: string[];
  private files?: SleepViewFile[];
  private assistant?: string;
  private recent?: { at?: string; head: string }[];
  private told = false;
  private readonly live: boolean;
  private readonly ownWords: boolean;
  private readonly diversity?: "none" | "mmr" | "temporal" | "full";

  constructor(
    private readonly client: Client,
    private readonly store: string,
    private readonly tz: number | undefined,
    private readonly rooms: string | string[] | boolean | undefined,
    private readonly speakers: boolean = false,
    dates: boolean = false,
    private readonly images: boolean = false,
    preset: string = "S-2",
    private readonly sleep: boolean = false,
    private readonly today?: number,
    private readonly givenAssistant?: string,
    seen: boolean = false,
    private readonly usage: boolean = false,
    ownWords?: boolean,
    diversity?: "none" | "mmr" | "temporal" | "full",
  ) {
    this.preset = namedPreset(preset);
    const kind = MEMORY_TOOLS_PRESETS.get(this.preset) as MemoryToolsPreset;
    this.photos = kind.photos;
    this.live = kind.live;
    this.ownWords = ownWords ?? kind.ownWords;
    this.diversity = diversity ?? kind.diversity;
    this.toolsNote = memoryNote(speakers, dates, images);
    this.names = MEMORY_TOOL_NAMES.filter((n) => (n !== "memory_timeline" || dates) && (n !== "memory_photo" || images));
    if (seen) this.names.push("memory_recent", "memory_seen");
    if (usage) this.names.push("memory_usage");
    if (sleep) this.names.push("open_box");
  }

  /** The text to put beside the tool definitions.
   *  With `sleep` on, read the files first, with `load` or `begin`. */
  get note(): string {
    if (!this.sleep) return this.toolsNote;
    return `${this.toolsNote}\n\n${SLEEP_READER_NOTE}\n${sleepRender(this.sleepFiles(), this.filesToday())}`;
  }

  /** The open work, for a write's `workId`. */
  get workId(): string | undefined {
    const id: unknown = this.work?.id;
    return typeof id === "string" && id ? id : undefined;
  }

  /** Read the being's files again, after a sleep, and return the note. */
  async load(): Promise<string> {
    return this.loadWith(this.client);
  }

  private async loadWith(client: Client): Promise<string> {
    if (!this.sleep) throw new Error("load reads the being's files: make the tools with sleep: true.");
    this.files = sleepView(await client.sleepFiles(this.store));
    return this.note;
  }

  private sleepFiles(): SleepViewFile[] {
    if (this.files === undefined) throw new Error("the being's files are not read yet: await tools.load() or tools.begin(...) first.");
    return this.files;
  }

  private filesToday(): number {
    return this.today ?? Math.floor((Date.now() + (this.tz ?? 0) * 3_600_000) / 86_400_000);
  }

  private async openBox(input: Record<string, unknown>, client: Client): Promise<string> {
    if (this.files === undefined) await this.loadWith(client);
    const view = this.sleepFiles();
    const slot = sleepBoxPick(view, "box" in input ? input.box : "");
    if (slot === undefined) return `No box by that name. The boxes are:\n${sleepBoxIndex(view, this.filesToday())}`;
    if (!view[slot].version && !sleepHasBody(view[slot])) return `Box ${slot} is empty.`;
    const f = sleepFile(await client.openSleepFile(slot, this.store));
    f.title = f.title || view[slot].title;
    f.day = f.day || view[slot].day;
    return sleepBoxText(slot, f, this.filesToday());
  }

  private async assistantName(): Promise<string | undefined> {
    if (this.givenAssistant !== undefined) return this.givenAssistant;
    try {
      const a = (await this.client.settings(this.store))?.default_speakers?.assistant;
      return typeof a === "string" && a.trim() ? a.trim() : undefined;
    } catch (e) {
      if (e instanceof WosError) return undefined;
      throw e;
    }
  }

  private async askedLive(question: string): Promise<string> {
    let turns: HistoryTurn[] = [];
    try {
      turns = await this.client.history(this.store);
    } catch (e) {
      if (!(e instanceof WosError)) throw e;
    }
    return liveQuestion(turns, question, Date.now());
  }

  /** What comes to mind for this turn, numbered, as text for the prompt. */
  async begin(question: string): Promise<string> {
    const asked = checkId(question, "question");
    this.work = undefined;
    if (this.sleep && this.files === undefined) await this.load();
    if (this.speakers) this.assistant = await this.assistantName();
    const w = await this.client.openWork(this.live ? await this.askedLive(asked) : question, this.store, {
      rooms: this.rooms,
      tz: this.tz,
      ...(this.images ? { maxImages: this.photos } : {}),
      ...(this.ownWords ? {} : { ownWords: false }),
      ...(this.diversity === undefined ? {} : { diversity: this.diversity }),
    });
    this.work = { id: w.work_id, ids: new Map(), held: [], photos: new Set() };
    this.told = false;
    return this.listed(w, "Nothing came to mind.", this.work);
  }

  /** The tools, in the model API's own format. */
  definitions(format: "anthropic" | "openai" = "anthropic"): Record<string, unknown>[] {
    format = toolFormat(format);
    const off = () => ({ type: "integer", minimum: -200, maximum: 200 });
    const search: Record<string, unknown> = { query: { type: "string" } };
    let searchText =
      "Search again. " +
      "Write the query as the memory would read, a short statement of who and what (\"Theo likes to eat...\"), " +
      "one idea at a time, in any language. New memories are numbered on. Uses a step (5 in all).";
    search.rooms = { type: "string" };
    searchText +=
      " rooms: look only in parts of the last three days: m0 this morning (06-14), a0 this afternoon (14-22), n0" +
      " tonight (22-06), m1/a1/n1 yesterday, m2/a2/n2 the day before, or all. Omit it to look everywhere.";
    const tools = [
      ["memory_deeper", "The same question further down: the next 20 memories, numbered on. Three times at most; not a step.", { type: "object", properties: {} }],
      [
        "memory_around",
        "What was said around memory [n], counted from it: 0 is [n], -1 before it, +1 after it. from/to default " +
          "to 3 either side of center (default 0); one call reaches 14 a side of center. Uses a step.",
        { type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 200 }, from: off(), to: off(), center: off() }, required: ["n"] },
      ],
      ["memory_search", searchText, { type: "object", properties: search, required: ["query"] }],
      [
        "memory_timeline",
        "The numbered memories you hold, in the order they happened, with dates and times (oldest first). " +
          "Use it first for when, how long ago, or what came before what. Free: not a step, no new search.",
        { type: "object", properties: {} },
      ],
      [
        "memory_photo",
        "Shows the photo of memory [n], one marked (photo). Not a step.",
        { type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 200 } }, required: ["n"] },
      ],
      ["memory_recent", SEEN_TEXT.recent, { type: "object", properties: {} }],
      [
        "memory_seen",
        SEEN_TEXT.seen,
        { type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 500 } }, required: ["n"] },
      ],
      ["memory_usage", USAGE_TEXT.tool, { type: "object", properties: {} }],
    ] as const;
    const out: Record<string, unknown>[] = tools.filter(([name]) => this.names.includes(name)).map(([name, description, schema]) =>
      format === "openai"
        ? { type: "function", function: { name, description, parameters: schema } }
        : { name, description, input_schema: schema },
    );
    if (this.sleep) out.push(sleepOpenBox(format));
    return out;
  }

  /** Answer one tool call with what to return to the model. An unknown tool throws. */
  async run(call: MemoryToolCall): Promise<MemoryToolResult<Images>> {
    const tap = { paid: false };
    const result = await this.answer(call, tappedClient(this.client, tap));
    return this.noted(result, tap.paid) as MemoryToolResult<Images>;
  }

  private noted(result: string | MemoryPhotoBlock[], paid: boolean): string | MemoryPhotoBlock[] {
    if (!this.usage || this.told || typeof result !== "string") return result;
    const line = usageLine(paid, this.client.weekUsed);
    if (line === undefined) return result;
    this.told = true;
    return `${result}\n${line}`;
  }

  private async answer(call: MemoryToolCall, client: Client): Promise<string | MemoryPhotoBlock[]> {
    const name = call?.name;
    if (typeof name !== "string" || !this.names.includes(name)) {
      throw new Error(`not a memory tool: ${JSON.stringify(name)}`);
    }
    const input = callInput(call);
    if (!input) return "Refused: the arguments are not JSON.";
    try {
      if (name === "open_box") return await this.openBox(input, client);
      if (name === "memory_recent") return await this.recentLines(client);
      if (name === "memory_seen") return await this.seenLine(Number(input.n), client);
      if (name === "memory_usage") return usageText(await client.usage());
      const w = this.work;
      if (!w) return "Nothing is open: memory tools answer within a turn that began with begin().";
      if (name === "memory_timeline") return this.timeline(w.held);
      if (name === "memory_photo") return await this.photo(w, Number(input.n), call.input == null && typeof call.arguments === "string", client);
      if (name === "memory_deeper") return this.listed(await client.workDeeper(w.id, this.store), "Nothing further down.", w);
      if (name === "memory_search") {
        const rooms = typeof input.rooms === "string" && input.rooms.trim() ? roomsFrom(input.rooms) : undefined;
        const d = await client.workSearch(w.id, String(input.query ?? ""), this.store, { rooms, tz: this.tz });
        return this.listed(d, "Nothing new for that.", w);
      }
      const opts: { from?: number; to?: number; center?: number } = {};
      for (const k of ["from", "to", "center"] as const) if (input[k] !== undefined && input[k] !== null) opts[k] = Number(input[k]);
      const n = Number(input.n);
      const d = await client.workAround(w.id, n, this.store, opts);
      const said = (d.pieces ?? []).map((p) => this.said(p, `${p.at > 0 ? "+" : ""}${p.at}`, p.at));
      const notGiven = asRecords<{ from: number; to: number; why: string }>(d.not_given).map((x) => `${x.from}..${x.to}: ${x.why}`);
      return [
        `Around [${pad2(n)}]:`,
        said.length ? said.map((s) => s.text).join("\n") : "(nothing new)",
        notGiven.length ? `Not given: ${notGiven.join("; ")}` : "",
        budgetLine(d),
      ].filter(Boolean).join("\n");
    } catch (e) {
      if (e instanceof WosError || (e instanceof Error && !(e instanceof TypeError))) return `Refused: ${e.message}`;
      throw e;
    }
  }

  /** Close the turn's work, with the memory that answered if one did. */
  async answered(n?: number): Promise<WorkCloseResult | undefined> {
    const w = this.work;
    if (!w) return undefined;
    const answerId = n == null ? undefined : w.ids.get(n);
    if (n != null && !answerId) throw new Error(`[${pad2(n)}] is not a number this turn gave.`);
    this.work = undefined;
    return this.client.closeWork(w.id, this.store, answerId ? { answerId } : {});
  }

  private async photo(w: { ids: Map<number, string>; photos: Set<number> }, n: number, openai: boolean, client: Client): Promise<string | MemoryPhotoBlock[]> {
    checkRange(n, "n", 1, 200);
    const id = w.ids.get(n);
    if (id === undefined) return `Refused: [${pad2(n)}] is not a number this turn gave.`;
    if (!w.photos.has(n)) return `Refused: [${pad2(n)}] is not a photo.`;
    let got: ImageBytes;
    try {
      got = await client.getImage(this.store, id);
    } catch (e) {
      if (e instanceof WosError && e.status === 404) return `Refused: [${pad2(n)}] has no picture here.`;
      throw e;
    }
    const type = String(got.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!PHOTO_TYPES.has(type)) return `Refused: [${pad2(n)}] is a picture of a kind that cannot be shown (${type || "unknown"}).`;
    const data = base64(got.bytes);
    const mediaType = type as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    return openai
      ? [{ type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } }]
      : [{ type: "image", source: { type: "base64", media_type: mediaType, data } }];
  }

  private async recentLines(client: Client): Promise<string> {
    const turns = await client.history(this.store);
    const lines: { at?: string; head: string }[] = [];
    const out: string[] = [];
    for (const t of [...turns].reverse()) {
      const speaker = typeof t.speaker === "string" ? t.speaker.trim() : "";
      const reply = t.role === "assistant";
      const who = reply || speaker === "me" ? "you" : speaker ? shownSpeaker(speaker) : "user";
      const at = typeof t.timestamp === "string" && t.timestamp.trim() ? t.timestamp : undefined;
      const head = `#${lines.length + 1} ${who}: ${keptIn(String(t.content ?? ""))}`;
      const n = t.seen;
      const held = reply && Number.isInteger(n) && (n as number) >= 0 ? ` (held ${n} ${n === 1 ? "memory" : "memories"})` : "";
      lines.push({ at, head });
      out.push(head + held);
    }
    this.recent = lines;
    return lines.length ? `${SEEN_TEXT.recentHead}\n${out.join("\n")}` : SEEN_TEXT.recentEmpty;
  }

  private async seenLine(n: number, client: Client): Promise<string> {
    checkRange(n, "n", 1, 500);
    const line = this.recent?.[n - 1];
    if (!line) return `Refused: #${n} is not a line memory_recent gave.`;
    if (line.at === undefined) return `Refused: #${n} has no time to look up.`;
    let r: SeenResult;
    try {
      r = await client.seen(line.at, this.store);
    } catch (e) {
      if (e instanceof WosError && e.status === 404) return `Line #${n} is no longer in the window.`;
      throw e;
    }
    if (!r.seen.length) return `${line.head}\n${SEEN_TEXT.noneHeld}`;
    const held = r.seen.map((m) => {
      const status = typeof m.status === "string" ? m.status : "";
      const words = String(m.content ?? "");
      return `- ${SEEN_STATES.get(status) ?? (status || "unknown")}${words ? `: ${keptIn(words)}` : ""}`;
    });
    return `${line.head}\n${SEEN_TEXT.heldHead}\n${held.join("\n")}`;
  }

  private listed(d: WorkResult, none: string, given: OpenWork): string {
    const w = given === this.work ? given : undefined;
    const said: Said[] = [];
    for (const m of d.memories ?? []) {
      if (!Number.isInteger(m?.n)) continue;
      const id = typeof m.id === "string" && m.id !== "" ? m.id : undefined;
      if (id !== undefined) w?.ids.set(m.n, id);
      const photo = this.images && id !== undefined && typeof m.image_ref === "string" && m.image_ref !== "";
      if (photo) w?.photos.add(m.n);
      said.push(this.said(m, `[${pad2(m.n)}]`, m.n, photo));
    }
    said.sort((a, b) => a.rank - b.rank);
    w?.held.push(...said);
    return [said.length ? said.map((s) => s.text).join("\n") : none, budgetLine(d)].filter(Boolean).join("\n");
  }

  private timeline(held: Said[]): string {
    if (!held.length) return "Nothing is held yet.";
    const sorted = [...held].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.rank - b.rank);
    return `In the order they happened, oldest first:\n${this.lines(sorted)}`;
  }

  private said(m: SaidFields, label: string, rank: number, photo = false): Said {
    const ev = instantMs(m.event_date);
    const at = ev ?? instantMs(m.created_at);
    const own = Number.isInteger(m.tz_offset_minutes) && Math.abs(m.tz_offset_minutes as number) <= 840
      ? (m.tz_offset_minutes as number) : undefined;
    let date: string | undefined;
    let time: string | undefined;
    let zone: string | undefined;
    const shift = own !== undefined ? own * 60_000 : (this.tz ?? 0) * 3_600_000;
    if (at !== undefined) {
      if (ev !== undefined && ev % 86_400_000 === 0) {
        date = new Date(ev).toISOString().slice(0, 10);
      } else {
        const iso = new Date(at + shift).toISOString();
        date = iso.slice(0, 10);
        time = iso.slice(11, 16);
        zone = own !== undefined ? (this.tz !== undefined && own === this.tz * 60 ? "" : utcLabel(own))
          : this.tz === undefined ? "UTC" : "";
      }
    }
    const speaker = typeof m.speaker === "string" ? m.speaker.trim() : "";
    const who = speaker === "me" || (speaker !== "" && speaker === this.assistant) ? "you" : speaker ? shownSpeaker(speaker) : "user";
    const later =
      m.later === "corrected" || m.is_superseded === true ? " (corrected later)"
      : m.later === "retracted" ? " (taken back later)" : "";
    const rep = typeof m.repeated === "object" && m.repeated !== null
      ? (m.repeated as { times?: unknown; first?: { created_at?: unknown } }) : undefined;
    let again = "";
    let timed = "";
    if (Number.isInteger(rep?.times) && (rep?.times as number) >= 2) {
      again = timed = ` (said at least ${rep?.times} times)`;
      const first = instantMs(rep?.first?.created_at);
      if (first !== undefined) {
        timed = ` (said at least ${rep?.times} times, first on ${new Date(first + shift).toISOString().slice(0, 10)})`;
      }
    }
    const content = String(m.content ?? "");
    const words = keptIn(content);
    const line = photo
      ? [`${label} (photo)`, this.speakers ? `${who}:` : "", content.trim() ? words : ""].filter(Boolean).join(" ")
      : this.speakers ? `${label} ${who}: ${words}` : `${label} ${words}`;
    return { at, rank, date, time, zone, text: `${line}${again}${later}`, timed: `${line}${timed}${later}` };
  }

  private lines(said: Said[]): string {
    const out: string[] = [];
    let day: string | null | undefined = null;
    let zone = "";
    let minute: string | undefined;
    said.forEach((s, i) => {
      const z = s.time !== undefined ? s.zone ?? ""
        : s.date === day ? zone
        : said.slice(i).find((t) => t.date === s.date && t.time !== undefined)?.zone ?? "";
      if (s.date !== day || (s.time !== undefined && z !== zone)) {
        out.push(s.date === undefined ? "(no date)" : z ? `${s.date} ${z}` : s.date);
        day = s.date;
        zone = z;
        minute = undefined;
      }
      const head = s.time === undefined ? "" : s.time === minute ? "      " : `${s.time} `;
      if (s.time !== undefined) minute = s.time;
      out.push(head + (s.timed ?? s.text));
    });
    return out.join("\n");
  }
}

function callInput(call: MemoryToolCall): Record<string, unknown> | undefined {
  try {
    const raw = call.input ?? (typeof call.arguments === "string" && call.arguments.trim() ? parseFiniteJson(call.arguments) : {});
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    return undefined;
  }
}

async function* walkPages<P>(
  page: (at: any) => Promise<P>,
  rows: (p: P) => Memory[],
  next: (p: P) => [at: unknown, key: string] | undefined,
): AsyncGenerator<Memory> {
  let at: unknown;
  const seen = new Set<string>();
  for (let n = 0; n < MAX_PAGES; n++) {
    const p = await page(at);
    const got = rows(p);
    for (const m of got) yield m;
    const step = next(p);
    if (!step) return;
    if (seen.has(step[1])) {
      if (got.length) throw truncatedWalk(`stopped at page ${n + 1}: the service repeated a cursor, so the store did not end.`);
      return;
    }
    seen.add(step[1]);
    at = step[0];
  }
  throw truncatedWalk(`stopped after ${MAX_PAGES} pages — the store did not end.`);
}

function previewOf(opts: { preview?: boolean }): boolean | undefined {
  if ((opts.preview as unknown) === null) throw new Error("preview must be true or false, got null.");
  return optBool(opts.preview, "preview");
}

function putOffsets(body: Record<string, unknown>, opts: { from?: number; to?: number; center?: number }): void {
  for (const k of ["from", "to", "center"] as const) {
    const v = optRange(opts[k], k, -200, 200);
    if (v !== undefined) body[k] = v;
  }
}

/** What `ask` gives the model that asked. */
export function askForModel(r: AskResult): { ok: boolean; action?: string; text: string; skill?: string; truncated?: boolean } {
  return {
    ok: r.ok,
    ...(r.action ? { action: r.action } : {}),
    text: r.text,
    ...(r.skill ? { skill: r.skill } : {}),
    ...(r.truncated ? { truncated: true } : {}),
  };
}

/** The `ask` tool for one store, from `Client.routerTools`. */
export class RouterTools {
  constructor(
    private readonly client: Client,
    private readonly store: string,
    private readonly opts: Omit<AskOptions, "userId" | "signal">,
  ) {}

  /** The tool, in the model API's own format. */
  definitions(format: "anthropic" | "openai" = "anthropic"): Record<string, unknown>[] {
    format = toolFormat(format);
    const schema = {
      type: "object",
      properties: { request: { type: "string", description: ROUTER_TEXT.toolRequest } },
      required: ["request"],
    };
    return [
      format === "openai"
        ? { type: "function", function: { name: "ask", description: ROUTER_TEXT.tool, parameters: schema } }
        : { name: "ask", description: ROUTER_TEXT.tool, input_schema: schema },
    ];
  }

  /** Answer one call of `ask` with the JSON text the model reads. */
  async run(call: MemoryToolCall, opts: { signal?: AbortSignalLike } = {}): Promise<string> {
    if (call?.name !== "ask") throw new Error(`not the ask tool: ${JSON.stringify(call?.name)}`);
    const input = callInput(call);
    if (!input) return JSON.stringify({ ok: false, text: ROUTER_TEXT.notJson });
    const request = input.request;
    if (typeof request !== "string" || !request.trim()) return JSON.stringify({ ok: false, text: ROUTER_TEXT.noRequest });
    const r = await this.client.ask(request, { ...this.opts, userId: this.store, ...(opts.signal ? { signal: opts.signal } : {}) });
    return JSON.stringify(askForModel(r));
  }
}

/** Options of `anthropicCaller`. */
export interface AnthropicCallerOptions {
  apiKey: string;
  /** The model it uses when the client names none. */
  model?: string;
  /** Default `https://api.anthropic.com`. */
  baseUrl?: string;
  /** How long Anthropic keeps a cached prompt prefix (default `"5m"`). */
  cacheTtl?: "5m" | "1h";
  fetch?: FetchLike;
  /** Run in a browser page, which is refused by default because the key would be readable there. */
  dangerouslyAllowBrowser?: boolean;
}

/** Options of `openaiCaller`. */
export interface OpenAICallerOptions {
  /** The API's base URL; calls go to `{baseUrl}/chat/completions`. */
  baseUrl: string;
  /** The model it uses when the client names none. */
  model: string;
  /** Sent as `Authorization: Bearer`; leave it out for a server that takes none. */
  apiKey?: string;
  /** How the router's JSON is asked for first (default `"json_schema"`). */
  responseFormat?: "json_schema" | "json_object" | "none";
  /** Default `"max_completion_tokens"` on api.openai.com, else `"max_tokens"`. */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  /** Send a call's effort as `reasoning_effort` (default off). */
  reasoningEffort?: boolean;
  fetch?: FetchLike;
  /** Run in a browser page with a key, which is refused by default because the key would be readable there. */
  dangerouslyAllowBrowser?: boolean;
}

/** The default caller: Anthropic's Messages API. */
export function anthropicCaller(opts: AnthropicCallerOptions): ModelCaller {
  if (!isPlainObject(opts)) throw new Error("anthropicCaller needs { apiKey }.");
  checkOpts(opts, KNOWN_ANTHROPIC_CALLER_KEYS, "anthropicCaller");
  const key = checkModelKey(opts.apiKey, "apiKey");
  const base = providerUrl(opts.baseUrl ?? ANTHROPIC_BASE_URL, undefined, true);
  const model = opts.model == null ? undefined : checkModelName(opts.model, "anthropicCaller model");
  if (opts.cacheTtl != null && opts.cacheTtl !== "5m" && opts.cacheTtl !== "1h") throw new Error('cacheTtl must be "5m" or "1h".');
  const ttl = opts.cacheTtl ?? "5m";
  if (optBool(opts.dangerouslyAllowBrowser, "dangerouslyAllowBrowser") !== true && inBrowserPage()) throw new Error(MODEL_KEY_BROWSER_REFUSAL);
  const transport = providerTransport(opts.fetch);
  const headers = { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION };
  const caller = {
    ...(model !== undefined ? { model } : {}),
    baseUrl: base,
    call: async (c: ModelCall): Promise<ModelReply> =>
      anthropicReply(await providerPost(transport, `${base}/v1/messages`, headers, anthropicBody(c, false, ttl), c.signal)),
    countTokens: async (c: ModelCall): Promise<number> => {
      const r = await providerPost(transport, `${base}/v1/messages/count_tokens`, headers, anthropicBody(c, true, ttl), c.signal);
      const n = r.input_tokens;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new ModelCallError(200, "count_tokens answered without input_tokens");
      return n;
    },
    toJSON: (): Record<string, string> => ({ provider: "anthropic", baseUrl: base, apiKey: maskKey(key) }),
    [Symbol.for("nodejs.util.inspect.custom")]: (): string => `anthropicCaller(${base}, apiKey=${maskKey(key)})`,
  };
  return caller;
}

/** A caller for any server that speaks OpenAI's chat completions. */
export function openaiCaller(opts: OpenAICallerOptions): ModelCaller {
  if (!isPlainObject(opts)) throw new Error("openaiCaller needs { baseUrl, model }, and apiKey unless the server takes none.");
  checkOpts(opts, KNOWN_OPENAI_CALLER_KEYS, "openaiCaller");
  const base = providerUrl(opts.baseUrl, undefined, !(opts.apiKey == null || opts.apiKey === ""), "the base URL without them, e.g. https://api.openai.com/v1");
  const model = checkModelName(opts.model, "openaiCaller model");
  const key = opts.apiKey == null || opts.apiKey === "" ? undefined : checkModelKey(opts.apiKey, "apiKey");
  const formats = ["json_schema", "json_object", "none"] as const;
  let level = opts.responseFormat == null ? 0 : (formats as readonly string[]).indexOf(opts.responseFormat);
  if (level < 0) throw new Error('responseFormat must be "json_schema", "json_object" or "none".');
  const host = (tryUrl(base)?.hostname ?? "").toLowerCase();
  const maxField = opts.maxTokensField ?? (host === "api.openai.com" ? "max_completion_tokens" : "max_tokens");
  if (maxField !== "max_tokens" && maxField !== "max_completion_tokens") throw new Error('maxTokensField must be "max_tokens" or "max_completion_tokens".');
  const effort = optBool(opts.reasoningEffort, "reasoningEffort") === true;
  const allowBrowser = optBool(opts.dangerouslyAllowBrowser, "dangerouslyAllowBrowser") === true;
  if (key !== undefined && !allowBrowser && inBrowserPage()) throw new Error(MODEL_KEY_BROWSER_REFUSAL);
  const transport = providerTransport(opts.fetch);
  const headers: Record<string, string> = key === undefined ? {} : { authorization: `Bearer ${key}` };
  const caller = {
    model,
    baseUrl: base,
    call: async (c: ModelCall): Promise<ModelReply> => {
      for (;;) {
        const format = c.schema ? formats[level] : "none";
        try {
          const r = await providerPost(transport, `${base}/chat/completions`, headers, openaiBody(c, format, maxField, effort), c.signal, openaiReason);
          return openaiReply(r);
        } catch (e) {
          const refused = e instanceof ModelCallError && FORMAT_REFUSED.has(e.status) && (e.reason === undefined || e.reason === "bad_request") &&
            /response_format|json_schema|json_object/i.test(e.message);
          if (!c.schema || format === "none" || !refused || c.signal.aborted) throw e;
          level = Math.max(level, formats.indexOf(format) + 1);
          logDebug(`openaiCaller ${base}: response_format ${format} refused (${(e as ModelCallError).status}); asking with ${formats[level]}`);
        }
      }
    },
    toJSON: (): Record<string, string> => ({ provider: "openai-compatible", baseUrl: base, model, apiKey: key === undefined ? "none" : maskKey(key) }),
    [Symbol.for("nodejs.util.inspect.custom")]: (): string =>
      `openaiCaller(${base}, model=${model}, apiKey=${key === undefined ? "none" : maskKey(key)})`,
  };
  return caller;
}

function sleepCaller(c: unknown, what: string, wontoposBase: string): { caller: ModelCaller; model: string } {
  const caller = asCaller(c, what);
  if (caller.baseUrl !== undefined) providerBase(caller.baseUrl, wontoposBase);
  return { caller, model: checkModelName(caller.model ?? SLEEP_MODEL, `${what}.model`) };
}

/** An older name for `Client`. */
export const WME = Client;
export default Client;
