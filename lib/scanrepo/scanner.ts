import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseScanRepoOutput } from "@/lib/scanrepo/parser";
import { ScanEngineError, type ScanResult } from "@/lib/scanrepo/types";
import { validateAndNormalizeRepositoryUrl } from "@/lib/validations/scan";

const DEFAULT_SCAN_TIMEOUT_MS = 120_000;
const IN_MEMORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes in-memory cache (no database)
const MAX_CACHE_ENTRIES = 25;

interface CachedScanEntry {
  result: ScanResult;
  expiresAt: number;
}

const inMemoryScanCache = new Map<string, CachedScanEntry>();

function getScanTimeoutMs(): number {
  const raw = process.env.SCAN_TIMEOUT_MS;
  if (!raw) return DEFAULT_SCAN_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 5_000) {
    return DEFAULT_SCAN_TIMEOUT_MS;
  }
  return Math.min(parsed, 300_000);
}

function resolveScanRepoExecution(
  normalizedUrl: string,
  githubToken?: string
): { file: string; args: string[] } {
  const cliArgs = [normalizedUrl, "--json", "--no-publish", "--no-color"];
  if (githubToken && githubToken.trim().length > 0) {
    cliArgs.push("--token", githubToken.trim());
  }

  const preloadPath = path.join(
    process.cwd(),
    "lib",
    "scanrepo",
    "github-fallback-preload.mjs"
  );

  // Prefer direct invocation of installed scanrepo entry script to avoid npx cache writes in serverless environments
  const localCliPath = path.join(
    process.cwd(),
    "node_modules",
    "scanrepo",
    "dist",
    "cli.js"
  );

  if (fs.existsSync(localCliPath)) {
    const nodeArgs = fs.existsSync(preloadPath)
      ? ["--import", preloadPath, localCliPath, ...cliArgs]
      : [localCliPath, ...cliArgs];

    return {
      file: process.execPath,
      args: nodeArgs,
    };
  }

  return {
    file: "npx",
    args: ["--no-install", "scanrepo", ...cliArgs],
  };
}

function classifyStderrError(stderr: string): ScanEngineError {
  const lower = stderr.toLowerCase();

  if (lower.includes("private") || lower.includes("privaterepoerror")) {
    return new ScanEngineError(
      "REPOSITORY_INACCESSIBLE",
      "Repository is private or inaccessible. ScanRepo only supports public repositories.",
      422
    );
  }

  if (
    lower.includes("404") ||
    lower.includes("not found") ||
    lower.includes("does not exist")
  ) {
    return new ScanEngineError(
      "REPOSITORY_NOT_FOUND",
      "Repository not found. Verify that the repository exists and is public.",
      404
    );
  }

  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate-limit") ||
    lower.includes("api rate limit exceeded")
  ) {
    return new ScanEngineError(
      "RATE_LIMITED",
      "Upstream Git provider API rate limit reached. Please wait and try again.",
      429
    );
  }

  if (lower.includes("401") || lower.includes("403")) {
    return new ScanEngineError(
      "REPOSITORY_INACCESSIBLE",
      "Repository could not be accessed due to upstream permission or rate-limit restrictions.",
      422
    );
  }

  if (lower.includes("invalid url")) {
    return new ScanEngineError(
      "INVALID_URL",
      "Invalid repository URL. Use https://github.com/owner/repo or https://bitbucket.org/workspace/repo.",
      400
    );
  }

  return new ScanEngineError(
    "SCAN_FAILED",
    "Unable to complete repository scan. The repository may be unavailable or the scanner encountered an error.",
    500
  );
}

/**
 * Executes static security analysis on a public GitHub or Bitbucket repository
 * strictly via the server-side `scanrepo` CLI (`--json --no-publish --no-color`).
 * Never clones or executes target repository code.
 */
