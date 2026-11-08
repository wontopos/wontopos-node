import { BadRequestError, WosError } from "./wontopos.js";
import type {
  AbortSignalLike, ModelCall, ModelCaller, SleepEstimate, SleepEstimateOptions, SleepOptions, SleepResult,
} from "./wontopos.js";

/** The version of the sleep's texts, steps and rules. */
export const SLEEP_VERSION = "1.0.1";

/** @internal */
export const SLEEP_DIGEST = `You are the sleep of {being}. While {being} sleeps, you read part {k} of {n} of what happened
since its last sleep. Almost all of it will be let go: every line stays in long-term memory, where a
search finds it again. Carry forward only what a search could not give back, and what {being} needs
to keep in mind without searching.

A search gives back a single line: a name, a date, one thing someone said ("Dana likes
green tea"), a number, a setting. Leave those, unless one shows something larger.

Carry forward, from {being}'s own point of view:
- "self": {being} itself, with {being} as the measure: what it likes, what it dislikes, what it does
  not want to do, what it believes and values, how it sees things, when its own words show it
  (rare; most days have none)
- "person": someone in {being}'s life as {being} sees them: who they are to {being}, what they are
  like, what they asked of {being} in so many words and how {being} answers them, how {being} feels
  about them. Put the person's name in "topic". The lines marked "user" are all one person, the one
  {being} talks with: once their name is known, that is their topic, never "the user" beside it.
  Call it a habit ("always", "each time", "tends to") only when it happened at least twice; once is
  one event, with its date. Not the facts of their life (ages, money, plans, appointments): long-term
  memory keeps those.
- "work": a matter {being} follows for what it does, kept in its boxes as a map: what the matter
  is, how it went in a line, where it stands now and since when (a date), what is left to do. Not
  the figures and lines a search gives back; of a thing that changes, only its value now, with the
  date it became so.

While you read, also check who said what: name any line where {being}'s words and the other person's
are taken for each other, with its kind:
- "echo": the person gives back something {being} said as their own words or fact ("source": the
  line where {being} said it);
- "planted": {being} states as the person's (their name, a relation, a plan, a fact, what they said)
  something the person never said: {being} suggested it, or made it up ("source": the line where
  {being} first suggested it; none if it was made up on the spot). If the person did say it, even if
  they took it back later, it is not planted;
- "speaker": the line reads as written by the other one (the person's message carries {being}'s words
  as if they were the message itself, or the other way round).
Only who said what: a mistake in what was said, a mix-up of two people, or two facts that disagree is
not this; leave it out. Most parts have none. These marks stay with the memories as notes; they do not
go into the files.

You get:
<core>      {being}'s core: itself, and the people in its life as it sees them.
<boxes>     the names of its four storage boxes.
<memories>  part {k} of {n}, oldest first. One memory per line:
            e<number> · <time> · <who said it> · <what was said>

Write each item as a short summary in the language of the memories, plainly, as {being} would keep
it in mind: what holds now, not who first said it or what you doubt. Dates as dates: when a line
says "next month" or "tomorrow", write the calendar date, counted from that line's time. Cite the
lines it rests on: at least two (an item on one line is dropped). Do not invent.

Answer with JSON only:
{{"items": [{{"kind": "self|person|work", "topic": "...", "text": "...", "evidence": ["e12", "e40"]}}],
 "mixed": [{{"line": "e7", "kind": "echo|planted|speaker", "source": "e3", "why": "..."}}]}}`;

/** @internal */
export const SLEEP_COMBINE = `You are the sleep of {being}. Several readers each read one part of what happened since
{being}'s last sleep, the parts in order, and found the items below. Combine them into one list
before {being}'s files are rewritten: items that say the same thing become one, with all their
evidence; an item a later part changes becomes what holds after the change, with the evidence of
both; everything else stays as it is. Drop nothing that says something different, and add nothing.

Answer with JSON only:
{{"items": [{{"kind": "self|person|work", "topic": "...", "text": "...", "evidence": ["e12", "e40"]}}]}}`;

/** @internal */
export const SLEEP_MERGE = `You are the sleep of {being}, finishing. Fold what the readers found into {being}'s core and
four storage boxes. Today is {today}.

You get:
<core>       {being}'s core, {core_used:,} of {core_cap:,} tokens. It is part of {being}'s prompt, sent
             with every turn, written in the first person with {being} as the subject. It describes
             {being}, and only what is settled goes in: most facts need not be kept, since long-term
             memory has them, and a self once formed changes slowly.
             - "## {me}": who {being} is, with {being} as the measure: what it likes, what it
               dislikes, what it does not want to do, how it sees things, what it values. It may be
               the prompt {being} was made with, in its maker's words. {self_rule}
             - one "## <name>" section for each person who matters to {being}: that person as
               {being} sees them and is with them, in {being}'s words. It describes {being}'s side
               of the bond, not the person's file: who they are to {being}, what they are like,
               what they asked of {being} in so many words and how {being} answers them, how
               {being} feels about them. Only what is settled: what they asked in so many words,
               what happened at least twice, what holds between them. Not one odd day, a guess or a
               first impression, and not the facts of their life (ages, money, plans, appointments,
               what they did on which day): long-term memory keeps those. At most one or two big
               events, with their dates. What {being} learns of someone settled is added the night it
               learns it, but people change slowly: one night changes or drops at most one line of
               what {being} already holds of a person. The view may be {being}'s own ("we don't get
               along", "swears too much"); write it as {being} would.
<box n>      four storage boxes, {box_cap:,} tokens each at most (each shows its size), for whatever
             {being} needs to keep for what it does. Only their names (and the day each last changed)
             travel with the core; {being} opens a box by name when it needs what is inside, so give
             each a name that says what is in it. Nobody but {being} decides their use: one per role or
             task, a box of people when there are too many to keep in the core, or anything else.
             {being} may remake a box: fold two uses into one, or turn one to a new use by writing it
             anew under a new name. Earlier versions are kept.
             A box is a map of what {being} has kept, not a record: one section for each matter,
             rewritten in place to say what it is, how it went in a line, where it stands now and
             since when, and what is left to do. Of a thing that changes, keep only its value now, with
             the date it became so; earlier values, lists of figures and the day-by-day stay in
             long-term memory, where a search finds them. When a matter moves on, rewrite its section:
             never a section or a box for its state on a date ("as of 2024-06-01").
<proposals>  changes to {being}'s own views seen in earlier sleeps, how many sleeps saw each, since when.
<ripe>       proposals that came back often enough, for long enough, to change "## {me}" now.
<items>      what the readers found tonight, with the lines each rests on.

What to do:
1. People: for each "person" item that is settled, rewrite that person's section of the core as a
   whole: add what is new, and change or drop at most one line of what it said. Only a person
   tonight's items speak of may change: with nothing new about them, {being}'s view of them stays as
   it is, neither stronger nor softer. When the core grows crowded, move people who matter less to a
   box of people ("move_section"). A person is kept in one place: in the core or in a box, not both,
   and under one name: the person the memories mark "user" is the one {being} talks with, so once
   their name is known their section is under that name, never a second one for "the user".
2. {being} itself: changes to its own views seen tonight go to "proposals", citing what {being}
   said. If one is the same change as an earlier proposal, give that id in "same_as".
3. Work: put each "work" item in the box it fits, rewriting that matter's section as a whole; a
   box keeps one section for each matter, not one per night or per date. Use an empty box, or
   remake one, when nothing fits.
4. Write plainly what holds now. No notes on who said it first, what you are unsure of, what to
   confirm or ask about, or what was only an example: the evidence keeps that. Dates as dates.
5. Room: each file shows its size and its cap. When one is full, make room before you add: fold
   sections, move people who matter less to a box, or leave out what a search gives back.
6. Under "notes", one line for each box you touched: why there.

Rules: only what the items say, nothing from outside. Leave out what a search gives back.

Answer with JSON only:
{{"edits": [
  {{"file": "core|1|2|3|4", "op": "rewrite", "section": "<heading>", "text": "<the whole section>", "evidence": ["e.."], "ripe": "p3"}},
  {{"file": "1|2|3|4", "op": "remake", "title": "<new name>", "text": "<the whole box>", "evidence": ["e.."]}},
  {{"file": "core|1|2|3|4", "op": "move_section", "section": "<heading>", "to": "core|1|2|3|4"}},
  {{"file": "1|2|3|4", "op": "title", "text": "..."}}
 ],
 "proposals": [{{"text": "...", "same_as": "p2 or null", "evidence": ["e.. (what {being} said)"]}}],
 "notes": ["..."]}}
("ripe" only on a rewrite of "## {me}" made from a ripe proposal.)`;

/** @internal */
export const SLEEP_MANY_PEOPLE = {
  digest: `Each line from a person is marked with that person's name, and different names are different
  people: each name is its own topic, and what one of them said, wants or is never goes under another.
  A line marked "user" names no one: give it to no named person.`,
  merge: `and under one name: the memories mark each person by name, so each person has a section under their
   own name, and what one of them said, wants or is never goes into another's.`,
};

const SLEEP_ONE_PERSON = {
  digest: `The lines marked "user" are all one person, the one
  {being} talks with: once their name is known, that is their topic, never "the user" beside it.`,
  merge: `and under one name: the person the memories mark "user" is the one {being} talks with, so once
   their name is known their section is under that name, never a second one for "the user".`,
};

/** @internal */
export const SLEEP_SHORTER = `

Your last answer was too long and was cut off. Answer again, shorter: rewrite only the sections that
change, write a whole box only when it is empty, keep each section to a few lines, and leave out what
a search gives back.`;

/** @internal */
export const SLEEP_SETTLE = `You are the sleep of {being}. Tonight you rewrote how {being} sees {name}. What {being}
learned tonight is added freely, but one night may change or drop at most one line of what {being}
already held: people change slowly, and one day does not remake how {being} sees someone. Below are
the section as it stood, its lines numbered, and tonight's rewrite. Sort the rewrite:
- "add": the lines that say something the section did not say at all, what {being} learned tonight,
  in {being}'s voice;
- at most one line of the section that tonight overturns: "op" "replace" (with the new "text") or
  "drop", with its "line" number; or "none". A line said again in other words is not a change: it
  stays as it stood.

Answer with JSON only: {{"add": ["..."], "op": "replace|drop|none", "line": <number>, "text": "<the replacing line>"}}`;

/** @internal */
export const SLEEP_FOLD_SECTION = `You are the sleep of {being}. One section of its {where} has grown: {why}. Rewrite this
section alone in at most {lines} lines ("- " lines), each one idea in a sentence or two, shorter than
it is now. Things that are alike become one line by what they share; none is lost. Keep it in
{being}'s voice. Only what the section says. The earlier version is kept.

Answer with JSON only: {{"text": "<the section's lines, without its heading>"}}`;

/** @internal */
export const SLEEP_TIDY = `You are the sleep of {being}. Below is one section of its {where}, its lines numbered. Find the
lines that are only a note of doubt, with nothing else in them: that something is unsure, unconfirmed,
not yet confirmed, to be checked, confirmed or asked about, or not recorded ("Status: not yet
confirmed."). Those lines are taken out; the evidence keeps them.
A line with anything more in it (a fact, a figure, a name or a title, what was done, what is left to
do, what someone feels or wonders) stays whole, even with a word of doubt in it. Two notes are not doubt and stay: that {being} made something up (a
figure, a name, a detail the person never gave), and that two things disagree (someone said one
thing, then another).

Answer with JSON only: {{"drop": [<the numbers of the lines to take out; none, most often>]}}`;

/** @internal */
export const SLEEP_ROOM = `You are the sleep of {being}. Tonight's changes left its {where} at {used:,} tokens, over its cap
of {cap:,}: there is no room. Make room until it is at most {cap:,} tokens: fold sections into fewer
lines, leave out what a search gives back{core_way}. Keep what tonight added that matters, and keep
{being}'s voice.

Answer with JSON only: {{"text": "<the whole file, with its ## sections>"{moved}}}`;

