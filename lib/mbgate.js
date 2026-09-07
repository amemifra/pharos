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
