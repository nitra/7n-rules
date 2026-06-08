# Meta-task Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Винести task orchestration з `@nitra/cursor` у самостійний пакет `@7n/mt` із binary `mt`, runtime root `mt/` і повним видаленням legacy `flow`/`graph` із `@nitra/cursor`.

**Architecture:** Живою базою перенесення є `cursor/npm/scripts/dispatcher/graph/` та `graph-tasks.mjs`; дубль `cursor/npm/scripts/graph/` не переноситься. Новий пакет отримує незалежний CLI, `.mt.json`, core-модулі та command handlers. Після зеленого target package із `cursor` видаляються старі entry points, реалізації, docs і 168 погоджених ADR.

**Tech Stack:** Bun, Node.js ESM, Vitest, Markdown/YAML frontmatter, Git worktrees, `@nitra/cursor` лише як dev tooling.

---

## Робочі Простори

- Source repository: `/Users/vitaliytv/www/nitra/cursor`
- Target repository: `/Users/vitaliytv/www/nitra/mt`
- Source branch: `codex/meta-task-extraction`
- Target branch: `codex/meta-task-extraction`
- Source worktree: `/Users/vitaliytv/www/nitra/cursor/.worktrees/codex-meta-task-extraction`
- Target worktree: `/Users/vitaliytv/www/nitra/mt/.worktrees/codex-meta-task-extraction`

## Фінальна Структура `@7n/mt`

```text
npm/
├── bin/
│   └── mt.js
├── docs/
│   └── mt.md
├── lib/
│   ├── cli.mjs
│   ├── commands/
│   │   ├── audit.mjs
│   │   ├── done.mjs
│   │   ├── failed.mjs
│   │   ├── init.mjs
│   │   ├── invalidate.mjs
│   │   ├── kill.mjs
│   │   ├── plan.mjs
│   │   ├── run.mjs
│   │   ├── scan.mjs
│   │   ├── setup.mjs
│   │   ├── spawn.mjs
│   │   ├── status.mjs
│   │   ├── verify.mjs
│   │   └── watch.mjs
│   ├── core/
│   │   ├── config.mjs
│   │   ├── frontmatter.mjs
│   │   ├── nnn.mjs
│   │   ├── scanner.mjs
│   │   ├── state.mjs
│   │   └── worktree.mjs
│   └── tests/
│       ├── cli.test.mjs
│       ├── config.test.mjs
│       ├── state.test.mjs
│       └── verify.test.mjs
├── index.js
├── package.json
└── types/
    └── index.d.ts
```

## Task 1: Створити Ізольовані Worktrees І Baseline

**Files:**

- No production files changed.

- [ ] **Step 1: Create the source worktree**

Run:

```bash
cd /Users/vitaliytv/www/nitra/cursor
npx @nitra/cursor worktree add codex/meta-task-extraction "Видалення legacy flow/graph після extraction у @7n/mt"
```

Expected: `.worktrees/codex-meta-task-extraction/` exists on branch `codex/meta-task-extraction`.

- [ ] **Step 2: Create the target worktree**

Run:

```bash
cd /Users/vitaliytv/www/nitra/mt
npx @nitra/cursor worktree add codex/meta-task-extraction "Реалізація standalone @7n/mt"
```

Expected: `.worktrees/codex-meta-task-extraction/` exists on branch `codex/meta-task-extraction`.

- [ ] **Step 3: Install target dependencies**

Run:

```bash
cd /Users/vitaliytv/www/nitra/mt/.worktrees/codex-meta-task-extraction
bun install
```

Expected: exit `0`.

- [ ] **Step 4: Verify both baselines**

Run:

```bash
cd /Users/vitaliytv/www/nitra/mt/.worktrees/codex-meta-task-extraction
bun run test
cd /Users/vitaliytv/www/nitra/cursor/.worktrees/codex-meta-task-extraction
bun run test
```

Expected: both exit `0`. If either fails, diagnose before implementation.

## Task 2: Зафіксувати Standalone CLI Контракт Через TDD

**Files:**

