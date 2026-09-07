/**
 * Public-domain registry (F1) — the fill engine's priority queue starts HERE.
 *
 * LEGAL RULE (non-negotiable): PD is asserted ONLY by curated sources that
 * have already made the legal determination:
 *   - `georgeblood` — digitized 78rpm discs, public domain by construction;
 *   - items with an explicit CC / publicdomain license field on the item;
 *   - `netlabels` — free-license charter (CC, not strictly PD, still safe).
 * The community can NEVER crowd-assert PD. It can only FLAG suspicions into
 * `pd:flag:<id>` (review queue): flags never de-list anything by themselves.
 *
 * All writes go through lib/catalogstore.js (`pd:<artist>`, `pd:flag:<id>`),
 * so every peer reads instead of re-deriving the same determination.
 */

import { searchArchive, classifyItem } from "./archive.js";
import { catalogGet, catalogSet, keys } from "./catalogstore.js";

/**
 * Artist-level PD assertion, source-side only (never crowd-asserted).
 * @param {string} artist Artist name.
 * @param {Object} [opts]
 * @param {string} [opts.collection="georgeblood"] Curated collection to scan.
 * @param {number} [opts.rows=100]
 * @returns {Promise<{artist: string, pd: boolean, curated: boolean,
 *   evidence: string[], reason: string}|null>} Null on network failure.
 */
export async function assertArtistPD(artist, { collection = "georgeblood", rows = 100 } = {}) {
  const key = keys.pd(artist);
  const cached = await catalogGet(key);
  if (cached) return cached;
  try {
    const { items } = await searchArchive({ query: `creator:"${artist}"`, collection, rows });
    const classified = items.map(classifyItem);
    const evidence = classified.filter((c) => c.pdLikely).map((c) => c.identifier).slice(0, 10);
    const anyCurated = classified.some((c) => c.curated);
    const record = {
      artist,
      pd: evidence.length > 0,
      curated: anyCurated,
      evidence,
      reason: evidence.length
        ? classifyItem(items.find((d) => classified.find((c) => c.identifier === d.identifier)?.pdLikely)).reason
        : "no curated PD evidence found",
      at: Date.now(),
    };
    if (anyCurated || evidence.length) await catalogSet(key, record);
    return record;
  } catch {
    return null; // network failure: honest unknown, never a false assertion
  }
}

/**
 * Community suspicion flag — the ONLY community power over PD content.
 * Flags accumulate; they inform review, they never de-list.
 * @param {string} identifier archive.org item id.
 * @param {string} [note] Free-text reason (bounded).
 * @returns {Promise<boolean>} true when the flag was published.
 */
export async function flagSuspicious(identifier, note = "") {
  try {
    const key = keys.pdFlag(identifier);
    const current = (await catalogGet(key)) ?? { identifier, flags: 0, notes: [] };
    current.flags = (current.flags ?? 0) + 1;
    if (note) current.notes = [...(current.notes ?? []), String(note).slice(0, 200)].slice(-20);
    current.at = Date.now();
    return await catalogSet(key, current);
  } catch {
    return false;
  }
}

/** Reads the flag state of an item (null = never flagged). */
export async function flagsFor(identifier) {
  return catalogGet(keys.pdFlag(identifier));
}

/**
 * PD-first candidate stream for the fill scheduler (F2): artists whose
 * content is public domain by construction, before any popularity ranking.
 * Contract: network failures return [] (the scheduler falls back to
 * popularity); bounded — this runs on idle time only.
 * @param {number} [rows=300]
 * @returns {Promise<string[]>} Artist names with PD-by-construction items.
 */
export async function pdCandidates(rows = 300) {
  try {
    const { items } = await searchArchive({ query: "", collection: "georgeblood", rows });
    const out = [];
    const seen = new Set();
    for (const doc of items) {
      const c = classifyItem(doc);
      if (!c.pdLikely) continue;
      const raw = Array.isArray(doc.creator) ? doc.creator[0] : doc.creator;
      if (typeof raw !== "string" || !raw.trim()) continue;
      const name = raw.trim();
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}
