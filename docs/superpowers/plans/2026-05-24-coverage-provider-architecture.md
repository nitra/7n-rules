# Coverage Provider Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести логіку `mlmail/scripts/coverage.js` в `@nitra/cursor` як CLI-команду `n-cursor coverage` з провайдерами-плагінами, що активуються за `.n-cursor.json#rules`.

**Architecture:** Оркестратор (`npm/rules/test/coverage/coverage.mjs`) читає `.n-cursor.json#rules`, динамічно підвантажує провайдерів (кожне правило мови постачає `coverage/coverage.mjs`), агрегує рядки і пише `COVERAGE.md`. Лок — через нову стандартну точку `runStandardCoverage` у `lib/` (аналог `runStandardLint`). Два провайдери: `js-lint` (bun + Stryker) і `rust` (cargo-llvm-cov + cargo-mutants).

**Tech Stack:** Bun test, ESM, OPA/Conftest (rego), Node 24+

---

## Файли

| Дія                            | Шлях                                                                     |
| ------------------------------ | ------------------------------------------------------------------------ |
| CREATE                         | `npm/scripts/lib/run-standard-coverage.mjs`                              |
| CREATE                         | `npm/scripts/lib/tests/run-standard-coverage.test.mjs`                   |
| CREATE                         | `npm/rules/test/policy/package_json/target.json`                         |
| CREATE                         | `npm/rules/test/policy/package_json/template/package.json.contains.json` |
| CREATE                         | `npm/rules/test/policy/package_json/package_json.rego`                   |
| CREATE                         | `npm/rules/test/policy/package_json/package_json_test.rego`              |
| CREATE                         | `npm/rules/test/coverage/coverage.mjs`                                   |
| CREATE                         | `npm/rules/test/coverage/tests/coverage.test.mjs`                        |
| CREATE                         | `npm/rules/js-lint/coverage/coverage.mjs`                                |
| CREATE                         | `npm/rules/js-lint/coverage/tests/coverage.test.mjs`                     |
| CREATE                         | `npm/rules/rust/coverage/coverage.mjs`                                   |
| CREATE                         | `npm/rules/rust/coverage/tests/coverage.test.mjs`                        |
| MODIFY                         | `npm/rules/test/test.mdc`                                                |
| MODIFY                         | `npm/rules/js-lint/js-lint.mdc`                                          |
| MODIFY                         | `npm/rules/rust/rust.mdc`                                                |
| MODIFY                         | `npm/bin/n-cursor.js`                                                    |
| MODIFY                         | `npm/package.json`                                                       |
| MODIFY                         | `npm/CHANGELOG.md`                                                       |
| DELETE (separate PR in mlmail) | `scripts/coverage.js`, `scripts/with-lock.js`, `scripts/__tests__/`      |
| MODIFY (separate PR in mlmail) | `package.json`, `app/package.json`                                       |

---

### Task 1: `runStandardCoverage` wrapper

**Files:**

- Create: `npm/scripts/lib/run-standard-coverage.mjs`
- Create: `npm/scripts/lib/tests/run-standard-coverage.test.mjs`

- [ ] **Step 1: Write the failing test**

`npm/scripts/lib/tests/run-standard-coverage.test.mjs`:

```js
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runStandardCoverage } from '../run-standard-coverage.mjs'

describe('runStandardCoverage', () => {
  it('викликає stepsFn і повертає код виходу', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'rsc-test-'))
    try {
      let called = 0
      const code = await runStandardCoverage(
        () => {
          called++
          return 0
        },
        { cacheDir, getFingerprint: () => null }
      )
      expect(code).toBe(0)
      expect(called).toBe(1)
    } finally {
      rmSync(cacheDir, { recursive: true, force: true })
    }
  })

  it('дедуплікує другий виклик при збігу fingerprint у межах TTL', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'rsc-dedup-'))
    try {
      let called = 0
      const opts = { cacheDir, ttl: 60_000, getFingerprint: () => 'a'.repeat(64) }
      await runStandardCoverage(() => {
        called++
        return 0
      }, opts)
      await runStandardCoverage(() => {
        called++
        return 0
      }, opts)
      expect(called).toBe(1)
    } finally {
      rmSync(cacheDir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test scripts/lib/tests/run-standard-coverage.test.mjs
```

Expected: FAIL — `Cannot find module '../run-standard-coverage.mjs'`

- [ ] **Step 3: Write implementation**

`npm/scripts/lib/run-standard-coverage.mjs`:

