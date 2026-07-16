import { defineConfig } from "vitest/config";

// Env values the config module (src/config/env.ts) requires at import time.
// Set here so tests never depend on a local .env file.
const TEST_ENV = {
  NODE_ENV: "test",
  CLOUD_PORT: "4100"
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
        "src/config/env.ts"
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
