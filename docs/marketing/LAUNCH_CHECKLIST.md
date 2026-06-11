# QQueue Launch Checklist

Public-launch preparation for QQueue as a **feature-complete self-hosted beta
candidate**. Keep messaging honest: open-source, self-hosted, SMTP-based email
infrastructure with campaigns + transactional email — not a finished cloud
platform. Items marked **⚠ blocker** are open in [STATUS.md](../STATUS.md) and
should be resolved before a serious public/commercial launch.

---

## Landing page

- [ ] Hero communicates: open-source, self-hosted, email infrastructure,
      campaigns + transactional email.
- [ ] CTAs present: **View on GitHub**, **Read Docs**, **Join Beta**.
- [ ] Feature claims match reality — SMTP providers only, **no "automations"**,
      no provider-native API integrations implied.
- [ ] Open-core distinction clear: AGPL-3.0 core vs proprietary QQueue Cloud
      (and Cloud described as planned, not available).
- [ ] Beta status shown honestly (verification suite + smoke tests passing,
      Docker deployment available, beta users wanted).
- [ ] "Who it's for" covers Mailcow operators, self-hosters, SaaS founders,
      indie hackers, agencies.
- [ ] SEO + OpenGraph/Twitter metadata accurate (title, description, OG image).
- [ ] Responsive on mobile; light and dark themes verified.
- [ ] All documentation links resolve (no placeholder anchors).

## Documentation

- [ ] Reachable and linked from the site: [Quickstart](../QUICKSTART.md),
      [First Email](../FIRST_EMAIL.md), [First Campaign](../FIRST_CAMPAIGN.md),
      [SMTP Provider Guide](../SMTP_PROVIDER_GUIDE.md),
      [Mailcow Setup](../MAILCOW_SETUP.md),
      [Transactional API](../TRANSACTIONAL_API.md), [Deploy](../DEPLOY.md),
      [Troubleshooting](../TROUBLESHOOTING.md), [FAQ](../FAQ.md).
- [ ] Legal/licensing reachable: [Licensing](../LICENSING.md),
      [Cloud Boundary](../CLOUD_BOUNDARY.md),
      [Terms](../legal/TERMS_OF_SERVICE.md),
      [Privacy](../legal/PRIVACY_POLICY.md), [Trademark](../../TRADEMARK.md).
- [ ] Project status reachable: [Roadmap](../ROADMAP.md), [Status](../STATUS.md).
- [ ] First-user-experience gaps reviewed
      ([FIRST_USER_EXPERIENCE.md](../FIRST_USER_EXPERIENCE.md)).

## GitHub release

- [ ] Repository made public with an accurate, current [README](../../README.md).
- [ ] `LICENSE`, `NOTICE.md`, `TRADEMARK.md`, `CLA.md`, `CONTRIBUTING.md` present.
- [ ] Tagged release with a changelog / release notes.
- [ ] Issue + PR templates added; CONTRIBUTING explains the CLA requirement.
- [ ] Coverage badges current; CI green on `main`.
- [ ] A known-good commit pinned and recorded for self-hosters to deploy.

## Pre-launch verification

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` pass.
- [ ] `pnpm test` passes (full suite).
- [ ] `pnpm test:smoke:docker` passes (register → SMTP → transactional send →
      worker → `SENT`).
- [ ] `pnpm license:audit` and `pnpm cloud:boundary` pass.
- [ ] **⚠ blocker:** Production `docker-compose.prod.yml` verified from a clean
      checkout on a fresh host (open in STATUS).
- [ ] **⚠ blocker:** Qualified legal counsel review of the commercial license,
      Terms of Service, Privacy Policy, CLA, and dependency-license output
      (open in STATUS) before commercial use.

## Demo video

- [ ] Record an ~8-minute walkthrough using [DEMO_SCRIPT.md](../DEMO_SCRIPT.md):
      sign-up → SMTP connection → transactional send → campaign → queue
      operations → open-core boundary.
- [ ] Show real inbox delivery and the analytics view.
- [ ] Embed on the landing page and link from the README.

## Beta signup & feedback

- [ ] "Join Beta" CTA points to a working intake (form / mailing list / repo
      discussion).
- [ ] A feedback channel exists (GitHub Discussions / issues / email).
- [ ] Issue triage process and labels ready for first reports.
- [ ] A lightweight way to collect first-install reports (what worked, what
      broke) — feeds back into [FIRST_USER_EXPERIENCE.md](../FIRST_USER_EXPERIENCE.md).

## Community outreach

- [ ] Announcement post emphasizing "own your email infrastructure" + open-core.
- [ ] Share in relevant communities: self-hosting (r/selfhosted), Mailcow
      community, indie hackers, SaaS-founder groups.
- [ ] Show HN / Hacker News post prepared.
- [ ] Submit to open-source and dev newsletters/awesome-lists.
- [ ] Prepare honest talking points: feature-complete self-hosted **beta**,
      SMTP-based, AGPL core with a planned managed cloud.

---

When the two blockers are cleared and every box is checked, pin the release
commit and announce.
