import React from "react";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] py-6 text-xs text-[var(--text-muted)]">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 space-y-4">
        <div className="flex items-center justify-center gap-6">
          <Link
            href="/"
            className="hover:text-[var(--text-primary)] transition-colors"
          >
            Overview
          </Link>
          <Link
            href="/scan"
            className="hover:text-[var(--text-primary)] transition-colors"
          >
            Scanner
          </Link>
          <Link
            href="/results"
            className="hover:text-[var(--text-primary)] transition-colors"
          >
            Results
          </Link>
        </div>

        <div className="border-t border-[var(--border-subtle)] pt-4 text-center font-mono text-[11px] font-semibold tracking-wider text-[var(--text-secondary)]">
          POWERED BY SANN404 FORUM GROUP
        </div>
      </div>
    </footer>
  );
}
