/**
 * Classical-catalog ordering — by WORK, not by release year.
 *
 * For classical artists the album release year is nearly meaningless: dozens
 * of compilations re-record the same works. The community-accepted order is
 * by WORK: category (symphonies, concertos, sonatas…) then work number/opus.
 * This module extracts the work identity from canonical titles using objective
 * patterns (MusXxx numbering, "No. N", op. N, BWV/K catalogue prefixes).
 *
 * Contract: pure functions, O(n log n), no network.
 */

const CATEGORY_PATTERNS = [
  { re: /\bsymphony|symphon(y|ies)\b/i, key: "symphonies", label: "Symphonies", rank: 1 },
  { re: /\bconcerto/i, key: "concertos", label: "Concertos", rank: 2 },
  { re: /\bsonata|sonatina/i, key: "sonatas", label: "Sonatas", rank: 3 },
  { re: /\bquartet/i, key: "quartets", label: "String quartets", rank: 4 },
  { re: /\boverture|incidental/i, key: "overtures", label: "Overtures & incidental music", rank: 5 },
  { re: /\bmass|requiem|missa|oratorio|cantata/i, key: "sacred", label: "Sacred & choral", rank: 6 },
  { re: /\bvariation/i, key: "variations", label: "Variations", rank: 7 },
  { re: /\bnocturne|impromptu|etude|étude|prelude|prélude|fantasy|bagatelle/i, key: "piano", label: "Piano works", rank: 8 },
];

/** Heuristic: does this look like classical-repertoire vocabulary at all? */
export function looksClassical(entries) {
  const sample = entries.slice(0, 20).map((e) => e.title).join(" ").toLowerCase();
  const hits = CATEGORY_PATTERNS.filter((p) => p.re.test(sample)).length;
  return hits >= 2; // at least two distinct classical categories
}

/**
 * Extract the work identity from a canonical title.
 * @param {string} title
 * @returns {{categoryRank: number, categoryLabel: string, workNo: number, opus: number}}
 */
export function parseWork(title) {
  const t = String(title);
  let categoryRank = 99;
  let categoryLabel = "Other works";
  for (const p of CATEGORY_PATTERNS) {
    if (p.re.test(t)) { categoryRank = p.rank; categoryLabel = p.label; break; }
  }
  // Work number: "no. 5", "no.5", "no 5" (also roman numerals up to 20)
  let workNo = 9999;
  const noMatch = t.match(/\bno\.?\s*(\d{1,3})\b/i);
  if (noMatch) workNo = Number(noMatch[1]);
  else {
    const roman = t.match(/\bno\.?\s*(I{1,3}|IV|V|VI{1,3}|IX|X{1,3}|XV|XIX|XX)\b/i);
    if (roman) workNo = romanToNumber(roman[1]);
  }
  // Opus/catalogue number: "op. 67", "opus 18", "bwv 1007", "k. 626"
  let opus = 9999;
  const opMatch = t.match(/\b(?:op|opus)\.?\s*(\d{1,3})/i);
  const catMatch = t.match(/\b(?:bwv|kv|k\.|d|d\.)\s*(\d{1,4})\b/i);
  if (opMatch) opus = Number(opMatch[1]);
  else if (catMatch) opus = Number(catMatch[1]);
  return { categoryRank, categoryLabel, workNo, opus };
}

function romanToNumber(r) {
  const map = { I: 1, V: 5, X: 10 };
  return r.toUpperCase().split("").reduce((acc, c) => {
    const v = map[c] ?? 0;
    return acc + (v > (map[r.toUpperCase()[r.toUpperCase().indexOf(c) + 1]] ?? 0) ? -v : v);
  }, 0);
}

/**
 * Group and order classical entries by work.
 * @template {{title: string, year?: number|null}} E
 * @param {E[]} entries
 * @returns {[string, E[]][]} Ordered [categoryLabel, entries] pairs.
 */
export function groupByWork(entries) {
  const groups = new Map();
  for (const e of entries) {
    const w = parseWork(e.title);
    if (!groups.has(w.categoryLabel)) groups.set(w.categoryLabel, []);
    groups.get(w.categoryLabel).push({ ...e, __work: w });
  }
  return [...groups.entries()]
    .sort((a, b) => a[1][0].__work.categoryRank - b[1][0].__work.categoryRank)
    .map(([label, list]) => [
      label,
      list.sort((a, b) =>
        a.__work.workNo - b.__work.workNo ||
        a.__work.opus - b.__work.opus ||
        (a.year ?? 0) - (b.year ?? 0)
      ),
    ]);
}
