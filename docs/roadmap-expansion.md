# Pharos — Expansion Roadmap: Podcasts, Film/Video, Books

**Status:** PLAN ONLY (spec document; no code changes in this task)
**Scope:** extending Pharos from music-only to a public/legal media
entrypoint covering podcasts, film/video, and books — same principles, same
layered architecture, same collective P2P data work, one simple UX entrypoint.

---

## 0. PRINCIPLES (inherited, non-negotiable — referenced throughout)

Every decision below follows the rules the music MVP already established:

1. **Browser-only, zero servers** — free static hosting (GitHub Pages today);
   collaboration runs P2P via Helia/OrbitDB in-page (`lib/collab.js`,
   `lib/catalogstore.js` — lazy-loaded, local-first, write-through).
2. **Numbers govern** — objective quality signals only; DQ test suites with
   thresholds (`tests/dq.test.mjs` discipline); bench harness
   (`lib/bench.js`) decides WASM vs JS, never intuition.
3. **Inverse process** — start from the canonical catalog, cross-reference
   availability, publish coverage + acquisition queue (`lib/discography.js`
   pattern: `crossReference()` via `lib/catalogstore.js` `catalogMemo`).
4. **Honest unknowns > confident lies** — "not aligned", "temporarily
   unreachable", "missing" states are explicit; restricted/lending items are
   excluded at source (`-access-restricted-item:true` in `lib/archive.js`).
5. **JSDoc agent-grade English; low-end phones first-class; WASM only when
   benchmarks justify** (`lib/formatpolicy.js` decision-table pattern).

---

## 1. SOURCES PER MEDIUM (legal/public only, concrete)

