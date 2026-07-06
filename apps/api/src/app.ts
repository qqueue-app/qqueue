import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { healthRouter } from "./routes/health.js";
import { v1Router } from "./routes/v1.js";

// Local-dev browser origins we trust. Vite serves the dashboard on 5173 but
// falls back to the next free port (5174, 5175, ...) when 5173 is taken, and
// may be reached via 127.0.0.1 as well as localhost. Enumerate the exact set
// rather than using a wildcard so CORS stays a real allowlist.
const DEV_ALLOWED_ORIGINS = Array.from(
  { length: 7 },
  (_, i) => 5173 + i
).flatMap((port) => [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
]);

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin:
        env.NODE_ENV === "production"
          ? (env.WEB_ORIGIN ?? false)
          : DEV_ALLOWED_ORIGINS,
    })
  );
  app.use(express.json());
  app.use(requestLogger);

  app.use(healthRouter);
  app.use("/api/v1", v1Router);

  app.use(errorHandler);

  return app;
}
