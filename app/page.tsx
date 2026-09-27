"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { ScannerForm } from "@/components/scanner/scanner-form";
import { RecentScansPanel } from "@/components/scanner/recent-scans";
import {
  clearRecentScans,
  useRecentScans,
} from "@/lib/utils/recent-scans";

const THREAT_CATEGORIES = [
  {
    title: "Code Execution",
    detail:
      "Detects eval(), Function() constructors, child_process shell invocation, VM context abuse, and piped remote shell scripts.",
  },
  {
    title: "Credential Theft",
    detail:
      "Flags browser profile store reads, cryptocurrency wallet file access, seed phrase harvesting UI, clipboard reads, and SSH/AWS key access.",
  },
  {
    title: "Data Exfiltration",
    detail:
      "Identifies fetch-then-eval chains, wallet signing paired with remote network calls, byte-array URLs, hardcoded IPs, and known C2 domains.",
  },
  {
    title: "Obfuscation",
    detail:
      "Uncovers javascript-obfuscator string arrays, high-entropy literals, base64/hex payloads, flattened control flow, and long source lines.",
  },
  {
    title: "Supply Chain",
    detail:
      "Inspects package.json lifecycle hooks (preinstall/postinstall), VSCode folderOpen auto-run tasks, typosquatted packages, and known malicious dependencies.",
  },
  {
    title: "Web Vulnerabilities",
    detail:
      "Checks for dangerous DOM injection sinks, SQL/NoSQL injection patterns, path traversal, and unsafe redirect vectors.",
  },
];

export default function HomePage() {
  const router = useRouter();
  const recentScans = useRecentScans();
  const [selectedUrl, setSelectedUrl] = useState("");

  const handleClearHistory = () => {
    clearRecentScans();
  };

  const handleSelectRecent = (url: string) => {
    setSelectedUrl(url);
    router.push(`/scan?repo=${encodeURIComponent(url)}`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)]">
      <Navbar />

      <main className="flex-1">
        {/* Hero Section (Requirement 7) */}
        <section className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 py-14 sm:py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <div className="max-w-2xl space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[var(--text-secondary)]">
                <span className="text-emerald-500 font-semibold">
                  Static Repository Security Scanner
                </span>
                <span aria-hidden="true">·</span>
                <span>POWERED by SANN404 FORUM GROUP</span>
              </div>

              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[var(--text-primary)] [text-wrap:balance]">
                Scan Before You Clone.
              </h1>

              <p className="text-sm sm:text-base leading-relaxed text-[var(--text-secondary)] max-w-xl">
                Detect malicious code, credential stealers, supply-chain threats
                and suspicious repository activity.
              </p>
            </div>

            <div className="mt-8">
              <ScannerForm
                key={selectedUrl}
                initialUrl={selectedUrl}
                redirectOnSuccess={true}
              />
            </div>
          </div>
        </section>

        {/* Main Content Grid: Threat Detection Matrix & Recent Browser Scans */}
        <section className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 space-y-12">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Left 7 columns: What ScanRepo Inspects */}
            <div className="lg:col-span-7 space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Static Rules & Threat Categories
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  RepoScan runs static pattern analysis, entropy checks, and
                  reachability inspection via scanrepo without executing any
                  target repository code.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {THREAT_CATEGORIES.map((category, idx) => (
                  <div
                    key={category.title}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-1.5"
                  >
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      0{idx + 1}. {category.title}
                    </div>
                    <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                      {category.detail}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-xs text-[var(--text-secondary)] leading-relaxed">
                <span className="font-semibold text-[var(--text-primary)]">
                  Security Model Notice:{" "}
                </span>
                A low-risk or safe result means no known malicious patterns were
                detected during static analysis. It is not a guarantee that a
                repository is safe. Always review unfamiliar code before running
                install or build scripts.
              </div>
            </div>

            {/* Right 5 columns: Recent Scans in Local Browser Storage */}
            <div className="lg:col-span-5">
              <RecentScansPanel
                items={recentScans}
                onSelectRepo={handleSelectRecent}
                onClearHistory={handleClearHistory}
              />
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
