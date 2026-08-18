# Changelog

All notable changes to `qqueue-sdk` are documented here.

## 0.2.0 - 2026-08-18

- Add `attachments` to `sendEmail`: small base64 attachments carried on the
  send body, with an optional `cid` for inline display (`cid:` references in
  the HTML render in place, even with remote images blocked). Capped at 256 KB
  decoded each, 10 per send; requires a QQueue API running this version or
  later.
- Add an options argument to `sendEmail` with `idempotencyKey`, sent as the
  `Idempotency-Key` header so caller-side retries return the original job
  instead of sending a second copy.
- Expose a `default` export condition so CommonJS consumers can `require()`
  the package (Node 20.19+/22.12+, which support require of ESM). Previously
  the exports map only answered `import`, making the SDK unresolvable from
  CJS codebases.

## 0.1.2 - 2026-06-11

- Add package release checklist with version bump, publish, tag, and install
  smoke test steps.
- Include `CHANGELOG.md` and `RELEASE.md` in the published package.
- Document the SDK release workflow from the README.

## 0.1.1 - 2026-06-11

- Return stable transactional send responses as `{ id, status }`.
- Surface machine-readable API error codes on `QQueueError.code`.
- Keep compatibility with older self-hosted API responses that returned
  `data.emailJob`.

## 0.1.0 - 2026-06-10

- Initial SDK scaffold with `QQueueClient.sendEmail`.