- Create: `/Users/vitaliytv/www/nitra/mt/.worktrees/codex-meta-task-extraction/npm/lib/tests/cli.test.mjs`
- Create: `/Users/vitaliytv/www/nitra/mt/.worktrees/codex-meta-task-extraction/npm/lib/cli.mjs`
- Create: `/Users/vitaliytv/www/nitra/mt/.worktrees/codex-meta-task-extraction/npm/bin/mt.js`
- Modify: `/Users/vitaliytv/www/nitra/mt/.worktrees/codex-meta-task-extraction/npm/index.js`
- Modify: `/Users/vitaliytv/www/nitra/mt/.worktrees/codex-meta-task-extraction/npm/package.json`
- Create: `/Users/vitaliytv/www/nitra/mt/.worktrees/codex-meta-task-extraction/npm/types/index.d.ts`

- [ ] **Step 1: Write failing CLI routing tests**

Create tests asserting:

```js
import { describe, expect, test, vi } from 'vitest'
import { COMMAND_NAMES, runMtCli } from '../cli.mjs'

describe('runMtCli', () => {
  test('exposes the complete public command surface', () => {
    expect(COMMAND_NAMES).toEqual([
      'setup', 'init', 'plan', 'verify', 'run', 'status', 'scan',
      'watch', 'audit', 'done', 'failed', 'spawn', 'invalidate', 'kill'
    ])
  })

  test('routes a command and forwards remaining argv', async () => {
    const plan = vi.fn(async () => 0)
    expect(await runMtCli(['plan', 'release'], { handlers: { plan } })).toBe(0)
    expect(plan).toHaveBeenCalledWith(['release'], expect.any(Object))
  })

  test('returns 1 for an unknown command', async () => {
    vi.spyOn(console, 'error').mockReturnValue()
    expect(await runMtCli(['graph'])).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
bun run test npm/lib/tests/cli.test.mjs
```

Expected: FAIL because `npm/lib/cli.mjs` does not exist.

- [ ] **Step 3: Implement the minimal CLI router**

Implement `COMMAND_NAMES`, `DEFAULT_HANDLERS`, `runMtCli(argv, deps)` and help
text using only the `mt` product name. `DEFAULT_HANDLERS` must use lazy dynamic
imports so `cli.test.mjs` can load before command modules are created in Task 4.

- [ ] **Step 4: Replace scaffold binary and metadata**

Required package contract:

```json
{
  "name": "@7n/mt",
  "bin": { "mt": "bin/mt.js" },
  "main": "./index.js",
  "types": "./types/index.d.ts",
  "files": ["bin", "docs", "lib", "types", "index.js", "README.md", "CHANGELOG.md"]
}
```

`bin/mt.js`:

```js
#!/usr/bin/env node
import { runMtCli } from '../index.js'

process.exitCode = await runMtCli(process.argv.slice(2))
```

`index.js` exports `runMtCli`, `COMMAND_NAMES` and `version`.

- [ ] **Step 5: Run tests and CLI smoke**

Run:

```bash
bun run test npm/lib/tests/cli.test.mjs
bun npm/bin/mt.js --help
bun npm/bin/mt.js --version
```

Expected: tests PASS; help contains `mt <command>`; version is `0.1.0`.

- [ ] **Step 6: Commit**

```bash
git add npm
git commit -m "feat: додати standalone mt CLI"
```

## Task 3: Перенести Core Файлової Моделі Через TDD

**Files:**

- Create: `mt/npm/lib/core/config.mjs`
- Create: `mt/npm/lib/core/frontmatter.mjs`
- Create: `mt/npm/lib/core/nnn.mjs`
- Create: `mt/npm/lib/core/scanner.mjs`
- Create: `mt/npm/lib/core/state.mjs`
- Create: `mt/npm/lib/core/worktree.mjs`
- Create: `mt/npm/lib/tests/config.test.mjs`
- Create: `mt/npm/lib/tests/state.test.mjs`
- Source reference: `cursor/npm/scripts/dispatcher/graph/lib/{config,frontmatter,nnn,scanner,node-state,worktree-ops}.mjs`

- [ ] **Step 1: Write failing config tests**

Tests must assert:

```js
expect(CONFIG_DEFAULTS.mt_dir).toBe('./mt')
expect(loadConfig({ root: '/repo', exists: () => false }).mt_dir).toBe('./mt')
expect(resolveMtDir({ mt_dir: './mt' }, '/repo')).toBe('/repo/mt')
```

Also assert that `loadConfig` reads `/repo/.mt.json`, never `/repo/.n-cursor.json`.

- [ ] **Step 2: Write failing state tests**

Cover precedence:

