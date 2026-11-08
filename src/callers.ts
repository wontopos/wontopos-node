import {
  asList, asObj, causeCode, cleanServerText, defaultTransport, discard, isServiceHost, maskUserinfo,
  parseErrorText, plainHttpOnce, retryAfterMs, shownBase, tryUrl,
} from "./http.js";
import { ANTHROPIC_CACHE_MIN_TOKENS, MODEL_RESPONSE_MAX_BYTES, ROUTER_TEXT, isPlainObject } from "./router.js";
import { parseFiniteJson } from "./sleep.js";
import { ModelCallError } from "./wontopos.js";
import type { AbortSignalLike, ModelCall, ModelReply } from "./wontopos.js";

const FORMAT_REFUSED = new Set([400, 415, 422]);

const MODEL_KEY_BROWSER_REFUSAL =
  "wontopos: refusing to put a model key in a browser page, where anyone who opens the page can read it. " +
  "Run the router on your server. For a local demo with a key you will revoke, pass dangerouslyAllowBrowser: true.";

function checkModelKey(raw: unknown, what: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${what} is required: the model provider's key.`);
  const key = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(key)) throw new Error(`${what} contains whitespace or a control character: check for a stray newline.`);
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(key)) throw new Error(`${what} contains a non-ASCII character: copy the key from a plain-text field.`);
  if (key.startsWith("wos-")) throw new Error(`${what} starts with wos-, so it is a Wontopos key: a Wontopos key never goes to a model provider. Give the provider's own key.`);
  return key;
}

function hostKey(host: string): string {
  return host.normalize("NFKC").replace(/[\u3002\uff0e\uff61]/g, ".").toLowerCase().replace(/\.+$/, "");
}

function providerBase(raw: unknown, wontoposBase?: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("the model provider's base URL must be a URL, e.g. https://api.anthropic.com.");
  const s = raw.trim().replace(/\/+$/, "");
  const u = tryUrl(s);
  // eslint-disable-next-line no-control-regex
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:") || /[\s\x00-\x1f\x7f\\]/.test(s) || !/^[^:]*:\/\/[^/]/.test(s)) {
    throw new Error(`the model provider's base URL is not an http(s) URL: ${JSON.stringify(shownBase(s))}`);
  }
  if (u.username || u.password) throw new Error("the model provider's base URL carries a user or password: give the key as the key.");
  if (isServiceHost(hostKey(u.hostname))) throw new Error("the model provider's base URL is a Wontopos host: a model key never goes to Wontopos.");
  const w = wontoposBase === undefined ? undefined : tryUrl(wontoposBase);
  if (w && w.protocol === u.protocol && w.port === u.port && hostKey(w.hostname) === hostKey(u.hostname)) {
    throw new Error("the model provider's base URL is this client's baseUrl: a model key never goes where the Wontopos key goes.");
  }
  return s;
}

