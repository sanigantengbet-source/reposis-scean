import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

const originalFetch = globalThis.fetch;

/**
 * Ensure full JSON output is captured even when scanrepo calls process.exit()
 * immediately after a large asynchronous process.stdout.write() over a pipe.
 */
const outputFilePath = process.env.SCANREPO_OUTPUT_FILE;
if (outputFilePath) {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function patchedStdoutWrite(
    chunk,
    encoding,
    callback
  ) {
    try {
      let str =
        typeof chunk === "string"
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString("utf-8")
            : String(chunk ?? "");
      if (str.trimStart().startsWith("{")) {
        try {
          const parsed = JSON.parse(str);
          if (parsed && typeof parsed === "object" && parsed.meta) {
            const owner = parsed.meta.owner || "";
            const repo = parsed.meta.repo || "";
            const cacheKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
            const cached = repoSnapshotCache.get(cacheKey);
            if (cached?.resolvedLanguageAnalysis) {
              const { primaryLanguage, languages } =
                cached.resolvedLanguageAnalysis;
              if (primaryLanguage) {
                parsed.meta.language = primaryLanguage;
                parsed.meta.primaryLanguage = primaryLanguage;
              }
              if (languages && Object.keys(languages).length > 0) {
                parsed.meta.languages = languages;
              }
              str = JSON.stringify(parsed);
            }
          }
        } catch {
          // keep original JSON string if enrichment fails
        }
        fs.writeFileSync(outputFilePath, str, "utf-8");
      }
    } catch {
      // ignore temp file write errors and continue with stdout
    }
    return originalStdoutWrite(chunk, encoding, callback);
  };
}

/**
 * Cache per "<owner>/<repo>" within a single scanrepo CLI invocation
 */
const repoSnapshotCache = new Map();

let targetSubdir = null;
for (const arg of process.argv.slice(2)) {
  const m = /github\.com\/[^/]+\/[^/]+\/tree\/[^/]+\/(.+?)\/?$/i.exec(arg);
  if (m && m[1]) {
    targetSubdir = m[1].replace(/\/+$/, "");
    break;
  }
}

const SCANNABLE_FILE_REGEX =
  /\.(js|ts|jsx|tsx|mjs|cjs|mts|cts|json|py|bat|cmd|rs|sol|go|sh|bash|zsh|md)$/i;

const IGNORED_PATH_REGEX =
  /(?:^|\/)(node_modules|\.git|dist|build|\.next|out|coverage|__pycache__|__tests__|__fixtures__|__snapshots__|vendor|public\/charting_library|lib\.commonjs|lib\.esm|lib\/umd|umd|cjs|esm|bundles|testcases|misc\/test-browser)\//;

const IGNORED_FILE_REGEX =
  /(?:\.bundle\.(?:js|mjs|cjs)$|[.-]chunk\.(?:js|mjs|cjs)$|\.d\.ts$|\.snap$|\.stories\.(?:js|jsx|ts|tsx)$|\.min\.(?:js|css|mjs|cjs)$)/i;

const PRIORITY_1_REGEXES = [
  /package\.json$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /bun\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.vscode\/tasks\.json$/,
  /(?:vite|next|webpack|rollup|babel)\.config\.\w+$/,
];

const PRIORITY_2_NAMES = new Set([
  "userController.js",
  "controller.js",
  "paymentRoute.js",
  "authHelper.js",
  "wallet.js",
  "getContract.js",
  "auth.js",
  "profile.js",
  "setup.js",
  "worker.js",
  "server.js",
  "index.js",
  "main.js",
  "app.js",
]);

const PRIORITY_3_REGEXES = [
  /controllers?\//i,
  /routes?\//i,
  /utils?\//i,
  /helpers?\//i,
  /config\//i,
  /scripts?\//i,
  /server\//i,
  /backend\//i,
  /src\//i,
];

function selectPriorityFilesToPrefetch(treeEntries, maxFiles = 125) {
  const p1 = [];
  const p2 = [];
  const p3 = [];
  const p4 = [];

  for (const entry of treeEntries) {
    const filePath = entry.path;
    if (
      targetSubdir &&
      !filePath.startsWith(targetSubdir + "/") &&
      filePath !== targetSubdir
    ) {
      continue;
    }
    if (IGNORED_PATH_REGEX.test(filePath)) continue;
    if (!SCANNABLE_FILE_REGEX.test(filePath)) continue;
    if (IGNORED_FILE_REGEX.test(filePath)) continue;

    if (/readme\.md$/i.test(filePath)) {
      p1.push(filePath);
      continue;
    }
    if (/\.md$/i.test(filePath)) continue;

    const baseName = filePath.split("/").pop() || "";
    if (PRIORITY_1_REGEXES.some((r) => r.test(filePath))) {
      p1.push(filePath);
    } else if (
      PRIORITY_2_NAMES.has(baseName) ||
      PRIORITY_2_NAMES.has(baseName.replace(/\.ts$/, ".js"))
    ) {
      p2.push(filePath);
    } else if (PRIORITY_3_REGEXES.some((r) => r.test(filePath))) {
      p3.push(filePath);
    } else {
      p4.push(filePath);
    }
  }

  return [...p1, ...p2, ...p3, ...p4].slice(0, maxFiles);
}

