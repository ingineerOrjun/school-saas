"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-16",
        "animate-fade-in-up",
        className,
      )}
    >
      {/* Layered "illustration" — three stacked translucent cards */}
      <div className="relative mb-7 h-24 w-24">
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary-200/70 to-primary-100/40 rotate-[8deg] shadow-sm" />
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-purple-200/70 to-indigo-100/30 -rotate-[6deg] shadow-sm" />
        <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-surface/85 backdrop-blur-sm border border-border shadow-md text-primary">
          {icon}
        </div>
      </div>

      <h3 className="text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      {description && (
        <p className="mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      )}

      {(action || secondaryAction) && (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <Button onClick={action.onClick} leftIcon={action.icon} size="lg">
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="ghost"
              onClick={secondaryAction.onClick}
              leftIcon={secondaryAction.icon}
              size="lg"
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
