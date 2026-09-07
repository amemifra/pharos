/**
 * Catalog source registry.
 *
 * Every legal/public source is an adapter exposing the SAME interface:
 *   search(params)  -> raw docs
 *   normalize(raw)  -> Album[]  (contract of lib/pipeline.js)
 *   metadata(id)    -> raw item
 *
 * The normalization pipeline is source-agnostic: adding a new source = adding
 * an adapter, zero changes to the UI or the pipeline.
 * Entry requirement for every source: legally distributable content
 * (public domain, free licenses, artist-authorized sharing).
 */

import { searchArchive, fetchItemMetadata, COLLECTIONS as AO_COLLECTIONS } from "./archive.js";
import { normalizeSearchItem, normalizeAlbum } from "./pipeline.js";

/**
 * @typedef {Object} Source
 * @property {string} id Stable unique id ("archive.org:etree", ...).
 * @property {string} label UI label.
 * @property {string} licenses Description of the catalog's typical licenses.
 * @property {(p: {query?: string, page?: number, tag?: string}) => Promise<Object[]>} search
 * @property {(id: string) => Promise<Object>} metadata
 * @property {(raw: Object) => import("./pipeline").Album} normalize
 * @property {(id: string, meta: Object) => import("./pipeline").Album} normalizeAlbum
 */

/** archive.org: multiple collections, one adapter. */
function archiveOrgSource(collectionId, label, licenses) {
  return {
    id: `archive.org:${collectionId}`,
    label,
    licenses,
    search: async (p) =>
      (await searchArchive({ query: p.query, collection: collectionId, page: p.page, rows: 24 })).items.map(normalizeSearchItem),
    metadata: (id) => fetchItemMetadata(id),
    normalize: normalizeSearchItem,
    normalizeAlbum: normalizeAlbum,
  };
}

/** Currently active sources. */
export const SOURCES = [
  ...AO_COLLECTIONS.map((c) =>
    archiveOrgSource(c.id, `${c.label} (archive.org)`, "public domain / CC / artist-authorized (etree)")
  ),
  // Next candidate sources (add them here, touch nothing else):
  // - Free Music Archive (public API, CC licenses) — adapter mapping their
  //   JSON into the same Album/Track records.
  // - Jamendo (CC music, free API with key) — same.
  // - ccMixter (CC remixes) — RSS feed → adapter.
  // - Musopen (public-domain classical) — same.
  // - Netlabel sites with static JSON endpoints — fetch+normalize adapter.
  // - Blogs/directories of artists giving away albums (HTML pages):
  //   aggregation happens at build time / manual curation, NOT at runtime,
  //   to keep the client light on low-end phones.
];

/**
 * Looks up a source by id.
 * Contract: falls back to the first source instead of throwing.
 * @param {string} id Source id.
 * @returns {Source}
 */
export function getSource(id) {
  return SOURCES.find((s) => s.id === id) ?? SOURCES[0];
}
