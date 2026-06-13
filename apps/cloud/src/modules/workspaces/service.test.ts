// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { describe, expect, it } from "vitest";
import { NotImplementedError } from "../../lib/http-error.js";
import { workspacesService } from "./service.js";

describe("workspacesService", () => {
  it("workspace lookup is not implemented yet", () => {
    expect(() => workspacesService.getWorkspace()).toThrow(NotImplementedError);
  });
});
