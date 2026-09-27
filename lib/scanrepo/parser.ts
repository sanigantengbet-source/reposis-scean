import {
  RawScanRepoOutputSchema,
  ScanEngineError,
  type RawScanRepoFinding,
  type ScanResult,
  type SecurityFinding,
  type FindingSeverity,
  type ScanVerdict,
} from "@/lib/scanrepo/types";
import type {
  ScanArchitectureGraph,
  ScanGraphNode,
  ScanGraphNodeKind,
  StandardCategoryKey,
} from "@/types/scan";
import type { ValidatedRepositoryTarget } from "@/lib/validations/scan";
import { resolveRepositoryLanguage } from "@/lib/scanrepo/language-detector";

const CATEGORY_MAP: Record<string, StandardCategoryKey> = {
  "code-execution": "Code Execution",
  "network-exfiltration": "Network & Exfiltration",
  "filesystem-access": "File System Access",
  obfuscation: "Obfuscation",
  "supply-chain": "Supply Chain",
  "web-vulnerabilities": "OWASP / Injection",
};

const RULE_RECOMMENDATIONS: Record<string, string> = {
  "javascript-obfuscator":
    "Inspect the obfuscated file manually before executing any scripts. Rotating string-array obfuscation is a primary indicator of concealed malware payloads.",
  "string-array-obfuscation":
    "Deobfuscate and audit the string table before running this code. Legitimate open-source source files rarely ship obfuscated string arrays.",
  "fetch-eval-combo":
    "Critical remote code execution pattern: network responses are passed into dynamic execution. Do not run or install this repository.",
  "axios-eval":
    "Remote payload execution detected via HTTP client response passed to eval/Function. Treat as malicious until proven otherwise.",
  "byte-array-url":
    "Hidden URL constructed from byte arrays. Verify the destination endpoint and do not execute in an environment with secrets or wallets.",
  "shell-remote-exec":
    "Shell script downloads and pipes remote content directly to an interpreter. Audit the remote script URL before running.",
  "shell-base64-exec":
    "Base64-decoded payload executed in shell. Decode the payload safely in an isolated viewer to inspect its contents.",
  "suspicious-domains":
    "Code references untrusted paste/tunnel/exfiltration endpoints (e.g. npoint.io, pastebin, webhook sinks). Inspect all outbound requests.",
  "child-process":
    "Review all child_process / shell invocations to confirm arguments are static and not executing untrusted binaries or scripts.",
  "flagged-module-reachable":
    "Flagged files are directly reachable from the application's entry point and will execute when the project starts.",
  "entry-point-cluster":
    "Multiple flagged modules are imported along the entry point execution path. Audit the full import chain before running.",
};

export function normalizeVerdict(
  rawRiskLevel?: string,
  score?: number,
  incomplete?: boolean
): ScanVerdict {
  if (incomplete) {
    return "unknown";
  }

  if (rawRiskLevel) {
    const cleaned = rawRiskLevel.trim().toLowerCase();
    if (cleaned === "safe") return "safe";
    if (cleaned === "low" || cleaned === "low_risk" || cleaned === "low risk") {
      return "low";
    }
    if (cleaned === "suspicious" || cleaned === "warning" || cleaned === "medium") {
      return "suspicious";
    }
    if (cleaned === "dangerous" || cleaned === "high") return "dangerous";
    if (cleaned === "malicious" || cleaned === "critical") return "malicious";
  }

  if (typeof score === "number") {
    if (score <= 15) return "safe";
    if (score <= 30) return "low";
    if (score <= 55) return "suspicious";
    if (score <= 75) return "dangerous";
    return "malicious";
  }

  return "unknown";
}

export function normalizeSeverity(
  rawSeverity?: string,
  points?: number | null
): FindingSeverity {
  const cleaned = (rawSeverity ?? "").trim().toLowerCase();

  if (cleaned === "critical") {
    if (typeof points === "number" && points < 12) {
      return "high";
    }
    return "critical";
  }

  if (cleaned === "high" || cleaned === "error" || cleaned === "danger") {
    return "high";
  }

  if (cleaned === "warning" || cleaned === "medium" || cleaned === "moderate") {
    if (typeof points === "number" && points >= 10) {
      return "high";
    }
    return "medium";
  }

  if (cleaned === "low") {
    return "low";
  }

  if (cleaned === "info" || cleaned === "informational" || cleaned === "note") {
    return "low";
  }

  if (typeof points === "number") {
    if (points >= 12) return "critical";
    if (points >= 8) return "high";
    if (points >= 4) return "medium";
  }

  return "low";
}