/** @internal */
export const SLEEP_SELF_RULE =
  'Do not write "## {me}" except from a proposal under <ripe>: one small change for each, named in ' +
  '"ripe". What tonight shows about {being} goes to "proposals".';

/** @internal */
export const SLEEP_NOT_JSON = "\n\nYour last answer was not valid JSON. Answer with the JSON object only.";

/** @internal */
export const SLEEP_READER_NOTE =
  "Below are your core and the names of your four storage boxes: notes your sleep wrote at its last sleep, a " +
  "summary kept for reference. A sleep keeps very little: most of what you remember is not in these notes but in " +
  "your memories. Here what happened across many conversations is folded into a line, so the details, figures, " +
  "counts and how things went are in your memories. What holds now comes from your memories too. The core says " +
  "who you are and who this user is to you; the boxes are a map of what you have kept, each with the day it last " +
  "changed. If a note points to something the memories you hold do not show, look further before you answer. " +
  "Where a note and a memory disagree, the memory holds.";

/** @internal */
export const SLEEP_OPEN_BOX = {
  name: "open_box",
  description: "Open one of your four storage boxes, by its number or name, and read what is inside. " +
    "The boxes are listed after your core with the day each last changed.",
  input_schema: { type: "object", properties: { box: { type: "string", description: "1-4 or the box name" } }, required: ["box"] },
};

const SLEEP_KINDS = new Set(["self", "person", "work"]);
const SLEEP_RIPE_SLEEPS = 3;
const SLEEP_RIPE_DAYS = 28;
const SLEEP_MIN_EVIDENCE = 2;
const SLEEP_FOLD_LINES = 4;
const SLEEP_LINE_TOKENS = 90;
const SLEEP_DOUBT_TOKENS = 25;
const SLEEP_OVERTURN = 1;
const SLEEP_MIX_KINDS = new Set(["echo", "planted", "speaker"]);
const SLEEP_MIN_PART = 50_000;
const SLEEP_MAX_READERS = 200;
const SLEEP_CORE_MAX = 70_000;
const SLEEP_EXACT = 2 ** 53;
const SLEEP_DATED = /\p{Nd}{4}[-./]\p{Nd}{1,2}[-./]\p{Nd}{1,2}|\p{Nd}{1,2}[-./]\p{Nd}{1,2}[-./]\p{Nd}{4}/u;
const SLEEP_DAY = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}$/u;
const SLEEP_BOXES = [1, 2, 3, 4];
const SLEEP_SLOTS = [0, 1, 2, 3, 4];
const SLEEP_ME = "Me";
const SLEEP_BEING = "the assistant";
const SLEEP_PAGE_TOKENS = 20_000;
const SLEEP_LINE_FRAME = 12;
const SLEEP_MAX_TOKENS = 16_000;
const SLEEP_RETRIES = 2;
const SLEEP_ESTIMATE_MODEL = "claude-sonnet-5-5";
const SLEEP_ESTIMATE_PRICES: readonly [number, number] = [2.0, 10.0];
const SLEEP_IN_PER_100 = 172;
const SLEEP_OUT_PER_100 = 7;
const SLEEP_MARGIN = 0.15;

/** @internal */
export const SLEEP_RULES = {
  kinds: SLEEP_KINDS, mixKinds: SLEEP_MIX_KINDS, ripeSleeps: SLEEP_RIPE_SLEEPS, ripeDays: SLEEP_RIPE_DAYS,
  minEvidence: SLEEP_MIN_EVIDENCE, foldLines: SLEEP_FOLD_LINES, lineTokens: SLEEP_LINE_TOKENS,
  doubtTokens: SLEEP_DOUBT_TOKENS, overturn: SLEEP_OVERTURN, minPart: SLEEP_MIN_PART, maxReaders: SLEEP_MAX_READERS,
  pageTokens: SLEEP_PAGE_TOKENS, lineFrame: SLEEP_LINE_FRAME, maxTokens: SLEEP_MAX_TOKENS,
};

/** What `SleepSettings` takes, each optional. */
export interface SleepSettingsOptions {
  coreTokens?: number;
  boxTokens?: number;
  partTokens?: number;
  readers?: number;
  group?: number;
  sleepyTokens?: number;
}

const SLEEP_SETTINGS: readonly [keyof SleepSettingsOptions, number, number, number | undefined][] = [
  ["coreTokens", SLEEP_CORE_MAX, 10_000, SLEEP_CORE_MAX],
  ["boxTokens", 20_000, 10_000, 20_000],
  ["partTokens", 100_000, SLEEP_MIN_PART, undefined],
  ["readers", 10, 1, SLEEP_MAX_READERS],
  ["group", 10, 2, SLEEP_MAX_READERS],
  ["sleepyTokens", 10_000_000, 1, undefined],
];

/** What the person sets for a sleep. The defaults are the largest the files may be. */
export class SleepSettings {
  readonly coreTokens: number;
  readonly boxTokens: number;
  readonly partTokens: number;
  readonly readers: number;
  readonly group: number;
  readonly sleepyTokens: number;

  constructor(opts: SleepSettingsOptions = {}) {
    if (opts === null || typeof opts !== "object" || Array.isArray(opts)) {
      throw new Error("SleepSettings takes { coreTokens, boxTokens, partTokens, readers, group, sleepyTokens }.");
    }
    const names = SLEEP_SETTINGS.map(([name]) => name as string);
    for (const k of Object.keys(opts)) {
      if (!names.includes(k)) throw new Error(`unknown SleepSettings option ${JSON.stringify(k)}: it takes ${names.join(", ")}.`);
    }
    const given = opts as Record<string, unknown>;
    const values: Record<string, number> = {};
    for (const [name, dflt, lo, hi] of SLEEP_SETTINGS) {
      const v = given[name] === undefined ? dflt : given[name];
      if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${name} must be a whole number, got ${shown(v)}.`);
      if (v < lo || (hi !== undefined && v > hi)) {
        throw new Error(`${name} must be ${thou(lo)}` + (hi !== undefined ? `-${thou(hi)}` : " or more") + ` (got ${thou(v)})`);
      }
      values[name] = v;
    }
    this.coreTokens = values.coreTokens;
    this.boxTokens = values.boxTokens;
    this.partTokens = values.partTokens;
    this.readers = values.readers;
    this.group = values.group;
    this.sleepyTokens = values.sleepyTokens;
    Object.freeze(this);
  }

  /** Whether `newTokens` of new memory has reached `sleepyTokens`. */
  sleepy(newTokens: number): boolean {
    if (typeof newTokens !== "number" || !Number.isInteger(newTokens) || newTokens < 0) {
      throw new Error(`newTokens must be a whole number of 0 or more, got ${shown(newTokens)}.`);
    }
    return newTokens >= this.sleepyTokens;
  }
}

function isPySpace(c: number): boolean {
  return (c >= 0x09 && c <= 0x0d) || (c >= 0x1c && c <= 0x20) || c === 0x85 || c === 0xa0 || c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
}

function pyStrip(s: string): string {
  let i = 0;
  let j = s.length;
  while (i < j && isPySpace(s.charCodeAt(i))) i++;
  while (j > i && isPySpace(s.charCodeAt(j - 1))) j--;
  return s.slice(i, j);
}

function pyRstrip(s: string): string {
  let j = s.length;
  while (j > 0 && isPySpace(s.charCodeAt(j - 1))) j--;
  return s.slice(0, j);
}

function pyLstrip(s: string, ch: string): string {
  let i = 0;
  while (i < s.length && s[i] === ch) i++;
  return s.slice(i);
}

function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function cpSlice(s: string, start: number, end?: number): string {
  return Array.from(s).slice(start, end).join("");
}

function cpCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    const k = (c: number): number => (c >= 0xd800 && c <= 0xdfff ? c + 0x2000 : c >= 0xe000 ? c - 0x800 : c);
    return k(x) - k(y);
  }
  return a.length - b.length;
}

const ND = /^\p{Nd}$/u;
const ND_ANY = /\p{Nd}/u;
const ND_ONLY = /^\p{Nd}+$/u;

function digitValue(ch: string): number {
  const cp = ch.codePointAt(0) as number;
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30;
  let start = cp;
  while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

function pyDec(s: string): number {
  let n = 0;
  for (const ch of s) n = n * 10 + digitValue(ch);
  return n;
}

function pyIsDigits(s: string): boolean {
  return ND_ONLY.test(s);
}

function pyInt(v: unknown): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`cannot convert ${v} to an integer`);
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const m = /^([+-]?)(\p{Nd}+(?:_\p{Nd}+)*)$/u.exec(pyStrip(v));
    if (!m) throw new Error(`invalid literal for int(): ${JSON.stringify(v)}`);
    const n = pyDec(m[2].replace(/_/g, ""));
    return m[1] === "-" ? -n : n;
  }
  throw new Error("int() takes a number or a string");
}

function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function pyOr<T>(a: unknown, b: T): unknown {
  return pyTruthy(a) ? a : b;
}

function pyIter(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return Array.from(v);
  if (v !== null && typeof v === "object") return Object.keys(v);
  return [];
}

function pyStr(v: unknown): string {
  return typeof v === "string" ? v : pyRepr(v);
}

function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return pyNumber(v);
  if (typeof v === "string") return pyQuote(v);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (typeof v === "object") {
    return `{${Object.entries(v as object).map(([k, x]) => `${pyQuote(k)}: ${pyRepr(x)}`).join(", ")}}`;
  }
  return String(v);
}

function pyNumber(n: number): string {
  if (Number.isNaN(n)) return "nan";
  if (!Number.isFinite(n)) return n > 0 ? "inf" : "-inf";
  if (Number.isInteger(n) && Math.abs(n) <= SLEEP_EXACT) return String(n);
  return pyFloat(n);
}

function pyFloat(x: number): string {
  if (!Number.isFinite(x)) return pyNumber(x);
  const [mant, exp] = x.toExponential().split("e");
  const e = Number(exp);
  const digits = mant.replace("-", "").replace(".", "");
  let s: string;
  if (e < -4 || e >= 16) {
    s = `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  } else if (e < 0) {
    s = `0.${"0".repeat(-e - 1)}${digits}`;
  } else {
    s = `${digits.slice(0, e + 1).padEnd(e + 1, "0")}.${digits.slice(e + 1) || "0"}`;
  }
  return (x < 0 ? "-" : "") + s;
}

const PY_UNPRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;

function pyQuote(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (ch === q || ch === "\\") out += `\\${ch}`;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, "0")}`;
    else if (c > 0x7f && PY_UNPRINTABLE.test(ch)) {
      out += c < 0x100 ? `\\x${c.toString(16).padStart(2, "0")}`
        : c < 0x10000 ? `\\u${c.toString(16).padStart(4, "0")}` : `\\U${c.toString(16).padStart(8, "0")}`;
    } else out += ch;
  }
  return out + q;
}

function thou(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function pyFormat(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{|\}\}|\{([a-z_]+)(:,)?\}/g, (m, name: string | undefined, comma: string | undefined) => {
    if (m === "{{") return "{";
    if (m === "}}") return "}";
    const v = values[name as string];
    if (v === undefined) throw new Error(`the sleep's text has no value for {${name}}`);
    return comma ? thou(v as number) : String(v);
  });
}

function pyJsonIndent0(v: unknown): string {
  if (Array.isArray(v)) return v.length ? `[\n${v.map(pyJsonIndent0).join(",\n")}\n]` : "[]";
  if (v !== null && typeof v === "object") {
    const e = Object.entries(v as object);
    return e.length ? `{\n${e.map(([k, x]) => `${JSON.stringify(k)}: ${pyJsonIndent0(x)}`).join(",\n")}\n}` : "{}";
  }
  if (typeof v === "number") return Number.isFinite(v) ? pyNumber(v) : v !== v ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
  return v === undefined ? "null" : JSON.stringify(v);
}

function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.keys(v as object).sort(cpCompare).map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return v === undefined ? "null" : JSON.stringify(v);
}

