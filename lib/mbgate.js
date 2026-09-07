/**
 * Central MusicBrainz request gate — one queue for the whole app.
 *
 * Problem it solves (observed live): the background catalog warm-up and the
 * user's interactive requests both hit MusicBrainz; under the combined load
 * MB returns 503 and the artist page shows a false "0/0 available".
 *
 * Rules:
 *  - 1 request/second (community rate limit), strictly serialized FIFO;
 *  - two priorities: "user" (page interactions) jumps ahead of "background"
 *    (catalog warm-up) — the warm-up yields to real users, always;
 *  - 503/429 → exponential backoff retry (max 3), the wait is shared by the
 *    whole queue so background traffic backs off globally, not per-caller.
 *
 * Contract: request(url, {priority}) → Response; never throws for HTTP status
 * (caller inspects res.ok), throws only after exhausting retries on 5xx.
 */

const MIN_INTERVAL_MS = 1100;
const MAX_RETRIES = 3;

const queue = []; // {url, priority, resolve, reject}
let lastCall = 0;
let draining = false;
let backoffMs = 0; // global: grows on 503/429, shrinks on success

const HEADERS = typeof window === "undefined" ? { "User-Agent": "Pharos/0.1 (catalog gate)" } : undefined;

function drain() {
  if (draining) return;
  draining = true;
  (async () => {
    while (queue.length) {
      // Pick the highest-priority entry (user requests jump the line).
      queue.sort((a, b) => (a.priority === "user" ? -1 : 1) - (b.priority === "user" ? -1 : 1));
      const job = queue.shift();

      // Respect both the per-request interval and any global backoff.
      const wait = Math.max(lastCall + MIN_INTERVAL_MS, lastCall + backoffMs) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      let res = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          res = await fetch(job.url, { headers: HEADERS });
        } catch (e) {
          // Network-level failure (socket reset, DNS blip): transient, same
          // treatment as 503 — backoff and retry instead of failing the job.
          if (attempt < MAX_RETRIES) {
            backoffMs = Math.min((backoffMs || 2000) * 2, 60_000);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          job.reject(e);
          break;
        }
        if (res.status === 503 || res.status === 429) {
          // Global backoff: every queued caller benefits from the pause.
          backoffMs = Math.min((backoffMs || 2000) * 2, 60_000);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue; // retry same job
        }
        backoffMs = Math.max(0, backoffMs / 2); // success: relax globally
        break;
      }
      lastCall = Date.now();
      if (res) job.resolve(res);
    }
    draining = false;
  })();
}

/**
 * Enqueue a MusicBrainz request.
 * @param {string} url
 * @param {Object} [opts]
 * @param {"user"|"background"} [opts.priority="user"] Interactive callers pass
 *     "user": they are served before warm-up traffic.
 * @returns {Promise<Response>}
 */
export function mbRequest(url, { priority = "user" } = {}) {
  return new Promise((resolve, reject) => {
    queue.push({ url, priority, resolve, reject });
    drain();
  });
}
