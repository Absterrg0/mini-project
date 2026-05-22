import path from "node:path";
import { builtinModules } from "node:module";
import { headers } from "next/headers";
import { after, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { COOKIE_NAME, type AISettings, buildAIModel } from "@/lib/ai-provider";
import { getCleanErrorMessage } from "@/lib/api-errors";
import { getRepositoryInstallationId, githubInstallationRequest } from "@/lib/github-app";
import { generateText } from "ai";
import { parseJsonWithRepair } from "@/lib/json-model-parse";
import { loadExecutionSnapshot } from "@/lib/execution-store";
import { prisma } from "@/lib/prisma";

export type TestScaffoldFlavor =
  | "flaky"
  | "failing"
  | "slow"
  | "e2e"
  | "unit";

type TestScaffoldJobStatus = "pending" | "running" | "completed" | "failed";

interface RequestBody {
  repositoryFullName?: string;
  flavor?: TestScaffoldFlavor;
}

interface GeneratedFile {
  path: string;
  content: string;
  summary: string;
}

interface ScaffoldResult {
  jobId: string;
  status: TestScaffoldJobStatus;
  error?: string | null;
  prUrl: string | null;
  branchName: string | null;
  files: GeneratedFile[];
  draftOnly: boolean;
}

interface GitHubTreeResponse {
  tree?: Array<{
    path?: string;
    type?: "blob" | "tree" | string;
    size?: number;
  }>;
}

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
  size?: number;
}

interface RepositoryContext {
  filePaths: string[];
  contextFiles: Array<{ path: string; content: string }>;
  existingFileSet: Set<string>;
  packageJson: PackageJson | null;
  packageSummary: string;
}

const MAX_CONTEXT_FILES = 20;
const MAX_CONTEXT_FILE_CHARS = 4_000;
const MAX_TOTAL_CONTEXT_CHARS = 36_000;

const FLAVOR_DESCRIPTIONS: Record<TestScaffoldFlavor, string> = {
  flaky: "intermittently failing tests (random failures, timing-dependent assertions, retry-based tests) that simulate real CI flakiness patterns",
  failing: "deterministically failing tests that catch real bugs by using intentionally wrong expected values against real existing code",
  slow: "slow tests with artificial delays, large data processing loops, and sequential I/O that artificially inflate CI duration",
  e2e: "end-to-end integration tests using Playwright or Cypress conventions only when the repository already appears to use a compatible web app structure",
  unit: "comprehensive unit tests with mocking, edge case coverage, boundary testing, and assertion-heavy specs for existing modules",
};

