/**
 * Error log contract — one structured JSON line per recorded error on stdout,
 * which is exactly what the Node host's log viewer shows (`npm run start:server`
 * terminal, `docker logs`, App Platform "Runtime logs", journalctl …).
 *
 * Shared by instrumentation.js (server errors) and the client-errors route
 * handler (browser errors). Pure + bounded: every field is length-capped, URLs
 * lose their query/hash, e-mail-like and long token-like strings are redacted,
 * and nothing from cookies, headers, IPs or request bodies is ever copied.
 *
 * Line shape: {"ts","level":"error","source":"server"|"browser","kind",
 *              "name","message","stack","path","digest","build",...}
 */

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_MESSAGE = 500;
export const MAX_STACK = 4000;
export const MAX_STACK_LINES = 20;
export const MAX_PATH = 200;

const KINDS = new Set(["error", "unhandledrejection", "boundary", "global-boundary"]);

/** Redact things that look like personal data or credentials. */
export function redact(text) {
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 [redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    // Query strings inside stack frames / messages (…/page?x=1:10:5 → …/page:10:5).
    .replace(/(https?:\/\/[^\s?#)]+)[?#][^\s:)]*/g, "$1");
}

/** Truncate to n characters, marking the cut. */
export function cap(text, n) {
  const s = String(text ?? "");
  return s.length > n ? `${s.slice(0, n)}…[truncated]` : s;
}

export function cleanStack(stack) {
  if (typeof stack !== "string" || !stack) return undefined;
  const lines = stack.split("\n").slice(0, MAX_STACK_LINES).join("\n");
  return cap(redact(lines), MAX_STACK);
}

/** Path only (no origin, query or hash), bounded. */
export function cleanPath(value) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value, "http://local.invalid");
    return cap(url.pathname, MAX_PATH);
  } catch { return undefined; }
}

const str = (v, n) => (typeof v === "string" && v ? cap(redact(v), n) : undefined);
const int = (v) => (Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : undefined);

/** Drop undefined fields so lines stay compact. */
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Validate + bound a browser report. Returns a log record or null (reject).
 * Only whitelisted fields survive; unknown keys are ignored.
 */
export function sanitizeClientReport(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const kind = KINDS.has(body.kind) ? body.kind : null;
  const message = str(body.message, MAX_MESSAGE);
  if (!kind || !message) return null;
  return compact({
    ts: new Date().toISOString(),
    level: "error",
    source: "browser",
    kind,
    name: str(body.name, 80),
    message,
    stack: cleanStack(body.stack),
    path: cleanPath(body.path),
    line: int(body.line),
    column: int(body.column),
    digest: str(body.digest, 64),
    build: str(body.build, 64),
  });
}

/** Record for a server error from Next's onRequestError hook. */
export function serverErrorRecord(err, request = {}, context = {}) {
  return compact({
    ts: new Date().toISOString(),
    level: "error",
    source: "server",
    kind: "request",
    name: str(err?.name, 80) ?? "Error",
    message: str(err?.message, MAX_MESSAGE) ?? "(no message)",
    stack: cleanStack(err?.stack),
    digest: str(err?.digest, 64),
    method: str(request.method, 10),
    path: cleanPath(request.path),
    routePath: str(context.routePath, MAX_PATH),
    routeType: str(context.routeType, 20),
    build: str(process.env.NEXT_PUBLIC_PHAROS_BUILD, 64),
  });
}

/** Single-line JSON (no raw newlines can split a record). */
export function formatErrorLine(record) {
  return JSON.stringify({ pharos: "error", ...record });
}

/**
 * Fixed-window limiter: `limit` hits per key per window, plus a global cap so
 * rotating keys cannot flood stdout. Map size is bounded.
 */
export function createRateLimiter({ limit = 20, globalLimit = 300, windowMs = 60_000, maxKeys = 1000, now = () => Date.now() } = {}) {
  let windowStart = now(), total = 0;
  const hits = new Map();
  return function allow(key) {
    const t = now();
    if (t - windowStart >= windowMs) { windowStart = t; total = 0; hits.clear(); }
    if (total >= globalLimit) return false;
    const k = String(key || "anon");
    const n = hits.get(k) ?? 0;
    if (n >= limit) return false;
    if (!hits.has(k) && hits.size >= maxKeys) return false;
    hits.set(k, n + 1);
    total++;
    return true;
  };
}
