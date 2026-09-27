# RepoScan

Repository Security Scanner powered by ScanRepo.

RepoScan is a stateless developer security dashboard that scans public GitHub and Bitbucket repositories for malicious code, credential stealers, supply-chain threats, obfuscated payloads, and suspicious repository activity before you clone or run them.

> **Important Security Notice**: *"A low-risk/safe result is not a guarantee that a repository is safe."*
> ScanRepo uses heuristic static pattern analysis. A `SAFE` or `LOW` verdict indicates that no known malicious patterns were matched during the scan, not that the code is guaranteed free of vulnerabilities or novel malware.

---

## Features

- **Real Static Security Scanning**: Powered directly by the `scanrepo` CLI engine (`--json --no-publish --no-color`) running server-side.
- **Zero Code Execution**: Target repositories are treated strictly as untrusted input. RepoScan never clones+executes, installs dependencies (`npm install`), runs lifecycle hooks (`preinstall`/`postinstall`), or executes binaries from scanned repositories.
- **GitHub & Bitbucket Support**: Supports public repositories on `github.com` and `bitbucket.org`.
- **Comprehensive Threat Breakdown**:
  - Risk Score (`0–100`) and original ScanRepo Verdict (`SAFE`, `LOW`, `SUSPICIOUS`, `DANGEROUS`, `MALICIOUS`, `INCONCLUSIVE`)
  - Severity counters (`Critical`, `High`, `Medium`, `Low`)
  - Threat categories (`Code Execution`, `Credential Theft`, `Data Exfiltration`, `Obfuscation`, `Supply Chain`, `Web Vulnerabilities`)
  - Detailed finding inspector with file path, line number (when provided by scanner), rule ID, description, code snippet evidence, and manual review guidance
- **Raw JSON & Client-Side Export**: Inspect the raw `scanrepo` JSON output, copy to clipboard, or download as `repository-scan.json`.
- **Stateless / No-Database Architecture**: Zero database dependencies. Lightweight recent scan metadata (`repositoryUrl`, `score`, `verdict`, `timestamp`) is stored exclusively in browser `localStorage` with a one-click **Clear Local History** control.
- **Responsive Developer UI**: Supabase-inspired dark/light mode interface engineered for mobile (`360px–430px`), tablet (`768px–1024px`), and desktop (`1280px–1920px`).

---

## Architecture

```text
User Browser
    ↓
POST /api/scan  { "repositoryUrl": "https://github.com/owner/repository" }
    ↓
Zod URL Validation & SSRF Guard (lib/validations/scan.ts)
    ↓
Server-Side Scan Engine (lib/scanrepo/scanner.ts)
    ↓
scanrepo CLI (--json --no-publish --no-color)
    ↓
Typed Zod Output Parser (lib/scanrepo/parser.ts)
    ↓
Interactive Security Dashboard (/results)
```

### Project Structure

```text
app/
├── page.tsx                 # Landing page with scanner & threat overview
├── scan/
│   └── page.tsx             # Dedicated scanner workspace
├── results/
│   └── page.tsx             # Interactive security report dashboard
├── api/
│   └── scan/
│       └── route.ts         # Server-side POST /api/scan Route Handler
├── layout.tsx               # Root layout & ThemeProvider
└── globals.css              # Tailwind CSS & theme variables

components/
├── ui/                      # shadcn/ui primitives (Button, Input, Card, Dialog, Tabs, Sheet)
├── scanner/                 # ScannerForm, ScanLoadingState, ScanErrorState, RecentScansPanel
├── dashboard/               # ResultsDashboard, RawJsonViewer
├── findings/                # FindingsList, FindingDetailDialog
└── layout/                  # Navbar, Footer, ThemeProvider

lib/
├── scanrepo/
│   ├── scanner.ts           # Server-side scanrepo CLI runner with timeout & error classification
│   ├── parser.ts            # Typed Zod parser & normalizer for scanrepo JSON output
│   └── types.ts             # Raw scanrepo Zod schemas & ScanEngineError
├── validations/
│   └── scan.ts              # Strict URL validation & SSRF protection
└── utils/
    ├── rate-limit.ts        # Stateless serverless rate limiting
    └── recent-scans.ts      # Browser localStorage & sessionStorage helpers

types/
└── scan.ts                  # Normalized TypeScript interfaces (ScanResult, SecurityFinding)
```

