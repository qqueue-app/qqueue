import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest, not generateSW: the worker owns push and
      // notificationclick handlers that a generated one cannot express.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // The Tiptap/MJML editor chunks are large; the default 2 MiB ceiling
        // would silently drop them from the precache.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        // Lets push and install be exercised in `pnpm dev` instead of only in
        // a production build.
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
      },
      manifest: {
        name: "QQueue",
        short_name: "QQueue",
        description:
          "Your team's email — inbox, campaigns, and sending, in one place.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#ffffff",
        theme_color: "#2f6f5e",
        categories: ["business", "productivity"],
        icons: [
          {
            src: "/images/android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/images/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/images/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/images/apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png",
          },
        ],
        shortcuts: [
          {
            name: "Compose",
            short_name: "Compose",
            url: "/email-studio",
            icons: [
              { src: "/images/android-chrome-192x192.png", sizes: "192x192" },
            ],
          },
          {
            name: "Inbox",
            short_name: "Inbox",
            url: "/inbox",
            icons: [
              { src: "/images/android-chrome-192x192.png", sizes: "192x192" },
            ],
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
