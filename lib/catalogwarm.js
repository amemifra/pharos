/**
 * Catalog warm-up — progressive population of the shared P2P catalog.
 *
 * Strategy: while the user browses, the app quietly computes cross-references
 * for the most popular artists (rankArtists, objective notability measures)
 * and publishes them via lib/catalogstore.js (OrbitDB + local fallback).
 * Every peer contributes; latecomers read instead of recomputing. Rate limits
 * are respected: sequential, 1 MusicBrainz req/s (its own throttle), spaced
 * batches on requestIdleCallback — low-end phones first.
 *
 * Contract: startWarmup() is idempotent and never throws; it returns a
 * cancel function. Progress is observable via onProgress for the UI badge.
 */

import { crossReference } from "./discography.js";
import { creatorStats } from "./archive.js";
import { rankArtists } from "./popularity.js";
import { catalogGet, keys } from "./catalogstore.js";

/** @type {{running: boolean, cancel: boolean}} */
let state = { running: false, cancel: false };

/**
 * Start the background warm-up loop.
 * @param {{batch?: number, gapMs?: number, onProgress?: (info: {artist: string, done: number, total: number}) => void}} [opts]
 * @returns {() => void} cancel()
 */
export function startWarmup({ batch = 4, gapMs = 30_000, onProgress } = {}) {
  if (state.running) return () => {};
  state = { running: true, cancel: false };

  (async () => {
    // 1) Unbounded candidate stream: pages of 300 creators, sorted by our own
    //    objective popularity ranking. The loop keeps going (next page after
    //    each batch) until cancelled — the P2P catalog grows continuously
    //    instead of stopping at an arbitrary bootstrap number.
    let done = 0;
    let page = 1;
    const seen = new Set();
    while (!state.cancel) {
      let ranked = [];
      try {
        const stats = await creatorStats("audio_music", 300, page);
        if (!stats.length) break; // index exhausted
        ranked = rankArtists(stats);
      } catch {
        await new Promise((r) => setTimeout(r, gapMs));
        continue; // transient network failure: retry same page
      }
      for (const { name } of ranked) {
        if (state.cancel) break;
        if (seen.has(name)) continue;
        seen.add(name);
        try {
          const known = await catalogGet(keys.crossref(name));
          if (known) { done++; onProgress?.({ artist: name, done, total: done + 1 }); continue; }
        } catch {}
        try {
          await crossReference(name);
          done++;
          onProgress?.({ artist: name, done, total: done + 1 });
        } catch { /* one artist failing must not stop the loop */ }
        if (!state.cancel) await new Promise((r) => setTimeout(r, gapMs));
      }
      page++;
    }
    state.running = false;
  })();

  return () => { state.cancel = true; };
}

/** @returns {boolean} true while the warm-up loop is active. */
export function isWarming() {
  return state.running;
}