```js
import { withLock } from '../utils/with-lock.mjs'

/**
 * Спільна точка входу для `n-cursor coverage`.
 * Дзеркально до `runStandardLint` / `runStandardRule`: серіалізує + дедуплікує
 * запуски через `withLock('coverage')`. Ключ константа — оркестратор один.
 * @param {() => number | Promise<number>} stepsFn
 * @param {object} [opts]
 * @returns {Promise<number>}
 */
export function runStandardCoverage(stepsFn, opts) {
  return withLock('coverage', stepsFn, opts)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test scripts/lib/tests/run-standard-coverage.test.mjs
```

Expected: PASS (2 tests)

---

### Task 2: Rego policy для `scripts.coverage`

**Files:**

- Create: `npm/rules/test/policy/package_json/target.json`
- Create: `npm/rules/test/policy/package_json/template/package.json.contains.json`
- Create: `npm/rules/test/policy/package_json/package_json.rego`
- Create: `npm/rules/test/policy/package_json/package_json_test.rego`

- [ ] **Step 1: Створити директорії та файли template і target**

`npm/rules/test/policy/package_json/target.json`:

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/target.json",
  "files": { "single": "package.json", "required": true },
  "missingMessage": "package.json не знайдено — створи з канонічним scripts.coverage (test.mdc)"
}
```

`npm/rules/test/policy/package_json/template/package.json.contains.json`:

```json
{
  "scripts": {
    "coverage": ["n-cursor coverage"]
  }
}
```

- [ ] **Step 2: Написати failing rego-тести**

`npm/rules/test/policy/package_json/package_json_test.rego`:

```rego
package test.package_json_test

import data.test.package_json
import rego.v1

template_data := {"contains": {"scripts": {"coverage": ["n-cursor coverage"]}}}

valid_pkg := {"scripts": {"coverage": "n-cursor coverage"}}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_deny_missing_coverage_script if {
	bad := {}
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_wrong_coverage_value if {
	bad := {"scripts": {"coverage": "echo nope"}}
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

# Drift test: підміна data.template веде перевірку.
test_data_template_drives_coverage if {
	some msg in package_json.deny with input as valid_pkg
		with data.template as {"contains": {"scripts": {"coverage": ["custom-runner coverage"]}}}
	contains(msg, "custom-runner coverage")
}
```

- [ ] **Step 3: Запустити rego-тести (мають впасти)**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx conftest verify -p rules/test/policy/package_json
```

Expected: FAIL — `test.package_json` не існує

- [ ] **Step 4: Написати rego-правило**

`npm/rules/test/policy/package_json/package_json.rego`:

```rego
# Перевірка `package.json` (test.mdc).
#
# Канон надходить через --data: { "template": { "contains": ... } }
# Структура --data сформована з template/package.json.contains.json.
# Перевіряємо substring-вимоги до scripts.coverage.
package test.package_json

import rego.v1

deny contains msg if {
	some script_name, needles in data.template.contains.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	some needle in needles
	not contains(actual, needle)
	msg := sprintf("package.json: scripts.%s має містити %q (test.mdc)", [script_name, needle])
}
```

- [ ] **Step 5: Запустити rego-тести (мають пройти)**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx conftest verify -p rules/test/policy/package_json
```

Expected:

```
PASS - 4 tests passed, 0 tests failed
```

---

### Task 3: Оркестратор `test/coverage/coverage.mjs`

**Files:**

- Create: `npm/rules/test/coverage/coverage.mjs`
- Create: `npm/rules/test/coverage/tests/coverage.test.mjs`

- [ ] **Step 1: Write the failing test**

`npm/rules/test/coverage/tests/coverage.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addCoverage, addMutation, buildTotalsRow, formatCoverage, formatScore, renderMarkdown } from '../coverage.mjs'

// ── pure functions ──────────────────────────────────────────────────────────

describe('addCoverage', () => {
  it('суммує covered і total', () => {
    const a = { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } }
    const b = { lines: { covered: 30, total: 40 }, functions: { covered: 15, total: 20 } }
    expect(addCoverage(a, b)).toEqual({
      lines: { covered: 40, total: 60 },
      functions: { covered: 20, total: 30 }
    })
  })
})

describe('addMutation', () => {
  it('суммує caught і total', () => {
    expect(addMutation({ caught: 3, total: 5 }, { caught: 7, total: 10 })).toEqual({ caught: 10, total: 15 })
  })
})

describe('formatCoverage', () => {
  it('форматує відсоток і дроби', () => {
    expect(formatCoverage({ covered: 1, total: 2 })).toBe('50.00% (1/2)')
  })

  it('повертає тире якщо total=0', () => {
    expect(formatCoverage({ covered: 0, total: 0 })).toBe('— (0/0)')
  })
})

