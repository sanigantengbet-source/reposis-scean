"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Navbar,
  WHATSAPP_CHANNEL_URL,
  WhatsAppIcon,
} from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { ScannerForm } from "@/components/scanner/scanner-form";
import { RecentScansPanel } from "@/components/scanner/recent-scans";
import {
  clearRecentScans,
  useRecentScans,
} from "@/lib/utils/recent-scans";

function ScanWorkspaceContent() {
  const searchParams = useSearchParams();
  const repoParam = searchParams.get("repo") || "";
  const recentScans = useRecentScans();
  const [overrideUrl, setOverrideUrl] = useState<string | null>(null);
  const targetUrl = overrideUrl ?? repoParam;

  const handleClearHistory = () => {
    clearRecentScans();
  };

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-80 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 space-y-6">
        <div>
          <a
            href={WHATSAPP_CHANNEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp Channel"
            title="WhatsApp Channel"
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/10 hover:border-white/25 transition-colors whitespace-nowrap"
          >
            <WhatsAppIcon className="h-4 w-4" />
            <span>WhatsApp Channel</span>
          </a>
        </div>

        <div className="border-t border-[var(--border-subtle)] pt-5">
          <h2 className="text-xs font-semibold text-[var(--text-primary)] mb-2">
            Untrusted Input Isolation
          </h2>
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
            Target repositories are treated strictly as untrusted input.
            RepoScan never runs npm install, build scripts, postinstall hooks,
            or binaries from scanned repositories.
          </p>
        </div>

        <div className="border-t border-[var(--border-subtle)] pt-5">
          <h3 className="text-xs font-semibold text-[var(--text-primary)] mb-2">
            Allowed Hosts
          </h3>
          <ul className="space-y-1.5 text-xs font-mono text-[var(--text-secondary)]">
            <li>https://github.com/owner/repo</li>
            <li>https://bitbucket.org/workspace/repo</li>
          </ul>
        </div>
      </aside>

      {/* Main Scanner Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-10 space-y-8">
        <div className="max-w-3xl space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Repository Security Scanner
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
            Enter a public GitHub or Bitbucket repository URL to run a live
            static analysis scan with scanrepo.
          </p>
        </div>

        <div className="max-w-3xl">
          <ScannerForm
            key={targetUrl}
            initialUrl={targetUrl}
            redirectOnSuccess={true}
          />
        </div>

        <div className="max-w-3xl">
          <RecentScansPanel
            items={recentScans}
            onSelectRepo={(url) => setOverrideUrl(url)}
            onClearHistory={handleClearHistory}
          />
        </div>
      </main>
    </div>
  );
}

export default function ScanPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)]">
      <Navbar />
      <Suspense
        fallback={
          <div className="flex-1 p-8 text-xs font-mono text-[var(--text-secondary)]">
            Loading scanner workspace...
          </div>
        }
      >
        <ScanWorkspaceContent />
      </Suspense>
      <Footer />
    </div>
  );
}
