// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { Router } from "express";
import { usageLimitsController } from "./controller.js";

export const usageLimitsRouter = Router();

usageLimitsRouter.get("/", usageLimitsController.getCurrentUsage);
