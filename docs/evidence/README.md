# Evidence receipts

Screenshots captured by the R1 (specops-closure r1-20260923A) task probes, committed so the
passobuild board can reference them over https (the evidence gate refuses non-https refs).

- `mb-rate-limit-banner-limited.png` — the truthful MusicBrainz rate-limit banner rendered above the
  splash overlay while the provider is limiting (429 + Retry-After), captured by
  `gate.browser-probe.mjs` against the merged banner UI (PR #20, commit 498edf8eb lineage).
- `mb-rate-limit-banner-cleared.png` — the same page after the provider's 200 cleared the state
  (banner detached from the DOM — the honest silence state).
- p01 update-notice captures (if present): `notice-appears-once.png`, `notice-not-again-after-reload.png`
  — the non-looping update notice states, captured by `tests/e2e/pwa-update-notice.mjs`.
