# Dependency License Audit

QQueue uses `pnpm licenses list --json` plus
`scripts/check-dependency-licenses.mjs` to keep dependency licenses visible
before Phase 7 cloud code is added.

Run:

```sh
pnpm license:audit
```

## Policy

The audit passes only when every dependency license token is in the reviewed
allow-list in `scripts/check-dependency-licenses.mjs`.

The allow-list is intentionally conservative and should be changed only with a
short review note in the pull request. The script currently blocks direct use of
GPL, LGPL, and AGPL dependency licenses so the AGPL core and future proprietary
cloud package do not accidentally inherit dependency obligations that need
separate legal review.

## Current Reviewed License Set

- `0BSD`
- `Apache-2.0`
- `BlueOak-1.0.0`
- `BSD-2-Clause`
- `BSD-3-Clause`
- `CC-BY-4.0`
- `ISC`
- `MIT`
- `MIT-0`
- `MPL-2.0`
- `PostgreSQL`
- `Python-2.0`

## Review Notes

- `CC-BY-4.0` currently appears through data-style packages such as browser
  compatibility data, not application source copied into QQueue.
- `Python-2.0` currently appears through a transitive utility package.
- `BlueOak-1.0.0` currently appears through transitive tooling packages.

## Licenses Requiring Review

- `CC-BY-4.0`
- `Python-2.0`
- `BlueOak-1.0.0`
- `MIT-0`

Guidance:

- `MIT-0` is permissive and generally acceptable.
- `BlueOak-1.0.0` is permissive and generally acceptable.
- `Python-2.0` is generally commercial-friendly, but confirm attribution and
  notice obligations.
- `CC-BY-4.0` requires attribution and should be checked carefully, especially
  if it applies to assets, docs, fonts, or runtime-distributed files.
- If `CC-BY-4.0` applies only to docs or assets, document attribution
  requirements near those docs or assets.
- If `CC-BY-4.0` appears in runtime code, flag it for manual review before
  release.

Before a production managed-cloud release, have qualified legal counsel review
the dependency license output and the commercial license terms together.
