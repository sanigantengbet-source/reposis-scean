export type RepositoryProvider = "github" | "bitbucket";

export type ScanVerdict =
  | "safe"
  | "low"
  | "suspicious"
  | "dangerous"
  | "malicious"
  | "unknown";

export type FindingSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

export type StandardCategoryKey =
  | "Code Execution"
  | "Network & Exfiltration"
  | "File System Access"
  | "Obfuscation"
  | "Supply Chain"
  | "OWASP / Injection"
  | "Credential Theft"
  | "Data Exfiltration"
  | "Web Vulnerabilities";

export interface SecurityFinding {
  id: string;
  ruleId?: string;
  severity: FindingSeverity;
  rawSeverity?: string;
  title: string;
  description?: string;
  category?: string;
  rawCategoryId?: string;
  file?: string;
  line?: number;
  evidence?: string;
  recommendation?: string;
  points?: number;
}

export interface ScanCategorySummary {
  id: string;
  name: string;
  normalizedName: StandardCategoryKey | string;
  score: number;
  maxScore: number;
  findingsCount: number;
}

export interface ScanBadge {
  type: "danger" | "warning" | "info";
  label: string;
  description: string;
}

export type ScanGraphNodeKind =
  | "entry"
  | "entry-flagged"
  | "flagged"
  | "reachable"
  | "orphan"
  | "package";

export interface ScanGraphNode {
  id: string;
  path: string;
  label: string;
  kind: ScanGraphNodeKind;
  isEntry: boolean;
  isFlagged: boolean;
  isPackage: boolean;
  findingsCount: number;
  findingIds: string[];
  findings: Array<{
    id?: string;
    ruleId?: string;
    severity?: string;
    title?: string;
    description?: string;
    line?: number;
  }>;
}

export interface ScanGraphEdge {
  source: string;
  target: string;
  kind: string;
}

export interface ScanArchitectureGraph {
  nodes: ScanGraphNode[];
  edges: ScanGraphEdge[];
  entryPoints: string[];
  truncated?: boolean;
  counts: {
    totalNodes: number;
    totalEdges: number;
    entry: number;
    flagged: number;
    pkg: number;
  };
}

export interface ScanResult {
  repository: {
    url: string;
    provider: RepositoryProvider;
    owner?: string;
    name?: string;
    subdir?: string;
    ref?: string;
    commitSha?: string;
    filesScanned?: number;
    totalRepoFiles?: number;
    coverage?: number;
    incomplete?: boolean;
    treeTruncated?: boolean;
    description?: string | null;
    primaryLanguage?: string | null;
    language?: string | null;
    languages?: Record<string, number>;
    stars?: number;
    forks?: number;
    createdAt?: string;
    pushedAt?: string;
    defaultBranch?: string;
    topics?: string[];
    openIssues?: number;
    size?: number;
  };
  score: number;
  verdict: ScanVerdict;
  rawVerdict?: string;
  verdictExplanation?: string;
  llmSummary?: string | null;
  findings: SecurityFinding[];
  categories: ScanCategorySummary[];
  badges: ScanBadge[];
  graph?: ScanArchitectureGraph | null;
  graphTruncated?: boolean;
  trustDiscount?: {
    reason: string;
    cappedAt: number;
  } | null;
  scannedAt: string;
  scanDuration?: number;
  scannerVersion?: string;
  rulesHit?: number;
  cached?: boolean;
  source?: string;
  rawOutput: Record<string, unknown>;
}

export interface RecentScanItem {
  repositoryUrl: string;
  provider: RepositoryProvider;
  owner?: string;
  name?: string;
  primaryLanguage?: string | null;
  language?: string | null;
  score: number;
  verdict: ScanVerdict;
  timestamp: string;
}

export type ScanErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROVIDER"
  | "REPOSITORY_NOT_FOUND"
  | "REPOSITORY_INACCESSIBLE"
  | "RATE_LIMITED"
  | "SCAN_FAILED"
  | "MALFORMED_OUTPUT"
  | "TIMEOUT"
  | "UNEXPECTED_ERROR";

export interface ScanApiErrorResponse {
  error: {
    code: ScanErrorCode;
    message: string;
    details?: string;
  };
}
