import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

/**
 * The theme is a projection of the tokens in src/styles.css — it names things,
 * it does not decide them. Every value below is either a `var(--token)` or a
 * step on a scale the design system defines. If you find yourself adding a
 * literal here, the token set is missing a step; add it to styles.css instead.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  /*
    index.html sets a `.dark` class on <html> from localStorage/OS preference.
    Tailwind's default is `media`, which meant `dark:` variants fired off the OS
    setting while every CSS variable stayed light — a half-dark, unreadable mix.
    Pinning to `class` makes the class the only switch. No `.dark` token block
    exists yet, so the app is consistently light until a dark palette is designed.
  */
  darkMode: "class",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px"
      }
    },
    extend: {
      screens: {
        /*
          The anti-stretch rule inverts below 480px: a 360px field in a 375px
          viewport IS content-sized, so fields go full width there. `xs` is the
          hinge for that, and the only breakpoint beyond the system's three
          (sm 640 mobile/tablet, lg 1024 tablet/desktop).
        */
        xs: "480px"
      },
      colors: {
        // ---- Surfaces & text (warm gray — not slate/zinc) ----
        bg: "hsl(var(--bg))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          sunken: "hsl(var(--surface-sunken))"
        },
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        text: {
          DEFAULT: "hsl(var(--text))",
          secondary: "hsl(var(--text-secondary))",
          tertiary: "hsl(var(--text-tertiary))"
        },

        // ---- Status pairs: tinted background + dark text ----
        ok: {
          DEFAULT: "hsl(var(--ok-text))",
          bg: "hsl(var(--ok-bg))"
        },
        warn: {
          DEFAULT: "hsl(var(--warn-text))",
          bg: "hsl(var(--warn-bg))"
        },
        err: {
          DEFAULT: "hsl(var(--err-text))",
          bg: "hsl(var(--err-bg))"
        },
        info: {
          DEFAULT: "hsl(var(--info-text))",
          bg: "hsl(var(--info-bg))"
        },

        // ---- Identity tints (avatars) ----
        identity: {
          "1": "hsl(var(--identity-1-text))",
          "1-bg": "hsl(var(--identity-1-bg))",
          "2": "hsl(var(--identity-2-text))",
          "2-bg": "hsl(var(--identity-2-bg))",
          "3": "hsl(var(--identity-3-text))",
          "3-bg": "hsl(var(--identity-3-bg))",
          "4": "hsl(var(--identity-4-text))",
          "4-bg": "hsl(var(--identity-4-bg))"
        },

        // ---- shadcn/ui semantic names, re-pointed at the same tokens ----
        // These keep 18k lines of existing markup working while the vocabulary
        // migrates. New code should prefer the semantic names above.
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--accent))",
          hover: "hsl(var(--accent-hover))",
          foreground: "hsl(var(--accent-contrast))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))"
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        // shadcn's "accent" is the soft hover/selected tint, NOT the brand.
        // The brand green is `primary`. See the note in styles.css.
        accent: {
          DEFAULT: "hsl(var(--accent-soft))",
          foreground: "hsl(var(--accent))"
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        }
      },
      borderRadius: {
        // One radius per element type. Use these names, not t-shirt sizes —
        // `rounded-card` says what it is; `rounded-xl` says what it measures.
        control: "var(--radius-control)",
        card: "var(--radius-card)",
        dialog: "var(--radius-dialog)",
        pill: "var(--radius-pill)"
      },
      boxShadow: {
        // Cards carry a hairline border and almost no shadow; only overlays
        // (dropdowns, dialogs, popovers) get elevation you can see.
        card: "var(--shadow-card)",
        overlay: "var(--shadow-overlay)"
      },
      fontSize: {
        // The whole type scale — six sizes, named by role.
        meta: ["0.75rem", { lineHeight: "1rem" }], // 12 — meta, eyebrow labels
        ui: ["0.8125rem", { lineHeight: "1.125rem" }], // 13 — secondary, table cells
        body: ["0.875rem", { lineHeight: "1.25rem" }], // 14 — default
        section: ["1rem", { lineHeight: "1.5rem" }], // 16 — section titles
        title: ["1.25rem", { lineHeight: "1.75rem" }], // 20 — page titles
        stat: ["1.75rem", { lineHeight: "2rem" }] // 28 — dashboard stat values
      },
      fontWeight: {
        // Nothing bolder than 600. 450 is the variable-font body weight.
        text: "450",
        medium: "500",
        semibold: "600"
      },
      letterSpacing: {
        eyebrow: "0.06em"
      },
      fontFamily: {
        sans: [
          "Inter Variable",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ]
      },
      spacing: {
        /*
          Shell measurements and safe-area insets, so the two sides of every
          pairing read from the same value: `w-sidebar` on the sidebar and
          `pl-sidebar` on main, `h-tabbar` on the tab bar and `pb-tabbar-safe`
          on the content it must not cover.
        */
        sidebar: "var(--shell-sidebar-w)",
        tabbar: "var(--shell-tabbar-h)",
        "header-row": "var(--shell-header-h)",
        // The tablet top bar, notch included — its own height and the offset a
        // sticky sub-header has to clear are the same number.
        "topbar-safe": "calc(var(--shell-topbar-h) + var(--safe-top))",
        // Where a sticky sub-header comes to rest; see --shell-sticky-top.
        "sticky-top": "var(--shell-sticky-top)",
        "safe-t": "var(--safe-top)",
        "safe-b": "var(--safe-bottom)",
        "safe-l": "var(--safe-left)",
        "safe-r": "var(--safe-right)",
        // The tab bar plus the home indicator beneath it — what main has to
        // clear at the bottom on a phone.
        "tabbar-safe": "calc(var(--shell-tabbar-h) + var(--safe-bottom))"
      },
      width: {
        /*
          Field widths are set by content type, not by container. These are the
          only widths a form field should ever have. Whitespace to the right of
          a field is correct, not wasted.
        */
        "field-code": "7.5rem", // 120px — port, short code, count
        "field-search": "17.5rem", // 280px — search
        "field-name": "22.5rem", // 360px — email address, person's name
        "field-long": "30rem" // 480px — subject line, URL, API key
      },
      height: {
        control: "2.25rem", // 36px — buttons, inputs, selects
        touch: "2.75rem" // 44px — minimum comfortable touch target
      },
      minHeight: {
        control: "2.25rem",
        touch: "2.75rem",
        textarea: "5rem"
      },
      minWidth: {
        touch: "2.75rem"
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)"
      },
      transitionTimingFunction: {
        out: "var(--ease-out)"
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" }
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" }
        }
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out"
      }
    }
  },
  plugins: [animate, typography]
} satisfies Config;
