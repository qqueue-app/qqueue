import type { Request, Response } from "express";
import {
  inboxNotifyPreferenceUpdateSchema,
  pushRotateSchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
} from "@qqueue/shared";
import { pushService } from "./service.js";

export const pushController = {
  /**
   * Public key + whether push is usable at all. Deliberately unauthenticated in
   * substance (it is a public key) but mounted behind auth like the rest of the
   * dashboard API, since only signed-in clients ever ask.
   */
  async publicKey(_req: Request, res: Response) {
    const key = pushService.publicKey();
    res.json({ data: { publicKey: key, enabled: key !== null } });
  },

  async subscribe(req: Request, res: Response) {
    const input = pushSubscriptionSchema.parse(req.body);
    const subscription = await pushService.subscribe(req.userId!, input);
    res.status(201).json({ data: subscription });
  },

  /**
   * Public: authorized by the old endpoint, not by a session. See
   * `pushService.rotate` for why a service worker has nothing else to offer.
   */
  async rotate(req: Request, res: Response) {
    const input = pushRotateSchema.parse(req.body);
    const subscription = await pushService.rotate(input);
    res.json({ data: subscription });
  },

  async unsubscribe(req: Request, res: Response) {
    const input = pushUnsubscribeSchema.parse(req.body);
    await pushService.unsubscribe(req.userId!, input.endpoint);
    res.status(204).send();
  },

  async list(req: Request, res: Response) {
    const subscriptions = await pushService.listForUser(req.userId!);
    res.json({ data: subscriptions });
  },

  async getPreference(req: Request, res: Response) {
    const notifyLevel = await pushService.getNotifyLevel(
      req.userId!,
      req.organizationId!
    );
    res.json({ data: { organizationId: req.organizationId!, notifyLevel } });
  },

  async updatePreference(req: Request, res: Response) {
    const input = inboxNotifyPreferenceUpdateSchema.parse(req.body);
    const notifyLevel = await pushService.setNotifyLevel(
      req.userId!,
      req.organizationId!,
      input.notifyLevel
    );
    res.json({ data: { organizationId: req.organizationId!, notifyLevel } });
  },
};
