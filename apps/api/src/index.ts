import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { storage } from "./lib/storage.js";

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
