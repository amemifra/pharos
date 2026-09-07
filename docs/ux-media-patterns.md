# Pharos — Media UX Patterns: Podcasts, Film/Video, Books

**Status:** research document (companion to `docs/ux-architecture.md` and `docs/roadmap-expansion.md`; no code changes)
**Scope:** how PODCASTS, FILM/VIDEO and BOOKS should look and behave, extracting the best concrete patterns from market leaders.
**Our constraints (referenced as "constraints" in every verdict):** no accounts (localStorage + P2P only), browser-only, low-end phones first-class, 100% legal public catalog (lending/restricted excluded at source), local-first data, honest unknowns.
**Note on sources:** patterns are from the products as shipped by the named vendors (Apple Podcasts, Spotify, Overcast, Pocket Casts, Netflix, YouTube, Plex/Jellyfin, MUBI, Kindle, Google Play Books, Standard Ebooks, Project Gutenberg, Libby). No invented features.

---

## 1. PODCASTS

### 1.1 Pattern table

| Pattern | Product(s) that do it best | Why it wins | Verdict for Pharos |
|---|---|---|---|
| **Show page = reverse-chronological episode list** with date prominent | Apple Podcasts, Pocket Casts | Podcasts are episodic: date IS the sort key users expect; album-style "track order" would be wrong | **Adopt.** Episode list sorted by pubDate desc; date shown on every row. Zero cost, feeds give it for free. |
| **Played / unplayed state on episodes** (dot / filled artwork) | Pocket Casts (best-in-class filters), Apple Podcasts | Episodic content accumulates; users need "what's new" at a glance | **Adapt.** Local-only state in localStorage keyed by enclosure GUID; no sync server. P2P later via `ident:`-style namespace. |
| **Per-show AND per-playback settings** (speed persists per show, global override) | Overcast (per-podcast speed), Pocket Casts (global + per-show) | Speech content tolerates 1.5–2×; users set once per show and forget | **Adopt.** `playbackRate` on the island `<audio>`; per-show default in localStorage, global in settings. Native `playbackRate`, zero deps. |
| **Silence trimming / dynamic boost** | Overcast (Smart Speed) | Genuinely saves 10–20% listening time; signature feature | **Reject (for now).** Requires decoded-audio DSP (WASM island territory); record as phase-4 candidate behind `lib/bench.js`. Honest "not yet" beats slow playback. |
| **Up Next queue for episodic content** with "play next episode of show" affordance | Pocket Casts (queue as core mental model), Apple Podcasts | Binge-listening is the primary podcast behavior; queue ≠ playlist (it drains) | **Adopt.** Reuse the existing queue island contract (`pf.load`/`pf.command`); add "play all unplayed from this show" as the podcast analog of "play album". |
| **Chapter markers on the scrubber** | Overcast, Pocket Casts, Apple Podcasts (podcasting 2.0 chapters) | Long episodes (2–3h) are unnavigable without chapters | **Adapt.** We ALREADY have the exact machinery for compound tracks with `starts[]` offsets (`lib/tracklist.js`) — chapters are the same data shape. Parse `<podcast:chapters>` JSON when present; show sub-ticks on the scrubber + a chapter title line. |
| **Transcript display** | Apple Podcasts (transcripts, iOS 18), podcasting-2.0 `<podcast:transcript>` | Accessibility + skimmability; some feeds ship SRT/VTT free | **Adopt when the feed provides it.** `<podcast:transcript>` tags are plain URLs (often .vtt/.srt/.html) — render with native `<track>` for WebVTT or a simple text pane. Never fabricate transcripts. |
| **Subscribe = follow the feed** (not "save to playlist") | All leaders; Pocket Casts models it best | The feed is the canonical identity (our `roadmap-expansion.md` §1.1); subscribing = watching the feed URL | **Adopt.** "Subscribe" stores feed URL + show metadata locally; Library tab gains "Shows" chip; episode refresh = re-parse RSS on demand (manual refresh only, no background polling on low-end). |
| **Release-date prominence on cards** ("2 days ago" not "2024-01-01") | Apple Podcasts | Recency is the #1 relevance signal for episodic media | **Adopt.** Relative time formatting via `Intl.RelativeTimeFormat` (native). |
| **Artwork-lead show cards** (square, no text overlay) | Spotify, Pocket Casts | Show art is the identity; cleaner grids | **Adopt.** Reuse `AlbumCard` square-art grid as-is. |