function providerUrl(raw: unknown, wontoposBase: string | undefined, keyed: boolean, give = "the API origin without them, e.g. https://api.anthropic.com"): string {
  if (typeof raw === "string" && /[?#]/.test(raw)) throw new Error(`the model provider's base URL has a ? query or a # anchor: give ${give}.`);
  const base = providerBase(raw, wontoposBase);
  if (keyed && plainHttpOnce(`provider\u0000${base}`, tryUrl(base))) {
    console.warn("wontopos: the model provider's base URL uses plain HTTP on a non-local host, so the model key travels unencrypted. Use https://.");
  }
  return base;
}

function providerTransport(given: unknown): (url: string, init: Record<string, unknown>) => Promise<Response> {
  if (given !== undefined && typeof given !== "function") throw new Error("fetch must be a function (a fetch-compatible transport).");
  const t = (given ?? defaultTransport()) as ((url: string, init: Record<string, unknown>) => Promise<Response>) | undefined;
  if (typeof t !== "function") throw new Error("no fetch available in this runtime: pass one as fetch.");
  return t;
}

class ProviderUnreachable extends Error {}

const DECIMAL_TEXT = /^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

const DROPPED_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "EPIPE", "ESHUTDOWN", "ETIMEDOUT",
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);

function providerUnreachable(e: unknown): boolean {
  if (e instanceof ProviderUnreachable) return true;
  if ((e as { name?: unknown } | null)?.name === "TimeoutError") return true;
  const code = causeCode(e);
  return code !== undefined && DROPPED_CODES.has(code);
}

async function providerPost(
  transport: (url: string, init: Record<string, unknown>) => Promise<Response>, url: string, headers: Record<string, string>,
  body: unknown, signal: AbortSignalLike, reasonOf?: (status: number, said: string) => string | undefined,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await transport(url, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal, redirect: "manual",
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ProviderUnreachable(`network error: ${cleanServerText(maskUserinfo(String((e as Error)?.message ?? e)), 512)}`);
  }
  if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect" || res.redirected === true) {
    discard(res);
    throw new ModelCallError(res.status, "redirect refused: the model key never follows a redirect");
  }
  const text = await readModelText(res);
  if (!res.ok) {
    const e = parseErrorText(text, true);
    const code = typeof e.details?.code === "string" ? e.details.code : undefined;
    const message = cleanServerText(e.message || `HTTP ${res.status}`, 1024);
    const type = e.type ?? code;
    const requestId = e.requestId ?? res.headers.get("request-id") ?? res.headers.get("x-request-id") ?? undefined;
    const rawMs = res.headers.get("retry-after-ms")?.trim() ?? "";
    const ms = DECIMAL_TEXT.test(rawMs) ? Number(rawMs) : NaN;
    const wait = Number.isFinite(ms) && ms >= 0 ? ms : retryAfterMs(res.headers.get("retry-after"));
    const reason = reasonOf?.(res.status, `${type ?? ""} ${code ?? ""} ${message}`);
    throw new ModelCallError(res.status, message, {
      type: type === undefined ? undefined : cleanServerText(type, 128),
      retryAfterMs: wait ?? (reason === "rate_limit" ? 1_000 : undefined),
      requestId: requestId === undefined ? undefined : cleanServerText(requestId, 256),
      reason,
    });
  }
  let data: unknown;
  try {
    data = parseFiniteJson(text);
  } catch {
    throw new ModelCallError(res.status, "the provider's answer is not JSON");
  }
  if (!isPlainObject(data)) throw new ModelCallError(res.status, "the provider's answer is not a JSON object");
  return data;
}

const CONTEXT_WORDS = /context[_ ]length|maximum context|too many tokens|prompt is too long/i;

function openaiReason(status: number, said: string): string | undefined {
  if (status === 401 || status === 403) return "auth";
  if (status === 402 || /insufficient[_ ]quota|insufficient[_ ]balance|arrearage|exceeded your current quota|credit|billing/i.test(said)) return "credit";
  if (status === 404) return "bad_model";
  if (status === 413 || CONTEXT_WORDS.test(said)) return "too_large";
  if (status === 429) return "rate_limit";
  if (status === 408 || status >= 500) return "overloaded";
  if (status === 400 || status === 422 || status === 415) return "bad_request";
  return undefined;
}

