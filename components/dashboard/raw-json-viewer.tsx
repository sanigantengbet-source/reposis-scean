"use client";

import React, { useState } from "react";
import { Check, Copy, Download, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RawJsonViewerProps {
  data: Record<string, unknown>;
  filename?: string;
}

export function downloadScanJson(
  data: Record<string, unknown> | object,
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

export function RawJsonViewer({
  data,
  filename = "repository-scan.json",
}: RawJsonViewerProps) {
  const [copied, setCopied] = useState(false);
  const formattedJson = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
          <FileJson className="h-4 w-4 text-emerald-500 shrink-0" />
          <span className="font-mono">{filename}</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy JSON</span>
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => downloadScanJson(data, filename)}
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download JSON</span>
          </Button>
        </div>
      </div>

      <pre className="max-h-[640px] overflow-auto p-4 font-mono text-xs leading-relaxed text-[var(--text-primary)] bg-[var(--bg-canvas)]">
        {formattedJson}
      </pre>
    </div>
  );
}
