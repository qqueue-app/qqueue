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

app.listen(env.API_PORT, () => {
  console.log(`QQueue API listening on port ${env.API_PORT}`);
});
