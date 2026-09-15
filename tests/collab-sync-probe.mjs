/**
 * Two-peer DB sync probe (task: DB fails to sync between two peers on the
 * same network). Creates TWO real Helia+OrbitDB nodes in-process (TCP
 * transport + mDNS peer discovery — the same-network scenario), wires each
 * into startCollab via dependency injection, has peer A write a record, and
 * asserts peer B's allMetrics() eventually sees it through real pubsub sync.
 * Exit 0 = sync works; non-zero = reproduction/fix failure.
 */
import { createHelia } from "helia";
import { gossipsub } from "@libp2p/gossipsub";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import { mdns } from "@libp2p/mdns";
import { libp2pDefaults } from "@helia/libp2p";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PASS = [];
function check(name, ok, detail = "") {
  PASS.push(ok);
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function makeNode(port) {
  return createHelia({
    libp2p: {
      addresses: { listen: [`/ip4/127.0.0.1/tcp/${port}`] },
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [mdns()],
      services: {
        pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),
        identify: identify(),
      },
    },
  });
}

// Browser globals for collab.js (localStorage/window/navigator).
globalThis.window = { addEventListener() {} };
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, v); },
};
Object.defineProperty(globalThis, "navigator", {
  value: { hardwareConcurrency: 4, userAgent: "probe" },
  configurable: true,
});

const { startCollab, allMetrics, collabState } = await import("../lib/collab.js");

let nodeA, nodeB;
const dir = await mkdtemp(`${tmpdir()}/collab-probe-`);
try {
  nodeA = await makeNode(0);
  nodeB = await makeNode(0);

  const dbA = await startCollab({ helia: nodeA, directory: `${dir}/a` });
  const dbB = await startCollab({ helia: nodeB, directory: `${dir}/b` });
  check("both peers started (pubsub present, no throw)", !!dbA && !!dbB);
  const st = collabState();
  check("collabState reports a ready node with the shared DB open", st.ready === true && st.dbOpen === true, JSON.stringify(st));

  // Give the two nodes a moment to discover each other via mDNS, then write
  // on A; B must see the record through replication.
  await new Promise((r) => setTimeout(r, 3_000));
  await dbA.put("bench|probe", { label: "probe", at: Date.now(), n: 42 });

  let seen = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const rows = (await allMetrics()).filter((r) => r?.label === "probe");
    if (rows.length > 0) { seen = rows; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  check("peer B sees peer A's record (sync works)", Array.isArray(seen) && seen.length > 0,
    seen ? `rows=${seen.length}` : "timeout 45s: record never replicated");

  // Peer talk test: the exchange must work in BOTH directions (B → A too),
  // not just one-way replication.
  await dbB.put("bench|reply", { label: "reply", at: Date.now(), n: 7 });
  let back = null;
  const deadline2 = Date.now() + 45_000;
  while (Date.now() < deadline2) {
    const rows = (await allMetrics()).filter((r) => r?.label === "reply");
    if (rows.length > 0) { back = rows; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  check("peer A sees peer B's record (bidirectional peer talk)", Array.isArray(back) && back.length > 0,
    back ? `rows=${back.length}` : "timeout 45s: B → A never replicated");

  // Regression guard (documented upstream defect): helia's advertised
  // `config: 'merge'` silently DROPS nested services — its merge() rebuilds
  // nested objects into a discarded output, so services.pubsub (depth 2)
  // disappeared and sync was impossible. We must NEVER go back to it: the
  // merge path is expected to be broken here (that IS the assertion), and our
  // explicit config must carry pubsub.
  const merged = libp2pDefaults({ config: "merge", services: { pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }) } });
  check("config:'merge' is still broken upstream (documented — never use it)",
    typeof merged?.services?.pubsub !== "function",
    `merge services.pubsub=${typeof merged?.services?.pubsub}`);
  const explicit = { ...libp2pDefaults(), services: { ...libp2pDefaults().services, pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }) } };
  check("explicit config (production path) carries pubsub",
    typeof explicit?.services?.pubsub === "function",
    `explicit services.pubsub=${typeof explicit?.services?.pubsub}`);

  console.log(`\nRESULT: ${PASS.filter(Boolean).length}/${PASS.length} pass`);
  process.exit(PASS.every(Boolean) ? 0 : 1);
} catch (err) {
  console.error("probe error:", err?.message ?? err);
  process.exit(1);
} finally {
  try { await nodeA?.stop(); } catch {}
  try { await nodeB?.stop(); } catch {}
}
