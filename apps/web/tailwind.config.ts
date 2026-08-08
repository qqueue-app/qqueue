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
    /*
      The page container: centred, with a max-width ladder that tops out at
      1400px. Everything a page renders lives inside one, so the header rule and
      the content beneath it share a measure — the mismatch that made wide
      screens look lopsided was a full-bleed header over a capped section.

      The padding is the `p-4 sm:p-6` every page section already used, moved
      here so it is stated once. A page adopting `<PageContainer>` drops its own
      horizontal padding or it doubles.

      The ladder is keyed to the *viewport* while `<main>` is inset by the
      240px sidebar, so the 1400px cap only binds above a ~1640px viewport.
      Below that the container just fills the content box, and centring the
      content *inside* it (`mx-auto`) is what keeps a page symmetric.
    */
    container: {
      center: true,
      padding: { DEFAULT: "1rem", sm: "1.5rem" },
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
        // What a mail client paints behind the message — see styles.css.
        "email-paper": "hsl(var(--email-paper))",
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
        // The whole type scale — seven sizes, named by role.
        /*
          11px, the size §1 gives ALL-CAPS eyebrow labels ("AUDIENCE" in the
          sidebar) and §5 gives the mobile tab bar's labels. It is a real step in
          the system, but it was missing from this scale — so every eyebrow in
          the shell had been reaching for `text-[0.6875rem]`, and the badge
          counters had drifted to three *different* literals between them.
        */
        eyebrow: ["0.6875rem", { lineHeight: "1rem" }], // 11 — caps labels, tab bar
        meta: ["0.75rem", { lineHeight: "1rem" }], // 12 — meta, small labels
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
          The two sub-steps §3 authorises below the 4/8/12/16/24/32/48 scale.

          They are named rather than left as bare Tailwind fractions because
          that is the difference between a value the system chose and one
          somebody guessed: `space-y-field` is the label→field→helper rhythm
          §3 specifies, and `p-card` is the lower bound of its 20–24px card
          padding. Everything else stays on the main scale — if you find
          yourself wanting `gap-2.5`, the answer is 2 or 3.
        */
        field: "0.375rem", // 6px — label → field → helper
        card: "1.25rem", // 20px — card padding (lower bound of §3's 20–24)
        /*
          Padding that clears an icon sitting inside a field — the search box's
          magnifier, the clear button opposite it. One control-height, so the
          glyph is centred in a square at the end of the control rather than
          parked at whatever offset looked right that day.
        */
        control: "2.25rem", // 36px

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
        "tabbar-safe": "calc(var(--shell-tabbar-h) + var(--safe-bottom))",
        /*
          Card padding plus the home indicator — the bottom padding of anything
          docked to the bottom edge of the screen, which below 640px is every
          dialog (§5 turns them into bottom sheets). `pb-safe-b` alone would be
          wrong there: it replaces the padding instead of adding to it, leaving
          a dialog's last button flush against its own edge on a phone with no
          inset at all.
        */
        "card-safe": "calc(1.25rem + var(--safe-bottom))"
      },
      maxWidth: {
        /*
          `max-w-page` is the app's one page measure — `<PageContainer>` and
          `<PageHeader>` are the only things that should wear it. `max-w-read`
          is for prose inside a page, which wants a line length rather than a
          page width.
        */
        page: "var(--content-page)",
        read: "var(--content-read)",

        /* §3's empty state: 400px, centred, never a full-width bordered box. */
        empty: "var(--content-empty)",

        /*
          Where a table cell stops growing and starts truncating. Three steps,
          because a cell full of email addresses and a cell full of subject
          lines want different ones — and because the alternative is what was
          here before: six different literals across five pages, each of them a
          guess nobody could check against another.
        */
        "cell-sm": "10rem", // 160px — a name, a label
        cell: "16rem", // 256px — an email address
        "cell-lg": "20rem", // 320px — a subject line

        /* The paper an email is previewed on — not app chrome, so not a
           content width. 680px is what the template preview frames. */
        email: "42.5rem"
      },
      width: {
        /*
          Field widths are set by content type, not by container. These are the
          only widths a form field should ever have. Whitespace to the right of
          a field is correct, not wasted.
        */
        "field-code": "7.5rem", // 120px — port, short code, count
        "field-choice": "12rem", // 192px — a select of short enumerated options
        "field-search": "17.5rem", // 280px — search
        "field-name": "22.5rem", // 360px — email address, person's name
        "field-long": "30rem", // 480px — subject line, URL, API key

        /*
          The inbox's message-list pane, which is a reading column rather than a
          field: wide enough for a sender and a subject line, and it earns the
          extra 2rem at `lg` where there is room for it.
        */
        "list-pane": "22rem",
        "list-pane-lg": "24rem",

        /* A phone, for the template preview's device toggle. */
        phone: "23.4375rem", // 375px

        /*
          The square-control widths, which have to be listed here as well as
          under `height`. Tailwind's `width` scale does not inherit from
          `height`, and it only extends `spacing` — which these are not in — so
          without these two lines `w-control` and `w-touch` compile to nothing
          at all. That failure is silent and nasty: an icon button keeps its
          36px height and collapses to the width of its glyph, and every
          `after:w-touch` touch-slop pseudo-element gets 44px of height and no
          width, so the 44px tap target it exists to provide does not exist.
        */
        control: "2.25rem", // 36px — square icon buttons
        touch: "2.75rem", // 44px — touch-slop pseudo-elements

        // Icon sizes that are not the default 16px `[&_svg]:size-4`. Listed on
        // both width and height for the reason given above.
        "icon-tab": "1.375rem", // 22px — mobile tab bar (§5)
        "icon-row": "1.125rem" // 18px — More-sheet and nav rows
      },
      height: {
        control: "2.25rem", // 36px — buttons, inputs, selects
        touch: "2.75rem", // 44px — minimum comfortable touch target
        "icon-tab": "1.375rem",
        "icon-row": "1.125rem"
      },
      minHeight: {
        control: "2.25rem",
        touch: "2.75rem",
        textarea: "5rem",
        /*
          Where an editing or preview surface starts before its content decides.
          Three steps because a rich-text body, an HTML source view and an
          attachment preview genuinely want different ones — and because the
          alternative was four different pixel literals that had drifted apart
          without anyone choosing the difference.
        */
        "pane-sm": "12.5rem", // 200px — rich text body
        pane: "15rem", // 240px — attachment preview
        "pane-lg": "17.5rem" // 280px — HTML source view
      },
      minWidth: {
        touch: "2.75rem",
        /* A count badge stays circular at one digit and grows past it. */
        badge: "1.25rem"
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
