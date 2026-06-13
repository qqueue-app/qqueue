// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import type { Request, Response } from "express";
import { billingService } from "./service.js";

export const billingController = {
  listPlans(_req: Request, res: Response) {
    res.json({ data: billingService.listPlans() });
  },

  createCheckoutSession(_req: Request, _res: Response) {
    billingService.createCheckoutSession();
  },

  handleProviderWebhook(_req: Request, _res: Response) {
    billingService.handleProviderWebhook();
  }
};