export function normalizeCategoryName(
  rawCategoryId?: string,
  fallbackName?: string
): StandardCategoryKey | string {
  if (rawCategoryId) {
    const key = rawCategoryId.trim().toLowerCase();
    if (CATEGORY_MAP[key]) {
      return CATEGORY_MAP[key];
    }
  }
  if (fallbackName) {
    const key = fallbackName.trim().toLowerCase();
    if (CATEGORY_MAP[key]) {
      return CATEGORY_MAP[key];
    }
    if (key === "credential theft" || key === "file system access") {
      return "File System Access";
    }
    if (key === "data exfiltration" || key === "network & exfiltration") {
      return "Network & Exfiltration";
    }
    if (key === "web vulnerabilities" || key === "owasp / injection") {
      return "OWASP / Injection";
    }
    return fallbackName;
  }
  return "Code Execution";
}

function mapRawFinding(
  raw: RawScanRepoFinding,
  index: number
): SecurityFinding {
  const ruleId = raw.ruleId || `finding-${index + 1}`;
  const severity = normalizeSeverity(raw.severity, raw.points);
  const category = normalizeCategoryName(raw.category);
  const file = raw.filePath ?? raw.file ?? undefined;
  const line = typeof raw.line === "number" ? raw.line : undefined;
  const evidence = raw.snippet ?? raw.evidence ?? undefined;
  const recommendation =
    raw.recommendation ??
    (raw.ruleId ? RULE_RECOMMENDATIONS[raw.ruleId] : undefined);

  return {
    id: `${ruleId}-${index}`,
    ruleId: raw.ruleId,
    severity,
    rawSeverity: raw.severity,
    title: raw.title || raw.ruleId || "Security signal detected",
    description: raw.description ?? undefined,
    category,
    rawCategoryId: raw.category,
    file: file && file.trim().length > 0 ? file : undefined,
    line,
    evidence: evidence && evidence.trim().length > 0 ? evidence : undefined,
    recommendation,
    points: typeof raw.points === "number" ? raw.points : undefined,
  };
}

function buildVerdictExplanation(
  verdict: ScanVerdict,
  score: number,
  findings: SecurityFinding[],
  incomplete?: boolean,
  coverage?: number,
  llmSummary?: string | null,
  trustDiscount?: { reason: string; cappedAt: number } | null
): string {
  if (llmSummary && llmSummary.trim().length > 0) {
    return llmSummary.trim();
  }

  if (incomplete) {
    const pct = Math.round((coverage ?? 0) * 100);
    return `Only ${pct}% of targeted files could be analyzed. Treat this scan as inconclusive and review the repository manually before running anything.`;
  }

  const hasObfuscation = findings.some(
    (f) =>
      f.rawCategoryId === "obfuscation" ||
      f.category?.toLowerCase() === "obfuscation"
  );
  const hasCodeExec = findings.some(
    (f) =>
      f.rawCategoryId === "code-execution" ||
      f.category?.toLowerCase() === "code execution"
  );
  const hasExfil = findings.some(
    (f) =>
      f.rawCategoryId === "network-exfiltration" ||
      f.category?.toLowerCase().includes("exfiltration")
  );

  if (verdict === "malicious" || verdict === "dangerous") {
    if (hasObfuscation && (hasCodeExec || hasExfil)) {
      return "Obfuscated payloads combined with code execution or network exfiltration patterns detected. Do not install dependencies or execute code from this repository.";
    }
    return `High-risk static security indicators detected (${findings.length} finding${findings.length === 1 ? "" : "s"}, score ${score}/100). Inspect all flagged files in an isolated environment before running anything.`;
  }

  if (verdict === "suspicious") {
    if (hasObfuscation || hasCodeExec) {
      return "Obfuscation or dynamic code paths detected. Intent unclear — review before running anything.";
    }
    return `Suspicious patterns matched across ${findings.length} security finding${findings.length === 1 ? "" : "s"}. Intent unclear — review flagged files manually before running anything.`;
  }

  if (verdict === "low") {
    if (trustDiscount?.reason) {
      return `${trustDiscount.reason}. Review low-severity findings manually.`;
    }
    return "Low-severity static signals detected. Likely benign developer patterns, but manual verification is advised.";
  }

  if (verdict === "safe") {
    if (trustDiscount?.reason) {
      return `${trustDiscount.reason}. No known-malicious patterns were found.`;
    }
    return "No known-malicious patterns were detected during static analysis. Always review source files manually before executing untrusted code.";
  }

  return "Heuristic static analysis completed. Review all reported findings manually before executing code.";
}