```text
invalidated > resolved > pending-audit > running > failed > waiting > needs-plan
```

Cover composite aggregation and `sanitizeTaskName`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
bun run test npm/lib/tests/config.test.mjs npm/lib/tests/state.test.mjs
```

Expected: FAIL because core modules do not exist.

- [ ] **Step 4: Port and rename core modules**

Apply these required identifier migrations:

```text
CONFIG_DEFAULTS.tasks_dir -> CONFIG_DEFAULTS.mt_dir
resolveTasksDir           -> resolveMtDir
.n-cursor.json            -> .mt.json
tasks/<node>              -> mt/<task>
node-state.mjs            -> state.mjs
worktree-ops.mjs          -> worktree.mjs
sanitizeNodeName          -> sanitizeTaskName
```

Do not port `cursor/npm/scripts/graph/`; it is a stale duplicate.

- [ ] **Step 5: Run core tests**

Run:

```bash
bun run test npm/lib/tests/config.test.mjs npm/lib/tests/state.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add npm/lib/core npm/lib/tests
git commit -m "feat: перенести файлове ядро Meta-task"
```

## Task 4: Перенести Command Handlers І Behavioral Tests

**Files:**

- Create: `mt/npm/lib/commands/*.mjs`
- Create: `mt/npm/lib/tests/verify.test.mjs`
- Modify: `mt/npm/lib/cli.mjs`
- Source reference: `cursor/npm/scripts/dispatcher/graph/lib/cmd-*.mjs`
- Source reference: `cursor/npm/scripts/dispatcher/graph/lib/tests/cmd-verify.test.mjs`

- [ ] **Step 1: Port verify test before implementation**

Copy the behavioral cases from `cmd-verify.test.mjs`, then update:

```text
cmdVerify import -> ../commands/verify.mjs
flow verify      -> mt verify
node terminology -> task terminology
```

- [ ] **Step 2: Add setup clean-break tests**

Tests must assert that `setup` creates:

```text
.mt.json
mt/
```

and does not create:

```text
.n-cursor.json
tasks/
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
bun run test npm/lib/tests/verify.test.mjs npm/lib/tests/setup.test.mjs
```

Expected: FAIL because command modules do not exist.

- [ ] **Step 4: Port all handlers**

Map source files to target files:

```text
cmd-setup.mjs      -> commands/setup.mjs
cmd-init.mjs       -> commands/init.mjs
cmd-plan.mjs       -> commands/plan.mjs
cmd-verify.mjs     -> commands/verify.mjs
cmd-run.mjs        -> commands/run.mjs
cmd-status.mjs     -> commands/status.mjs
cmd-scan.mjs       -> commands/scan.mjs
cmd-watch.mjs      -> commands/watch.mjs
cmd-signals.mjs    -> commands/audit.mjs, done.mjs, failed.mjs, spawn.mjs
cmd-invalidate.mjs -> commands/invalidate.mjs
cmd-kill.mjs       -> commands/kill.mjs
```

All imports must use `../core/`. Replace product naming and runtime paths, but preserve behavior.

- [ ] **Step 5: Add command integration smoke**

Create a temporary repository fixture and verify:

```bash
mt setup
mt init demo --task "Demo task"
mt status demo --json
```

Expected: `.mt.json`, `mt/demo/task.md`, JSON status with task `demo`.

- [ ] **Step 6: Run target tests**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add npm/lib npm/index.js
git commit -m "feat: перенести команди Meta-task"
```

## Task 5: Перенести Canonical Spec І 168 ADR

**Files:**

- Move: `cursor/npm/docs/flow.MD` -> `mt/npm/docs/mt.md`
- Move: 168 selected files from `cursor/docs/adr/` -> `mt/docs/adr/`
- Modify: moved docs to canonical MT terminology
- Modify: `mt/AGENTS.md`
- Modify: `mt/.n-cursor.json`

- [ ] **Step 1: Generate the reproducible ADR manifest**

From the source worktree:

```bash
rg -l -0 -i 'n-cursor (flow|graph)|\.flow\.json|pending-audit_|fact_NNN|task\.md|tasks/|думка\.MD|Пасивн(ий|ого) Турнікет|Активн(ий|ого) Раннер' docs/adr > /tmp/mt-adr-files.zlist
tr '\0' '\n' < /tmp/mt-adr-files.zlist | wc -l
```

Expected: exactly `168`.

- [ ] **Step 2: Move the files**

For every NUL-delimited path, create the target parent and move the file into the target worktree preserving the basename and timestamp prefix.

- [ ] **Step 3: Move and rename the canonical specification**

Move full `npm/docs/flow.MD` to target `npm/docs/mt.md`. Delete source `docs/flow.md` and `docs/flow-graph.html`; do not merge their content.

- [ ] **Step 4: Normalize product terminology**

Required transformations:

```text
n-cursor flow / n-cursor graph -> mt
tasks/                          -> mt/
docs/думка.MD / npm/docs/flow.MD -> npm/docs/mt.md
.flow.json                      -> MT file-presence state, phrased by context
```

Transition ADRs must describe neutral MT evolution, not “mt replaced mt”. Generic terms such as control flow, dependency graph, GraphQL and GitHub workflow remain unchanged.

- [ ] **Step 5: Remove the stale flow rule from target dev tooling**

Remove `flow` from target `.n-cursor.json` and `.cursor/rules/n-flow.mdc` through `npx @nitra/cursor` sync after config update.

- [ ] **Step 6: Verify docs**

Run:

```bash
test -f npm/docs/mt.md
test "$(find docs/adr -type f -name '*.md' | wc -l | tr -d ' ')" = "168"
rg -n 'n-cursor (flow|graph)|\.flow\.json|docs/думка\.MD|npm/docs/flow\.MD' npm/docs/mt.md docs/adr
```

Expected: first two commands exit `0`; final search has no product-legacy matches.

- [ ] **Step 7: Commit target docs**

```bash
git add npm/docs docs/adr AGENTS.md CLAUDE.md .n-cursor.json .cursor
git commit -m "docs: перенести специфікацію та ADR Meta-task"
```

## Task 6: Завершити Target Package І Verify

**Files:**

- Modify: `mt/npm/package.json`
- Create: `mt/npm/README.md`
- Modify: `mt/npm/stryker.config.mjs`
- Create: `mt/npm/.changes/<timestamp>.md`

- [ ] **Step 1: Update package documentation and mutation scope**

README must describe installation and the standalone `mt` commands. Stryker `mutate` must include `index.js`, `bin/**/*.js` and `lib/**/*.mjs`.

- [ ] **Step 2: Add the package change file**

Run:

```bash
npx @nitra/cursor change --bump minor --section Added --message "додано standalone Meta-task CLI, файловий runtime і task orchestration" --ws npm
```

- [ ] **Step 3: Run complete target verification**

Run:

```bash
bun run test
bun run lint
npx @nitra/cursor fix changelog
bun npm/bin/mt.js --help
```

Expected: all exit `0`.

- [ ] **Step 4: Audit runtime dependencies**

Run:

```bash
rg -n '@nitra/cursor|n-cursor|scripts/dispatcher|scripts/graph' npm/index.js npm/bin npm/lib
```

Expected: no runtime imports or product references.

- [ ] **Step 5: Commit**

```bash
git add npm
git commit -m "chore: завершити пакет @7n/mt"
```

## Task 7: Видалити Legacy Entry Points І Runtime З `@nitra/cursor`

**Files:**

- Modify: `cursor/npm/bin/n-cursor.js`
- Modify: `cursor/npm/types/bin/n-cursor.d.ts`
- Delete: `cursor/npm/scripts/dispatcher/graph-tasks.mjs`
- Delete: `cursor/npm/scripts/dispatcher/graph/`
- Delete: `cursor/npm/scripts/graph/`
- Delete: `cursor/npm/scripts/dispatcher/index.mjs`
- Delete: MT-only modules under `cursor/npm/scripts/dispatcher/lib/`
- Delete: `cursor/npm/scripts/dispatcher/graph/lib/tests/cmd-verify.test.mjs`
- Delete: `cursor/npm/scripts/dispatcher/tests/index.test.mjs`
- Delete: `cursor/npm/scripts/dispatcher/tests/graph.test.mjs`
- Delete: `cursor/npm/scripts/dispatcher/tests/trace.test.mjs`
- Delete: `cursor/npm/scripts/dispatcher/docs/graph.md`
- Delete: `cursor/npm/scripts/dispatcher/docs/index.md`
- Delete: `cursor/npm/scripts/dispatcher/docs/trace.md`

- [ ] **Step 1: Write failing CLI removal tests**

Update CLI tests to assert that `flow`, `graph`, `watch` and `mt` are unknown commands and absent from help output.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun run test npm/scripts/dispatcher/tests/index.test.mjs
```

