/**
 * Generic per-source request gate — FIFO serialization with priorities and
 * exponential backoff, one independent queue per upstream API.
 *
 * Extracted from lib/mbgate.js when the fill engine (lib/fillengine.js) and
 * the podcast adapters joined: every rate-limited upstream gets the same
 * discipline instead of each module hand-rolling its own throttle.
 *
 * Rules (inherited verbatim from the MusicBrainz gate):
 *  - strictly serialized FIFO per source, min interval between calls;
 *  - two priorities: "user" (page interactions) jumps ahead of "background"
 *    (warm-up / fill engine) — background yields to real users, always;
 *  - identical concurrent/queued lookups coalesce into ONE network request
 *    per URL (waiters share the same Response, cloned per caller — a Response
 *    body can only be consumed once);
 *  - 429/503 → exponential backoff retry (max 3), the wait is shared by the
 *    whole queue so the source backs off globally, not per-caller;
 *  - a server-sent Retry-After header is honored over the heuristic backoff;
 *  - the gate publishes its truthful rate-limit state (limited/retryAt) —
 *    consumers may render it, never fabricate an "ok".
 *
 * Contract: request(url, {priority}) → Response; never throws for HTTP status
 * (caller inspects res.ok), throws only after exhausting retries on 5xx.
 */

const MAX_RETRIES = 3;

/** @type {Map<string, ReturnType<createGate>>} One gate per source name. */
const gates = new Map();

/**
 * Creates (or returns) the gate for a named source.
 * @param {string} name Stable source id ("musicbrainz", "archive", "podcastindex"…).
 * @param {{minIntervalMs?: number}} [opts]
 */
export function getGate(name, { minIntervalMs = 1100 } = {}) {
  let gate = gates.get(name);
  if (!gate) {
    gate = createGate(name, minIntervalMs);
    gates.set(name, gate);
  }
  return gate;
}

function createGate(name, MIN_INTERVAL_MS) {
  // Background traffic runs at a WIDER spacing than user traffic (5s vs the
  // source's min interval): a warm-up filling hours of candidates must not
  // consume the client's whole per-IP quota — user pages keep their slot and
  // background work fills the gaps slowly.
  const BG_MIN_INTERVAL_MS = Math.max(MIN_INTERVAL_MS * 4, 5000);
  const HEADERS =
    typeof window === "undefined" ? { "User-Agent": `Pharos/0.1 (${name} gate)` } : undefined;

  const queue = []; // {url, priority, waiters: [{resolve, reject}]}
  const pending = new Map(); // url -> in-flight/queued job (coalescing key)
  let lastCall = 0;
  let draining = false;
  let backoffMs = 0;

  // Truthful rate-limit state, published to listeners. rateLimitedUntil is
  // derived from the PROVIDER response (429 + Retry-After), never guessed.
  let rateLimitedUntil = 0;
  let rateLimitReason = null;
  const listeners = new Set();

  function notify() {
    const snapshot = state();
    for (const fn of listeners) {
      try { fn(snapshot); } catch { /* listener errors never break the gate */ }
    }
  }

  function markRateLimited(untilMs, reason) {
    rateLimitedUntil = untilMs;
    rateLimitReason = reason;
    notify();
  }

  function clearRateLimited() {
    if (rateLimitedUntil === 0 && rateLimitReason === null) return;
    rateLimitedUntil = 0;
    rateLimitReason = null;
    notify();
  }

  function state() {
    const now = Date.now();
    if (rateLimitedUntil > now) {
      return { rateLimited: true, retryAt: rateLimitedUntil, reason: rateLimitReason };
    }
    // A past-until state is stale: clear lazily so a fresh read is honest.
    if (rateLimitedUntil !== 0) clearRateLimited();
    return { rateLimited: false, retryAt: null, reason: null };
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(state()); // initial snapshot
    return () => listeners.delete(fn);
  }

  /** Parses a Retry-After header (delta-seconds or HTTP-date) → ms, or null. */
  function parseRetryAfter(res) {
    const raw = res.headers.get("retry-after");
    if (!raw) return null;
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
    const date = Date.parse(raw);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
  }

  function drain() {
    if (draining) return;
    draining = true;
    (async () => {
      while (queue.length) {
        // Highest priority first (user requests jump the line).
        queue.sort((a, b) => (a.priority === "user" ? -1 : 1) - (b.priority === "user" ? -1 : 1));
        const job = queue.shift();

        const interval = job.priority === "background" ? BG_MIN_INTERVAL_MS : MIN_INTERVAL_MS;
        const wait = Math.max(lastCall + interval, lastCall + backoffMs) - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));

        let res = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            res = await fetch(job.url, { headers: HEADERS });
          } catch (e) {
            // Network-level failure: transient, same treatment as 503.
            if (attempt < MAX_RETRIES) {
              backoffMs = Math.min((backoffMs || 2000) * 2, 60_000);
              await new Promise((r) => setTimeout(r, backoffMs));
              continue;
            }
            for (const w of job.waiters) w.reject(e);
            break;
          }
          if (res.status === 429 || res.status === 503) {
            // Truthful state: the PROVIDER said we are limited. Honor its
            // Retry-After when present, else fall back to the heuristic.
            const retryAfter = parseRetryAfter(res);
            backoffMs = Math.min(retryAfter ?? (backoffMs || 2000) * 2, 60_000);
            markRateLimited(Date.now() + backoffMs, `${res.status}${retryAfter != null ? " retry-after" : ""}`);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue; // retry same job
          }
          backoffMs = Math.max(0, backoffMs / 2); // success: relax globally
          clearRateLimited();
          break;
        }
        lastCall = Date.now();
        pending.delete(job.url); // job settled: later identical calls open a new request
        if (res) {
          // Coalesced callers share one network response; each waiter gets its
          // own clone because a Response body can be read exactly once.
          for (const w of job.waiters) w.resolve(res.clone());
        } else {
          // Retries exhausted on 429/503 without a response object — resolve
          // NEVER would hang /artist (and every other gated page) forever.
          const err = new Error(`gate ${name}: ${MAX_RETRIES + 1} attempts failed (rate limited)`);
          for (const w of job.waiters) w.reject(err);
        }
      }
      draining = false;
    })();
  }

  /**
   * Enqueue a request for this source. Identical URLs coalesce: callers
   * sharing an in-flight/queued lookup attach to the SAME job (one network
   * request); a "user" caller promotes a background job's priority.
   * @param {string} url
   * @param {{priority?: "user"|"background"}} [opts]
   * @returns {Promise<Response>}
   */
  function request(url, { priority = "user" } = {}) {
    return new Promise((resolve, reject) => {
      let job = pending.get(url);
      if (!job) {
        job = { url, priority, waiters: [] };
        pending.set(url, job);
        queue.push(job);
        drain();
      } else if (priority === "user" && job.priority !== "user") {
        job.priority = "user";
      }
      job.waiters.push({ resolve, reject });
    });
  }

  return { request, state, subscribe };
}
