/**
 * GET /api/error-drill/ — deliberate server failure to prove recording works.
 *
 * Server mode only (see app/api/client-errors/route.server.js) and inert
 * (404) unless the operator starts the server with PHAROS_ERROR_DRILL=1.
 * The thrown error reaches instrumentation.js onRequestError → stdout line.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.PHAROS_ERROR_DRILL !== "1") return new Response(null, { status: 404 });
  throw new Error("Deliberate error drill: server recording check");
}
