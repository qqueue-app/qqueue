// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { Router } from "express";
import { billingController } from "./controller.js";

export const billingRouter = Router();

billingRouter.get("/plans", billingController.listPlans);
billingRouter.post("/checkout", billingController.createCheckoutSession);
billingRouter.post("/webhook", billingController.handleProviderWebhook);
