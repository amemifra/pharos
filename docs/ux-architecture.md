# Pharos — UX Architecture & Pattern Selection

**Status:** spec (no code changes in this task)
**Scope:** navigation/UX redesign informed by Spotify, Amazon Music, YouTube Music, Apple Music; plus the microfrontend (iframe islands + WASM) architecture requested by the owner.
**Hard constraints:** browser-only (no backend), legal public catalog only, low-end phone performance is a first-class requirement, all client-side, JSDoc-guided JS + Tailwind v4.

---

## TASK 1 — Pattern analysis of the four reference apps

### Spotify
| Surface | Pattern |
|---|---|
| Navigation | Desktop: 3-pane (nav sidebar / main scroll / right "Now Playing view" panel). Mobile: 5 bottom tabs (Home, Search, Your Library, Premium, Now-playing is NOT a tab). Sidebar collapses to icon rail on narrow desktop. |
| Library | Saved items unified in "Your Library" with **filter chips** (Playlists / Artists / Albums / Downloaded). Playlists are first-class citizens; albums/artists are "saved" (heart) rather than organized in folders. Sort/search inside library. |
| Player | Miniplayer bar (bottom) → tap artwork/title → **full-screen Now Playing** with swipe-down-to-dismiss (drag handle). Long-press/swipe up on miniplayer also opens it. Progress bar on top edge of miniplayer, doubles as scrubber. |
| Queue | "Next in queue" drawer inside Now Playing screen; "Add to queue" from any context menu; queue reordering by drag. |
| Search | Persistent **recent searches** (list below the focused search field), "Browse all" category tiles when query empty, top result card (big card: artist/track/album with Play button) + "Songs"/"Albums"/"Artists"/"Playlists" horizontal result sections, filter chips to restrict type. |
| Home | Personalized rows ("Good evening" grid → rows: Recommended, Recently played, Jump back in, New releases, charts), each row horizontally scrollable, section header links to dedicated pages. Context menus (⋯) on every card. |
| Now Playing screen | Large artwork, lyrics (Musixmatch), queue drawer, "Connect to a device" (we don't need), gradients extracted from artwork. |

### Amazon Music
| Surface | Pattern |
|---|---|
| Navigation | Desktop: left sidebar with strong **Library-first** hierarchy (Home, Browse, Recent searches, My Stuff). Mobile: bottom tabs (Home, Browse/Search, Library, Alexa/Recents). |
| Library | "My Stuff" splits **Playlists / Artists / Albums / Songs / Stations** as sub-pages with tabs — more file-explorer-like than Spotify's flat chips. |
| Player | Miniplayer consistent across pages; expands to full player. Emphasis on **podcast/bookmark continuity** (resume positions everywhere). |
| Queue | "Play queue" as a first-class page, not just a drawer. |
| Search | Recent searches with history chips, strong type-filter tabs (All / Songs / Albums / Artists / Playlists), "top result" banner. |
| Home | Editorial rows (Local/National/Global), "Stations for you", heavy use of mood/activity rows (focus, workout). |
| Now Playing | Artwork + lyrics (when licensed), up-next strip. |

### YouTube Music
| Surface | Pattern |
|---|---|
| Navigation | Mobile: 3 bottom tabs (**Home, Explore, Library**) + miniplayer — deliberately minimal. Desktop: left sidebar with Library sections. |
| Library | Tabs: Playlists / Albums / Songs / Artists / Subscriptions; "History" as a library entry (strong replay culture). |
| Player | Miniplayer with artwork-left layout; swipe down to collapse to a tiny pill; **full-screen player** with adjacent-track swipe (swipe left/right on artwork = next/prev). |
| Queue | Queue drawer + "Start radio" (infinite queue) — radio is core. |
| Search | **Type filter chips directly under the search box** (Songs, Videos, Albums, Artists, Playlists); top result card; "Searches related to…". |
| Home | Rows of shelf cards with **large quick-pick tiles on top** ("Listen again", "New releases", "Mixed for you"); Explore tab = moods & genres grid → mood page = intermixed rows. |
| Now Playing | Lyrics, queue, "related" tab (like/dislike trains recommendations). |

### Apple Music
| Surface | Pattern |
|---|---|
| Navigation | Mobile: bottom tabs (**Home, New, Radio, Library, Search**). Desktop/sidebar: consistent left rail with Library / Playlists / Radio. |
| Library | Strict sections (Recently Added, Artists, Albums, Songs) + playlists; "Library" always one tab away; **Downloaded** smart filter. |
| Player | Miniplayer → **tap to expand into full player with a card-stack animation**; swipe down on the scrubber area to dismiss; queue accessible from the expanded player. |
| Queue | "Playing Next" drawer; "Play Last"/"Play Next" as universal context actions. |
| Search | Split: input + recent searches; results grouped by Apple's **category cards** (Apple Music / Your Library / iTunes); "Search by lyrics" — not applicable to us. |
| Home | Editorial, human-curated rows (we mirror this with our *shelves*), "Made for You", station rows. |
| Now Playing | Lyrics (time-synced), up next, artwork-driven gradient. |

---

## TASK 2 — Pattern selection table

Legend: **[S]** Spotify, **[AM]** Amazon Music, **[YT]** YouTube Music, **[AP]** Apple Music.
"Our constraints": PWA-ish web app, no backend/zero servers, low-end phones, 100% legal public catalog (no radio algorithms, no licensed lyrics), archive.org as primary source.

| # | Pattern | Winner | Rationale for Pharos |
|---|---|---|---|
| 1 | Bottom tabs on mobile, sidebar on desktop | **[YT] 3 bottom tabs** + [S] desktop sidebar | Fewest tabs = least JS/CSS and cleanest mental model. We adopt: **Home, Search, Library**. Sidebar on ≥768px (already built in `AppShell`). |
| 2 | Library as saved items | **[S] flat + chips**, saved albums/artists | No folders = no state schema. Saved = `localStorage` + OrbitDB later. Chips filter Saved Albums / Artists / Playlists(future). |
| 3 | Playlists | [S] first-class, [AP] Play Next/Last | Phase 3. Universal actions "Play next / Play last" adopted from [AP] everywhere a track appears. |
| 4 | Miniplayer → full-screen progression | **[YT] expand/collapse with drag handle** + [S] progress-on-top-edge | Tap artwork = expand; swipe down/drag handle = collapse. Progress bar on the miniplayer's top edge doubles as scrubber (already partially built). |
| 5 | Queue model | **[AP] "Playing Next" drawer** + [AM] queue page later | A drawer from the expanded player (cheap) before a dedicated page (phase 3). Reordering postponed. |
| 6 | Search: recent searches | **[S] recent searches list** | Local-only, free, high perceived speed. `localStorage`, last 10, deduped. |
| 7 | Search: top result card | **[YT] top result card + chips** | Our data is messy; a big confident "Top result" card requires good ranking — we HAVE the ranker (`lib/ranker.js`). Chips (Albums / Artists) = cheap client-side filter. |
| 8 | Search: empty state | **[YT] Browse-all tiles** → our **[AP]-style curated shelves** | Our shelves (`lib/catalog.js`) ARE the browse grid. Search page shows genre tiles when idle. |
| 9 | Home model | **[S] rows**, [YT] quick-pick tiles on top | Keep: quick-pick "Popular artists" circle row (already built) + horizontal shelf rows. Add "Recently played" row (local history) in phase 2 — cheap, high value, no algorithms. |
| 10 | Now Playing screen | **[AP] expand with queue drawer** + [S] artwork gradient | Lyrics NOT applicable (public catalog, no licensed lyrics source). Queue drawer + large artwork + gradient. "Connect devices" skipped: no backend. |
| 11 | Radio/auto-queue | [YT] "Start radio" — **adapted**: "Play similar" fills queue with same-artist/same-shelf albums | We cannot do algorithmic radio, but "continue with more from this artist/shelf" is 100% transparent and legal. |
| 12 | History / replay | [YT] History as library entry | Local play history (already implicit in `lib/feedback.js`) → "Recently played" row + library tab in phase 2. |
| 13 | Gestures | [YT] swipe artwork = next/prev; **skip**: pull-to-refresh, swipe-to-add | Swipe-to-change-track is muscle memory and cheap (touch handlers on expanded player only). Pull-to-refresh adds nothing (no server sync). |
| 14 | Empty/error/loading states | **[S] skeletons in final layout** + [AM] explicit error rows with retry | Already have `SkeletonCard`/shimmer; unify via one `SurfaceState` component (see spec). |

**Explicitly rejected patterns:** algorithmic radio (not legal/transparent for us), podcasts/audiobooks split (out of scope), "Connect devices" (needs backend), lyrics (no legal source), premium upsells (obviously).

---

## TASK 3 — Pharos UX spec

### 3.1 Information architecture

**Routes (Next.js App Router):**

| Route | Component | Status |
|---|---|---|
| `/` | Home: search bar, Popular artists row, shelf rows, (new) Recently played row | exists, extend |
| `/search` | Dedicated search page: input + recent searches + type chips + top result card | **NEW** (extracted from home) |
| `/artist/[name]` | Artist hero + discography by decade + `CatalogCoverage` | exists, extend |
| `/album/[identifier]` | Album hero + tracklist + verify badges | exists, extend |
| `/library` | Saved albums/artists, play history | **NEW** |
| `/queue` | Full queue page (phase 3; drawer first) | NEW (phase 3) |

**Navigation components:**

| Component | File | Status |
|---|---|---|
| Shell (sidebar + bottom tabs) | `components/AppShell.jsx` | exists; tabs become Home / Search / Library |
| Player island host | `components/PlayerIsland.jsx` | **NEW** (iframe host, see 3.3) |
| MiniPlayer / ExpandedPlayer / QueueDrawer | inside player island | **NEW** |
| SurfaceState (loading/error/empty unified) | `components/SurfaceState.jsx` | **NEW** |
| TopResultCard | `components/TopResultCard.jsx` | **NEW** |
| RecentSearches | `components/RecentSearches.jsx` | **NEW** |
| FilterChips | `components/FilterChips.jsx` | **NEW** |
| ShelfRow / AlbumCard / SkeletonCard | existing | keep |

### 3.2 Mobile-first spec

**Bottom tabs (order fixed):**
1. **Home** (`/`) — shelves, popular artists, recently played
2. **Search** (`/search`) — the only page with keyboard focus on open
3. **Library** (`/library`) — saved + history

**Miniplayer (always visible when queue non-empty; sits above bottom tabs):**
- Top edge: 2px progress bar (scrub via drag on ≥md only; on mobile tap-to-seek only — dragging conflicts with the miniplayer tap target)
- Layout: artwork 48px | title/artist | play/pause + next. **Prev hidden on mobile** (screen space, low value) — present on desktop
- Tap on artwork/title area → `/now-playing` **expanded player** (full-screen route, so it's deep-linkable and shares the island's state via postMessage)

**Expanded player (`/now-playing`, route inside player island):**
- Large artwork (gradient from a fixed palette per shelf — no canvas color extraction on low-end phones; skip [S] dynamic gradients deliberately)
- Scrubber with elapsed/total
- Controls: prev / play-pause / next / **queue drawer handle** (opens bottom sheet with the current queue; tap track = jump)
- Swipe left/right on artwork = next/prev [YT]

**Gestures to implement:** swipe on expanded artwork (next/prev); drag-handle collapse/expand (expanded ↔ mini).
**Gestures to skip:** swipe-to-dismiss miniplayer (accidental-trigger risk), pull-to-refresh (no server), swipe-to-add-to-playlist (discoverability cost; use ⋯ menu).

**Empty / error / loading — unified via `SurfaceState`:**
- Loading: skeletons in final layout (existing pattern) — never spinners for content
- Empty (search with 0 results): message + "Browse genres" link to shelves
- Error: one-line message + inline "Retry" button (component takes `onRetry`)
- All three variants take the same slot, same min-height → no layout shift

### 3.3 Microfrontend architecture (owner requirement)

**Goal:** UI resilience + audio persistence + isolation for WASM-heavy modules, with a hard performance budget.

**Islands (iframe-isolated):**

| Island | Host file | Justification | Contains WASM? |
|---|---|---|---|
| **Player island** (mandatory) | `public/islands/player/index.html` — a tiny self-contained bundle | Audio persistence is guaranteed at the browser level: an iframe document never unmounts on SPA navigation, even if the shell's React tree is hot-reloaded or an error boundary resets. Also isolates `<audio>` + MediaSession handling. | No |
| **Search/rank island** (phase 2, conditional) | `public/islands/search/index.html` | Hosts the WASM ranker when benchmarks prove WASM wins (`lib/bench.js` criterion: `t_js_p95 > t_wasm_p95 + t_wasm_load`). Until then it stays in-shell — no island. | Yes (only when bench-justified) |
| **Fingerprint island** (phase 3) | `public/islands/fingerprint/index.html` | chromaprint WASM + AudioContext decode: memory spikes (decodeAudioData of 120s window). Isolating it caps the blast radius of OOM on low-end phones — if the island dies, the tab survives. | Yes |

**Hard budget: ≤ 2 live iframes** at any moment (player + at most one compute island). Search/catalog stays in the shell: iframes cost ~1 extra document + JS context each (~10–25MB on mid-range Android); routing, theme, accessibility and data fetching NEVER go into iframes (screen readers, focus management, and Next.js routing must remain in the host document).

**Contract — shell ↔ island, via `postMessage` (all messages validated with a `type` discriminator):**

```json
// shell → player island
{ "type": "pf.load",    "queue": [{ "id": "mbid-or-item/file.mp3", "title": "…", "artist": "…", "url": "https://archive.org/download/…" }], "index": 0 }
{ "type": "pf.command", "action": "play|pause|next|prev|seek|jump", "value": 37.5 }
{ "type": "pf.theme",   "accent": "#10b981" }

// player island → shell (throttled: timeupdate max 1/s)
{ "type": "pf.state", "playing": true, "index": 0, "progress": 37.5, "duration": 214.2 }
{ "type": "pf.ended", "index": 0 }
{ "type": "pf.ready", "version": 1 }
```

Rules: island never fetches metadata (shell owns all data); island never touches `localStorage` of the shell domain except its own namespaced key `pf.player.*`; handshake = island posts `pf.ready` on load, shell re-sends `pf.load` with current queue; shell keeps queue in React state (single source of truth) so the island is stateless and replaceable.

**Sandbox attrs:** `<iframe sandbox="allow-scripts" src="…">` — no `allow-same-origin` for the compute islands (strict isolation); the player island needs `allow-same-origin` only because `<audio>` streaming from archive.org is fine cross-origin without it — verify in phase 1; if CORS requires it, grant `allow-same-origin` **only to the player island** (it renders no untrusted content).

**Fallback:** if `postMessage`/sandbox unsupported (ancient browsers) → render the existing in-shell `PlayerProvider` + `NowPlayingBar` (current code) behind a feature check. The island is an enhancement, not a dependency.

### 3.4 What stays OUT of iframes (and why)

- **Routing** — Next.js owns the URL; iframes would break deep links, back/forward, and `<Link>` prefetching.
- **Data fetching + pipeline** (`lib/archive.js`, `lib/pipeline.js`, ranking pre-phase) — one fetch layer avoids duplicate network + cache logic; the pipeline is sync and cheap (measured).
- **Theme/a11y** — color tokens and `prefers-*` live in the shell document; islands receive the accent via `pf.theme` only.
- **Saved items / feedback** — single writer to `localStorage`/OrbitDB in the shell avoids write races.

---

## Rollout order (each phase leaves `npm run build` green and the app fully working)

1. **Phase 1 — Player island (biggest risk first).** Build `public/islands/player` (plain HTML+JS, no framework, <15KB), `PlayerIsland` host with `postMessage` contract + fallback to current `PlayerProvider`. Keep routes unchanged. Accept: navigation restarts nothing, E2E `journeys.mjs` still passes, heap delta ≤ +25MB on the test profile.
2. **Phase 2 — Search/Library split + micro-patterns.** Extract `/search` (recent searches, top result card, chips), add `/library` (saved + recently played from feedback queue), tabs become Home/Search/Library, unify states in `SurfaceState`, "Play next/last" context actions.
3. **Phase 3 — Expanded player + queue.** `/now-playing` expanded player inside the island, queue drawer, "Play similar" (same artist/shelf), swipe gestures.
4. **Phase 4 — WASM islands (data-driven only).** Move ranker/fingerprint into compute islands **only if** `lib/bench.js` on the low-end test device shows the WASM criterion is met; otherwise keep in shell. Catalog coverage (`CatalogCoverage`) promoted to a first-class browse surface ("Catalog gaps" page) if it survives evaluation.
