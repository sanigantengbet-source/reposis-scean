"use client";

import React, { useEffect, useState } from "react";
import { Check, Loader2, Shield } from "lucide-react";

const SCAN_STAGES = [
  "Analyzing repository",
  "Checking security patterns",
  "Analyzing findings",
  "Preparing report",
];

export function ScanLoadingState({ repositoryUrl }: { repositoryUrl?: string }) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveStepIndex((prev) =>
        prev < SCAN_STAGES.length - 1 ? prev + 1 : prev
      );
    }, 2600);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <Shield className="h-4 w-4 text-emerald-500 shrink-0" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
            Scanning repository...
          </h3>
        </div>
        <span className="text-xs font-mono text-[var(--text-secondary)] whitespace-nowrap">
          Static Analysis Engine
        </span>
      </div>

      {repositoryUrl && (
        <p className="mb-4 text-xs font-mono text-[var(--text-secondary)] truncate">
          Target: {repositoryUrl}
        </p>
      )}

      {/* Indeterminate progress bar — no fake percentages */}
      <div className="mb-5">
        <div
          aria-hidden="true"
          className="h-2.5 w-full overflow-hidden rounded-sm bg-[var(--bg-elevated)] border border-[var(--border-subtle)]"
        >
          <div className="h-full w-2/5 rounded-xs bg-emerald-500 animate-scan-bar" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SCAN_STAGES.map((stage, idx) => {
          const isCompleted = idx < activeStepIndex;
          const isCurrent = idx === activeStepIndex;
          return (
            <div
              key={stage}
              className="flex items-center gap-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-xs"
            >
              {isCompleted ? (
                <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              ) : isCurrent ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500 shrink-0" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-[var(--border-strong)] shrink-0 ml-1 mr-0.5" />
              )}
              <span
                className={
                  isCurrent
                    ? "font-medium text-[var(--text-primary)]"
                    : isCompleted
                      ? "text-[var(--text-secondary)]"
                      : "text-[var(--text-muted)]"
                }
              >
                {stage}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
