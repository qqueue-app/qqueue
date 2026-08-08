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
        /*
          Both are --bg (#FAFAF8), not the brand green (§5).

          theme_color paints the status bar and the task-switcher header, and a
          green bar sitting above a warm-gray app reads as a banner stuck to the
          top of the screen rather than as the app's own chrome. background_color
          is what the OS paints during the cold-start splash before the first
          frame renders — white there means a flash of the wrong colour on every
          launch. These two values must track --bg in styles.css and the
          theme-color meta in index.html; all three describe the same surface.
        */
        background_color: "#FAFAF8",
        theme_color: "#FAFAF8",
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
          /*
            A separate asset, not the "any" icon relabelled.

            Android crops a maskable icon to whatever shape the launcher uses —
            a circle on Pixel, a squircle elsewhere — keeping only the central
            80%. The "any" icon above is a rounded tile whose letterforms run
            almost to its edge, so masked it loses the outer Q entirely. This
            one bleeds the brand green to all four edges and holds the wordmark
            inside the safe circle, so every launcher shape is a clean crop.
          */
          {
            src: "/images/maskable-512x512.png",
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