export async function scanRepository(
  repositoryUrl: string,
  options?: { forceRescan?: boolean }
): Promise<ScanResult> {
  const target = validateAndNormalizeRepositoryUrl(repositoryUrl);
  const cacheKey = target.normalizedUrl.toLowerCase();

  if (!options?.forceRescan) {
    const cachedEntry = inMemoryScanCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return {
        ...cachedEntry.result,
        cached: true,
      };
    }
    if (cachedEntry) {
      inMemoryScanCache.delete(cacheKey);
    }
  }

  const timeoutMs = getScanTimeoutMs();
  const githubToken =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.SCANREPO_TOKEN?.trim() ||
    undefined;

  const { file, args } = resolveScanRepoExecution(
    target.normalizedUrl,
    githubToken
  );

  const outputFilePath = path.join(
    os.tmpdir(),
    `reposcan-out-${crypto.randomUUID()}.json`
  );

  const startTime = Date.now();

  return new Promise<ScanResult>((resolve, reject) => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      CI: "1",
      HOME: os.tmpdir(),
      SCANREPO_OUTPUT_FILE: outputFilePath,
    };

    if (githubToken) {
      childEnv.GITHUB_TOKEN = githubToken;
    }

    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 25 * 1024 * 1024, // 25MB buffer for large JSON outputs
        shell: false,
        windowsHide: true,
        cwd: os.tmpdir(),
        env: childEnv,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        let rawJsonOutput =
          typeof stdout === "string" ? stdout : String(stdout || "");
        const stderrStr =
          typeof stderr === "string" ? stderr : String(stderr || "");

        try {
          if (fs.existsSync(outputFilePath)) {
            const fileContent = fs.readFileSync(outputFilePath, "utf-8");
            if (fileContent.trim().length > 0) {
              rawJsonOutput = fileContent;
            }
          }
        } catch {
          // fallback to stdout
        } finally {
          try {
            if (fs.existsSync(outputFilePath)) {
              fs.unlinkSync(outputFilePath);
            }
          } catch {
            // ignore unlink errors
          }
        }

        // Check if killed due to timeout
        if (
          error &&
          (error.killed ||
            error.signal === "SIGTERM" ||
            (error as NodeJS.ErrnoException).code === "ETIMEDOUT")
        ) {
          reject(
            new ScanEngineError(
              "TIMEOUT",
              `Scan timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
              408
            )
          );
          return;
        }

        // Note: scanrepo exits with code 0 (safe/low), 1 (suspicious/incomplete/error), or 2 (dangerous/malicious).
        // Therefore, if rawJsonOutput contains valid JSON output, parse and return it regardless of exit code 1 or 2.
        const trimmedOut = rawJsonOutput.trim();
        if (trimmedOut.includes("{") && trimmedOut.includes("}")) {
          try {
            const result = parseScanRepoOutput(
              rawJsonOutput,
              target,
              durationMs
            );
            if (inMemoryScanCache.size >= MAX_CACHE_ENTRIES) {
              const oldestKey = inMemoryScanCache.keys().next().value;
              if (oldestKey) inMemoryScanCache.delete(oldestKey);
            }
            inMemoryScanCache.set(cacheKey, {
              result,
              expiresAt: Date.now() + IN_MEMORY_CACHE_TTL_MS,
            });
            resolve(result);
            return;
          } catch (parseErr) {
            if (!error) {
              reject(
                parseErr instanceof ScanEngineError
                  ? parseErr
                  : new ScanEngineError(
                      "MALFORMED_OUTPUT",
                      "Malformed scanner output received.",
                      500
                    )
              );
              return;
            }
          }
        }

        if (stderrStr.trim().length > 0) {
          reject(classifyStderrError(stderrStr));
          return;
        }

        if (error) {
          reject(
            new ScanEngineError(
              "SCAN_FAILED",
              "The scanner process failed unexpectedly.",
              500
            )
          );
          return;
        }

        reject(
          new ScanEngineError(
            "MALFORMED_OUTPUT",
            "Scanner finished without returning JSON data.",
            500
          )
        );
      }
    );
  });
}
