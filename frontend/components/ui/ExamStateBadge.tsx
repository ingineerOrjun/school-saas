"use client";

import * as React from "react";
import { DraftBadge, PublishedBadge } from "./StatusBadges";
import { LockedBadge } from "./LockedBadge";
import { deriveExamState, type ExamDto } from "@/lib/exams";

// ============================================================================
// ExamStateBadge — Phase ACADEMIC TRANSITION SAFETY Part 4.
//
// Single point of truth for rendering the Draft / Published / Locked
// status pill on exam rows + marksheet headers. The mapping lives in
// `deriveExamState` (in @/lib/exams) so the same rule applies on every
// surface.
//
// Why a thin composite instead of just calling one of the three
// existing primitives:
//   • Centralizes the "locked dominates published" rule. Otherwise
//     every page would have to remember "if locked, hide the
//     PublishedBadge".
//   • Forwards size + className so callers can drop it inline in a
//     dense table row OR as a header chip.
// ============================================================================

export interface ExamStateBadgeProps {
  /** Subset of the exam DTO needed to derive state. */
  exam: Pick<ExamDto, "locked" | "publishedAt" | "lockedAt">;
  size?: "sm" | "md";
  className?: string;
}

export function ExamStateBadge({ exam, size = "md", className }: ExamStateBadgeProps) {
  const state = deriveExamState(exam);
  switch (state) {
    case "locked":
      return (
        <LockedBadge
          size={size}
          className={className}
          tone="amber"
          tooltip={
            exam.lockedAt
              ? `Marks frozen since ${new Date(exam.lockedAt).toLocaleDateString()}. Unlock from /exams to edit.`
              : "Marks frozen. Unlock from /exams to edit."
          }
        />
      );
    case "published":
      return <PublishedBadge size={size} className={className} />;
    case "draft":
    default:
      return <DraftBadge size={size} className={className} />;
  }
}
