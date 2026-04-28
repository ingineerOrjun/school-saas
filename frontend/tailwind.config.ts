import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
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
        primary: {
          50: "#EEF0FF",
          100: "#E0E3FF",
          200: "#C7CBFF",
          300: "#A5AAFF",
          400: "#8288FA",
          500: "#6366F1",
          600: "#5B5FC7",
          700: "#4E52B0",
          800: "#3F4390",
          900: "#2E3273",
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
      boxShadow: {
        xs: "0 1px 2px 0 rgb(16 24 40 / 0.04)",
        sm: "0 1px 2px 0 rgb(16 24 40 / 0.05), 0 1px 3px 0 rgb(16 24 40 / 0.04)",
        md: "0 2px 4px -1px rgb(16 24 40 / 0.06), 0 4px 8px -2px rgb(16 24 40 / 0.08)",
        lg: "0 4px 8px -2px rgb(16 24 40 / 0.06), 0 12px 24px -4px rgb(16 24 40 / 0.10)",
        xl: "0 8px 16px -4px rgb(16 24 40 / 0.06), 0 20px 32px -8px rgb(16 24 40 / 0.12)",
        ring: "0 0 0 4px rgb(99 102 241 / 0.12)",
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
