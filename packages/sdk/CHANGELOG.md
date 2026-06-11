# Changelog

All notable changes to `qqueue-sdk` are documented here.

## 0.1.1 - 2026-06-11

- Return stable transactional send responses as `{ id, status }`.
- Surface machine-readable API error codes on `QQueueError.code`.
- Keep compatibility with older self-hosted API responses that returned
  `data.emailJob`.

## 0.1.0 - 2026-06-10

- Initial SDK scaffold with `QQueueClient.sendEmail`.