async function prefetchFilesConcurrently(owner, repo, sha, paths, filesMap) {
  const missing = paths.filter((p) => !filesMap.has(p));
  if (missing.length === 0) return;

  const concurrency = 30;
  for (let i = 0; i < missing.length; i += concurrency) {
    const batch = missing.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (filePath) => {
        const encodedSegments = filePath
          .split("/")
          .map((s) => encodeURIComponent(s))
          .join("/");
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${encodedSegments}`;
        try {
          const res = await originalFetch(rawUrl, {
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length <= 200_000) {
              filesMap.set(filePath, buf);
            }
          }
        } catch {
          // ignore individual file prefetch failures
        }
      })
    );
  }
}

function readNullTerminatedString(buf, offset, length) {
  const slice = buf.subarray(offset, offset + length);
  const zeroIdx = slice.indexOf(0);
  return slice
    .subarray(0, zeroIdx === -1 ? length : zeroIdx)
    .toString("utf-8");
}

/**
 * Fast git blobless tree listing (`--filter=blob:none`).
 * Downloads only git tree objects (~1s even for 200MB+ repositories) without downloading file blobs.
 */
function fetchTreeViaBloblessGit(owner, repo, ref) {
  let tmpDir = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reposcan-tree-"));
    const repoGitUrl = `https://github.com/${owner}/${repo}.git`;
    const cloneArgs = [
      "clone",
      "--bare",
      "--depth",
      "1",
      "--filter=blob:none",
      "--single-branch",
    ];
    if (ref && !/^[0-9a-f]{40}$/i.test(ref)) {
      cloneArgs.push("--branch", ref);
    }
    cloneArgs.push(repoGitUrl, tmpDir);

    execFileSync("git", cloneArgs, {
      stdio: "ignore",
      timeout: 20000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });

    const lsTreeOut = execFileSync(
      "git",
      ["--git-dir", tmpDir, "ls-tree", "-r", "HEAD"],
      {
        encoding: "utf-8",
        maxBuffer: 25 * 1024 * 1024,
        timeout: 10000,
      }
    );

    const treeEntries = [];
    const lines = lsTreeOut.split("\n");
    for (const line of lines) {
      if (!line) continue;
      const tabIdx = line.indexOf("\t");
      if (tabIdx === -1) continue;
      const filePath = line.slice(tabIdx + 1).trim();
      if (filePath) {
        treeEntries.push({
          path: filePath,
          size: 1024,
        });
      }
    }

    return treeEntries.length > 0 ? treeEntries : null;
  } catch {
    return null;
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  }
}

/**
 * Fallback streaming tar.gz parser with strict memory bounds if `git` CLI is unavailable.
 */
async function streamTarballSnapshot(owner, repo, resolvedSha) {
  const tarballUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/${resolvedSha}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  const files = new Map();
  const treeEntries = [];

  try {
    const res = await originalFetch(tarballUrl, {
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      return { files, treeEntries };
    }

    const gunzip = createGunzip();
    const sourceStream = Readable.fromWeb(res.body);

    let buffer = Buffer.alloc(0);
    let state = "HEADER";
    let currentSize = 0;
    let currentPaddedSize = 0;
    let currentType = "0";
    let currentPath = "";
    let longPathOverride = null;
    let totalStoredBytes = 0;

    sourceStream.pipe(gunzip);

    for await (const chunk of gunzip) {
      buffer = Buffer.concat([buffer, chunk]);

      while (true) {
        if (state === "HEADER") {
          if (buffer.length < 512) break;
          const header = buffer.subarray(0, 512);
          buffer = buffer.subarray(512);

          if (header[0] === 0 && header.every((b) => b === 0)) {
            continue;
          }

          const name = readNullTerminatedString(header, 0, 100);
          const sizeOctal = readNullTerminatedString(header, 124, 12).trim();
          currentSize = Number.parseInt(sizeOctal || "0", 8) || 0;
          currentPaddedSize = Math.ceil(currentSize / 512) * 512;
          currentType = String.fromCharCode(header[156]);
          const prefix = readNullTerminatedString(header, 345, 155);
          const magic = readNullTerminatedString(header, 257, 6);

          currentPath = (
            prefix && magic.startsWith("ustar") ? `${prefix}/${name}` : name
          ).replace(/\/+/g, "/");

          state = "DATA";
        }

        if (state === "DATA") {
          if (buffer.length < currentPaddedSize) break;
          const contentSlice = buffer.subarray(0, currentSize);
          buffer = buffer.subarray(currentPaddedSize);

          if (currentType === "L") {
            longPathOverride = contentSlice
              .toString("utf-8")
              .replace(/\0+$/, "");
          } else if (currentType === "x" || currentType === "g") {
            const paxText = contentSlice.toString("utf-8");
            const match = /(?:^|\n)\d+ path=([^\n]+)/.exec(paxText);
            if (match) longPathOverride = match[1];
          } else if (currentType === "0" || currentType === "\x00") {
            const fullPath = longPathOverride || currentPath;
            longPathOverride = null;
            const relativePath = fullPath.replace(/^[^/]+\//, "");
            if (relativePath) {
              treeEntries.push({ path: relativePath, size: currentSize });
              if (
                currentSize <= 200_000 &&
                totalStoredBytes < 20 * 1024 * 1024 &&
                SCANNABLE_FILE_REGEX.test(relativePath)
              ) {
                files.set(relativePath, Buffer.from(contentSlice));
                totalStoredBytes += currentSize;
              }
            }
          } else {
            longPathOverride = null;
          }

          state = "HEADER";
        }
      }

      if (treeEntries.length >= 5000) {
        controller.abort();
        break;
      }
    }
  } catch {
    // Stream aborted or timed out after collecting entries
  } finally {
    clearTimeout(timeoutId);
  }

  return { files, treeEntries };
}

async function fetchGitRefs(owner, repo) {
  const url = `https://github.com/${owner}/${repo}.git/info/refs?service=git-upload-pack`;
  const res = await originalFetch(url, {
    headers: {
      "User-Agent": "git/2.40.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    return null;
  }

  const text = await res.text();
  let defaultBranch = "main";
  const symrefMatch = /symref=HEAD:refs\/heads\/([^\s\0]+)/.exec(text);
  if (symrefMatch) {
    defaultBranch = symrefMatch[1];
  }

  const branches = new Map();
  let headSha = null;

  const lines = text.split("\n");
  for (const line of lines) {
    const headMatch = /([0-9a-f]{40})\s+HEAD(?:\0|\s|$)/.exec(line);
    if (headMatch) {
      headSha = headMatch[1];
    }
    const refMatch = /([0-9a-f]{40})\s+refs\/heads\/([^\s\0]+)/.exec(line);
    if (refMatch) {
      branches.set(refMatch[2], refMatch[1]);
    }
  }

  if (!headSha && branches.size > 0) {
    headSha = branches.get(defaultBranch) || branches.values().next().value;
  }

  if (!headSha) return null;

  return {
    defaultBranch,
    headSha,
    branches,
  };
}

async function fetchGitHubAuthoritativeLanguagesAndMeta(owner, repo) {
  const headers = {
    "User-Agent": "reposcan-language-detector",
    Accept: "application/vnd.github+json",
  };
  const token =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.SCANREPO_TOKEN?.trim() ||
    "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let providerLanguages = null;
  let repoMeta = null;

  await Promise.all([
    (async () => {
      try {
        const res = await originalFetch(
          `https://api.github.com/repos/${owner}/${repo}/languages`,
          {
            headers,
            signal: AbortSignal.timeout(4500),
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data === "object" && !Array.isArray(data)) {
            providerLanguages = data;
          }
        }
      } catch {
        // ignore if rate-limited or unreachable
      }
    })(),
    (async () => {
      try {
        const res = await originalFetch(
          `https://api.github.com/repos/${owner}/${repo}`,
          {
            headers,
            signal: AbortSignal.timeout(4500),
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data === "object") {
            repoMeta = data;
          }
        }
      } catch {
        // ignore if rate-limited or unreachable
      }
    })(),
  ]);

  return { providerLanguages, repoMeta };
}

async function fetchHtmlMeta(owner, repo) {
  try {
    const res = await originalFetch(`https://github.com/${owner}/${repo}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return {};
    const html = await res.text();

    let stars = 10;
    const starMatch =
      /id="repo-stars-counter-star"[^>]*title="([0-9,]+)"/i.exec(html) ||
      /aria-label="([0-9,]+)\s+users?\s+starred\s+this\s+repository"/i.exec(
        html
      );
    if (starMatch) {
      const parsed = Number.parseInt(starMatch[1].replace(/,/g, ""), 10);
      if (Number.isFinite(parsed)) stars = parsed;
    }

    let forks = 0;
    const forkMatch =
      /id="repo-network-counter"[^>]*title="([0-9,]+)"/i.exec(html);
    if (forkMatch) {
      const parsed = Number.parseInt(forkMatch[1].replace(/,/g, ""), 10);
      if (Number.isFinite(parsed)) forks = parsed;
    }

    let description = null;
    const descMatch =
      /<meta\s+property="og:description"\s+content="([^"]+)"/i.exec(html);
    if (descMatch) {
      description = descMatch[1]
        .replace(new RegExp(`\\s*-\\s*${owner}/${repo}.*$`, "i"), "")
        .trim();
    }

    let createdAt = null;
    let topics = [];
    const embeddedMatch =
      /<script[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/i.exec(
        html
      );
    if (embeddedMatch && embeddedMatch[1]) {
      try {
        const embedded = JSON.parse(embeddedMatch[1]);
        const repoCreated =
          embedded?.payload?.codeViewLayoutRoute?.repo?.createdAt;
        if (typeof repoCreated === "string" && repoCreated) {
          createdAt = repoCreated;
        }
        const aboutStars = embedded?.payload?.sidebarAbout?.stargazerCount;
        if (typeof aboutStars === "number" && Number.isFinite(aboutStars)) {
          stars = aboutStars;
        }
        const aboutForks = embedded?.payload?.sidebarAbout?.forksCount;
        if (typeof aboutForks === "number" && Number.isFinite(aboutForks)) {
          forks = aboutForks;
        }
        const aboutDesc = embedded?.payload?.sidebarAbout?.description;
        if (typeof aboutDesc === "string" && aboutDesc.trim()) {
          description = aboutDesc.trim();
        }
        const rawTopics = embedded?.payload?.sidebarAbout?.topics;
        if (Array.isArray(rawTopics)) {
          topics = rawTopics
            .map((t) => (typeof t?.name === "string" ? t.name : null))
            .filter(Boolean);
        }
      } catch {
        // ignore embedded JSON parse errors
      }
    }

    return { stars, forks, description, createdAt, topics };
  } catch {
    return {};
  }
}

async function getOrBuildRepoSnapshot(owner, repo, requestedRef) {
  const cacheKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  let cached = repoSnapshotCache.get(cacheKey);

  if (!cached) {
    const [refs, htmlMeta, ghAuthoritative] = await Promise.all([
      fetchGitRefs(owner, repo),
      fetchHtmlMeta(owner, repo),
      fetchGitHubAuthoritativeLanguagesAndMeta(owner, repo),
    ]);
    if (!refs) {
      return null;
    }
    const repoMeta = ghAuthoritative.repoMeta;
    cached = {
      owner,
      repo,
      defaultBranch: repoMeta?.default_branch || refs.defaultBranch,
      headSha: refs.headSha,
      branches: refs.branches,
      stars:
        typeof repoMeta?.stargazers_count === "number"
          ? repoMeta.stargazers_count
          : (htmlMeta.stars ?? 10),
      forks:
        typeof repoMeta?.forks_count === "number"
          ? repoMeta.forks_count
          : (htmlMeta.forks ?? 1),
      description: repoMeta?.description ?? htmlMeta.description ?? null,
      createdAt:
        repoMeta?.created_at || htmlMeta.createdAt || "2022-01-01T00:00:00Z",
      pushedAt: repoMeta?.pushed_at || new Date().toISOString(),
      topics: Array.isArray(repoMeta?.topics)
        ? repoMeta.topics
        : (htmlMeta.topics ?? []),
      openIssues:
        typeof repoMeta?.open_issues_count === "number"
          ? repoMeta.open_issues_count
          : 0,
      size: typeof repoMeta?.size === "number" ? repoMeta.size : null,
      providerLanguages: ghAuthoritative.providerLanguages || null,
      providerPrimaryLanguage: repoMeta?.language || null,
      resolvedLanguageAnalysis: null,
      snapshotsBySha: new Map(),
    };
    repoSnapshotCache.set(cacheKey, cached);
  }

  const resolvedSha =
    (requestedRef && cached.branches.get(requestedRef)) ||
    (requestedRef && /^[0-9a-f]{40}$/i.test(requestedRef)
      ? requestedRef
      : null) ||
    cached.headSha;

  if (!cached.snapshotsBySha.has(resolvedSha)) {
    // 1. Try fast blobless git tree first (~1s even on 180MB+ repositories)
    const gitTreeEntries = fetchTreeViaBloblessGit(
      owner,
      repo,
      requestedRef || cached.defaultBranch
    );

    if (gitTreeEntries && gitTreeEntries.length > 0) {
      cached.snapshotsBySha.set(resolvedSha, {
        files: new Map(),
        treeEntries: gitTreeEntries,
      });
    } else {
      // 2. Fallback to bounded streaming tar.gz parser
      const streamed = await streamTarballSnapshot(owner, repo, resolvedSha);
      cached.snapshotsBySha.set(resolvedSha, streamed);
    }
  }

  const snapshotData = cached.snapshotsBySha.get(resolvedSha) || {
    files: new Map(),
    treeEntries: [],
  };

  if (!cached.resolvedLanguageAnalysis) {
    cached.resolvedLanguageAnalysis = resolveLanguageWithPriority({
      providerLanguages: cached.providerLanguages,
      providerPrimaryLanguage: cached.providerPrimaryLanguage,
      treeEntries: snapshotData.treeEntries,
      filesMap: snapshotData.files,
      subdir: targetSubdir,
    });
  }

  return {
    ...cached,
    resolvedSha,
    files: snapshotData.files,
    treeEntries: snapshotData.treeEntries,
  };
}

const CANONICAL_LANG_ALIASES = {
  c: "C",
  "c++": "C++",
  cpp: "C++",
  cxx: "C++",
  cc: "C++",
  "c#": "C#",
  csharp: "C#",
  java: "Java",
  javascript: "JavaScript",
  js: "JavaScript",
  typescript: "TypeScript",
  ts: "TypeScript",
  python: "Python",
  py: "Python",
  go: "Go",
  golang: "Go",
  rust: "Rust",
  rs: "Rust",
  ruby: "Ruby",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  kotlin: "Kotlin",
  kt: "Kotlin",
  dart: "Dart",
  shell: "Shell",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",
  powershell: "PowerShell",
  ps1: "PowerShell",
  pwsh: "PowerShell",
  lua: "Lua",
  r: "R",
  scala: "Scala",
  "objective-c": "Objective-C",
  "objective-c++": "Objective-C",
  objc: "Objective-C",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "CSS",
  sass: "CSS",
  less: "CSS",
  vue: "Vue",
  svelte: "Svelte",
  solidity: "Solidity",
};

const EXT_TO_LANG = {
  c: "C",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  hpp: "C++",
  hh: "C++",
  hxx: "C++",
  "c++": "C++",
  "h++": "C++",
  ipp: "C++",
  tpp: "C++",
  inl: "C++",
  cs: "C#",
  java: "Java",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  py: "Python",
  pyw: "Python",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  kt: "Kotlin",
  kts: "Kotlin",
  dart: "Dart",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",
  ps1: "PowerShell",
  psm1: "PowerShell",
  psd1: "PowerShell",
  lua: "Lua",
  r: "R",
  scala: "Scala",
  sc: "Scala",
  m: "Objective-C",
  mm: "Objective-C",
  sql: "SQL",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "CSS",
  sass: "CSS",
  less: "CSS",
  vue: "Vue",
  svelte: "Svelte",
  sol: "Solidity",
};

const CORE_LANGS = new Set([
  "C",
  "C++",
  "C#",
  "Java",
  "JavaScript",
  "TypeScript",
  "Python",
  "Go",
  "Rust",
  "Ruby",
  "PHP",
  "Swift",
  "Kotlin",
  "Dart",
  "Lua",
  "R",
  "Scala",
  "Objective-C",
  "Vue",
  "Svelte",
  "Solidity",
]);

const AUX_LANGS = new Set(["Shell", "PowerShell", "HTML", "CSS", "SQL"]);

const NON_PRIMARY_LANGS = new Set([
  "cmake",
  "makefile",
  "dockerfile",
  "meson",
  "starlark",
  "batchfile",
  "m4",
  "roff",
  "nix",
  "just",
  "procfile",
  "jinja",
  "mustache",
  "handlebars",
  "hcl",
  "tex",
  "markdown",
  "yaml",
  "json",
  "toml",
  "xml",
  "ini",
]);

const LANG_IGNORED_DIR_REGEX =
  /(?:^|\/)(node_modules|vendor|third_party|third-party|3rdparty|external|extern|deps|dist|build|out|\.next|\.nuxt|coverage|\.nyc_output|\.git|\.svn|\.hg|__pycache__|\.venv|venv|env|target|bin|obj|packages|Pods|Carthage|\.gradle|\.idea|\.vscode|public\/charting_library|lib\.commonjs|lib\.esm|lib\/umd|umd|bundles|__snapshots__|__fixtures__)(?:\/|$)/i;

const LANG_IGNORED_FILE_REGEX =
  /(?:\.min\.(?:js|mjs|cjs|css)$|\.bundle\.(?:js|mjs|cjs|css)$|[.-]chunk\.(?:js|mjs|cjs)$|\.d\.(?:ts|mts|cts)$|\.snap$|\.map$|\.pb\.(?:go|cc|h|c)$|_pb2\.py$|\.g\.dart$|\.freezed\.dart$|\.designer\.cs$|\.generated\.\w+$|(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|Podfile\.lock|go\.sum|configure|ltmain\.sh|config\.guess|config\.sub|install-sh|depcomp|missing|aclocal\.m4)$)/i;

const AUX_SCRIPT_DIR_REGEX =
  /(?:^|\/)(\.github|\.circleci|\.husky|ci|scripts?|tools?|docker|deploy|deployment|hack|bench|benchmarks|docs?|examples?|samples?|test|tests|testing)(?:\/|$)/i;

function normalizeLang(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "unknown" || lower === "unavailable" || lower === "none" || lower === "null") {
    return null;
  }
  return CANONICAL_LANG_ALIASES[lower] || trimmed;
}

function selectPrimaryFromBreakdown(rawBreakdown) {
  const normalizedBreakdown = {};
  for (const [rawLang, rawVal] of Object.entries(rawBreakdown || {})) {
    if (typeof rawVal !== "number" || !Number.isFinite(rawVal) || rawVal <= 0) {
      continue;
    }
    if (NON_PRIMARY_LANGS.has(rawLang.trim().toLowerCase())) continue;
    const canonical = normalizeLang(rawLang);
    if (!canonical) continue;
    normalizedBreakdown[canonical] =
      (normalizedBreakdown[canonical] || 0) + rawVal;
  }

  const entries = Object.entries(normalizedBreakdown).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return { primaryLanguage: null, normalizedBreakdown: {} };
  }

  const coreEntries = entries.filter(([lang]) => CORE_LANGS.has(lang));
  const topOverall = entries[0];

  if (coreEntries.length > 0) {
    const topCore = coreEntries[0];
    const totalCoreWeight = coreEntries.reduce((acc, [, v]) => acc + v, 0);
    const totalWeight = entries.reduce((acc, [, v]) => acc + v, 0);

    if (CORE_LANGS.has(topOverall[0])) {
      return { primaryLanguage: topOverall[0], normalizedBreakdown };
    }
    if (
      AUX_LANGS.has(topOverall[0]) &&
      (totalCoreWeight >= totalWeight * 0.15 || topCore[1] >= topOverall[1] * 0.2)
    ) {
      return { primaryLanguage: topCore[0], normalizedBreakdown };
    }
  }

  return { primaryLanguage: topOverall[0], normalizedBreakdown };
}

function analyzeTreeForLanguages(treeEntries, filesMap, subdir) {
  if (!Array.isArray(treeEntries) || treeEntries.length === 0) {
    return { primaryLanguage: null, languages: {} };
  }

  const cleanSubdir = subdir ? subdir.replace(/^\/+|\/+$/g, "") : null;
  const scoped = cleanSubdir
    ? treeEntries.filter(
        (e) => e.path === cleanSubdir || e.path.startsWith(`${cleanSubdir}/`)
      )
    : treeEntries;
  const activeEntries = scoped.length > 0 ? scoped : treeEntries;

  const scores = new Map();
  const ambiguousHeaders = [];

  for (const entry of activeEntries) {
    const p = (entry.path || "").replace(/^\.\//, "");
    if (!p) continue;
    if (LANG_IGNORED_DIR_REGEX.test(p)) continue;
    if (LANG_IGNORED_FILE_REGEX.test(p)) continue;

    const baseName = p.split("/").pop() || "";
    const dotIdx = baseName.lastIndexOf(".");
    const ext =
      dotIdx > 0 && dotIdx < baseName.length - 1
        ? baseName.slice(dotIdx + 1).toLowerCase()
        : "";

    const byteSize =
      typeof entry.size === "number" && entry.size > 0 ? entry.size : 1024;
    const baseWeight = 1000 + Math.min(byteSize, 100_000) * 0.05;

    if (ext === "h") {
      const buf = filesMap?.get(p);
      if (buf) {
        const sample = buf.toString("utf-8", 0, 8000);
        if (
          /(?:^|\n)\s*#import\s+[<"]/m.test(sample) ||
          /(?:^|\n)\s*@(?:interface|protocol|property|end)\b/m.test(sample)
        ) {
          scores.set("Objective-C", (scores.get("Objective-C") || 0) + baseWeight);
          continue;
        }
        if (
          /(?:^|\n)\s*namespace\s+[A-Za-z_]\w*/m.test(sample) ||
          /(?:^|\n)\s*template\s*</m.test(sample) ||
          /(?:^|\n)\s*class\s+[A-Za-z_]\w*/m.test(sample) ||
          /\b(?:public|private|protected)\s*:/m.test(sample) ||
          /\bstd::[A-Za-z_]\w*/.test(sample)
        ) {
          scores.set("C++", (scores.get("C++") || 0) + baseWeight);
          continue;
        }
      }
      ambiguousHeaders.push(baseWeight);
      continue;
    }

    const lang = ext ? EXT_TO_LANG[ext] : undefined;
    if (!lang) continue;

    let effectiveWeight = baseWeight;
    if (lang === "Shell" || lang === "PowerShell") {
      effectiveWeight *= AUX_SCRIPT_DIR_REGEX.test(p) ? 0.15 : 0.35;
    } else if (
      (lang === "HTML" || lang === "CSS") &&
      /(?:^|\/)(?:docs?|examples?|samples?|coverage|reports?|site)(?:\/|$)/i.test(p)
    ) {
      effectiveWeight *= 0.25;
    }

    scores.set(lang, (scores.get(lang) || 0) + effectiveWeight);
  }

  if (ambiguousHeaders.length > 0) {
    const totalHeaderWeight = ambiguousHeaders.reduce((a, b) => a + b, 0);
    const cppScore = scores.get("C++") || 0;
    const cScore = scores.get("C") || 0;
    const objcScore = scores.get("Objective-C") || 0;
    const familyTotal = cppScore + cScore + objcScore;

    if (familyTotal > 0) {
      if (cppScore > 0) {
        scores.set("C++", cppScore + totalHeaderWeight * (cppScore / familyTotal));
      }
      if (cScore > 0) {
        scores.set("C", cScore + totalHeaderWeight * (cScore / familyTotal));
      }
      if (objcScore > 0) {
        scores.set(
          "Objective-C",
          objcScore + totalHeaderWeight * (objcScore / familyTotal)
        );
      }
    } else {
      scores.set("C", (scores.get("C") || 0) + totalHeaderWeight);
    }
  }

  const rawBreakdown = {};
  for (const [lang, score] of scores.entries()) {
    rawBreakdown[lang] = Math.round(score);
  }

  const { primaryLanguage, normalizedBreakdown } =
    selectPrimaryFromBreakdown(rawBreakdown);

  return {
    primaryLanguage,
    languages: normalizedBreakdown,
  };
}

function resolveLanguageWithPriority({
  providerLanguages,
  providerPrimaryLanguage,
  treeEntries,
  filesMap,
  subdir,
}) {
  const treeResult = analyzeTreeForLanguages(treeEntries, filesMap, subdir);

  // If scanning a specific subdirectory, prefer the subdirectory's own tree composition if available
  if (subdir && treeResult.primaryLanguage) {
    return {
      primaryLanguage: treeResult.primaryLanguage,
      languages: treeResult.languages,
    };
  }

  // Priority 1: GitHub Repository Languages API (/repos/{owner}/{repo}/languages)
  if (providerLanguages && Object.keys(providerLanguages).length > 0) {
    const { primaryLanguage, normalizedBreakdown } =
      selectPrimaryFromBreakdown(providerLanguages);
    if (primaryLanguage) {
      if (
        AUX_LANGS.has(primaryLanguage) &&
        treeResult.primaryLanguage &&
        CORE_LANGS.has(treeResult.primaryLanguage)
      ) {
        return {
          primaryLanguage: treeResult.primaryLanguage,
          languages:
            Object.keys(normalizedBreakdown).length > 0
              ? normalizedBreakdown
              : treeResult.languages,
        };
      }
      return {
        primaryLanguage,
        languages: normalizedBreakdown,
      };
    }
  }

  // Priority 2: Provider repository metadata (repo.language)
  const normProvider = normalizeLang(providerPrimaryLanguage);
  if (normProvider) {
    if (
      AUX_LANGS.has(normProvider) &&
      treeResult.primaryLanguage &&
      CORE_LANGS.has(treeResult.primaryLanguage)
    ) {
      return {
        primaryLanguage: treeResult.primaryLanguage,
        languages: treeResult.languages,
      };
    }
    return {
      primaryLanguage: normProvider,
      languages:
        Object.keys(treeResult.languages).length > 0
          ? treeResult.languages
          : { [normProvider]: 1 },
    };
  }

  // Priority 3 & 4: Tree extension + content analysis
  if (treeResult.primaryLanguage) {
    return {
      primaryLanguage: treeResult.primaryLanguage,
      languages: treeResult.languages,
    };
  }

  return {
    primaryLanguage: "Unknown",
    languages: {},
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    },
  });
}

async function handleGitHubApiFallback(urlObj) {
  const pathname = urlObj.pathname;

  // 1. /users/:username
  const userMatch = /^\/users\/([^/]+)$/.exec(pathname);
  if (userMatch) {
    return jsonResponse({ login: userMatch[1], public_repos: 2 });
  }

  // 2. /repos/:owner/:repo
  const repoRootMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (repoRootMatch) {
    const [, owner, repo] = repoRootMatch;
    const snapshot = await getOrBuildRepoSnapshot(owner, repo);
    if (!snapshot) {
      return jsonResponse({ message: "Not Found", status: "404" }, 404);
    }
    const resolvedLanguage =
      snapshot.resolvedLanguageAnalysis?.primaryLanguage || "Unknown";
    return jsonResponse({
      owner: { login: owner },
      name: repo,
      full_name: `${owner}/${repo}`,
      description: snapshot.description,
      stargazers_count: snapshot.stars,
      forks_count: snapshot.forks,
      created_at: snapshot.createdAt || "2022-01-01T00:00:00Z",
      pushed_at: snapshot.pushedAt || new Date().toISOString(),
      default_branch: snapshot.defaultBranch,
      language: resolvedLanguage,
      topics: snapshot.topics || [],
      open_issues_count: snapshot.openIssues || 0,
      size: snapshot.size ?? snapshot.treeEntries.length * 4,
      private: false,
    });
  }

  // 3. /repos/:owner/:repo/branches/:branch
  const branchMatch = /^\/repos\/([^/]+)\/([^/]+)\/branches\/(.+)$/.exec(
    pathname
  );
  if (branchMatch) {
    const [, owner, repo, rawBranch] = branchMatch;
    const branch = decodeURIComponent(rawBranch);
    const snapshot = await getOrBuildRepoSnapshot(owner, repo, branch);
    if (!snapshot) {
      return jsonResponse({ message: "Not Found", status: "404" }, 404);
    }
    return jsonResponse({
      name: branch,
      commit: {
        sha: snapshot.resolvedSha,
      },
    });
  }

  // 4. /repos/:owner/:repo/git/trees/:sha
  const treeMatch = /^\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^/]+)$/.exec(
    pathname
  );
  if (treeMatch) {
    const [, owner, repo, sha] = treeMatch;
    const snapshot = await getOrBuildRepoSnapshot(owner, repo, sha);
    if (!snapshot) {
      return jsonResponse({ message: "Not Found", status: "404" }, 404);
    }
    const priorityPaths = selectPriorityFilesToPrefetch(snapshot.treeEntries);
    await prefetchFilesConcurrently(
      owner,
      repo,
      snapshot.resolvedSha,
      priorityPaths,
      snapshot.files
    );
    const tree = snapshot.treeEntries.map((entry) => ({
      path: entry.path,
      type: "blob",
      sha: snapshot.resolvedSha,
      size: entry.size,
    }));
    return jsonResponse({
      sha: snapshot.resolvedSha,
      truncated: false,
      tree,
    });
  }

  // 5. /repos/:owner/:repo/contents/:path
  const contentsMatch = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(
    pathname
  );
  if (contentsMatch) {
    const [, owner, repo, encodedPath] = contentsMatch;
    const filePath = decodeURIComponent(encodedPath);
    const ref = urlObj.searchParams.get("ref") || undefined;
    const snapshot = await getOrBuildRepoSnapshot(owner, repo, ref);
    if (snapshot && snapshot.files.has(filePath)) {
      const contentBuf = snapshot.files.get(filePath);
      return jsonResponse({
        name: filePath.split("/").pop() || filePath,
        path: filePath,
        encoding: "base64",
        content: contentBuf.toString("base64"),
      });
    }

    // Fetch individual targeted source file directly from raw.githubusercontent.com CDN (no 60/hr API rate limit)
    const targetRef = snapshot?.resolvedSha || ref || "HEAD";
    const encodedSegments = filePath
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${targetRef}/${encodedSegments}`;
    try {
      const rawRes = await originalFetch(rawUrl, {
        signal: AbortSignal.timeout(12000),
      });
      if (rawRes.ok) {
        const buf = Buffer.from(await rawRes.arrayBuffer());
        if (snapshot && buf.length <= 200_000) {
          snapshot.files.set(filePath, buf);
        }
        return jsonResponse({
          name: filePath.split("/").pop() || filePath,
          path: filePath,
          encoding: "base64",
          content: buf.toString("base64"),
        });
      }
    } catch {
      // fall through to 404
    }

    return jsonResponse({ message: "Not Found", status: "404" }, 404);
  }

  // 6. /repos/:owner/:repo/commits
  const commitsMatch = /^\/repos\/([^/]+)\/([^/]+)\/commits$/.exec(pathname);
  if (commitsMatch) {
    return jsonResponse([]);
  }

  return null;
}

globalThis.fetch = async function patchedFetch(input, init) {
  const urlString =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  let urlObj;
  try {
    urlObj = new URL(urlString);
  } catch {
    return originalFetch(input, init);
  }

  // Prevent scanrepo's internal EF() from buffering 100MB+ full repo tarballs into memory
  if (urlObj.hostname === "codeload.github.com") {
    return new Response(null, { status: 404 });
  }

  if (urlObj.hostname === "api.github.com") {
    const hasToken = Boolean(process.env.GITHUB_TOKEN?.trim());

    if (hasToken) {
      try {
        const res = await originalFetch(input, init);
        if (res.status !== 403 && res.status !== 429) {
          return res;
        }
      } catch {
        // fallback below
      }
    }

    const fallbackRes = await handleGitHubApiFallback(urlObj);
    if (fallbackRes) {
      return fallbackRes;
    }
  }

  return originalFetch(input, init);
};
