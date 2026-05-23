"use client";

import { useState } from "react";
import Link from "next/link";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { CodeSnippet } from "@/components/settings/settings-client";
import { BookOpen, Layers, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExampleCardHeader } from "@/components/dashboard/example-card-header";


const BASIC_WORKFLOW = `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build & test
        env:
          CI: true
        run: npm run build && npm test

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}
          # Discovers junit-results.xml from jest-junit for AI failure analysis`;

const E2E_WORKFLOW = `name: E2E Tests

on:
  push:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        env:
          CI: true
        run: npx playwright test

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}
          EXECFORGE_JUNIT_PATH: test-results/junit.xml`;

const MATRIX_WORKFLOW = `name: Sharded E2E

on:
  push:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install
        run: npm ci && npx playwright install --with-deps chromium

      - name: Run shard \${{ matrix.shard }}/4
        env:
          CI: true
        run: npx playwright test --shard=\${{ matrix.shard }}/4

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}
          EXECFORGE_JUNIT_PATH: test-results/junit.xml`;

const DOCKER_WORKFLOW = `name: Docker Build

on:
  push:
    branches: [main]

jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build image
        run: |
          docker buildx build --cache-from=type=gha --cache-to=type=gha,mode=max -t myapp:latest .

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}`;

const PROPER_TESTS_WORKFLOW = `name: Proper Tests

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run solid tests
        env:
          CI: true
        run: npm run test:unit

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}
          # Discovers junit-results.xml from jest-junit for AI failure analysis`;

const FLAKY_TESTS_WORKFLOW = `name: Flaky Tests

on:
  push:
    branches: [main]

jobs:
  flaky_test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run flaky tests
        env:
          CI: true
        run: npm run test:flaky

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}
          # Discovers junit-results.xml from jest-junit for AI failure analysis`;

const FAILED_TESTS_WORKFLOW = `name: Failed Tests

on:
  push:
    branches: [main]

jobs:
  fail_test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run failing tests
        env:
          CI: true
        run: npm run test:fail

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}
          # Discovers junit-results.xml — failure messages power AI root-cause analysis`;

const LINT_WORKFLOW = `name: Linting

on:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}`;

const SECURITY_SCAN_WORKFLOW = `name: Security Scan

on:
  push:
    branches: [main]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Audit dependencies
        run: npm audit

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}`;

const MOBILE_TESTS_WORKFLOW = `name: Mobile Tests

on:
  push:
    branches: [main]

jobs:
  mobile_test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run React Native tests
        env:
          CI: true
        run: npm run test:mobile

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}
          # Discovers junit-results.xml from jest-junit for AI failure analysis`;

const FLAKY_JEST = `// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  // Retry flaky tests automatically — ExecForge tracks retry counts
  testRetries: 2,

  // Randomise order to surface order-dependent failures
  randomize: true,

  // Human-readable CI logs + JUnit for ExecForge finish (failure messages → AI analysis)
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: '.',
        outputName: 'junit-results.xml',
        includeShortConsoleOutput: true,
        classNameTemplate: '{filepath}',
      },
    ],
  ],
};

export default config;`;

const FLAKY_PLAYWRIGHT = `// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Retry flaky specs — ExecForge counts retries per test
  retries: process.env.CI ? 2 : 0,

  // Run files in parallel for faster wall-clock time
  fullyParallel: true,

  // list + github for readable Actions logs; junit for ExecForge / AI failure analysis
  reporter: process.env.CI
    ? [
        ['list'],
        ['junit', { outputFile: 'test-results/junit.xml' }],
        ['github'],
      ]
    : 'list',

  use: {
    baseURL: 'http://localhost:3000',
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
});`;

const PACKAGE_JSON_EXAMPLE = `{
  "name": "your-app",
  "private": true,
  "scripts": {
    "test": "jest --ci",
    "test:unit": "jest --ci --testPathPatterns=unit",
    "test:flaky": "jest --ci --testPathPatterns=flaky",
    "test:fail": "jest --ci --testPathPatterns=fail",
    "test:mobile": "jest --ci --selectProjects native",
    "build": "tsc -b",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/jest": "^29.5.0",
    "eslint": "^9.0.0",
    "jest": "^29.7.0",
    "jest-junit": "^16.0.0",
    "typescript": "^5.6.0"
  }
}`;

