# Pharos

**A lighthouse for public culture** — points to what is publicly available.

Open-source entrypoint that turns the public music catalog of
[archive.org](https://archive.org) (and other legal free sources) into a
Spotify/YT-Music-like experience. Roadmap: podcasts, films, books — same
principles (`docs/roadmap-expansion.md`).

> History note: formerly codenamed **PublicFlac**; renamed before launch —
> the old name bound the product to one codec and one medium.

## Principles

1. **Browser-native tools only** — native fetch, `<audio>`, localStorage. WASM
   only where benchmarks justify it.
2. **The numbers govern** — the normalization pipeline is plain synchronous JS;
   `lib/bench.js` measures every stage on real data. WASM is introduced only if
   `t_js_p95 > t_wasm_p95 + t_wasm_load` on the target device (low-end).
3. **Pure synchronous pipeline** — dirty data → aggregable records (`Album`,
   `Track`) on the fly; contract in `lib/pipeline.js`, no hidden cost.
4. **Extensible catalog** — every legal source is an adapter in `lib/sources.js`
   with the same interface; the UI never changes.
5. **No servers** — the app deploys on static free hosting; collaboration
   (shared metrics, playlists) runs on Helia (IPFS WASM) + OrbitDB directly in
   the browser (`lib/collab.js`), peer-to-peer via gossipsub.
6. **Objective quality** — popularity from Wikimedia measures (sitelinks,
   pageviews, `lib/popularity.js`), metadata canonicalization cascading through
   MusicBrainz → community consensus → acoustic fingerprint (`lib/canonical.js`);
   DQ tests on real data (`npm test`).

## Development

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # DQ scorecard on real archive.org data
npm run e2e      # Playwright journeys: search → play → real audio check
```

## Benchmark

In the browser console (dev):

```js
const b = await import("/lib/bench.js");
await b.benchEndToEnd("netlabels");   // network vs compute
await b.benchAlbumPipeline(["id1","id2"]);
```

Results are saved to localStorage for cross-device comparisons.

## P2P collaboration (opt-in)

`lib/collab.js` starts an in-page Helia+OrbitDB node on demand. Shared benchmark
metrics (`shareMetrics`) feed the JS vs WASM decision with real data gathered
from every user's device — no backend involved. Sharing is explicit: the node
starts only when the user requests it, and stops with `stopCollab()` to save
battery.

## Stack

Next.js (App Router) · JavaScript with JSDoc · Tailwind v4 · Helia + OrbitDB (WASM, optional)

## Deploy (GitHub Pages)

Push to `main` → the GitHub Action (`.github/workflows/deploy.yml`) builds the
static export and deploys to:

    https://<user>.github.io/public-music-flac-wrapper/

The app is fully static (no server): routes are query-param based
(`/album?id=…`, `/artist?n=…`), legacy `#/artist/…` hash links are rewritten
on boot by the deep-link shim.

If the repository name differs from `public-music-flac-wrapper`, the workflow
already derives the base path from `github.event.repository.name` — nothing to
change. For local production preview:

    NEXT_PUBLIC_BASE_PATH=/public-music-flac-wrapper npm run build
    npx serve out
