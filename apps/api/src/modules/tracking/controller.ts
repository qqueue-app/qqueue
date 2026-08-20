import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import {
  verifyTrackingToken,
  type ClickTokenPayload
} from "@qqueue/email-engine";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import {
  TRACKING_PIXEL,
  trackingService,
  webhookEventSchema
} from "./service.js";

// Constant-time secret comparison; hashing first sidesteps timingSafeEqual's
// equal-length requirement without leaking length via an early return.
function secretsEqual(provided: string, expected: string) {
  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest()
  );
}

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
      // The request's own headers are the only evidence of *who* fetched this,
      // and they are gone the moment the response is written — so they travel
      // with the event rather than being re-derived later.
      await trackingService
        .recordOpen(payload.j, {
          userAgent: req.get("user-agent") ?? null,
          ip: req.ip ?? null
        })
        .catch((error: unknown) => {
          // Swallowed so a mail client still gets its image, but never
          // silently: a run of these is why an org's opens stopped arriving.
          logger.warn({ err: error, emailJobId: payload.j }, "open not recorded");
        });
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

    await trackingService
      .recordClick(payload.j, payload.u)
      .catch((error: unknown) => {
        logger.warn({ err: error, emailJobId: payload.j }, "click not recorded");
      });
    res.redirect(302, payload.u);
  },

  async webhook(req: Request, res: Response) {
    // Off unless the operator opted in: the endpoint authenticates with one
    // instance-wide shared secret and correlates messageIds across every org,
    // which is only acceptable on an instance that deliberately relays through
    // an ESP posting normalized events. 404 (not 401) so a disabled instance
    // doesn't advertise the endpoint's existence.
    if (!env.INBOUND_ESP_WEBHOOK_ENABLED) {
      res.status(404).json({ error: { message: "Not found" } });
      return;
    }

    const secret = env.WEBHOOK_SECRET;
    const provided = req.get("x-webhook-secret");
    if (!secret || !provided || !secretsEqual(provided, secret)) {
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