const FLAKY_VITEST = `// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Retries surface flake signals ExecForge can aggregate from telemetry
    retry: process.env.CI ? 2 : 0,
    reporters: process.env.CI
      ? ['default', ['junit', { outputFile: 'junit-results.xml' }]]
      : ['default'],
  },
});`;

type MainTab = "workflows" | "configs";

const WORKFLOW_EXAMPLES = [
  {
    id: "basic-ci",
    title: "Basic CI",
    description: "Build & test with JUnit export (jest-junit → junit-results.xml). Finish ingests failure messages for AI analysis.",
    filename: ".github/workflows/ci.yml",
    code: BASIC_WORKFLOW,
    tags: ["npm", "jest", "beginner"],
    primaryCommand: "npm run build && npm test",
  },
  {
    id: "playwright-e2e",
    title: "Playwright E2E",
    description: "Playwright with list/github/junit reporters. Set EXECFORGE_JUNIT_PATH on finish for per-spec failure messages.",
    filename: ".github/workflows/e2e.yml",
    code: E2E_WORKFLOW,
    tags: ["playwright", "e2e"],
    primaryCommand: "npx playwright test",
  },
  {
    id: "sharded-e2e",
    title: "Sharded E2E (4 workers)",
    description: "Parallelise Playwright across 4 matrix shards to cut wall-clock time by up to 75%.",
    filename: ".github/workflows/e2e-sharded.yml",
    code: MATRIX_WORKFLOW,
    tags: ["playwright", "matrix", "advanced"],
    primaryCommand: "npx playwright test --shard=${{ matrix.shard }}/4",
  },
  {
    id: "docker-build",
    title: "Docker Build",
    description: "Measure Docker build time and layer cache efficiency with GitHub Actions cache.",
    filename: ".github/workflows/docker.yml",
    code: DOCKER_WORKFLOW,
    tags: ["docker"],
    primaryCommand: "docker buildx build … (see workflow)",
  },
  {
    id: "proper-tests",
    title: "Proper Tests",
    description: "A standard test workflow that executes properly with 100% success rate. Ideal for benchmarking.",
    filename: ".github/workflows/proper-tests.yml",
    code: PROPER_TESTS_WORKFLOW,
    tags: ["jest", "stable"],
    primaryCommand: "npm run test:unit",
  },
  {
    id: "flaky-tests",
    title: "Flaky Tests",
    description: "A workflow with tests that sporadically fail and retry, useful to see how ExecForge identifies flaky specs.",
    filename: ".github/workflows/flaky-tests.yml",
    code: FLAKY_TESTS_WORKFLOW,
    tags: ["flaky", "jest"],
    primaryCommand: "npm run test:flaky",
  },
  {
    id: "failed-tests",
    title: "Failed Tests",
    description: "A workflow demonstrating failures. See how ExecForge captures error outputs and tracebacks.",
    filename: ".github/workflows/failed-tests.yml",
    code: FAILED_TESTS_WORKFLOW,
    tags: ["failed", "jest"],
    primaryCommand: "npm run test:fail",
  },
  {
    id: "lint-checks",
    title: "Lint Checks",
    description: "A workflow that only runs linting, demonstrating static analysis tracking.",
    filename: ".github/workflows/lint.yml",
    code: LINT_WORKFLOW,
    tags: ["lint", "fast"],
    primaryCommand: "npm run lint",
  },
  {
    id: "security-scan",
    title: "Security Scan",
    description: "A workflow for running security audits and scans.",
    filename: ".github/workflows/security.yml",
    code: SECURITY_SCAN_WORKFLOW,
    tags: ["security"],
    primaryCommand: "npm audit",
  },
  {
    id: "mobile-tests",
    title: "Mobile Tests",
    description: "Running tests on a macOS runner for mobile platforms like React Native.",
    filename: ".github/workflows/mobile.yml",
    code: MOBILE_TESTS_WORKFLOW,
    tags: ["mobile", "macos"],
    primaryCommand: "npm run test:mobile",
  },
];