function buildArchitectureGraph(
  rawGraph: {
    nodes?: Array<{
      id: string;
      path?: string;
      label?: string;
      kind?: string;
      findings?: RawScanRepoFinding[];
      isEntry?: boolean;
    }>;
    edges?: Array<{
      source: string;
      target: string;
      kind?: string;
    }>;
    entryPoints?: string[];
  } | null | undefined,
  findings: SecurityFinding[],
  graphTruncated?: boolean
): ScanArchitectureGraph | null {
  if (!rawGraph || !Array.isArray(rawGraph.nodes) || rawGraph.nodes.length === 0) {
    return null;
  }

  const entrySet = new Set(rawGraph.entryPoints ?? []);
  let entryCount = 0;
  let flaggedCount = 0;
  let pkgCount = 0;

  const normalizedNodes: ScanGraphNode[] = rawGraph.nodes.map((rawNode) => {
    const nodePath = rawNode.path || rawNode.id;
    const isPackage =
      rawNode.id.startsWith("pkg:") || nodePath.startsWith("pkg:");
    const isEntry = Boolean(
      rawNode.isEntry ||
        entrySet.has(rawNode.id) ||
        entrySet.has(nodePath) ||
        rawNode.kind === "entry" ||
        rawNode.kind === "entry-flagged"
    );

    // Match findings belonging to this file node
    const matchedFindings = isPackage
      ? []
      : findings.filter((f) => {
          if (!f.file) return false;
          const cleanFile = f.file.replace(/^\.\//, "");
          const cleanNode = nodePath.replace(/^\.\//, "");
          return (
            cleanFile === cleanNode ||
            cleanFile.endsWith(`/${cleanNode}`) ||
            cleanNode.endsWith(`/${cleanFile}`)
          );
        });

    const rawNodeFindings = Array.isArray(rawNode.findings)
      ? rawNode.findings
      : [];
    const totalNodeFindingsCount = Math.max(
      matchedFindings.length,
      rawNodeFindings.length
    );

    const isFlagged = Boolean(
      !isPackage &&
        (rawNode.kind === "flagged" ||
          rawNode.kind === "entry-flagged" ||
          totalNodeFindingsCount > 0)
    );

    let kind: ScanGraphNodeKind = "orphan";
    if (isPackage) {
      kind = "package";
      pkgCount++;
    } else if (isEntry && isFlagged) {
      kind = "entry-flagged";
      entryCount++;
      flaggedCount++;
    } else if (isEntry) {
      kind = "entry";
      entryCount++;
    } else if (isFlagged) {
      kind = "flagged";
      flaggedCount++;
    } else if (rawNode.kind === "reachable") {
      kind = "reachable";
    } else {
      kind = "orphan";
    }

    const combinedFindings =
      matchedFindings.length > 0
        ? matchedFindings.map((mf) => ({
            id: mf.id,
            ruleId: mf.ruleId,
            severity: mf.severity,
            title: mf.title,
            description: mf.description,
            line: mf.line,
          }))
        : rawNodeFindings.map((rf, idx) => ({
            id: `${rf.ruleId || "node-finding"}-${idx}`,
            ruleId: rf.ruleId,
            severity: normalizeSeverity(rf.severity, rf.points),
            title: rf.title || rf.ruleId || "Security finding",
            description: rf.description ?? undefined,
            line: typeof rf.line === "number" ? rf.line : undefined,
          }));

    return {
      id: rawNode.id,
      path: nodePath,
      label:
        rawNode.label ||
        nodePath.replace(/^pkg:/, "").split("/").pop() ||
        nodePath,
      kind,
      isEntry,
      isFlagged,
      isPackage,
      findingsCount: totalNodeFindingsCount,
      findingIds: matchedFindings.map((mf) => mf.id),
      findings: combinedFindings,
    };
  });

  const nodeIds = new Set(normalizedNodes.map((n) => n.id));
  const normalizedEdges = (rawGraph.edges ?? [])
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      kind: edge.kind || "relative",
    }));

  return {
    nodes: normalizedNodes,
    edges: normalizedEdges,
    entryPoints: rawGraph.entryPoints ?? [],
    truncated: Boolean(graphTruncated),
    counts: {
      totalNodes: normalizedNodes.length,
      totalEdges: normalizedEdges.length,
      entry: entryCount,
      flagged: flaggedCount,
      pkg: pkgCount,
    },
  };
}

/**
 * Extracts and validates the JSON payload emitted by `scanrepo --json --no-publish`.
 */
