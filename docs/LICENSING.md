# Licensing Overview

This page is a human-readable summary of QQueue's licensing structure. It is not
legal advice. Have qualified legal counsel review the license files and this
summary before relying on them for a commercial launch.

## Positioning

QQueue is an open-core email platform built for teams that want the flexibility
of self-hosting and the convenience of managed email infrastructure.

The QQueue Core platform is open source and licensed under AGPL-3.0. It
provides the building blocks for email delivery, campaigns, transactional
messaging, queues, workers, templates, contacts, and SMTP integrations.

QQueue Cloud extends the core platform with managed services and advanced
operational tooling, including billing, subscription management, deliverability
monitoring, abuse prevention, reputation management, usage controls, analytics,
and hosted infrastructure.

QQueue is built with self-hosted infrastructure and Mailcow operators in mind,
but can also be used by teams that want a fully managed hosted email platform.

## QQueue Core

QQueue Core is open source under the GNU Affero General Public License version
3.0 (`AGPL-3.0-only`). The root [LICENSE](../LICENSE) file contains the AGPL-3.0
text.

Core includes the self-hosted platform pieces such as auth basics,
organizations, SMTP connections, contacts, templates, campaigns, transactional
email APIs, queues, workers, and shared schemas/types, unless a file or
directory says otherwise.

Contributors should understand that contributions to AGPL core remain under
AGPL-3.0 unless another license is explicitly stated.

## QQueue Cloud

QQueue Cloud is proprietary commercial software. Copyright (C) 2026 Nana
Aboagye. All rights reserved. Code under `apps/cloud/` is not covered by the
root AGPL-3.0 grant and is governed by
[apps/cloud/LICENSE](../apps/cloud/LICENSE).

Commercial self-hosted customers need an active commercial license or explicit
written permission to use proprietary cloud features. Hosted cloud customers use
QQueue under separate commercial SaaS terms.

## SDKs

SDKs may be permissively licensed under MIT where their package metadata and
license files say so. For example, `packages/sdk` is intended to be distributed
under MIT.

## Documentation

Documentation may be licensed under Creative Commons Attribution 4.0
International (`CC-BY-4.0`) where stated. If documentation or asset licensing is
split out later, keep the applicable notice close to the files it covers.

## Trademarks

QQueue branding is not covered by the software license. The QQueue name, logo,
wordmark, branding, and related marks are trademarks of Nana Aboagye Boateng. See
[TRADEMARK.md](../TRADEMARK.md).

## Practical Summary

- QQueue Core: AGPL-3.0, self-hostable, open source.
- QQueue Cloud: proprietary/commercial, managed hosting and advanced operations.
- SDKs: MIT licensed for easy adoption where package-specific notices say so.
- Docs: CC-BY-4.0 where documentation-specific notices say so.
- Branding: QQueue name, logo, and marks are protected by trademark terms.
