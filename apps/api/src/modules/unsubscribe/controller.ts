import type { Request, Response } from "express";
import { verifyUnsubscribeToken } from "@qqueue/email-engine";
import { env } from "../../config/env.js";
import { unsubscribeService } from "./service.js";

function confirmationPage(email: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unsubscribed</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #1f2937; }
      .card { border: 1px solid #e5e7eb; border-radius: 0.75rem; padding: 2rem; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>You're unsubscribed</h1>
      <p><strong>${email}</strong> has been removed and will no longer receive these emails.</p>
    </div>
  </body>
</html>`;
}

export const unsubscribeController = {
  // Browser GET from clicking the List-Unsubscribe link: record and show a page.
  async get(req: Request, res: Response) {
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
    res.status(200).send(confirmationPage(payload.e));
  },

  // RFC 8058 one-click POST issued automatically by the mail client. No page.
  async post(req: Request, res: Response) {
    const token =
      typeof req.query.token === "string" ? req.query.token : undefined;
    const payload = token
      ? verifyUnsubscribeToken(token, env.TRACKING_SECRET)
      : null;

    if (!payload?.o || !payload?.e) {
      res.status(400).json({ error: { message: "Invalid unsubscribe link" } });
      return;
    }

    await unsubscribeService.unsubscribe(payload.o, payload.e);
    res.status(200).json({ data: { unsubscribed: true } });
  }
};
