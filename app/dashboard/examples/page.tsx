"use client";

import { useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { CodeSnippet } from "@/components/settings/settings-client";
import { BookOpen, Layers, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";


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
      - uses: Absterrg0/execforge-runtime@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build & test
        run: npm run build && npm test`;

const E2E_WORKFLOW = `name: E2E Tests

on:
  push:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime@v1
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
        run: npx playwright test`;

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
      - uses: Absterrg0/execforge-runtime@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install
        run: npm ci && npx playwright install --with-deps chromium

      - name: Run shard \${{ matrix.shard }}/4
        run: npx playwright test --shard=\${{ matrix.shard }}/4`;

const DOCKER_WORKFLOW = `name: Docker Build

on:
  push:
    branches: [main]

jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build image
        run: |
          docker buildx build --cache-from=type=gha --cache-to=type=gha,mode=max -t myapp:latest .`;

const PROPER_TESTS_WORKFLOW = `name: Proper Tests

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run solid tests
        run: npm run test:unit`;

const FLAKY_TESTS_WORKFLOW = `name: Flaky Tests

on:
  push:
    branches: [main]

jobs:
  flaky_test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run flaky tests
        run: npm run test:flaky`;

const FAILED_TESTS_WORKFLOW = `name: Failed Tests

on:
  push:
    branches: [main]

jobs:
  fail_test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run failing tests
        run: npm run test:fail`;

const LINT_WORKFLOW = `name: Linting

on:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint`;

const SECURITY_SCAN_WORKFLOW = `name: Security Scan

on:
  push:
    branches: [main]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Audit dependencies
        run: npm audit`;

const MOBILE_TESTS_WORKFLOW = `name: Mobile Tests

on:
  push:
    branches: [main]

jobs:
  mobile_test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Absterrg0/execforge-runtime@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run React Native tests
        run: npm run test:mobile`;

const FLAKY_JEST = `// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  // Retry flaky tests automatically — ExecForge tracks retry counts
  testRetries: 2,

  // Randomise order to surface order-dependent failures
  randomize: true,

  reporters: ['default'],
};

export default config;`;

const FLAKY_PLAYWRIGHT = `// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Retry flaky specs — ExecForge counts retries per test
  retries: 2,

  // Run files in parallel for faster wall-clock time
  fullyParallel: true,

  reporter: 'list',

  use: {
    baseURL: 'http://localhost:3000',
    // Capture trace on first retry to help debug flakiness
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});`;

type MainTab = "workflows" | "configs";

const WORKFLOW_EXAMPLES = [
  {
    id: "basic-ci",
    title: "Basic CI",
    description: "Wrap your standard build & test pipeline. Captures duration, CPU, memory, exit code, and test signals.",
    filename: ".github/workflows/ci.yml",
    code: BASIC_WORKFLOW,
    tags: ["npm", "jest", "beginner"],
  },
  {
    id: "playwright-e2e",
    title: "Playwright E2E",
    description: "End-to-end tests with Playwright. ExecForge captures per-spec pass/fail, retries, and duration.",
    filename: ".github/workflows/e2e.yml",
    code: E2E_WORKFLOW,
    tags: ["playwright", "e2e"],
  },
  {
    id: "sharded-e2e",
    title: "Sharded E2E (4 workers)",
    description: "Parallelise Playwright across 4 matrix shards to cut wall-clock time by up to 75%.",
    filename: ".github/workflows/e2e-sharded.yml",
    code: MATRIX_WORKFLOW,
    tags: ["playwright", "matrix", "advanced"],
  },
  {
    id: "docker-build",
    title: "Docker Build",
    description: "Measure Docker build time and layer cache efficiency with GitHub Actions cache.",
    filename: ".github/workflows/docker.yml",
    code: DOCKER_WORKFLOW,
    tags: ["docker"],
  },
  {
    id: "proper-tests",
    title: "Proper Tests",
    description: "A standard test workflow that executes properly with 100% success rate. Ideal for benchmarking.",
    filename: ".github/workflows/proper-tests.yml",
    code: PROPER_TESTS_WORKFLOW,
    tags: ["jest", "stable"],
  },
  {
    id: "flaky-tests",
    title: "Flaky Tests",
    description: "A workflow with tests that sporadically fail and retry, useful to see how ExecForge identifies flaky specs.",
    filename: ".github/workflows/flaky-tests.yml",
    code: FLAKY_TESTS_WORKFLOW,
    tags: ["flaky", "jest"],
  },
  {
    id: "failed-tests",
    title: "Failed Tests",
    description: "A workflow demonstrating failures. See how ExecForge captures error outputs and tracebacks.",
    filename: ".github/workflows/failed-tests.yml",
    code: FAILED_TESTS_WORKFLOW,
    tags: ["failed", "jest"],
  },
  {
    id: "lint-checks",
    title: "Lint Checks",
    description: "A workflow that only runs linting, demonstrating static analysis tracking.",
    filename: ".github/workflows/lint.yml",
    code: LINT_WORKFLOW,
    tags: ["lint", "fast"],
  },
  {
    id: "security-scan",
    title: "Security Scan",
    description: "A workflow for running security audits and scans.",
    filename: ".github/workflows/security.yml",
    code: SECURITY_SCAN_WORKFLOW,
    tags: ["security"],
  },
  {
    id: "mobile-tests",
    title: "Mobile Tests",
    description: "Running tests on a macOS runner for mobile platforms like React Native.",
    filename: ".github/workflows/mobile.yml",
    code: MOBILE_TESTS_WORKFLOW,
    tags: ["mobile", "macos"],
  },
];

const CONFIG_EXAMPLES = [
  {
    id: "jest-flaky",
    title: "Jest — flaky test detection",
    description: "Enable retries and randomised order so ExecForge can identify intermittently failing tests.",
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
];

const TAG_COLORS: Record<string, string> = {
  beginner: "border-[#4ade80]/25 bg-[#4ade80]/10 text-[#4ade80]",
  advanced: "border-[#818cf8]/25 bg-[#818cf8]/10 text-[#818cf8]",
  flaky:    "border-[#facc15]/25 bg-[#facc15]/10 text-[#facc15]",
  matrix:   "border-[#818cf8]/25 bg-[#818cf8]/10 text-[#818cf8]",
  stable:   "border-[#4ade80]/25 bg-[#4ade80]/10 text-[#4ade80]",
  failed:   "border-[#f87171]/25 bg-[#f87171]/10 text-[#f87171]",
  lint:     "border-[#2dd4bf]/25 bg-[#2dd4bf]/10 text-[#2dd4bf]",
  fast:     "border-[#34d399]/25 bg-[#34d399]/10 text-[#34d399]",
  security: "border-[#c084fc]/25 bg-[#c084fc]/10 text-[#c084fc]",
  mobile:   "border-[#60a5fa]/25 bg-[#60a5fa]/10 text-[#60a5fa]",
  macos:    "border-[#94a3b8]/25 bg-[#94a3b8]/10 text-[#94a3b8]",
};

function tagCls(t: string) {
  return TAG_COLORS[t] ?? "border-border bg-secondary text-muted-foreground";
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

  return (
    <div className="fade-up flex flex-col h-screen overflow-hidden">
      {/* Topbar */}
      <header className="dash-topbar shrink-0">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Examples</span>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-xs text-muted-foreground font-mono">{activeExample.filename}</span>
        </div>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8">

          {/* Page header */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight">Ready-to-use examples</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Copy any of these into your repository. You need an{" "}
              <code className="font-mono text-[11px] bg-secondary border border-border px-1.5 py-0.5">
                EXECFORGE_API_TOKEN
              </code>{" "}
              secret in GitHub Actions.
            </p>
          </div>

          {/* Main category tabs */}
          <div className="border-b border-border mb-6">
            <div className="flex gap-0">
              {([
                { id: "workflows" as MainTab, label: "Workflow Files", Icon: Layers },
                { id: "configs" as MainTab, label: "Test Configs", Icon: FlaskConical },
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

          {/* Two-panel layout: sub-tabs + content */}
          <div className="flex gap-4 min-h-[480px]">

            {/* Sub-tab sidebar */}
            <div className="w-56 shrink-0">
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

            {/* Main content panel */}
            <div className="flex-1 min-w-0">
              <div className="bg-[#111] border border-white/[0.07]">
                {/* Panel header */}
                <div className="px-5 py-4 border-b border-white/[0.06]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <p className="text-sm font-semibold">{activeExample.title}</p>
                        {activeExample.tags.map((t) => (
                          <span
                            key={t}
                            className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium border ${tagCls(t)}`}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{activeExample.description}</p>
                    </div>
                    <div className="shrink-0">
                      <span className="text-[10px] font-mono text-muted-foreground bg-white/[0.04] border border-white/[0.06] px-2 py-1">
                        <BookOpen size={9} className="inline mr-1" />
                        {activeExample.filename}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Code snippet */}
                <div className="p-0">
                  <CodeSnippet filename={activeExample.filename} code={activeExample.code} />
                </div>
              </div>

              {/* Navigation arrows */}
              <div className="flex items-center justify-between mt-4">
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
  );
}