Expected: FAIL because legacy commands are still routed.

- [ ] **Step 3: Remove CLI cases and usage entries**

Delete `case 'flow'`, `case 'graph'`, `case 'watch'`, related dynamic imports and command-list text.

- [ ] **Step 4: Remove implementation and tests**

Delete the live implementation, stale duplicate implementation, old flow dispatcher, traceability modules that only serve the removed lifecycle, and their tests/docs.

- [ ] **Step 5: Remove flow sibling cleanup coupling**

Remove `.flow.json`, `.events.jsonl` and flow-lock cleanup behavior from `worktree-cli` and gitignore sync. Update affected tests first so the behavior removal is covered.

- [ ] **Step 6: Run focused tests**

Run:

```bash
bun run test npm/bin npm/scripts/tests npm/scripts/dispatcher npm/scripts/lib/tests
```

Expected: PASS.

- [ ] **Step 7: Commit runtime cleanup**

```bash
git add npm
git commit -m "refactor: видалити вбудований flow і graph runtime"
```

## Task 8: Видалити Source Docs І 168 ADR З `@nitra/cursor`

**Files:**

- Delete: selected `cursor/docs/adr/*.md`
- Delete: `cursor/docs/flow.md`
- Delete: `cursor/docs/flow-graph.html`
- Delete: obsolete `cursor/docs/specs/*flow*` and `cursor/docs/plans/*flow*`
- Modify: remaining docs that list removed commands
- Create: `cursor/npm/.changes/<timestamp>.md`

