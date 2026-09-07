/**
 * ListenBrainz metadata lookup — the low-rate-limit alternative.
 *
 * ListenBrainz is the open sister project of MusicBrainz (same MetaBrainz
 * ecosystem, open data) and its public API is far more generous than
 * MusicBrainz's 1 req/s: light interactive use is effectively unmetered.
 *
 * We use it as the FIRST text-lookup source for track canonicalization
 * (artist+title → recording MBID + canonical names), leaving MusicBrainz
 * (through the shared mbgate queue) for what only it provides: release-group
 * discographies and structured per-release tracklists.
 *
 * Contract: lookup(artist, title) → {artist, title, mbid, confidence} | null.
 * Never throws; null on any failure so callers fall through to MB.
 * AUTH: LB's lookup endpoint requires a (free) user token — set it once in
 * localStorage `pf.lbtoken` or via the app settings; without it the module
 * returns null immediately and MusicBrainz (via mbgate) remains the source.
 */

const LB_LOOKUP = "https://api.listenbrainz.org/1/metadata/lookup/";

/** @returns {string|null} The user's ListenBrainz token, if configured. */
function lbToken() {
  try { return localStorage.getItem("pf.lbtoken"); } catch { return null; }
}

/**
 * Similarity in [0,1] via trigram-Dice — the same objective measure used by
 * lib/canonical.js and lib/ranker.js (kept local to avoid a circular import).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function trigram(a, b) {
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const gram = (s) => { const g = new Set(); for (let i = 0; i < s.length - 2; i++) g.add(s.slice(i, i + 3)); return g; };
  const A = gram(norm(a)), B = gram(norm(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * Text canonicalization via ListenBrainz.
 * @param {string} artist Cleaned artist name (may be "Artista sconosciuto"/unknown).
 * @param {string} title Cleaned track title.
 * @returns {Promise<{artist: string, title: string, mbid: string, confidence: number, source: "listenbrainz"}|null>}
 */
export async function lbLookup(artist, title) {
  if (!title) return null;
  const token = lbToken();
  if (!token) return null; // not configured: fall through to MusicBrainz
  const params = new URLSearchParams({ recording_name: title });
  if (artist && !/unknown|sconosciuto/i.test(artist)) params.set("artist_name", artist);
  try {
    const res = await fetch(`${LB_LOOKUP}?${params}`, { headers: { Authorization: `Token ${token}` } });
    if (!res.ok) return null;
    const json = await res.json();
    const rec = json?.recording_mbid ? json : null;
    if (!rec) return null;
    const mbArtist = rec.artist_name ?? "";
    const confArtist = artist && !/unknown|sconosciuto/i.test(artist) ? trigram(artist, mbArtist) : 0.5;
    const confTitle = trigram(title, rec.recording_name ?? title);
    return {
      artist: mbArtist || artist,
      title: rec.recording_name ?? title,
      mbid: rec.recording_mbid,
      confidence: 0.5 * confTitle + 0.5 * confArtist,
      source: "listenbrainz",
    };
  } catch {
    return null;
  }
}
