"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// PrintShell — Phase α shared print primitive.
//
// Replaces the per-page duplicated print CSS + toolbar pattern with
// one consistent shell. Any printable surface (receipt, admit card,
// marksheet, ID card, transfer certificate, bonafide letter) wraps
// its content in <PrintShell> and inherits:
//
//   • A4 page size + 14mm margins
//   • `print-color-adjust: exact` (so dark headers/footers stay solid
//     in Chrome/Edge — the default "economy" mode strips backgrounds
//     and ruins printed receipts)
//   • Robust page-break behavior (avoid splitting cards / table rows /
//     section blocks across pages)
//   • Hidden toolbar on print via the `.no-print` utility
//   • Auto-print on mount when `autoPrint` is set (the receipt-from-
//     successful-payment flow uses this)
//   • Back button + Print button + optional extra actions slot
//
// Why a wrapper component (vs a global stylesheet):
//   • Next.js's `style jsx global` per-page meant 3+ copies of the
//     same rules drifted in subtle ways. One copy here, one source
//     of truth.
//   • The toolbar is part of the shell — every printable page used
//     to reimplement print/download/back. Now it's free.
//
// What this component does NOT cover:
//   • Server-side PDF generation. We rely on the browser's "Print →
//     Save as PDF" — works on every modern browser, zero infra cost.
//     A future server-side renderer (Puppeteer) can render any page
//     wrapped in PrintShell without modification because the styles
//     all live in @media print.
//   • Per-printable layout. Receipts, marksheets, admit cards each
//     have unique content; PrintShell is the chrome around them.
// ---------------------------------------------------------------------------

export interface PrintShellProps {
  /** Title shown in the top toolbar (hidden on print). */
  title?: string;
  /** Where the back button navigates. Defaults to history.back. */
  backHref?: string;
  /** Extra toolbar buttons rendered between Back and Print. */
  toolbarActions?: React.ReactNode;
  /** Auto-fire window.print() on mount. Default false. */
  autoPrint?: boolean;
  /** Delay (ms) before auto-print so the page has time to paint. */
  autoPrintDelayMs?: number;
  /**
   * Page size — A4 (default) or Letter. The browser still respects
   * the user's printer choice; this just sets the @page hint.
   */
  pageSize?: "A4" | "Letter";
  /** Outer margin in mm. Default 14. */
  marginMm?: number;
  /** Force the printable area max-width (in mm). Default 210mm (A4). */
  maxWidthMm?: number;
  /** Optional className for the printable container. */
  className?: string;
  children: React.ReactNode;
}

export function PrintShell({
  title,
  backHref,
  toolbarActions,
  autoPrint = false,
  autoPrintDelayMs = 250,
  pageSize = "A4",
  marginMm = 14,
  maxWidthMm = 210,
  className,
  children,
}: PrintShellProps) {
  const router = useRouter();

  React.useEffect(() => {
    if (!autoPrint) return;
    const t = window.setTimeout(() => window.print(), autoPrintDelayMs);
    return () => window.clearTimeout(t);
  }, [autoPrint, autoPrintDelayMs]);

  const handleBack = () => {
    if (backHref) {
      router.push(backHref);
    } else {
      router.back();
    }
  };

  return (
    <>
      {/* Print stylesheet. ONE place to change page rules across every
          printable surface. */}
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          html,
          body {
            background: white !important;
          }
          /* Force background colors + borders to render — Chrome's
             default "economy" mode strips them, breaking dark headers
             / footers / status pills on every printed receipt. */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* Page-break safety: NEVER split a card, section, table row,
             or signature block across pages. The renderer can wrap
             between blocks but not within them. */
          .print-block,
          tr,
          td,
          th {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          @page {
            size: ${pageSize};
            margin: ${marginMm}mm;
          }
        }
      `}</style>

      <div className="min-h-screen bg-muted/40 py-6 print:bg-white print:py-0">
        {/* Toolbar — hidden on print */}
        <div
          className="no-print mx-auto mb-4 flex items-center justify-between gap-3 px-4 sm:px-6"
          style={{ maxWidth: `${maxWidthMm + 20}mm` }}
        >
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          {title && (
            <h1 className="hidden sm:block text-sm font-semibold text-muted-foreground truncate flex-1 text-center">
              {title}
            </h1>
          )}
          <div className="flex items-center gap-2">
            {toolbarActions}
            <button
              type="button"
              onClick={() => window.print()}
              title="Opens your browser's print dialog — choose 'Save as PDF' as the destination"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 h-9 text-sm font-medium text-background shadow-sm hover:bg-foreground/90 active:scale-[0.98] transition-all"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Save PDF</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 h-9 text-sm font-medium text-foreground shadow-xs hover:border-primary/40 hover:text-primary active:scale-[0.98] transition-all"
            >
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print</span>
            </button>
          </div>
        </div>

        {/* Printable area — sized to A4 width by default, centered. */}
        <div
          className={cn(
            "mx-auto bg-white shadow-sm border border-border print:shadow-none print:border-0",
            className,
          )}
          style={{ maxWidth: `${maxWidthMm}mm` }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

/**
 * Helper for wrapping individual sections inside a PrintShell so
 * page-break-inside: avoid takes effect. Use it for cards / signature
 * blocks / payment summaries — anything that must render whole on a
 * single page.
 *
 *   <PrintBlock>
 *     <ReceiptHeader … />
 *   </PrintBlock>
 */
export function PrintBlock({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("print-block", className)}>{children}</section>
  );
}
