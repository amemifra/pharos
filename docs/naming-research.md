# Naming Research — product name strategy

**Status:** research document (no code changes). Input context: README.md, docs/roadmap-expansion.md, docs/ux-architecture.md.
**Product reality to name:** a browser-only, serverless, P2P-catalog entrypoint to PUBLIC/LEGAL culture — music today, podcasts/films/books next. No accounts, no engagement traps, no servers. The catalog is built collectively (OrbitDB) from objective, community-accepted sources.

---

## 1. Verdict on "Pharos"

**Recommendation: rename.**

What works: "Public" is honest and load-bearing (public domain, public catalog, public infrastructure). Two words, lowercase-friendly, pronounceable in EN and IT.

What does not:

- **FLAC is a codec, and a contested one even inside audio.** The name asserts a technical implementation detail, not a value proposition. Most users do not know what FLAC is; those who do will expect lossless-only — which the app does not guarantee (VBR MP3 is the pragmatic default, FLAC is the premium variant).
- **It locks the medium.** docs/roadmap-expansion.md commits to podcasts, films, books. "Pharos" for a book is nonsense; a rename after the expansion lands is 10× more expensive than now (P2P namespaces, published catalog keys, shared ranker weights all carry the brand).
- **Collision-adjacent branding:** FLAC is a trademarked format name (Xiph.Org). Using it inside a product name invites pointless legal friction at zero benefit.
- It reads as a developer tool, not a culture entrypoint — wrong register for the "perfect UX entrypoint" ambition.

The honest salvage: keep "public" as the semantic core; drop the codec.

---

## 2. Candidates — 14 names, 4 directions

### Direction A — commons / heritage roots
1. **Resonance** — shared vibration; but generic, heavily used in audio products.
2. **Aurora** — dawn of open culture; feminine noun, soft. Risk: saturated (Aurora is an Aurora PostgreSQL, many startups).
3. **Res Publica** — "the public thing": exactly the legal/public principle. Too long, political flavor varies by language.
4. **Commons** — the cultural commons (Lessig line). Very on-point; likely collision with Wikimedia Commons associations (arguably a feature, not a bug).

### Direction B — library / archival metaphors
5. **Arkiv** — archive with Scandinavian spelling: archival + distinct. "Arkie-v" pronunciation friction in EN.
6. **Stacks** — the library stacks: warm, familiar, evocative of browsing shelves. Slightly tech-slang (memory stacks).
7. **Codex** — the bound manuscript: culture, preservation, medium-agnostic (a codex holds anything). Slight gaming collision (Warhammer 40k codexes) but weak.
8. **Vellum** — the durable writing surface: precious, archival, uncommon as a product name. Feels "written" more than "played".

### Direction C — light metaphors (illumination, not media format)
9. **Lantern** — the reader's lamp: guiding light into public collections. Strong, simple, pronounceable everywhere. Collision: Lantern (censorship-circumvention tool) — real but distant domain.
10. **Lumen** — light unit: short, latin, clean. Collisions: Lumen (PHP micro-framework) — real developer collision.
11. **Pharos** — the lighthouse of Alexandria: beacons you to what's publicly available. Distinctive, medium-agnostic, no obvious consumer collision.

### Direction D — culture verbs / access gestures
12. **Browse** — the anti-algorithm gesture. Too generic, impossible to trademark.
13. **Hear/Read/Watch triad** — not a name but a pattern; rejected as name, noted as UI copy.
14. **Shelf** — where public culture lives; one syllable, warm, medium-agnostic (a shelf holds records, books, reels). Minimal collision risk. Verb-able: "shelf it".

---

## 3. Top 6 — collision and language analysis

