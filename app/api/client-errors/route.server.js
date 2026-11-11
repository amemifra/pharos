/**
 * POST /api/client-errors/ — browser error intake (server mode only).
 *
 * The `.server.js` extension keeps this file out of the default static export
 * (next.config.mjs adds it to pageExtensions only when PHAROS_SERVER=1).
 * Accepted reports become one JSON line on stdout (lib/errorlog.js); nothing
 * is stored and the response carries no data.
 *
 * Abuse limits: body ≤ 8 KiB, JSON or text/plain (sendBeacon) only, same-origin
 * when an Origin header is present, 20 reports/min per client + 300/min total.
 * The client address is used only as an in-memory limiter key — never logged.
 */
import { MAX_BODY_BYTES, createRateLimiter, formatErrorLine, sanitizeClientReport } from "../../../lib/errorlog.js"; // relative: importable by tests/errorlog.test.mjs

export const dynamic = "force-dynamic";

const allow = createRateLimiter();
const empty = (status) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin) {
    try { if (new URL(origin).host !== host) return empty(403); } catch { return empty(403); }
  }
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json" && type !== "text/plain") return empty(415);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return empty(413);

  const client = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
  if (!allow(client)) return empty(429);

  let text;
  try { text = await request.text(); } catch { return empty(400); }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return empty(413);
  let body;
  try { body = JSON.parse(text); } catch { return empty(400); }
  const record = sanitizeClientReport(body);
  if (!record) return empty(400);
  console.error(formatErrorLine(record));
  return empty(204);
}
