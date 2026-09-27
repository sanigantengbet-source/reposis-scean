import { NextRequest, NextResponse } from "next/server";
import { scanRepository } from "@/lib/scanrepo/scanner";
import { ScanEngineError } from "@/lib/scanrepo/types";
import { checkStatelessRateLimit } from "@/lib/utils/rate-limit";
import { ScanRequestSchema } from "@/lib/validations/scan";
import type { ScanApiErrorResponse } from "@/types/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // 1. Check stateless serverless rate limit
  const rateLimit = checkStatelessRateLimit(req);
  if (!rateLimit.allowed) {
    const errorPayload: ScanApiErrorResponse = {
      error: {
        code: "RATE_LIMITED",
        message: `Rate limit exceeded. Please wait ${rateLimit.retryAfterSeconds}s before starting another scan.`,
      },
    };
    const res = NextResponse.json(errorPayload, {
      status: 429,
      headers: {
        "Retry-After": String(rateLimit.retryAfterSeconds),
        "Cache-Control": "no-store, max-age=0",
      },
    });
    res.cookies.set(rateLimit.cookieName, rateLimit.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/scan",
      maxAge: 60,
    });
    return res;
  }

  // 2. Parse request body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    const errorPayload: ScanApiErrorResponse = {
      error: {
        code: "INVALID_URL",
        message: "Invalid JSON request body.",
      },
    };
    return NextResponse.json(errorPayload, {
      status: 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  // 3. Validate input structure with Zod
  const parsedBody = ScanRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const firstIssue =
      parsedBody.error.issues[0]?.message || "Invalid repository URL.";
    const errorPayload: ScanApiErrorResponse = {
      error: {
        code: "INVALID_URL",
        message: firstIssue,
      },
    };
    return NextResponse.json(errorPayload, {
      status: 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  // 4. Execute scanrepo static analysis engine
  const forceRescan = Boolean(
    rawBody &&
      typeof rawBody === "object" &&
      "rescan" in rawBody &&
      (rawBody as { rescan?: unknown }).rescan === true
  );

  try {
    const scanResult = await scanRepository(parsedBody.data.repositoryUrl, {
      forceRescan,
    });

    const response = NextResponse.json(scanResult, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      },
    });

    response.cookies.set(rateLimit.cookieName, rateLimit.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/scan",
      maxAge: 60,
    });

    return response;
  } catch (err) {
    if (err instanceof ScanEngineError) {
      const errorPayload: ScanApiErrorResponse = {
        error: {
          code: err.code,
          message: err.message,
        },
      };
      return NextResponse.json(errorPayload, {
        status: err.statusCode,
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    const errorPayload: ScanApiErrorResponse = {
      error: {
        code: "UNEXPECTED_ERROR",
        message:
          "Unable to scan repository. The repository may be unavailable, unsupported, rate-limited, or the scanner encountered an error.",
      },
    };
    return NextResponse.json(errorPayload, {
      status: 500,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}

export async function GET(req: NextRequest) {
  const repoParam = req.nextUrl.searchParams.get("repo");
  const forceRescan = req.nextUrl.searchParams.get("rescan") === "true";

  if (!repoParam || repoParam.trim().length === 0) {
    const errorPayload: ScanApiErrorResponse = {
      error: {
        code: "INVALID_URL",
        message: "Missing required query parameter: ?repo=<repository-url>",
      },
    };
    return NextResponse.json(errorPayload, {
      status: 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  const rateLimit = checkStatelessRateLimit(req);
  if (!rateLimit.allowed) {
    const errorPayload: ScanApiErrorResponse = {
      error: {
        code: "RATE_LIMITED",
        message: `Rate limit exceeded. Please wait ${rateLimit.retryAfterSeconds}s before starting another scan.`,
      },
    };
    return NextResponse.json(errorPayload, {
      status: 429,
      headers: {
        "Retry-After": String(rateLimit.retryAfterSeconds),
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  const parsed = ScanRequestSchema.safeParse({ repositoryUrl: repoParam });
  if (!parsed.success) {
    const firstIssue =
      parsed.error.issues[0]?.message || "Invalid repository URL.";
    const errorPayload: ScanApiErrorResponse = {
      error: {
        code: "INVALID_URL",
        message: firstIssue,
      },
    };
    return NextResponse.json(errorPayload, {
      status: 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  try {
    const scanResult = await scanRepository(parsed.data.repositoryUrl, {
      forceRescan,
    });
    const response = NextResponse.json(scanResult, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      },
    });
    response.cookies.set(rateLimit.cookieName, rateLimit.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/scan",
      maxAge: 60,
    });
    return response;
  } catch (err) {
    if (err instanceof ScanEngineError) {
      const errorPayload: ScanApiErrorResponse = {
        error: {
          code: err.code,
          message: err.message,
        },
      };
      return NextResponse.json(errorPayload, {
        status: err.statusCode,
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    const errorPayload: ScanApiErrorResponse = {
      error: {
        code: "UNEXPECTED_ERROR",
        message:
          "Unable to scan repository. The repository may be unavailable, unsupported, rate-limited, or the scanner encountered an error.",
      },
    };
    return NextResponse.json(errorPayload, {
      status: 500,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}
