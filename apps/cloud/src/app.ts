// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import express from "express";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.js";
import { cloudV1Router } from "./routes/v1.js";

export function createApp() {
  const app = express();

  app.use(express.json());

  app.use(healthRouter);
  app.use("/cloud/v1", cloudV1Router);

  app.use(errorHandler);

  return app;
}