describe('formatScore', () => {
  it('форматує відсоток', () => {
    expect(formatScore({ caught: 3, total: 4 })).toBe('75.00%')
  })

  it('повертає тире якщо total=0', () => {
    expect(formatScore({ caught: 0, total: 0 })).toBe('—')
  })
})

describe('buildTotalsRow', () => {
  it('агрегує кілька рядків у "Разом"', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 }
      },
      {
        area: 'Rust',
        coverage: { lines: { covered: 30, total: 40 }, functions: { covered: 15, total: 20 } },
        mutation: { caught: 7, total: 10 }
      }
    ]
    const total = buildTotalsRow(rows)
    expect(total.area).toBe('**Разом**')
    expect(total.coverage.lines).toEqual({ covered: 40, total: 60 })
    expect(total.mutation).toEqual({ caught: 10, total: 15 })
  })
})

describe('renderMarkdown', () => {
  it('повертає markdown-таблицю з заголовком Coverage', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 80, total: 100 }, functions: { covered: 40, total: 50 } },
        mutation: { caught: 8, total: 10 }
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).toContain('# Coverage')
    expect(md).toContain('80.00% (80/100)')
    expect(md).toContain('80.00%')
    expect(md).toContain('| JS |')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test rules/test/coverage/tests/coverage.test.mjs
```

Expected: FAIL — `Cannot find module '../coverage.mjs'`

- [ ] **Step 3: Write implementation**

`npm/rules/test/coverage/coverage.mjs`:

```js
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { runStandardCoverage } from '../../../scripts/lib/run-standard-coverage.mjs'

// .../npm/rules/test/coverage/coverage.mjs → 3 рівні вгору → .../npm/rules/
const RULES_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/**
 * @typedef {object} CoverageRow
 * @property {string} area
 * @property {{lines:{covered:number,total:number},functions:{covered:number,total:number}}} coverage
 * @property {{caught:number,total:number}} mutation
 */

/** @param {{lines:{covered:number,total:number},functions:{covered:number,total:number}}} a @param {{lines:{covered:number,total:number},functions:{covered:number,total:number}}} b */
export function addCoverage(a, b) {
  return {
    lines: { covered: a.lines.covered + b.lines.covered, total: a.lines.total + b.lines.total },
    functions: { covered: a.functions.covered + b.functions.covered, total: a.functions.total + b.functions.total }
  }
}

/** @param {{caught:number,total:number}} a @param {{caught:number,total:number}} b */
export function addMutation(a, b) {
  return { caught: a.caught + b.caught, total: a.total + b.total }
}

/** @param {{covered:number,total:number}} metric */
export function formatCoverage({ covered, total }) {
  const percent = total === 0 ? '—' : `${((covered / total) * 100).toFixed(2)}%`
  return `${percent} (${covered}/${total})`
}

/** @param {{caught:number,total:number}} metric */
export function formatScore({ caught, total }) {
  return total === 0 ? '—' : `${((caught / total) * 100).toFixed(2)}%`
}

/** @param {CoverageRow[]} rows @returns {CoverageRow} */
export function buildTotalsRow(rows) {
  const zeroCov = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
  const zeroMut = { caught: 0, total: 0 }
  return {
    area: '**Разом**',
    coverage: rows.reduce((acc, r) => addCoverage(acc, r.coverage), zeroCov),
    mutation: rows.reduce((acc, r) => addMutation(acc, r.mutation), zeroMut)
  }
}

/** @param {CoverageRow[]} rows @returns {string} */
export function renderMarkdown(rows) {
  const lines = [
    '# Coverage',
    '',
    '| Область | Рядки | Функції | Вбито мутацій | Score |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const row of rows) {
    lines.push(
      `| ${row.area} | ${formatCoverage(row.coverage.lines)} | ${formatCoverage(row.coverage.functions)} | ` +
        `${row.mutation.caught}/${row.mutation.total} | ${formatScore(row.mutation)} |`
    )
  }
  return `${lines.join('\n')}\n`
}

async function loadProvider(ruleId) {
  const providerPath = join(RULES_DIR, ruleId, 'coverage', 'coverage.mjs')
  if (!existsSync(providerPath)) return null
  return import(providerPath)
}

