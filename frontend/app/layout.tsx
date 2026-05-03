import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/Toaster";
import { ThemeProvider, themeScript } from "@/components/theme/ThemeProvider";
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
         */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
