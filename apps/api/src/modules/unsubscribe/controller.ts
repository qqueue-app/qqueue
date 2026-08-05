import type { Request, Response } from "express";
import { verifyUnsubscribeToken } from "@qqueue/email-engine";
import { env } from "../../config/env.js";
import { unsubscribeService } from "./service.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #1f2937; }
      .card { border: 1px solid #e5e7eb; border-radius: 0.75rem; padding: 2rem; }
      button { background: #2e7d63; color: #fff; border: 0; border-radius: 0.5rem; padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
      button:hover { opacity: 0.9; }
    </style>
  </head>
  <body>
    <div class="card">${body}</div>
  </body>
</html>`;
}

function confirmPage(email: string, token: string): string {
  return page(
    "Unsubscribe",
    `<h1>Unsubscribe</h1>
      <p>Stop sending emails to <strong>${escapeHtml(email)}</strong>?</p>
      <form method="POST" action="/api/v1/unsubscribe?token=${encodeURIComponent(token)}">
        <button type="submit">Unsubscribe</button>
      </form>`
  );
}

function donePage(email: string): string {
  return page(
    "Unsubscribed",
    `<h1>You're unsubscribed</h1>
      <p><strong>${escapeHtml(email)}</strong> has been removed and will no longer receive these emails.</p>`
  );
}

export const unsubscribeController = {
  /**
   * Browser GET from clicking the unsubscribe link. Deliberately does NOT
   * unsubscribe: mail clients and security scanners prefetch GET links, and a
   * mutating GET silently unsubscribed those recipients. This renders a
   * confirmation page whose button POSTs back with the same token.
   */
  async get(req: Request, res: Response) {
    const token =
      typeof req.query.token === "string" ? req.query.token : undefined;
    const payload = token
      ? verifyUnsubscribeToken(token, env.TRACKING_SECRET)
      : null;

    if (!token || !payload?.o || !payload?.e) {
      res.status(400).send("Invalid or expired unsubscribe link");
      return;
    }

    res.set("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(confirmPage(payload.e, token));
  },

  /**
   * The mutation. Reached two ways: the RFC 8058 one-click POST issued
   * automatically by the mail client (which ignores the response body), and
   * the confirmation page's form submit (which renders the response). Both
   * carry the signed token in the query string, so no request body is needed.
   */
  async post(req: Request, res: Response) {
    const token =
      typeof req.query.token === "string" ? req.query.token : undefined;
    const payload = token
      ? verifyUnsubscribeToken(token, env.TRACKING_SECRET)
      : null;

    if (!payload?.o || !payload?.e) {
      res.status(400).send("Invalid or expired unsubscribe link");
      return;
    }

    await unsubscribeService.unsubscribe(payload.o, payload.e);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(donePage(payload.e));
  }
};