const CONFIG_EXAMPLES = [
  {
    id: "package-json",
    title: "package.json (scripts)",
    description:
      "Use jest --ci and jest-junit so finish writes junit-results.xml with failure messages. Every npm run in the workflow must resolve here.",
    filename: "package.json",
    code: PACKAGE_JSON_EXAMPLE,
    tags: ["npm", "beginner"],
  },
  {
    id: "jest-flaky",
    title: "Jest — flaky test detection",
    description:
      "Enable retries and randomised order so flaky patterns show up in telemetry. On CI, jest --runInBand runs serially and can reduce worker-related noise; pair with testRetries so retries are visible to ExecForge.",
    filename: "jest.config.ts",
    code: FLAKY_JEST,
    tags: ["jest", "flaky"],
  },
  {
    id: "playwright-flaky",
    title: "Playwright — flaky test detection",
    description: "Enable retries, parallel execution, and trace capture on first retry.",
    filename: "playwright.config.ts",
    code: FLAKY_PLAYWRIGHT,
    tags: ["playwright", "flaky"],
  },
  {
    id: "vitest-retries",
    title: "Vitest — retries",
    description:
      "If you use Vitest, set test.retry so flaky runs emit retry counts ExecForge can aggregate (same idea as Jest testRetries).",
    filename: "vitest.config.ts",
    code: FLAKY_VITEST,
    tags: ["vitest", "flaky"],
  },
];

const TAG_COLORS: Record<string, string> = {
  beginner: "border-[#4ade80]/25 bg-[#4ade80]/10 text-[#4ade80]",
  advanced: "border-[#818cf8]/25 bg-[#818cf8]/10 text-[#818cf8]",
  flaky: "border-[#facc15]/25 bg-[#facc15]/10 text-[#facc15]",
  matrix: "border-[#818cf8]/25 bg-[#818cf8]/10 text-[#818cf8]",
  stable: "border-[#4ade80]/25 bg-[#4ade80]/10 text-[#4ade80]",
  failed: "border-[#f87171]/25 bg-[#f87171]/10 text-[#f87171]",
  lint: "border-[#2dd4bf]/25 bg-[#2dd4bf]/10 text-[#2dd4bf]",
  fast: "border-[#34d399]/25 bg-[#34d399]/10 text-[#34d399]",
  security: "border-[#c084fc]/25 bg-[#c084fc]/10 text-[#c084fc]",
  mobile: "border-[#60a5fa]/25 bg-[#60a5fa]/10 text-[#60a5fa]",
  macos: "border-[#94a3b8]/25 bg-[#94a3b8]/10 text-[#94a3b8]",
  vitest: "border-[#eab308]/25 bg-[#eab308]/12 text-[#fbbf24]",
  npm: "border-[#38bdf8]/25 bg-[#38bdf8]/10 text-[#7dd3fc]",
};

function tagCls(t: string) {
  return TAG_COLORS[t] ?? "border-border bg-secondary text-muted-foreground";
}

function snippetLang(filename: string): "yaml" | "json" | "typescript" {
  if (filename.endsWith(".json")) return "json";
  if (filename.endsWith(".ts")) return "typescript";
  return "yaml";
}