const CONFIG_FILE_PRIORITY = [
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "vitest.config.ts",
  "vitest.config.js",
  "jest.config.ts",
  "jest.config.js",
  "playwright.config.ts",
  "playwright.config.js",
  "cypress.config.ts",
  "cypress.config.js",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "vite.config.ts",
  "vite.config.js",
  "pyproject.toml",
  "pytest.ini",
  "requirements.txt",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
];

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|cs)$/i;
const TEST_FILE_RE = /(^|\/)(__tests__|tests?|spec|cypress|playwright)(\/|$)|\.(test|spec)\.[^.]+$/i;
const CONFIG_OR_METADATA_RE = /(^|\/)(package-lock\.json|package\.json|tsconfig\.json|next\.config\.[jt]s|vite\.config\.[jt]s|postcss\.config\.[cm]?[jt]s|eslint\.config\.[cm]?[jt]s|tailwind\.config\.[jt]s|README\.md)$/i;
const GENERATED_COMMENT_RE = /(mocked .*(utility|service|file)|for demonstration purposes|in a real project, this file would exist)/i;
const NODE_BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);
const JS_TEST_FRAMEWORK_RE = /(jest|vitest|playwright|cypress|mocha|uvu|tap|node --test|node --experimental-test)/i;
const PLACEHOLDER_TEST_SCRIPT_RE = /no test specified|exit 1|echo\s+['"]?skip|echo\s+['"]?todo/i;
const BRITTLE_SOURCE_ASSERTION_RE =
  /\.(?:includes|indexOf)\(\s*(["'`])[\s\S]*?(?:<[A-Za-z/][\s\S]*?>|className\s*=|\{children\}|<\/[A-Za-z]+>)[\s\S]*?\1\s*\)/;

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

function getAISettings(cookieHeader: string): AISettings | null {
  const match = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(decodeURIComponent(match[1]), "base64").toString("utf8")) as AISettings;
  } catch {
    return null;
  }
}

async function githubRepoFetch<T>(
  installationId: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null }> {
  return githubInstallationRequest<T>(installationId, path, init);
}

function normalizeRepoPath(filePath: string) {
  return path.posix.normalize(filePath).replace(/^\/+/, "");
}

function isSafeRepoPath(filePath: string) {
  const normalized = normalizeRepoPath(filePath);
  return Boolean(
    normalized &&
    normalized === filePath.replace(/^\/+/, "") &&
    !normalized.startsWith("../") &&
    !path.posix.isAbsolute(filePath) &&
    !normalized.includes("\0") &&
    !normalized.includes("//"),
  );
}

function isIgnoredContextPath(filePath: string) {
  return /(^|\/)(node_modules|\.next|dist|build|coverage|vendor|target|\.git)\//.test(filePath);
}

function isLikelySourceFile(filePath: string) {
  if (!SOURCE_FILE_RE.test(filePath) || TEST_FILE_RE.test(filePath) || isIgnoredContextPath(filePath)) {
    return false;
  }

  return /^(src|app|lib|components|pages|server|api|utils|services|hooks)\//.test(filePath) || !filePath.includes("/");
}

function sourcePriority(filePath: string) {
  if (/^app\/(page|layout)\.(tsx|jsx|ts|js)$/.test(filePath)) return -1;
  if (/^(src|app|lib|server|api)\//.test(filePath)) return 0;
  if (/^(components|pages|utils|services|hooks)\//.test(filePath)) return 1;
  if (!filePath.includes("/")) return 2;
  return 3;
}

function isActualSourceFile(filePath: string) {
  return isLikelySourceFile(filePath) && !CONFIG_OR_METADATA_RE.test(filePath);
}

function parsePackageJson(content: string): PackageJson | null {
  try {
    return JSON.parse(content) as PackageJson;
  } catch {
    return null;
  }
}

function packageDependencies(packageJson: PackageJson | null) {
  return {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };
}

function hasExecutableTestScript(packageJson: PackageJson | null) {
  const testScript = packageJson?.scripts?.test;
  return Boolean(testScript && !PLACEHOLDER_TEST_SCRIPT_RE.test(testScript));
}

function hasConfiguredJsTestFramework(packageJson: PackageJson | null) {
  const dependencies = packageDependencies(packageJson);
  return Boolean(
    Object.keys(dependencies).some((name) => JS_TEST_FRAMEWORK_RE.test(name)) ||
    JS_TEST_FRAMEWORK_RE.test(packageJson?.scripts?.test ?? ""),
  );
}

function parsePackageSummary(packageJson: PackageJson | null) {
  if (!packageJson) {
    return "";
  }

  try {
    const dependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };
    const interestingDeps = Object.keys(dependencies)
      .filter((name) => /(jest|vitest|playwright|cypress|testing-library|mocha|chai|next|react|vue|svelte|express|fastify)/i.test(name))
      .sort();
    return [
      packageJson.scripts ? `scripts=${JSON.stringify(packageJson.scripts)}` : "",
      interestingDeps.length ? `test/framework deps=${interestingDeps.join(", ")}` : "",
      hasExecutableTestScript(packageJson) ? "" : "test script is missing or placeholder; scaffold must make npm test execute real tests",
    ].filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

function buildPackageJsonTestSetupFile(context: RepositoryContext): GeneratedFile | null {
  if (!context.packageJson || hasExecutableTestScript(context.packageJson)) {
    return null;
  }

  const nextPackageJson: PackageJson = {
    ...context.packageJson,
    scripts: {
      ...(context.packageJson.scripts ?? {}),
      test: "node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=junit-results.xml",
    },
  };

  return {
    path: "package.json",
    content: `${JSON.stringify(nextPackageJson, null, 2)}\n`,
    summary: "Update npm test so CI executes the generated Node test files.",
  };
}

async function readRepositoryFile(params: {
  installationId: string;
  owner: string;
  repoName: string;
  ref: string;
  filePath: string;
}) {
  const encodedPath = params.filePath.split("/").map(encodeURIComponent).join("/");
  const response = await githubRepoFetch<GitHubContentResponse>(
    params.installationId,
    `/repos/${params.owner}/${params.repoName}/contents/${encodedPath}?ref=${encodeURIComponent(params.ref)}`,
  );

  if (!response.ok || !response.data?.content || response.data.encoding !== "base64") {
    return null;
  }

  const decoded = Buffer.from(response.data.content.replace(/\s/g, ""), "base64").toString("utf8");
  return decoded.slice(0, MAX_CONTEXT_FILE_CHARS);
}

async function loadRepositoryContext(params: {
  installationId: string;
  owner: string;
  repoName: string;
  defaultBranch: string;
}) {
  const treeResponse = await githubRepoFetch<GitHubTreeResponse>(
    params.installationId,
    `/repos/${params.owner}/${params.repoName}/git/trees/${encodeURIComponent(params.defaultBranch)}?recursive=1`,
  );

  if (!treeResponse.ok || !treeResponse.data?.tree) {
    throw new Error("Could not read repository file tree from GitHub.");
  }

  const filePaths = treeResponse.data.tree
    .filter((entry) => entry.type === "blob" && entry.path && !isIgnoredContextPath(entry.path))
    .map((entry) => normalizeRepoPath(entry.path as string))
    .filter((filePath) => isSafeRepoPath(filePath))
    .sort();

  const existingFileSet = new Set(filePaths);
  const configFiles = CONFIG_FILE_PRIORITY.filter((filePath) => existingFileSet.has(filePath));
  const sourceFiles = filePaths
    .filter(isLikelySourceFile)
    .sort((a, b) => sourcePriority(a) - sourcePriority(b) || a.length - b.length || a.localeCompare(b));
  const testFiles = filePaths
    .filter((filePath) => TEST_FILE_RE.test(filePath))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));

  const contextPaths = [...new Set([...configFiles, ...testFiles.slice(0, 8), ...sourceFiles])]
    .slice(0, MAX_CONTEXT_FILES);
  const contextFiles: Array<{ path: string; content: string }> = [];
  let totalChars = 0;

  for (const filePath of contextPaths) {
    if (totalChars >= MAX_TOTAL_CONTEXT_CHARS) break;
    const content = await readRepositoryFile({ ...params, ref: params.defaultBranch, filePath });
    if (!content) continue;
    contextFiles.push({ path: filePath, content });
    totalChars += content.length;
  }

  const packageJsonContent = contextFiles.find((file) => file.path === "package.json")?.content;
  const packageJson = packageJsonContent ? parsePackageJson(packageJsonContent) : null;

  return {
    filePaths,
    contextFiles,
    existingFileSet,
    packageJson,
    packageSummary: parsePackageSummary(packageJson),
  } satisfies RepositoryContext;
}

function formatRepositoryContext(context: RepositoryContext) {
  const treeExcerpt = context.filePaths.slice(0, 240).map((filePath) => `- ${filePath}`).join("\n");
  const existingTestFiles = context.filePaths
    .filter((filePath) => TEST_FILE_RE.test(filePath))
    .slice(0, 80)
    .map((filePath) => `- ${filePath}`)
    .join("\n");
  const fileExcerpts = context.contextFiles
    .map((file) => `--- ${file.path}\n${file.content}`)
    .join("\n\n");

  return [
    context.packageSummary ? `Detected package/test setup:\n${context.packageSummary}` : "",
    `Repository file tree excerpt:\n${treeExcerpt}`,
    existingTestFiles ? `Existing test files to extend or avoid duplicating:\n${existingTestFiles}` : "",
    `Selected existing file excerpts:\n${fileExcerpts}`,
  ].filter(Boolean).join("\n\n");
}

function cleanModelJson(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function parseGeneratedFiles(text: string) {
  const parsed = parseJsonWithRepair(cleanModelJson(text)) as { files?: unknown };
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error("No files returned from AI.");
  }

  return (parsed.files as unknown[]).map((raw) => {
    const file = raw as Partial<GeneratedFile>;
    return {
      path: normalizeRepoPath(String(file.path ?? "")),
      content: String(file.content ?? ""),
      summary: String(file.summary ?? ""),
    };
  });
}

function candidateImportPaths(importPath: string) {
  const normalized = normalizeRepoPath(importPath);
  const ext = path.posix.extname(normalized);
  if (ext) return [normalized];

  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
  return [
    ...extensions.map((candidateExt) => `${normalized}${candidateExt}`),
    ...extensions.map((candidateExt) => `${normalized}/index${candidateExt}`),
  ];
}

function relativeImports(content: string) {
  const imports: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const importMatch =
      trimmed.match(/^import(?:\s+type)?(?:[\s\w*{},]+from\s*)?["']([^"']+)["']/) ??
      trimmed.match(/^export(?:\s+type)?\s+.*\s+from\s*["']([^"']+)["']/);
    const requireMatch = trimmed.match(/require\(\s*["']([^"']+)["']\s*\)/);
    const specifier = importMatch?.[1] ?? requireMatch?.[1];
    if (specifier?.startsWith(".")) imports.push(specifier);
  }

  return imports;
}

function importSpecifiers(content: string) {
  const imports: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const importMatch =
      trimmed.match(/^import(?:\s+type)?(?:[\s\w*{},]+from\s*)?["']([^"']+)["']/) ??
      trimmed.match(/^export(?:\s+type)?\s+.*\s+from\s*["']([^"']+)["']/);
    const requireMatch = trimmed.match(/require\(\s*["']([^"']+)["']\s*\)/);
    const specifier = importMatch?.[1] ?? requireMatch?.[1];
    if (specifier) imports.push(specifier);
  }

  return imports;
}

function packageNameFromSpecifier(specifier: string) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }

  return specifier.split("/")[0];
}