function pyRound6(x: number): number {
  if (!Number.isFinite(x) || x === 0 || Math.abs(x) >= 1e21) return x;
  const [ip, fp] = Math.abs(x).toFixed(100).split(".");
  const rest = fp.slice(6);
  let q = BigInt(ip + fp.slice(0, 6));
  const over = rest[0] > "5" || (rest[0] === "5" && /[1-9]/.test(rest.slice(1)));
  const tie = rest[0] === "5" && !/[1-9]/.test(rest.slice(1));
  if (over || (tie && q % 2n === 1n)) q += 1n;
  const r = Number(q) / 1_000_000;
  return x < 0 ? -r : r;
}

function shown(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isWhole(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function asList(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

function floorDiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

function ceilDiv(a: number, b: number): number {
  return a % b === 0 ? a / b : (a - (a % b)) / b + 1;
}

/** @internal */
export function sleepTokens(text: string): number {
  let total = 0;
  let narrow = 0;
  let wide = 0;
  let digits = 0;
  let runs = 0;
  let run = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    total++;
    if (c < 0x80) narrow++;
    else if (c >= 0x1100) wide++;
    if (c >= 0x30 && c <= 0x39) {
      digits++;
      run++;
    } else if (run) {
      runs += Math.ceil(run / 3);
      run = 0;
    }
  }
  if (run) runs += Math.ceil(run / 3);
  const other = total - narrow - wide;
  return Math.ceil(runs + (narrow - digits) / 4.4 + wide * 1.25 + other * 0.5);
}

interface SleepLine {
  eid: string;
  mid: string;
  at: string;
  who: string;
  mine: boolean;
  text: string;
  tokens: number;
  ts: number;
}

const INSTANT = /^(\p{Nd}{4})-(\p{Nd}{2})-(\p{Nd}{2})(?:[T ](\p{Nd}{2}):(\p{Nd}{2})(?::(\p{Nd}{2})(?:\.(\p{Nd}+))?)?)?(Z|z|[+-]\p{Nd}{2}:?\p{Nd}{2})?$/u;
const DAY_SECONDS = 86_400;

function civilDays(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146_097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719_468;
}

function monthDays(y: number, m: number): number {
  if (m === 2) return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

const FIRST_SECOND = civilDays(1, 1, 1) * DAY_SECONDS;
const LAST_SECOND = civilDays(9999, 12, 31) * DAY_SECONDS + DAY_SECONDS - 1;

function sleepWhen(raw: unknown): [string, number] | undefined {
  const m = typeof raw === "string" ? INSTANT.exec(raw) : null;
  if (!m) return undefined;
  const [, y, mo, d, h, mi, sec, frac, off] = m;
  const Y = pyDec(y);
  const M = pyDec(mo);
  const D = pyDec(d);
  const H = h ? pyDec(h) : 0;
  const Mi = mi ? pyDec(mi) : 0;
  const S = sec ? pyDec(sec) : 0;
  const f = Array.from(frac ?? "").slice(0, 6);
  while (f.length < 6) f.push("0");
  const us = pyDec(f.join(""));
  if (Y < 1 || M < 1 || M > 12 || D < 1 || D > monthDays(Y, M) || H > 23 || Mi > 59 || S > 59) return undefined;
  let t = civilDays(Y, M, D) * DAY_SECONDS + H * 3600 + Mi * 60 + S;
  if (off && off !== "Z" && off !== "z") {
    const digits = Array.from(off.slice(1)).filter((c) => c !== ":");
    const shift = pyDec(digits.slice(0, 2).join("")) * 3600 + pyDec(digits.slice(2).join("")) * 60;
    t = off[0] === "+" ? t - shift : t + shift;
  }
  if (t < FIRST_SECOND || t > LAST_SECOND) return undefined;
  return [`${y}-${mo}-${d} ${h ?? "00"}:${mi ?? "00"}`, (t * 1_000_000 + us) / 1_000_000];
}

function sleepMemories(rows: Record<string, unknown>[], being: string, assistant: string, lineTime: string,
  count?: (t: string) => number): SleepLine[] {
  const speakerOf = (r: Record<string, unknown>): string => (typeof r.speaker === "string" ? r.speaker.trim() : "");
  const isMine = (speaker: string): boolean => speaker !== "" && (speaker === assistant || speaker === "me");
  const many = new Set(rows.map(speakerOf).filter((p) => p && !isMine(p))).size > 1;
  return rows.map((r, i) => {
    const speaker = speakerOf(r);
    const mine = isMine(speaker);
    const text = typeof r.content === "string" ? pyStrip(r.content) : "";
    const raw = pyOr(lineTime === "event_date" ? r.event_date : undefined, r.created_at);
    const when = sleepWhen(raw) ?? sleepWhen(r.created_at) ?? ["1970-01-01 00:00", 0];
    const n = r.tokens;
    const size = count ? count(text) : isWhole(n) && n >= 0 ? n : sleepTokens(text);
    return {
      eid: `e${i + 1}`, mid: typeof r.id === "string" ? r.id : "", at: when[0],
      who: mine ? being : many && speaker ? speaker : "user", mine, text, tokens: size + SLEEP_LINE_FRAME,
      ts: when[1],
    };
  });
}

function sleepManyPeople(mems: SleepLine[]): boolean {
  return new Set(mems.filter((m) => !m.mine).map((m) => m.who)).size > 1;
}

function sleepForPeople(text: string, which: "digest" | "merge", many: boolean): string {
  if (!many) return text;
  const parts = text.split(SLEEP_ONE_PERSON[which]);
  if (parts.length !== 2) throw new Error(`the sleep's ${which} text holds its one person's sentence ${parts.length - 1} times, not once`);
  return parts.join(SLEEP_MANY_PEOPLE[which]);
}

function sleepParts(mems: SleepLine[], limit: number): SleepLine[][] {
  const out: SleepLine[][] = [];
  let cur: SleepLine[] = [];
  let size = 0;
  for (const m of mems) {
    if (cur.length && size + m.tokens > limit) {
      const tail = Math.max(1, Math.floor(cur.length / 4));
      let cut = cur.length;
      let widest: number | undefined;
      for (let i = Math.max(1, cur.length - tail); i < cur.length; i++) {
        const gap = cur[i].ts - cur[i - 1].ts;
        if (widest === undefined || gap >= widest) {
          widest = gap;
          cut = i;
        }
      }
      out.push(cur.slice(0, cut));
      cur = cur.slice(cut);
      size = cur.reduce((n, x) => n + x.tokens, 0);
    }
    cur.push(m);
    size += m.tokens;
  }
  if (cur.length) out.push(cur);
  return out;
}

const SLEEP_BREAK = /\r\n|[\r\n\u0085\u{2028}\u{2029}]/gu;
const SLEEP_CONTROL = /\r\n|[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/gu;
const SLEEP_CONTROL_IN = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/u;
const SLEEP_TAG = /<(?=\/?(?:memories|core|boxes|box|proposals|ripe|items|section|tonight|as it stood))/g;

function sleepUntag(text: string): string {
  return text.replace(SLEEP_TAG, "\u{2039}");
}

function sleepShown(text: string): string {
  return sleepUntag(text.replace(SLEEP_BREAK, "\n    "));
}

function sleepLines(mems: SleepLine[]): string {
  return mems.map((m) => `${m.eid} · ${m.at} · ${sleepUntag(m.who.replace(SLEEP_CONTROL, " "))} · ${sleepShown(m.text)}`).join("\n");
}

function sleepHeading(text: string): string {
  return pyStrip(pyLstrip(pyStrip(text), "#"));
}

function sleepHeadingBroken(e: Record<string, unknown>): boolean {
  const named = [sleepHeading(pyStr(pyOr(e.section, ""))), pyStrip(pyStr(pyOr(e.title, "")))];
  if (e.op === "title") named.push(pyStrip(pyStr(pyOr(e.text, ""))));
  if (e.op === "remake") named.push(...sleepSections(pyStrip(pyStr(pyOr(e.text, "")))).map(([h]) => h));
  return named.some((x) => SLEEP_CONTROL_IN.test(x));
}

function sleepSpeaksOf(topic: string, name: string): boolean {
  if (!topic || !name) return false;
  return topic === name || (Array.from(name).length >= 2 && topic.startsWith(name)) ||
    (Array.from(topic).length >= 3 && name.startsWith(topic));
}

const PY_WS = "[\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const PY_WS_CHAR = new RegExp(`^${PY_WS}$`);

function sleepFenced(t: string): string | undefined {
  let last = -1;
  let fence = false;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === "}" && fence) {
      last = i;
      break;
    }
    fence = t.startsWith("```", i) || (fence && PY_WS_CHAR.test(t[i]));
  }
  for (let i = t.indexOf("```"); i >= 0; i = t.indexOf("```", i + 1)) {
    let q = i + 3;
    if (t.startsWith("json", q)) q += 4;
    while (q < t.length && PY_WS_CHAR.test(t[q])) q++;
    if (t.startsWith("{", q)) return last > q ? t.slice(q, last + 1) : undefined;
  }
  return undefined;
}

/** @internal */
export function nestsDeeper(v: unknown, levels: number): boolean {
  if (v === null || typeof v !== "object") return false;
  return levels <= 0 || Object.values(v).some((x) => nestsDeeper(x, levels - 1));
}

/** @internal */
export function parseFiniteJson(text: string): unknown {
  const parsed = JSON.parse(text, (_key, v) => {
    if (typeof v === "number" && !Number.isFinite(v)) throw new SyntaxError("a number past the range of a JSON number");
    return v;
  });
  if (nestsDeeper(parsed, 127)) throw new SyntaxError("nested 128 or more levels deep");
  return parsed;
}

function sleepParseJson(text: string): unknown {
  let t = pyStrip(text);
  const fenced = sleepFenced(t);
  if (fenced !== undefined) t = fenced;
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i < 0 || j < i) throw new Error("no JSON object in the answer");
  return parseFiniteJson(t.slice(i, j + 1));
}

function sleepSections(body: string): [string, string][] {
  const out: [string, string[]][] = [];
  for (const ln of body.split("\n")) {
    if (ln.startsWith("## ")) out.push([pyStrip(ln.slice(3)), []]);
    else if (out.length) out[out.length - 1][1].push(ln);
  }
  return out.map(([h, b]) => [h, pyStrip(b.join("\n"))]);
}

function sectionMap(body: string): Map<string, string> {
  return new Map(sleepSections(body));
}

function sleepJoin(secs: [string, string][]): string {
  return pyStrip(secs.filter(([h]) => h).map(([h, t]) => pyRstrip(`## ${h}\n${t}`)).join("\n\n")) + (secs.length ? "\n" : "");
}

function sleepAsLines(text: string): string {
  return pyStrip(text).split("\n").filter((ln) => !ln.startsWith("## "))
    .map((ln) => (ln.startsWith("- ") || !pyStrip(ln) ? ln : `- ${pyStrip(pyLstrip(pyStrip(ln), "-"))}`))
    .join("\n");
}

function sleepSetSection(body: string, heading: string, text: string, raw = false): string {
  const name = sleepHeading(heading);
  const t = raw ? sleepDemote(pyStrip(text)) : sleepAsLines(text);
  const secs = sleepSections(body);
  const i = secs.findIndex(([h]) => h === name);
  if (i >= 0) {
    secs[i] = [secs[i][0], t];
    return sleepJoin(secs);
  }
  return sleepJoin([...secs, [name, t]]);
}

function sleepDropSection(body: string, heading: string): [string, string | undefined] {
  const secs = sleepSections(body);
  return [sleepJoin(secs.filter(([h]) => h !== heading)), secs.find(([h]) => h === heading)?.[1]];
}

function sleepDemote(text: string): string {
  return text.split("\n").map((ln) => (ln.startsWith("## ") ? `#${ln}` : ln)).join("\n");
}

/** @internal */
export function sleepDate(day: unknown): number | undefined {
  if (typeof day !== "string" || !SLEEP_DAY.test(day)) return undefined;
  const cs = Array.from(day);
  const mo = cs.slice(5, 7).join("");
  const d = cs.slice(8, 10).join("");
  if (!/^(?:1[0-2]|0[1-9])$/.test(mo) || !/^(?:3[01]|[12]\p{Nd}|0[1-9])$/u.test(d)) return undefined;
  const y = pyDec(cs.slice(0, 4).join(""));
  const m = pyDec(mo);
  const dd = pyDec(d);
  if (y < 1 || dd > monthDays(y, m)) return undefined;
  return civilDays(y, m, dd);
}

function sleepAge(day: unknown, today: number): string {
  if (!pyTruthy(day)) return "";
  const d = sleepDate(day);
  if (d === undefined) return "";
  const n = today - d;
  return `last edited ${pyStr(day)}, ${n === 0 ? "today" : `${n} days ago`}`;
}

/** @internal */
export interface SleepViewFile {
  title: string;
  version: number;
  tokens: number;
  day: string | null;
  body?: string;
}

/** @internal */
export function sleepHasBody(f: SleepViewFile): boolean {
  if (typeof f.body === "string") return pyStrip(f.body) !== "";
  return isWhole(f.tokens) && f.tokens > 0;
}

/** @internal */
export function sleepBoxIndex(view: SleepViewFile[], today: number): string {
  return SLEEP_BOXES.map((s) => {
    const f = view[s];
    return `${s}. ${f.title || "(empty)"}` + (sleepHasBody(f) ? ` (${sleepAge(f.day, today)})` : "");
  }).join("\n");
}

/** @internal */
export function sleepRender(view: SleepViewFile[], today: number): string {
  const core = view[0];
  const head = pyTruthy(core.day) ? `<core ${sleepAge(core.day, today)}>` : "<core>";
  const secs = sleepSections(core.body || "");
  const body = pyStrip(sleepJoin([...secs.filter(([h]) => h === SLEEP_ME), ...secs.filter(([h]) => h !== SLEEP_ME)]));
  return `${head}\n${body}\n</core>\n<boxes>\n${sleepBoxIndex(view, today)}\n</boxes>`;
}

/** @internal */
export function sleepBoxPick(view: SleepViewFile[], which: unknown): number | undefined {
  const w = pyStrip(pyStr(which));
  if (!w) return undefined;
  const lower = w.toLowerCase();
  return SLEEP_BOXES.find((s) => w === String(s) || w === view[s].title) ??
    SLEEP_BOXES.find((s) => view[s].title && view[s].title.toLowerCase() === lower) ??
    SLEEP_BOXES.find((s) => view[s].title && view[s].title.toLowerCase().includes(lower));
}

/** @internal */
export function sleepBoxText(s: number, f: SleepViewFile, today: number): string {
  const body = f.body || "";
  if (!pyStrip(body)) return `Box ${s} is empty.`;
  return `<box ${s} name="${f.title}" ${sleepAge(f.day, today)}>\n${pyStrip(body)}\n</box>`;
}

/** @internal */
export function sleepOpenBox(format: "anthropic" | "openai"): Record<string, unknown> {
  const b = JSON.parse(JSON.stringify(SLEEP_OPEN_BOX)) as typeof SLEEP_OPEN_BOX;
  if (format === "openai") return { type: "function", function: { name: b.name, description: b.description, parameters: b.input_schema } };
  return b;
}

/** @internal */
export function sleepFile(f: unknown): SleepViewFile {
  const o = isPlainObject(f) ? f : {};
  const out: SleepViewFile = {
    title: typeof o.title === "string" ? o.title : "",
    version: isWhole(o.version) ? o.version : 0,
    tokens: isWhole(o.tokens) ? o.tokens : 0,
    day: typeof o.day === "string" && o.day ? o.day : null,
  };
  if (typeof o.body === "string") out.body = o.body;
  return out;
}

/** @internal */
export function sleepView(r: unknown): SleepViewFile[] {
  const o = isPlainObject(r) ? r : {};
  const view: SleepViewFile[] = SLEEP_SLOTS.map(() => ({ title: "", version: 0, tokens: 0, day: null }));
  view[0].body = "";
  if (isPlainObject(o.core)) view[0] = { body: "", ...sleepFile(o.core) };
  for (const f of asList(o.files)) {
    if (isPlainObject(f) && isWhole(f.slot) && f.slot >= 1 && f.slot <= 4) view[f.slot] = sleepFile(f);
  }
  return view;
}

interface SleepProposal {
  id: string;
  text: string;
  sleeps: number;
  first: number;
  first_day: string;
  last_day: string;
  applied?: string;
  span_end?: string;
  [key: string]: unknown;
}

function sleepMarkKey(x: unknown): string {
  const d = isPlainObject(x) ? x : {};
  return JSON.stringify([d.memory ?? null, d.kind ?? null, d.source_memory ?? null]);
}

interface SleepNotesHeld {
  proposals: SleepProposal[];
  mixed: Record<string, unknown>[];
  [key: string]: unknown;
}

function sleepNotesOf(r: unknown): [number, SleepNotesHeld] {
  const o = isPlainObject(r) ? r : {};
  const v = Object.prototype.hasOwnProperty.call(o, "version") ? o.version : o.notes_version;
  const notes = (isPlainObject(o.notes) ? JSON.parse(JSON.stringify(o.notes)) : {}) as SleepNotesHeld;
  for (const k of ["proposals", "mixed"] as const) if (!Array.isArray(notes[k])) notes[k] = [];
  return [isWhole(v) && v >= 0 ? v : 0, notes];
}

function sleepReadable(p: unknown): p is SleepProposal {
  return isPlainObject(p) && ["id", "text", "first_day"].every((k) => Object.prototype.hasOwnProperty.call(p, k)) &&
    isWhole(p.sleeps) && p.sleeps >= 1 && typeof p.first === "number" && Number.isFinite(p.first);
}

const SLEEP_NOTES_CAP = 200_000;

function sleepNextId(entries: unknown[]): string {
  let top = 0;
  for (const p of entries) {
    const m = isPlainObject(p) && typeof p.id === "string" ? /^p([0-9]{1,9})$/.exec(p.id) : null;
    if (m) top = Math.max(top, Number(m[1]));
  }
  return `p${top + 1}`;
}

function sleepSize(v: unknown): number {
  if (typeof v === "string") return new TextEncoder().encode(v).length + 2;
  if (Array.isArray(v)) return 2 + v.reduce((n: number, x) => n + sleepSize(x) + 1, 0);
  if (isPlainObject(v)) return 2 + Object.entries(v).reduce((n, [k, x]) => n + sleepSize(k) + sleepSize(x) + 2, 0);
  return 8;
}

function sleepNotesFit(notes: SleepNotesHeld): void {
  let size = sleepSize(notes);
  for (const key of ["proposals", "mixed"] as const) {
    const keep: unknown[] = [];
    for (const x of notes[key] as unknown[]) {
      if (size > SLEEP_NOTES_CAP && (key === "mixed" || (sleepReadable(x) && pyTruthy(x.applied)))) size -= sleepSize(x) + 1;
      else keep.push(x);
    }
    (notes as Record<string, unknown>)[key] = keep;
  }
}

interface SleepWrite {
  slot: number;
  base_version: number;
  title: string;
  body: string;
  evidence: string[];
  day: string;
}

function sleepWritten(r: unknown, writes: SleepWrite[]): Record<number, number> {
  const out: Record<number, number> = {};
  const o = isPlainObject(r) ? r : {};
  for (const key of ["written", "files", "writes"]) {
    for (const x of asList(o[key])) if (isPlainObject(x) && isWhole(x.slot) && isWhole(x.version)) out[x.slot] = x.version;
  }
  if (isPlainObject(o.versions)) {
    for (const [k, v] of Object.entries(o.versions)) if (pyIsDigits(k) && isWhole(v)) out[pyDec(k)] = v;
  }
  for (const w of writes) if (!Object.prototype.hasOwnProperty.call(out, w.slot)) out[w.slot] = w.base_version + 1;
  return out;
}

function sleepDayStart(today: string): number {
  const d = sleepDate(cpSlice(today, 0, 10));
  return d === undefined ? Date.now() / 1000 : d * DAY_SECONDS;
}

function sleepToday(head: Record<string, unknown>): string {
  const clock = head.clock;
  const when = sleepWhen(isPlainObject(clock) ? clock.local_now : undefined);
  return when ? when[0] : new Date().toISOString().slice(0, 16).replace("T", " ");
}

const EID = /(?<![\p{L}\p{N}_])e\p{Nd}+(?![\p{L}\p{N}_])/gu;

function sleepEids(v: unknown): string[] {
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : typeof v === "string" ? [v] : []) {
    for (const e of pyStr(x).match(EID) ?? []) if (!out.includes(e)) out.push(e);
  }
  return out;
}

