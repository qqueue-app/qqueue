// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { NotImplementedError } from "../../lib/http-error.js";

// Workspaces module. Per docs/CLOUD_BOUNDARY.md, the cloud tenant boundary
// reuses the existing core `Organization` rather than introducing a separate
// Workspace model. This module will attach plan/subscription state to an
// organization and enforce tenant scoping; both land in a later slice.
export const workspacesService = {
  getWorkspace(): never {
    throw new NotImplementedError("Workspace lookup");
  }
};
