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
 *  - 429/503 → exponential backoff retry (max 3), the wait is shared by the
 *    whole queue so the source backs off globally, not per-caller.
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
  const HEADERS =
    typeof window === "undefined" ? { "User-Agent": `Pharos/0.1 (${name} gate)` } : undefined;

  const queue = []; // {url, priority, resolve, reject}
  let lastCall = 0;
  let draining = false;
  let backoffMs = 0;

  function drain() {
    if (draining) return;
    draining = true;
    (async () => {
      while (queue.length) {
        // Highest priority first (user requests jump the line).
        queue.sort((a, b) => (a.priority === "user" ? -1 : 1) - (b.priority === "user" ? -1 : 1));
        const job = queue.shift();

        const wait = Math.max(lastCall + MIN_INTERVAL_MS, lastCall + backoffMs) - Date.now();
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
            job.reject(e);
            break;
          }
          if (res.status === 503 || res.status === 429) {
            backoffMs = Math.min((backoffMs || 2000) * 2, 60_000);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue; // retry same job
          }
          backoffMs = Math.max(0, backoffMs / 2); // success: relax globally
          break;
        }
        lastCall = Date.now();
        if (res) {
          job.resolve(res);
        } else {
          // Retries exhausted on 429/503 without a response object — resolve
          // NEVER would hang /artist (and every other gated page) forever.
          job.reject(new Error(`gate ${name}: ${MAX_RETRIES + 1} attempts failed (rate limited)`));
        }
      }
      draining = false;
    })();
  }

  /**
   * Enqueue a request for this source.
   * @param {string} url
   * @param {{priority?: "user"|"background"}} [opts]
   * @returns {Promise<Response>}
   */
  function request(url, { priority = "user" } = {}) {
    return new Promise((resolve, reject) => {
      queue.push({ url, priority, resolve, reject });
      drain();
    });
  }

  return { request };
}