type SleepLog = Record<string, unknown>;

function sleepRenumbered(got: unknown, part: SleepLine[], log: SleepLog[], k: number): unknown {
  if (!isPlainObject(got)) return got;
  const own = new Set(part.map((m) => m.eid));
  const refs: string[] = [];
  for (const x of pyIter(pyOr(got.mixed, []))) {
    if (isPlainObject(x)) for (const f of ["line", "source"]) if (pyTruthy(x[f])) refs.push(pyStr(x[f]));
  }
  for (const it of pyIter(pyOr(got.items, []))) if (isPlainObject(it)) refs.push(...sleepEids(it.evidence));
  if (!refs.length || refs.some((r) => own.has(r))) return got;
  const n = (r: string): number => (r.slice(0, 1) === "e" && pyIsDigits(r.slice(1)) ? pyDec(r.slice(1)) : 0);
  if (!refs.every((r) => n(r) >= 1 && n(r) <= part.length)) return got;
  const fix = new Map(part.map((m, i) => [`e${i + 1}`, m.eid]));
  const put = (x: Record<string, unknown>, f: string): void => {
    if (x[f] !== null && x[f] !== undefined) x[f] = fix.get(pyStr(x[f])) ?? x[f];
  };
  for (const x of pyIter(pyOr(got.mixed, []))) {
    if (isPlainObject(x)) {
      put(x, "line");
      put(x, "source");
    }
  }
  for (const it of pyIter(pyOr(got.items, []))) {
    if (isPlainObject(it) && pyTruthy(it.evidence)) it.evidence = sleepEids(it.evidence).map((e) => fix.get(e) ?? e);
  }
  log.push({ call: `read ${k}`, renumbered: true, part: [part[0].eid, part[part.length - 1].eid] });
  return got;
}

function sleepDoubtLinesOut(text: string, drop: unknown, count: (t: string) => number): string | undefined {
  const rows = text.split("\n").filter((ln) => pyStrip(ln));
  const gone = new Set<number>();
  for (const x of Array.isArray(drop) ? drop : []) {
    const s = pyStr(x);
    if (!pyIsDigits(s)) continue;
    const n = pyDec(s);
    if (n >= 1 && n <= rows.length && !ND_ANY.test(rows[n - 1]) && count(rows[n - 1]) <= SLEEP_DOUBT_TOKENS) gone.add(n);
  }
  if (!gone.size || gone.size === rows.length) return undefined;
  return rows.filter((_, i) => !gone.has(i + 1)).join("\n");
}

interface SleepItem {
  kind: string;
  topic: string;
  text: string;
  evidence: string[];
}

function sleepCheckedItems(got: unknown, known: Set<string>, said: Set<string>): [SleepItem[], number] {
  const ok: SleepItem[] = [];
  let dropped = 0;
  for (const it of pyIter(isPlainObject(got) ? pyOr(got.items, []) : [])) {
    const ev = isPlainObject(it) ? sleepEids(it.evidence) : [];
    const good = isPlainObject(it) && typeof it.kind === "string" && SLEEP_KINDS.has(it.kind) &&
      pyStrip(pyStr(pyOr(it.text, ""))) !== "" && ev.length >= SLEEP_MIN_EVIDENCE && ev.every((x) => known.has(x)) &&
      (it.kind !== "self" || ev.some((x) => said.has(x)));
    if (good) {
      ok.push({
        kind: it.kind as string, topic: pyStr(pyOr(it.topic, "")), text: pyStrip(pyStr(it.text)),
        evidence: [...ev].sort((a, b) => pyDec(a.slice(1)) - pyDec(b.slice(1))),
      });
    } else {
      dropped++;
    }
  }
  return [ok, dropped];
}

