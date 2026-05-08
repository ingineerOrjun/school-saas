import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/Toaster";
import { ThemeProvider, themeScript } from "@/components/theme/ThemeProvider";
import { CalendarProvider } from "@/components/calendar/CalendarProvider";
import { AcademicSessionProvider } from "@/components/academic-session/AcademicSessionProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Scholaris — School Management System",
  description:
    "A modern, premium SaaS platform for running schools, tuition centers, and academies.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /*
     * suppressHydrationWarning is necessary on <html> because the
     * inline themeScript below runs before React hydrates and may add
     * the `dark` class — which makes the client-side HTML differ from
     * the server-rendered HTML. Suppressing the warning is the
     * standard fix for this exact pattern.
     */
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
         * Inline FOUC blocker. Reads the saved theme preference (or
         * the OS preference for 'system') and applies the `dark` class
         * to <html> BEFORE React hydrates. Without this, a dark-mode
         * visitor would see a flash of light theme on first paint.
         *
         * `dangerouslySetInnerHTML` is required because Next won't
         * inline a <script>'s text content otherwise — the alternative
         * (a separate JS file) loses the "before hydration" guarantee.
         *
         * `suppressHydrationWarning` is required HERE (not just on
         * <html>) because the `suppress` attribute applies only to the
         * element it's set on — it doesn't propagate to descendants.
         * The script's text content unavoidably mismatches between SSR
         * (empty during streaming) and the client (full script body),
         * and that mismatch is harmless: the script never re-runs after
         * hydration, so the divergence has no behavioural effect.
         */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body>
        <ThemeProvider>
          {/* CalendarProvider sits inside ThemeProvider so dark-mode
              toggles don't unmount it (and lose the preference state).
              Inverse nesting wouldn't matter for correctness — pure
              ergonomics. */}
          <CalendarProvider>
            {/* AcademicSessionProvider fetches the session list from
                the API on mount, so it sits inside the auth-token-
                aware layer. The provider tolerates 401 (returns empty
                list) so it doesn't crash for unauthenticated visitors
                landing on /login. */}
            <AcademicSessionProvider>
              {children}
              <Toaster />
            </AcademicSessionProvider>
          </CalendarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
