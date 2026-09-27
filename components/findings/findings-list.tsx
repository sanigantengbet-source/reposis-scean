"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Eye, FileCode, Search, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SeverityIndicator } from "@/components/scanner/severity-badge";
import {
  FindingDetailBody,
  FindingDetailDialog,
} from "@/components/findings/finding-detail-dialog";
import type { FindingSeverity, SecurityFinding } from "@/types/scan";
import { cn } from "@/lib/utils";

const SEVERITY_FILTER_OPTIONS: Array<{
  id: "all" | FindingSeverity;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

export const CANONICAL_CATEGORIES = [
  {
    id: "code-execution",
    label: "Code Execution",
    aliases: ["code execution", "code-execution"],
  },
  {
    id: "network-exfiltration",
    label: "Network & Exfiltration",
    aliases: [
      "network & exfiltration",
      "network-exfiltration",
      "data exfiltration",
    ],
  },
  {
    id: "filesystem-access",
    label: "File System Access",
    aliases: [
      "file system access",
      "filesystem-access",
      "credential theft",
    ],
  },
  {
    id: "obfuscation",
    label: "Obfuscation",
    aliases: ["obfuscation"],
  },
  {
    id: "supply-chain",
    label: "Supply Chain",
    aliases: ["supply chain", "supply-chain"],
  },
  {
    id: "web-vulnerabilities",
    label: "OWASP / Injection",
    aliases: [
      "owasp / injection",
      "web-vulnerabilities",
      "web vulnerabilities",
    ],
  },
] as const;

export function matchesCanonicalCategory(
  finding: SecurityFinding,
  categoryLabelOrId: string
): boolean {
  const target = categoryLabelOrId.trim().toLowerCase();
  if (!target || target === "all") return true;

  const entry = CANONICAL_CATEGORIES.find(
    (c) =>
      c.id === target ||
      c.label.toLowerCase() === target ||
      c.aliases.some((a) => a === target)
  );

  const findingCat = (finding.category || "").trim().toLowerCase();
  const findingRawCat = (finding.rawCategoryId || "").trim().toLowerCase();

  if (entry) {
    return entry.aliases.some(
      (alias) => findingCat === alias || findingRawCat === alias
    );
  }

  return findingCat === target || findingRawCat === target;
}

interface FindingsListProps {
  findings: SecurityFinding[];
  initialCategoryFilter?: string;
  initialSeverityFilter?: "all" | FindingSeverity;
  controlledCategoryFilter?: string;
  onCategoryFilterChange?: (category: string) => void;
  externalSelectedFindingId?: string | null;
  externalSearchQuery?: string;
  onFlagFalsePositive?: (finding: SecurityFinding) => void;
}

export function FindingsList({
  findings,
  initialCategoryFilter = "all",
  initialSeverityFilter = "all",
  controlledCategoryFilter,
  onCategoryFilterChange,
  externalSelectedFindingId,
  externalSearchQuery,
  onFlagFalsePositive,
}: FindingsListProps) {
  const [severityFilter, setSeverityFilter] = useState<
    "all" | FindingSeverity
  >(initialSeverityFilter);
  const [internalCategoryFilter, setInternalCategoryFilter] = useState<string>(
    initialCategoryFilter
  );
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [selectedFinding, setSelectedFinding] =
    useState<SecurityFinding | null>(null);
  const [dismissedExternalId, setDismissedExternalId] = useState<string | null>(
    null
  );

  const categoryFilter =
    controlledCategoryFilter !== undefined
      ? controlledCategoryFilter
      : internalCategoryFilter;

  const setCategoryFilter = (next: string) => {
    setInternalCategoryFilter(next);
    onCategoryFilterChange?.(next);
  };

  const searchQuery =
    internalSearchQuery !== ""
      ? internalSearchQuery
      : externalSearchQuery || "";

  const setSearchQuery = (next: string) => {
    setInternalSearchQuery(next);
  };

  const activeSelectedFinding = useMemo(() => {
    if (selectedFinding) return selectedFinding;
    if (
      externalSelectedFindingId &&
      externalSelectedFindingId !== dismissedExternalId
    ) {
      return (
        findings.find((f) => f.id === externalSelectedFindingId) ?? null
      );
    }
    return null;
  }, [
    selectedFinding,
    externalSelectedFindingId,
    dismissedExternalId,
    findings,
  ]);

  const severityCounts = useMemo(() => {
    const counts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const f of findings) {
      if (f.severity === "critical") counts.critical++;
      else if (f.severity === "high") counts.high++;
      else if (f.severity === "medium") counts.medium++;
      else counts.low++;
    }
    return counts;
  }, [findings]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const cat of CANONICAL_CATEGORIES) {
      map[cat.label] = findings.filter((f) =>
        matchesCanonicalCategory(f, cat.label)
      ).length;
    }
    return map;
  }, [findings]);

  const filteredFindings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return findings.filter((f) => {
      if (severityFilter !== "all") {
        if (severityFilter === "low") {
          if (f.severity !== "low" && f.severity !== "info") return false;
        } else if (f.severity !== severityFilter) {
          return false;
        }
      }

      if (categoryFilter !== "all") {
        if (!matchesCanonicalCategory(f, categoryFilter)) {
          return false;
        }
      }

      if (q) {
        const fileMatch = f.file?.toLowerCase().includes(q) ?? false;
        const titleMatch = f.title.toLowerCase().includes(q);
        const categoryMatch = f.category?.toLowerCase().includes(q) ?? false;
        const descMatch = f.description?.toLowerCase().includes(q) ?? false;
        const ruleMatch = f.ruleId?.toLowerCase().includes(q) ?? false;
        return (
          fileMatch || titleMatch || categoryMatch || descMatch || ruleMatch
        );
      }

      return true;
    });
  }, [findings, severityFilter, categoryFilter, searchQuery]);

  const handleSelectFinding = (finding: SecurityFinding) => {
    setSelectedFinding(finding);
  };

  const handleCloseFinding = () => {
    setSelectedFinding(null);
    if (externalSelectedFindingId) {
      setDismissedExternalId(externalSelectedFindingId);
    }
  };

  return (
    <div className="space-y-5">
      {/* Active Category Filter Banner (Requirement 9: e.g. "15 Obfuscation Findings") */}
      {categoryFilter !== "all" && (
        <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-mono">
          <span className="font-semibold text-amber-300">
            {filteredFindings.length} {categoryFilter}{" "}
            {filteredFindings.length === 1 ? "Finding" : "Findings"}
          </span>
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            <span>Show all</span>
          </button>
        </div>
      )}

      {/* Filter & Search Bar (Requirement 10) */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3.5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Severity Segmented Filter: All | Critical | High | Medium | Low */}
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-[var(--bg-canvas)] p-1 border border-[var(--border-subtle)]">
            {SEVERITY_FILTER_OPTIONS.map((option) => {
              const isActive = severityFilter === option.id;
              const count =
                option.id === "all"
                  ? findings.length
                  : severityCounts[option.id as keyof typeof severityCounts] ??
                    0;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSeverityFilter(option.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                    isActive
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-strong)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <span>{option.label}</span>
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search input */}
          <div className="relative w-full md:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search findings..."
              aria-label="Search findings"
              className="h-8 pl-8 pr-8 text-xs font-mono bg-[var(--bg-canvas)]"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Category Filter Buttons (Requirement 10) */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
              categoryFilter === "all"
                ? "border-lime-500/60 bg-lime-500/15 text-lime-300"
                : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            <span>All Categories</span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
              {findings.length}
            </span>
          </button>

          {CANONICAL_CATEGORIES.map((cat) => {
            const count = categoryCounts[cat.label] || 0;
            const isActive =
              categoryFilter.toLowerCase() === cat.label.toLowerCase() ||
              categoryFilter.toLowerCase() === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() =>
                  setCategoryFilter(isActive ? "all" : cat.label)
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                  isActive
                    ? "border-lime-500/60 bg-lime-500/15 text-lime-300"
                    : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                <span>{cat.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content + Desktop Finding Side Panel (Requirement 11 & 12) */}
      {findings.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
          <ShieldCheck className="mx-auto h-7 w-7 text-[var(--severity-safe)] mb-2.5" />
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
            No security findings detected
          </h4>
          <p className="mt-1 text-xs text-[var(--text-secondary)] max-w-md mx-auto">
            No known malicious patterns were matched by scanrepo during static
            analysis. Remember that absence of findings is not a guarantee that
            the repository is safe.
          </p>
        </div>
      ) : filteredFindings.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            No findings match your current filter criteria
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Try resetting the severity, category, or search filter.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setSeverityFilter("all");
              setCategoryFilter("all");
              setSearchQuery("");
            }}
          >
            Reset Filters
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-4 items-start",
            activeSelectedFinding && "xl:grid-cols-12"
          )}
        >
          {/* Left: Finding Cards List */}
          <div
            className={cn(
              "space-y-3",
              activeSelectedFinding ? "xl:col-span-7" : "col-span-1"
            )}
          >
            {filteredFindings.map((finding) => {
              const locationText = finding.file
                ? typeof finding.line === "number"
                  ? `${finding.file}:${finding.line}`
                  : finding.file
                : "Repository-wide signal";

              const isSelected = activeSelectedFinding?.id === finding.id;

              return (
                <div
                  key={finding.id}
                  id={`finding-card-${finding.id}`}
                  onClick={() => handleSelectFinding(finding)}
                  className={cn(
                    "group rounded-xl border p-4 transition-colors cursor-pointer",
                    isSelected
                      ? "border-amber-500/70 bg-[var(--bg-elevated)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]"
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <SeverityIndicator severity={finding.severity} />
                        {finding.category && (
                          <>
                            <span
                              aria-hidden="true"
                              className="text-[var(--text-muted)]"
                            >
                              ·
                            </span>
                            <span className="text-[var(--text-secondary)] font-medium">
                              {finding.category}
                            </span>
                          </>
                        )}
                        {finding.ruleId && (
                          <>
                            <span
                              aria-hidden="true"
                              className="text-[var(--text-muted)]"
                            >
                              ·
                            </span>
                            <span className="font-mono text-[11px] text-[var(--text-muted)]">
                              {finding.ruleId}
                            </span>
                          </>
                        )}
                      </div>

                      <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                        {finding.title}
                      </h4>

                      <div className="flex items-center gap-1.5 text-xs font-mono text-[var(--text-secondary)] break-all">
                        <FileCode className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                        <span>{locationText}</span>
                      </div>

                      {finding.description && (
                        <p className="text-xs text-[var(--text-secondary)] line-clamp-2 pt-0.5">
                          {finding.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center sm:self-center shrink-0">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectFinding(finding);
                        }}
                        className="w-full sm:w-auto font-mono text-xs"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>View Finding</span>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Desktop Sticky Side Panel (Requirement 12) */}
          {activeSelectedFinding && (
            <aside
              aria-label="Selected finding details panel"
              className="hidden xl:block xl:col-span-5 sticky top-20 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-lg"
            >
              <FindingDetailBody
                finding={activeSelectedFinding}
                onClose={handleCloseFinding}
                onFlagFalsePositive={onFlagFalsePositive}
              />
            </aside>
          )}
        </div>
      )}

      {/* Mobile / Tablet Bottom Sheet / Dialog (Requirement 12) */}
      <div className="xl:hidden">
        <FindingDetailDialog
          finding={activeSelectedFinding}
          open={Boolean(activeSelectedFinding)}
          onOpenChange={(open) => {
            if (!open) handleCloseFinding();
          }}
          onFlagFalsePositive={onFlagFalsePositive}
        />
      </div>
    </div>
  );
}
