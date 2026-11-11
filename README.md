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

The browser bundle `public/collab.js` is a generated artifact (`npm run collab:build`, esbuild from `lib/collab.js`) and is **not committed** to the repository; build it locally or at deploy time.

`lib/collab.js` starts an in-page Helia+OrbitDB node on demand. Shared benchmark
metrics (`shareMetrics`) feed the JS vs WASM decision with real data gathered
from every user's device — no backend involved. Sharing is explicit: the node
starts only when the user requests it, and stops with `stopCollab()` to save
battery.

## Where errors are recorded

Errors of the central journeys (search, album/artist, player, podcasts, books)
are written as **one JSON line per error on the server's stdout**, prefixed by
`"pharos":"error"` — the stream your host's log viewer shows. No third-party
tracker, no new dependency.

- **Server errors** — `instrumentation.js` (`onRequestError`) records every
  failing route/page with name, message, truncated stack, method, path (no
  query) and build.
- **Browser errors** — `window.onerror`, `unhandledrejection` and the
  `app/error.jsx` / `app/global-error.jsx` boundaries POST a bounded report
  (`lib/errorReporter.js`) to `/api/client-errors/`, which re-validates,
  redacts and logs it (`lib/errorlog.js`). No cookies, IPs, query strings or
  e-mail-like strings are logged; body ≤ 8 KiB, 20 reports/min per client.

Recording needs the Node server build (the default GitHub Pages export is
static and has no server to write a log — there the reporter stays off):

```bash
npm run build:server
npm run start:server 2>&1 | tee pharos.log   # errors appear here
grep '"pharos":"error"' pharos.log           # only recorded errors
```

On a host, open its runtime log view (`docker logs <c>`, `journalctl -u
pharos`, DigitalOcean App Platform → Runtime Logs) and filter on
`"pharos":"error"`. To prove recording works, start with
`PHAROS_ERROR_DRILL=1` and request `/api/error-drill/` (deliberate 500; 404
without the flag) — one `"source":"server"` line appears. A browser drill is
`curl -X POST -H 'Content-Type: application/json' -d
'{"kind":"error","message":"drill"}' http://localhost:3000/api/client-errors/`.

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

## Security notes

- `public/collab.js` is a generated esbuild bundle (`npm run collab:build` from
  `lib/collab.js` + vendored crypto dependencies). It is intentionally not
  committed — build it at deploy time. The bundle embeds PEM header *string
  literals* from key-handling code in the vendored dependencies; these are
  false positives, not key material.
- `publishCanon` (`lib/popularity.js`) writes to OrbitDB only when the caller
  supplies an `opts.authorize()` callback that returns true; without it the
  call throws `unauthorized` (fail-closed, CWE-306). See
  `tests/canon.publish.test.mjs`.
- Weak-crypto / client-trust / CORS advisory findings reported by scanners are
  inherited from the benchmark/R&D prototype surface and are tracked for V2.