### 1.1 Podcasts
| Source | Mechanics | Rate limits | Canonical counterpart |
|---|---|---|---|
| **Podcast Index Project** (podcastindex.org) — open API, no gatekeeping, free API key | REST: `/api/v1/podcasts/trending`, `/search/byterm`, `/episodes/byfeedid`; returns feed URLs + iTunes-style metadata | Generous (10 req/s with free key) | The feed URL itself IS the canonical ID (it is the open standard); Podcast Index `podcastGuid` (a hash of feed URL) as stable key |
| **Public RSS feeds** — the open web standard, permissionless | Parse RSS/Atom in browser via `DOMParser` (native, zero deps); `<enclosure>` gives the media URL | None (it's the open web) | Feed URL = canonical identity |
| **Internet Archive** — `podcasts` collection | Same `lib/archive.js` adapter as music | Already handled | archive.org identifier |

**License reality:** podcast RSS is published for public distribution by
definition; the Podcast Index only indexes openly accessible feeds. Edge case:
feeds with private/premium enclosures must be detected (401/403 on enclosure
HEAD) and excluded — same guard as `access_restricted_item`.

### 1.2 Film / Video
| Source | Mechanics | Rate limits | Canonical counterpart |
|---|---|---|---|
| **Internet Archive film collections** — `feature_films`, `film_noir`, `moviesandfilms`, `prelinger` | Same `lib/archive.js` adapter (mediatype:movies) | Already handled | archive.org identifier; **Wikidata item** (P4947 = IMDb-free authority via Wikidata) as canonical |
| **Wikipedia public-domain film lists** (e.g. "List of American films in the public domain") | Curated lists → build-time JSON snapshots (NOT runtime HTML scraping — keep the client light) | None (build-time) | Wikidata Q-id |
| **PeerTube instances** (joinpeertube.org registry) + **SepiaSearch** (sepiasearch.org API) | Public REST APIs per instance: `/api/v1/search/videos`, `/api/v1/video-channels/{id}/videos`; SepiaSearch aggregates instances | Per-instance, generally generous; instance registry is itself open data | ActivityPub video URL = identity; channel handle = canonical |
| **NASA/Smithsonian/federal archives** | Public-domain film APIs (images.nasa.gov API is open) | Generous | archive.org or native IDs |

**License reality:** hardest medium. Public-domain determination for film
requires publication-date + renewal checks (US copyright renewal records are
digitized but messy). Policy: only ingest from collections that have already
made the PD determination (archive.org curators, Prelinger); never ingest from
generic search. The acquisition queue only ever proposes, humans confirm PD.

### 1.3 Books
| Source | Mechanics | Rate limits | Canonical counterpart |
|---|---|---|---|
| **Project Gutenberg** (gutenberg.org) — plain HTML/EPUB/txt, mirror-friendly | `https://gutendex.com/` (open JSON catalog API, no key, paginated); files at `www.gutenberg.org/files/{id}/` | Generous; gutendex is a free public service | Gutenberg ID; **OpenLibrary work key** (`/works/OL…W`) as canonical |
| **Standard Ebooks** — manually proofed PD classics, OPDS feed | OPDS catalog at `standardebooks.org/feeds` (standard ATOM; parse with DOMParser like RSS) | Generous | Gutenberg ID underlying; OpenLibrary |
| **Wikisource** — public-domain texts in many languages | MediaWiki API (`wikisource.org/w/api.php`, same family as `lib/notability.js`) | Generous | Wikidata Q-id |
| **LibriVox** — public-domain audiobooks | Open API: `librivox.org/api/feed/audiobooks?title=…` returns JSON w/ RSS zip of chapters | Generous | Gutenberg ID + OpenLibrary |
| **OpenLibrary** (openlibrary.org) — catalog + limited lending | Open APIs: `openlibrary.org/search.json`, covers at `covers.openlibrary.org`; **lending collection EXCLUDED** like music restricted items (borrow requires login → same 401 class) | Generous (politeness policy documented) | **OpenLibrary work key = THE canonical book identity**; ISBN is edition-level |

**License reality:** cleanest medium — Gutenberg/Standard Ebooks/LibriVox are
PD by construction. OpenLibrary lending items excluded at source (same
`-access-restricted-item` pattern: OpenLibrary exposes `borrowable` flags).

---

## 2. ARCHITECTURE: the layered design generalizes unchanged

The music MVP's layer contracts stay; each new medium adds **adapters and
normalizers**, never forks the layers.

### 2.1 Source registry (`lib/sources.js`)
Current `Source` typedef (`search/normalize/metadata`) gains a `medium`
discriminator field: `"music" | "podcast" | "film" | "book"`. One adapter per
source/medium, registered in the same `SOURCES` array; `getSource(id)`
unchanged. UI filter by medium = filter by adapter field.

### 2.2 Generic Work schema (`lib/pipeline.js`)
The `Album/Track` pair generalizes to a **`Work`** record with a medium
discriminator (same pipeline philosophy: raw → aggregable record, synchronous
pure functions):

```
Work {
  id, medium: "music"|"podcast"|"film"|"book",
  title, creator[], year, quality (0–4, same scoring),
  cover, downloads, restricted (excluded-at-source flag),
  units: Unit[]        // was Track[] — the playable/readable parts
}
Unit {
  id, title, url, format, duration?, number,
  starts?[]            // compound-unit offsets (lib/tracklist.js pattern)
}
```
Media-specific fields live in typed extensions (JSDoc, no runtime cost):
- **podcast:** `feedUrl`, `episodes` (units are episodes; TTL-bound, see §3)
- **film:** `runtime`, `director[]`, `cast[]` (units = files/versions, format
  policy already handles multi-quality variants)
- **book:** `author`, `isbn[]`, `chapters` (units = chapters/HTML files;
  "playing" = reading — no audio pipeline needed)

Existing music normalizers stay untouched and become the `medium: "music"`
implementation — no regression risk.

### 2.3 Inverse process per medium (`lib/discography.js` pattern)
`crossReference()` is medium-generic already in shape: canonical catalog ×
availability → coverage + acquisition queue. Per medium, the canonical source
swaps:
- **music:** MusicBrainz release-groups (today)
- **podcast:** no "discography" — canonical = the feed itself; coverage metric
  instead = feed freshness + enclosure liveness (a DQ metric, not a catalog one)
- **film:** Wikidata Q-id (P4947 for film series/works) × archive.org/PeerTube
  availability; Wikipedia PD lists = the acquisition queue for film
- **book:** OpenLibrary work key × Gutenberg/Standard Ebooks/LibriVox
  availability; coverage = "canonical work has at least one readable edition"

All published to the same catalogstore namespace pattern (§3).

### 2.4 Quality layer: DQ suites per medium
`tests/dq.test.mjs` generalizes to `tests/dq.podcast.mjs`,
`tests/dq.film.mjs`, `tests/dq.book.mjs` — same threshold discipline:
- podcast: enclosure liveness %, feed-parse success %, episode-title junk %
- film: PD-determination provenance % (which source asserted PD), runtime
  sanity, false-match rate (work-number guard generalizes to year+title)
- book: chapter completeness vs Gutenberg TOC, encoding sanity (UTF-8), author
  completeness %
- notability: `lib/notability.js` works as-is — Wikidata sitelinks/pageviews
  cover films, books, and authors natively (it was designed for Wikipedia).

### 2.5 Popularity (`lib/popularity.js`)
Same formula (W_SITELINKS/W_PAGEVIEWS/W_RECORDINGS + fallback CANON table per
medium — e.g. Dante, Cervantes, Hitchcock-class canon seeded like Mozart is).
The CANON table pattern repeats per medium with community-editable overrides
via OrbitDB (`publishCanon()` already exists).

---

## 3. ORBITDB PUBLIC DATABASE — the collective-work layer

Namespace extension of `lib/catalogstore.js` keys (single source of truth):

```
crossref:music:<artist>       (today: crossref:<artist> — keep + alias)
crossref:film:<wikidataQid>   → canonical works × availability snapshot
crossref:book:<openlibraryId> → editions × readable-availability
epfeed:<podcastGuid>          → episode list snapshot, TTL 24–48h
                                (feeds change; stale episodes are worse than
                                 refetch — the ONLY short-TTL namespace)
ident:<unitId>                → community identifications (same as today)
weights:ranker                → per-medium: weights:ranker:music, :podcast, …
artistimg:<name>              → today; generalize to img:<workId>
canon:<medium>                → per-medium importance tables
```

**Governance of shared curation** (who fixes what, with what consensus):
- **Factual data** (durations, years, author/director names, feed URLs):
  one peer publishes, any peer can overwrite; last-writer-wins per key, and
  the DQ suite is the referee ( objectively measurable).
- **Editorial data** (quality flags, "misattributed", "abridged edition"):
  votes with ≥2-peer consensus, exactly the `canonicalByCommunity()` pattern
  (`lib/canonical.js`) — a single vote never flips state.
- **PD assertions for film**: NEVER crowd-asserted. Only ingested from
  curated collections that did the legal determination; the community can flag
  suspects into a review namespace (`pd:flag:<id>`), not out of it.
- Storage discipline: episode feeds carry TTL and cap (last 500 episodes);
  crossrefs are small JSON; total per-peer OrbitDB footprint target < 50 MB
  (low-end phones first — measure with `lib/bench.js`).

---

## 4. UX ENTRYPOINT — simple by pattern analysis

Following `docs/ux-architecture.md` method: analyze, select, justify.

**Unified search vs medium separation:**
- YouTube pattern: one search box, **medium filter chips** under it — wins
  because users think "I want Dracula", not "search the books corpus".
- Spotify pattern (separate surfaces per type) — rejected: multiplies
  navigation cost, and our shelves already segment discovery.
- **Decision: unified search + medium chips + medium-aware TopResultCard**
  (the card already exists: `components/TopResultCard.jsx` gains a medium
  badge and medium-specific primary action: Play / Watch / Read).

**Home information architecture:**
- Medium switcher as segmented control at the top of Home (Music | Podcasts |
  Film | Books) — default remembers last used (localStorage); NOT separate
  routes per medium (keeps one URL space, one library, one ranking).
- Shelves remain per-medium under the switcher (`lib/catalog.js` SHELVES gains
  a `medium` field; same ShelfRow component, zero new UI primitives).

**Player behavior per medium — iframe budget discipline (≤2 iframes):**
- **Audio island stays THE audio island**: music, podcasts, and LibriVox
  audiobooks play through the existing `/player` island unchanged — a podcast
  episode is just a Unit with a URL. This is the payoff of the generic schema.
- **Film needs a second island** (`/video-player`): `<video>` + fullscreen +
  Picture-in-Picture APIs don't share an `<audio>` element cleanly; PiP
  requires a visible video element. Spec: second sandboxed iframe, same
  `pf.*` message contract (typed extension: `pf.video.state` with position);
  while the video island is alive the audio island pauses (one playback
  focus at a time — same rule Spotify applies between devices).
- **Books: no player** — a reading view (React page, no iframe): chapter
  navigation, font-size persistence, progress = chapter+scroll. The "queue"
  concept becomes a reading list (localStorage `pf.reading`).
- Consequence for the deferred search/rank WASM island: with video island
  alive, the 2-iframe budget is spent → **search/rank island is now formally
  deferred until benchmarks justify swapping it in place of something else**.

---

## 5. ROLLOUT (each phase ships with the app working + tests green)

| Phase | Deliverable | New tests | New DQ metrics | Complexity |
|---|---|---|---|---|
| **P1 — Podcasts** | RSS/DOMParser feed adapter (`lib/sources.js`), `Work.medium="podcast"`, Podcast Index search adapter, episode units through the existing audio island, `epfeed:` namespace with TTL, subscription list (localStorage) | `tests/dq.podcast.mjs`; e2e journey "subscribe + play episode, survives navigation" | enclosure liveness %, feed-parse success %, stale-episode rate | **S** — RSS parsing is native DOMParser, the player island already plays arbitrary URLs; the only new state is subscriptions |
| **P2 — Books** | gutendex + Standard Ebooks OPDS adapters, OpenLibrary canonical crossref, reading view (chapter nav, progress), reading list, `crossref:book:` namespace | `tests/dq.book.mjs`; e2e journey "search Dracula → open → read → progress persists" | chapter completeness %, encoding sanity, author completeness % | **M** — no media pipeline at all; the reading view is genuinely new UI (the only real build item) |
| **P3 — Film** | archive.org movies adapter (mediatype:movies, PD-curated collections only), Wikidata canonical crossref (P4947), video player island with PiP + `pf.video.*` contract, PeerTube/SepiaSearch adapter (optional, last) | `tests/dq.film.mjs`; e2e journeys "play PD feature film", "PiP survives navigation" | PD-provenance % (100% required — every item must trace to a curated PD source), runtime sanity, false-match rate | **L** — video pipeline + second island + hardest legal domain; only started after P1/P2 DQ metrics are stable |
| **P4 — Collective maturity** | `weights:ranker:<medium>` consensus live, cross-medium popularity leaderboard, warm-up loop extended per medium (`lib/catalogwarm.js` pattern) | bench for OrbitDB footprint budget (<50 MB) | coverage-per-medium KPI on the P2P badge | **M** — pure extension of existing namespaces |

Sequencing rationale: podcasts reuse 100% of the audio stack (trivial
ingestion, existing player); books need zero media pipeline (new UI only);
film is the only phase requiring new player infrastructure and carries the
hardest legal domain, so it goes last with the most mature DQ discipline.

---

## 6. RISKS

1. **Legal — film PD determination** is strictly harder than music: renewal
   research, derivative-work chains, international differences. Mitigation:
   curated-PD-sources-only policy (§1.2), community flags go to a review
   namespace, never auto-publish. The "legal and accessible" promise is the
   product; one wrong film poisons it.
2. **Catalog quality asymmetry**: OpenLibrary is crowd-built (quality varies
   by work); ISBN is edition-level, not work-level — the canonical layer must
   be work-keyed, and editions are variants (the same trick as MB
   release-groups). Books by obscure authors may lack OpenLibrary entries →
   honest "canonical: unknown" state, no invented identity.
3. **Episode-feed storage in OrbitDB**: feeds mutate constantly; naive caching
   bloats peers. Mitigation: short-TTL namespace (`epfeed:` 24–48h), capped
   episode lists, feed URL as key (dedup by guid), footprint budget enforced
   by bench.
4. **UI complexity creep** — the existential risk of a "simple entrypoint".
   Mitigations already in place: medium switcher is a segmented control, not
   routes; the generic Work/Unit schema keeps search/library/ranking shared;
   per-medium surfaces appear ONLY where behavior truly differs (reading
   view, video island). Rule from the spec: any new screen must name which
   existing pattern it instantiates, or it doesn't get built.
5. **Rate limits at expansion scale**: gutendex/archive.org/PeerTube are
   generous, but the multi-medium warm-up multiplies traffic. Mitigation: the
   `lib/mbgate.js` priority-queue pattern generalizes to a per-source gate;
   cache-first is already the default everywhere (`lib/catalogstore.js`).
6. **Video bandwidth on low-end phones**: format policy (`lib/formatpolicy.js`)
   gains a video decision table, but real 240p/480p selection depends on
   source-provided transcodes — PeerTube handles this natively, archive.org
   partially; honest unavailable-state when no suitable derivative exists.