type SleepMark = { memory: string; at: string; kind: string; source_memory: string | null; why: string; sleep?: string };

function sleepCheckedMixed(got: unknown, part: SleepLine[]): [SleepMark[], number] {
  const pos = new Map(part.map((m, i) => [m.eid, i]));
  const mixed: SleepMark[] = [];
  const keys = new Set<string>();
  let dropped = 0;
  for (const x of pyIter(isPlainObject(got) ? pyOr(got.mixed, []) : [])) {
    const line = isPlainObject(x) ? pyStr(x.line) : "";
    if (!isPlainObject(x) || !pos.has(line) || !(typeof x.kind === "string" && SLEEP_MIX_KINDS.has(x.kind))) {
      dropped++;
      continue;
    }
    let src = pyStr(pyOr(x.source, ""));
    src = pos.has(src) && src !== line ? src : "";
    const at = part[pos.get(line) as number];
    const mine = at.mine;
    const fromMe = src !== "" && part[pos.get(src) as number].mine;
    if ((x.kind === "echo" && (mine || (src !== "" && !fromMe))) || (x.kind === "planted" && (!mine || (src !== "" && !fromMe))) ||
      keys.has(JSON.stringify([line, x.kind, src]))) {
      dropped++;
      continue;
    }
    keys.add(JSON.stringify([line, x.kind, src]));
    mixed.push({
      memory: at.mid, at: at.at, kind: x.kind, source_memory: src ? part[pos.get(src) as number].mid : null,
      why: cpSlice(pyStr(pyOr(x.why, "")), 0, 300),
    });
  }
  return [mixed, dropped];
}

/** @internal */
export interface SleepHost {
  readonly store: string;
  readonly clock: number | undefined;
  readonly signal: AbortSignalLike;
  readonly modelMaxTokens: number;
  readonly maxPages: number;
  post(path: string, body: Record<string, unknown>): Promise<any>;
  settings(): Promise<any>;
  write(path: string, body: Record<string, unknown>): Promise<any>;
  caller(c: unknown, what: string): { caller: ModelCaller; model: string };
  unreachable(e: unknown): boolean;
}

type SleepAsk = (system: string, user: string) => Promise<[string, SleepCallMeta]>;
type SleepCallMeta = { secs: number; in: number; out: number; stop: string };

/** @internal */
export interface SleepRun {
  being: string;
  assistant?: string;
  prompt: string;
  s: SleepSettings;
  count: (text: string) => number;
  givenCount?: (text: string) => number;
  read: SleepAsk;
  merge: SleepAsk;
  log: SleepLog[];
  say: (msg: string) => void;
  today?: string;
  since?: string;
  sleepId?: string;
  done: boolean;
  lineTime: "created_at" | "event_date";
}

const now = (): number => (globalThis.performance ? globalThis.performance.now() : Date.now());

function sleepUsage(u: Record<string, unknown>, ...keys: string[]): number {
  let n = 0;
  for (const k of keys) {
    const v = u[k];
    n += isWhole(v) && v >= 0 ? v : 0;
  }
  return n;
}

function sleepRetryWait(e: unknown, attempt: number, host: SleepHost): number | undefined {
  if (attempt >= SLEEP_RETRIES) return undefined;
  const x = (e !== null && typeof e === "object" ? e : {}) as { status?: unknown; statusCode?: unknown; reason?: unknown; retryAfterMs?: unknown };
  const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const status = isNumber(x.status) ? x.status : x.statusCode;
  const asked = isNumber(x.retryAfterMs) ? x.retryAfterMs / 1000 : undefined;
  if (isNumber(status) && status) {
    if (!(status === 408 || status === 409 || status === 429 || status >= 500 || x.reason === "rate_limit" || x.reason === "overloaded")) {
      return undefined;
    }
  } else if (!host.unreachable(e)) {
    return undefined;
  }
  if (asked !== undefined && asked >= 0 && asked <= 60) return asked;
  return Math.min(8, 0.5 * 2 ** attempt) * (1 - 0.25 * Math.random());
}

function sleepReply(r: unknown): { text: string; stop: string; usage?: Record<string, unknown> } {
  const o = isPlainObject(r) ? r : {};
  return {
    text: typeof o.text === "string" ? o.text : "",
    stop: typeof o.stop === "string" ? o.stop : "end",
    usage: isPlainObject(o.usage) ? o.usage : undefined,
  };
}

const SLEEP_CALL_MS = 600_000;

function sleepCallSignal(outer: AbortSignalLike): { signal: AbortSignalLike; timedOut: () => boolean; done: () => void } {
  const ac = new AbortController();
  let out = false;
  const timer = setTimeout(() => {
    out = true;
    ac.abort(sleepTimeout());
  }, SLEEP_CALL_MS);
  const stop = (): void => ac.abort(outer.reason);
  if (outer.aborted) stop();
  else outer.addEventListener("abort", stop, { once: true });
  return {
    signal: ac.signal,
    timedOut: () => out && !outer.aborted,
    done: () => {
      clearTimeout(timer);
      outer.removeEventListener("abort", stop);
    },
  };
}

function sleepPause(ms: number, signal: AbortSignalLike): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

function sleepTimeout(): Error {
  const e = new Error(`the sleep's model call ran past ${SLEEP_CALL_MS / 1000} s`);
  e.name = "TimeoutError";
  return e;
}

function sleepRaced<T>(call: () => T | Promise<T>, signal: AbortSignalLike): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => reject(signal.reason);
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(call).then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

function sleepAsker(host: SleepHost, caller: ModelCaller, model: string, maxTokens: number): SleepAsk {
  return async (system, user) => {
    for (let attempt = 0; ;) {
      const t0 = now();
      let reply: ReturnType<typeof sleepReply>;
      const call = sleepCallSignal(host.signal);
      try {
        const c: ModelCall = { purpose: "sleep", model, system: [system], user, maxTokens, signal: call.signal };
        reply = sleepReply(await sleepRaced(() => caller.call(c), call.signal));
      } catch (caught) {
        const e = call.timedOut() ? sleepTimeout() : caught;
        const wait = host.signal.aborted ? undefined : sleepRetryWait(e, attempt, host);
        if (wait === undefined) throw e;
        attempt++;
        await sleepPause(wait * 1000, host.signal);
        if (host.signal.aborted) throw host.signal.reason ?? e;
        continue;
      } finally {
        call.done();
      }
      const u = reply.usage ?? {};
      return [reply.text, {
        secs: Math.round((now() - t0) / 100) / 10,
        in: sleepUsage(u, "input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens") || sleepUsage(u, "prompt_tokens"),
        out: sleepUsage(u, "output_tokens") || sleepUsage(u, "completion_tokens"),
        stop: reply.stop,
      }];
    }
  };
}

