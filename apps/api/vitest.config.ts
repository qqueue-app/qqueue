import { defineConfig } from "vitest/config";

// Env values the config module (src/config/env.ts) requires at import time.
// Set here so tests never depend on a local .env file (dotenv does not
// override variables that are already present in process.env).
const TEST_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_ACCESS_SECRET: "test-access-secret",
  JWT_REFRESH_SECRET: "test-refresh-secret",
  ENCRYPTION_KEY: "test-encryption-key-thirty-two-byte",
  APP_URL: "http://localhost:4000",
  TRACKING_SECRET: "test-tracking-secret",
  WEBHOOK_SECRET: "test-webhook-secret"
};

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    setupFiles: ["./src/test/setup.ts"],
    env: TEST_ENV,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.{test,spec}.ts",
        "src/**/*.d.ts",
        "src/index.ts",
        "src/config/env.ts",
        "src/lib/prisma.ts",
        "src/queues/**",
        "src/test/**"
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85
      }
    }
  }
});
