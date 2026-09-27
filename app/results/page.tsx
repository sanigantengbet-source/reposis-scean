"use client";

import React, { useState, useSyncExternalStore } from "react";
import { Shield } from "lucide-react";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { ResultsDashboard } from "@/components/dashboard/results-dashboard";
import { ScannerForm } from "@/components/scanner/scanner-form";
import { RecentScansPanel } from "@/components/scanner/recent-scans";
import {
  clearRecentScans,
  useActiveScanResult,
  useRecentScans,
} from "@/lib/utils/recent-scans";

const emptySubscribe = () => () => {};

export default function ResultsPage() {
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const activeResult = useActiveScanResult();
  const recentScans = useRecentScans();
  const [selectedRepoUrl, setSelectedRepoUrl] = useState("");

  if (!hydrated) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)]">
        <Navbar />
        <main className="flex-1 p-8">
          <div className="mx-auto max-w-4xl rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-xs font-mono text-[var(--text-secondary)]">
            Loading scan session...
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (activeResult) {
    return <ResultsDashboard initialResult={activeResult} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)]">
      <Navbar />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 space-y-8">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <Shield className="h-5 w-5 text-emerald-600 shrink-0" />
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              No Active Scan Result in Current Session
            </h1>
          </div>

          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
            RepoScan is stateless and does not store scan reports in a database.
            Start a repository scan below or re-run a recent scan from your
            browser history to view the security report.
          </p>

          <ScannerForm
            key={selectedRepoUrl}
            initialUrl={selectedRepoUrl}
            redirectOnSuccess={false}
          />
        </div>

        <RecentScansPanel
          items={recentScans}
          onSelectRepo={(url) => setSelectedRepoUrl(url)}
          onClearHistory={() => {
            clearRecentScans();
          }}
        />
      </main>

      <Footer />
    </div>
  );
}
