/**
 * MusicBrainz request gate — compatibility wrapper over the generic
 * per-source gate (lib/gate.js). Same contract as before; new code should
 * import { getGate } from "./gate.js" for other sources.
 */

import { getGate } from "./gate.js";

const gate = getGate("musicbrainz", { minIntervalMs: 1100 });

/**
 * Enqueue a MusicBrainz request.
 * @param {string} url
 * @param {Object} [opts]
 * @param {"user"|"background"} [opts.priority="user"] Interactive callers pass
 *     "user": they are served before warm-up/fill traffic.
 * @returns {Promise<Response>}
 */
export function mbRequest(url, { priority = "user" } = {}) {
  return gate.request(url, { priority });
}

/**
 * Truthful MusicBrainz rate-limit state (derived from provider 429/503 +
 * Retry-After): { rateLimited, retryAt, reason }.
 * @returns {{rateLimited: boolean, retryAt: number|null, reason: string|null}}
 */
export function mbGateState() {
  return gate.state();
}

/**
 * Subscribe to MusicBrainz rate-limit state changes. Returns unsubscribe.
 * @param {(s: {rateLimited: boolean, retryAt: number|null, reason: string|null}) => void} fn
 */
export function onMbGateState(fn) {
  return gate.subscribe(fn);
}
