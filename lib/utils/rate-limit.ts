import crypto from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Stateless Serverless Rate Limiter for /api/scan
 *
 * Since RepoScan operates strictly without a database or Redis, rate limiting uses a dual-layer
 * serverless-compatible strategy:
 * 1. Cryptographically signed sliding-window cookie (`reposcan_rl`) verified on the server,
 *    which persists rate-limit state across stateless serverless function instances for browser clients.
 * 2. Ephemeral per-container IP burst guard to throttle automated script bursts hitting warm instances.
 *
 * Limitation: Without an external distributed store, clients that strip cookies and hit cold
 * serverless instances across different regions are only bounded by per-instance concurrency and
 * upstream GitHub/Bitbucket API limits.
 */

const WINDOW_MS = 60_000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 10; // 10 scans per minute per client
const EPHEMERAL_MAP_MAX_SIZE = 500;

const ephemeralIpBuckets = new Map<string, number[]>();

function getSigningSecret(): string {
  return (
    process.env.SCANREPO_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.APP_URL ||
    "reposcan-stateless-hmac-key-v1"
  );
}

function signPayload(payload: string): string {
  return crypto
    .createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");
}

function parseSignedTimestamps(cookieValue: string | undefined, now: number): number[] {
  if (!cookieValue) return [];
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return [];
  const [encodedPayload, signature] = parts;
  const expectedSig = signPayload(encodedPayload);
  if (signature !== expectedSig) return [];

  try {
    const raw = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8")
    );
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (ts): ts is number =>
        typeof ts === "number" && Number.isFinite(ts) && now - ts < WINDOW_MS
    );
  } catch {
    return [];
  }
}

function createSignedCookieValue(timestamps: number[]): string {
  const encodedPayload = Buffer.from(JSON.stringify(timestamps), "utf-8").toString(
    "base64url"
  );
  const sig = signPayload(encodedPayload);
  return `${encodedPayload}.${sig}`;
}

export function getClientIdentifier(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "anonymous-client";
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  cookieName: string;
  cookieValue: string;
}

export function checkStatelessRateLimit(req: NextRequest): RateLimitDecision {
  const now = Date.now();
  const cookieName = "reposcan_rl";
  const existingCookie = req.cookies.get(cookieName)?.value;

  const cookieTimestamps = parseSignedTimestamps(existingCookie, now);

  const clientIp = getClientIdentifier(req);
  const ipTimestamps = (ephemeralIpBuckets.get(clientIp) || []).filter(
    (ts) => now - ts < WINDOW_MS
  );

  // Merge timestamps from signed cookie and warm instance bucket
  const combinedCount = Math.max(cookieTimestamps.length, ipTimestamps.length);

  if (combinedCount >= MAX_REQUESTS_PER_WINDOW) {
    const oldest =
      cookieTimestamps[0] ?? ipTimestamps[0] ?? now - WINDOW_MS / 2;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((WINDOW_MS - (now - oldest)) / 1000)
    );
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      cookieName,
      cookieValue: createSignedCookieValue(cookieTimestamps),
    };
  }

  const nextCookieTimestamps = [...cookieTimestamps, now].slice(
    -MAX_REQUESTS_PER_WINDOW
  );
  const nextIpTimestamps = [...ipTimestamps, now].slice(
    -MAX_REQUESTS_PER_WINDOW
  );

  if (ephemeralIpBuckets.size >= EPHEMERAL_MAP_MAX_SIZE) {
    const oldestKey = ephemeralIpBuckets.keys().next().value;
    if (oldestKey) ephemeralIpBuckets.delete(oldestKey);
  }
  ephemeralIpBuckets.set(clientIp, nextIpTimestamps);

  return {
    allowed: true,
    remaining: Math.max(0, MAX_REQUESTS_PER_WINDOW - nextCookieTimestamps.length),
    retryAfterSeconds: 0,
    cookieName,
    cookieValue: createSignedCookieValue(nextCookieTimestamps),
  };
}
