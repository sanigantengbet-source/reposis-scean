"use client";

import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerdictIndicator } from "@/components/scanner/severity-badge";
import type { ScanErrorCode } from "@/types/scan";

interface ScanErrorStateProps {
  code?: ScanErrorCode;
  message?: string;
  onRetry: () => void;
}

export function ScanErrorState({
  code,
  message,
  onRetry,
}: ScanErrorStateProps) {
  return (
    <div
      role="alert"
      className="w-full rounded-lg border border-[var(--severity-critical-border)] bg-[var(--bg-surface)] p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 text-[var(--severity-critical)] shrink-0" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Unable to scan repository.
          </h3>
        </div>
        <VerdictIndicator verdict="failed" size="sm" />
      </div>

      <p className="text-xs leading-relaxed text-[var(--text-secondary)] mb-2">
        The repository may be unavailable, unsupported, rate-limited, or the
        scanner encountered an error.
      </p>

      {message && (
        <div className="mt-3 mb-4 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5 text-xs font-mono text-[var(--text-primary)]">
          {code ? `[${code}] ` : ""}
          {message}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          <RotateCcw className="h-3.5 w-3.5" />
          Try Again
        </Button>
      </div>
    </div>
  );
}