async function runCoverageSteps() {
  const cwd = process.cwd()
  const config = await readNCursorConfigLite(cwd)
  /** @type {CoverageRow[]} */
  const rows = []

  for (const ruleId of config.rules) {
    const provider = await loadProvider(ruleId)
    if (!provider) continue
    if (!(await provider.detect(cwd))) continue
    console.log(`→ ${ruleId} coverage…`)
    rows.push(...(await provider.collect(cwd)))
  }

  if (rows.length === 0) {
    console.error('✗ Жодного провайдера покриття не знайдено для активних правил у .n-cursor.json')
    return 1
  }

  rows.push(buildTotalsRow(rows))
  await writeFile(join(cwd, 'COVERAGE.md'), renderMarkdown(rows), 'utf8')
  console.log('✓ COVERAGE.md')
  return 0
}

export const runCoverageCli = () => runStandardCoverage(runCoverageSteps)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test rules/test/coverage/tests/coverage.test.mjs
```

Expected: PASS (6 tests)

---

### Task 4: JS-провайдер `js-lint/coverage/coverage.mjs`

**Files:**

- Create: `npm/rules/js-lint/coverage/coverage.mjs`
- Create: `npm/rules/js-lint/coverage/tests/coverage.test.mjs`

- [ ] **Step 1: Write the failing test**

`npm/rules/js-lint/coverage/tests/coverage.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseLcov } from '../coverage.mjs'
import { detect } from '../coverage.mjs'

// ── parseLcov unit tests ────────────────────────────────────────────────────

describe('parseLcov', () => {
  it('парсить стандартний lcov.info', () => {
    const lcov = [
      'SF:src/foo.js',
      'FN:1,foo',
      'FNDA:1,foo',
      'FNF:1',
      'FNH:1',
      'DA:1,1',
      'DA:2,0',
      'LF:2',
      'LH:1',
      'end_of_record'
    ].join('\n')
    const result = parseLcov(lcov)
    expect(result.lines).toEqual({ covered: 1, total: 2 })
    expect(result.functions).toEqual({ covered: 1, total: 1 })
  })

  it('агрегує кілька SF-записів', () => {
    const lcov = [
      'SF:a.js',
      'LF:10',
      'LH:8',
      'FNF:5',
      'FNH:4',
      'end_of_record',
      'SF:b.js',
      'LF:20',
      'LH:15',
      'FNF:10',
      'FNH:8',
      'end_of_record'
    ].join('\n')
    const result = parseLcov(lcov)
    expect(result.lines).toEqual({ covered: 23, total: 30 })
    expect(result.functions).toEqual({ covered: 12, total: 15 })
  })

  it('повертає нулі для пустого lcov', () => {
    const result = parseLcov('')
    expect(result.lines).toEqual({ covered: 0, total: 0 })
    expect(result.functions).toEqual({ covered: 0, total: 0 })
  })
})

// ── detect unit tests ───────────────────────────────────────────────────────

