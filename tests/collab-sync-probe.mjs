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

const { startCollab, allMetrics } = await import("../lib/collab.js");

let nodeA, nodeB;
const dir = await mkdtemp(`${tmpdir()}/collab-probe-`);
try {
  nodeA = await makeNode(0);
  nodeB = await makeNode(0);

  const dbA = await startCollab({ helia: nodeA, directory: `${dir}/a` });
  const dbB = await startCollab({ helia: nodeB, directory: `${dir}/b` });
  check("both peers started (pubsub present, no throw)", !!dbA && !!dbB);

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

  console.log(`\nRESULT: ${PASS.filter(Boolean).length}/${PASS.length} pass`);
  process.exit(PASS.every(Boolean) ? 0 : 1);
} catch (err) {
  console.error("probe error:", err?.message ?? err);
  process.exit(1);
} finally {
  try { await nodeA?.stop(); } catch {}
  try { await nodeB?.stop(); } catch {}
}
