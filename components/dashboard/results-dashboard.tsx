"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  FileCode,
  FileJson,
  Flag,
  GitFork,
  Layers,
  ListFilter,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Share2,
  ShieldAlert,
  Star,
} from "lucide-react";
import {
  Navbar,
  WHATSAPP_CHANNEL_URL,
  WhatsAppIcon,
} from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { VerdictIndicator } from "@/components/scanner/severity-badge";
import { ScanLoadingState } from "@/components/scanner/loading-state";
import { ScanErrorState } from "@/components/scanner/error-state";
import {
  CANONICAL_CATEGORIES,
  FindingsList,
  matchesCanonicalCategory,
} from "@/components/findings/findings-list";
import { ArchitectureGraph } from "@/components/dashboard/architecture-graph";
import {
  FlagFalsePositiveDialog,
  VerdictFeedbackControl,
} from "@/components/dashboard/feedback-modals";
import { RawJsonViewer } from "@/components/dashboard/raw-json-viewer";
import {
  saveRecentScanMetadata,
  setActiveScanResult,
} from "@/lib/utils/recent-scans";
import type {
  ScanApiErrorResponse,
  ScanErrorCode,
  ScanResult,
  SecurityFinding,
} from "@/types/scan";
import { cn } from "@/lib/utils";

interface ResultsDashboardProps {
  initialResult?: ScanResult;
  result?: ScanResult;
  onUpdateResult?: (updated: ScanResult) => void;
}

