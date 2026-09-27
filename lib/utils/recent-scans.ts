import { useSyncExternalStore } from "react";
import type { RecentScanItem, ScanResult } from "@/types/scan";

const RECENT_SCANS_STORAGE_KEY = "reposcan_recent_scans_v1";
const ACTIVE_SCAN_SESSION_KEY = "reposcan_active_scan_result_v1";
const MAX_RECENT_SCANS = 12;

const EMPTY_RECENT_SCANS: RecentScanItem[] = [];

type Listener = () => void;
const recentScansListeners = new Set<Listener>();
const activeScanListeners = new Set<Listener>();

let cachedRecentScansRaw: string | null = null;
let cachedRecentScansSnapshot: RecentScanItem[] = EMPTY_RECENT_SCANS;

let inMemoryScanResult: ScanResult | null = null;
let cachedActiveScanRaw: string | null = null;

function emitRecentScansChange() {
  for (const listener of recentScansListeners) {
    listener();
  }
}

function emitActiveScanChange() {
  for (const listener of activeScanListeners) {
    listener();
  }
}

/**
 * Stores only lightweight, non-sensitive scan metadata in localStorage:
 * - repositoryUrl
 * - provider
 * - owner / name
 * - score
 * - verdict
 * - timestamp
 *
 * Never stores source code, secrets, API keys, raw JSON, or finding evidence.
 */
export function getRecentScans(): RecentScanItem[] {
  if (typeof window === "undefined") return EMPTY_RECENT_SCANS;
  try {
    const raw = window.localStorage.getItem(RECENT_SCANS_STORAGE_KEY);
    if (raw === cachedRecentScansRaw) {
      return cachedRecentScansSnapshot;
    }
    cachedRecentScansRaw = raw;
    if (!raw) {
      cachedRecentScansSnapshot = EMPTY_RECENT_SCANS;
      return cachedRecentScansSnapshot;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cachedRecentScansSnapshot = EMPTY_RECENT_SCANS;
      return cachedRecentScansSnapshot;
    }
    cachedRecentScansSnapshot = parsed
      .filter(
        (item): item is RecentScanItem =>
          Boolean(item) &&
          typeof item.repositoryUrl === "string" &&
          typeof item.score === "number" &&
          typeof item.verdict === "string" &&
          typeof item.timestamp === "string"
      )
      .slice(0, MAX_RECENT_SCANS);
    return cachedRecentScansSnapshot;
  } catch {
    return EMPTY_RECENT_SCANS;
  }
}

export function saveRecentScanMetadata(result: ScanResult): RecentScanItem[] {
  if (typeof window === "undefined") return EMPTY_RECENT_SCANS;
  try {
    const existing = getRecentScans();
    const resolvedLang =
      result.repository.primaryLanguage ??
      result.repository.language ??
      "Unknown";
    const entry: RecentScanItem = {
      repositoryUrl: result.repository.url,
      provider: result.repository.provider,
      owner: result.repository.owner,
      name: result.repository.name,
      primaryLanguage: resolvedLang,
      language: resolvedLang,
      score: result.score,
      verdict: result.verdict,
      timestamp: result.scannedAt || new Date().toISOString(),
    };

    const deduplicated = existing.filter(
      (item) =>
        item.repositoryUrl.toLowerCase() !== entry.repositoryUrl.toLowerCase()
    );

    const updated = [entry, ...deduplicated].slice(0, MAX_RECENT_SCANS);
    const serialized = JSON.stringify(updated);
    window.localStorage.setItem(RECENT_SCANS_STORAGE_KEY, serialized);
    cachedRecentScansRaw = serialized;
    cachedRecentScansSnapshot = updated;
    emitRecentScansChange();
    return updated;
  } catch {
    return EMPTY_RECENT_SCANS;
  }
}

export function clearRecentScans(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_SCANS_STORAGE_KEY);
    cachedRecentScansRaw = null;
    cachedRecentScansSnapshot = EMPTY_RECENT_SCANS;
    emitRecentScansChange();
  } catch {
    // ignore storage errors
  }
}

function subscribeRecentScans(listener: Listener): () => void {
  recentScansListeners.add(listener);
  const handleStorage = (e: StorageEvent) => {
    if (e.key === RECENT_SCANS_STORAGE_KEY) {
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    recentScansListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

/**
 * Hydration-safe hook for reading Recent Scans from localStorage.
 * Uses getServerSnapshot (() => EMPTY_RECENT_SCANS) during SSR and initial hydration
 * so server and client HTML match 100%.
 */
export function useRecentScans(): RecentScanItem[] {
  return useSyncExternalStore(
    subscribeRecentScans,
    getRecentScans,
    () => EMPTY_RECENT_SCANS
  );
}

/**
 * Holds the active scan result in memory + sessionStorage for the current page/tab lifecycle
 * so navigating from `/` or `/scan` to `/results` does not put large JSON into the URL.
 */
export function setActiveScanResult(result: ScanResult | null): void {
  inMemoryScanResult = result;
  if (typeof window === "undefined") return;
  try {
    if (!result) {
      window.sessionStorage.removeItem(ACTIVE_SCAN_SESSION_KEY);
      cachedActiveScanRaw = null;
    } else {
      const serialized = JSON.stringify(result);
      window.sessionStorage.setItem(ACTIVE_SCAN_SESSION_KEY, serialized);
      cachedActiveScanRaw = serialized;
    }
  } catch {
    // If sessionStorage quota is exceeded, inMemoryScanResult still holds the data for the SPA transition
  }
  emitActiveScanChange();
}

export function getActiveScanResult(): ScanResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_SCAN_SESSION_KEY);
    if (!raw) {
      return inMemoryScanResult;
    }
    if (raw === cachedActiveScanRaw && inMemoryScanResult) {
      return inMemoryScanResult;
    }
    const parsed = JSON.parse(raw) as ScanResult;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.repository &&
      typeof parsed.score === "number" &&
      Array.isArray(parsed.findings)
    ) {
      cachedActiveScanRaw = raw;
      inMemoryScanResult = parsed;
      return parsed;
    }
    return inMemoryScanResult;
  } catch {
    return inMemoryScanResult;
  }
}

function subscribeActiveScan(listener: Listener): () => void {
  activeScanListeners.add(listener);
  return () => {
    activeScanListeners.delete(listener);
  };
}

/**
 * Hydration-safe hook for reading the active ScanResult in sessionStorage/memory.
 */
export function useActiveScanResult(): ScanResult | null {
  return useSyncExternalStore(
    subscribeActiveScan,
    getActiveScanResult,
    () => null
  );
}
