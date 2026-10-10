# Local security backports

## braces 3.0.3 backport (GHSA-vfj7-8cjw-p6xm)

`braces-3.0.3.tgz` is the local backport for the `braces@3.0.3`
stack-exhaustion finding (advisory **GHSA-vfj7-8cjw-p6xm**).

- Source change: `braces-3.0.3.patch`, relative to npm braces 3.0.3.
- Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- SHA256: `1b7b379abca9aba1dcd3e6eaab732925826da10507e4854c011b18e69498ef56`
- Changes vs stock 3.0.3: a fixed, non-configurable AST depth budget (`lib/depth-guard.js`, MAX_DEPTH 128) enforced in `lib/parse.js` (paren and curly push), and checked in `lib/compile.js`, `lib/expand.js`, and `lib/stringify.js`. Rejections throw `SyntaxError` with `code = 'BRACES_MAX_DEPTH'`.
- Package name and version remain `braces@3.0.3`; **this is a local backport, not an upstream release. Upstream 3.0.3 is NOT a fixed version and no upstream fixed version exists at the time of writing.** Same-version is not proof of fix.
- Installed as a direct dependency `braces: file:vendor/security-backports/braces-3.0.3.tgz` with override `braces: $braces` so every transitive consumer (e.g. micromatch) resolves the backported package too.
- Regression test: `tests/braces-expansion-limit.cjs`, chained into `npm test`.

## node-forge 1.4.0 — GHSA-86w9-cpqp-85rv

Advisory: GHSA-86w9-cpqp-85rv (RSASSA-PKCS1-v1_5 signature verification accepts
malformed `DigestInfo`: DigestAlgorithm SEQUENCE with extra elements or a NULL
parameter carrying non-empty content). The advisory affects node-forge <= 1.4.0
and, as of this write-up, **no upstream release fixes it** — no patched version
is claimed here.

Remediation is a **local backport**: the vendored archive
`vendor/security-backports/node-forge-1.4.0.tgz` contains an rsa.js that
enforces the DigestAlgorithm element count and an empty/absent NULL parameter.

- Archive SHA-256:
  `0d439ec5baf6289d8027664d092267a800191930ec162ce866545da7eb94e700`
- Base: npm node-forge 1.4.0 source. The local change is recorded in
  `node-forge-1.4.0.patch`; archive bytes are pinned above.
- Advisory: https://github.com/advisories/GHSA-86w9-cpqp-85rv
- Installed as a direct local dependency, with override `"node-forge": "$node-forge"`
  so acme-client resolves the same backported package. The lockfile pins its integrity.
- Regression test: `tests/forge-digest-algorithm.cjs` (chained into `npm test`).

