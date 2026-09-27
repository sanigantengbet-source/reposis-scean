export interface TreeFileEntry {
  path: string;
  size?: number;
}

export interface LanguageDetectionInput {
  /**
   * Authoritative language byte breakdown from GitHub API (`/repos/{owner}/{repo}/languages`)
   * or provider language statistics.
   */
  providerLanguages?: Record<string, number> | null;
  /**
   * Primary language field from provider repository metadata (`/repos/{owner}/{repo}`).
   */
  providerPrimaryLanguage?: string | null;
  /**
   * Full repository file tree entries (paths and optional byte sizes).
   */
  treeEntries?: TreeFileEntry[] | null;
  /**
   * Optional map or record of file path -> file content string/Buffer for content analysis fallback.
   */
  fileContents?: Map<string, string | Buffer> | Record<string, string> | null;
  /**
   * Optional subdirectory filter when scanning a specific subdirectory URL.
   */
  subdir?: string | null;
}

export interface LanguageDetectionResult {
  primaryLanguage: string;
  languages: Record<string, number>;
  source:
    | "provider-languages-api"
    | "provider-metadata"
    | "tree-extension-analysis"
    | "content-analysis"
    | "unknown";
}

/**
 * Canonical language names mapped from case-insensitive aliases.
 */
const CANONICAL_LANGUAGE_ALIASES: Record<string, string> = {
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
  node: "JavaScript",
  nodejs: "JavaScript",
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
  "obj-c": "Objective-C",
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

/**
 * Unambiguous file extension to canonical language mapping.
 * Note: `.h` is handled separately via disambiguation between C, C++, and Objective-C.
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // C
  c: "C",

  // C++
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

  // C#
  cs: "C#",

  // Java
  java: "Java",

  // JavaScript
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",

  // TypeScript
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",

  // Python
  py: "Python",
  pyw: "Python",

  // Go
  go: "Go",

  // Rust
  rs: "Rust",

  // Ruby
  rb: "Ruby",

  // PHP
  php: "PHP",

  // Swift
  swift: "Swift",

  // Kotlin
  kt: "Kotlin",
  kts: "Kotlin",

  // Dart
  dart: "Dart",

  // Shell
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",

  // PowerShell
  ps1: "PowerShell",
  psm1: "PowerShell",
  psd1: "PowerShell",

  // Lua
  lua: "Lua",

  // R
  r: "R",

  // Scala
  scala: "Scala",
  sc: "Scala",

  // Objective-C
  m: "Objective-C",
  mm: "Objective-C",

  // SQL
  sql: "SQL",

  // HTML
  html: "HTML",
  htm: "HTML",

  // CSS
  css: "CSS",
  scss: "CSS",
  sass: "CSS",
  less: "CSS",

  // Vue
  vue: "Vue",

  // Svelte
  svelte: "Svelte",

  // Solidity
  sol: "Solidity",
};

/**
 * Core primary programming languages vs auxiliary scripting/markup/query languages.
 */
const CORE_PROGRAMMING_LANGUAGES = new Set<string>([
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

const AUXILIARY_LANGUAGES = new Set<string>([
  "Shell",
  "PowerShell",
  "HTML",
  "CSS",
  "SQL",
]);

/**
 * Non-primary build/configuration/documentation languages returned by GitHub's /languages endpoint
 * that should not be chosen as the primary programming language when a real language exists.
 */
const NON_PRIMARY_PROVIDER_LANGUAGES = new Set<string>([
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

/**
 * Vendor, third-party, build output, cache, and VCS directories to ignore during language detection.
 */
const IGNORED_DIRECTORY_REGEX =
  /(?:^|\/)(node_modules|vendor|third_party|third-party|3rdparty|external|extern|deps|dist|build|out|\.next|\.nuxt|coverage|\.nyc_output|\.git|\.svn|\.hg|__pycache__|\.venv|venv|env|target|bin|obj|packages|Pods|Carthage|\.gradle|\.idea|\.vscode|public\/charting_library|lib\.commonjs|lib\.esm|lib\/umd|umd|bundles|__snapshots__|__fixtures__)(?:\/|$)/i;

/**
 * Generated, minified, bundled, lock, declaration, and binary files to ignore.
 */
const IGNORED_FILE_PATTERN_REGEX =
  /(?:\.min\.(?:js|mjs|cjs|css)$|\.bundle\.(?:js|mjs|cjs|css)$|[.-]chunk\.(?:js|mjs|cjs)$|\.d\.(?:ts|mts|cts)$|\.snap$|\.map$|\.pb\.(?:go|cc|h|c)$|_pb2\.py$|\.g\.dart$|\.freezed\.dart$|\.designer\.cs$|\.generated\.\w+$|(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|Podfile\.lock|go\.sum|configure|ltmain\.sh|config\.guess|config\.sub|install-sh|depcomp|missing|aclocal\.m4)$)/i;

/**
 * Auxiliary directories where utility scripts (e.g. CI/build `.sh` scripts) commonly live.
 */
const AUXILIARY_SCRIPT_DIR_REGEX =
  /(?:^|\/)(\.github|\.circleci|\.husky|ci|scripts?|tools?|docker|deploy|deployment|hack|bench|benchmarks|docs?|examples?|samples?|test|tests|testing)(?:\/|$)/i;

export function normalizeLanguageName(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "unknown" || lower === "unavailable" || lower === "none" || lower === "null") {
    return null;
  }
  if (CANONICAL_LANGUAGE_ALIASES[lower]) {
    return CANONICAL_LANGUAGE_ALIASES[lower];
  }
  return trimmed;
}

/**
 * Inspects file content (when available) to disambiguate `.h` headers or extensionless scripts.
 */
export function detectLanguageFromContent(
  filePath: string,
  content: string
): string | null {
  if (!content || typeof content !== "string") return null;
  const sample = content.slice(0, 8000);
  const ext = getFileExtension(filePath);

  if (ext === "h") {
    // Check Objective-C indicators first
    if (
      /(?:^|\n)\s*#import\s+[<"]/m.test(sample) ||
      /(?:^|\n)\s*@(?:interface|protocol|property|end)\b/m.test(sample) ||
      /\bNSObject\b/.test(sample)
    ) {
      return "Objective-C";
    }

    // Check C++ indicators in .h header
    if (
      /(?:^|\n)\s*namespace\s+[A-Za-z_]\w*/m.test(sample) ||
      /(?:^|\n)\s*template\s*</m.test(sample) ||
      /(?:^|\n)\s*class\s+[A-Za-z_]\w*/m.test(sample) ||
      /\b(?:public|private|protected)\s*:/m.test(sample) ||
      /\bstd::[A-Za-z_]\w*/.test(sample) ||
      /\b(?:nullptr|constexpr|noexcept|virtual|override|typename|dynamic_cast|static_cast|reinterpret_cast)\b/.test(
        sample
      ) ||
      /(?:^|\n)\s*#\s*include\s*<(?:iostream|vector|string|memory|map|unordered_map|set|unordered_set|algorithm|functional|optional|variant|tuple|sstream|fstream|thread|mutex|atomic|chrono|stdexcept|type_traits|utility|array|deque)>/m.test(
        sample
      )
    ) {
      return "C++";
    }

    return "C";
  }

  // Shebang analysis for extensionless files
  const firstLine = sample.split(/\r?\n/, 1)[0] || "";
  if (firstLine.startsWith("#!")) {
    const lowerShebang = firstLine.toLowerCase();
    if (lowerShebang.includes("python")) return "Python";
    if (lowerShebang.includes("node") || lowerShebang.includes("deno") || lowerShebang.includes("bun")) {
      return "JavaScript";
    }
    if (lowerShebang.includes("ts-node") || lowerShebang.includes("tsx")) {
      return "TypeScript";
    }
    if (lowerShebang.includes("ruby")) return "Ruby";
    if (lowerShebang.includes("php")) return "PHP";
    if (lowerShebang.includes("lua")) return "Lua";
    if (lowerShebang.includes("pwsh") || lowerShebang.includes("powershell")) {
      return "PowerShell";
    }
    if (
      /\b(?:sh|bash|zsh|fish|dash|ksh)\b/.test(lowerShebang)
    ) {
      return "Shell";
    }
  }

  return null;
}

function getFileExtension(filePath: string): string {
  const baseName = filePath.split("/").pop() || "";
  const dotIdx = baseName.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === baseName.length - 1) return "";
  return baseName.slice(dotIdx + 1).toLowerCase();
}

function getContentString(
  fileContents: LanguageDetectionInput["fileContents"],
  filePath: string
): string | null {
  if (!fileContents) return null;
  if (fileContents instanceof Map) {
    const val = fileContents.get(filePath);
    if (!val) return null;
    return typeof val === "string" ? val : val.toString("utf-8");
  }
  const val = fileContents[filePath];
  return typeof val === "string" ? val : null;
}

/**
 * Selects the primary language from a map of language -> weight/bytes,
 * ensuring auxiliary scripting languages (like Shell build scripts) do not override
 * the repository's main programming language.
 */
export function selectPrimaryLanguageFromBreakdown(
  rawBreakdown: Record<string, number>
): { primaryLanguage: string | null; normalizedBreakdown: Record<string, number> } {
  const normalizedBreakdown: Record<string, number> = {};

  for (const [rawLang, rawValue] of Object.entries(rawBreakdown)) {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue <= 0) {
      continue;
    }
    const lowerRaw = rawLang.trim().toLowerCase();
    if (NON_PRIMARY_PROVIDER_LANGUAGES.has(lowerRaw)) {
      continue;
    }
    const canonical = normalizeLanguageName(rawLang);
    if (!canonical) continue;
    normalizedBreakdown[canonical] =
      (normalizedBreakdown[canonical] || 0) + rawValue;
  }

  const entries = Object.entries(normalizedBreakdown).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return { primaryLanguage: null, normalizedBreakdown: {} };
  }

  // Separate core programming languages from auxiliary scripting/markup languages
  const coreEntries = entries.filter(([lang]) =>
    CORE_PROGRAMMING_LANGUAGES.has(lang)
  );
  const topOverall = entries[0];

  if (coreEntries.length > 0) {
    const topCore = coreEntries[0];
    const totalCoreWeight = coreEntries.reduce((acc, [, val]) => acc + val, 0);
    const totalWeight = entries.reduce((acc, [, val]) => acc + val, 0);

    // If top overall is already a core programming language, return it directly
    if (CORE_PROGRAMMING_LANGUAGES.has(topOverall[0])) {
      return {
        primaryLanguage: topOverall[0],
        normalizedBreakdown,
      };
    }

    // If top overall is an auxiliary language (e.g. Shell or HTML), but there is a core
    // programming language (e.g. C++, C, Python, TypeScript, Rust, Go) with meaningful presence
    // (>= 15% of total weight or >= 20% of top auxiliary weight), prefer the core language.
    if (
      AUXILIARY_LANGUAGES.has(topOverall[0]) &&
      (totalCoreWeight >= totalWeight * 0.15 || topCore[1] >= topOverall[1] * 0.2)
    ) {
      return {
        primaryLanguage: topCore[0],
        normalizedBreakdown,
      };
    }
  }

  return {
    primaryLanguage: topOverall[0],
    normalizedBreakdown,
  };
}

