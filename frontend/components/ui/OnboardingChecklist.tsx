"use client";

import * as React from "react";
import { Check, PartyPopper } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OnboardingStep } from "@/lib/use-dashboard-data";

export interface OnboardingChecklistProps {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  progress: number;
  onStepAction?: (id: string) => void;
  className?: string;
}

export function OnboardingChecklist({
  steps,
  completed,
  total,
  progress,
  onStepAction,
  className,
}: OnboardingChecklistProps) {
  const allDone = completed === total;

  return (
    <div
      className={cn(
        "glass relative overflow-hidden rounded-xl p-5",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-md font-semibold tracking-tight text-foreground">
            {allDone ? "You're all set" : "Get set up"}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {allDone
              ? "Your workspace is fully configured."
              : `${completed} of ${total} steps complete`}
          </p>
        </div>
        {allDone && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
            <PartyPopper className="h-4 w-4" />
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary-500 via-primary-500 to-purple-500 transition-[width] duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      <ol className="mt-5 space-y-1">
        {steps.map((step, i) => {
          const isNext = !step.done && !steps.slice(0, i).some((s) => !s.done);
          return (
            <li
              key={step.id}
              className={cn(
                "group relative flex items-start gap-3 rounded-lg p-2.5 transition-colors duration-150",
                !step.done && "hover:bg-muted/50",
              )}
            >
              {/* Check circle */}
              <div
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200",
                  step.done
                    ? "border-success bg-success text-white shadow-sm"
                    : isNext
                      ? "border-primary bg-primary/10"
                      : "border-border bg-surface",
                )}
              >
                {step.done && <Check className="h-3 w-3" strokeWidth={3} />}
                {!step.done && isNext && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                )}
              </div>

              {/* Text + optional CTA */}
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium transition-colors",
                    step.done
                      ? "text-muted-foreground line-through"
                      : "text-foreground",
                  )}
                >
                  {step.title}
                </p>
                {!step.done && (
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                )}
                {!step.done && isNext && step.cta && (
                  <button
                    type="button"
                    onClick={() => onStepAction?.(step.id)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-700 transition-colors focus-ring rounded-sm"
                  >
                    {step.cta}
                    <span className="transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