### 1.2 The 5 non-negotiables
1. Reverse-chronological episode list with visible dates.
2. Per-show playback speed (native `playbackRate`).
3. Played/unplayed state (local).
4. Up Next queue semantics (drains, doesn't loop) — reuse island queue.
5. Subscribe = store the feed URL, refresh on demand, never re-fetch in background.

### 1.3 Anti-patterns to avoid
- **Auto-download / background refresh** (Apple, Pocket Casts) — battery + storage killers on low-end phones; we are on-demand only.
- **"Up next for you" algorithmic episode injection** (Spotify inserts recommended episodes into queues) — engagement trap; our queue only contains what the user added.
- **Premium-subscription upsell walls mid-catalog** (Spotify) — everything here is already free/legal.
- **Binge nudges** ("You're 4 episodes behind!") — we state state, never push guilt.

---

## 2. FILM / VIDEO

### 2.1 Pattern table

| Pattern | Product(s) that do it best | Why it wins | Verdict for Pharos |
|---|---|---|---|
| **Browse rows on home, deep grid on catalog pages** | Netflix (rows), Criterion Channel (grid) | Rows sell a big catalog; a curated legal catalog like ours is *small enough to grid* | **Adapt.** Home = shelf rows (already built); film "genre pages" = dense poster grid with filter chips (decade/genre) — Criterion's model fits a PD catalog better than Netflix's rows. |
| **Runtime · year · director shown on every card/detail** | MUBI, Criterion Channel | For catalog browsing, metadata IS the content: users choose by era/director | **Adopt.** `Work` record gains director/runtime; card subtitle line. Canonical source = Wikidata (per roadmap). |
| **Resume + per-item progress bar** (thin bar at card bottom, "Continue watching" row) | Netflix, Plex/Jellyfin (Plex does it with zero account pressure) | The single most valued video feature; we have all machinery (island `<video>` + localStorage position) | **Adopt.** `pf.vprogress:<id>` in localStorage; "Continue watching" shelf on Home; island video element persists exactly like audio. |
| **Trailer-first** (play trailer before detail) | Netflix, MUBI | Low commitment discovery | **Reject.** PD films rarely have separate trailer files; adds a second media pipeline for marginal value. Detail page + 30s preview-if-exists is enough (phase 4+). |
| **Subtitle / audio-track selection via native controls** | Plex (excellent track picker), YouTube | Accessibility is non-negotiable; browsers expose tracks natively | **Adopt.** `<track>` elements from archive.org subtitle files (many PD films have .srt/.vtt); native `<video>` menu + our own picker for audio when multiple files exist. Zero custom player code. |
| **Picture-in-Picture for video navigation** | YouTube (PiP on browse), Safari/Chrome native | Video must survive navigation like our audio island | **Adopt.** Second island (`video`) with native `requestPictureInPicture()` — matches the roadmap's second-island budget; PiP is native, no JS cost. |
| **Quality badge on the player + per-quality choice** ("HD", "4K", bitrate) | Netflix (auto + manual), Plex (quality menu with bitrate numbers) | Our format-variant policy (`lib/formatpolicy.js`) already models this for audio | **Adapt.** Same three modes (Best/Auto/Manual) reusing `formatpolicy` decision table extended with video bitrates; badge shows actual resolution served (e.g. "640×480 · h.264") — honest, since PD rips are often SD. |
| **Collection/curated pages as first-class** | Criterion Channel (collections), MUBI (series) | Curation fits a legal catalog: "Prelinger Essentials", "Film Noir 40s" are exactly our shelves | **Adopt.** Shelves generalize to `film` medium; collection page = canonical list (Wikidata/wikipedia-snapshot) × availability, same inverse process. |
| **Continue-watching shelf before everything** | Netflix, Plex | Returning users' #1 action | **Adopt.** Top shelf on Home when local progress exists (music analog already shipped via `pf.recent`). |
| **"Leave off at exact second" cross-page** | Plex | Trust = resume never lies | **Adopt.** Island saves position every 5s (`timeupdate` throttle), restores with a "Resume from 12:34 / Start over" choice — explicit, honest. |

### 2.2 The 5 non-negotiables
1. Resume with per-item progress bar (card + "Continue watching" shelf).
2. Subtitles via native `<track>` when the source provides them.
3. Runtime/year/director visible on every card.
4. PiP so navigation never kills playback (island symmetry with audio).
5. Poster-grid catalog pages with decade/genre chips (Criterion model).

### 2.3 Anti-patterns to avoid
- **Autoplay-next-episode** (Netflix) — the canonical engagement trap; we stop when the film ends. Full stop.
- **Skip-intro/skip-recap auto-prompts** (Netflix) — only ethical where chapters/metadata provably mark them; default off, never auto-skip.
- **Infinite scroll of posters with infinite "because you watched"** — our catalogs are finite and curated; grids paginate honestly.
- **Countdown-to-removal urgency banners** — nothing expires here; urgency is manufactured scarcity and we have none.
- **Auto-playing trailers with sound on browse** (Netflix previews) — data + attention cost on low-end; silent hover-previews only on desktop if ever.

---

## 3. BOOKS

### 3.1 Pattern table

| Pattern | Product(s) that do it best | Why it wins | Verdict for Pharos |
|---|---|---|---|
| **Typography controls: size, font (serif/sans), margins, line height** | Google Play Books (best granularity), Kindle (good defaults) | The #1 reason people abandon web readers; CSS custom properties, zero JS libs | **Adopt.** Reading view = one `<article>` + 4 CSS variables persisted in localStorage; include a real serif (Georgia/Charter) and justified/ragged toggle. |
| **Reading themes: light / sepia / dark** | Kindle, Google Play Books, Standard Ebooks | Sepia for long sessions; dark for night; must be reading-surface-only, not whole-app | **Adopt.** `pf.readtheme` local; applies to the reading surface only (shell keeps its zinc dark theme). |
| **Progress as "page X of Y" AND percent AND time-left** | Kindle (location+page), Google Play Books (percent) | Different readers trust different units; locations are Kindle-proprietary | **Adopt percent + chapter + time-left** (scroll-based estimate via `IntersectionObserver` on chapter headings); no fake "page" numbers — honest units only. |
| **Chapter navigation (TOC drawer)** | All leaders; Standard Ebooks (cleanest TOC) | Epub/PB chapter structure is free navigation | **Adopt.** Books ingest as per-chapter HTML (Gutenberg splits by chapter markers) → TOC = same data shape as tracklist; reuse the `starts[]` pattern conceptually. |
| **Bookmarks & highlights, local only** | Google Play Books (exportable), Kindle (locked) | Expected by readers; P2P makes it collective later | **Adopt (local first).** `pf.marks:<bookId>`: `{chapter, offsetPct, textSnippet, note}` — no accounts, exportable JSON button. P2P sync follows the `ident:` consensus pattern (phase 2). |
| **Dictionary lookup on text selection** | Kindle (best), Google Play Books | Selection→define is native browser behavior | **Adapt.** On selection: floating "Look up" → Wiktionary REST API (open, no key, CORS-friendly); never a proprietary dictionary blob. |
| **OPDS catalog browsing** (paged catalog feeds of a library) | Standard Ebooks (immaculate OPDS), Project Gutenberg | OPDS is the open standard for book catalogs — the RSS of books | **Adopt.** OPDS feeds parse with the same `DOMParser` machinery as podcast RSS (roadmap §1.3); catalog pages mirror the "canonical feed × availability" inverse process. |
| **Cover-grid library with "Continue reading" first** | Libby (continue reading shelf), Google Play Books | Visual recall beats text lists for books | **Adopt.** Same cover-grid as albums (reuse `AlbumCard` shape with aspect-ratio 2:3 variant); "Continue reading" shelf = local progress. |
| **Search inside the book** | Google Play Books, Kindle | Expected for reference reading | **Adapt (phase 2).** Client-side `String.indexOf` over the already-fetched chapter HTML is trivial for one book; no index infra needed. |
| **Reading position sync across devices** | Kindle (accounts) | Genuine value but requires identity | **Reject for now** → **Adapt via P2P**: position in OrbitDB under user's peer ID; no accounts, best-effort continuity between own devices sharing a peer identity file. |

### 3.2 The 5 non-negotiables
1. Typography controls (size/font/margins/theme incl. sepia), persisted.
2. Chapter navigation from the canonical structure (TOC).
3. Progress in honest units (percent + chapter + time-left), restored on return.
4. Cover-grid library + "Continue reading" shelf.
5. OPDS-based catalog ingestion (the open standard — no scraping).

### 3.3 Anti-patterns to avoid
- **Kindle-style page/location walled garden** (proprietary location numbers, non-exportable highlights) — we use open units and exportable data.
- **Libby-style lending holds, queues and "borrow expires in 3 days"** — we EXCLUDE lending by policy (roadmap §0/§1.3); any countdown UI is banned by principle.
- **"Reading streaks" / gamification** (some reading apps) — reading is not a habit-product to farm.
- **Paywall-per-word or per-chapter upsells** — everything is public domain.
- **Forced accounts to save progress** — local first, P2P second, never an account wall.

---

## 4. Cross-medium consistency with the existing music UX

These rules keep one product instead of four stitched ones:

| Rule | Detail | Origin |
|---|---|---|
| **One search, medium chips** | Single search box; chips = Music / Podcasts / Film / Books (YouTube Music pattern already chosen in `ux-architecture.md` #7). Medium chips are client-side filters on the ranked results; the ranker's feature set gains a `medium` match dimension. | YT Music chips |
| **Same card grammar** | Every medium's card = artwork (aspect varies: 1:1 music/podcast, 2:3 film/book) + title + person-line (artist/director/author) + year + availability badge. One component family, four data shapes. | Spotify card grammar |
| **Canonical-first pages everywhere** | Artist page → show page, film page, book page: hero + canonical metadata + coverage stat + availability split + raw items collapsed. The inverse process is THE page template for all media. | Our own `CatalogCoverage` pattern |
| **Honest availability language is medium-agnostic** | "Available", "Missing (acquisition queue)", "Restricted — excluded", "Not aligned" appear with identical styling across media. | Our honesty rule |
| **One player bar, medium-aware** | Audio (music/podcast/audiobook) reuses the existing island; film gets the second island; book shows a slim "reading" bar (chapter + progress) instead of a player. The miniplayer never shows two media at once — opening one medium's surface closes the other's (explicit user model, avoids split attention). | YT Music miniplayer discipline |
| **Shelves are medium-scoped but visually identical** | Home rows stay horizontal scroll rows; medium chips on Home filter which shelves render. No separate "Movies home page". | YT Music Explore model |
| **Local-first state everywhere** | played/read/watched, position, speed, theme, marks — all `localStorage` namespaced `pf.*`, same as music. P2P sharing follows the same consensus namespaces. | Our architecture |
| **No engagement mechanics, period** | No autoplay-next, no streaks, no "because you watched", no urgency. The cross-medium promise: we are an entrypoint to public culture, not a retention machine. | Anti-pattern §1.3/§2.3/§3.3 |

---

## 5. Sequencing note (ties to `roadmap-expansion.md` rollout)

- Podcasts reuse the audio island + queue + speed + chapters machinery: the pattern table above is nearly all **Adopt** with tiny adaptations.
- Film's second island + PiP consumes the whole remaining iframe budget: this is why the roadmap defers it last, and why search/rank island stays formally deferred (conflict documented in `ux-architecture.md` §3.3).
- Books need no player island at all (reading view is a shell surface), making them the cheapest post-podcast phase despite being a new interaction paradigm.