function usesJestOrVitestGlobals(content: string) {
  return /\b(describe|it|test|expect|jest|vi)\s*\(/.test(content) || /\bafterEach\s*\(|\bbeforeEach\s*\(/.test(content);
}

function sourceFilesReferencedByTest(content: string, context: RepositoryContext) {
  return context.filePaths.filter((filePath) => {
    if (!isActualSourceFile(filePath)) return false;
    const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`['"\`]${escapedPath}['"\`]`).test(content) || content.includes(filePath);
  });
}

function hasPackageOrConfigPrimaryAssertions(content: string) {
  return /package\.json|package-lock\.json|tsconfig\.json|compilerOptions|dependencies|devDependencies|scripts\??\.test|pkg\.scripts|pkg\.name/.test(content);
}

function hasBrittleSourceAssertions(content: string) {
  return BRITTLE_SOURCE_ASSERTION_RE.test(content);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexLiteralFromText(value: string) {
  return `/${escapeRegExp(value).replace(/\//g, "\\/")}/`;
}

function validateGeneratedFiles(files: GeneratedFile[], context: RepositoryContext) {
  const errors: string[] = [];
  const generatedPathSet = new Set(files.map((file) => file.path));
  const availableFiles = new Set([...context.existingFileSet, ...generatedPathSet]);
  const dependencies = packageDependencies(context.packageJson);
  const hasJsTestFramework = hasConfiguredJsTestFramework(context.packageJson);
  const mustUseNodeTest = Boolean(context.packageJson && !hasJsTestFramework);

  for (const file of files) {
    if (!isSafeRepoPath(file.path)) {
      errors.push(`${file.path || "(missing path)"} is not a safe repository-relative path.`);
      continue;
    }

    if (!TEST_FILE_RE.test(file.path)) {
      errors.push(`${file.path} does not look like a test file path.`);
    }

    if (!file.content.trim()) {
      errors.push(`${file.path} has empty content.`);
    }

    if (GENERATED_COMMENT_RE.test(file.content)) {
      errors.push(`${file.path} includes mocked-source/demo comments instead of real repo-aware tests.`);
    }

    if (hasBrittleSourceAssertions(file.content)) {
      errors.push(`${file.path} uses brittle exact JSX/source substring assertions. Use assert.match with regexes that tolerate whitespace, JSX attributes, and className order instead of fileContent.includes("<...>").`);
    }

    if (mustUseNodeTest && TEST_FILE_RE.test(file.path)) {
      const imports = importSpecifiers(file.content);
      const unavailableImports = imports.filter((specifier) => {
        if (specifier.startsWith(".")) return false;
        if (NODE_BUILTIN_MODULES.has(specifier)) return false;
        return !dependencies[packageNameFromSpecifier(specifier)];
      });

      if (unavailableImports.length > 0) {
        errors.push(`${file.path} imports unavailable test dependencies (${unavailableImports.join(", ")}). Use dependency-free node:test/assert tests because this repo has no test runner configured.`);
      }

      if (usesJestOrVitestGlobals(file.content) && !file.content.includes("node:test")) {
        errors.push(`${file.path} uses Jest/Vitest globals, but this repo has no Jest/Vitest dependency. Use node:test and node:assert instead.`);
      }

      if (!/node:test/.test(file.content)) {
        errors.push(`${file.path} must use node:test because package.json has no executable test framework.`);
      }

      if (hasPackageOrConfigPrimaryAssertions(file.content)) {
        errors.push(`${file.path} tests package/config metadata. Scaffold tests must target real app/source code files.`);
      }

      if (sourceFilesReferencedByTest(file.content, context).length === 0) {
        errors.push(`${file.path} does not reference any real source file. Node test scaffolds must read/assert app or source code files.`);
      }
    }

    for (const specifier of relativeImports(file.content)) {
      const resolvedBase = normalizeRepoPath(path.posix.join(path.posix.dirname(file.path), specifier));
      const exists = candidateImportPaths(resolvedBase).some((candidate) => availableFiles.has(candidate));

      if (!exists) {
        errors.push(`${file.path} imports ${specifier}, but no matching file exists in the repository tree.`);
      }
    }
  }

  return errors;
}

function buildNodeTestFallbackFile(context: RepositoryContext, flavor: TestScaffoldFlavor): GeneratedFile {
  const target = context.contextFiles.find((file) => isActualSourceFile(file.path)) ??
    context.filePaths.find((filePath) => isActualSourceFile(filePath));
  const targetPath = typeof target === "string" ? target : target?.path ?? "app/page.tsx";
  const targetContent = typeof target === "string" ? "" : target?.content ?? "";
  const firstTextMatch = targetContent.match(/>\s*([A-Za-z][^<>{}\n]{8,80})\s*</);
  const actualText = firstTextMatch?.[1]?.trim() ?? "Get started";
  const actualTextPattern = regexLiteralFromText(actualText);
  const wrongTextPattern = regexLiteralFromText(`${actualText} - incorrect ExecForge expectation`);
  const escapedTargetPath = JSON.stringify(targetPath);
  const sourceInvariant =
    targetPath.endsWith("layout.tsx") || targetPath.endsWith("layout.jsx")
      ? `  assert.match(source, /export\\s+default\\s+function\\s+RootLayout|function\\s+RootLayout/);
  assert.match(source, /<html\\b[^>]*>/s);
  assert.match(source, /<body\\b[^>]*>[\\s\\S]*\\{children\\}[\\s\\S]*<\\/body>/s);`
      : `  assert.match(source, /export\\s+default|function\\s+[A-Z][A-Za-z0-9_]*/);
  assert.match(source, ${actualTextPattern});`;
  const assertionsByFlavor: Record<TestScaffoldFlavor, string> = {
    failing: `test('source file keeps the expected user-visible contract', () => {
  const source = readSourceFile();
${sourceInvariant}
  assert.match(source, ${wrongTextPattern});
});`,
    flaky: `test('source file passes a timing-sensitive contract check', () => {
  const source = readSourceFile();
${sourceInvariant}
  assert.equal(Date.now() % 2, 0, 'intentional intermittent failure for ExecForge flake detection');
});`,
    slow: `test('source file survives a deliberately slow content validation path', async () => {
  const source = readSourceFile();
  await new Promise((resolve) => setTimeout(resolve, 3500));
${sourceInvariant}
});`,
    e2e: `test('app entry source contains renderable page content', () => {
  const source = readSourceFile();
${sourceInvariant}
});`,
    unit: `test('source file keeps expected user-facing content', () => {
  const source = readSourceFile();
${sourceInvariant}
});`,
  };

  return {
    path: `test/execforge-${flavor}.test.js`,
    content: `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readSourceFile() {
  return fs.readFileSync(path.join(process.cwd(), ${escapedTargetPath}), 'utf8');
}

${assertionsByFlavor[flavor]}
`,
    summary: `Dependency-free ${flavor} scaffold against ${targetPath}, executed by node --test.`,
  };
}

async function generateRepoAwareFiles(params: {
  aiSettings: AISettings;
  repositoryFullName: string;
  language: string;
  flavor: TestScaffoldFlavor;
  context: RepositoryContext;
}) {
  const model = buildAIModel(params.aiSettings);
  const repositoryContext = formatRepositoryContext(params.context);
  const validationFeedback: string[] = [];
  const mustUseNodeTest = Boolean(params.context.packageJson && !hasConfiguredJsTestFramework(params.context.packageJson));
  const actualSourcePaths = params.context.filePaths.filter(isActualSourceFile).slice(0, 40);
  const testSetupInstruction = mustUseNodeTest
    ? `This JavaScript/TypeScript repository does NOT have Jest, Vitest, Playwright, Cypress, or Testing Library configured. Generate dependency-free tests only:
- Use CommonJS .test.js files under test/ or tests/.
- Use only Node built-ins: require("node:test"), require("node:assert/strict"), require("node:fs"), require("node:path"), etc.
- Do not import TS/TSX/JSX app files, React, Next.js, @testing-library/react, Jest globals, Vitest globals, jsdom, or browser APIs.
- Test real app/source files by reading source text from disk and asserting real UI copy, exports, route structure, component names, helper behavior visible in source, etc.
- Source-text tests must be resilient. Never use exact JSX/HTML substrings such as fileContent.includes("<body>{children}</body>") or exact className strings. Use regexes that tolerate whitespace, JSX attributes, line breaks, and class token order.
- Do not write tests whose primary assertions are about package.json, package-lock.json, tsconfig.json, dependencies, scripts, or compilerOptions.
- Prefer these real source targets when relevant: ${actualSourcePaths.join(", ") || "source files listed in the repository context"}.
- ExecForge will update package.json to run "node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=junit-results.xml"; write tests that this command will execute with npm test.
- The dual reporters write human-readable output to stdout AND JUnit XML to junit-results.xml. The ExecForge SDK automatically discovers junit-results.xml and uploads test results — no additional user configuration is needed.`
    : `Use the test runner already configured in package.json or config files. If npm test would not execute your files, include that setup requirement in the generated files only when it does not require adding new locked dependencies.`;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { text } = await generateText({
      model,
      temperature: 0.2,
      system: `You are ExecForge Test Scaffold. You generate realistic test files using ONLY the repository context supplied by the user.
CRITICAL RULES:
- Do not invent modules, services, utilities, components, files, functions, or import paths.
- Every relative import you write must resolve to an existing file listed in the repository tree or to another generated file.
- Never include commented-out "mocked" source files, demonstration source files, or prose explaining missing files.
- Prefer testing existing modules/components/routes visible in the selected file excerpts.
- The test behavior may be intentionally flaky, failing, or slow when requested, but imports and file paths must be real and syntactically plausible.
- Ensure the generated tests will actually run under the repository's npm test / test command setup.
- If existing tests are present in the repository context, extend their style and coverage. Do not duplicate the same assertions, filenames, or test names unless intentionally updating that file.
- Never make formatting a product contract. Avoid exact string checks for JSX tags, children placement, className values, import ordering, or whitespace.
- Return ONLY valid JSON, no markdown fences, no prose outside JSON.`,
      prompt: `Generate 2-3 test files for "${params.repositoryFullName}" (primary language: ${params.language}).
The tests should be: ${FLAVOR_DESCRIPTIONS[params.flavor]}.

Repository context:
${repositoryContext}

Requirements:
- Choose the testing framework that is already indicated by package/config files when present.
- ${testSetupInstruction}
- Place tests in paths that match this repository's structure.
- Use real existing files/functions/components from the repository context; do not create imports like mathUtils or userService unless those paths exist in the tree above.
- Inspect the existing test file excerpts first. Prefer adding complementary coverage or updating an existing generated test file when that is the least duplicative option.
- Do not assert exact JSX formatting. For source-reading tests, use assert.match(source, /<body\\b[^>]*>[\\s\\S]*\\{children\\}[\\s\\S]*<\\/body>/s) style checks rather than source.includes("<body>{children}</body>").
- For failing tests, make the assertion intentionally wrong against real existing behavior; the import must still resolve.
- For flaky tests, use timing/randomness around real existing code.
- For slow tests, keep the delay or workload obvious in the test itself.
- For e2e tests, only use Playwright/Cypress if package/config context suggests it; otherwise generate integration-style tests against existing routes/components.
${validationFeedback.length ? `\nPrevious attempt was rejected:\n- ${validationFeedback.join("\n- ")}\nFix those exact issues.` : ""}

Return JSON:
{
  "files": [
    {
      "path": "path/to/existing-style.test.ext",
      "content": "full file content as a string",
      "summary": "one-line description of what this file tests"
    }
  ]
}`,
    });

    const files = parseGeneratedFiles(text);
    const errors = validateGeneratedFiles(files, params.context);
    if (errors.length === 0) {
      return files;
    }

    validationFeedback.splice(0, validationFeedback.length, ...errors.slice(0, 8));
  }

  if (mustUseNodeTest) {
    return [buildNodeTestFallbackFile(params.context, params.flavor)];
  }

  throw new Error(`AI generated scaffold files with unresolved repository imports: ${validationFeedback.join(" ")}`);
}

async function createGitHubPullRequest(params: {
  installationId: string;
  repositoryFullName: string;
  defaultBranch: string;
  flavor: TestScaffoldFlavor;
  files: GeneratedFile[];
}) {
  const [owner, repoName] = params.repositoryFullName.split("/");

  const baseBranchRef = await githubRepoFetch<{ object?: { sha?: string } }>(
    params.installationId,
    `/repos/${owner}/${repoName}/git/ref/heads/${params.defaultBranch}`,
  );

  if (!baseBranchRef.ok || !baseBranchRef.data?.object?.sha) {
    throw new Error("Could not read the base branch from GitHub.");
  }

  const branchSuffix = Date.now().toString(36);
  const branchName = `exec-intel/scaffold-${params.flavor}-tests-${branchSuffix}`;

  const createRef = await githubRepoFetch(
    params.installationId,
    `/repos/${owner}/${repoName}/git/refs`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseBranchRef.data.object.sha,
      }),
    },
  );

  if (!createRef.ok && createRef.status !== 422) {
    throw new Error("Failed to create branch on GitHub.");
  }

  for (const file of params.files) {
    const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");

    const existing = await githubRepoFetch<{ sha?: string }>(
      params.installationId,
      `/repos/${owner}/${repoName}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`,
    );

    const commitBody: Record<string, unknown> = {
      message: `[exec-intel] Add scaffold ${params.flavor} test: ${file.path}`,
      content: Buffer.from(file.content, "utf8").toString("base64"),
      branch: branchName,
    };
    if (existing.ok && existing.data?.sha) {
      commitBody.sha = existing.data.sha;
    }

    const update = await githubRepoFetch<{ message?: string }>(
      params.installationId,
      `/repos/${owner}/${repoName}/contents/${encodedPath}`,
      { method: "PUT", body: JSON.stringify(commitBody) },
    );

    if (!update.ok) {
      throw new Error(`Failed to commit ${file.path}: ${update.data?.message ?? "GitHub rejected the file."}`);
    }
  }

  const flavorLabel =
    params.flavor === "flaky" ? "Flaky"
    : params.flavor === "failing" ? "Failing"
    : params.flavor === "slow" ? "Slow"
    : params.flavor === "e2e" ? "E2E"
    : "Unit";

  const pull = await githubRepoFetch<{ html_url?: string; number?: number }>(
    params.installationId,
    `/repos/${owner}/${repoName}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: `[exec-intel] ${flavorLabel} test scaffold for CI intelligence demo`,
        body: [
          "## ExecForge Test Scaffold",
          "",
          `This PR was generated by **ExecForge CI Intelligence** to demonstrate the **${flavorLabel}** test detection capabilities.`,
          "",
          "### Files added",
          ...params.files.map((file) => `- \`${file.path}\` - ${file.summary}`),
          "",
          "### Repository guardrails",
          "- Generated from the repository file tree and selected source/config files.",
          "- Relative imports were validated against the repository tree before commit.",
          "- Human review is still required before merge.",
          "",
          "### What happens next",
          "1. Merge this PR to your main branch",
          "2. Push a new commit to trigger CI",
          "3. ExecForge will detect and surface the test patterns in the Tests dashboard",
        ].join("\n"),
        head: branchName,
        base: params.defaultBranch,
        draft: false,
      }),
    },
  );

  if (!pull.ok || !pull.data?.html_url) {
    throw new Error("Branch and files were created, but GitHub did not open the pull request.");
  }

  return {
    branchName,
    prUrl: pull.data.html_url,
  };
}