function downloadScanJson(
  data: Record<string, unknown>,
  filename = "repository-scan.json"
) {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function formatRelativeAge(isoDate?: string): string | null {
  if (!isoDate) return null;
  const ts = new Date(isoDate).getTime();
  if (!Number.isFinite(ts)) return null;
  const diffDays = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
  if (diffDays === 0) return "today";
  if (diffDays < 30) return `${diffDays}d`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  const years = Math.floor(diffDays / 365);
  return `${years}y`;
}

function formatShortTimeAgo(isoDate?: string): string {
  if (!isoDate) return "just now";
  const ts = new Date(isoDate).getTime();
  if (!Number.isFinite(ts)) return "just now";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getLanguageAbbreviation(lang?: string | null): string | null {
  if (!lang) return null;
  const lower = lang.trim().toLowerCase();
  if (!lower || lower === "unknown" || lower === "multiple") return null;
  if (lower === "c") return "C";
  if (lower === "c++") return "C++";
  if (lower === "c#") return "C#";
  if (lower === "java") return "JAVA";
  if (lower === "typescript") return "TS";
  if (lower === "javascript") return "JS";
  if (lower === "python") return "PY";
  if (lower === "rust") return "RS";
  if (lower === "go") return "GO";
  if (lower === "ruby") return "RB";
  if (lower === "php") return "PHP";
  if (lower === "swift") return "SWIFT";
  if (lower === "kotlin") return "KT";
  if (lower === "dart") return "DART";
  if (lower === "shell") return "SH";
  if (lower === "powershell") return "PS";
  if (lower === "lua") return "LUA";
  if (lower === "r") return "R";
  if (lower === "scala") return "SCALA";
  if (lower === "objective-c") return "OBJC";
  if (lower === "sql") return "SQL";
  if (lower === "html") return "HTML";
  if (lower === "css") return "CSS";
  if (lower === "vue") return "VUE";
  if (lower === "svelte") return "SVELTE";
  if (lower === "solidity") return "SOL";
  return lang.slice(0, 3).toUpperCase();
}

export function ResultsDashboard({
  initialResult,
  result: propResult,
  onUpdateResult,
}: ResultsDashboardProps) {
  const [internalResult, setInternalResult] = useState<ScanResult | null>(
    propResult ?? initialResult ?? null
  );
  const result = propResult ?? internalResult ?? initialResult!;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<{
    code?: ScanErrorCode;
    message: string;
  } | null>(null);

  // Filter & jump state synced between Risk by Category, Architecture Graph, and Findings Explorer
  const [selectedCategoryFilter, setSelectedCategoryFilter] =
    useState<string>("all");
  const [externalSelectedFindingId, setExternalSelectedFindingId] = useState<
    string | null
  >(null);
  const [externalFindingSearch, setExternalFindingSearch] =
    useState<string>("");

  // Share Report state (Requirement 25)
  const [shareCopied, setShareCopied] = useState(false);

  // Flag False Positive modal state (Requirement 26)
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [flaggedFindingTarget, setFlaggedFindingTarget] =
    useState<SecurityFinding | null>(null);

  /**
   * Requirement 24 & Preservation Rule #2:
   * Rescan via POST /api/scan with 3-attempt warmup auto-retry and rescan: true
   */
  const handleScanAgain = async () => {
    if (isRescanning) return;
    setIsRescanning(true);
    setRescanError(null);

    try {
      let response: Response | null = null;
      let payload: ScanResult | ScanApiErrorResponse | null = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch("/api/scan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Cache-Control": "no-cache",
          },
          cache: "no-store",
          body: JSON.stringify({
            repositoryUrl: result.repository.url,
            rescan: true,
          }),
        });

        const rawText = await response.text();
        try {
          payload = JSON.parse(rawText) as ScanResult | ScanApiErrorResponse;
          break;
        } catch {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          setRescanError({
            code: "SCAN_FAILED",
            message: `Scanner server returned an unexpected response (HTTP ${response.status}). Please try again.`,
          });
          setIsRescanning(false);
          return;
        }
      }

      if (!response || !response.ok || !payload || "error" in payload) {
        const apiErr =
          payload && "error" in payload
            ? payload.error
            : {
                code: "SCAN_FAILED" as const,
                message: "Unable to rescan repository.",
              };
        setRescanError({
          code: apiErr.code,
          message: apiErr.message,
        });
        setIsRescanning(false);
        return;
      }

      const freshResult = payload as ScanResult;
      setInternalResult(freshResult);
      setActiveScanResult(freshResult);
      saveRecentScanMetadata(freshResult);
      onUpdateResult?.(freshResult);
    } catch {
      setRescanError({
        code: "UNEXPECTED_ERROR",
        message: "Network error occurred while rescanning repository.",
      });
    } finally {
      setIsRescanning(false);
    }
  };

  const canonicalReportPath = useMemo(() => {
    const provider = result.repository.provider || "github";
    const owner = result.repository.owner;
    const name = result.repository.name;
    if (owner && name) {
      const base = `/scan/${encodeURIComponent(provider)}/${encodeURIComponent(
        owner
      )}/${encodeURIComponent(name)}`;
      if (result.repository.subdir) {
        return `${base}?subdir=${encodeURIComponent(result.repository.subdir)}`;
      }
      return base;
    }
    return "/results";
  }, [result.repository]);

  /**
   * Requirement 25: Share Report (Web Share API on mobile or Copy canonical scan URL on desktop)
   */
  const handleShareReport = async () => {
    if (typeof window === "undefined") return;
    const shareUrl = `${window.location.origin}${canonicalReportPath}`;
    const repoLabel =
      result.repository.owner && result.repository.name
        ? `${result.repository.owner}/${result.repository.name}`
        : result.repository.url;

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      window.matchMedia("(max-width: 768px)").matches
    ) {
      try {
        await navigator.share({
          title: `RepoScan Security Report — ${repoLabel}`,
          text: `Security scan for ${repoLabel}: Risk Score ${result.score}/100 (${(
            result.rawVerdict || result.verdict
          ).toUpperCase()})`,
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback to clipboard copy if user cancels or share fails
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch {
      // ignore clipboard errors
    }
  };

  /**
   * Requirement 8: Risk by Category counts computed strictly from ScanRepo findings
   */
  const categoryBreakdown = useMemo(() => {
    return CANONICAL_CATEGORIES.map((cat) => {
      const matchedFindings = result.findings.filter((f) =>
        matchesCanonicalCategory(f, cat.label)
      );
      const rawCat = result.categories.find(
        (c) =>
          c.id.toLowerCase() === cat.id ||
          c.normalizedName.toLowerCase() === cat.label.toLowerCase()
      );
      const count = matchedFindings.length;
      const score =
        rawCat?.score ??
        matchedFindings.reduce((acc, item) => acc + (item.points ?? 0), 0);
      const maxScore = rawCat?.maxScore ?? 25;

      return {
        id: cat.id,
        label: cat.label,
        displayLower: cat.label.toLowerCase(),
        count,
        score,
        maxScore,
      };
    });
  }, [result.findings, result.categories]);

  const maxCategoryFindings = useMemo(() => {
    const maxVal = Math.max(...categoryBreakdown.map((c) => c.count), 0);
    return Math.max(maxVal, 10);
  }, [categoryBreakdown]);

  /**
   * Requirement 9: Clicking a category filters Findings Explorer and smooth-scrolls to #findings-section
   */
  const handleSelectCategory = useCallback((categoryLabel: string) => {
    setSelectedCategoryFilter((prev) =>
      prev.toLowerCase() === categoryLabel.toLowerCase() ? "all" : categoryLabel
    );
    const el = document.getElementById("findings-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  /**
   * Requirement 16: Clicking "Jump to finding" in Architecture Graph jumps to the finding
   */
  const handleJumpToFinding = useCallback(
    (findingId?: string, filePath?: string) => {
      setSelectedCategoryFilter("all");
      if (findingId) {
        setExternalSelectedFindingId(findingId);
      } else if (filePath) {
        const match = result.findings.find(
          (f) =>
            f.file === filePath ||
            f.file?.endsWith(`/${filePath}`) ||
            filePath.endsWith(`/${f.file || ""}`)
        );
        if (match) {
          setExternalSelectedFindingId(match.id);
        } else {
          setExternalFindingSearch(filePath.split("/").pop() || filePath);
        }
      }

      const el = document.getElementById("findings-section");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [result.findings]
  );

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const repoTitle =
    result.repository.owner && result.repository.name
      ? `${result.repository.owner}/${result.repository.name}`
      : result.repository.url.replace(/^https?:\/\//, "");

  const providerDomain =
    result.repository.provider === "bitbucket"
      ? "bitbucket.org"
      : "github.com";

  const providerDisplay =
    result.repository.provider === "bitbucket" ? "BITBUCKET" : "GITHUB";

  const shortCommitSha = result.repository.commitSha
    ? result.repository.commitSha.slice(0, 7)
    : null;

  const filesScanned = result.repository.filesScanned;
  const totalRepoFiles = result.repository.totalRepoFiles;

  // Requirement 21: Coverage calculation (scanned / total * 100) only when total is available
  const coveragePercentage = useMemo(() => {
    if (
      typeof filesScanned === "number" &&
      typeof totalRepoFiles === "number" &&
      totalRepoFiles > 0
    ) {
      return Math.min(100, Math.round((filesScanned / totalRepoFiles) * 100));
    }
    if (typeof result.repository.coverage === "number") {
      return Math.min(100, Math.round(result.repository.coverage * 100));
    }
    return null;
  }, [filesScanned, totalRepoFiles, result.repository.coverage]);

  const distinctRulesHit = useMemo(() => {
    if (typeof result.rulesHit === "number") return result.rulesHit;
    const set = new Set(
      result.findings
        .map((f) => f.ruleId)
        .filter((r): r is string => Boolean(r))
    );
    return set.size > 0 ? set.size : result.findings.length;
  }, [result.rulesHit, result.findings]);

  const formattedDateShort = useMemo(() => {
    const d = new Date(result.scannedAt);
    if (Number.isNaN(d.getTime())) return "—";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }, [result.scannedAt]);

  const primaryLanguage =
    result.repository.primaryLanguage ??
    result.repository.language ??
    "Unknown";
  const langAbbrev = getLanguageAbbreviation(primaryLanguage);
  const repoAge = formatRelativeAge(result.repository.createdAt);
  const scannedTimeAgo = formatShortTimeAgo(result.scannedAt);

  // Radial gauge SVG parameters (Requirement 4)
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.max(0, Math.min(100, result.score));
  const strokeDashoffset =
    circumference - (clampedScore / 100) * circumference;

  const scoreAccentColor =
    result.score >= 56
      ? "#ef4444"
      : result.score >= 31
        ? "#eab308"
        : "#84cc16";

  const scoreTextColorClass =
    result.score >= 56
      ? "text-red-400"
      : result.score >= 31
        ? "text-amber-400"
        : "text-lime-400";

  // Requirement 29: Scan Status (SCANNING | COMPLETED | FAILED | CACHED)
  const scanStatusLabel = isRescanning
    ? "SCANNING"
    : rescanError
      ? "FAILED"
      : result.cached
        ? "CACHED"
        : "COMPLETED";

  const SidebarContent = (
    <div className="space-y-6">
      {/* Platform Navigation (Requirement 31) */}
      <div>
        <div className="px-2 mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          Security Workspace
        </div>
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => scrollToSection("report-header-section")}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium text-[var(--text-primary)] bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-lime-400" />
              <span>Overview</span>
            </span>
            <span className="font-mono text-[10px] text-lime-400">
              {result.score}/100
            </span>
          </button>

          <Link
            href="/scan"
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors"
          >
            <span className="flex items-center gap-2">
              <Plus className="h-3.5 w-3.5" />
              <span>Scan</span>
            </span>
          </Link>

          <button
            type="button"
            onClick={() => scrollToSection("risk-categories-section")}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>Security</span>
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
              {result.findings.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => scrollToSection("architecture-section")}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Network className="h-3.5 w-3.5" />
              <span>Architecture</span>
            </span>
            {result.graph && (
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                {result.graph.counts.totalNodes}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => scrollToSection("telemetry-section")}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <FileCode className="h-3.5 w-3.5" />
              <span>Files & Telemetry</span>
            </span>
            {typeof filesScanned === "number" && (
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                {filesScanned}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => scrollToSection("findings-section")}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <ListFilter className="h-3.5 w-3.5" />
              <span>Findings</span>
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
              {result.findings.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowRawJson(true);
              setTimeout(() => scrollToSection("raw-json-section"), 50);
            }}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <FileJson className="h-3.5 w-3.5" />
              <span>Raw JSON</span>
            </span>
          </button>
        </div>
      </div>

      {/* Scan Status & Summary */}
      <div className="border-t border-[var(--border-subtle)] pt-5">
        <div className="px-2 mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          Scan Status
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold text-[var(--text-secondary)]">
              {scanStatusLabel}
            </span>
            {result.cached ? (
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-lime-400">
                <Check className="h-3 w-3" />
                <span>CACHED</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-lime-400">
                <span className="h-2 w-2 rounded-full bg-lime-400 animate-pulse" />
                <span>LIVE</span>
              </span>
            )}
          </div>

          <div className="font-mono text-xs font-semibold text-[var(--text-primary)] break-all">
            {repoTitle}
          </div>

          <dl className="space-y-1.5 border-t border-[var(--border-subtle)] pt-2.5 text-[11px] font-mono">
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-muted)]">Provider</dt>
              <dd className="text-[var(--text-primary)]">{providerDisplay}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-muted)]">Commit</dt>
              <dd className="text-[var(--text-primary)]">
                {shortCommitSha ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-muted)]">Engine</dt>
              <dd className="text-[var(--text-primary)]">
                {result.scannerVersion ? `v${result.scannerVersion}` : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-muted)]">Rules hit</dt>
              <dd className="text-amber-400">{distinctRulesHit}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="border-t border-[var(--border-subtle)] pt-5 space-y-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isRescanning}
          onClick={() => void handleScanAgain()}
          className="w-full justify-start font-mono text-xs"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", isRescanning && "animate-spin")}
          />
          <span>{isRescanning ? "RESCANNING..." : "↻ RESCAN"}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleShareReport()}
          className="w-full justify-start font-mono text-xs"
        >
          {shareCopied ? (
            <Check className="h-3.5 w-3.5 text-lime-400" />
          ) : (
            <Share2 className="h-3.5 w-3.5" />
          )}
          <span>{shareCopied ? "COPIED LINK ✓" : "↑ SHARE REPORT"}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            downloadScanJson(result.rawOutput, "repository-scan.json")
          }
          className="w-full justify-start font-mono text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          <span>EXPORT JSON</span>
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)]">
      <Navbar sidebarSlot={SidebarContent} />

      <div className="mx-auto flex w-full max-w-[1440px] flex-1">
        {/* Desktop & Tablet Collapsible Sidebar (Requirements 31 & 32) */}
        <aside
          className={cn(
            "hidden md:block shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 transition-all duration-200",
            sidebarCollapsed ? "w-14 p-2" : "w-64 p-4"
          )}
        >
          <div
            className={cn(
              "flex items-center mb-3",
              sidebarCollapsed ? "flex-col gap-2 justify-center" : "justify-between"
            )}
          >
            <a
              href={WHATSAPP_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp Channel"
              title="WhatsApp Channel"
              className={cn(
                "inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 text-xs font-medium text-white hover:bg-white/10 hover:border-white/25 transition-colors whitespace-nowrap",
                sidebarCollapsed ? "h-8 w-8 justify-center" : "h-8 px-2.5"
              )}
            >
              <WhatsAppIcon className="h-4 w-4" />
              {!sidebarCollapsed && <span>WhatsApp Channel</span>}
            </a>
            <button
              type="button"
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>
          {!sidebarCollapsed && SidebarContent}
        </aside>

        {/* Main Report Flow (Requirement 43 Information Architecture) */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-6">
          {/* Rescanning Banner (Requirement 24: "Rescanning... Do not close this page.") */}
          {isRescanning && (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs font-mono text-amber-300 flex items-center justify-between">
                <span>Rescanning... Do not close this page.</span>
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
              </div>
              <ScanLoadingState repositoryUrl={result.repository.url} />
            </div>
          )}

          {!isRescanning && rescanError && (
            <ScanErrorState
              code={rescanError.code}
              message={rescanError.message}
              onRetry={() => void handleScanAgain()}
            />
          )}

          {/* 1. REPOSITORY HEADER + RADIAL RISK SCORE + VERDICT + FEEDBACK + ACTIONS (Requirements 3, 4, 5, 24-29, Screenshot #1) */}
          <section
            id="report-header-section"
            className="rounded-2xl border border-amber-500/30 bg-[var(--bg-surface)] p-5 sm:p-7 space-y-6 shadow-sm"
          >
            {/* Top Provider & Repository Identity */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <span>{providerDomain}</span>
                  <span aria-hidden="true">/</span>
                  <span className="text-[var(--text-secondary)]">
                    {result.repository.owner || "repository"}
                  </span>
                </div>

                {/* Live / Cached Status Indicator (Requirement 28 & 29) */}
                <div className="flex items-center gap-2 font-mono text-xs">
                  {result.cached ? (
                    <span className="inline-flex items-center gap-1 text-lime-400">
                      <span>Cached</span>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-lime-400">
                      <span className="h-2 w-2 rounded-full bg-lime-400" />
                      <span>Fresh scan ✓</span>
                    </span>
                  )}
                </div>
              </div>

              <h1 className="font-mono text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[var(--text-primary)] break-all">
                {repoTitle}
                {result.repository.subdir ? (
                  <span className="text-base sm:text-xl font-normal text-[var(--text-secondary)]">
                    /{result.repository.subdir}
                  </span>
                ) : null}
              </h1>

              {/* Technical Metadata Strip (Requirement 3) */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-1 font-mono text-xs text-[var(--text-secondary)]">
                {primaryLanguage && (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      {langAbbrev && (
                        <span className="inline-flex items-center justify-center rounded-xs bg-[var(--bg-elevated)] border border-[var(--border-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-primary)]">
                          {langAbbrev}
                        </span>
                      )}
                      <span>{primaryLanguage}</span>
                    </span>
                    <span aria-hidden="true" className="text-[var(--text-muted)]">
                      ·
                    </span>
                  </>
                )}

                {typeof totalRepoFiles === "number" ? (
                  <>
                    <span>{totalRepoFiles} files</span>
                    <span aria-hidden="true" className="text-[var(--text-muted)]">
                      ·
                    </span>
                  </>
                ) : typeof filesScanned === "number" ? (
                  <>
                    <span>{filesScanned} files scanned</span>
                    <span aria-hidden="true" className="text-[var(--text-muted)]">
                      ·
                    </span>
                  </>
                ) : null}

                {shortCommitSha && (
                  <>
                    <span>commit {shortCommitSha}</span>
                    <span aria-hidden="true" className="text-[var(--text-muted)]">
                      ·
                    </span>
                  </>
                )}

                <span>scanned {scannedTimeAgo}</span>
              </div>

              {/* Cached / Fresh confirmation line matching Screenshot #1 */}
              <div className="pt-0.5 font-mono text-xs text-lime-400">
                {result.cached ? "cached ✓" : "fresh scan ✓"}
              </div>
            </div>

            {/* Radial Score + Verdict + Explanation + Actions Grid */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center pt-2 border-t border-[var(--border-subtle)]">
              {/* Circular / Radial Score Indicator (Requirement 4) */}
              <div className="lg:col-span-4 flex flex-col items-start sm:items-center lg:items-start">
                <div className="relative inline-flex items-center justify-center">
                  <svg
                    className="h-40 w-40 -rotate-90 transform"
                    viewBox="0 0 148 148"
                    role="img"
                    aria-label={`Risk Score ${result.score} out of 100`}
                  >
                    <circle
                      cx="74"
                      cy="74"
                      r={radius}
                      stroke="rgba(255, 255, 255, 0.08)"
                      strokeWidth="6"
                      fill="transparent"
                    />
                    <circle
                      cx="74"
                      cy="74"
                      r={radius}
                      stroke={scoreAccentColor}
                      strokeWidth="6"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      fill="transparent"
                      className="transition-all duration-500 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center font-mono tabular-nums">
                    <span
                      className={cn(
                        "text-4xl sm:text-5xl font-bold tracking-tighter",
                        scoreTextColorClass
                      )}
                    >
                      {result.score}
                    </span>
                    <span className="mt-0.5 text-xs text-[var(--text-muted)]">
                      /100
                    </span>
                  </div>
                </div>
                <div className="mt-2 font-mono text-xs text-[var(--text-muted)]">
                  Risk Score {result.score} / 100
                </div>
              </div>

              {/* Verdict, Explanation, Action Pills, and Feedback (Requirements 5, 24, 25, 26, 27) */}
              <div className="lg:col-span-8 space-y-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <VerdictIndicator
                      verdict={result.verdict}
                      rawVerdict={result.rawVerdict}
                      size="lg"
                    />
                    <span className="font-mono text-xs text-[var(--text-muted)]">
                      STATUS: {scanStatusLabel}
                    </span>
                  </div>

                  {/* Requirement 5: Verdict Explanation */}
                  <p className="font-mono text-xs sm:text-sm leading-relaxed text-[var(--text-secondary)] max-w-2xl">
                    {result.verdictExplanation ||
                      (result.score > 30
                        ? "Obfuscation or dynamic code paths detected. Intent unclear — review before running anything."
                        : "No known-malicious patterns were found during static analysis. Always review findings manually.")}
                  </p>
                </div>

                {/* Action Pills matching Screenshot #1: ↻ RESCAN | ↑ SHARE REPORT | FLAG FALSE POSITIVE */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={isRescanning}
                    onClick={() => void handleScanAgain()}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-4 py-2 font-mono text-xs font-semibold tracking-wider uppercase text-[var(--text-primary)] hover:border-lime-500/60 hover:bg-[var(--bg-elevated)] disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <RefreshCw
                      className={cn(
                        "h-3.5 w-3.5",
                        isRescanning && "animate-spin"
                      )}
                    />
                    <span>{isRescanning ? "RESCANNING..." : "RESCAN"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleShareReport()}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-4 py-2 font-mono text-xs font-semibold tracking-wider uppercase text-[var(--text-primary)] hover:border-lime-500/60 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                  >
                    {shareCopied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-lime-400" />
                        <span className="text-lime-400">COPY LINK ✓</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="h-3.5 w-3.5" />
                        <span>SHARE REPORT</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFlaggedFindingTarget(null);
                      setFlagModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-4 py-2 font-mono text-xs font-semibold tracking-wider uppercase text-[var(--text-secondary)] hover:border-amber-500/60 hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  >
                    <Flag className="h-3.5 w-3.5 text-amber-400" />
                    <span>FLAG FALSE POSITIVE</span>
                  </button>
                </div>

                {/* Requirement 27: VERDICT ACCURATE? 👍 accurate | 👎 too high | 👎 too low */}
                <VerdictFeedbackControl repositoryKey={repoTitle} />

                {/* Badges Strip from ScanRepo (e.g. CREATED 17 DAYS AGO, Obfuscated code detected) */}
                {result.badges && result.badges.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {result.badges.map((badge, idx) => (
                      <div
                        key={`${badge.label}-${idx}`}
                        title={badge.description}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide",
                          badge.type === "danger"
                            ? "border-red-500/40 bg-red-500/15 text-red-300"
                            : badge.type === "warning"
                              ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                              : "border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-secondary)]"
                        )}
                      >
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span>{badge.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 2. DISCLAIMER & SCAN METADATA LINE (Requirements 6 & 7, Screenshot #2) */}
          <section className="space-y-2 px-1">
            <p className="font-mono text-xs leading-relaxed text-[var(--text-secondary)]">
              Scores are heuristics. A &ldquo;safe&rdquo; verdict means no
              known-malicious patterns were found — not a guarantee that the
              repository is safe. Always review findings manually.
            </p>
            <div className="font-mono text-[11px] text-[var(--text-muted)] flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {typeof filesScanned === "number"
                  ? `${filesScanned} files scanned`
                  : "Files scanned unavailable"}
              </span>
              {shortCommitSha && (
                <>
                  <span>@ {shortCommitSha}</span>
                </>
              )}
              <span aria-hidden="true">|</span>
              <span>{formattedDateShort}</span>
              <span aria-hidden="true">|</span>
              <span>
                engine{" "}
                {result.scannerVersion
                  ? `v${result.scannerVersion}`
                  : "unavailable"}
              </span>
              <span aria-hidden="true">|</span>
              <span>rules hit {distinctRulesHit}</span>
              <span aria-hidden="true">|</span>
              <span>heuristic scan — always review manually</span>
            </div>
          </section>

          {/* 3. RISK BY CATEGORY (Requirements 8 & 9, Screenshot #2) */}
          <section
            id="risk-categories-section"
            aria-label="Risk by Category"
            className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                RISK BY CATEGORY
              </h2>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                Click a category to filter findings
              </span>
            </div>

            <div className="space-y-3.5">
              {categoryBreakdown.map((cat) => {
                const isSelected =
                  selectedCategoryFilter.toLowerCase() ===
                  cat.label.toLowerCase();
                const barWidthPct =
                  cat.count > 0
                    ? Math.max(
                        8,
                        Math.min(
                          100,
                          Math.round((cat.count / maxCategoryFindings) * 100)
                        )
                      )
                    : 0;

                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleSelectCategory(cat.label)}
                    className={cn(
                      "w-full text-left group rounded-lg p-2 -mx-2 transition-colors cursor-pointer",
                      isSelected
                        ? "bg-amber-500/10 ring-1 ring-amber-500/40"
                        : "hover:bg-[var(--bg-elevated)]/60"
                    )}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs sm:text-sm text-[var(--text-primary)] group-hover:text-amber-300 transition-colors">
                            {cat.displayLower}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--text-muted)]">
                            {cat.score}/{cat.maxScore} pts
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--bg-canvas)] overflow-hidden border border-[var(--border-subtle)]">
                          <div
                            style={{ width: `${barWidthPct}%` }}
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              cat.count > 0
                                ? "bg-amber-400"
                                : "bg-transparent"
                            )}
                          />
                        </div>
                      </div>

                      <div
                        className={cn(
                          "w-10 text-right font-mono text-base sm:text-lg font-bold tabular-nums shrink-0",
                          cat.count > 0
                            ? "text-amber-400"
                            : "text-[var(--text-muted)]/50"
                        )}
                      >
                        {cat.count}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 4. TELEMETRY & REPOSITORY INFORMATION (Requirements 20, 21, 22, 23, Screenshot #2) */}
          <div
            id="telemetry-section"
            className="grid grid-cols-1 gap-6 lg:grid-cols-12"
          >
            {/* TELEMETRY CARD (Requirement 20 & 21) */}
            <section
              aria-label="Scan Telemetry"
              className="lg:col-span-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 flex flex-col justify-between space-y-5"
            >
              <div className="space-y-4">
                <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                  TELEMETRY
                </h2>

                <div className="grid grid-cols-2 gap-y-5 gap-x-6 font-mono">
                  <div>
                    <div className="text-xs text-[var(--text-muted)]">
                      files
                    </div>
                    <div className="mt-1 text-base sm:text-lg font-bold text-[var(--text-primary)] tabular-nums">
                      {typeof filesScanned === "number"
                        ? typeof totalRepoFiles === "number"
                          ? `${filesScanned}/${totalRepoFiles}`
                          : `${filesScanned}`
                        : "Unavailable"}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-[var(--text-muted)]">
                      rules hit
                    </div>
                    <div className="mt-1 text-base sm:text-lg font-bold text-amber-400 tabular-nums">
                      {distinctRulesHit}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-[var(--text-muted)]">
                      engine
                    </div>
                    <div className="mt-1 text-base sm:text-lg font-bold text-[var(--text-primary)]">
                      {result.scannerVersion
                        ? `v${result.scannerVersion}`
                        : "Engine version unavailable"}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-[var(--text-muted)]">
                      commit
                    </div>
                    <div className="mt-1 text-base sm:text-lg font-bold text-[var(--text-primary)]">
                      {shortCommitSha ?? "Unavailable"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Coverage Bar & Calculation (Requirement 21) */}
              <div className="border-t border-[var(--border-subtle)] pt-4 space-y-2 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">
                    {typeof filesScanned === "number"
                      ? `${filesScanned} files scanned`
                      : "Coverage unavailable"}
                  </span>
                  {coveragePercentage !== null && (
                    <span className="text-lime-400 font-semibold">
                      {coveragePercentage}% coverage
                    </span>
                  )}
                </div>
                {coveragePercentage !== null && (
                  <div className="h-1.5 w-full rounded-full bg-[var(--bg-canvas)] overflow-hidden border border-[var(--border-subtle)]">
                    <div
                      style={{ width: `${coveragePercentage}%` }}
                      className="h-full rounded-full bg-lime-400"
                    />
                  </div>
                )}
              </div>
            </section>

            {/* REPOSITORY CARD & METADATA (Requirements 22 & 23, Screenshot #2) */}
            <section
              aria-label="Repository Information"
              className="lg:col-span-7 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                  {providerDisplay}
                </span>
                {primaryLanguage && (
                  <span className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2.5 py-0.5 font-mono text-xs text-[var(--text-primary)]">
                    {primaryLanguage}
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                <a
                  href={result.repository.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 font-mono text-lg sm:text-xl font-bold text-[var(--text-primary)] hover:text-lime-400 transition-colors break-all"
                >
                  <span>{repoTitle}</span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                </a>
                {result.repository.description && (
                  <p className="font-mono text-xs text-[var(--text-secondary)] leading-relaxed">
                    {result.repository.description}
                  </p>
                )}
              </div>

              {/* Icon Metrics Strip matching Screenshot #2: ⭐ stars | ⑂ forks | ◷ age | 📄 files | 🔍 scanned */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 font-mono text-xs text-[var(--text-secondary)]">
                {typeof result.repository.stars === "number" && (
                  <span className="inline-flex items-center gap-1.5">
                    <Star className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    <span>{result.repository.stars.toLocaleString()}</span>
                  </span>
                )}

                {typeof result.repository.forks === "number" && (
                  <span className="inline-flex items-center gap-1.5">
                    <GitFork className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    <span>{result.repository.forks.toLocaleString()}</span>
                  </span>
                )}

                {repoAge && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    <span>{repoAge}</span>
                  </span>
                )}

                {typeof totalRepoFiles === "number" && (
                  <span className="inline-flex items-center gap-1.5">
                    <FileCode className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    <span>{totalRepoFiles} files</span>
                  </span>
                )}

                {typeof filesScanned === "number" && (
                  <span className="inline-flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-lime-400" />
                    <span>
                      {filesScanned} scanned
                      {coveragePercentage !== null
                        ? ` (${coveragePercentage}%)`
                        : ""}
                    </span>
                  </span>
                )}
              </div>

              {/* Complete Repository Metadata Table (Requirement 23) */}
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-t border-[var(--border-subtle)] pt-4 text-xs font-mono">
                <div>
                  <dt className="text-[10px] uppercase text-[var(--text-muted)]">
                    Repository
                  </dt>
                  <dd className="mt-0.5 text-[var(--text-primary)] truncate">
                    {result.repository.name ?? "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-[var(--text-muted)]">
                    Owner
                  </dt>
                  <dd className="mt-0.5 text-[var(--text-primary)] truncate">
                    {result.repository.owner ?? "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-[var(--text-muted)]">
                    Provider
                  </dt>
                  <dd className="mt-0.5 text-[var(--text-primary)]">
                    {providerDisplay}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-[var(--text-muted)]">
                    Language
                  </dt>
                  <dd className="mt-0.5 text-[var(--text-primary)]">
                    {primaryLanguage}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-[var(--text-muted)]">
                    Commit
                  </dt>
                  <dd className="mt-0.5 text-[var(--text-primary)]">
                    {shortCommitSha ?? "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-[var(--text-muted)]">
                    Created / Updated
                  </dt>
                  <dd className="mt-0.5 text-[var(--text-primary)]">
                    {repoAge ? `${repoAge} ago` : "Unavailable"}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          {/* 5. ARCHITECTURE GRAPH (Requirements 13-19, Screenshot #3) */}
          <ArchitectureGraph
            graph={result.graph}
            onJumpToFinding={handleJumpToFinding}
          />

          {/* 6. SECURITY FINDINGS EXPLORER (Requirements 10, 11, 12) */}
          <section
            id="findings-section"
            aria-label="Security Findings Explorer"
            className="space-y-4 pt-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <h2 className="font-mono text-base sm:text-lg font-bold tracking-widest uppercase text-[var(--text-primary)]">
                  FINDINGS
                </h2>
                <span className="rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2.5 py-0.5 font-mono text-xs text-[var(--text-secondary)]">
                  {result.findings.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFlaggedFindingTarget(null);
                    setFlagModalOpen(true);
                  }}
                  className="font-mono text-xs"
                >
                  <Flag className="h-3.5 w-3.5 text-amber-400" />
                  <span>Flag False Positive</span>
                </Button>
              </div>
            </div>

            <FindingsList
              findings={result.findings}
              controlledCategoryFilter={selectedCategoryFilter}
              onCategoryFilterChange={setSelectedCategoryFilter}
              externalSelectedFindingId={externalSelectedFindingId}
              externalSearchQuery={externalFindingSearch}
              onFlagFalsePositive={(finding) => {
                setFlaggedFindingTarget(finding);
                setFlagModalOpen(true);
              }}
            />
          </section>

          {/* 7. RAW JSON VIEWER & EXPORT SECTION */}
          <section
            id="raw-json-section"
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-3.5">
              <button
                type="button"
                onClick={() => setShowRawJson((prev) => !prev)}
                className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {showRawJson ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <FileJson className="h-4 w-4 text-lime-400" />
                <span>Raw ScanRepo JSON Output</span>
              </button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadScanJson(result.rawOutput, "repository-scan.json")
                }
                className="font-mono text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download JSON</span>
              </Button>
            </div>

            {showRawJson && (
              <div className="border-t border-[var(--border-subtle)] p-4">
                <RawJsonViewer
                  data={result.rawOutput}
                  filename="repository-scan.json"
                />
              </div>
            )}
          </section>
        </main>
      </div>

      {/* Flag False Positive Modal (Requirement 26) */}
      <FlagFalsePositiveDialog
        open={flagModalOpen}
        onOpenChange={setFlagModalOpen}
        repositoryUrl={result.repository.url}
        findingTitle={flaggedFindingTarget?.title}
        ruleId={flaggedFindingTarget?.ruleId}
      />

      <Footer />
    </div>
  );
}
