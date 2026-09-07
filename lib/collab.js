/**
 * Serverless P2P collaboration: Helia (IPFS in WASM) + OrbitDB in the browser.
 *
 * What is shared:
 *  - device benchmark metrics (lib/bench.js) → they drive the JS vs WASM
 *    decision with real data from all users, low-end devices included;
 *  - canonical metadata, MusicBrainz/AcoustID identifications, aggregated
 *    ranker weights, and a "hot list" of popular items (all factual, legal to
 *    distribute) — audio files are NOT redistributed, they keep streaming
 *    from archive.org.
 *
 * How peers find each other without servers:
 *  - Helia gossipsub topic "pharos-catalog/1" (formerly "publicflac-metrics/1" — renamed pre-launch: no peers existed, safe breaking change);
 *  - each peer publishes its OrbitDB address when it opens its database;
 *  - others open it in turn and replicate automatically.
 *
 * Everything runs client-side: the app deploys on static free hosting
 * (GitHub Pages, Netlify, IPFS itself) and data lives in participants' browsers.
 * The module is imported dynamically (webpackIgnore) so Helia never enters
 * the initial bundle: zero cost unless the user opts in.
 */

import { createHelia } from "helia";
import { createOrbitDB } from "@orbitdb/core";

const TOPIC = "pharos-catalog/1";

/** @type {{helia: any, orbitdb: any, db: any, started: boolean}} */
let state = { helia: null, orbitdb: null, db: null, started: false };

/**
 * Starts the P2P node (lazy: zero cost until the user shares something).
 * Contract: idempotent (subsequent calls return the same db); the browser node
 * uses wasm/WebRTC transports when available; resolves even before peers join.
 * @returns {Promise<any>} The shared OrbitDB keyvalue database.
 */
export async function startCollab() {
  if (state.started) return state.db;
  state.started = true;

  // Helia WASM: no servers, everything in-page.
  state.helia = await createHelia();
  state.orbitdb = await createOrbitDB({ helia: state.helia });

  // Open/create the shared database with open write permissions
  // (peer-signed data, tolerant validation during the collection phase).
  state.db = await state.orbitdb.open("pharos-catalog", {
    type: "keyvalue",
    sync: undefined, // sync via pubsub (default when pubsub is available)
  });

  // Peer discovery: announce and listen for db addresses on the topic.
  const pubsub = state.helia.libp2p.services.pubsub;
  const announce = () => {
    try {
      pubsub.publish(TOPIC, new TextEncoder().encode(JSON.stringify({ addr: state.db.address })));
    } catch { /* no peers yet: we will re-announce */ }
  };
  pubsub.subscribe(TOPIC);
  pubsub.addEventListener("message", async (evt) => {
    try {
      const msg = JSON.parse(new TextDecoder().decode(evt.detail.data));
      if (msg?.addr && msg.addr !== String(state.db.address)) {
        await state.orbitdb.open(msg.addr, { type: "keyvalue" }); // replicate
      }
    } catch { /* irrelevant message */ }
  });
  announce();
  setInterval(announce, 60_000).unref?.();

  return state.db;
}

/**
 * Shares this device's benchmark metrics with the network.
 * Contract: starts the node if needed; payload is anonymous device info only.
 * @param {string} label Benchmark stage label.
 * @param {Object} stats Result from lib/bench.js (median/p95/min/max/n).
 * @returns {Promise<string>} CID of the written entry.
 */
export async function shareMetrics(label, stats) {
  const db = await startCollab();
  const id = `${label}|${Date.now().toString(36)}`;
  const payload = {
    ...stats,
    label,
    cores: navigator.hardwareConcurrency ?? null,
    ua: navigator.userAgent,
    at: Date.now(),
  };
  return db.put(id, payload);
}

/**
 * Reads all shared metrics (from the local replica; sync runs in background).
 * Contract: returns only entries already replicated locally — never blocks
 * on the network.
 * @returns {Promise<Object[]>}
 */
export async function allMetrics() {
  const db = await startCollab();
  const all = await db.all();
  return Object.values(all);
}

/**
 * Stops the P2P node (battery saving, e.g. on visibilitychange hidden).
 * Contract: idempotent; safe to call before/after startCollab.
 * @returns {Promise<void>}
 */
export async function stopCollab() {
  if (state.db) await state.db.close();
  if (state.orbitdb) await state.orbitdb.stop();
  if (state.helia) await state.helia.stop();
  state = { helia: null, orbitdb: null, db: null, started: false };
}
