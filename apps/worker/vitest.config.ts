import { defineConfig } from "vitest/config";

// Env values the worker's config module requires at import time, so tests do
// not depend on a local .env file.
const TEST_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  ENCRYPTION_KEY: "test-encryption-key-thirty-two-byte",
  REDIS_HOST: "localhost",
  REDIS_PORT: "6379",
  APP_URL: "http://localhost:4000",
  TRACKING_SECRET: "test-tracking-secret"
};

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
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
        "src/config/**",
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
