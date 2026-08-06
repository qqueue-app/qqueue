import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { storage } from "./lib/storage.js";

// Crash visibility (Phase 5): log unhandled rejections loudly (per-request
// errors already flow through the error handler); uncaught exceptions are
// fatal — state after one is unknowable.
process.on("unhandledRejection", (reason) => {
  console.error("[api] unhandled promise rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[api] uncaught exception, exiting:", error);
  process.exit(1);
});

const app = createApp();

// Make sure the attachment bucket exists before serving requests. Best-effort:
// a storage outage at boot should not prevent the API (and its non-attachment
// flows) from starting.
storage.ensureBucket().catch((error) => {
  console.error("Failed to ensure attachment storage bucket:", error);
});

// Bind without a listen callback on purpose: express 5 registers that callback
// as an 'error' listener too, so it fires on a failed bind and would report a
// successful start when the port is taken. The 'listening' event only fires on
// a real bind.
const server = app.listen(env.API_PORT);

server.on("listening", () => {
  console.log(`QQueue API listening on port ${env.API_PORT}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${env.API_PORT} is already in use — another process is holding it. ` +
        `Stop it (lsof -nP -iTCP:${env.API_PORT} -sTCP:LISTEN) or set API_PORT to a free port.`
    );
    process.exit(1);
  }
  throw error;
});

// Graceful shutdown (Phase 5): stop accepting connections, let in-flight
// requests finish, then release the database pool.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[api] ${signal} received; draining connections...`);
  server.close(() => {
    void prisma
      .$disconnect()
      .catch(() => undefined)
      .then(() => {
        console.log("[api] shut down cleanly.");
        process.exit(0);
      });
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
