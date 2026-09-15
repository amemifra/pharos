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
import { gossipsub } from "@libp2p/gossipsub";

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

/** @type {{helia: any, orbitdb: any, db: any, started: boolean, announceTimer: any}} */
let state = { helia: null, orbitdb: null, db: null, started: false, announceTimer: null };

/** Replicated foreign databases, addr → db instance. Doubles as the
 *  opened-this-session set (#28): OrbitDB open() is NOT idempotent per address
 *  in every version — repeated announces of the same address must not reopen
 *  it (socket/lock churn on flaky peers). Entries are READ too: a peer's own
 *  db only contains that peer's writes, so without reading the replicas the
 *  app never sees other peers' data even though replication succeeds.
 *  @type {Map<string, any>} */
const replicas = new Map();
/** Cap on replicated foreign databases (#28): each open holds WASM buffers —
 *  unbounded opens on a busy network would exhaust a low-end device. */
const MAX_REPLICATED = 50;

/**
 * Starts the P2P node (lazy: zero cost until the user shares something).
 * Contract: idempotent (subsequent calls return the same db); the browser node
 * uses wasm/WebRTC transports when available; resolves even before peers join.
 * @param {{helia?: any, directory?: string}} [opts] Optional pre-built Helia
 *   node (tests/probes: two in-process peers need distinct nodes) and OrbitDB
 *   storage directory (level locks one directory per instance).
 * @returns {Promise<any>} The shared OrbitDB keyvalue database.
 */
export async function startCollab(opts = {}) {
  if (state.started) return state.db;
  state.started = true;

  // Helia WASM: no servers, everything in-page.
  // DEFECT FIX (peer sync): Helia's default libp2p config has NO pubsub
  // service, and OrbitDB requires `libp2p.services.pubsub` for its sync
  // protocol (it does not declare the dependency itself). Without gossipsub
  // `pubsub` was undefined, startCollab threw on subscribe() and NO peer
  // ever synced. Merge our services over the defaults, never replace them.
  state.helia = opts.helia ?? await createHelia({
    libp2p: {
      config: "merge",
      services: { pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }) },
    },
  });
  if (typeof state.helia.start === "function") await state.helia.start(); // DEFECT FIX: createHelia() returns a STOPPED node — libp2p access threw NotStartedError
  state.orbitdb = await createOrbitDB({ ipfs: state.helia, directory: opts.directory }); // v4 API: the param is `ipfs`, NOT `helia`

  // Open/create the shared database with open write permissions
  // (peer-signed data, tolerant validation during the collection phase).
  state.db = await state.orbitdb.open("pharos-catalog", {
    type: "keyvalue",
    sync: true, // DEFECT FIX: undefined meant syncAutomatically=false — OrbitDB's pubsub sync never started
  });

  // Peer discovery: announce and listen for db addresses on the topic.
  const pubsub = state.helia.libp2p.services.pubsub;
  if (!pubsub) throw new Error("collab: libp2p pubsub service missing — sync impossible");
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
        await openReplica(msg.addr);
      }
    } catch { /* irrelevant message */ }
  });

  /** Opens a foreign address ONCE per session, capped, with a single retry
   *  (#28): gossipsub re-announces the same address every 60s — without the
   *  opened-set each announce would reopen the db; a transient open failure
   *  gets exactly one retry (flaky first gossip), never a retry loop. */
  async function openReplica(addr) {
    const key = String(addr);
    if (replicas.has(key)) return;
    if (replicas.size >= MAX_REPLICATED) return;
    try {
      replicas.set(key, await state.orbitdb.open(addr, { type: "keyvalue", sync: true }));
    } catch {
      try {
        // single retry (flaky first gossip), never a retry loop
        replicas.set(key, await state.orbitdb.open(addr, { type: "keyvalue", sync: true }));
      } catch { /* stale/unreachable addr: the next announce may retry later */ }
    }
  }

  // Proxy resolution on boot: reopen every address recorded before the last
  // session ended — shared state is available again WITHOUT waiting for a
  // peer to re-announce. Own address is pinned first in the registry.
  rememberAddress(state.db.address, true);
  (async () => {
    for (const addr of loadRegistry().slice(0, MAX_REPLICATED)) {
      if (String(addr) === String(state.db.address)) continue;
      await openReplica(addr);
    }
  })();

  announce();
  // Cleanup discipline (#28): the interval handle is owned by `state` and
  // cleared in stopCollab + on pagehide — no leaked timer keeps the tab warm.
  state.announceTimer = setInterval(announce, 60_000);
  const stopTimer = () => {
    if (state.announceTimer) { clearInterval(state.announceTimer); state.announceTimer = null; }
  };
  window.addEventListener("pagehide", () => { stopTimer(); stopCollab().catch(() => {}); }, { once: true });

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
  // NON-WIRED (#30, declared deferred removal — not silent): no caller ships
  // benchmarks today (the JS vs WASM decision is fixed at build time). Kept
  // only as the documented contract for a future experiment; if nothing
  // calls it by the next review, remove it here AND in the docs.
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
  // Merge own db + replicated foreign dbs: each peer writes to ITS OWN db, so
  // the own db alone never contains other peers' entries. Replicas are the
  // local copies of those dbs — read them or the data appears "not synced".
  // OrbitDB 4 keyvalue all() returns [{key, value, hash}] entries.
  const normalize = (rows) => (Array.isArray(rows)
    ? rows.map((e) => (e && typeof e === "object" && "value" in e ? e.value : e))
    : Object.values(rows ?? {}));
  const merged = new Map();
  const ownRows = normalize(await db.all());
  const replicaRows = [];
  for (const replica of replicas.values()) {
    try { replicaRows.push(...normalize(await replica.all())); } catch { /* replica unavailable */ }
  }
  for (const row of [...ownRows, ...replicaRows]) {
    const k = row && typeof row === "object" ? (row.label ?? row.key ?? JSON.stringify(row)) : row;
    merged.set(k, row);
  }
  return [...merged.values()];
}

/**
 * Stops the P2P node (battery saving, e.g. on visibilitychange hidden).
 * Contract: idempotent; safe to call before/after startCollab.
 * @returns {Promise<void>}
 */
export async function stopCollab() {
  if (state.announceTimer) { clearInterval(state.announceTimer); state.announceTimer = null; }
  for (const replica of replicas.values()) {
    try { await replica.close(); } catch { /* already closed */ }
  }
  if (state.db) await state.db.close();
  if (state.orbitdb) await state.orbitdb.stop();
  if (state.helia) await state.helia.stop();
  replicas.clear();
  state = { helia: null, orbitdb: null, db: null, started: false, announceTimer: null };
}
