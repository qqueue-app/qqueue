import type { Request, Response } from "express";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@qqueue/shared";
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

  async unsubscribe(req: Request, res: Response) {
    const input = pushUnsubscribeSchema.parse(req.body);
    await pushService.unsubscribe(req.userId!, input.endpoint);
    res.status(204).send();
  },

  async list(req: Request, res: Response) {
    const subscriptions = await pushService.listForUser(req.userId!);
    res.json({ data: subscriptions });
  },
};
