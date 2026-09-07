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
 *
 * BUILD NOTE (defect P0#2 — HANDOFF-REVIEW): catalogstore loads this module
 * at RUNTIME from the public root via `import(assetPath("/collab.js"))` — a
 * bare `import("./collab.js")` survives the Next bundle unresolved and 404s
 * in the browser. Precompile this file to public/collab.js with:
 *   npm run collab:build
 * (esbuild bundle, ESM, minified; the artifact is committed). Edit HERE, then
 * regenerate the artifact — public/collab.js is build output, never hand-edited.
 */

import { createHelia } from "helia";
import { createOrbitDB } from "@orbitdb/core";

const TOPIC = "pharos-catalog/1";

/**
 * Proxy-style address registry (the OrbitDB analogue of a smart-contract
 * proxy): a STABLE local pointer to the latest known database addresses.
 * Why it exists: opening by name alone can yield a different address when
 * the Helia identity changes between sessions, and peer addresses travel
 * only on gossipsub — without a persisted pointer, a reload would start
 * from a fresh, empty state until peers re-announce. The registry survives
 * reloads (localStorage, legacy `pf.*` prefix) and is re-pointed every time
 * an announcement brings a new address; the own address stays in slot 0.
 * @type {string[]} — bounded to MAX_REGISTRY addrs.
 */
const REGISTRY_KEY = "pf.p2p.registry";
const MAX_REGISTRY = 32;

function loadRegistry() {
  try {
    const arr = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? "[]");
    return Array.isArray(arr) ? arr.filter((a) => typeof a === "string") : [];
  } catch { return []; }
}

function saveRegistry(addrs) {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([...new Set(addrs)].slice(0, MAX_REGISTRY)));
  } catch { /* quota: non-fatal, registry is an optimization */ }
}

/** Adds an address to the registry (own address pinned first) and persists. */
function rememberAddress(addr, own = false) {
  if (!addr) return;
  const s = String(addr);
  const rest = loadRegistry().filter((a) => a !== s);
  saveRegistry(own ? [s, ...rest] : [...rest, s]);
}

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
        // Proxy update: re-point the registry at the newly announced address
        // BEFORE opening, so even an interrupted open survives a reload.
        rememberAddress(msg.addr);
        await state.orbitdb.open(msg.addr, { type: "keyvalue" }); // replicate
      }
    } catch { /* irrelevant message */ }
  });

  // Proxy resolution on boot: reopen every address recorded before the last
  // session ended — shared state is available again WITHOUT waiting for a
  // peer to re-announce. Own address is pinned first in the registry.
  rememberAddress(state.db.address, true);
  (async () => {
    for (const addr of loadRegistry()) {
      if (String(addr) === String(state.db.address)) continue;
      try { await state.orbitdb.open(addr, { type: "keyvalue" }); } catch { /* stale addr */ }
    }
  })();

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