describe('detect', () => {
  let tmpRoot

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'jscov-detect-'))
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('true коли workspace[0]/package.json має scripts.test:coverage', async () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({
        workspaces: ['app']
      })
    )
    mkdirSync(join(tmpRoot, 'app'))
    writeFileSync(
      join(tmpRoot, 'app', 'package.json'),
      JSON.stringify({
        scripts: { 'test:coverage': 'bun test --coverage' }
      })
    )
    expect(await detect(tmpRoot)).toBe(true)
  })

  it('true коли cwd/package.json має scripts.test:coverage (single-package)', async () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({
        scripts: { 'test:coverage': 'bun test --coverage' }
      })
    )
    expect(await detect(tmpRoot)).toBe(true)
  })

  it('false коли package.json відсутній', async () => {
    expect(await detect(tmpRoot)).toBe(false)
  })

  it('false коли scripts.test:coverage відсутній', async () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({
        scripts: { test: 'bun test' }
      })
    )
    expect(await detect(tmpRoot)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test rules/js-lint/coverage/tests/coverage.test.mjs
```

Expected: FAIL — `Cannot find module '../coverage.mjs'`

- [ ] **Step 3: Write implementation**

`npm/rules/js-lint/coverage/coverage.mjs`:

```js
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Парсить lcov.info і агрегує counts усіх записів.
 * @param {string} text
 * @returns {{lines:{covered:number,total:number},functions:{covered:number,total:number}}}
 */
export function parseLcov(text) {
  const acc = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
  for (const line of text.split('\n')) {
    if (line.startsWith('LF:')) acc.lines.total += Number(line.slice(3))
    else if (line.startsWith('LH:')) acc.lines.covered += Number(line.slice(3))
    else if (line.startsWith('FNF:')) acc.functions.total += Number(line.slice(4))
    else if (line.startsWith('FNH:')) acc.functions.covered += Number(line.slice(4))
  }
  return acc
}

/**
 * Резолвить кореневий каталог JS-пакету.
 * Якщо cwd/package.json має `workspaces` — повертає перший workspace.
 * @param {string} cwd
 * @returns {Promise<string|null>}
 */
async function resolveJsRoot(cwd) {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return null
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  if (Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0) {
    return join(cwd, pkg.workspaces[0])
  }
  return cwd
}

/**
 * Чи провайдер застосовний: jsRoot/package.json має scripts.test:coverage.
 * @param {string} cwd
 * @returns {Promise<boolean>}
 */
export async function detect(cwd) {
  const jsRoot = await resolveJsRoot(cwd)
  if (!jsRoot) return false
  const pkgPath = join(jsRoot, 'package.json')
  if (!existsSync(pkgPath)) return false
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  return Boolean(pkg?.scripts?.['test:coverage'])
}

async function collectJsCoverage(jsRoot) {
  const dir = await mkdtemp(join(tmpdir(), 'ncursor-jscov-'))
  try {
    const proc = Bun.spawn(['bun', 'run', 'test:coverage', '--coverage-reporter=lcov', `--coverage-dir=${dir}`], {
      cwd: jsRoot,
      stdout: 'inherit',
      stderr: 'inherit'
    })
    const code = await proc.exited
    if (code !== 0) throw new Error(`JS coverage run failed (exit ${code})`)
    return parseLcov(await readFile(join(dir, 'lcov.info'), 'utf8'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function collectJsMutation(jsRoot) {
  await rm(join(jsRoot, 'reports', 'stryker', '.tmp'), { recursive: true, force: true })
  const proc = Bun.spawn(['bunx', 'stryker', 'run'], { cwd: jsRoot, stdout: 'inherit', stderr: 'inherit' })
  await proc.exited

  let report
  try {
    report = JSON.parse(await readFile(join(jsRoot, 'reports', 'stryker', 'mutation.json'), 'utf8'))
  } catch {
    throw new Error(`Stryker produced no mutation.json — check ${jsRoot}/stryker.config.mjs`)
  }

  let caught = 0
  let total = 0
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') {
        caught += 1
        total += 1
      } else if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') {
        total += 1
      }
    }
  }
  return { caught, total }
}

/**
 * @param {string} cwd
 * @returns {Promise<import('../../test/coverage/coverage.mjs').CoverageRow[]>}
 */
export async function collect(cwd) {
  const jsRoot = await resolveJsRoot(cwd)
  const coverage = await collectJsCoverage(jsRoot)
  const mutation = await collectJsMutation(jsRoot)
  return [{ area: 'JS', coverage, mutation }]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test rules/js-lint/coverage/tests/coverage.test.mjs
```

Expected: PASS (6 tests: 3 parseLcov + 4 detect)

---

### Task 5: Rust-провайдер `rust/coverage/coverage.mjs`

**Files:**

- Create: `npm/rules/rust/coverage/coverage.mjs`
- Create: `npm/rules/rust/coverage/tests/coverage.test.mjs`

- [ ] **Step 1: Write the failing test**

`npm/rules/rust/coverage/tests/coverage.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detect, parseLlvmCovJson, parseMutantsOutcomes } from '../coverage.mjs'

// ── parseLlvmCovJson unit tests ─────────────────────────────────────────────

describe('parseLlvmCovJson', () => {
  it('витягує lines і functions з cargo-llvm-cov JSON', () => {
    const json = {
      data: [
        {
          totals: {
            lines: { covered: 80, count: 100 },
            functions: { covered: 40, count: 50 }
          }
        }
      ]
    }
    const result = parseLlvmCovJson(json)
    expect(result.lines).toEqual({ covered: 80, total: 100 })
    expect(result.functions).toEqual({ covered: 40, total: 50 })
  })
})

// ── parseMutantsOutcomes unit tests ─────────────────────────────────────────

describe('parseMutantsOutcomes', () => {
  it('рахує caught = caught + timeout', () => {
    const outcomes = { caught: 5, timeout: 2, missed: 3 }
    const result = parseMutantsOutcomes(outcomes)
    expect(result.caught).toBe(7)
    expect(result.total).toBe(10)
  })

  it('нулі для пустих outcomes', () => {
    expect(parseMutantsOutcomes({ caught: 0, timeout: 0, missed: 0 })).toEqual({ caught: 0, total: 0 })
  })
})

// ── detect unit tests ───────────────────────────────────────────────────────

describe('detect', () => {
  let tmpRoot

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'rustcov-detect-'))
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('true коли Cargo.toml у cwd', async () => {
    writeFileSync(join(tmpRoot, 'Cargo.toml'), '[package]\nname="x"\n')
    expect(await detect(tmpRoot)).toBe(true)
  })

  it('true коли Cargo.toml у workspace-підкаталозі', async () => {
    mkdirSync(join(tmpRoot, 'src-tauri'))
    writeFileSync(join(tmpRoot, 'src-tauri', 'Cargo.toml'), '[package]\nname="x"\n')
    expect(await detect(tmpRoot)).toBe(true)
  })

  it('false коли Cargo.toml відсутній', async () => {
    expect(await detect(tmpRoot)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test rules/rust/coverage/tests/coverage.test.mjs
```

Expected: FAIL — `Cannot find module '../coverage.mjs'`

- [ ] **Step 3: Write implementation**

`npm/rules/rust/coverage/coverage.mjs`:

```js
import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hasCargoTomlInTree } from '../lib/has-cargo-toml.mjs'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo'])

/**
 * @param {object} json cargo-llvm-cov --json --summary-only вивід
 * @returns {{lines:{covered:number,total:number},functions:{covered:number,total:number}}}
 */
export function parseLlvmCovJson(json) {
  const totals = json.data[0].totals
  return {
    lines: { covered: totals.lines.covered, total: totals.lines.count },
    functions: { covered: totals.functions.covered, total: totals.functions.count }
  }
}

/**
 * @param {{caught:number,timeout:number,missed:number}} outcomes cargo-mutants outcomes.json
 * @returns {{caught:number,total:number}}
 */
export function parseMutantsOutcomes(outcomes) {
  const caught = outcomes.caught + outcomes.timeout
  return { caught, total: caught + outcomes.missed }
}

function findFirstCargoToml(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry.name)) continue
    if (entry.isFile() && entry.name === 'Cargo.toml') return join(dir, 'Cargo.toml')
    if (entry.isDirectory()) {
      const found = findFirstCargoToml(join(dir, entry.name))
      if (found) return found
    }
  }
  return null
}

