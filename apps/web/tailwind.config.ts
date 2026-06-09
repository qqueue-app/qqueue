import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        moss: "#2f6f5e",
        coral: "#d95d39"
      }
    }
  },
  plugins: []
} satisfies Config;
