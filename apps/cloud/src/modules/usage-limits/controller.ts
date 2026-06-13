// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import type { Request, Response } from "express";
import { NotImplementedError } from "../../lib/http-error.js";

// The usage service (read/increment/evaluate) is implemented and tested in
// ./service.ts and is what the queue/worker enforcement layer will call. The
// authenticated HTTP surface is withheld until the auth + tenant-scoping slice
// so we never expose tenant usage without identity checks.
export const usageLimitsController = {
  getCurrentUsage(_req: Request, _res: Response) {
    throw new NotImplementedError("Authenticated usage endpoint");
  }
};
