# Browser runtime observations

The SDK is inert unless `NEXT_PUBLIC_PASSO_TELEMETRY_URL` explicitly names the
HTTPS collector origin. Build identity is a full Git commit, not the display
version. The deployment's normal build supplies the collector configuration;
never patch an already frozen artifact.

## Build and release protocol

1. Freeze the new source commit through the canonical release path. Preserve the
   previously deployed artifact; this source change requires a new release.
2. Configure the actual deployment build with:

   ```sh
   NEXT_PUBLIC_PASSO_TELEMETRY_URL=https://staging-api.pyxcloud.io npm run build
   ```

   `next.config.mjs` derives `NEXT_PUBLIC_PASSO_SOURCE_COMMIT` from Git HEAD.
   Archive builds without Git must receive the canonical full 40-character SHA
   through that environment variable. A value that disagrees with Git HEAD fails
   the build. Do not use a branch name, short SHA or previous release's identity.
3. The browser sends a public, credential-free config request containing only
   protocol version and source commit. The backend resolves its Origin against
   the current canonical deployment and returns an expiring signed append-only
   descriptor. Neither a secret nor a user/session credential is baked in.
4. Only that collector origin's fixed `/vibe/runtime/events` path is accepted.
   The config and telemetry requests omit cookies and referrers. The collector
   verifies descriptor scope, current release, request Origin and payload bounds.
5. Inspect the Browser runtime source in Observability after the new release
   actually serves this SDK. Compilation is not evidence of received telemetry.

## Recorded signals

- Document navigation timing and same-document history transitions to the next
  rendered frame. These are browser measurements, not synthetic server spans.
- First contentful paint and the final observed largest-contentful-paint
  candidate when the document is hidden or first interacted with.
- Duration, verb and actual HTTP status for same-origin `fetch` only. Rejected
  requests carry a network-error flag and no invented HTTP status.
- Actual browser `PerformanceEventTiming` durations for click/submit/keyboard
  interactions when supported. Text inputs and editable targets are excluded.
  No key, target identity or text is recorded.
- Unhandled JavaScript error class and numeric source position, or a fixed
  `UnhandledRejection` classification. Message, stack, filename and rejection
  payload are never read into an event.

There is no URL/path/query, request/response body, header, user ID, session ID,
DOM text or persistent identifier in an event. Third-party requests are not
measured and no trace headers are inserted into any request. Trace/span IDs are
random in-memory correlation IDs, without cookies or localStorage. Browser
Do Not Track and Global Privacy Control opt-outs are respected.

## Bounds and failure behavior

- At most 120 observations per minute, queue of 128, event size at most 1024 bytes.
- Signed descriptor limits are capped at 32 events and 64 KiB per batch.
- Flush every ten seconds and on page hide; stale events older than five minutes
  are dropped. There is no replay when acknowledgement is unknown.
- Individual network reads are bounded; bootstrap retries at most five times
  with backoff. A descriptor is refreshed before expiry and cannot authorize
  events for a different frozen source commit.
- Expired/unavailable configuration stops recording. Unsupported performance
  observers produce no fabricated samples. Invalid or excessive durations are
  discarded, not clamped to a false measurement.
- Cleanup removes listeners, restores owned fetch/history wrappers, disconnects
  observers, cancels frames/timers and aborts SDK requests on unmount.

STOP on source mismatch, unsigned/unavailable config, unexpected collector origin
or path, or missing canonical deployment. Do not hardcode a descriptor, infer
successful ingestion from local buffering, capture richer payloads, or claim a
browser observation is an authoritative deployment/security gate.