| Name | EN/IT pronounce | Meaning pitfalls | Real collisions | Domains | Trademark distance |
|---|---|---|---|---|---|
| **Lantern** | excellent both | none known; "lanterna" = flashlight in IT (neutral) | Lantern (anti-censorship proxy); Lantern Corps (DC) — distant markets | lantern.app "to verify", getlantern.* taken | Far from Spotify/Apple/Audible registers |
| **Pharos** | good; "FAH-ros" EN / "FAH-ros" IT | none; lighthouse of Alexandria is a shared-culture symbol | Pharos (testnet/chain products exist); Alexandria research project | pharos.fm "to verify" | Distinct; no media giant uses it |
| **Codex** | excellent | none negative | Codex (OpenAI models naming); Warhammer; Codex Alimentarius | codex.* crowded, getcodex.app "to verify" | Distinct |
| **Stacks** | excellent | "stacks" in tech slang; IT "stack" neutral | Stacks (blockchain, STX) — real crypto collision | stacks.fm "to verify" | Distinct |
| **Shelf** | excellent | none; "scaffale" IT, same warm register | Shelf (small SaaS tools exist) | shelf.fm / shelf.culture "to verify" | Very distinct from Spotify/Apple/Audible |
| **Arkiv** | good; IT risk "ar-chìv" vs "àrkiv" | none | Arkiv (Nordic music services exist regionally) | arkiv.fm "to verify" | Distinct |

Domain strategy note: exact .com is neither required nor realistic in 2026; a distinctive suffix (.fm for music-first, .culture, .commons, .library) communicates the mission better and is verifiable at registration time. All domains above are marked **to verify** — this document does not assert availability.

---

## 4. Recommendation — 1 primary + 2 backups

**Primary: Shelf** (or "Shelf Commons" as full formal name)
Taglines:
- EN: *"The public shelf of human culture — music, film, books. No account, no algorithms."*
- IT: *"Lo scaffale pubblico della cultura — musica, film, libri. Nessun account, nessun algoritmo."*
Wordmark: lowercase **shelf**, two-tone — "sh" in zinc (archive grey), "elf"… no: better **"shelf"** all-lowercase with the **"e" replaced by an open-book/reel glyph** or a two-tone split (shelf = zinc-400, secondary word "public" as small-caps prefix: `public/shelf`). The slash encodes the public-path identity and doubles as the breadcrumb glyph already in the UI.

**Backup 1: Lantern** — if the crypto/proxy collision is judged too close at registration time.
Taglines: EN *"A lantern into the public archive."* / IT *"Una lanterna nell'archivio pubblico."*

**Backup 2: Pharos** — the most distinctive and ownable; slightly more "brand effort" to explain.
Taglines: EN *"The lighthouse of public culture."* / IT *"Il faro della cultura pubblica."*

---

## 5. Migration cost — honest estimate

A rename touches (grep-verified surface):

- **UI strings + branding:** ~6 files (layout.jsx metadata, AppShell wordmark, README, footer). Mechanical: 1–2 h.
- **Persistence namespaces:** every `pf.*` localStorage key (`pf.queue`, `pf.ranker`, `pf.canon`, `pf.bench`, `pf.notability.*`, `pf.store.*`, `pf.lbtoken`, ~15 keys) — a migration shim (read old → write new, one release) or accept cache loss: **accepting cache loss is fine for pre-launch** (0 real users): 30 min.
- **P2P namespaces:** OrbitDB store keys are data, not code (`crossref:`, `ident:`, `rg:` — brand-neutral, **no change needed**). Only the OrbitDB *database name* `publicflac-metrics` and gossip topic `publicflac-metrics/1` carry the brand → renaming orphans existing peer discovery; pre-launch this is free (recreate stores). Post-launch it requires a namespace-version bump (`/2` topic): 2–4 h including migration logic.
- **Repo/package:** package.json name, repo name (GitHub redirect works automatically), Pages URL changes (re-deploy with new basePath): 1 h.
- **Tests:** E2E selectors reference aria-labels and routes, not the brand: ~0.

**Total pre-launch cost: half a day.** Post-launch: a day plus community coordination. This is precisely why the decision must happen before the Pages release ships the current name into URLs and user browsers.
