"use client";

import React from "react";
import { ArrowUpRight, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerdictIndicator } from "@/components/scanner/severity-badge";
import type { RecentScanItem } from "@/types/scan";

interface RecentScansProps {
  items: RecentScanItem[];
  onSelectRepo: (url: string) => void;
  onClearHistory: () => void;
  compact?: boolean;
}

export function RecentScansPanel({
  items,
  onSelectRepo,
  onClearHistory,
  compact = false,
}: RecentScansProps) {
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Recent Scans
          </h2>
        </div>
        {items.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearHistory}
            className="h-7 px-2 text-xs text-[var(--text-secondary)] hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear Local History
          </Button>
        )}
      </div>

      <p className="text-xs text-[var(--text-muted)] mb-4">
        History is stored exclusively in your browser&apos;s localStorage. No
        database or server-side history is used.
      </p>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-6 text-center">
          <p className="text-xs text-[var(--text-secondary)]">
            No recent scans in this browser yet. Scan a GitHub or Bitbucket
            repository above to inspect its security posture.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
          {items.map((item) => {
            const label =
              item.owner && item.name
                ? `${item.owner}/${item.name}`
                : item.repositoryUrl.replace(/^https?:\/\//, "");
            const formattedDate = new Date(item.timestamp).toLocaleString(
              undefined,
              {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }
            );

            return (
              <div
                key={item.repositoryUrl}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 py-3 first:pt-3 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectRepo(item.repositoryUrl)}
                      className="text-xs font-mono font-medium text-[var(--text-primary)] hover:text-emerald-400 transition-colors truncate text-left cursor-pointer"
                    >
                      {label}
                    </button>
                  </div>
                  {!compact && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      <span className="capitalize">{item.provider}</span>
                      {(item.primaryLanguage || item.language) && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[var(--text-secondary)]">
                            {item.primaryLanguage || item.language}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formattedDate}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <div className="text-right font-mono text-xs tabular-nums">
                    <span className="text-[var(--text-muted)]">Score </span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {item.score}/100
                    </span>
                  </div>
                  <VerdictIndicator verdict={item.verdict} size="sm" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onSelectRepo(item.repositoryUrl)}
                    className="h-7 px-2.5 text-[11px]"
                  >
                    <span>Scan</span>
                    <ArrowUpRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
