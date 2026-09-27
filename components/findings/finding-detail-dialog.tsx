"use client";

import React from "react";
import { Flag, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SeverityIndicator } from "@/components/scanner/severity-badge";
import type { SecurityFinding } from "@/types/scan";

interface FindingDetailDialogProps {
  finding: SecurityFinding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFlagFalsePositive?: (finding: SecurityFinding) => void;
}

export function FindingDetailBody({
  finding,
  onClose,
  onFlagFalsePositive,
}: {
  finding: SecurityFinding;
  onClose?: () => void;
  onFlagFalsePositive?: (finding: SecurityFinding) => void;
}) {
  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3.5">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityIndicator severity={finding.severity} />
            {finding.ruleId && (
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {finding.ruleId}
              </span>
            )}
            {typeof finding.points === "number" && (
              <span className="font-mono text-[11px] text-amber-400">
                +{finding.points} pts
              </span>
            )}
          </div>
          <h3 className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
            {finding.title}
          </h3>
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Close finding panel"
            onClick={onClose}
            className="rounded-sm p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">
            Severity
          </div>
          <div className="flex items-center gap-2">
            <SeverityIndicator severity={finding.severity} />
            {finding.rawSeverity &&
              finding.rawSeverity.toLowerCase() !== finding.severity && (
                <span className="font-mono text-[11px] text-[var(--text-muted)]">
                  (scanner: {finding.rawSeverity})
                </span>
              )}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">
            Category
          </div>
          <div className="font-medium text-[var(--text-primary)]">
            {finding.category ?? "Uncategorized"}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">
            File
          </div>
          <div className="font-mono text-[var(--text-primary)] break-all">
            {finding.file ?? "Not specified (repository-level signal)"}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">
            Line
          </div>
          <div className="font-mono tabular-nums text-[var(--text-primary)]">
            {typeof finding.line === "number"
              ? finding.line
              : "Not provided by scanner"}
          </div>
        </div>
      </div>

      <div>
        <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
          Description
        </div>
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-xs leading-relaxed text-[var(--text-primary)]">
          {finding.description ?? "No additional description provided."}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
          Evidence
        </div>
        {finding.evidence ? (
          <pre className="overflow-x-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-all">
            {finding.evidence}
          </pre>
        ) : (
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-xs text-[var(--text-muted)]">
            No code snippet or evidence attached to this rule match.
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
          Recommendation
        </div>
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          {finding.recommendation ? (
            finding.recommendation
          ) : (
            <>
              <p className="font-medium text-[var(--text-primary)]">
                Recommendation unavailable.
              </p>
              <p className="mt-0.5">Review this finding manually.</p>
            </>
          )}
        </div>
      </div>

      {onFlagFalsePositive && (
        <div className="border-t border-[var(--border-subtle)] pt-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onFlagFalsePositive(finding)}
            className="font-mono text-xs"
          >
            <Flag className="h-3.5 w-3.5 text-amber-400" />
            <span>FLAG FALSE POSITIVE</span>
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Mobile Full-Screen Bottom Sheet / Dialog for Finding Detail (Requirement 12)
 */
export function FindingDetailDialog({
  finding,
  open,
  onOpenChange,
  onFlagFalsePositive,
}: FindingDetailDialogProps) {
  if (!finding) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:max-h-[90vh] sm:max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{finding.title}</DialogTitle>
          <DialogDescription>
            Detailed security finding inspection for {finding.file || "repository"}
          </DialogDescription>
        </DialogHeader>
        <FindingDetailBody
          finding={finding}
          onFlagFalsePositive={onFlagFalsePositive}
        />
      </DialogContent>
    </Dialog>
  );
}
