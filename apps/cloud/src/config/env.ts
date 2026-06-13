// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { config } from "dotenv";
import { z } from "zod";

// Load the repo-root .env (shared with the rest of the stack), then any local
// override. dotenv does not override variables already present in process.env.
config({ path: new URL("../../../../.env", import.meta.url) });
config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CLOUD_PORT: z.coerce.number().int().positive().default(4100),
  // Web dashboard origin allowed to call the cloud API. Open in development.
  WEB_ORIGIN: z.string().url().optional(),
  // Billing provider credentials. Optional in slice 0 (no provider wired yet);
  // the billing module will require them once integration lands.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional()
});

export const env = envSchema.parse(process.env);
