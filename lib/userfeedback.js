/**
 * Community feedback (owner request) — an in-app form that collects bug
 * reports and suggestions and stores them where the community (and the
 * maintainers) can retrieve them as a lightweight issue list.
 *
 * Two stores, both zero-server (the project has no backend):
 *   1. LOCAL: localStorage `pf.userfeedback` — the reporter's own records,
 *      including those not yet synced; cap 200, append-only.
 *   2. SHARED: the P2P catalog layer (lib/catalogstore.js, OrbitDB keyvalue,
 *      `issues:` namespace) — records written by any peer replicate to all
 *      peers, so the community sees the community's reports.
 *
 * Record contract (no personal data):
 *   { hash, type: "bug"|"suggestion", page, title, body, app, at, by, n }
 * hash = FNV-1a of (type+page+title+body, normalized) → idempotent dedup.
 *
 * Retrieval: listFeedback() merges local + shared, dedups by hash (highest
 * count wins for `n`, newest `at` wins) and sorts newest-first. The
 * developer export (exportFeedbackJson()) produces the JSON handed to the
 * repo's issue tracker — the export→issue step is human-run by design
 * (nothing writes to the repository automatically).
 */

import { catalogGet, catalogSet } from "./catalogstore.js";

const LS_KEY = "pf.userfeedback";
const SHARED_KEY = "issues:reports";
const LOCAL_CAP = 200;
const TITLE_MAX = 120;
const BODY_MAX = 2000;
const DAILY_CAP = 5;

/** Anonymous, stable per-install id (random, no fingerprinting). */
export function installId() {
  try {
    let id = localStorage.getItem("pf.installid");
    if (!id) {
      id = `install-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      localStorage.setItem("pf.installid", id);
    }
    return id;
  } catch {
    return "install-anon";
  }
}

/** FNV-1a content hash (hex) — the dedup key across peers. */
export function contentHash(rec) {
  const s = `${rec.type}|${rec.page}|${norm(rec.title)}|${norm(rec.body)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Reads the LOCAL reports (the reporter's own, always available). */
export function localReports() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") ?? []; } catch { return []; }
}

/**
 * Validates + caps a submission. Throws a labeled Error when invalid so the
 * form can show an honest message (never silently drop).
 * @param {{type: string, page?: string, title: string, body: string}} rec
 */
function validate(rec) {
  const type = rec.type === "bug" || rec.type === "suggestion" ? rec.type : null;
  if (!type) throw new Error("type must be “bug” or “suggestion”");
  const title = String(rec.title ?? "").trim().slice(0, TITLE_MAX);
  const body = String(rec.body ?? "").trim().slice(0, BODY_MAX);
  if (title.length < 3) throw new Error("please add a short title (min 3 chars)");
  if (body.length < 10) throw new Error("please describe it in at least 10 characters");
  return { type, title, body };
}

/**
 * Submits a report: validates, dedups (same content = counter bump, never a
 * duplicate entry), applies the daily anti-abuse cap, writes LOCAL then
 * merges into the SHARED catalog (P2P). Never throws on P2P failure — the
 * report stays local and replicates on a later submit.
 * @param {{type: string, page?: string, title: string, body: string}} rec
 * @returns {Promise<{hash: string, shared: boolean}>}
 */
export async function submitFeedback(rec) {
  const { type, title, body } = validate(rec);
  const today = new Date().toISOString().slice(0, 10);
  const local = localReports();
  const todayCount = local.filter((r) => (r.at > 0 && new Date(r.at).toISOString().slice(0, 10) === today)).length;
  if (todayCount >= DAILY_CAP) {
    throw new Error(`daily limit reached (${DAILY_CAP} reports per day) — thank you, try tomorrow`);
  }

  const base = {
    type,
    page: String(rec.page ?? "unknown").slice(0, 60),
    title,
    body,
    app: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
    by: installId(),
  };
  const hash = contentHash(base);

  // LOCAL append-only store, dedup by hash (bump count instead).
  const existing = local.find((r) => r.hash === hash);
  let record;
  if (existing) {
    existing.n = (existing.n ?? 1) + 1;
    existing.at = Date.now();
    record = existing;
  } else {
    record = { ...base, hash, at: Date.now(), n: 1 };
    local.unshift(record);
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(local.slice(0, LOCAL_CAP)));
  } catch {}

  // SHARED merge (additive, idempotent): hash → record, largest count wins.
  let shared = false;
  try {
    const table = (await catalogGet(SHARED_KEY)) ?? {};
    const prev = table[hash];
    table[hash] = {
      ...base,
      hash,
      at: Math.max(record.at, prev?.at ?? 0),
      n: Math.max(record.n ?? 1, prev?.n ?? 1),
    };
    // Footprint cap: 1000 most recent reports.
    const entries = Object.entries(table).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, 1000);
    await catalogSet(SHARED_KEY, Object.fromEntries(entries));
    shared = true;
  } catch {}

  return { hash, shared };
}

/**
 * Community issue list: local + shared reports merged, deduped by hash,
 * newest first. Shared read failure degrades to local-only (honest).
 * @returns {Promise<Array<{hash,type,page,title,body,app,at,by,n,mine}>>}
 */
export async function listFeedback() {
  let shared = {};
  try { shared = (await catalogGet(SHARED_KEY)) ?? {}; } catch {}
  const merged = new Map();
  for (const [hash, r] of Object.entries(shared)) {
    if (r && hash === r.hash) merged.set(hash, { ...r, mine: false });
  }
  for (const r of localReports()) {
    if (!r?.hash) continue;
    const prev = merged.get(r.hash);
    merged.set(r.hash, {
      ...r,
      at: Math.max(r.at ?? 0, prev?.at ?? 0),
      n: Math.max(r.n ?? 1, prev?.n ?? 1),
      mine: true,
    });
  }
  return [...merged.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/**
 * Developer export: the community issue list as pretty JSON (copy into the
 * repo tracker by hand — no automatic repository writes, zero-server rule).
 * @returns {Promise<string>}
 */
export async function exportFeedbackJson() {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), reports: await listFeedback() },
    null,
    2,
  );
}
