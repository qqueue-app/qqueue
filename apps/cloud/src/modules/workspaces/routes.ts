// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { Router } from "express";
import { workspacesController } from "./controller.js";

export const workspacesRouter = Router();

workspacesRouter.get("/:id", workspacesController.getWorkspace);