function resolveCargoToml(cwd) {
  if (existsSync(join(cwd, 'Cargo.toml'))) return join(cwd, 'Cargo.toml')
  return findFirstCargoToml(cwd)
}

/**
 * @param {string} cwd
 * @returns {Promise<boolean>}
 */
export async function detect(cwd) {
  if (existsSync(join(cwd, 'Cargo.toml'))) return true
  return hasCargoTomlInTree(cwd, IGNORED_DIR_NAMES)
}

async function collectRustCoverage(cargoToml) {
  const proc = Bun.spawn(['cargo', 'llvm-cov', '--manifest-path', cargoToml, '--json', '--summary-only'], {
    stdout: 'pipe',
    stderr: 'inherit'
  })
  const stdout = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) {
    throw new Error('Rust coverage failed — install: `cargo install cargo-llvm-cov`')
  }
  return parseLlvmCovJson(JSON.parse(stdout))
}

async function collectRustMutation(cargoToml) {
  const outDir = await mkdtemp(join(tmpdir(), 'cargo-mutants-'))
  try {
    const proc = Bun.spawn(['cargo', 'mutants', '--in-place', '-o', outDir, '--manifest-path', cargoToml], {
      stdout: 'inherit',
      stderr: 'inherit'
    })
    await proc.exited

    const outcomesPath = join(outDir, 'mutants.out', 'outcomes.json')
    if (!existsSync(outcomesPath)) {
      throw new Error('cargo mutants produced no outcomes.json — install: `cargo install cargo-mutants`')
    }
    const outcomes = JSON.parse(await readFile(outcomesPath, 'utf8'))
    return parseMutantsOutcomes(outcomes)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

/**
 * @param {string} cwd
 * @returns {Promise<import('../../test/coverage/coverage.mjs').CoverageRow[]>}
 */
export async function collect(cwd) {
  const cargoToml = resolveCargoToml(cwd)
  if (!cargoToml) throw new Error('Cargo.toml не знайдено — detect() мав повернути false')
  const coverage = await collectRustCoverage(cargoToml)
  const mutation = await collectRustMutation(cargoToml)
  return [{ area: 'Rust', coverage, mutation }]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test rules/rust/coverage/tests/coverage.test.mjs
```

Expected: PASS (5 tests)

---

### Task 6: Оновити `.mdc` файли

**Files:**

- Modify: `npm/rules/test/test.mdc`
- Modify: `npm/rules/js-lint/js-lint.mdc`
- Modify: `npm/rules/rust/rust.mdc`

- [ ] **Step 1: Додати секцію в `test.mdc`**

Відкрий `npm/rules/test/test.mdc`. В кінці файлу, після секції «Що перевіряє правило», додай:

```markdown
## Покриття + мутаційне тестування

Канонічна команда — `n-cursor coverage`: збирає метрики покриття (`bun test --coverage`, `cargo llvm-cov` тощо) і мутаційного тестування (Stryker, `cargo-mutants`) з усіх активних провайдерів у `.n-cursor.json#rules` і пише `COVERAGE.md` у корінь проєкту. Лок і дедуп — через `runStandardCoverage` (`withLock('coverage')`).

Провайдери живуть у `npm/rules/<rule>/coverage/coverage.mjs` (постачаються правилами мови/рантайму: `js-lint`, `rust`, у майбутньому `python` тощо). Оркестратор — у `npm/rules/test/coverage/coverage.mjs`.

У кожному `package.json` (корінь) має бути:

Канон `scripts.coverage` (substring requirement): [package.json.contains.json](./policy/package_json/template/package.json.contains.json)
```

- [ ] **Step 2: Додати абзац у `js-lint.mdc`**

Відкрий `npm/rules/js-lint/js-lint.mdc`. В кінці файлу (після секції «Тести») додай:

```markdown
## Покриття

Покриття + мутаційне тестування JS постачаються через `n-cursor coverage` (правило `test.mdc`). Реалізація провайдера — у `npm/rules/js-lint/coverage/coverage.mjs`: `bun test --coverage --coverage-reporter=lcov` + `bunx stryker run`.
```

- [ ] **Step 3: Додати абзац у `rust.mdc`**

Відкрий `npm/rules/rust/rust.mdc`. В кінці файлу (після секції «Композиція з Tauri») додай:

```markdown
## Покриття

Покриття + мутаційне тестування Rust постачаються через `n-cursor coverage` (правило `test.mdc`). Реалізація провайдера — у `npm/rules/rust/coverage/coverage.mjs`: `cargo llvm-cov --json --summary-only` + `cargo mutants --in-place`. Бінарники: `cargo install cargo-llvm-cov && cargo install cargo-mutants`.
```

- [ ] **Step 4: Перевірити що markdown-лінки в mdc файлах ведуть на існуючі файли**

```bash
ls /Users/vitaliytv/www/nitra/cursor/npm/rules/test/policy/package_json/template/package.json.contains.json
```

Expected: файл існує (лінк у `test.mdc` веде на правильний шлях).

---

### Task 7: CLI інтеграція

**Files:**

- Modify: `npm/bin/n-cursor.js`

- [ ] **Step 1: Додати `case 'coverage'` у `n-cursor.js`**

Відкрий `npm/bin/n-cursor.js`. Знайди блок `case 'lint-text':` (рядок ~1280). Додай новий `case` безпосередньо перед ним:

```js
case 'coverage': {
  // Канонічний n-cursor coverage: збирає покриття + мутаційне тестування
  // з усіх провайдерів активних у .n-cursor.json#rules (test.mdc).
  const { runCoverageCli } = await import('../rules/test/coverage/coverage.mjs')
  process.exitCode = await runCoverageCli()
  break
}
```

- [ ] **Step 2: Оновити рядок help в `default` case**

Знайди рядок (близько рядка 1300):

```
`   Очікується: (без аргументів) синхронізація правил, check, rename-yaml-extensions, stop-hook, lint-ga, lint-rego, lint-k8s, lint-docker, lint-text, skill`
```

Додай `coverage,` у список:

```
`   Очікується: (без аргументів) синхронізація правил, check, rename-yaml-extensions, stop-hook, coverage, lint-ga, lint-rego, lint-k8s, lint-docker, lint-text, skill`
```

- [ ] **Step 3: Перевірити що команда резолвиться**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && node bin/n-cursor.js unknown-command 2>&1
```

Expected: рядок `Очікується:` містить `coverage`

---

### Task 8: Фінальні перевірки і version bump

**Files:**

- Modify: `npm/package.json`
- Modify: `npm/CHANGELOG.md`

- [ ] **Step 1: Запустити всі тести**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test
```

Expected: всі тести PASS, 0 failures. Переконайся що нові тести (`run-standard-coverage`, `coverage.mjs` × 3) є у виводі.

- [ ] **Step 2: Запустити lint-rego**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && node bin/n-cursor.js lint-rego 2>&1 | tail -20
```

Expected: зелено (0 violations для нових policy-файлів)

- [ ] **Step 3: Bump version у `npm/package.json`**

Знайди `"version": "1.16.0"` у `npm/package.json` і заміни на:

```json
"version": "1.17.0"
```

- [ ] **Step 4: Додати секцію у `npm/CHANGELOG.md`**

Вставити після першого рядка `# Changelog` (рядок 3, після формату) новий блок:

```markdown
## [1.17.0] — 2026-05-24

### Added

- CLI-команда `n-cursor coverage` — оркестратор покриття + мутаційного тестування. Discovery провайдерів через `.n-cursor.json#rules`: для кожного активного правила підвантажує `npm/rules/<rule>/coverage/coverage.mjs` якщо файл існує.
- Провайдер `js-lint`: `bun test --coverage --coverage-reporter=lcov` + `bunx stryker run`. Резолвить JS-корінь через `package.json#workspaces[0]` або `cwd`.
- Провайдер `rust`: `cargo llvm-cov --json --summary-only` + `cargo mutants --in-place`. Резолвить `Cargo.toml` у `cwd` або workspace-підкаталозі.
- `runStandardCoverage(stepsFn, opts)` у `npm/scripts/lib/` — спільна точка входу з `withLock('coverage')`.
- Rego-policy `test.package_json` для канону `scripts.coverage = "n-cursor coverage"` у кореневому `package.json`.
```

- [ ] **Step 5: Перевірити changelog через check**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && node bin/n-cursor.js check changelog 2>&1
```

Expected: PASS (нова секція `[1.17.0]` відповідає format-вимогам changelog.mdc)

---

### Task 9: mlmail cleanup (окрема PR — виконувати після публікації `@nitra/cursor@1.17.0`)

**Files:**

- Delete: `scripts/coverage.js`
- Delete: `scripts/with-lock.js`
- Delete: `scripts/__tests__/` (якщо там немає unrelated тестів — перевір перед видаленням)
- Modify: `package.json`
- Modify: `app/package.json`

- [ ] **Step 1: Перевірити чи `scripts/__tests__/` містить лише тести coverage/with-lock**

```bash
ls /Users/vitaliytv/www/vitaliytv/mlmail/scripts/__tests__/
```

Якщо є тести, не пов'язані з coverage/with-lock — перенеси їх у `scripts/tests/` (конвенція `test.mdc`). Далі видаляй лише файли coverage і with-lock.

- [ ] **Step 2: Bumрнути `@nitra/cursor` до 1.17.0 у mlmail**

```bash
cd /Users/vitaliytv/www/vitaliytv/mlmail && bun add -D @nitra/cursor@1.17.0
```

Expected: `package.json` і `bun.lock` оновлено.

- [ ] **Step 3: Видалити старі скрипти**

```bash
rm /Users/vitaliytv/www/vitaliytv/mlmail/scripts/coverage.js
rm /Users/vitaliytv/www/vitaliytv/mlmail/scripts/with-lock.js
rm -rf /Users/vitaliytv/www/vitaliytv/mlmail/scripts/__tests__/
```

- [ ] **Step 4: Оновити кореневий `package.json`**

Знайди у `/Users/vitaliytv/www/vitaliytv/mlmail/package.json`:

```json
"coverage": "bun scripts/with-lock.js bun scripts/coverage.js",
```

і замін на:

```json
"coverage": "n-cursor coverage",
```

Також знайди і видали:

```json
"test:scripts": "bun test scripts/__tests__",
```

- [ ] **Step 5: Оновити `app/package.json`**

Знайди у `/Users/vitaliytv/www/vitaliytv/mlmail/app/package.json` і видали обидва рядки:

```json
"test:mutation": "bun ../scripts/with-lock.js bunx stryker run",
"test:rust:mutation": "bun ../scripts/with-lock.js cargo mutants --in-place -o /tmp/cargo-mutants-out --manifest-path src-tauri/Cargo.toml",
```

- [ ] **Step 6: Додати `test` у `.n-cursor.json#rules` (опційно, але рекомендовано)**

Щоб `npx @nitra/cursor fix` також перевіряв канон `scripts.coverage`:

У `/Users/vitaliytv/www/vitaliytv/mlmail/.n-cursor.json` додай `"test"` у масив `rules`.

- [ ] **Step 7: Верифікувати `bun run coverage`**

```bash
cd /Users/vitaliytv/www/vitaliytv/mlmail && bun run coverage
```

Expected: виконання аналогічне до старого скрипту — COVERAGE.md записується у корінь, формат ідентичний (порівняй з `git diff COVERAGE.md`).

- [ ] **Step 8: Запустити весь лінт mlmail**

```bash
cd /Users/vitaliytv/www/vitaliytv/mlmail && bun run lint
```

Expected: зелено (без нових порушень).
