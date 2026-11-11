/**
 * Browser error reporter — unhandled errors/rejections and React error
 * boundaries POST a bounded report to the same-origin intake
 * (app/api/client-errors/route.server.js), which logs it as a JSON line.
 *
 * Inert unless NEXT_PUBLIC_PHAROS_ERROR_ENDPOINT is set (next.config.mjs sets
 * it only for PHAROS_SERVER=1 builds: the static Pages export has no intake).
 * Sends only: kind, error name, message, stack (truncated), pathname (no
 * query/hash), line/column, digest, build. No cookies (credentials: "omit"),
 * no referrer, no user/session identifiers. At most 10 distinct reports per
 * page load; the server re-bounds and redacts every field.
 */
const MAX_REPORTS = 10;
const cap = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);

let endpoint = null;
let build;
let sent = 0;
const seen = new Set();

/** Report one error. `kind`: error | unhandledrejection | boundary | global-boundary. */
export function reportError(error, kind = "error", extra = {}) {
  if (!endpoint || typeof window === "undefined" || sent >= MAX_REPORTS) return;
  try {
    const name = cap(error?.name, 80) || (kind === "unhandledrejection" ? "UnhandledRejection" : "Error");
    const message = cap(typeof error === "string" ? error : error?.message, 500) || "(no message)";
    const key = `${kind}:${name}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    const body = JSON.stringify({
      kind, name, message,
      stack: cap(error?.stack, 4000),
      path: location.pathname,
      digest: cap(error?.digest, 64),
      build,
      ...extra,
    });
    if (body.length > 8000) return;
    void fetch(endpoint, {
      method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", keepalive: true,
      headers: { "Content-Type": "application/json" }, body,
    }).catch(() => { /* best effort: reporting must never throw */ });
  } catch { /* never let the reporter itself fail the page */ }
}

/** Install window listeners; returns cleanup. */
export function startErrorReporter(options = {}) {
  if (typeof window === "undefined" || !options.endpoint) return () => {};
  endpoint = options.endpoint;
  build = cap(options.build, 64);
  const onError = (event) => reportError(event.error ?? event.message, "error", {
    ...(Number.isInteger(event.lineno) ? { line: event.lineno } : {}),
    ...(Number.isInteger(event.colno) ? { column: event.colno } : {}),
  });
  const onRejection = (event) => {
    const reason = event.reason;
    reportError(reason instanceof Error ? reason : { name: "UnhandledRejection", message: typeof reason === "string" ? reason : "Unhandled promise rejection" }, "unhandledrejection");
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    endpoint = null;
  };
}