export function parseScanRepoOutput(
  stdout: string,
  target: ValidatedRepositoryTarget,
  durationMs: number
): ScanResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new ScanEngineError(
      "MALFORMED_OUTPUT",
      "Scanner produced empty output.",
      500
    );
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new ScanEngineError(
      "MALFORMED_OUTPUT",
      "Scanner output did not contain a valid JSON payload.",
      500
    );
  }

  const jsonCandidate = trimmed.slice(firstBrace, lastBrace + 1);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonCandidate);
  } catch {
    throw new ScanEngineError(
      "MALFORMED_OUTPUT",
      "Failed to parse JSON output from scanrepo.",
      500
    );
  }

  const validation = RawScanRepoOutputSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new ScanEngineError(
      "MALFORMED_OUTPUT",
      "Scanner output format did not match the expected ScanRepo schema.",
      500
    );
  }

  const raw = validation.data;

  // Extract findings from top-level `findings` array, or flatten from `categories` if top-level is empty
  const rawFindingsSource =
    raw.findings && raw.findings.length > 0
      ? raw.findings
      : raw.categories.flatMap((c) => c.findings ?? []);

  const findings: SecurityFinding[] = rawFindingsSource.map((item, idx) =>
    mapRawFinding(item, idx)
  );

  const categories = raw.categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    normalizedName: normalizeCategoryName(cat.id, cat.name),
    score: cat.score,
    maxScore: cat.maxScore,
    findingsCount: cat.findings?.length ?? 0,
  }));

  const verdict = normalizeVerdict(
    raw.riskLevel,
    raw.riskScore,
    raw.incomplete
  );

  const distinctRules = new Set(
    findings.map((f) => f.ruleId).filter((r): r is string => Boolean(r))
  );
  const rulesHit =
    distinctRules.size > 0 ? distinctRules.size : findings.length;

  const verdictExplanation = buildVerdictExplanation(
    verdict,
    raw.riskScore,
    findings,
    raw.incomplete,
    raw.coverage,
    raw.llmSummary,
    raw.trustDiscount ?? null
  );

  const graph = buildArchitectureGraph(
    raw.graph,
    findings,
    raw.graphTruncated
  );

  // Extract subdir if present in URL
  const subdirMatch =
    /github\.com\/[^/]+\/[^/]+\/tree\/[^/]+\/(.+?)\/?$/i.exec(
      raw.repoUrl || target.normalizedUrl
    ) ||
    /bitbucket\.org\/[^/]+\/[^/]+\/src\/[^/]+\/(.+?)\/?$/i.exec(
      raw.repoUrl || target.normalizedUrl
    );
  const subdir = subdirMatch?.[1]?.replace(/\/+$/, "");

  const languageResolution = resolveRepositoryLanguage({
    providerLanguages: raw.meta?.languages ?? null,
    providerPrimaryLanguage:
      raw.meta?.primaryLanguage ?? raw.meta?.language ?? null,
    subdir,
  });

  const primaryLanguage = languageResolution.primaryLanguage;

  return {
    repository: {
      url: raw.repoUrl || target.normalizedUrl,
      provider: raw.meta?.provider || target.provider,
      owner: raw.meta?.owner || target.owner,
      name: raw.meta?.repo || target.name,
      subdir,
      ref: raw.ref,
      commitSha: raw.commitSha || raw.rawCommitSha,
      filesScanned: raw.filesScanned,
      totalRepoFiles: raw.totalRepoFiles,
      coverage: raw.coverage,
      incomplete: raw.incomplete,
      treeTruncated: raw.treeTruncated,
      description: raw.meta?.description ?? null,
      primaryLanguage,
      language: primaryLanguage,
      languages:
        Object.keys(languageResolution.languages).length > 0
          ? languageResolution.languages
          : undefined,
      stars: typeof raw.meta?.stars === "number" ? raw.meta.stars : undefined,
      forks: typeof raw.meta?.forks === "number" ? raw.meta.forks : undefined,
      createdAt: raw.meta?.createdAt,
      pushedAt: raw.meta?.pushedAt,
      defaultBranch: raw.meta?.defaultBranch,
      topics: raw.meta?.topics,
      openIssues: raw.meta?.openIssues,
      size: raw.meta?.size,
    },
    score: raw.riskScore,
    verdict,
    rawVerdict: raw.incomplete ? "INCONCLUSIVE" : raw.riskLevel.toUpperCase(),
    verdictExplanation,
    llmSummary: raw.llmSummary ?? null,
    findings,
    categories,
    badges: raw.badges.map((b) => ({
      type: b.type,
      label: b.label,
      description: b.description ?? "",
    })),
    graph,
    graphTruncated: Boolean(raw.graphTruncated),
    trustDiscount: raw.trustDiscount ?? null,
    scannedAt: raw.scannedAt || new Date().toISOString(),
    scanDuration: durationMs,
    scannerVersion: raw.scannerVersion,
    rulesHit,
    cached: Boolean(raw.cached),
    source: raw.source || "manual",
    rawOutput: parsedJson as Record<string, unknown>,
  };
}
