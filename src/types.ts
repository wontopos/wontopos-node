/** Quota from a response's `X-RateLimit-*` headers. */
export interface RateLimit {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

/** One memory, as a call returns it. */
export interface Memory {
  id?: string;
  content?: string;
  category?: string;
  similarity?: number;
  importance?: number;
  time_bucket?: string;
  is_superseded?: boolean;
  superseded_by?: string | null;
  created_at?: string;
  event_date?: string;
  speaker?: string;
  tz_offset_minutes?: number;
  repeated?: Repeated;
  [key: string]: unknown;
}

/** The same words said more than once, on a memory that stands for all of them. */
export interface Repeated {
  times?: number;
  first?: { created_at?: string; [key: string]: unknown };
  ids?: string[];
  [key: string]: unknown;
}

export interface StoreResult {
  id?: string;
  /** Starts with `"stored"` (match on the prefix), or is `"duplicate"` when a model older than Scroll 2 saved nothing. */
  status?: string;
  duplicate_of?: string;
  note?: string;
  /** `true` when this answer was replayed from an earlier request with the idempotency key you passed; a key the client made is never marked. */
  replayed?: boolean;
  room?: RoomLanding;
  work?: WorkCloseResult;
  [key: string]: unknown;
}

export interface StatusResult {
  status?: string;
  [key: string]: unknown;
}

/** An image to store with a memory, for `add`. */
export interface ImageInput {
  /** Base64; a `data:` URL prefix is accepted. */
  data: string;
  reference?: string;
  /** When the image was taken, RFC3339 or `YYYY-MM-DD`. */
  taken_at?: string;
}

export interface ImageBytes {
  bytes: Uint8Array;
  contentType: string;
}

export interface ImageDeleteResult {
  status?: string;
  memory_id?: string;
  memory_kept?: boolean;
  note?: string | null;
  would_delete_image?: boolean;
  [key: string]: unknown;
}

export interface ImagePage {
  images: Memory[];
  /** Total images in the store. */
  count?: number;
  has_more?: boolean;
  /** Pass back as `before`, with `next_skip_ids` as `skipIds`, for the next page. */
  next_before?: string | null;
  next_skip_ids?: string[];
  [key: string]: unknown;
}

export interface RevisionsResult {
  revised?: number;
  unrevised?: number;
  total?: number;
  counts?: string;
  excludes?: string;
  include?: "revised" | "unrevised";
  matched?: number;
  /** One page, only when asked for with `include`. */
  memories?: Memory[];
  has_more?: boolean;
  /** Pass back as `before`, with `next_skip_ids` as `skipIds`, for the next page. */
  next_before?: string | null;
  next_skip_ids?: string[];
  ordered_by?: string;
  [key: string]: unknown;
}

/** One version in a memory's chain of edits. */
export interface LineageStep {
  memory_id?: string;
  content?: string;
  speaker?: string | null;
  created_at?: string | null;
  changed_at?: string | null;
  action?: string | null;
  confidence?: number | null;
  superseded_by?: string | null;
  is_current?: boolean;
  [key: string]: unknown;
}

export interface LineageResult {
  memory_id?: string;
  chain: LineageStep[];
  count?: number;
  truncated?: boolean;
  [key: string]: unknown;
}

export interface SpeakerPage {
  speaker?: string;
  memories: Memory[];
  chunks?: number;
  records_to_delete?: number;
  /** @deprecated Use `records_to_delete`. */
  points_to_delete?: number;
  returned?: number;
  has_more?: boolean;
  next_before?: string | null;
  next_skip_ids?: string[];
  [key: string]: unknown;
}

export interface UpdateResult {
  old_memory_id?: string;
  new_memory_id?: string;
  status?: string;
  room?: RoomLanding;
  [key: string]: unknown;
}

export interface SearchResult {
  memories: Memory[];
  /** The assistant's own words. */
  self_memories: Memory[];
  images: Memory[];
  verify_used?: number;
  [key: string]: unknown;
}

export interface RecallResult {
  short_term: { turns: HistoryTurn[]; count: number; [key: string]: unknown };
  long_term: { memories: Memory[]; count: number; cutoff?: string; [key: string]: unknown };
  context: { around_top_memory: string[]; count: number; [key: string]: unknown };
  rooms?: { memories: Memory[]; count: number; rooms?: RecallRoom[]; [key: string]: unknown };
  rooms_off?: string;
  clock?: Clock;
  images?: { memories: Memory[]; count: number; [key: string]: unknown };
  /** Ids of memories left out as repeats of ones already handed to you. */
  said_again?: string[];
  [key: string]: unknown;
}

/** One room a recall looked in. */
export interface RecallRoom {
  /** Such as `"m0"` (this morning) or `"n1"` (last night). */
  name: string;
  from?: string;
  to?: string;
  found?: number;
  ids?: string[];
  none?: boolean;
  not_yet?: boolean;
  [key: string]: unknown;
}

/** Where a write was filed in the rooms. */
export interface RoomLanding {
  name?: string;
  stored?: boolean;
  [key: string]: unknown;
}

/** The person's clock as the service read it. */
export interface Clock {
  now?: string;
  local_now?: string;
  tz_offset_minutes?: number;
  today_start?: string;
  current_room?: string;
  current_room_start?: string;
  day_boundary?: string;
  [key: string]: unknown;
}

/** A memory a work gave, with its number. */
export interface NumberedMemory extends Memory {
  n: number;
}

/** One room a work step looked in. */
export interface WorkRoom {
  name: string;
  found?: number;
  numbers?: number[];
  not_yet?: boolean;
  [key: string]: unknown;
}

/** Where a work stands, as every work call answers. */
export interface WorkResult {
  work_id: string;
  /** `"seeking"`, `"asked"`, `"kept"` or `"closed"`. */
  state?: string;
  memories?: NumberedMemory[];
  count?: number;
  none?: boolean;
  new_tokens?: number;
  steps_used?: number;
  steps_left?: number;
  deeper_left?: number;
  numbered?: number;
  numbers_left?: number;
  rooms?: WorkRoom[];
  [key: string]: unknown;
}

/** One piece of what was said around a memory. */
export interface AroundPiece {
  /** Offset from the memory: -1 before it, +1 after. */
  at: number;
  id?: string;
  content?: string;
  created_at?: string;
  event_date?: string;
  speaker?: string;
  tz_offset_minutes?: number;
  /** `"corrected"` or `"retracted"` when it changed after it was said. */
  later?: string;
  [key: string]: unknown;
}

export interface AroundResult {
  memory_id?: string;
  start?: number;
  end?: number;
  count?: number;
  pieces: AroundPiece[];
  holds?: [number, number][];
  not_given?: { from: number; to: number; why: string }[];
  [key: string]: unknown;
}

export interface WorkAroundResult extends WorkResult {
  n?: number;
  center?: number;
  pieces?: AroundPiece[];
  holds?: [number, number][];
  not_given?: { from: number; to: number; why: string }[];
}

export interface WorkCloseResult extends WorkResult {
  closed?: boolean;
  trace?: string;
  tag?: { landed?: boolean; why?: string; [key: string]: unknown };
}

export interface WorkState {
  open?: number;
  works?: { work_id: string; question?: string; state?: string; trace?: string; [key: string]: unknown }[];
  traces?: unknown[];
  [key: string]: unknown;
}

export interface WhyResult {
  memory_id?: string;
  none?: boolean;
  inference?: unknown;
  why?: string;
  [key: string]: unknown;
}

export interface RetrievalsPage {
  on?: boolean;
  count?: number;
  entries: { at?: string; op?: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

/** Where a `sleepRead` page stopped; pass it back unchanged. */
export type SleepCursor = Record<string, unknown>;

export interface SleepPage {
  memories: (Memory & { tokens?: number })[];
  count?: number;
  tokens?: number;
  exhausted?: boolean;
  next_cursor?: SleepCursor | null;
  from?: string;
  to?: string;
  clock?: Clock;
  /** Pass back as `sleepId` to read on in the same sleep. */
  sleep_id?: string | null;
  sleep_expires_at?: string | null;
  [key: string]: unknown;
}

export interface SleepVerifyResult {
  sleep_id?: string;
  /** `true` when the sleep is in force and handed out every cited entry. */
  ok?: boolean;
  expired?: boolean;
  issued_at?: string;
  expires_at?: string;
  evidence?: number;
  unknown?: string[];
  read?: { memories?: number; tokens?: number; pages?: number; [key: string]: unknown };
  store?: { memories?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface SleepDoneResult {
  sleep_id?: string;
  /** `false` for a sleep that ends no later than the last one. */
  changed?: boolean;
  last_sleep?: Record<string, unknown>;
  [key: string]: unknown;
}

/** One of the being's files: the core (slot 0) or a box (1 to 4). */
export interface SleepFile {
  slot?: number;
  title?: string;
  version?: number;
  tokens?: number;
  written_at?: string | null;
  day?: string | null;
  body?: string;
  evidence?: string[];
  evidence_count?: number;
  latest_version?: number;
  sleep_id?: string | null;
  [key: string]: unknown;
}

export interface SleepFiles {
  core?: SleepFile;
  files: SleepFile[];
  notes_version?: number;
  [key: string]: unknown;
}

export interface SleepFileHistory {
  slot?: number;
  latest_version?: number;
  count?: number;
  versions: SleepFile[];
  [key: string]: unknown;
}

/** One new version of one of the being's files, for `writeSleepFiles`. */
export interface SleepFileWrite {
  /** 0 is the core, 1 to 4 the boxes. */
  slot: number;
  /** The version it was read at. */
  base_version: number;
  title?: string;
  body: string;
  evidence?: string[];
  /** The day it is written on, "YYYY-MM-DD". */
  day?: string;
}

export interface SleepWriteResult {
  sleep_id?: string;
  written: SleepFile[];
  [key: string]: unknown;
}

export interface SleepNotes {
  version?: number;
  notes?: { proposals?: Record<string, unknown>[]; mixed?: Record<string, unknown>[]; [key: string]: unknown };
  written_at?: string | null;
  bytes?: number;
  [key: string]: unknown;
}

export interface SleepNotesWriteResult {
  version?: number;
  written_at?: string | null;
  bytes?: number;
  [key: string]: unknown;
}

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

/** One turn of the recent conversation. */
export interface HistoryTurn {
  role?: string;
  speaker?: string;
  content?: string;
  timestamp?: string;
  /** @deprecated Not sent. */
  user_msg?: string;
  /** @deprecated Not sent. */
  assistant_msg?: string;
  [key: string]: unknown;
}

export interface UsageResult {
  window_days?: number;
  /** This key's lifetime spend. */
  key?: { requests?: number; cost_cents?: number; input_tokens?: number; output_tokens?: number; since?: string };
  workspace?: { workspace_id?: string | null; requests?: number; cost_cents?: number };
  stores?: { store?: string; requests?: number; cost_cents?: number }[];
  /** `true`, with `stores` empty, where only an admin key sees the stores. */
  stores_admin_only?: boolean;
  /** Prepaid balance left on the account; negative means overdrawn. */
  balance_cents?: number;
  expiring_soon_cents?: number;
  subscription?: {
    plan?: string;
    status?: "active" | "inactive";
    week?: {
      used_percent?: number;
      resets_at?: string;
      /** Each UTC day of the week so far, with how much of the week that day used, in percent. */
      days?: { day: string; used_percent: number }[];
    } | null;
    /** `true` when calls carry on with API credit after the week runs out. */
    overflow_to_balance?: boolean;
  };
  [key: string]: unknown;
}

export interface StatsResult {
  total_memories?: number;
  short_term_turns?: number;
  [key: string]: unknown;
}

export interface MemoryPage {
  memories: Memory[];
  count: number;
  /** Pass back as `cursor` for the next page; `null` means there is none. */
  next_cursor: string | null;
  [key: string]: unknown;
}

export interface SelfSearchResult {
  memories: Memory[];
  /** The assistant's own words. */
  self_memories: Memory[];
}

/** What a model can do, as `listModels()` reports it. */
export interface ModelCapabilities {
  images?: boolean;
  engrams?: boolean;
  forms?: boolean;
  re_ask?: boolean;
  self_memories?: boolean;
  speaker_names?: boolean;
  [key: string]: boolean | undefined;
}

export interface ModelInfo {
  id: string;
  name: string;
  available: boolean;
  memory: "shared" | "isolated";
  capabilities?: ModelCapabilities;
  /** When the model retires (RFC3339), if it is scheduled to. */
  retires_at?: string;
  [key: string]: unknown;
}

/** One engram or delivery form, from `listEngrams`. */
export interface EngramInfo {
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface EngramCatalog {
  engrams: EngramInfo[];
  forms: EngramInfo[];
  note?: string;
  [key: string]: unknown;
}

export interface StoreOpResult {
  user_id?: string;
  canonical_id?: string;
  status?: string;
  note?: string;
  [key: string]: unknown;
}

export interface StoreInfo {
  user_id: string;
  created_at: string;
  canonical_id?: string;
  [key: string]: unknown;
}

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

export interface SpeakersList {
  speakers: SpeakerInfo[];
  count?: number;
  limit?: number;
  [key: string]: unknown;
}

export interface StoreSettings {
  user_id?: string;
  /** An IANA name such as `"Asia/Seoul"`, or `null` until one is set. */
  time_zone?: string | null;
  utc_offset_minutes?: number | null;
  default_speakers?: DefaultSpeakers;
  speakers?: string[];
  history?: SettingsChange[];
  status?: string;
  changed?: string[];
  [key: string]: unknown;
}

/** A store's default speakers; `null` names no one. */
export interface DefaultSpeakers {
  user?: string | null;
  assistant?: string | null;
  [key: string]: unknown;
}

/** One change to a store's settings. */
export interface SettingsChange {
  at?: string;
  field?: string;
  from?: string | null;
  to?: string | null;
  confirmed_by_user?: boolean;
  [key: string]: unknown;
}

export interface RelabelResult {
  status?: string;
  from?: string;
  to?: string;
  relabelled?: number;
  /** `false` when some memories still carry `from`. */
  complete?: boolean;
  window_lines?: number;
  not_found?: string[];
  at?: string;
  again?: string;
  [key: string]: unknown;
}

export interface ForgetSpeakerResult {
  status?: string;
  speakers?: string[];
  memories_deleted?: number;
  photos_deleted?: number;
  window_lines_deleted?: number;
  would_delete?: number;
  /** `false` when the delete did not finish. */
  complete?: boolean;
  again?: string;
  [key: string]: unknown;
}

/** One memory a line of the recent conversation had in hand, as it stands now. */
export interface SeenMemory {
  id?: string;
  /** `"current"`, `"superseded"`, `"retracted"` or `"gone"`. */
  status?: string;
  /** The memory's first 120 characters. */
  content?: string;
  created_at?: string;
  event_date?: string;
  speaker?: string;
  current_id?: string;
  [key: string]: unknown;
}

export interface SeenResult {
  line?: { role?: string; speaker?: string; timestamp?: string; content?: string; [key: string]: unknown } | null;
  matched?: string;
  count?: number;
  seen: SeenMemory[];
  [key: string]: unknown;
}

export interface ClearWindowResult {
  status?: string;
  cleared?: number;
  kept?: number;
  [key: string]: unknown;
}

/** Narrow a search to part of a store. */
export interface SearchFilters {
  categories?: string[];
  /** When the memory was stored. */
  time_from?: string;
  time_to?: string;
  /** When the content happened. */
  event_from?: string;
  event_to?: string;
  /** Only memories of at least this importance, 0 to 1. */
  min_importance?: number;
  speakers?: string[];
}

/** Known `search` options; an unknown key is refused before anything is sent. */
export interface SearchOptions {
  /** Recall caching, for a query you repeat. */
  cache_control?: { ttl: "5m" | "1h" };
  speaker?: string;
  filters?: SearchFilters;
  /** Re-ask passes, 0-3. */
  verify?: number;
  /** Image memories the answer may carry, 0-5 (default 1). */
  max_images?: number;
  /** Delivery form, "memoir" or "archive". */
  form?: string;
  /** Your UTC offset in hours, for `form`. */
  tz?: number;
  /** Fields this version does not know, merged into the request. */
  extra?: Record<string, unknown>;
}

/** Per-call options for a write. */
export interface WriteOptions {
  idempotencyKey?: string;
  /** An image to store with the text, read by `add` only. */
  image?: ImageInput;
  /** The person's clock for this write, UTC offset in hours (default the client's `tz`); `addBulk` does not send it. */
  tz?: number;
  /** An open work an `add` or `addTurn` answers; the work then closes. */
  workId?: string;
  /** Also put the line in the short-term window, for `add` only. */
  window?: boolean;
  windowRole?: string;
}

/** Options of `addTurn`. */
export interface AddTurnOptions extends WriteOptions {
  /** When the exchange happened: a `Date`, or RFC 3339 with an offset. */
  createdAt?: string | Date;
  userSpeaker?: string;
  assistantSpeaker?: string;
}

/** One part of a conversation for `addBulk`. */
export interface BulkSegment {
  content: string;
  speaker?: string;
  created_at?: string;
}

/** Options of `addBulk`. */
export interface BulkOptions extends WriteOptions {
  /** A conversation in parts, in place of `content`. */
  segments?: BulkSegment[];
  speaker?: string;
}

/** Why an ask did not go through. */
export type AskReason =
  | "not_configured" | "no_time_zone" | "no_skills" | "limit" | "too_large"
  | "credit" | "spend_limit" | "auth" | "rate_limit" | "overloaded" | "timeout" | "cancelled"
  | "network" | "bad_model" | "bad_request" | "refusal" | "truncated" | "tool_error"
  | "bad_choice" | "needs_confirmation" | "failed";

/** A skill: one thing the router can choose to do for the model that asks. */
export interface SkillDefinition {
  /** 1-32 of `[a-z0-9_]`, starting with a letter. */
  name: string;
  /** What the router reads to choose it. */
  description: string;
  kind: "llm" | "code";
  /** JSON Schema of the input the router fills in. */
  input: Record<string, unknown>;
  instructions?: string;
  /** `llm` only: the most the skill model writes (default 7000). */
  max_tokens?: number;
  effort?: string;
  model?: string;
  /** `llm` only: the name of a caller in `router.callers` that runs it. */
  caller?: string;
  /** Run only after a person agrees, through `runSkill`. */
  confirm?: boolean;
  /** Anything the app keeps with the skill; never sent to a model. */
  metadata?: Record<string, unknown>;
}

/** What `importSkillMd` sets beside what a SKILL.md carries. */
export interface SkillMdOptions {
  /** Default: the frontmatter's, with hyphens as `_`. */
  name?: string;
  /** Default: one `task` string. */
  input?: Record<string, unknown>;
  model?: string;
  caller?: string;
  max_tokens?: number;
  effort?: string;
  confirm?: boolean;
}

/** Whether `ask` read its history and kept its exchange. */
export interface AskHistory {
  read: "ok" | "failed" | "off" | "skipped";
  pushed: "ok" | "failed" | "off" | "skipped";
}

/** The provider's usage numbers for the router call and the skill calls, summed. */
export interface AskUsage {
  router?: Usage;
  skill?: Usage;
}

/** What `ask` returns; give the model `text`, or `askForModel`'s answer. */
export interface AskResult {
  ok: boolean;
  action?: "skill" | "explain" | "cannot";
  /** For the model: the skill's result, the router's words, or why not. */
  text: string;
  skill?: string;
  truncated?: boolean;
  reason?: AskReason;
  /** The input the router gave the skill, for `runSkill` after a yes. */
  input?: Record<string, unknown>;
  /** What failed, in words for you, never for the model. */
  detail?: string;
  store: string;
  askId: string;
  history: AskHistory;
  usage?: AskUsage;
}

export interface AskReadiness {
  ok: boolean;
  reason?: AskReason;
  text?: string;
  detail?: string;
}

/** One exchange kept on a store's router channel. */
export interface RouterExchange {
  request: string;
  answer: string;
  speaker?: string;
  at?: string;
  [key: string]: unknown;
}
