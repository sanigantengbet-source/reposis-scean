"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLoadingState } from "@/components/scanner/loading-state";
import { ScanErrorState } from "@/components/scanner/error-state";
import {
  saveRecentScanMetadata,
  setActiveScanResult,
} from "@/lib/utils/recent-scans";
import type {
  RecentScanItem,
  ScanApiErrorResponse,
  ScanErrorCode,
  ScanResult,
} from "@/types/scan";

interface ScannerFormProps {
  initialUrl?: string;
  onScanCompleted?: (
    result: ScanResult,
    updatedHistory: RecentScanItem[]
  ) => void;
  redirectOnSuccess?: boolean;
}

const EXAMPLE_REPOSITORIES = [
  {
    label: "jonschlinkert/is-odd",
    url: "https://github.com/jonschlinkert/is-odd",
  },
  {
    label: "rubenmarcus/malicious-repositories (sample subdir)",
    url: "https://github.com/rubenmarcus/malicious-repositories/tree/main/DEX-staking-project-ultrax",
  },
];

export function ScannerForm({
  initialUrl = "",
  onScanCompleted,
  redirectOnSuccess = true,
}: ScannerFormProps) {
  const router = useRouter();
  const [repositoryUrl, setRepositoryUrl] = useState(initialUrl);
  const [isScanning, setIsScanning] = useState(false);
  const [errorState, setErrorState] = useState<{
    code?: ScanErrorCode;
    message: string;
  } | null>(null);

  const executeScan = async (targetUrl: string) => {
    const cleanUrl = targetUrl.trim();
    if (!cleanUrl) {
      setErrorState({
        code: "INVALID_URL",
        message:
          "Please enter a public GitHub or Bitbucket repository URL to scan.",
      });
      return;
    }

    setRepositoryUrl(cleanUrl);
    setErrorState(null);
    setIsScanning(true);

    try {
      let response: Response | null = null;
      let payload: ScanResult | ScanApiErrorResponse | null = null;

      // Retry automatically up to 3 attempts if the container proxy returns a temporary HTML warmup response
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch("/api/scan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({ repositoryUrl: cleanUrl }),
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
          setErrorState({
            code: "SCAN_FAILED",
            message: `Scanner server returned an unexpected response (HTTP ${response.status}). Please try again.`,
          });
          setIsScanning(false);
          return;
        }
      }

      if (!response || !response.ok || !payload || "error" in payload) {
        const apiError =
          payload && "error" in payload
            ? payload.error
            : {
                code: "SCAN_FAILED" as ScanErrorCode,
                message: "Unable to scan repository.",
              };
        setErrorState({
          code: apiError.code,
          message: apiError.message,
        });
        setIsScanning(false);
        return;
      }

      // Persist active scan in client session state (never in URL) and save lightweight metadata to localStorage
      setActiveScanResult(payload);
      const updatedHistory = saveRecentScanMetadata(payload);
      onScanCompleted?.(payload, updatedHistory);

      if (redirectOnSuccess) {
        const prov = payload.repository.provider || "github";
        const own = payload.repository.owner;
        const nam = payload.repository.name;
        if (own && nam) {
          const base = `/scan/${encodeURIComponent(prov)}/${encodeURIComponent(
            own
          )}/${encodeURIComponent(nam)}`;
          const nextPath = payload.repository.subdir
            ? `${base}?subdir=${encodeURIComponent(payload.repository.subdir)}`
            : base;
          router.push(nextPath);
        } else {
          router.push("/results");
        }
      } else {
        setIsScanning(false);
      }
    } catch {
      setErrorState({
        code: "UNEXPECTED_ERROR",
        message:
          "Network or unexpected scanner error occurred while contacting /api/scan.",
      });
      setIsScanning(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeScan(repositoryUrl);
  };

  return (
    <div className="w-full space-y-4">
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5"
      >
        <label
          htmlFor="repository-url-input"
          className="block text-xs font-medium text-[var(--text-secondary)] mb-2"
        >
          Public GitHub or Bitbucket Repository URL
        </label>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              id="repository-url-input"
              type="text"
              value={repositoryUrl}
              onChange={(e) => setRepositoryUrl(e.target.value)}
              placeholder="https://github.com/owner/repository"
              disabled={isScanning}
              autoComplete="off"
              spellCheck={false}
              className="pl-10 font-mono text-xs sm:text-sm h-10"
            />
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={isScanning}
            className="w-full sm:w-auto h-10 px-5"
          >
            <Shield className="h-4 w-4" />
            <span>{isScanning ? "Scanning..." : "Scan Repository"}</span>
          </Button>
        </div>

        {/* Metadata row: Clean unboxed text with subtle typographic separators */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--text-secondary)] font-medium">
              Supported:
            </span>
            <span>GitHub</span>
            <span aria-hidden="true">·</span>
            <span>Bitbucket</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span>Static analysis</span>
            <span aria-hidden="true">·</span>
            <span>No code execution</span>
            <span aria-hidden="true">·</span>
            <span>No installation</span>
          </div>
        </div>

        {/* Quick-fill real repository targets for instant verification */}
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--text-muted)]">Quick test:</span>
          {EXAMPLE_REPOSITORIES.map((sample, idx) => (
            <React.Fragment key={sample.url}>
              {idx > 0 && (
                <span aria-hidden="true" className="text-[var(--text-muted)]">
                  ·
                </span>
              )}
              <button
                type="button"
                disabled={isScanning}
                onClick={() => {
                  setRepositoryUrl(sample.url);
                  void executeScan(sample.url);
                }}
                className="font-mono text-xs text-[var(--text-secondary)] hover:text-emerald-400 underline-offset-4 hover:underline transition-colors cursor-pointer disabled:opacity-50"
              >
                {sample.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      </form>

      {isScanning && <ScanLoadingState repositoryUrl={repositoryUrl} />}

      {!isScanning && errorState && (
        <ScanErrorState
          code={errorState.code}
          message={errorState.message}
          onRetry={() => void executeScan(repositoryUrl)}
        />
      )}
    </div>
  );
}
