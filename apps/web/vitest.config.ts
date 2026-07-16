import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/test/**",
        "src/styles.css"
      ],
      // Function coverage lags the other metrics on purpose. The remaining
      // uncovered functions are handlers and callbacks inside pages that
      // already have tests, plus Inbox.tsx (untested end to end) — diffuse
      // work with no single lever, unlike the line gap. Raise `functions`
      // only alongside real interaction tests, not by chasing the number.
      thresholds: {
        lines: 85,
        functions: 75,
        branches: 80,
        statements: 85
      }
    }
  }
});
