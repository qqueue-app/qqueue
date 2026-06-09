import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379)
});

export const env = envSchema.parse(process.env);