---

## Installation

```bash
npm install
```

---

## Local Development

Start the Next.js development server on port 3000:

```bash
npm run dev
```

Verify linting, TypeScript types, and production build:

```bash
npm run lint
npm run typecheck
npm run build
```

---

## Environment Variables

Copy `.env.example` to `.env.local`:

```dotenv
SCANREPO_API_URL=
SCANREPO_TOKEN=
SCAN_TIMEOUT_MS=120000
GITHUB_TOKEN=
```

- `SCAN_TIMEOUT_MS`: Maximum duration in milliseconds allowed for a single `scanrepo` execution before timing out (default: `120000`).
- `GITHUB_TOKEN`: Optional server-side GitHub Personal Access Token (PAT). Providing a server-side token increases GitHub API rate limits and improves file scan coverage on large public repositories. Never exposed to the browser.
- `SCANREPO_API_URL` / `SCANREPO_TOKEN`: Optional server-side configuration variables.

---

## `scanrepo` Setup

`scanrepo` is installed as a project dependency in `package.json` (`"scanrepo": "^0.2.0"`).

- RepoScan invokes `scanrepo` on the server with `--json --no-publish --no-color`.
- The `--no-publish` flag is always enforced so user scan requests remain private to their session and are never automatically published to external feeds.
- `child_process.execFile` is invoked with `shell: false` to prevent command injection.

---

## Vercel Deployment

RepoScan is built on Next.js App Router (`runtime = "nodejs"` on `/api/scan`) and is ready for deployment on Vercel:

1. Push the repository to GitHub/GitLab/Bitbucket and import it into Vercel.
2. Configure optional environment variables (`GITHUB_TOKEN`, `SCAN_TIMEOUT_MS`) in the Vercel Project Settings.
3. Deploy — no database provisioning, migrations, or background workers are required.

---

## Security Model

1. **Untrusted Repository Isolation**: Target repositories are never cloned and executed. `scanrepo` fetches repository trees/snapshots via the GitHub/Bitbucket APIs and performs pure static analysis in memory.
2. **SSRF Prevention**: `lib/validations/scan.ts` strictly validates URLs using Zod and rejects `localhost`, `127.0.0.1`, `0.0.0.0`, private IPv4/IPv6 CIDR blocks, `file://`, `ftp://`, `javascript:`, and `data:` schemes. Only `github.com`, `www.github.com`, `bitbucket.org`, and `www.bitbucket.org` are permitted.
3. **No Secret Exposure**: `GITHUB_TOKEN` and `SCANREPO_TOKEN` are read strictly on the server inside `/api/scan`.
4. **Stateless Rate Limiting**: `/api/scan` uses an HMAC-signed sliding-window cookie paired with per-instance IP burst throttling to protect against automated floods without requiring Redis or a database.

---

## Limitations

- **Heuristic Static Analysis**: *"A low-risk/safe result is not a guarantee that a repository is safe."* Heavily obfuscated or novel zero-day payloads may evade static rules.
- **Public Repositories Only**: Private repositories are not supported by `scanrepo`.
- **Upstream Rate Limits**: Without a server-side `GITHUB_TOKEN`, anonymous GitHub/Bitbucket API limits may result in partial/inconclusive scans on very large repositories or during high traffic.
- **Stateless Rate Limiting**: Because no external database or Redis store is used, clients that clear cookies across distributed serverless cold starts are bounded by per-instance limits and upstream Git provider rate limits.

---

## No Database Architecture

RepoScan intentionally uses **zero databases** (no Prisma, Drizzle, Supabase, Neon, PostgreSQL, MongoDB, SQLite, or Redis) and requires **no user accounts**.
- Active scan reports live only in client memory / `sessionStorage` for the current tab lifecycle.
- Only lightweight metadata (`repositoryUrl`, `score`, `verdict`, `timestamp`) is saved in browser `localStorage` under **Recent Scans**, which users can clear at any time.
