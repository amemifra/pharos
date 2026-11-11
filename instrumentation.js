/**
 * Next.js instrumentation hook — server errors of every route/page/action
 * (server mode only; the default static export has no server at runtime).
 * Each error becomes one bounded JSON line on stdout (lib/errorlog.js), the
 * stream the hosting log viewer shows. See README "Where errors are recorded".
 */
export async function onRequestError(err, request, context) {
  const { formatErrorLine, serverErrorRecord } = await import("./lib/errorlog.js");
  console.error(formatErrorLine(serverErrorRecord(err, request, context)));
}
