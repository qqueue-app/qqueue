import cors from "cors";
import express from "express";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { healthRouter } from "./routes/health.js";
import { v1Router } from "./routes/v1.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  app.use(healthRouter);
  app.use("/api/v1", v1Router);

  app.use(errorHandler);

  return app;
}
