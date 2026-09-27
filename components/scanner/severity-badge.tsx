import React from "react";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Info,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  XCircle,
} from "lucide-react";
import type { FindingSeverity, ScanVerdict } from "@/types/scan";
import { cn } from "@/lib/utils";

export function SeverityIndicator({
  severity,
  className,
}: {
  severity: FindingSeverity;
  className?: string;
}) {
  const config: Record<
    FindingSeverity,
    {
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      style: string;
    }
  > = {
    critical: {
      label: "CRITICAL",
      icon: AlertOctagon,
      style:
        "text-[var(--severity-critical)] bg-[var(--severity-critical-bg)] border-[var(--severity-critical-border)]",
    },
    high: {
      label: "HIGH",
      icon: ShieldAlert,
      style:
        "text-[var(--severity-high)] bg-[var(--severity-high-bg)] border-[var(--severity-high-border)]",
    },
    medium: {
      label: "MEDIUM",
      icon: AlertTriangle,
      style:
        "text-[var(--severity-medium)] bg-[var(--severity-medium-bg)] border-[var(--severity-medium-border)]",
    },
    low: {
      label: "LOW",
      icon: Info,
      style:
        "text-[var(--severity-low)] bg-[var(--severity-low-bg)] border-[var(--severity-low-border)]",
    },
    info: {
      label: "INFO",
      icon: Info,
      style:
        "text-[var(--severity-low)] bg-[var(--severity-low-bg)] border-[var(--severity-low-border)]",
    },
  };

  const current = config[severity] || config.info;
  const Icon = current.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-mono font-semibold tracking-wide whitespace-nowrap shrink-0",
        current.style,
        className
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{current.label}</span>
    </span>
  );
}

export function VerdictIndicator({
  verdict,
  rawVerdict,
  size = "default",
}: {
  verdict: ScanVerdict | "failed";
  rawVerdict?: string;
  size?: "sm" | "default" | "lg";
}) {
  const displayLabel =
    verdict === "failed"
      ? "SCAN FAILED"
      : rawVerdict
        ? rawVerdict.toUpperCase()
        : verdict.toUpperCase();

  const mapConfig = () => {
    if (verdict === "failed") {
      return {
        icon: XCircle,
        style:
          "text-[var(--severity-critical)] bg-[var(--severity-critical-bg)] border-[var(--severity-critical-border)]",
      };
    }
    if (verdict === "safe") {
      return {
        icon: ShieldCheck,
        style:
          "text-[var(--severity-safe)] bg-[var(--severity-safe-bg)] border-[var(--severity-safe-border)]",
      };
    }
    if (verdict === "low") {
      return {
        icon: CheckCircle2,
        style:
          "text-[var(--severity-safe)] bg-[var(--severity-safe-bg)] border-[var(--severity-safe-border)]",
      };
    }
    if (verdict === "suspicious") {
      return {
        icon: AlertTriangle,
        style:
          "text-[var(--severity-medium)] bg-[var(--severity-medium-bg)] border-[var(--severity-medium-border)]",
      };
    }
    if (verdict === "dangerous" || verdict === "malicious") {
      return {
        icon: AlertOctagon,
        style:
          "text-[var(--severity-critical)] bg-[var(--severity-critical-bg)] border-[var(--severity-critical-border)]",
      };
    }
    return {
      icon: rawVerdict === "INCONCLUSIVE" ? ShieldQuestion : HelpCircle,
      style:
        "text-[var(--severity-medium)] bg-[var(--severity-medium-bg)] border-[var(--severity-medium-border)]",
    };
  };

  const { icon: Icon, style } = mapConfig();

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[11px] gap-1",
    default: "px-2.5 py-1 text-xs gap-1.5",
    lg: "px-3 py-1.5 text-sm gap-2",
  }[size];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border font-mono font-semibold tracking-wide whitespace-nowrap shrink-0",
        style,
        sizeClasses
      )}
    >
      <Icon
        className={cn(
          "shrink-0",
          size === "sm"
            ? "h-3 w-3"
            : size === "lg"
              ? "h-4 w-4"
              : "h-3.5 w-3.5"
        )}
      />
      <span>{displayLabel}</span>
    </span>
  );
}
