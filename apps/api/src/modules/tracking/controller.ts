import type { Request, Response } from "express";
import {
  verifyTrackingToken,
  type ClickTokenPayload
} from "@qqueue/email-engine";
import { env } from "../../config/env.js";
import {
  TRACKING_PIXEL,
  trackingService,
  webhookEventSchema
} from "./service.js";

function sendPixel(res: Response) {
  res.set({
    "Content-Type": "image/gif",
    "Content-Length": String(TRACKING_PIXEL.length),
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0"
  });
  res.end(TRACKING_PIXEL);
}

export const trackingController = {
  // Always returns the pixel, even for a bad/forged token, so a mangled link
  // can never break image rendering in a recipient's mail client.
  async open(req: Request, res: Response) {
    const payload = verifyTrackingToken(
      String(req.params.token),
      env.TRACKING_SECRET
    );
    if (payload?.j) {
      await trackingService.recordOpen(payload.j).catch(() => undefined);
    }
    sendPixel(res);
  },

  async click(req: Request, res: Response) {
    const payload = verifyTrackingToken<ClickTokenPayload>(
      String(req.params.token),
      env.TRACKING_SECRET
    );

    // Only ever redirect to a destination we signed ourselves — this is what
    // prevents the endpoint from being abused as an open redirect.
    if (!payload?.u || !/^https?:\/\//i.test(payload.u)) {
      res.status(400).send("Invalid tracking link");
      return;
    }

    await trackingService.recordClick(payload.j, payload.u).catch(() => undefined);
    res.redirect(302, payload.u);
  },

  async webhook(req: Request, res: Response) {
    const secret = env.WEBHOOK_SECRET;
    const provided = req.get("x-webhook-secret");
    if (!secret || provided !== secret) {
      res.status(401).json({ error: { message: "Invalid webhook secret" } });
      return;
    }

    const input = webhookEventSchema.parse(req.body);
    const recorded = await trackingService.recordWebhookEvent(input);
    if (!recorded) {
      res
        .status(404)
        .json({ error: { message: "No matching email job for webhook event" } });
      return;
    }

    res.status(202).json({ data: { recorded: true } });
  }
};
