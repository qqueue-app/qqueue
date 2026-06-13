// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { Router } from "express";
import { billingRouter } from "../modules/billing/routes.js";
import { usageLimitsRouter } from "../modules/usage-limits/routes.js";
import { workspacesRouter } from "../modules/workspaces/routes.js";

// Cloud API surface. Mounted under /cloud/v1 by the app. Authentication and
// tenant scoping middleware are added in a later slice; these are skeleton
// routes returning 501 for behavior that is not implemented yet.
export const cloudV1Router = Router();

cloudV1Router.use("/billing", billingRouter);
cloudV1Router.use("/workspaces", workspacesRouter);
cloudV1Router.use("/usage", usageLimitsRouter);
