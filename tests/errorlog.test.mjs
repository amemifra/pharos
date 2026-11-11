/**
 * Error recording contract (lib/errorlog.js, app/api/client-errors,
 * instrumentation.js) — no network, no Next server: handlers are invoked
 * directly with WHATWG Request objects and console.error is captured.
 *   - browser reports: whitelist, bounds, redaction, path without query;
 *   - intake abuse limits: size, content type, cross-origin, rate limit;
 *   - server errors: onRequestError emits one JSON line.
 *
 * Usage: node tests/errorlog.test.mjs
 */

const { sanitizeClientReport, serverErrorRecord, formatErrorLine, createRateLimiter, redact, MAX_BODY_BYTES, MAX_STACK } = await import("../lib/errorlog.js");
const { POST } = await import("../app/api/client-errors/route.server.js");
const { onRequestError } = await import("../instrumentation.js");
const drill = await import("../app/api/error-drill/route.server.js");

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `: ${detail}` : ""}`);
}

const captured = [];
const realError = console.error;
const capture = async (fn) => { captured.length = 0; console.error = (...a) => captured.push(a.join(" ")); try { return await fn(); } finally { console.error = realError; } };

console.log("sanitizeClientReport");
const rec = sanitizeClientReport({ kind: "error", name: "TypeError", message: "boom for a@b.co", stack: "x\n".repeat(100), path: "https://h/album/?id=secret#x", line: 3, cookie: "sid=1", extra: "nope" });
check("accepts a valid report", rec?.source === "browser" && rec.kind === "error" && rec.name === "TypeError");
check("redacts e-mail in message", rec.message === "boom for [email]", rec.message);
check("path keeps pathname only", rec.path === "/album/", rec.path);
check("stack bounded to 20 lines", rec.stack.split("\n").length <= 20);
check("unknown fields dropped (no cookie/extra)", !("cookie" in rec) && !("extra" in rec));
check("rejects unknown kind", sanitizeClientReport({ kind: "evil", message: "x" }) === null);
check("rejects missing message", sanitizeClientReport({ kind: "error" }) === null);
check("rejects arrays / non-objects", sanitizeClientReport([1]) === null && sanitizeClientReport("x") === null);
const big = sanitizeClientReport({ kind: "error", message: "m ".repeat(2500), stack: "s ".repeat(5000) });
check("message truncated", big.message.length > 400 && big.message.length <= 500 + 20, String(big.message.length));
check("stack truncated", big.stack.length > 3000 && big.stack.length <= MAX_STACK + 20, String(big.stack.length));
check("redacts bearer + long tokens", redact("Bearer abc.def ghp_" + "x".repeat(36)) === "Bearer [redacted] [token]", redact("Bearer abc.def ghp_" + "x".repeat(36)));
check("strips query from stack URLs", redact("at f (https://h/_next/a.js?v=1:2:3)") === "at f (https://h/_next/a.js:2:3)");

console.log("formatErrorLine");
const line = formatErrorLine(rec);
check("single line JSON", !line.includes("\n") && JSON.parse(line).pharos === "error");

console.log("createRateLimiter");
let t = 0;
const allow = createRateLimiter({ limit: 2, globalLimit: 3, windowMs: 1000, now: () => t });
const seq = [allow("a"), allow("a"), allow("a"), allow("b"), allow("c")];
check("per-key + global cap", JSON.stringify(seq) === "[true,true,false,true,false]", JSON.stringify(seq));
t = 1000;
check("window resets", allow("a") === true);

console.log("POST /api/client-errors/");
const req = (body, headers = {}) => new Request("http://localhost:3917/api/client-errors/", {
  method: "POST",
  headers: { host: "localhost:3917", "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
let res = await capture(() => POST(req({ kind: "boundary", name: "Error", message: "render failed", path: "/search/?q=x" })));
check("valid report → 204", res.status === 204, String(res.status));
check("valid report → one stdout line", captured.length === 1 && JSON.parse(captured[0]).source === "browser", captured[0]);
check("logged line has no query", !captured[0].includes("q=x"));
res = await capture(() => POST(req("x".repeat(MAX_BODY_BYTES + 1))));
check("oversized body → 413, not logged", res.status === 413 && captured.length === 0, String(res.status));
res = await capture(() => POST(req({ kind: "error", message: "x" }, { "content-type": "application/x-www-form-urlencoded" })));
check("wrong content type → 415", res.status === 415, String(res.status));
res = await capture(() => POST(req({ kind: "error", message: "x" }, { origin: "https://evil.example" })));
check("cross-origin → 403", res.status === 403, String(res.status));
res = await capture(() => POST(req("{not json")));
check("bad JSON → 400", res.status === 400, String(res.status));
res = await capture(() => POST(req({ kind: "nope", message: "x" })));
check("invalid report → 400, not logged", res.status === 400 && captured.length === 0);
const statuses = [];
await capture(async () => { for (let i = 0; i < 25; i++) statuses.push((await POST(req({ kind: "error", message: `m${i}` }, { "x-forwarded-for": "203.0.113.9" }))).status); });
check("rate limit → 429 after 20/min per client", statuses.filter((s) => s === 204).length === 20 && statuses.at(-1) === 429, JSON.stringify(statuses.slice(18)));
check("client address never logged", !captured.some((l) => l.includes("203.0.113.9")));

console.log("instrumentation onRequestError");
await capture(() => onRequestError(Object.assign(new Error("db down"), { digest: "123" }), { path: "/api/x/?token=abc", method: "GET", headers: { cookie: "sid=s" } }, { routerKind: "App Router", routePath: "/api/x", routeType: "route" }));
const srv = captured[0] ? JSON.parse(captured[0]) : {};
check("server error → one JSON line", captured.length === 1 && srv.source === "server" && srv.message === "db down", captured[0]);
check("server line: path without query, no cookie", srv.path === "/api/x/" && !captured[0].includes("sid=s"));
check("serverErrorRecord tolerates non-Error", serverErrorRecord(undefined).message === "(no message)");

console.log("GET /api/error-drill/");
delete process.env.PHAROS_ERROR_DRILL;
check("drill inert without flag → 404", (await drill.GET()).status === 404);
process.env.PHAROS_ERROR_DRILL = "1";
check("drill throws with flag", await drill.GET().then(() => false, (e) => /Deliberate error drill/.test(e.message)));
delete process.env.PHAROS_ERROR_DRILL;

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
