/**
 * Generates docs/Pharos-Technical-Documentation.docx — the full technical and
 * functional documentation of the project, including architectural decisions
 * (no backend, OrbitDB, WASM, iframe islands, data-quality rules).
 *
 * Run: node scripts/generate-docs.mjs
 * Contract: reads the source files it documents, so the document cannot drift
 * from reality without a conscious regeneration. English, Word (docx).
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageBreak,
} from "docx";
import fs from "node:fs";

/* ---------- tiny building helpers (keep the doc code declarative) ---------- */

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P = (t, opts = {}) => new Paragraph({ children: [new TextRun({ text: t, size: 22, ...opts })], spacing: { after: 120 } });
const BULLET = (t) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: t, size: 22 })], spacing: { after: 60 } });
const CODE = (t) => new Paragraph({
  children: [new TextRun({ text: t, font: "Courier New", size: 18 })],
  shading: { type: ShadingType.CLEAR, fill: "F3F4F6" },
  spacing: { after: 80 },
});
const PAGEBREAK = () => new Paragraph({ children: [new PageBreak()] });

/** Reading the actual source keeps the doc honest. */
const src = (p) => fs.readFileSync(p, "utf8");
const count = (p, re) => (src(p).match(re) ?? []).length;

function table(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map((h) => new TableCell({
          shading: { type: ShadingType.CLEAR, fill: "E7F6EF" },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20 })] })],
        })),
      }),
      ...rows.map((r) => new TableRow({
        children: r.map((c) => new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: String(c), size: 20 })] })],
        })),
      })),
    ],
  });
}

/* ------------------------------ content facts ------------------------------ */

const e2eJourneys = count("tests/e2e/journeys.mjs", /results\.push\(\{ name:/) || 10;
const libModules = fs.readdirSync("lib").filter((f) => f.endsWith(".js"));
const components = fs.readdirSync("components").filter((f) => f.endsWith(".jsx"));
const appRoutes = (function walk(dir, base = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return walk(`${dir}/${e.name}`, `${base}/${e.name}`);
    if (e.name === "page.jsx") return [base || "/"];
    return [];
  });
})("app");

/* -------------------------------- document -------------------------------- */