export default function ExamplesPage() {
  const [mainTab, setMainTab] = useState<MainTab>("workflows");
  const items = mainTab === "workflows" ? WORKFLOW_EXAMPLES : CONFIG_EXAMPLES;
  const [activeId, setActiveId] = useState<string>(WORKFLOW_EXAMPLES[0].id);

  // When switching main tab, reset to first item
  function switchMainTab(tab: MainTab) {
    setMainTab(tab);
    setActiveId(tab === "workflows" ? WORKFLOW_EXAMPLES[0].id : CONFIG_EXAMPLES[0].id);
  }

  const activeExample = items.find((ex) => ex.id === activeId) ?? items[0];
  const lang = snippetLang(activeExample.filename);

  return (
    <div className="fade-up flex flex-col h-screen overflow-hidden">
      {/* Topbar */}
      <header className="dash-topbar shrink-0">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Examples</span>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-xs text-muted-foreground truncate min-w-0 max-w-[min(100%,28rem)]" title={activeExample.title}>
            {activeExample.title}
          </span>
        </div>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">
          {/* Page header */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight">Ready-to-use examples</h1>
            <p className="text-sm text-muted-foreground mt-1">
              These are copy-paste snippets for your GitHub repo. ExecForge does not edit the remote repository for you.
              Use the start/finish actions plus JUnit output (jest-junit or Playwright junit reporter) so the finish
              step ingests per-test failure messages — that feeds AI scan and run analysis in the dashboard.
              Pair with the Scripts & configs tab (jest-junit / Playwright junit reporter).
              Create an{" "}
              <code className="font-mono text-[11px] bg-secondary border border-border px-1.5 py-0.5">
                EXECFORGE_API_TOKEN
              </code>{" "}
              repository secret (see{" "}
              <Link href="/dashboard/settings" className="text-foreground underline underline-offset-2 hover:no-underline">
                Settings
              </Link>
              ) and store the token value from the dashboard. Telemetry is ingested when Actions runs your workflow.
            </p>
          </div>

          {/* Main category tabs */}
          <div className="border-b border-border mb-6">
            <div className="flex gap-0">
              {([
                { id: "workflows" as MainTab, label: "Workflow Files", Icon: Layers },
                { id: "configs" as MainTab, label: "Scripts & configs", Icon: FlaskConical },
              ]).map(({ id, label, Icon }) => (
                <Button
                  key={id}
                  type="button"
                  variant="ghost"
                  onClick={() => switchMainTab(id)}
                  className={`relative flex items-center gap-1.5 px-4 py-2.5 h-auto text-sm font-medium rounded-none transition-colors ${
                    mainTab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon size={13} />
                  {label}
                  {mainTab === id && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground" />
                  )}
                </Button>
              ))}
            </div>
          </div>

          {/* Example list + main card (full remaining width on xl) */}
          <div className="flex flex-col gap-4 min-h-[480px]">
            <div className="flex gap-4 min-w-0">
              {/* Example list */}
              <div className="w-56 shrink-0 hidden sm:block">
                <div className="sticky top-4 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2 mb-2">
                    {mainTab === "workflows" ? "Workflows" : "Configs"}
                  </p>
                  {items.map((ex) => (
                    <Button
                      key={ex.id}
                      type="button"
                      variant="ghost"
                      onClick={() => setActiveId(ex.id)}
                      className={`w-full h-auto text-left px-3 py-2.5 text-xs font-medium rounded-none transition-all border-l-2 ${
                        activeId === ex.id
                          ? "border-l-foreground bg-white/[0.05] text-foreground"
                          : "border-l-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
                      }`}
                    >
                      <span className="block truncate">{ex.title}</span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-4 min-w-0">
                <div className="min-w-0 space-y-4">
                  <div className="sm:hidden">
                    <label htmlFor="examples-mobile-pick" className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {mainTab === "workflows" ? "Workflows" : "Configs"}
                    </label>
                    <select
                      id="examples-mobile-pick"
                      className="mt-1 w-full bg-[#111] border border-white/[0.1] text-xs px-3 py-2 text-foreground"
                      value={activeId}
                      onChange={(e) => setActiveId(e.target.value)}
                    >
                      {items.map((ex) => (
                        <option key={ex.id} value={ex.id}>
                          {ex.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="bg-[#111] border border-white/[0.07]">
                    <ExampleCardHeader
                      title={activeExample.title}
                      description={activeExample.description}
                      filename={activeExample.filename}
                      tags={activeExample.tags}
                      tagClassName={tagCls}
                    />

                    <div className="p-0">
                      <CodeSnippet filename={activeExample.filename} code={activeExample.code} lang={lang} />
                    </div>

                    <div className="border-t border-white/[0.06] px-5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5 shrink-0">
                        <BookOpen className="size-3.5 opacity-70" aria-hidden />
                        <span className="font-medium text-foreground/80">Docs</span>
                      </span>
                      <span className="min-w-0">
                        Token flow and{" "}
                        <code className="text-[10px] text-foreground/80">EXECFORGE_API_TOKEN</code> are covered in{" "}
                        <code className="text-[10px] text-foreground/80">webapp/README.md</code>{" "}
                        <span className="text-foreground/70">(Runtime Token Flow)</span>
                        {" · "}
                        <Link
                          href="/dashboard/settings"
                          className="text-foreground underline underline-offset-2 hover:no-underline"
                        >
                          Dashboard settings
                        </Link>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const idx = items.findIndex((e) => e.id === activeId);
                        if (idx > 0) setActiveId(items[idx - 1].id);
                      }}
                      disabled={items.findIndex((e) => e.id === activeId) === 0}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 gap-1 rounded-md"
                    >
                      ← Previous
                    </Button>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {items.findIndex((e) => e.id === activeId) + 1} / {items.length}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const idx = items.findIndex((e) => e.id === activeId);
                        if (idx < items.length - 1) setActiveId(items[idx + 1].id);
                      }}
                      disabled={items.findIndex((e) => e.id === activeId) === items.length - 1}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 gap-1 rounded-md"
                    >
                      Next →
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
