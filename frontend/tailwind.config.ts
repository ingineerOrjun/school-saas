import type { Config } from "tailwindcss";

const config: Config = {
  // Class-strategy dark mode: <html class="dark"> flips every
  // dark-prefixed utility AND the CSS variable overrides in
  // globals.css's `.dark` block. The ThemeProvider toggles the class.
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      // Slightly tighter container — part of the global ~10–15%
      // vertical/horizontal whitespace reduction.
      padding: "1.25rem",
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: "hsl(var(--surface))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        // True Tailwind `indigo` palette — primary-600 is now exactly
        // indigo-600 (#4F46E5) and hover state primary-700 is indigo-700
        // (#4338CA). Keeps utility shorthands and design tokens aligned.
        primary: {
          50: "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          300: "#A5B4FC",
          400: "#818CF8",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          800: "#3730A3",
          900: "#312E81",
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.375rem" }],
        md: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1rem", { lineHeight: "1.5rem" }],
        xl: ["1.125rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.375rem", { lineHeight: "1.875rem", letterSpacing: "-0.01em" }],
        "3xl": ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.015em" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.02em" }],
        "5xl": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
      },
      borderRadius: {
        lg: "0.625rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      // Quieter shadow scale. Cards rely on the slate-300 border for
      // definition; shadows now only suggest a subtle lift on hover.
      boxShadow: {
        xs: "0 1px 1px 0 rgb(16 24 40 / 0.03)",
        sm: "0 1px 2px 0 rgb(16 24 40 / 0.04)",
        md: "0 1px 2px -1px rgb(16 24 40 / 0.04), 0 2px 4px -2px rgb(16 24 40 / 0.05)",
        lg: "0 2px 4px -2px rgb(16 24 40 / 0.04), 0 6px 12px -4px rgb(16 24 40 / 0.06)",
        xl: "0 4px 8px -3px rgb(16 24 40 / 0.04), 0 12px 20px -6px rgb(16 24 40 / 0.07)",
        ring: "0 0 0 4px rgb(79 70 229 / 0.14)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "scale-out": {
          from: { opacity: "1", transform: "scale(1)" },
          to: { opacity: "0", transform: "scale(0.96)" },
        },
        "highlight-row": {
          "0%": { backgroundColor: "hsl(var(--primary) / 0.18)" },
          "30%": { backgroundColor: "hsl(var(--primary) / 0.15)" },
          "100%": { backgroundColor: "transparent" },
        },
        // Teacher module variant — emerald, same cadence as primary highlight.
        "highlight-row-teacher": {
          "0%": { backgroundColor: "rgb(16 185 129 / 0.18)" },
          "30%": { backgroundColor: "rgb(16 185 129 / 0.15)" },
          "100%": { backgroundColor: "transparent" },
        },
        "row-remove": {
          from: { opacity: "1", transform: "translateY(0) scale(1)" },
          to: { opacity: "0", transform: "translateY(-4px) scale(0.98)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "fade-out": "fade-out 180ms ease-in forwards",
        "fade-in-up": "fade-in-up 240ms cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-out": "scale-out 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "highlight-row":
          "highlight-row 1800ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "highlight-row-teacher":
          "highlight-row-teacher 1800ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "row-remove": "row-remove 180ms ease-in-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
