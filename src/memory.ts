import { asList, asObj } from "./http.js";
import { isPlainObject } from "./router.js";
import type { HistoryTurn, Memory, RecallResult } from "./types.js";

const MAX_PAGES = 20_000;

const asRecords = <T>(x: unknown): T[] =>
  asList<unknown>(x).filter((m): m is T => m != null && typeof m === "object" && !Array.isArray(m));
const memoryFromGet = (r: unknown): Memory => {
  const o = asObj<Record<string, unknown>>(r);
  if (o.memory != null && typeof o.memory === "object" && !Array.isArray(o.memory)) return o.memory as Memory;
  return typeof o.id === "string" ? (o as unknown as Memory) : ({} as Memory);
};

function withCount(p: Record<string, unknown>, key: string, rows: unknown[]): Record<string, unknown> {
  return { ...p, [key]: rows, count: typeof p.count === "number" ? p.count : rows.length };
}

function recallShape(r: unknown): RecallResult {
  const o = asObj<Record<string, unknown>>(r);
  const st = asObj<Record<string, unknown>>(o.short_term);
  const lt = asObj<Record<string, unknown>>(o.long_term);
  const cx = asObj<Record<string, unknown>>(o.context);
  const out: Record<string, unknown> = {
    ...o,
    short_term: withCount(st, "turns", asRecords<HistoryTurn>(st.turns)),
    long_term: withCount(lt, "memories", asRecords<Memory>(lt.memories)),
    context: withCount(cx, "around_top_memory", asList<unknown>(cx.around_top_memory).filter((x) => typeof x === "string")),
  };
  for (const k of ["rooms", "images"]) {
    const x = o[k];
    if (isPlainObject(x)) out[k] = withCount(x, "memories", asRecords<Memory>(x.memories));
  }
  return out as RecallResult;
}

function mergeResults(r: { memories?: unknown; self_memories?: unknown; images?: unknown }, filtered = false): Memory[] {
  const out = asRecords<Memory>(r?.memories);
  const seen = new Set(out.map((m) => m.id).filter((id): id is string => typeof id === "string"));
  const own = filtered ? [] : asRecords<Memory>(r?.self_memories);
  for (const m of [...own, ...asRecords<Memory>(r?.images)]) {
    if (typeof m.id === "string") {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
    }
    out.push(m);
  }
  return out;
}

function withForm(body: Record<string, unknown>, form?: string, tz?: number): Record<string, unknown> {
  if (form != null) body.form = form;
  if (tz !== undefined) body.tz = tz;
  return body;
}

function withRecords(r: any, key: string): any {
  return { ...r, [key]: asRecords(r?.[key]) };
}

function memoryRecords(r: any): any {
  return r.memories === undefined ? r : withRecords(r, "memories");
}

function truncatedWalk(why: string): Error {
  return new Error(`${why} This is a truncated answer, not the whole store.`);
}

export {
  MAX_PAGES, asRecords, memoryFromGet, memoryRecords, mergeResults, recallShape, truncatedWalk, withCount, withForm,
  withRecords,
};
