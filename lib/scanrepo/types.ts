import { z } from "zod";
import type {
  ScanErrorCode,
  ScanResult,
  SecurityFinding,
  RepositoryProvider,
  ScanVerdict,
  FindingSeverity,
} from "@/types/scan";

export const RawScanRepoFindingSchema = z
  .object({
    ruleId: z.string().optional(),
    category: z.string().optional(),
    severity: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional().nullable(),
    filePath: z.string().optional().nullable(),
    file: z.string().optional().nullable(),
    line: z.number().int().positive().optional().nullable(),
    snippet: z.string().optional().nullable(),
    evidence: z.string().optional().nullable(),
    recommendation: z.string().optional().nullable(),
    points: z.number().optional().nullable(),
  })
  .passthrough();

export const RawScanRepoCategorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    icon: z.string().optional(),
    score: z.number().default(0),
    maxScore: z.number().default(25),
    findings: z.array(RawScanRepoFindingSchema).optional().default([]),
  })
  .passthrough();

export const RawScanRepoBadgeSchema = z
  .object({
    type: z.enum(["danger", "warning", "info"]).catch("info"),
    label: z.string(),
    description: z.string().optional().default(""),
  })
  .passthrough();

export const RawScanRepoGraphNodeSchema = z
  .object({
    id: z.string(),
    path: z.string().optional(),
    label: z.string().optional(),
    kind: z.string().optional(),
    findings: z.array(RawScanRepoFindingSchema).optional().default([]),
    isEntry: z.boolean().optional(),
  })
  .passthrough();

export const RawScanRepoGraphEdgeSchema = z
  .object({
    source: z.string(),
    target: z.string(),
    kind: z.string().optional(),
  })
  .passthrough();

export const RawScanRepoGraphSchema = z
  .object({
    nodes: z.array(RawScanRepoGraphNodeSchema).optional().default([]),
    edges: z.array(RawScanRepoGraphEdgeSchema).optional().default([]),
    entryPoints: z.array(z.string()).optional().default([]),
  })
  .passthrough();

export const RawScanRepoOutputSchema = z
  .object({
    repoUrl: z.string().optional(),
    meta: z
      .object({
        provider: z.enum(["github", "bitbucket"]).optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        description: z.string().nullable().optional(),
        stars: z.number().optional(),
        forks: z.number().optional(),
        createdAt: z.string().optional(),
        pushedAt: z.string().optional(),
        defaultBranch: z.string().optional(),
        primaryLanguage: z.string().nullable().optional(),
        language: z.string().nullable().optional(),
        languages: z.record(z.string(), z.number()).nullable().optional(),
        topics: z.array(z.string()).optional(),
        openIssues: z.number().optional(),
        size: z.number().optional(),
      })
      .passthrough()
      .optional(),
    ref: z.string().optional(),
    treeTruncated: z.boolean().optional(),
    trustDiscount: z
      .object({
        reason: z.string(),
        cappedAt: z.number(),
      })
      .nullable()
      .optional(),
    riskScore: z.number().min(0).max(100),
    riskLevel: z.string(),
    categories: z.array(RawScanRepoCategorySchema).optional().default([]),
    findings: z.array(RawScanRepoFindingSchema).optional().default([]),
    badges: z.array(RawScanRepoBadgeSchema).optional().default([]),
    graph: RawScanRepoGraphSchema.nullable().optional(),
    graphTruncated: z.boolean().optional(),
    llmSummary: z.string().nullable().optional(),
    scannedAt: z.string().optional(),
    scannerVersion: z.string().optional(),
    commitSha: z.string().optional(),
    rawCommitSha: z.string().optional(),
    filesScanned: z.number().optional(),
    totalRepoFiles: z.number().optional(),
    coverage: z.number().optional(),
    incomplete: z.boolean().optional(),
    cached: z.boolean().optional(),
    source: z.string().optional(),
  })
  .passthrough();

export type RawScanRepoOutput = z.infer<typeof RawScanRepoOutputSchema>;
export type RawScanRepoFinding = z.infer<typeof RawScanRepoFindingSchema>;

export class ScanEngineError extends Error {
  public readonly code: ScanErrorCode;
  public readonly statusCode: number;

  constructor(code: ScanErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "ScanEngineError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type {
  ScanResult,
  SecurityFinding,
  RepositoryProvider,
  ScanVerdict,
  FindingSeverity,
  ScanErrorCode,
};
