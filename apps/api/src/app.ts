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

  // Behind the bundled Caddy (or any reverse proxy), the client IP arrives in
  // X-Forwarded-For; without this the IP-keyed rate limits all key on the
  // proxy's address. Configurable hop count; 0 disables (direct exposure).
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(
    cors({
      origin:
        env.NODE_ENV === "production"
          ? (env.WEB_ORIGIN ?? false)
          : DEV_ALLOWED_ORIGINS,
    })
  );
  // 4 MB, up from the 100 KB default: a transactional send may carry up to
  // MAX_INLINE_ATTACHMENTS × INLINE_ATTACHMENT_MAX_BYTES = 2.5 MB of inline
  // attachments, which is ~3.4 MB once base64-encoded, plus the HTML body.
  // The three limits move together.
  app.use(express.json({ limit: "4mb" }));
  app.use(requestLogger);

  app.use(healthRouter);
  app.use("/api/v1", v1Router);

  app.use(errorHandler);

  return app;
}
