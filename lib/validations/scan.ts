import { z } from "zod";
import { ScanEngineError, type RepositoryProvider } from "@/lib/scanrepo/types";

const ALLOWED_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "bitbucket.org",
  "www.bitbucket.org",
]);

const FORBIDDEN_SCHEMES = [
  "file:",
  "ftp:",
  "javascript:",
  "data:",
  "ws:",
  "wss:",
  "gopher:",
  "ldap:",
];

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd00:/i,
];

const SAFE_SEGMENT_REGEX = /^[A-Za-z0-9_.-]+$/;

export interface ValidatedRepositoryTarget {
  normalizedUrl: string;
  provider: RepositoryProvider;
  owner: string;
  name: string;
  ref?: string;
  subdir?: string;
}

export const ScanRequestSchema = z.object({
  repositoryUrl: z
    .string("Repository URL is required.")
    .trim()
    .min(1, "Please enter a GitHub or Bitbucket repository URL.")
    .max(512, "Repository URL is too long."),
});

export function validateAndNormalizeRepositoryUrl(
  rawInput: string
): ValidatedRepositoryTarget {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    throw new ScanEngineError(
      "INVALID_URL",
      "Please enter a repository URL.",
      400
    );
  }

  // Reject dangerous schemes immediately
  const lower = trimmed.toLowerCase();
  for (const scheme of FORBIDDEN_SCHEMES) {
    if (lower.startsWith(scheme)) {
      throw new ScanEngineError(
        "INVALID_URL",
        `Unsupported URL protocol (${scheme}). Only HTTPS GitHub and Bitbucket URLs are allowed.`,
        400
      );
    }
  }

  // Reject shell / control characters
  if (/[\s;|$`&<>\\'"\0\r\n]/.test(trimmed)) {
    throw new ScanEngineError(
      "INVALID_URL",
      "Repository URL contains invalid characters.",
      400
    );
  }

  // Allow shorthand like "github.com/owner/repo" or "bitbucket.org/workspace/repo"
  const candidateUrlString = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidateUrlString);
  } catch {
    throw new ScanEngineError(
      "INVALID_URL",
      "Invalid URL format. Expected https://github.com/owner/repository or https://bitbucket.org/workspace/repository.",
      400
    );
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new ScanEngineError(
      "INVALID_URL",
      "Only HTTP/HTTPS URLs are supported.",
      400
    );
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new ScanEngineError(
      "INVALID_URL",
      "Credentials in repository URLs are not permitted.",
      400
    );
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // SSRF check against localhost & private IP ranges
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new ScanEngineError(
      "INVALID_URL",
      "Localhost and private network addresses are forbidden.",
      400
    );
  }

  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new ScanEngineError(
      "UNSUPPORTED_PROVIDER",
      `Unsupported repository host "${hostname}". Only github.com and bitbucket.org are supported.`,
      400
    );
  }

  const provider: RepositoryProvider = hostname.includes("bitbucket.org")
    ? "bitbucket"
    : "github";

  const canonicalHost =
    provider === "github" ? "github.com" : "bitbucket.org";

  // Clean pathname segments
  const rawSegments = parsedUrl.pathname
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);

  if (rawSegments.length < 2) {
    throw new ScanEngineError(
      "INVALID_URL",
      `Please specify both the ${provider === "github" ? "owner and repository" : "workspace and repository"} (e.g. https://${canonicalHost}/owner/repository).`,
      400
    );
  }

  const owner = rawSegments[0];
  const rawRepoName = rawSegments[1].replace(/\.git$/i, "");

  if (
    !owner ||
    !rawRepoName ||
    owner === "." ||
    owner === ".." ||
    rawRepoName === "." ||
    rawRepoName === ".." ||
    !SAFE_SEGMENT_REGEX.test(owner) ||
    !SAFE_SEGMENT_REGEX.test(rawRepoName)
  ) {
    throw new ScanEngineError(
      "INVALID_URL",
      "Invalid repository owner or repository name.",
      400
    );
  }

  let ref: string | undefined;
  let subdir: string | undefined;

  // Support optional /tree/<ref>/<subdir> (GitHub) or /src/<ref>/<subdir> (Bitbucket)
  if (rawSegments.length > 2) {
    const mode = rawSegments[2];
    const expectedMode = provider === "github" ? "tree" : "src";
    if (mode === expectedMode && rawSegments.length >= 4) {
      const candidateRef = rawSegments[3];
      if (!SAFE_SEGMENT_REGEX.test(candidateRef)) {
        throw new ScanEngineError(
          "INVALID_URL",
          "Invalid branch or commit reference in repository URL.",
          400
        );
      }
      ref = candidateRef;
      if (rawSegments.length > 4) {
        const rest = rawSegments.slice(4);
        if (
          rest.some(
            (seg) => seg === "." || seg === ".." || !SAFE_SEGMENT_REGEX.test(seg)
          )
        ) {
          throw new ScanEngineError(
            "INVALID_URL",
            "Invalid subdirectory path in repository URL.",
            400
          );
        }
        subdir = rest.join("/");
      }
    }
  }

  let normalizedUrl = `https://${canonicalHost}/${owner}/${rawRepoName}`;
  if (ref) {
    const branchSegment = provider === "github" ? "tree" : "src";
    normalizedUrl += `/${branchSegment}/${ref}`;
    if (subdir) {
      normalizedUrl += `/${subdir}`;
    }
  }

  return {
    normalizedUrl,
    provider,
    owner,
    name: rawRepoName,
    ref,
    subdir,
  };
}
