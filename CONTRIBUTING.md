# Contributing to QQueue

Thanks for your interest in improving QQueue! This document explains how to
contribute and the legal terms that apply to contributions.

## License & Contributor License Agreement (CLA)

QQueue is released under the [GNU Affero General Public License v3.0](LICENSE)
and follows an **open-core** model: the core is AGPL-licensed, and some
managed-cloud features will be offered under a separate commercial license.

To keep this model viable, **all contributors must agree to the
[Contributor License Agreement (CLA.md)](CLA.md) before their contributions can
be merged.** The CLA lets the project use your contribution in both the
AGPL-licensed core and the commercial offering, while you retain copyright in
your work.

### How to sign

Until automated CLA tooling is in place, sign by adding a `Signed-off-by` line
to every commit, certifying that you have read and agree to `CLA.md`:

```sh
git commit -s -m "your message"
```

This adds:

```
Signed-off-by: Your Name <your.email@example.com>
```

By signing off, you certify that you have read and accept the terms in
[CLA.md](CLA.md) for that contribution.

## Development setup

See the [Local Development](README.md#local-development) section of the README
for environment setup. In short:

```sh
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:generate
pnpm dev
```

## Before opening a pull request

- `pnpm lint` — lint passes
- `pnpm typecheck` — no type errors
- `pnpm format` — formatting applied
- Keep changes focused; one logical change per PR where possible.
- Reference any related issue in the PR description.

## Coding conventions

- TypeScript across API, web, and worker.
- Validate inputs with Zod at the boundaries.
- Match the style and structure of the surrounding code.
- New source files should carry the SPDX header (see below).

### SPDX header

Add this to the top of new source files:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) QQueue contributors
```

## Reporting bugs and requesting features

Open an issue with a clear description, reproduction steps, and the expected vs.
actual behavior. For security issues, please do **not** open a public issue —
contact the maintainers privately.