- [ ] **Step 1: Verify the source manifest paths are absent**

Use `/tmp/mt-adr-files.zlist` and assert every path no longer exists in the source worktree.

- [ ] **Step 2: Remove superseded plans/specs and command docs**

Delete legacy flow/graph design projections that are no longer authoritative. Keep only the extraction design and implementation plan as migration records.

- [ ] **Step 3: Update remaining package docs**

Remove command references from `npm/bin/docs/n-cursor.md`, worktree docs and generated command inventories. Preserve generic words such as control flow and dependency graph.

- [ ] **Step 4: Add cursor change file**

Run:

```bash
npx @nitra/cursor change --bump major --section Removed --message "видалено вбудовані flow і graph; Meta-task винесено в окремий пакет @7n/mt" --ws npm
```

- [ ] **Step 5: Run legacy product audit**

Run targeted searches for:

```text
n-cursor flow
n-cursor graph
case 'flow'
case 'graph'
case 'watch'
.flow.json
n-flow.mdc
npm/docs/flow.MD
docs/думка.MD
```

Expected: no active product references.

- [ ] **Step 6: Run complete cursor verification**

Run:

```bash
bun run test
bun run lint
npx @nitra/cursor fix changelog
```

Expected: all exit `0`.

- [ ] **Step 7: Commit source cleanup**

```bash
git add .
git commit -m "refactor: завершити extraction Meta-task"
```

## Task 9: Cross-Repository Acceptance Audit

**Files:**

- No planned production changes; fixes are applied to the owning repository if verification exposes a defect.

- [ ] **Step 1: Verify target package**

Run:

```bash
cd /Users/vitaliytv/www/nitra/mt/.worktrees/codex-meta-task-extraction
bun run test
bun run lint
npx @nitra/cursor fix changelog
bun npm/bin/mt.js --help
```

- [ ] **Step 2: Verify source cleanup**

Run:

```bash
cd /Users/vitaliytv/www/nitra/cursor/.worktrees/codex-meta-task-extraction
bun run test
bun run lint
npx @nitra/cursor fix changelog
```

- [ ] **Step 3: Verify ADR ownership**

Expected:

```text
target docs/adr count: 168
source moved paths present: 0
duplicate moved basenames across repositories: 0
```

- [ ] **Step 4: Verify package boundary**

Target runtime contains no imports from `@nitra/cursor`. Source contains no Meta-task runtime implementation or CLI facade.

- [ ] **Step 5: Review both branch diffs**

Run:

```bash
git diff main...codex/meta-task-extraction --stat
git log --oneline main..codex/meta-task-extraction
```

Expected: only scoped extraction changes and intentional documentation migration.
