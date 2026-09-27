"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  Flag,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FLAG_REASONS = [
  { id: "false_positive", label: "False positive" },
  { id: "harmless", label: "Finding is harmless" },
  { id: "incorrect_severity", label: "Incorrect severity" },
  { id: "other", label: "Other" },
] as const;

interface FlagFalsePositiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryUrl?: string;
  findingTitle?: string;
  ruleId?: string;
}

/**
 * Requirement 26: Flag False Positive Modal
 * Strictly stateless (no database). Does not pretend to persist feedback permanently.
 */
export function FlagFalsePositiveDialog({
  open,
  onOpenChange,
  repositoryUrl,
  findingTitle,
  ruleId,
}: FlagFalsePositiveDialogProps) {
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [submittedNotice, setSubmittedNotice] = useState(false);

  const toggleReason = (id: string) => {
    setSelectedReasons((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
    setSubmittedNotice(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedNotice(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSubmittedNotice(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-xs font-mono text-amber-400 mb-1">
            <Flag className="h-3.5 w-3.5" />
            <span>REPORT FALSE POSITIVE</span>
          </div>
          <DialogTitle className="text-base font-semibold text-[var(--text-primary)]">
            Why are you flagging this finding?
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--text-secondary)]">
            {findingTitle
              ? `Flagging: ${findingTitle}${ruleId ? ` (${ruleId})` : ""}`
              : repositoryUrl
                ? `Target repository: ${repositoryUrl}`
                : "Select one or more reasons below."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          <div className="space-y-2">
            {FLAG_REASONS.map((reason) => {
              const checked = selectedReasons.includes(reason.id);
              return (
                <label
                  key={reason.id}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md border px-3 py-2.5 cursor-pointer transition-colors",
                    checked
                      ? "border-amber-500/60 bg-amber-500/10 text-[var(--text-primary)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleReason(reason.id)}
                    className="h-3.5 w-3.5 accent-amber-500 rounded-xs"
                  />
                  <span className="font-mono text-xs">{reason.label}</span>
                </label>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="fp-additional-comment"
              className="block text-[11px] font-mono text-[var(--text-muted)]"
            >
              Additional comment
            </label>
            <textarea
              id="fp-additional-comment"
              rows={3}
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                setSubmittedNotice(false);
              }}
              placeholder="Explain why this pattern or verdict is benign..."
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-500"
            />
          </div>

          {submittedNotice && (
            <div
              role="status"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-2"
            >
              <div className="flex items-start gap-2 text-amber-300 font-mono">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Feedback submission is not configured.</span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                RepoScan runs in a strictly stateless architecture with no
                database. Your flag has been noted for this browser session only
                and is not stored on a server.
              </p>
              <a
                href="https://scanrepo.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-mono text-lime-400 hover:underline"
              >
                <span>Open upstream ScanRepo service</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
            >
              Close
            </Button>
            <Button type="submit" size="sm" className="font-mono">
              Submit Feedback
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type VerdictFeedbackChoice = "accurate" | "too_high" | "too_low" | null;

interface VerdictFeedbackControlProps {
  repositoryKey: string;
}

/**
 * Requirement 27: VERDICT ACCURATE?
 * Buttons: 👍 ACCURATE | 👎 TOO HIGH | 👎 TOO LOW
 * Stores feedback in local browser session only — never claims permanent server storage.
 */
export function VerdictFeedbackControl({
  repositoryKey,
}: VerdictFeedbackControlProps) {
  const [choice, setChoice] = useState<VerdictFeedbackChoice>(null);

  const handleSelect = (next: VerdictFeedbackChoice) => {
    const updated = choice === next ? null : next;
    setChoice(updated);
    if (typeof window !== "undefined") {
      try {
        const key = `reposcan_verdict_fb_${repositoryKey}`;
        if (updated) {
          window.sessionStorage.setItem(key, updated);
        } else {
          window.sessionStorage.removeItem(key);
        }
      } catch {
        // ignore storage errors
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)] mr-1">
          VERDICT ACCURATE?
        </span>

        <button
          type="button"
          onClick={() => handleSelect("accurate")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs transition-colors cursor-pointer",
            choice === "accurate"
              ? "border-lime-500/60 bg-lime-500/15 text-lime-300"
              : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          )}
        >
          <ThumbsUp className="h-3 w-3" />
          <span>accurate</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelect("too_high")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs transition-colors cursor-pointer",
            choice === "too_high"
              ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
              : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          )}
        >
          <ThumbsDown className="h-3 w-3" />
          <span>too high</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelect("too_low")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs transition-colors cursor-pointer",
            choice === "too_low"
              ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
              : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          )}
        >
          <ThumbsDown className="h-3 w-3" />
          <span>too low</span>
        </button>
      </div>

      {choice && (
        <p className="font-mono text-[11px] text-[var(--text-muted)]">
          Recorded in local browser session only (stateless mode — no database
          configured).
        </p>
      )}
    </div>
  );
}