/**
 * Analyzes the repository file tree (and optional file contents) to compute language composition.
 */
export function analyzeRepositoryTreeLanguages(
  treeEntries: TreeFileEntry[],
  fileContents?: LanguageDetectionInput["fileContents"],
  subdir?: string | null
): {
  primaryLanguage: string | null;
  languages: Record<string, number>;
  usedContentAnalysis: boolean;
} {
  if (!Array.isArray(treeEntries) || treeEntries.length === 0) {
    return { primaryLanguage: null, languages: {}, usedContentAnalysis: false };
  }

  const cleanSubdir = subdir ? subdir.replace(/^\/+|\/+$/g, "") : null;

  // Filter entries to target subdir if specified, falling back to full repo if subdir has no source files
  const scopedEntries = cleanSubdir
    ? treeEntries.filter(
        (e) =>
          e.path === cleanSubdir || e.path.startsWith(`${cleanSubdir}/`)
      )
    : treeEntries;

  const activeEntries =
    scopedEntries.length > 0 ? scopedEntries : treeEntries;

  const scores = new Map<string, number>();
  const fileCounts = new Map<string, number>();
  const ambiguousHeaderEntries: Array<{ path: string; weight: number }> = [];
  let usedContentAnalysis = false;

  for (const entry of activeEntries) {
    const rawPath = (entry.path || "").replace(/^\.\//, "");
    if (!rawPath) continue;

    if (IGNORED_DIRECTORY_REGEX.test(rawPath)) continue;
    if (IGNORED_FILE_PATTERN_REGEX.test(rawPath)) continue;

    const ext = getFileExtension(rawPath);

    // Base weight combines file count + bounded byte size contribution so a single massive file
    // cannot dwarf hundreds of source files, while file size still differentiates code volume.
    const byteSize =
      typeof entry.size === "number" && entry.size > 0 ? entry.size : 1024;
    const baseWeight = 1000 + Math.min(byteSize, 100_000) * 0.05;

    if (ext === "h") {
      const content = getContentString(fileContents, rawPath);
      if (content) {
        const detected = detectLanguageFromContent(rawPath, content);
        if (detected) {
          usedContentAnalysis = true;
          scores.set(detected, (scores.get(detected) || 0) + baseWeight);
          fileCounts.set(detected, (fileCounts.get(detected) || 0) + 1);
          continue;
        }
      }
      ambiguousHeaderEntries.push({ path: rawPath, weight: baseWeight });
      continue;
    }

    let lang = ext ? EXTENSION_TO_LANGUAGE[ext] : undefined;

    if (!lang && !ext) {
      const content = getContentString(fileContents, rawPath);
      if (content) {
        const detected = detectLanguageFromContent(rawPath, content);
        if (detected) {
          usedContentAnalysis = true;
          lang = detected;
        }
      }
    }

    if (!lang) continue;

    let effectiveWeight = baseWeight;

    // Reduce weight of auxiliary scripts (Shell / PowerShell) especially in CI/scripts/tools folders
    if (lang === "Shell" || lang === "PowerShell") {
      effectiveWeight *= AUXILIARY_SCRIPT_DIR_REGEX.test(rawPath) ? 0.15 : 0.35;
    } else if (
      (lang === "HTML" || lang === "CSS") &&
      /(?:^|\/)(?:docs?|examples?|samples?|coverage|reports?|site)(?:\/|$)/i.test(
        rawPath
      )
    ) {
      effectiveWeight *= 0.25;
    }

    scores.set(lang, (scores.get(lang) || 0) + effectiveWeight);
    fileCounts.set(lang, (fileCounts.get(lang) || 0) + 1);
  }

  // Disambiguate remaining `.h` files using repository C / C++ / Objective-C composition
  if (ambiguousHeaderEntries.length > 0) {
    const totalHeaderWeight = ambiguousHeaderEntries.reduce(
      (acc, item) => acc + item.weight,
      0
    );
    const totalHeaderCount = ambiguousHeaderEntries.length;

    const cppScore = scores.get("C++") || 0;
    const cScore = scores.get("C") || 0;
    const objcScore = scores.get("Objective-C") || 0;
    const familyTotal = cppScore + cScore + objcScore;

    if (familyTotal > 0) {
      if (cppScore > 0) {
        const share = cppScore / familyTotal;
        scores.set("C++", cppScore + totalHeaderWeight * share);
        fileCounts.set(
          "C++",
          (fileCounts.get("C++") || 0) + Math.round(totalHeaderCount * share)
        );
      }
      if (cScore > 0) {
        const share = cScore / familyTotal;
        scores.set("C", cScore + totalHeaderWeight * share);
        fileCounts.set(
          "C",
          (fileCounts.get("C") || 0) + Math.round(totalHeaderCount * share)
        );
      }
      if (objcScore > 0) {
        const share = objcScore / familyTotal;
        scores.set("Objective-C", objcScore + totalHeaderWeight * share);
        fileCounts.set(
          "Objective-C",
          (fileCounts.get("Objective-C") || 0) +
            Math.round(totalHeaderCount * share)
        );
      }
    } else {
      // Header-only repository without unambiguous .cpp/.c/.m files: default `.h` to C
      scores.set("C", (scores.get("C") || 0) + totalHeaderWeight);
      fileCounts.set("C", (fileCounts.get("C") || 0) + totalHeaderCount);
    }
  }

  const rawBreakdown: Record<string, number> = {};
  for (const [lang, score] of scores.entries()) {
    rawBreakdown[lang] = Math.round(score);
  }

  const { primaryLanguage, normalizedBreakdown } =
    selectPrimaryLanguageFromBreakdown(rawBreakdown);

  return {
    primaryLanguage,
    languages: normalizedBreakdown,
    usedContentAnalysis,
  };
}

/**
 * Master language resolution function enforcing strict priority order:
 * 1) GitHub Repository Languages API / provider language statistics (`providerLanguages`)
 *    combined with repository tree verification so auxiliary scripts (e.g. Shell) never mask main source code
 * 2) Provider repository metadata (`providerPrimaryLanguage`)
 * 3) Repository file tree extension & composition analysis (`treeEntries`)
 * 4) File content analysis (`fileContents`)
 * 5) Fallback to `"Unknown"` when no language can be determined with confidence.
 */
export function resolveRepositoryLanguage(
  input: LanguageDetectionInput
): LanguageDetectionResult {
  const treeResult =
    input.treeEntries && input.treeEntries.length > 0
      ? analyzeRepositoryTreeLanguages(
          input.treeEntries,
          input.fileContents,
          input.subdir
        )
      : null;

  // Priority 1: Provider Languages API breakdown (e.g. GitHub /repos/{owner}/{repo}/languages)
  if (
    input.providerLanguages &&
    Object.keys(input.providerLanguages).length > 0
  ) {
    const { primaryLanguage, normalizedBreakdown } =
      selectPrimaryLanguageFromBreakdown(input.providerLanguages);

    if (primaryLanguage) {
      // Safeguard: If provider languages API reported an auxiliary language (e.g. Shell from large generated configure script),
      // but local tree composition clearly shows a core programming language (e.g. C++ or C), prefer the core language.
      if (
        AUXILIARY_LANGUAGES.has(primaryLanguage) &&
        treeResult?.primaryLanguage &&
        CORE_PROGRAMMING_LANGUAGES.has(treeResult.primaryLanguage)
      ) {
        return {
          primaryLanguage: treeResult.primaryLanguage,
          languages:
            Object.keys(normalizedBreakdown).length > 0
              ? normalizedBreakdown
              : treeResult.languages,
          source: "tree-extension-analysis",
        };
      }

      return {
        primaryLanguage,
        languages: normalizedBreakdown,
        source: "provider-languages-api",
      };
    }
  }

  // Priority 2: Provider primary language metadata (e.g. GitHub / Bitbucket repo.language)
  const normalizedProviderLang = normalizeLanguageName(
    input.providerPrimaryLanguage
  );
  if (normalizedProviderLang) {
    // Safeguard: If provider metadata says "Shell" (or another auxiliary language) AND we have
    // a local repository tree where a core programming language (like C++, C, Rust, Go, Python, TS, JS)
    // is the actual dominant language, use the tree analysis result instead of the false "Shell".
    if (
      AUXILIARY_LANGUAGES.has(normalizedProviderLang) &&
      treeResult?.primaryLanguage &&
      CORE_PROGRAMMING_LANGUAGES.has(treeResult.primaryLanguage)
    ) {
      return {
        primaryLanguage: treeResult.primaryLanguage,
        languages: treeResult.languages,
        source: "tree-extension-analysis",
      };
    }

    return {
      primaryLanguage: normalizedProviderLang,
      languages:
        treeResult && Object.keys(treeResult.languages).length > 0
          ? treeResult.languages
          : { [normalizedProviderLang]: 1 },
      source: "provider-metadata",
    };
  }

  // Priority 3 & 4: Local repository tree extension & content analysis
  if (treeResult && treeResult.primaryLanguage) {
    return {
      primaryLanguage: treeResult.primaryLanguage,
      languages: treeResult.languages,
      source: treeResult.usedContentAnalysis
        ? "content-analysis"
        : "tree-extension-analysis",
    };
  }

  // Priority 4 standalone: If treeEntries was empty/unavailable, try content analysis on fileContents directly
  if (input.fileContents) {
    const entries: TreeFileEntry[] = [];
    if (input.fileContents instanceof Map) {
      for (const [p, buf] of input.fileContents.entries()) {
        entries.push({
          path: p,
          size: typeof buf === "string" ? buf.length : buf.byteLength,
        });
      }
    } else {
      for (const [p, str] of Object.entries(input.fileContents)) {
        entries.push({
          path: p,
          size: typeof str === "string" ? str.length : 1024,
        });
      }
    }
    if (entries.length > 0) {
      const contentOnlyResult = analyzeRepositoryTreeLanguages(
        entries,
        input.fileContents,
        input.subdir
      );
      if (contentOnlyResult.primaryLanguage) {
        return {
          primaryLanguage: contentOnlyResult.primaryLanguage,
          languages: contentOnlyResult.languages,
          source: "content-analysis",
        };
      }
    }
  }

  // Fallback: "Unknown" rather than guessing inaccurately
  return {
    primaryLanguage: "Unknown",
    languages: {},
    source: "unknown",
  };
}