async function sleepAskJson(ask: SleepAsk, system: string, user: string, key: string,
  log: SleepLog[]): Promise<Record<string, unknown> | undefined> {
  for (const attempt of [1, 2]) {
    const [text, meta] = await ask(system, attempt === 1 ? user : user + SLEEP_NOT_JSON);
    log.push({ call: key, attempt, ...meta });
    try {
      return sleepParseJson(text) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function sleepAskJsonLogged(ask: SleepAsk, system: string, user: string, key: string,
  log: SleepLog[]): Promise<Record<string, unknown> | undefined> {
  const seen: string[] = [];
  const keep: SleepAsk = async (s, u) => {
    const [text, meta] = await ask(s, u);
    seen.push(text);
    return [text, meta];
  };
  const got = await sleepAskJson(keep, system, user, key, log);
  if (got === undefined && seen.length) {
    const t = seen[seen.length - 1];
    log.push({ call: key, failed: true, chars: cpLen(t), head: cpSlice(t, 0, 300), tail: cpSlice(t, -300) });
  }
  return got;
}

async function sleepEach<T>(flows: (() => Promise<T>)[], workers: number): Promise<T[]> {
  const out: ({ ok: true; v: T } | { ok: false; e: unknown })[] = new Array(flows.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (next < flows.length && !failed) {
      const i = next++;
      try {
        out[i] = { ok: true, v: await flows[i]() };
      } catch (e) {
        out[i] = { ok: false, e };
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, flows.length)) }, worker));
  for (const r of out) if (r !== undefined && !r.ok) throw r.e;
  return out.map((r) => (r as { v: T }).v);
}

function truncated(why: string): Error {
  return new Error(`${why}. This is a truncated answer, not the whole store.`);
}

async function sleepReadFlow(host: SleepHost, run: SleepRun): Promise<[Record<string, unknown>, Record<string, unknown>[]]> {
  let body: Record<string, unknown> = { user_id: host.store };
  if (host.clock !== undefined) body.tz_offset_minutes = host.clock;
  body.budget_tokens = SLEEP_PAGE_TOKENS;
  if (run.sleepId !== undefined) body.sleep_id = run.sleepId;
  if (run.since === undefined) body.since_last_sleep = true;
  else body.since = run.since;
  const rows: Record<string, unknown>[] = [];
  let head: Record<string, unknown> | undefined;
  const seen = new Set<string>();
  for (;;) {
    const r = await host.post("/api/v1/memory/sleep", body);
    const page: Record<string, unknown> = { ...(isPlainObject(r) ? r : {}) };
    const memories = asList(page.memories).filter(isPlainObject);
    page.memories = memories;
    head ??= page;
    for (const m of memories) rows.push(m);
    const nxt = page.next_cursor;
    if (pyTruthy(page.exhausted) || !pyTruthy(nxt)) return [head, rows];
    const key = canon(nxt);
    if (seen.has(key)) {
      if (memories.length) throw truncated("the service returned a page cursor it had already returned");
      return [head, rows];
    }
    seen.add(key);
    if (seen.size > host.maxPages) throw truncated("the sleep's reading passed its page limit");
    body = { ...body, cursor: nxt };
    if (typeof head.sleep_id === "string" && head.sleep_id) body.sleep_id = head.sleep_id;
  }
}

async function sleepReadParts(run: SleepRun, mems: SleepLine[], core: string,
  titles: string): Promise<[SleepLine[][], SleepItem[][], number, SleepMark[], number[]]> {
  const parts = sleepParts(mems, run.s.partTokens);
  const many = sleepManyPeople(mems);
  const read = async (k: number, part: SleepLine[]): Promise<[SleepItem[], number, SleepMark[], number | undefined]> => {
    const system = pyFormat(sleepForPeople(SLEEP_DIGEST, "digest", many), { being: run.being, k, n: parts.length });
    const user = `<core>\n${core || "(empty)"}\n</core>\n<boxes>\n${titles}\n</boxes>\n<memories>\n${sleepLines(part)}\n</memories>`;
    let got: unknown;
    for (const attempt of [1, 2, 3]) {
      const key = `read ${k}` + (attempt === 1 ? "" : ` again ${attempt}`);
      got = sleepRenumbered(await sleepAskJsonLogged(run.read, system, user, key, run.log), part, run.log, k);
      if (got !== undefined) break;
    }
    const [found, dropped] = sleepCheckedItems(got, new Set(part.map((m) => m.eid)),
      new Set(part.filter((m) => m.mine).map((m) => m.eid)));
    const [mixed, mixedDropped] = sleepCheckedMixed(got, part);
    if (mixedDropped) run.log.push({ call: `read ${k}`, mixed_dropped: mixedDropped });
    return [found, dropped, mixed, got === undefined ? k : undefined];
  };
  const lists: SleepItem[][] = [];
  const mixed: SleepMark[] = [];
  const unread: number[] = [];
  let dropped = 0;
  for (const [found, d, mx, failed] of await sleepEach(parts.map((p, i) => () => read(i + 1, p)), run.s.readers)) {
    lists.push(found);
    dropped += d;
    mixed.push(...mx);
    if (failed) unread.push(failed);
  }
  run.log.push({ call: "unread parts", parts: unread });
  return [parts, lists, dropped, mixed, unread];
}

async function sleepCombine(run: SleepRun, g: SleepItem[][], rounds: number, knownAll: Set<string>, saidAll: Set<string>): Promise<SleepItem[]> {
  const flat = g.flat();
  if (g.length === 1 || !flat.length) return flat;
  const got = await sleepAskJson(run.merge, pyFormat(SLEEP_COMBINE, { being: run.being }), pyJsonIndent0(flat), `combine ${rounds}`, run.log);
  const [joined] = sleepCheckedItems(got, knownAll, saidAll);
  return joined.length ? joined : flat;
}

async function sleepSettle(run: SleepRun, core: string, sec: string, given: string): Promise<[string | undefined, string]> {
  const text = sleepAsLines(given);
  const old = sectionMap(core).get(sec);
  if (old === undefined) return [text, "new"];
  const held = old.split("\n").filter((ln) => pyStrip(ln)).map(pyStrip);
  const tonight = text.split("\n").filter((ln) => pyStrip(ln)).map(pyStrip);
  if (held.filter((ln) => !tonight.includes(ln)).length <= SLEEP_OVERTURN) return [text, "kept"];
  const numbered = held.map((ln, i) => `${i + 1}. ${ln}`).join("\n");
  const g = await sleepAskJson(run.merge, pyFormat(SLEEP_SETTLE, { being: run.being, name: sec }),
    `<as it stood>\n${numbered}\n</as it stood>\n<tonight>\n${text}\n</tonight>`, `settle ${sec}`, run.log);
  if (!isPlainObject(g)) return [undefined, "unshaped"];
  const asLine = (x: unknown): string => {
    const t = pyStrip(pyStr(x));
    return t.startsWith("- ") ? t : `- ${pyStrip(pyLstrip(t, "-"))}`;
  };
  const adds = (Array.isArray(g.add) ? g.add : []).filter((x) => pyStrip(pyStr(x))).map(asLine);
  let op = g.op;
  const line = asLine(pyOr(g.text, ""));
  let n: number;
  try {
    n = pyInt(g.line);
  } catch {
    n = 0;
  }
  if (op === "replace" && line !== "- " && n >= 1 && n <= held.length) held[n - 1] = line;
  else if (op === "drop" && n >= 1 && n <= held.length) held.splice(n - 1, 1);
  else op = "none";
  return [[...held, ...adds.filter((x) => !held.includes(x))].join("\n"), `${pyStr(op)}, +${adds.length}`];
}

interface SleepFileState {
  title: string;
  body: string;
  version: number;
  day: string | null;
}

type SleepRefusal = { edit?: unknown; proposal?: unknown; why: string };
type SleepRoomMade = { file: number; before: number; after: number | null };

function sleepWhere(next: SleepFileState[], k: number): string {
  return k === 0 ? "core" : `box "${next[k].title}"`;
}

function sleepCap(s: SleepSettings, k: number): number {
  return k === 0 ? s.coreTokens : s.boxTokens;
}

type SleepCarried = [number, number, string, string][];

function sleepPutBack(next: SleepFileState[], files: SleepFileState[], k: number, carried: SleepCarried): void {
  next[k] = { ...files[k] };
  for (const [src, dst, sec, text] of carried) {
    if (dst === k && [src, k].every((j) => !sectionMap(next[j].body).has(sec))) {
      next[src].body = sleepSetSection(next[src].body, sec, text, true);
    }
  }
}

async function sleepRoom(run: SleepRun, next: SleepFileState[], files: SleepFileState[], k: number, usedNow: number,
  cap: number, rooms: SleepRoomMade[], refused: SleepRefusal[], carried: SleepCarried, why?: string): Promise<void> {
  const me = SLEEP_ME;
  const where = sleepWhere(next, k);
  const coreWay = k === 0 ? ', or move people who matter less to a box (say which, under "moved")' : "";
  const moved = k === 0 ? ', "moved": [{"section": "<heading>", "to": "1|2|3|4"}]' : "";
  const g = (await sleepAskJson(run.merge, pyFormat(SLEEP_ROOM, { being: run.being, where, used: usedNow, cap, core_way: coreWay, moved }),
    `<${where}>\n${next[k].body}\n</${where}>`, `room ${k}`, run.log)) ?? {};
  let body = pyStrip(pyStr(pyOr(g.text, "")));
  body = body.startsWith("## ") ? sleepJoin(sleepSections(body)) : "";
  const had = sectionMap(next[0].body);
  const moves: [number, string, string][] = [];
  if (k === 0 && body) body = sleepJoin(sleepSections(body).filter(([h]) => had.has(h)));
  if (k === 0 && body) {
    const mine = had.get(me);
    if (mine !== undefined && sectionMap(body).get(me) !== mine) body = sleepSetSection(body, me, mine, true);
    for (const mv of pyIter(pyOr(g.moved, []))) {
      if (isPlainObject(mv) && ["1", "2", "3", "4"].includes(pyStr(mv.to))) {
        const sec = pyStrip(pyStr(pyOr(mv.section, "")));
        const held = had.get(sec);
        if (held !== undefined && sec !== me && !sectionMap(body).has(sec) && !moves.some(([, s]) => s === sec)) {
          moves.push([pyInt(mv.to), sec, held]);
        }
      }
    }
  }
  const boxes = new Map<number, string>();
  for (const [to, sec, held] of moves) boxes.set(to, sleepSetSection(boxes.get(to) ?? next[to].body, sec, held));
  if (body && run.count(body) <= cap && [...boxes.values()].every((b) => run.count(b) <= run.s.boxTokens)) {
    rooms.push({ file: k, before: usedNow, after: run.count(body) });
    next[k].body = body;
    for (const [to, b] of boxes) next[to].body = b;
    for (const [to, sec, held] of moves) carried.push([k, to, sec, held]);
  } else {
    rooms.push({ file: k, before: usedNow, after: null });
    refused.push({
      edit: { file: k, op: "room" },
      why: why || `no room: ${thou(usedNow)} of ${thou(cap)} tokens, and the room made came back unshaped or still too big; the file stays as it was`,
    });
    sleepPutBack(next, files, k, carried);
  }
}

function sleepBoxesFit(run: SleepRun, next: SleepFileState[], files: SleepFileState[], refused: SleepRefusal[], carried: SleepCarried): void {
  for (const k of SLEEP_BOXES) {
    if (run.count(next[k].body) > run.s.boxTokens) {
      refused.push({ edit: { file: k, op: "room" }, why: "over its cap after a move; the box stays as it was" });
      sleepPutBack(next, files, k, carried);
    }
  }
}

async function sleepSeed(host: SleepHost, run: SleepRun, files: SleepFileState[], sleepId: string, day: string): Promise<boolean> {
  const core = files[0];
  if (!pyStrip(run.prompt) || sleepSections(core.body).some(([h]) => h === SLEEP_ME)) return false;
  const body = sleepJoin([[SLEEP_ME, sleepDemote(pyStrip(run.prompt))], ...sleepSections(core.body)]);
  if (run.count(body) > run.s.coreTokens) {
    const fix = run.s.coreTokens < SLEEP_CORE_MAX ? "raise coreTokens or shorten the prompt" : "shorten the prompt";
    throw new Error(`the core with the prompt in it would be ${thou(run.count(body))} tokens, over its ` +
      `${thou(run.s.coreTokens)}: ${fix}`);
  }
  const writes: SleepWrite[] = [{ slot: 0, base_version: core.version, title: "", body, evidence: [], day }];
  const r = await host.write("/api/v1/memory/self/write", { user_id: host.store, sleep_id: sleepId, writes });
  files[0] = { title: "", body, version: sleepWritten(r, writes)[0], day };
  return true;
}

const SLEEP_NO_ROOM = /slot (\p{Nd}) \([^)]*\) would hold (\p{Nd}+) tokens, over its cap of (\p{Nd}+)/u;

function sleepCode(e: WosError): string | undefined {
  const code = isPlainObject(e.details) ? e.details.code : undefined;
  return typeof code === "string" ? code : e.type;
}

function sleepDedupe(next: SleepFileState[], deduped: Record<string, unknown>[], carried: SleepCarried): void {
  const inCore = new Set(sleepSections(next[0].body).map(([h]) => h).filter((h) => h !== SLEEP_ME));
  for (const k of SLEEP_BOXES) {
    for (const [h] of sleepSections(next[k].body)) {
      if (inCore.has(h)) {
        const [body, gone] = sleepDropSection(next[k].body, h);
        next[k].body = body;
        deduped.push({ file: k, section: h });
        carried.push([k, 0, h, gone ?? ""]);
      }
    }
  }
}

async function sleepWriteFlow(host: SleepHost, run: SleepRun, sleepId: string, files: SleepFileState[], next: SleepFileState[],
  ev: string[], day: string, refused: SleepRefusal[], rooms: SleepRoomMade[], carried: SleepCarried,
  deduped: Record<string, unknown>[]): Promise<Record<number, number>> {
  const s = run.s;
  const madeRoom = new Set<number>();
  for (;;) {
    sleepDedupe(next, deduped, carried);
    const writes: SleepWrite[] = SLEEP_SLOTS
      .filter((k) => next[k].body !== files[k].body || next[k].title !== files[k].title)
      .map((k) => ({ slot: k, base_version: files[k].version, title: next[k].title, body: next[k].body, evidence: ev, day }));
    if (!writes.length) return {};
    let r: unknown;
    try {
      r = await host.write("/api/v1/memory/self/write", { user_id: host.store, sleep_id: sleepId, writes });
    } catch (e) {
      if (!(e instanceof BadRequestError) || sleepCode(e) !== "self_no_room") throw e;
      const d: Record<string, unknown> = isPlainObject(e.details) ? { ...e.details } : {};
      const said = SLEEP_NO_ROOM.exec(e.message);
      if (said) {
        ["slot", "tokens", "cap"].forEach((key, i) => {
          if (!Object.prototype.hasOwnProperty.call(d, key)) d[key] = pyDec(said[i + 1]);
        });
      }
      const fill = (w: SleepWrite): number => run.count(w.body) / sleepCap(s, w.slot);
      let k: number;
      if (isWhole(d.slot) && writes.some((w) => w.slot === d.slot)) {
        k = d.slot;
      } else {
        let fullest = writes[0];
        for (const w of writes.slice(1)) if (fill(w) > fill(fullest)) fullest = w;
        k = fullest.slot;
      }
      const cap = sleepCap(s, k);
      if (madeRoom.has(k)) {
        refused.push({ edit: { file: k, op: "room" }, why: "no room: the service counts it over its cap; the file stays as it was" });
        sleepPutBack(next, files, k, carried);
        continue;
      }
      madeRoom.add(k);
      const usedNow = run.count(next[k].body);
      const told = d.tokens;
      const limit = isWhole(d.cap) && d.slot === k ? d.cap : cap;
      const target = isWhole(told) && told > 0 && told > limit && d.slot === k
        ? floorDiv(limit * usedNow, told)
        : floorDiv(Math.min(usedNow, cap) * 9, 10);
      await sleepRoom(run, next, files, k, usedNow, Math.max(1, Math.min(cap, target)), rooms, refused, carried,
        "no room: the service counts it over its cap, and the room made came back unshaped or still too big; the file stays as it was");
      sleepBoxesFit(run, next, files, refused, carried);
      continue;
    }
    return sleepWritten(r, writes);
  }
}

async function sleepDoneFlow(host: SleepHost, run: SleepRun, sleepId: string): Promise<Record<string, unknown> | null> {
  if (!run.done) return null;
  return host.write("/api/v1/memory/sleep/done", { user_id: host.store, sleep_id: sleepId });
}

function sleepTitles(files: { title: string }[]): string {
  return SLEEP_BOXES.map((k) => `${k}: ${files[k].title || "(empty)"}`).join("\n");
}

