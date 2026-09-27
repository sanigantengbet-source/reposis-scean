"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { ResultsDashboard } from "@/components/dashboard/results-dashboard";
import { ScanLoadingState } from "@/components/scanner/loading-state";
import { ScanErrorState } from "@/components/scanner/error-state";
import {
  saveRecentScanMetadata,
  setActiveScanResult,
  useActiveScanResult,
} from "@/lib/utils/recent-scans";
import type {
  ScanApiErrorResponse,
  ScanErrorCode,
  ScanResult,
} from "@/types/scan";

function buildRepositoryUrlFromRoute(
  provider: string,
  owner: string,
  repo: string,
  ref?: string | null,
  subdir?: string | null
): string {
  const cleanProvider = provider.toLowerCase();
  const host =
    cleanProvider === "bitbucket"
      ? "https://bitbucket.org"
      : "https://github.com";
  const branchSeg = cleanProvider === "bitbucket" ? "src" : "tree";

  if (subdir) {
    const branch = ref || "main";
    return `${host}/${owner}/${repo}/${branchSeg}/${branch}/${subdir}`;
  }
  if (ref) {
    return `${host}/${owner}/${repo}/${branchSeg}/${ref}`;
  }
  return `${host}/${owner}/${repo}`;
}

async function fetchRepositoryScanWithRetry(
  repositoryUrl: string,
  forceRescan: boolean
): Promise<
  | { ok: true; data: ScanResult }
  | { ok: false; code: ScanErrorCode; message: string }
> {
  let response: Response | null = null;
  let payload: ScanResult | ScanApiErrorResponse | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch("/api/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        repositoryUrl,
        rescan: forceRescan,
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
      return {
        ok: false,
        code: "SCAN_FAILED",
        message: `Scanner server returned an unexpected response (HTTP ${response.status}). Please try again.`,
      };
    }
  }

  if (!response || !response.ok || !payload || "error" in payload) {
    const apiErr =
      payload && "error" in payload
        ? payload.error
        : {
            code: "SCAN_FAILED" as ScanErrorCode,
            message: "Unable to scan repository.",
          };
    return {
      ok: false,
      code: apiErr.code,
      message: apiErr.message,
    };
  }

  return {
    ok: true,
    data: payload as ScanResult,
  };
}

function ScanRepoReportView() {
  const params = useParams<{
    provider: string;
    owner: string;
    repo: string;
  }>();
  const searchParams = useSearchParams();

  const provider = decodeURIComponent(
    params?.provider || "github"
  ).toLowerCase();
  const owner = decodeURIComponent(params?.owner || "");
  const repo = decodeURIComponent(params?.repo || "");
  const subdir = searchParams.get("subdir");
  const ref = searchParams.get("ref");

  const activeSessionResult = useActiveScanResult();

  const matchesSessionResult = Boolean(
    activeSessionResult &&
      activeSessionResult.repository.provider.toLowerCase() === provider &&
      (activeSessionResult.repository.owner || "").toLowerCase() ===
        owner.toLowerCase() &&
      (activeSessionResult.repository.name || "").toLowerCase() ===
        repo.toLowerCase() &&
      (!subdir ||
        (activeSessionResult.repository.subdir || "").toLowerCase() ===
          subdir.toLowerCase())
  );

  const [fetchedResult, setFetchedResult] = useState<ScanResult | null>(null);
  const [isManualRetrying, setIsManualRetrying] = useState(false);
  const [scanError, setScanError] = useState<{
    code?: ScanErrorCode;
    message: string;
  } | null>(null);

  const targetRepoUrl = buildRepositoryUrlFromRoute(
    provider,
    owner,
    repo,
    ref,
    subdir
  );

  useEffect(() => {
    if (matchesSessionResult || fetchedResult || scanError) {
      return;
    }
    let cancelled = false;

    async function loadInitialScan() {
      if (!owner || !repo) {
        if (!cancelled) {
          setScanError({
            code: "INVALID_URL",
            message: "Invalid repository path parameters.",
          });
        }
        return;
      }

      try {
        const outcome = await fetchRepositoryScanWithRetry(
          targetRepoUrl,
          false
        );
        if (cancelled) return;
        if (!outcome.ok) {
          setScanError({
            code: outcome.code,
            message: outcome.message,
          });
          return;
        }
        setFetchedResult(outcome.data);
        setActiveScanResult(outcome.data);
        saveRecentScanMetadata(outcome.data);
      } catch {
        if (!cancelled) {
          setScanError({
            code: "UNEXPECTED_ERROR",
            message:
              "Network or unexpected scanner error occurred while contacting /api/scan.",
          });
        }
      }
    }

    void loadInitialScan();

    return () => {
      cancelled = true;
    };
  }, [matchesSessionResult, fetchedResult, scanError, owner, repo, targetRepoUrl]);

  const handleRetry = async () => {
    setIsManualRetrying(true);
    setScanError(null);
    try {
      const outcome = await fetchRepositoryScanWithRetry(targetRepoUrl, true);
      if (!outcome.ok) {
        setScanError({
          code: outcome.code,
          message: outcome.message,
        });
        return;
      }
      setFetchedResult(outcome.data);
      setActiveScanResult(outcome.data);
      saveRecentScanMetadata(outcome.data);
    } catch {
      setScanError({
        code: "UNEXPECTED_ERROR",
        message:
          "Network or unexpected scanner error occurred while contacting /api/scan.",
      });
    } finally {
      setIsManualRetrying(false);
    }
  };

  const activeResult = matchesSessionResult
    ? activeSessionResult
    : fetchedResult;

  if (activeResult) {
    return (
      <ResultsDashboard
        result={activeResult}
        onUpdateResult={(updated) => {
          setFetchedResult(updated);
          setActiveScanResult(updated);
        }}
      />
    );
  }

  const isLoading = isManualRetrying || (!scanError && !activeResult);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)]">
      <Navbar />
      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="font-mono text-xs"
          >
            <Link href="/scan">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Scanner</span>
            </Link>
          </Button>
          <span className="font-mono text-xs text-[var(--text-muted)]">
            {provider}/{owner}/{repo}
          </span>
        </div>

        {isLoading && <ScanLoadingState repositoryUrl={targetRepoUrl} />}

        {!isLoading && scanError && (
          <ScanErrorState
            code={scanError.code}
            message={scanError.message}
            onRetry={() => void handleRetry()}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

export default function DynamicRepositoryScanPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)]">
          <Navbar />
          <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
            <ScanLoadingState />
          </main>
          <Footer />
        </div>
      }
    >
      <ScanRepoReportView />
    </Suspense>
  );
}