async function runScaffoldJob(params: {
  jobId: string;
  aiSettings: AISettings;
  repositoryFullName: string;
  flavor: TestScaffoldFlavor;
  installationId: string;
  repo: {
    language: string;
    defaultBranch: string;
  };
}) {
  await prisma.testScaffoldJob.update({
    where: { id: params.jobId },
    data: { status: "running" },
  });

  try {
    const [owner, repoName] = params.repositoryFullName.split("/");
    const context = await loadRepositoryContext({
      installationId: params.installationId,
      owner,
      repoName,
      defaultBranch: params.repo.defaultBranch,
    });

    const generatedFiles = await generateRepoAwareFiles({
      aiSettings: params.aiSettings,
      repositoryFullName: params.repositoryFullName,
      language: params.repo.language,
      flavor: params.flavor,
      context,
    });
    const setupFile = buildPackageJsonTestSetupFile(context);
    const files = setupFile ? [setupFile, ...generatedFiles] : generatedFiles;

    const pullRequest = await createGitHubPullRequest({
      installationId: params.installationId,
      repositoryFullName: params.repositoryFullName,
      defaultBranch: params.repo.defaultBranch,
      flavor: params.flavor,
      files,
    });

    await prisma.testScaffoldJob.update({
      where: { id: params.jobId },
      data: {
        status: "completed",
        files: files as unknown as Prisma.InputJsonValue,
        branchName: pullRequest.branchName,
        prUrl: pullRequest.prUrl,
        draftOnly: false,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    const msg = getCleanErrorMessage(error, "Failed to generate test scaffold.");
    console.error("[test-scaffold-pr] background job failed:", error);
    await prisma.testScaffoldJob.update({
      where: { id: params.jobId },
      data: {
        status: "failed",
        error: msg,
        completedAt: new Date(),
      },
    });
  }
}

function serializeJob(job: {
  id: string;
  status: string;
  error: string | null;
  prUrl: string | null;
  branchName: string | null;
  files: unknown;
  draftOnly: boolean;
}): ScaffoldResult {
  const files = Array.isArray(job.files) ? job.files as GeneratedFile[] : [];

  return {
    jobId: job.id,
    status: job.status as TestScaffoldJobStatus,
    error: job.error,
    prUrl: job.prUrl,
    branchName: job.branchName,
    files,
    draftOnly: job.draftOnly,
  };
}

export async function GET(request: Request) {
  const headerStore = await headers();
  const session = await auth.api.getSession({ headers: headerStore });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const job = await prisma.testScaffoldJob.findFirst({
    where: { id: jobId, userId: session.user.id },
  });

  if (!job) {
    return NextResponse.json({ error: "Scaffold job not found." }, { status: 404 });
  }

  return NextResponse.json(serializeJob(job));
}

export async function POST(request: Request) {
  const headerStore = await headers();
  const sessionPromise = auth.api.getSession({ headers: headerStore });
  const bodyPromise = request.json() as Promise<RequestBody>;

  const [session, body] = await Promise.all([sessionPromise, bodyPromise]);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieHeader = headerStore.get("cookie") ?? "";
  const aiSettings = getAISettings(cookieHeader);
  if (!aiSettings) {
    return NextResponse.json(
      { error: "No AI model configured. Go to Settings -> AI Model to set your API key." },
      { status: 400 },
    );
  }

  const { repositoryFullName, flavor = "flaky" } = body;

  if (!repositoryFullName) {
    return NextResponse.json({ error: "repositoryFullName is required." }, { status: 400 });
  }

  if (!FLAVOR_DESCRIPTIONS[flavor]) {
    return NextResponse.json({ error: "Invalid test flavor." }, { status: 400 });
  }

  const snapshotPromise = loadExecutionSnapshot();
  const installationPromise = getRepositoryInstallationId(repositoryFullName);
  const [{ organizations }, installationId] = await Promise.all([snapshotPromise, installationPromise]);
  const repo = organizations.flatMap((org) => org.repositories).find((candidate) => candidate.fullName === repositoryFullName);

  if (!repo) {
    return NextResponse.json({ error: "Repository not found." }, { status: 400 });
  }

  if (!installationId) {
    return NextResponse.json(
      { error: "GitHub App installation is required so ExecForge can read repository context before generating tests." },
      { status: 400 },
    );
  }

  const job = await prisma.testScaffoldJob.create({
    data: {
      userId: session.user.id,
      repositoryFullName,
      flavor,
      status: "pending",
    },
  });

  after(async () => {
    await runScaffoldJob({
      jobId: job.id,
      aiSettings,
      repositoryFullName,
      flavor,
      installationId,
      repo: {
        language: repo.language,
        defaultBranch: repo.defaultBranch,
      },
    });
  });

  return NextResponse.json(serializeJob(job), { status: 202 });
}
