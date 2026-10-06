/**
 * Security gate r2 — CWE-306 remediation for publishCanon (lib/popularity.js).
 *
 * The community canon write path on OrbitDB must fail closed: no authorization
 * proof, no write. Runs offline with a stub db (no OrbitDB boot needed).
 *
 * Usage: node tests/canon.publish.test.mjs
 */
import assert from "node:assert/strict";
import { CANON, publishCanon } from "../lib/popularity.js";

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    return Promise.resolve(fn()).then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    }, (e) => {
      failed++;
      console.log(`FAIL  ${name}: ${e.message}`);
    });
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${e.message}`);
    return Promise.resolve();
  }
}

/** Stub db mimicking an OrbitDB keyvalue store with a spy on put(). */
function stubDb() {
  const writes = [];
  return {
    writes,
    async get() { return null; },
    async put(key, value) { writes.push({ key, value }); return "cid-stub"; },
  };
}

const AUTHORIZED = () => true;
const UNAUTHORIZED = () => false;

const tests = [
  ["refuses write when no authorization proof is provided", async () => {
    const db = stubDb();
    await assert.rejects(publishCanon(db, { "erik satie": 5 }), /unauthorized/i);
    assert.equal(db.writes.length, 0, "db.put must NOT be called without authz");
  }],
  ["refuses write when the authorization check returns false", async () => {
    const db = stubDb();
    await assert.rejects(publishCanon(db, { "erik satie": 5 }, { authorize: UNAUTHORIZED }), /unauthorized/i);
    assert.equal(db.writes.length, 0, "db.put must NOT be called when authz denies");
  }],
  ["writes the merged table when authorization succeeds", async () => {
    const db = stubDb();
    await publishCanon(db, { "erik satie": 5 }, { authorize: AUTHORIZED });
    assert.equal(db.writes.length, 1);
    const w = db.writes[0];
    assert.equal(w.key, "canon");
    assert.equal(w.value["erik satie"], 5);
    assert.equal(w.value["mozart"], CANON["mozart"], "builtin defaults survive the merge");
  }],
  ["merge order: incoming partial entry wins over the current community table (documented contract)", async () => {
    const db = stubDb();
    db.get = async () => ({ mozart: 3 });
    await publishCanon(db, { mozart: 9 }, { authorize: AUTHORIZED });
    assert.equal(db.writes[0].value.mozart, 9, "incoming partial table overrides the current entry");
  }],
];

for (const [name, fn] of tests) {
  await check(name, fn);
}

console.log(`\ncanon.publish: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