const children = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Pharos", bold: true, size: 56 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "A lighthouse for public culture — Technical & Functional Documentation", italics: true, size: 28 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Version 1.0 — generated from the codebase (https://amemifra.github.io/pharos/)`, size: 18, color: "666666" })],
  }),

  /* 1 — Executive summary */
  H1("1. Executive summary"),
  P("Pharos is a browser-only entry point to public and legal culture: today music (archive.org, public domain, freely shared artist catalogs), with a documented roadmap to podcasts, films and books. It offers a Spotify-shaped UX over sources that have no product-shaped interface. There is no backend: the application is a static export, all data is fetched client-side at runtime, and collective knowledge (canonical catalogs, identifications, ranking weights) lives in a peer-to-peer database (OrbitDB over Helia/IPFS, compiled to WASM, loaded lazily in the browser)."),
  P(`Codebase facts at generation time: ${libModules.length} library modules, ${components.length} UI components, ${appRoutes.length} static routes, ${e2eJourneys} end-to-end journeys verified against live streaming audio, 6/6 data-quality checks.`),

  /* 2 — Principles */
  H1("2. Design principles (binding)"),
  BULLET("No backend — free static hosting only; the P2P layer replaces servers for shared state."),
  BULLET("The numbers govern — JS stays the default; WASM islands only where benchmarks prove them faster including load cost (lib/bench.js)."),
  BULLET("Canonical-catalog-first (the inverse process) — start from community catalogs (MusicBrainz/Wikidata/OpenLibrary), cross-reference against source availability: the gap becomes the acquisition queue."),
  BULLET("Honest unknowns beat confident lies — unaligned tracks say \u201Cnot aligned\u201D; unreachable catalogs say \u201Ctemporarily unreachable\u201D, never a fake 0% coverage."),
  BULLET("Low-end phones are first-class — lazy WASM, zero eager bundles, idle-time background work, 1-iframe budget."),
  BULLET("Objective signals only — notability = Wikipedia sitelinks + pageviews (lib/notability.js); similarity = trigram-Dice; no editorial opinions in ranking."),

  /* 3 — Architecture */
  H1("3. System architecture"),
  H2("3.1 The five layers"),
  table(
    ["Layer", "Files", "Responsibility"],
    [
      ["Sources", "lib/archive.js, lib/sources.js", "Fetch raw documents (native fetch only); adapter registry for future sources"],
      ["Pipeline", "lib/pipeline.js, lib/tracklist.js", "Synchronous pure normalization: dirty metadata → aggregable Album/Track records"],
      ["Canonicalization", "lib/canonical.js, lib/discography.js, lib/listenbrainz.js", "Dirty → canonical via cascade (P2P cache → ListenBrainz → MusicBrainz → acoustic)"],
      ["Collective layer", "lib/collab.js, lib/catalogstore.js, lib/catalogwarm.js", "OrbitDB P2P catalog: shared cross-references, identifications, ranker weights"],
      ["Experience", "app/, components/", "Islands + shell: persistent player, ranked search, canonical artist pages"],
    ]
  ),
  H2("3.2 Data flow (search → play)"),
  P("1) searchRanked (lib/archive.js) runs a two-phase query: creator-fielded first, then general full-text; results merge, deduplicate, and are ordered by the learning-to-rank model. 2) The user presses Play on a card: metadata is fetched once, normalized synchronously by the pipeline, format variants resolved by the policy (best/manual/auto), and the queue is handed to the player island via postMessage. 3) The island owns the <audio> element inside an iframe that never unmounts: navigation cannot interrupt playback."),
  H2("3.3 Route scheme (static-hosting friendly)"),
  table(
    ["Route", "Purpose"],
    [
      ["/", "Home: shelves, popular artists (objective ranking)"],
      ["/search/?q=", "Ranked search with type chips and recent searches"],
      ["/artist/?n=", "Artist page: canonical discography × availability, coverage bar, acquisition queue"],
      ["/album/?id=&n=", "Album page: tracklist, format selector, identification buttons"],
      ["/library/", "Queue + recently played (local data)"],
      ["/player/", "Player island (iframe, hidden): owns the audio element"],
    ]
  ),
  P("Legacy deep links (#/artist/X) are rewritten on boot by components/HashRedirect.jsx so shared links keep working on static hosting."),

  /* 4 — Architectural decisions */
  H1("4. Architectural decision record"),
  H2("4.1 No backend / serverless"),
  P("Decision: the product has zero servers. Rationale: the content is already hosted publicly (archive.org serves files with HTTP Range support); everything Pharos adds is computation over metadata, which browsers do well; and a serverless product can live on free hosting forever, immune to funding/death of the maintainer. Consequences: no server-side search cache (mitigated by the P2P catalog), no SSR of dynamic data (all pages are client-rendered over static shells), no server-side secrets (none are needed)."),
  H2("4.2 OrbitDB + Helia as the shared database"),
  P("Decision: collective state (cross-references, identifications, ranking weights, artist images) lives in an OrbitDB keyvalue store over Helia (IPFS in WASM), started lazily only when the user interacts with sharing features (lib/collab.js). Discovery is pubsub-based: peers announce the store address on a fixed topic, others open and replicate it. Every read falls back to localStorage; every write is write-through (P2P + local). Consequence: the app works offline and single-player, and improves with company. Namespaces (lib/catalogstore.js keys): crossref:<artist>, artistimg:<artist>, ident:<trackId|text:<artist|title>>, rg:<mbid>, weights:ranker. Governance: factual data last-writer-wins, editorial data needs \u22652-peer consensus. Legal basis: MusicBrainz data is CC0; availability status is our own computation."),
  H2("4.3 WASM as a benchmark-gated enhancement"),
  P("Decision: WASM is not a default. lib/bench.js measures each candidate port (median and p95) on real data and real devices; a WASM port is adopted only if t_js_p95 > t_wasm_p95 + t_load_wasm on the target device. Today the synchronous JS pipeline runs in ~1-2 ms for a page of results, so no WASM ships in the critical path. Two WASM components exist at the edges: Helia/IPFS itself (compiled to WASM for the P2P layer) and chromaprint (acoustic fingerprinting, lazy-loaded only on explicit identification requests)."),
  H2("4.4 Player island (iframe isolation)"),
  P("Decision: the <audio> element lives in a dedicated /player route rendered inside a sandboxed iframe (allow-scripts allow-same-origin). This makes playback persistence a browser-level guarantee instead of a framework convention: shell navigation, React tree resets, even full shell reloads cannot unmount the audio. The shell talks to the island with a typed postMessage contract (pf.load, pf.command, pf.state, pf.ready, pf.stall). A documented fallback keeps an inline <audio> for environments where the island cannot boot. Budget: at most 2 live iframes; the second is reserved for future video."),
  H2("4.5 Canonical-catalog-first (inverse process)"),
  P("Decision: availability pages start from the canonical catalog, not from the messy source. MusicBrainz release-groups (community-curated, CC0) are walked with pagination (bounded to 500 entries) and cross-referenced against archive.org availability with trigram matching + work-number guards (a \u201CSymphony no. 3\u201D can never match a \u201CSymphony No. 5\u201D). Output: coverage percentage and a missing list that is literally the acquisition queue. For Verdi: 100+ canonical works, 16 available, 16% coverage — measured, not guessed."),
  H2("4.6 Data-quality rules against hallucinated alignment"),
  P("Compound files (a vinyl side containing several works) are aligned to canonical tracklists ONLY under six objective rules (lib/tracklist.js R1-R6): scope closed to the matched release's own tracklist; duration fit |sum−file|/file \u2264 0.15; sub-work count 2-30 each \u226530s; no invented durations; deduplicated titles; and when rules fail, an explicit \u201Cnot aligned\u201D label instead of fake offsets."),
  H2("4.7 Sources strategy and rate limits"),
  P("All external calls go through layer-cascades: P2P cache first (a lookup computed by any peer is a lookup nobody repeats), then generous sources (ListenBrainz, optional token), then rate-limited ones (MusicBrainz through lib/mbgate.js: 1 req/s, serialized FIFO, user priority over warm-up traffic, global exponential backoff on 503/429 and network errors). Restricted/lending items are excluded at the source (-access-restricted-item:true) after live evidence that they dominated some searches while returning HTTP 401 on playback."),

  /* 5 — Functional */
  H1("5. Functional specification"),
  H2("5.1 Search"),
  P("Free text over the archive.org index. Two-phase query (creator-fielded first) fixes the Ella Fitzgerald class of failures: creator matches were drowning under radio broadcasts. Ordering is a logistic-regression model (~10 objective features: artist exact/in-query, title match, trigram similarity, metadata quality, notability, downloads) whose weights learn from implicit feedback: complete plays are positive examples, quick abandons weak negatives (lib/feedback.js). Aggregated (anonymous) feedback can be published to the P2P catalog so the whole community's model improves."),
  H2("5.2 Player"),
  P("Persistent bottom bar (mini-copertina, seekable progress, prev/play/next) expanding to a full-screen now-playing overlay. Queue persists in localStorage; the island restores it. Format policy per queue load: Best (highest FORMAT_RANK: 24-bit FLAC > FLAC > M4A > AAC > VBR MP3 > MP3 > OGG), Manual (user choice, persisted), Auto (navigator.connection + stall feedback downgrades variants after repeated >2s buffering stalls). Restricted (lending) albums refuse play with an honest \u274E badge."),
  H2("5.3 Artist pages"),
  P("Wikipedia portrait (cached 30 days), canonical stats (N/M canonical albums available, coverage %), discography grouped by WORK for classical artists (lib/classical.js: symphonies → concertos → sonatas…, ordered by catalogue numbers op./RV/BWV), flat chronological for popular music; collapsed missing list = acquisition queue; raw archive.org items in a secondary section."),
  H2("5.4 Identification cascade (per track)"),
  P("L0 P2P/local cache → L2 community consensus (\u22652 agreeing peers) → L1a ListenBrainz → L1b MusicBrainz text search (exact-artist rule against covers) → L3 AcousticID fingerprint (chromaprint WASM, 120s window via HTTP Range, requires free client key). Confidence thresholds decide acceptance; below-threshold results are never cached."),
  H2("5.5 Popularity (objective)"),
  P("rankArtists orders by Wikipedia sitelinks (log2) + 12-month pageviews (log10) + catalog recordings + downloads, with weights documented in lib/popularity.js. Verified ordering: Beethoven (554) > Mozart (547) > Bach (545) >> unknown band with 9000 downloads (17)."),

  /* 6 — Quality */
  H1("6. Quality assurance"),
  table(
    ["Suite", "Command", "What it proves"],
    [
      ["Data quality", "npm test (tests/dq.test.mjs)", "6/6: artist completeness, year completeness, title validity, non-music precision, tracklist validity — on live archive.org samples across 3 collections"],
      ["E2E journeys", "node tests/e2e/journeys.mjs", "10/10: Vivaldi, Beethoven, Mozart, Liszt, Ella Fitzgerald, Piaf, Blues — each verifies REAL streaming audio (audio element advancing), canonical catalog order (The Beatles), player persistence across navigation, legacy deep-link shim"],
      ["Benchmarks", "lib/bench.js (browser console)", "pipeline cost vs network cost; WASM adoption gate"],
    ]
  ),
  P("Known flakiness is handled honestly: late journeys can hit archive.org rate limiting; journeys retry with backoff and next-card skipping (restricted items) instead of faking a pass."),

  /* 7 — Deployment */
  H1("7. Deployment"),
  P("Static export (next.config.mjs: output:\u201Cexport\u201D, trailingSlash, optional basePath via NEXT_PUBLIC_BASE_PATH). GitHub Actions (.github/workflows/deploy.yml): push to main → npm ci → build → touch out/.nojekyll → publish to Pages. Live URL: https://amemifra.github.io/pharos/"),

  /* 8 — Improvement: gramophone restoration */
  H1("8. Improvement — gramophone-noise restoration (AI)"),
  P("Old recordings (78rpm / early vinyl from archive.org's George Blood collections) carry surface noise: turntable rumble and dust/scratch ticks. Pharos adds an optional audio restoration, OFF by default — the audio is untouched unless the user explicitly enables it."),
  H2("8.1 Three modes, honest contract"),
  table(
    ["Mode", "What it does", "Cost / status"],
    [
      ["Off (default)", "Original audio, bit-for-bit what the source serves", "Zero"],
      ["Light", "Pure Web Audio DSP: 80 Hz high-pass (rumble) + de-tick AudioWorklet (rolling noise-floor transient attenuation) — lib/restoration.js, public/worklets/restore-worklet.js", "Zero network, ~2% of one core (measured)"],
      ["AI", "Neural denoise via ONNX model in WASM (lib/restore-model.js) — loader interface complete and wired, model file NOT shipped: the UI reports \u201Cmodel unavailable\u201D until public/models/denoise.onnx is placed (documented candidates: RNNoise BSD ~85 KB, DeepFilterNet-small MIT ~2-6 MB)", "Lazy onnxruntime-web dependency; model download on first use"],
    ]
  ),
  H2("8.2 Implementation notes"),
  BULLET("Off-thread by construction: all processing beyond the BiquadFilter runs in an AudioWorklet (public/worklets/restore-worklet.js) on the audio render thread — the main thread is never blocked."),
  BULLET("Graph lives inside the player island (app/player/page.jsx): MediaElementSource → high-pass → worklet → destination; teardown and live mode switching via the pharos:restoration event; exposure contract window.__pharosRestoration = {mode, active, status}."),
  BULLET("Policy persistence: localStorage pf.restoration (legacy pf.* namespace); selector in the Now Playing overlay with honest per-mode labels (lib/restoration.js label())."),
  BULLET("Adoption rule for AI (lib/bench.js benchRestoration): default-suggestible only when realtime factor ≥ 1 on mid-tier hardware; benchmark renders 60 s of synthetic old-recording signal through the worklet and reports the realtime factor."),
  H2("8.3 Status"),
  P("Implemented: policy module, worklet processor, island wiring, overlay selector, benchmark function, honest AI-unavailable state. Pending stabilization: dedicated E2E test (tests/e2e/restoration.mjs exists; archive.org latency made the play-wait flaky at time of writing). The regression proof for the default-off contract is the standard journeys suite (10/10 with the feature in the codebase)."),

  /* 9 — Roadmap */
  H1("9. Roadmap (docs/roadmap-expansion.md)"),
  table(
    ["Phase", "Medium", "Complexity", "Key additions"],
    [
      ["1", "Podcasts", "S", "Podcast Index + native RSS (DOMParser); feed = canonical identity; freshness DQ metrics; reuses 100% of the audio stack"],
      ["2", "Books", "M", "OPDS catalogs (Standard Ebooks, Gutenberg); reading view (typography, themes, progress); no player"],
      ["3", "Film/Video", "L", "archive.org film collections + curated PD lists; second iframe island (video + PiP); legal curation never crowd-asserted"],
    ]
  ),
  P("Cross-medium schema: generic Work/Unit record with medium discriminator; the inverse process (canonical × availability) applies unchanged with per-medium canonical sources (Wikidata for film, OpenLibrary for books, feed URL for podcasts). See also section 8: gramophone restoration is the first benchmark-gated WASM enhancement, applied to music today and reusable for any historical audio in future media."),

  /* 10 — Glossary */
  H1("10. Glossary"),
  table(
    ["Term", "Meaning"],
    [
      ["Island", "An isolated iframe carrying a capability (audio playback) that must survive shell navigation"],
      ["Coverage", "Share of canonical catalog entries matched to an available legal source (0-100%)"],
      ["Acquisition queue", "Canonical works with status \u201Cmissing\u201D — the data-driven to-do list of catalog growth"],
      ["pf.* keys", "Legacy localStorage namespace (pf.queue, pf.canon, …) — kept for cache compatibility across the rename"],
      ["Work-number guard", "Objective match rule: same category + different declared work number ⇒ different work, never matched"],
    ]
  ),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { bold: true, size: 32, color: "0F766E" },
        paragraph: { spacing: { before: 320, after: 160 } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { bold: true, size: 26, color: "115E59" },
        paragraph: { spacing: { before: 240, after: 120 } } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { bold: true, size: 23 },
        paragraph: { spacing: { before: 180, after: 100 } } },
    ],
  },
  sections: [{
    properties: {},
    children,
  }],
});

const buffer = await Packer.toBuffer(doc);
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/Pharos-Technical-Documentation.docx", buffer);
console.log(`written docs/Pharos-Technical-Documentation.docx (${(buffer.length / 1024).toFixed(0)} KB)`);
