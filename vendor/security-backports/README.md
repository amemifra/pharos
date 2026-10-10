# Local security backports

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