async function sleepAssistant(host: SleepHost, run: SleepRun): Promise<string> {
  if (run.assistant !== undefined) return run.assistant;
  const r = await host.settings();
  const d = isPlainObject(r) && isPlainObject(r.default_speakers) ? r.default_speakers : {};
  const name = typeof d.assistant === "string" ? d.assistant.trim() : "";
  if (!name) {
    throw new Error("the sleep needs the assistant's speaker name to tell its lines from the person's, and the store " +
      "names none: set the store's default_speakers.assistant (setSettings) or pass assistant.");
  }
  return name;
}

/** @internal */
export async function sleepFlow(host: SleepHost, run: SleepRun): Promise<SleepResult> {
  const s = run.s;
  const being = run.being;
  const me = SLEEP_ME;
  const log = run.log;
  const count = run.count;
  const t0 = now();
  const assistant = await sleepAssistant(host, run);
  const [head, rows] = await sleepReadFlow(host, run);
  const sid = head.sleep_id;
  if (typeof sid !== "string" || !sid) throw new WosError(200, "the reading came back without a sleep_id: nothing could be written for it");
  const today = run.today || sleepToday(head);
  const nowSecs = sleepDayStart(today);
  const day = cpSlice(today, 0, 10);
  const view = sleepView(await host.post("/api/v1/memory/self", { user_id: host.store }));
  const files: SleepFileState[] = [{ title: view[0].title, body: view[0].body || "", version: view[0].version, day: view[0].day }];
  for (const k of SLEEP_BOXES) {
    files[k] = { title: "", body: "", version: 0, day: null };
    if (view[k].version) {
      const got = sleepFile(await host.post("/api/v1/memory/self/open", { user_id: host.store, slot: k }));
      files[k] = { title: got.title, body: got.body || "", version: got.version || view[k].version, day: got.day };
    }
  }
  const [notesVersion, notes] = sleepNotesOf(await host.post("/api/v1/memory/self/notes", { user_id: host.store }));
  const before = canon(notes);
  const seeded = run.prompt ? await sleepSeed(host, run, files, sid, day) : false;
  const mems = sleepMemories(rows, being, assistant, run.lineTime, run.givenCount);
  const core = files[0].body;
  const titles = sleepTitles(files);
  const proposals = notes.proposals.filter(sleepReadable);
  const readTokens = mems.reduce((n, m) => n + m.tokens, 0);
  run.say(`${mems.length} memories, ${thou(readTokens)} tokens → ${sleepParts(mems, s.partTokens).length} readers ` +
    `(${s.readers} at a time)`);
  const out: Record<string, unknown> = {
    sleep_id: sid, sleep_version: SLEEP_VERSION, today, memories: mems.length, tokens: readTokens, seeded,
  };
  if (!mems.length) {
    Object.assign(out, { items: [], applied: [], refused: [], written: {}, log, secs: 0, llm_in: 0, llm_out: 0 });
    out.done = await sleepDoneFlow(host, run, sid);
    return out as SleepResult;
  }

  const knownAll = new Set(mems.map((m) => m.eid));
  const saidAll = new Set(mems.filter((m) => m.mine).map((m) => m.eid));
  const byEid = new Map(mems.map((m) => [m.eid, m]));
  const spanEnd = mems[mems.length - 1].mid;
  const [parts, readLists, dropped, mixed, unread] = await sleepReadParts(run, mems, core, titles);
  for (const x of mixed) x.sleep = today;
  const marked = new Set(notes.mixed.map(sleepMarkKey));
  notes.mixed.push(...mixed.filter((x) => !marked.has(sleepMarkKey(x))));

  let lists = readLists;
  let rounds = 0;
  while (lists.length > s.group) {
    const round = ++rounds;
    const groups: SleepItem[][][] = [];
    for (let i = 0; i < lists.length; i += s.group) groups.push(lists.slice(i, i + s.group));
    lists = await sleepEach(groups.map((g) => () => sleepCombine(run, g, round, knownAll, saidAll)), s.readers);
  }
  const items = lists.flat();

  const countedHere = (p: SleepProposal): boolean => spanEnd !== "" && p.span_end === spanEnd;
  const ripe = proposals.filter((p) => !pyTruthy(p.applied) && p.sleeps >= SLEEP_RIPE_SLEEPS &&
    (nowSecs - p.first) / 86400 >= SLEEP_RIPE_DAYS && !countedHere(p));
  run.say(`merging ${items.length} items (${rounds} combine rounds) · ${proposals.length} proposals (${ripe.length} ripe)`);
  const next = files.map((f) => ({ ...f }));
  const applied: unknown[] = [];
  const refused: SleepRefusal[] = [];
  const used = new Set<string>();
  let mergeNotes: string[] = [];
  const folds: Record<string, unknown>[] = [];
  const settled: Record<string, unknown>[] = [];
  const deduped: Record<string, unknown>[] = [];
  const tidied: Record<string, unknown>[] = [];
  const rooms: SleepRoomMade[] = [];
  const touched = new Map<string, [number, string]>();
  const carried: SleepCarried = [];
  const touch = (k: number, h: string): void => void touched.set(`${k}\u0000${h}`, [k, h]);
  let unmerged = false;
  if (items.length || ripe.length) {
    const blocks = SLEEP_BOXES.map((k) => `<box ${k} name="${files[k].title || "(empty)"}" size="${thou(count(files[k].body))} of ` +
      `${thou(s.boxTokens)} tokens">\n${files[k].body || "(empty)"}\n</box ${k}>`).join("\n");
    const propText = proposals.filter((p) => !pyTruthy(p.applied))
      .map((p) => `${pyStr(p.id)}: ${pyStr(p.text)} (seen in ${pyStr(p.sleeps)} sleeps since ${pyStr(p.first_day)})`).join("\n") || "(none)";
    const ripeText = ripe.map((p) => `${pyStr(p.id)}: ${pyStr(p.text)}`).join("\n") || "(none)";
    const system = pyFormat(sleepForPeople(SLEEP_MERGE, "merge", sleepManyPeople(mems)), {
      being, me, today, core_used: count(core), core_cap: s.coreTokens, box_cap: s.boxTokens,
      self_rule: pyFormat(SLEEP_SELF_RULE, { me, being }),
    });
    const user = `<core>\n${core || "(empty)"}\n</core>\n${blocks}\n<proposals>\n${propText}\n</proposals>\n` +
      `<ripe>\n${ripeText}\n</ripe>\n<items>\n${pyJsonIndent0(items)}\n</items>`;
    let got = await sleepAskJsonLogged(run.merge, system, user, "merge", log);
    if (got === undefined) {
      got = await sleepAskJsonLogged(run.merge, system, user + SLEEP_SHORTER, "merge shorter", log);
    }
    unmerged = got === undefined;
    const g = got ?? {};
    mergeNotes = Array.isArray(g.notes) ? g.notes.map(pyStr) : [];
    const slotOf = new Map([["core", 0], ["0", 0], ["1", 1], ["2", 2], ["3", 3], ["4", 4]]);
    const ripeIds = new Set<unknown>(ripe.map((p) => p.id).filter((id) => typeof id === "string"));
    const tonight = items.filter((it) => it.kind === "person").map((it) => pyStrip(it.topic).toLowerCase());
    const aboutTonight = (name: string): boolean => {
      const n = pyStrip(name).toLowerCase();
      return tonight.some((t) => sleepSpeaksOf(t, n));
    };
    for (const e of Array.isArray(g.edits) ? g.edits : []) {
      let why: string | undefined;
      if (!isPlainObject(e)) continue;
      const op = e.op;
      const slot = slotOf.get(pyStr(e.file));
      const ev = sleepEids(e.evidence);
      let madeRipe: unknown;
      if (sleepHeadingBroken(e)) {
        why = "a heading or a title holds a line break or a control character";
      } else if (slot === undefined || !(op === "rewrite" || op === "remake" || op === "move_section" || op === "title")) {
        why = "unknown file or op";
      } else if ((op === "rewrite" || op === "remake") && (!ev.length || ev.some((x) => !knownAll.has(x))) &&
        !(op === "rewrite" && slot === 0 && ripeIds.has(e.ripe))) {
        why = "no evidence, or evidence not in this sleep";
      } else if (op === "rewrite") {
        const named = sleepHeading(pyStr(pyOr(e.section, "")));
        const sec = slot === 0 && named.toLowerCase() === me.toLowerCase() ? me : named;
        if (!sec || !pyStrip(pyStr(pyOr(e.text, "")))) {
          why = "rewrite needs a section and text";
        } else if (slot === 0 && sec === me && !ripeIds.has(e.ripe)) {
          why = `"${me}" changes only from a ripe proposal`;
        } else if (slot === 0 && sec !== me && !aboutTonight(sec)) {
          why = "nothing new about this person tonight";
        } else if (slot !== 0 && SLEEP_DATED.test(sec)) {
          why = "a box section is a matter, not its state on a date: rewrite the matter's section";
        } else {
          let text: string | undefined = pyStr(e.text);
          if (slot === 0 && sec !== me) {
            const [t, how] = await sleepSettle(run, core, sec, text);
            text = t;
            settled.push({ section: sec, how });
          }
          if (text === undefined) {
            why = "one night overturns one line of a person; the sorting came back unshaped";
          } else {
            next[slot].body = sleepSetSection(next[slot].body, sec, text, slot === 0 && sec === me);
            touch(slot, sec);
            if (slot === 0 && sec === me) madeRipe = e.ripe;
          }
        }
      } else if (op === "remake") {
        const body = pyStrip(pyStr(pyOr(e.text, "")));
        const title = pyStrip(pyStr(pyOr(e.title, "")));
        if (slot === 0) {
          why = "the core is rewritten by sections, not remade";
        } else if (!body || !title) {
          why = "remake needs a title and the whole file";
        } else if (SLEEP_DATED.test(title) || sleepSections(body).some(([h]) => SLEEP_DATED.test(h))) {
          why = "a box is a matter, not its state on a date: remake it under the matter's name";
        } else {
          next[slot].body = body.startsWith("## ") ? body : sleepSetSection("", "Notes", body);
          next[slot].title = cpSlice(title, 0, 80);
          for (const [h] of sleepSections(next[slot].body)) touch(slot, h);
        }
      } else if (op === "move_section") {
        const to = slotOf.get(pyStr(e.to));
        const sec = sleepHeading(pyStr(pyOr(e.section, "")));
        if (to === undefined || to === slot || ((slot === 0 || to === 0) && sec.toLowerCase() === me.toLowerCase())) {
          why = "move needs another file, and the self section stays";
        } else {
          const [body, text] = sleepDropSection(next[slot].body, sec);
          if (text === undefined) {
            why = "no such section";
          } else {
            next[slot].body = body;
            next[to].body = sleepSetSection(next[to].body, sec, text);
            carried.push([slot, to, sec, text]);
          }
        }
      } else {
        const title = pyStrip(pyStr(pyOr(e.text, "")));
        if (slot === 0 || !title) why = "the core has no title; a title needs text";
        else if (SLEEP_DATED.test(title)) why = "a box is a matter, not its state on a date: name it for the matter";
        else next[slot].title = cpSlice(title, 0, 80);
      }
      if (why) {
        refused.push({ edit: e, why });
      } else {
        applied.push(e);
        for (const x of ev) used.add(x);
        if (madeRipe !== undefined) for (const p of proposals) if (p.id === madeRipe) p.applied = today;
      }
    }
    sleepDedupe(next, deduped, carried);
    const order =[...touched.values()].sort((a, b) => a[0] - b[0] || cpCompare(a[1], b[1]));
    for (const [k, h] of order) {
      const t = sectionMap(next[k].body).get(h);
      if (!t || (k === 0 && h === me)) continue;
      const where = sleepWhere(next, k);
      const numbered = t.split("\n").filter((ln) => pyStrip(ln)).map((ln, i) => `${i + 1}: ${ln}`).join("\n");
      const tg = (await sleepAskJson(run.merge, pyFormat(SLEEP_TIDY, { being, where }),
        `<section heading="${h}">\n${numbered}\n</section>`, `tidy ${k}:${h}`, log)) ?? {};
      const text = sleepDoubtLinesOut(t, tg.drop, count);
      if (text) {
        tidied.push({ file: k, section: h, before: count(t), after: count(text), before_text: t, after_text: text });
        next[k].body = sleepSetSection(next[k].body, h, text);
      }
    }
    for (const k of SLEEP_SLOTS) {
      for (const [h, t] of sleepSections(next[k].body)) {
        if (k === 0 && h === me) continue;
        const ls = t.split("\n").filter((ln) => pyStrip(ln));
        const long = ls.filter((ln) => count(ln) > SLEEP_LINE_TOKENS).length;
        const limit = k === 0 ? SLEEP_FOLD_LINES * 2 : SLEEP_FOLD_LINES;
        if (ls.length <= limit && !long) continue;
        const why = [ls.length > limit ? `${ls.length} lines` : "", long ? `${long} lines longer than one idea` : ""]
          .filter((x) => x).join(", ");
        const where = sleepWhere(next, k);
        const fg = (await sleepAskJson(run.merge, pyFormat(SLEEP_FOLD_SECTION, { being, where, why, lines: limit }),
          `<section heading="${h}">\n${t}\n</section>`, `fold ${k}:${h}`, log)) ?? {};
        const text = sleepAsLines(pyStr(pyOr(fg.text, "")));
        const okLines = text.split("\n").filter((ln) => pyStrip(ln));
        if (okLines.length && okLines.length <= limit && count(text) < count(t)) {
          folds.push({ file: k, section: h, why, before: count(t), after: count(text) });
          next[k].body = sleepSetSection(next[k].body, h, text);
        } else {
          refused.push({ edit: { file: k, op: "fold", section: h }, why: `fold came back unshaped or longer (${why})` });
        }
      }
    }
    for (const k of SLEEP_SLOTS) {
      const cap = sleepCap(s, k);
      const usedNow = count(next[k].body);
      if (usedNow <= cap) continue;
      await sleepRoom(run, next, files, k, usedNow, cap, rooms, refused, carried);
    }
    sleepBoxesFit(run, next, files, refused, carried);
    const seenNow = new Set<unknown>();
    for (const p of Array.isArray(g.proposals) ? g.proposals : []) {
      if (!isPlainObject(p) || !pyStrip(pyStr(pyOr(p.text, "")))) continue;
      const ev = sleepEids(p.evidence);
      if (!ev.some((x) => byEid.get(x)?.mine)) {
        refused.push({ proposal: p, why: "a view of the being rests on something it said" });
        continue;
      }
      const text = pyStrip(pyStr(p.text));
      const same = proposals.find((q) => typeof q.id === "string" && q.id === p.same_as) ??
        proposals.find((q) => countedHere(q) && q.text === text);
      if (same && !seenNow.has(same.id)) {
        if (!countedHere(same)) Object.assign(same, { sleeps: same.sleeps + 1, last_day: today, text, span_end: spanEnd });
        seenNow.add(same.id);
      } else if (!same) {
        const pid = sleepNextId(notes.proposals);
        const made = { id: pid, text, sleeps: 1, first: nowSecs, first_day: today, last_day: today, span_end: spanEnd };
        proposals.push(made);
        notes.proposals.push(made);
        seenNow.add(pid);
      }
    }
  }
  const ev = [...new Set([...used].filter((e) => byEid.has(e)).map((e) => (byEid.get(e) as SleepLine).mid))].sort(cpCompare);
  const written = await sleepWriteFlow(host, run, sid, files, next, ev, day, refused, rooms, carried, deduped);
  sleepNotesFit(notes);
  if (canon(notes) !== before) {
    await host.write("/api/v1/memory/self/notes/write", { user_id: host.store, base_version: notesVersion, notes });
  }
  const ended = unread.length || unmerged ? null : await sleepDoneFlow(host, run, sid);
  const secs = Math.round((now() - t0) / 100) / 10;
  const slots = Object.keys(written).map(Number).sort((a, b) => a - b);
  run.say(`done in ${Number.isInteger(secs) ? `${secs}.0` : pyFloat(secs)}s · ${items.length} items · ${applied.length} edits, ` +
    `${refused.length} refused · ${mixed.length} who-said-what marks · written ${slots.length ? `[${slots.join(", ")}]` : "none"}`);
  Object.assign(out, {
    readers: parts.length, combine_rounds: rounds, items, items_dropped_by_check: dropped, applied, refused, written,
    proposals, ripe: ripe.map((p) => p.id), notes: mergeNotes, folds, settled, deduped, tidied, rooms, mixed, log, secs,
    llm_in: log.reduce((n, x) => n + ((x.in as number) || 0), 0), llm_out: log.reduce((n, x) => n + ((x.out as number) || 0), 0),
    done: ended,
  });
  return out as SleepResult;
}

