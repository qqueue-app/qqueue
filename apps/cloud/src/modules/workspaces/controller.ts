// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import type { Request, Response } from "express";
import { workspacesService } from "./service.js";

export const workspacesController = {
  getWorkspace(_req: Request, _res: Response) {
    workspacesService.getWorkspace();
  }
};