function anthropicBody(c: ModelCall, count: boolean, ttl: "5m" | "1h"): Record<string, unknown> {
  const parts = c.system.filter((t) => t.length > 0);
  const marked = !count && c.systemTokens !== undefined && c.systemTokens >= ANTHROPIC_CACHE_MIN_TOKENS;
  const b: Record<string, unknown> = {
    model: c.model,
    system: parts.map((text, i) => ({
      type: "text",
      text,
      ...(marked && i === parts.length - 1 ? { cache_control: ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" } } : {}),
    })),
    messages: [{ role: "user", content: c.user }],
  };
  if (!count) b.max_tokens = c.maxTokens;
  const oc: Record<string, unknown> = {};
  if (c.effort !== undefined && !count) oc.effort = c.effort;
  if (c.schema) oc.format = { type: "json_schema", schema: c.schema };
  if (Object.keys(oc).length) b.output_config = oc;
  return b;
}

function anthropicReply(r: Record<string, unknown>): ModelReply {
  let text = "";
  for (const b of asList<Record<string, unknown>>(r.content)) {
    if (isPlainObject(b) && b.type === "text" && typeof b.text === "string") text += b.text;
  }
  const s = r.stop_reason;
  const stop =
    s === "end_turn" || s === "stop_sequence" || s == null ? "end"
    : s === "max_tokens" || s === "model_context_window_exceeded" ? "max_tokens"
    : String(s);
  return { text, stop, usage: isPlainObject(r.usage) ? r.usage : undefined };
}

function openaiBody(
  c: ModelCall, format: "json_schema" | "json_object" | "none", maxField: "max_tokens" | "max_completion_tokens", effort: boolean,
): Record<string, unknown> {
  let system = c.system.filter((t) => t.length > 0).join("\n\n");
  if (c.schema && format !== "json_schema") system += `${system ? "\n\n" : ""}${ROUTER_TEXT.jsonReply}\n${JSON.stringify(c.schema)}`;
  const b: Record<string, unknown> = {
    model: c.model,
    messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: c.user }],
    [maxField]: c.maxTokens,
  };
  if (c.schema && format === "json_schema") {
    b.response_format = { type: "json_schema", json_schema: { name: "decision", strict: true, schema: c.schema } };
  } else if (c.schema && format === "json_object") {
    b.response_format = { type: "json_object" };
  }
  if (effort && c.effort !== undefined) b.reasoning_effort = c.effort === "xhigh" || c.effort === "max" ? "high" : c.effort;
  return b;
}

function openaiReply(r: Record<string, unknown>): ModelReply {
  const choice = asObj<Record<string, unknown>>(asList<unknown>(r.choices)[0]);
  const msg = asObj<Record<string, unknown>>(choice.message);
  const c = msg.content;
  let text = typeof c === "string"
    ? c
    : asList<Record<string, unknown>>(c).map((p) => (isPlainObject(p) && typeof p.text === "string" ? p.text : "")).join("");
  text = text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
  const fr = choice.finish_reason;
  const stop =
    typeof msg.refusal === "string" && msg.refusal.trim() ? "refusal"
    : fr === "length" ? "max_tokens"
    : fr === "content_filter" ? "refusal"
    : "end";
  return { text, stop, usage: isPlainObject(r.usage) ? r.usage : undefined };
}

async function readModelText(res: Response): Promise<string> {
  const cl = Number(res.headers.get("content-length"));
  if (cl > MODEL_RESPONSE_MAX_BYTES) {
    discard(res);
    throw new ModelCallError(res.status, `the provider's answer is too large (${cl} bytes)`);
  }
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MODEL_RESPONSE_MAX_BYTES) throw new ModelCallError(res.status, "the provider's answer is too large");
    return new TextDecoder().decode(buf);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MODEL_RESPONSE_MAX_BYTES) {
      reader.cancel().catch(() => {});
      throw new ModelCallError(res.status, "the provider's answer is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
}

const KNOWN_ANTHROPIC_CALLER_KEYS = new Set(["apiKey", "model", "baseUrl", "cacheTtl", "fetch", "dangerouslyAllowBrowser"]);
const KNOWN_OPENAI_CALLER_KEYS = new Set([
  "baseUrl", "model", "apiKey", "responseFormat", "maxTokensField", "reasoningEffort", "fetch", "dangerouslyAllowBrowser",
]);

export {
  CONTEXT_WORDS, FORMAT_REFUSED, KNOWN_ANTHROPIC_CALLER_KEYS, KNOWN_OPENAI_CALLER_KEYS, MODEL_KEY_BROWSER_REFUSAL, anthropicBody, anthropicReply, checkModelKey, hostKey, openaiBody,
  openaiReason, openaiReply, providerBase, providerPost, providerTransport, providerUnreachable, providerUrl,
};