/** @internal */
export async function sleepEstimateFlow(host: SleepHost, run: SleepRun, inputPrice?: number, outputPrice?: number): Promise<SleepEstimate> {
  const [head, rows] = await sleepReadFlow(host, run);
  const view = sleepView(await host.post("/api/v1/memory/self", { user_id: host.store }));
  const mems = sleepMemories(rows, run.being, "", "created_at", run.givenCount);
  const parts = sleepParts(mems, run.s.partTokens);
  const tokens = mems.reduce((n, m) => n + m.tokens, 0);
  const titles = sleepTitles(view);
  const frame = run.count(SLEEP_DIGEST) + run.count(view[0].body || "") + run.count(titles);
  const sent = ceilDiv((tokens + parts.length * frame) * SLEEP_IN_PER_100, 100);
  const written = ceilDiv(tokens * SLEEP_OUT_PER_100, 100);
  const prices: [number, number] = inputPrice === undefined || outputPrice === undefined
    ? [...SLEEP_ESTIMATE_PRICES] : [inputPrice, outputPrice];
  const cost = pyRound6(((sent * prices[0] + written * prices[1]) * (1 + SLEEP_MARGIN)) / 1_000_000);
  const sid = head.sleep_id;
  return {
    sleep_id: typeof sid === "string" ? sid : null, memories: mems.length, tokens, parts: parts.length,
    readers: Math.min(run.s.readers, parts.length), input_tokens: sent, output_tokens: written, cost,
    basis: {
      sleep_version: SLEEP_VERSION, model: SLEEP_ESTIMATE_MODEL, effort: "high", prompt_caching: false,
      prices, margin: SLEEP_MARGIN,
    },
    sleepy: run.s.sleepy(tokens - SLEEP_LINE_FRAME * mems.length),
  };
}

function required(v: unknown, name: string): string {
  if (typeof v !== "string" || !pyStrip(v)) throw new Error(`${name} is required.`);
  return pyStrip(v);
}

function sleepRunOf(o: { being: unknown; settings: unknown; since: unknown; sleepId: unknown; countTokens: unknown }): SleepRun {
  const being = required(o.being, "being");
  let settings = o.settings;
  if (settings === undefined || settings === null) settings = new SleepSettings();
  else if (!(settings instanceof SleepSettings)) {
    throw new Error(`settings must be SleepSettings, got ${Array.isArray(settings) ? "array" : typeof settings}.`);
  }
  const since = o.since === undefined || o.since === null ? undefined : required(o.since, "since");
  const sleepId = o.sleepId === undefined || o.sleepId === null ? undefined : required(o.sleepId, "sleepId");
  const given = o.countTokens;
  if (given !== undefined && given !== null && typeof given !== "function") {
    throw new Error("countTokens must be a function of a text that returns its tokens.");
  }
  const counted = (text: string): number => {
    const n = (given as (t: string) => unknown)(text);
    if (!isWhole(n) || n < 0) throw new Error(`countTokens must return a whole number of 0 or more, got ${shown(n)}.`);
    return n;
  };
  const counts = typeof given === "function";
  const unset: SleepAsk = () => Promise.reject(new Error("the sleep has no model"));
  return {
    being, prompt: "", s: settings as SleepSettings, count: counts ? counted : sleepTokens,
    givenCount: counts ? counted : undefined, read: unset, merge: unset, log: [], say: () => {}, today: undefined,
    since, sleepId, done: true, lineTime: "created_at",
  };
}

/** @internal */
export function sleepSetup(host: SleepHost, opts: SleepOptions): SleepRun {
  const run = sleepRunOf({
    being: opts.being === undefined ? SLEEP_BEING : opts.being, settings: opts.settings, since: opts.since,
    sleepId: opts.sleepId, countTokens: opts.countTokens,
  });
  const prompt = opts.prompt === undefined ? "" : opts.prompt;
  if (typeof prompt !== "string") throw new Error(`prompt must be a string, got ${shown(prompt)}.`);
  const today = opts.today === null ? undefined : opts.today;
  if (today !== undefined && (typeof today !== "string" || sleepDate(cpSlice(today, 0, 10)) === undefined ||
    (cpLen(today) > 10 && !/^ \p{Nd}{2}:\p{Nd}{2}$/u.test(cpSlice(today, 10))) || sleepWhen(today) === undefined)) {
    throw new Error(`today must be "YYYY-MM-DD HH:MM" or "YYYY-MM-DD", the sleep's day, got ${shown(today)}.`);
  }
  const done = opts.done === undefined ? true : opts.done;
  if (typeof done !== "boolean") throw new Error(`done must be true or false, got ${shown(done)}.`);
  const lineTime = opts.lineTime === undefined ? "created_at" : opts.lineTime;
  if (lineTime !== "created_at" && lineTime !== "event_date") {
    throw new Error(`lineTime must be "created_at" or "event_date", got ${shown(lineTime)}.`);
  }
  const tokens = opts.maxTokens === undefined ? SLEEP_MAX_TOKENS : opts.maxTokens;
  if (!isWhole(tokens) || tokens < 1 || tokens > host.modelMaxTokens) {
    throw new Error(`maxTokens must be a whole number from 1 to ${host.modelMaxTokens}, got ${String(tokens)}.`);
  }
  const progress = opts.progress === null ? undefined : opts.progress;
  if (progress !== undefined && typeof progress !== "function") throw new Error("progress must be a function of a line of text.");
  const reader = host.caller(opts.llm, "llm");
  run.read = sleepAsker(host, reader.caller, reader.model, tokens);
  if (opts.mergeLlm === undefined || opts.mergeLlm === null) {
    run.merge = run.read;
  } else {
    const writer = host.caller(opts.mergeLlm, "mergeLlm");
    run.merge = sleepAsker(host, writer.caller, writer.model, tokens);
  }
  run.prompt = prompt;
  run.today = today;
  run.done = done;
  if (opts.assistant !== undefined && opts.assistant !== null) run.assistant = required(opts.assistant, "assistant");
  run.lineTime = lineTime;
  if (progress !== undefined) run.say = progress;
  return run;
}

/** @internal */
export function sleepEstimateSetup(host: SleepHost, opts: SleepEstimateOptions): SleepRun {
  for (const [name, v] of [["inputPrice", opts.inputPrice], ["outputPrice", opts.outputPrice]] as const) {
    if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      throw new Error(`${name} must be a price in USD per million tokens, 0 or more, got ${shown(v)}.`);
    }
  }
  if ((opts.inputPrice == null) !== (opts.outputPrice == null)) {
    throw new Error("Give inputPrice and outputPrice together, or neither for Claude Sonnet 5.5's.");
  }
  return sleepRunOf({ being: SLEEP_BEING, settings: opts.settings, since: opts.since, sleepId: undefined, countTokens: opts.countTokens });
}

/** @internal */
export const SLEEP_PYTHON = {
  pyStrip, pyStr, pyInt, pyFormat, pyJsonIndent0, pyRound6, cpCompare, sleepWhen, sleepEids, sleepSections, sleepJoin,
  sleepAsLines, sleepSetSection, sleepDoubtLinesOut, sleepCheckedItems, sleepParseJson, sleepBoxPick, sleepRender, sleepParts,
  sleepNotesOf, sleepReadable, sleepNotesFit, sleepLines, sleepSpeaksOf,
};
