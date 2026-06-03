# Docgen Orchestrator Pi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real `n-cursor docgen run` CLI orchestrator that uses local Ollama for routine file docs and cloud fallback ordered as `pi` -> `claude` -> `cursor-agent`.

**Architecture:** Keep `docgen-scan.mjs` as deterministic discovery. Add `docgen-run.mjs` beside it for orchestration, prompt construction, provider selection, file writing, validation, and CLI output. Update shared runner chains that currently express `claude` -> `cursor-agent` so similar cloud delegation prefers `pi` first.

**Tech Stack:** Bun/Vitest, ESM `.mjs`, Node/Bun built-ins, Ollama HTTP API, external CLIs `pi -p`, `claude -p`, `cursor-agent -p`.

---

### Task 1: Add Runner Selection Tests

**Files:**
- Modify: `npm/scripts/dispatcher/lib/tests/subagent-runner.test.mjs`
- Modify: `npm/scripts/tests/skills-cli.test.mjs`
- Modify: `npm/skills/docgen/js/tests/docgen-run.test.mjs`

- [ ] **Step 1: Write failing tests for `pi` runner priority**

Add assertions that `selectBackend()` returns `pi` when `pi` is in PATH, that `cliRunner('pi')` spawns `pi -p`, and that `runSkillsCli(['pi', 'fix'])` accepts the new runner.

- [ ] **Step 2: Write failing tests for `docgen run` provider order**

Create `npm/skills/docgen/js/tests/docgen-run.test.mjs` with injected `fetch`, `spawn`, and `isBinaryInPath` dependencies. Test that Tier 1 uses Ollama by default and Tier 2/Tier 3 pick `pi` before `claude` before `cursor-agent`.

- [ ] **Step 3: Verify RED**

Run:

```bash
bunx vitest run npm/scripts/dispatcher/lib/tests/subagent-runner.test.mjs npm/scripts/tests/skills-cli.test.mjs npm/skills/docgen/js/tests/docgen-run.test.mjs
```

Expected: failures mentioning unsupported `pi` runner and missing `docgen-run.mjs`.

### Task 2: Implement Cloud Runner Chain

**Files:**
- Modify: `npm/scripts/dispatcher/lib/subagent-runner.mjs`
- Modify: `npm/scripts/skills-cli.mjs`
- Modify: `npm/scripts/tests/skills-cli.test.mjs`
- Modify: `npm/bin/n-cursor.js`

- [ ] **Step 1: Add `pi` backend**

Update runner unions and CLI help to include `pi`. `pi` uses `spawnSync('pi', ['-p'], { input: prompt, cwd, stdio: ['pipe', 'inherit', 'inherit'] })`.

- [ ] **Step 2: Make auto-selection prefer `pi`**

Change fallback order from `claude` -> `cursor-agent` to `pi` -> `claude` -> `cursor-agent` where no explicit backend was requested.

- [ ] **Step 3: Verify GREEN for shared runners**

Run:

```bash
bunx vitest run npm/scripts/dispatcher/lib/tests/subagent-runner.test.mjs npm/scripts/tests/skills-cli.test.mjs
```

Expected: all selected tests pass.

### Task 3: Implement `docgen run`

**Files:**
- Create: `npm/skills/docgen/js/docgen-run.mjs`
- Modify: `npm/skills/docgen/js/tests/docgen-run.test.mjs`
- Modify: `npm/bin/n-cursor.js`
- Modify: `npm/skills/docgen/SKILL.md`
- Modify: `.cursor/skills/n-docgen/SKILL.md`

- [ ] **Step 1: Add local Ollama file-doc generation**

`runDocgenRunCli(argv)` parses `--root`, `--overwrite`, `--ollama-model`, `--ollama-host`, and `--dry-run`. It scans files via `scanForDocgen()`, skips existing docs unless `--overwrite`, and calls `POST /api/chat` against Ollama for Tier 1.

- [ ] **Step 2: Add cloud fallback**

When Ollama is unavailable, output validation fails, or aggregate tiers run, call a cloud runner with priority `pi`, `claude`, `cursor-agent`. Use injected dependencies in tests and real `spawnSync` in CLI.

- [ ] **Step 3: Add deterministic validation**

Validate that generated Markdown includes required Ukrainian section headings and writes the requested doc path. Failed items are recorded and do not stop the rest of the batch.

- [ ] **Step 4: Wire CLI and skill**

`npx @nitra/cursor docgen run` calls `runDocgenRunCli()`. The `docgen` skill tells agents to run `docgen run` instead of manually dispatching per-file subagents.

- [ ] **Step 5: Verify GREEN for docgen**

Run:

```bash
bunx vitest run npm/skills/docgen/js/tests/docgen-scan.test.mjs npm/skills/docgen/js/tests/docgen-run.test.mjs
```

Expected: all selected tests pass.

### Task 4: Docs, CI4, and Release Artifact

**Files:**
- Modify: `docs/ci4/01-context.md`
- Create: `npm/.changes/<generated>.md`

- [ ] **Step 1: Update CI4 LLM CLI context**

Change the documented fallback chain to `pi` -> `claude` -> `cursor-agent` and mention that `docgen run` also uses LLM CLIs.

- [ ] **Step 2: Add change-file**

Run:

```bash
npx @nitra/cursor change --bump minor --section Added --message "docgen: додано CLI-orchestrator з Ollama Tier 1 і pi.dev-first cloud fallback" --ws npm
```

- [ ] **Step 3: Final verification**

Run focused tests:

```bash
bunx vitest run npm/skills/docgen/js/tests/docgen-scan.test.mjs npm/skills/docgen/js/tests/docgen-run.test.mjs npm/scripts/dispatcher/lib/tests/subagent-runner.test.mjs npm/scripts/tests/skills-cli.test.mjs
```

Run changelog check:

```bash
npx @nitra/cursor fix changelog
```

Expected: focused tests pass; changelog check exits 0.

---

Self-review: This plan covers local Ollama generation, cloud runner priority, CLI wiring, skill docs, CI4 docs, tests, and required change-file. No placeholders remain.
