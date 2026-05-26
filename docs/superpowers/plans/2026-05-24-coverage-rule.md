# `n-cursor coverage` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести coverage-агрегатор mail app (JS + Rust покриття + мутаційне тестування) у `@nitra/cursor` як канонічну CLI-команду `n-cursor coverage` із per-rule провайдерами, discovery через `.n-cursor.json#rules` і інтринсивним `withLock`-серіалізатором. Видалити локальні `scripts/coverage.js` + `with-lock.js` з mail app.

**Architecture:** Оркестратор `npm/rules/test/coverage/coverage.mjs` ітерує `.n-cursor.json#rules`, динамічно імпортує `npm/rules/<ruleId>/coverage/coverage.mjs` для кожного активного правила, викликає провайдерську пару `detect(cwd)` + `collect(cwd) → CoverageRow[]`, агрегує і пише `COVERAGE.md`. Лок — прямий `withLock('coverage', steps)`. Канон `scripts.coverage` у `package.json` валідується через rego-policy `test.package_json` + template `.contains.json`.

**Tech Stack:** Bun (runtime + test runner), Rego (OPA/conftest для policy), Node.js fs/promises, `withLock` + `worktreeFingerprint` із `scripts/utils/`, `readNCursorConfigLite` із `scripts/lib/`.

**Spec:** [`docs/superpowers/specs/2026-05-24-coverage-rule-design.md`](../specs/2026-05-24-coverage-rule-design.md)

**Залежності:**

- Правило `rust` уже імплементоване в `npm/rules/rust/` — спираємось як на дане.
- `npm/scripts/utils/with-lock.mjs` уже існує (з [`2026-05-22-lint-ga-concurrency-lock-design.md`](../specs/2026-05-22-lint-ga-concurrency-lock-design.md)).
- `scripts/lib/read-n-cursor-config-lite.mjs` — використовуємо для дискавері enabled-правил.

**Commit policy:** За user preference коміти НЕ створюються в межах цього плану. Кожна задача завершується кроком «`git status && git diff` для review» — комітить користувач явним рішенням.

---

## File Structure

### Створюються в `@nitra/cursor`

```
npm/rules/test/
├── coverage/
│   ├── coverage.mjs                                  ← оркестратор
│   └── tests/
│       └── coverage.test.mjs
└── policy/
    └── package_json/
        ├── target.json
        ├── package_json.rego
        ├── package_json_test.rego
        └── template/
            └── package.json.contains.json

npm/rules/js-lint/
└── coverage/
    ├── coverage.mjs                                  ← JS-провайдер
    └── tests/
        └── coverage.test.mjs

npm/rules/rust/
└── coverage/
    ├── coverage.mjs                                  ← Rust-провайдер
    └── tests/
        └── coverage.test.mjs
```

### Модифікуються в `@nitra/cursor`

- `npm/rules/test/test.mdc` — додати секцію «Покриття + мутаційне тестування»
- `npm/rules/js-lint/js-lint.mdc` — додати один параграф із згадкою JS-провайдера
- `npm/rules/rust/rust.mdc` — додати один параграф із згадкою Rust-провайдера
- `npm/bin/n-cursor.js` — додати `case 'coverage'`, розширити help-string
- `npm/package.json` — bump `version` 1.16.0 → 1.17.0
- `npm/CHANGELOG.md` — нова секція `[1.17.0]`

### Видаляються в `mail app` (PR2, після релізу `@nitra/cursor`)

- `scripts/coverage.js`
- `scripts/with-lock.js`
- `scripts/__tests__/` (тести двох видалених скриптів)
- `package.json#scripts.test:scripts`
- `app/package.json#scripts.test:mutation`
- `app/package.json#scripts.test:rust:mutation`

### Модифікуються в `mail app` (PR2)

- `package.json#scripts.coverage`: `"bun scripts/with-lock.js bun scripts/coverage.js"` → `"n-cursor coverage"`

---

## PR1 — `@nitra/cursor`

### Task 1: rego policy `test.package_json` — фікстури й template

**Files:**

- Create: `npm/rules/test/policy/package_json/target.json`
- Create: `npm/rules/test/policy/package_json/template/package.json.contains.json`

- [ ] **Step 1.1: Створити `target.json`**

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/target.json",
  "files": { "single": "package.json", "required": true },
  "missingMessage": "package.json не існує — створи зі scripts.coverage (test.mdc)"
}
```

- [ ] **Step 1.2: Створити `template/package.json.contains.json`**

```json
{
  "scripts": {
    "coverage": ["n-cursor coverage"]
  }
}
```

- [ ] **Step 1.3: Verify через `git status && git diff`**

```bash
cd /Users/vitaliytv/www/nitra/cursor
git status npm/rules/test/policy/
git diff --stat npm/rules/test/policy/
```

Expected: дві нові untracked файли під `npm/rules/test/policy/package_json/`.

---

### Task 2: rego policy `test.package_json` — TDD test → impl

**Files:**

- Create: `npm/rules/test/policy/package_json/package_json_test.rego`
- Create: `npm/rules/test/policy/package_json/package_json.rego`

- [ ] **Step 2.1: Написати `package_json_test.rego` (тестовий контракт)**

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
	bad := json.patch(valid_pkg, [{"op": "remove", "path": "/scripts/coverage"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_wrong_coverage_command if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/coverage", "value": "echo nope"}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "n-cursor coverage")
}

test_allow_extended_coverage_command if {
	# substring-семантика: дозволяємо локальні розширення
	extended := json.patch(valid_pkg, [{
		"op": "replace", "path": "/scripts/coverage",
		"value": "bun run pre-coverage && n-cursor coverage",
	}])
	count(package_json.deny) == 0 with input as extended with data.template as template_data
}

# Drift test: підміна data.template веде перевірку
test_data_template_drives_contains if {
	some msg in package_json.deny with input as valid_pkg
		with data.template as {"contains": {"scripts": {"coverage": ["custom-marker"]}}}
	contains(msg, "custom-marker")
}
```

- [ ] **Step 2.2: Запустити lint-rego — переконатись, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun run lint-rego
```

Expected: FAIL — `package test.package_json` not found (правило `.rego` ще не існує).

- [ ] **Step 2.3: Написати `package_json.rego` (мінімальна реалізація)**

```rego
# Перевірка `package.json` для правила test (test.mdc).
#
# Канон надходить через --data: { "template": { "contains": ... } }
# Структура --data сформована з template/package.json.contains.json.
# Перевіряємо substring-вимоги до scripts.coverage:
# рядок має містити "n-cursor coverage" (локальні розширення дозволені).
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

- [ ] **Step 2.4: Запустити lint-rego — переконатись, що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun run lint-rego
```

Expected: PASS — усі п'ять тестів зелені, regal без warnings.

- [ ] **Step 2.5: Verify через `git status && git diff`**

```bash
cd /Users/vitaliytv/www/nitra/cursor
git status npm/rules/test/policy/
git diff npm/rules/test/policy/
```

---

### Task 3: pure helpers агрегації — TDD

Чисті функції з mail app's `scripts/coverage.js` (`addCoverage`, `addMutation`, `formatCoverage`, `formatScore`, `renderMarkdown`) — переносимо в оркестратор; винесемо на початок файлу для unit-тестування.

**Files:**

- Create: `npm/rules/test/coverage/coverage.mjs` (скелет з чистими функціями)
- Create: `npm/rules/test/coverage/tests/coverage.test.mjs`

- [ ] **Step 3.1: Написати `tests/coverage.test.mjs` для чистих функцій**

```js
/**
 * Тести pure-helper-ів агрегатора покриття: addCoverage, addMutation,
 * formatCoverage, formatScore, renderMarkdown. Перевірки runCoverageSteps
 * додаються в наступних задачах.
 */
import { describe, expect, test } from 'bun:test'

import { addCoverage, addMutation, formatCoverage, formatScore, renderMarkdown } from '../coverage.mjs'

describe('addCoverage', () => {
  test('покомпонентне додавання lines та functions', () => {
    const a = { lines: { covered: 10, total: 20 }, functions: { covered: 3, total: 5 } }
    const b = { lines: { covered: 5, total: 8 }, functions: { covered: 2, total: 4 } }
    expect(addCoverage(a, b)).toEqual({
      lines: { covered: 15, total: 28 },
      functions: { covered: 5, total: 9 }
    })
  })
})

describe('addMutation', () => {
  test('покомпонентне додавання caught та total', () => {
    expect(addMutation({ caught: 4, total: 10 }, { caught: 2, total: 7 })).toEqual({ caught: 6, total: 17 })
  })
})

describe('formatCoverage', () => {
  test('обчислює відсоток і додає (covered/total)', () => {
    expect(formatCoverage({ covered: 50, total: 200 })).toBe('25.00% (50/200)')
  })

  test('total === 0 → прочерк', () => {
    expect(formatCoverage({ covered: 0, total: 0 })).toBe('— (0/0)')
  })
})

describe('formatScore', () => {
  test('обчислює відсоток мутаційного score', () => {
    expect(formatScore({ caught: 7, total: 10 })).toBe('70.00%')
  })

  test('total === 0 → прочерк', () => {
    expect(formatScore({ caught: 0, total: 0 })).toBe('—')
  })
})

describe('renderMarkdown', () => {
  test('рендерить таблицю в українській локалізації', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 50, total: 100 }, functions: { covered: 10, total: 20 } },
        mutation: { caught: 7, total: 10 }
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).toContain('# Coverage')
    expect(md).toContain('| Область | Рядки | Функції | Вбито мутацій | Score |')
    expect(md).toContain('| JS | 50.00% (50/100) | 50.00% (10/20) | 7/10 | 70.00% |')
    expect(md.endsWith('\n')).toBe(true)
  })
})
```

- [ ] **Step 3.2: Створити скелет `coverage.mjs` з чистими функціями (без runCoverageSteps поки)**

```js
/**
 * Канонічна команда `n-cursor coverage`: збирає метрики покриття + мутаційного
 * тестування з усіх провайдерів, чиє правило активне в `.n-cursor.json#rules`,
 * агрегує та записує COVERAGE.md у корінь проєкту.
 *
 * Discovery провайдерів — за `.n-cursor.json#rules`: для кожного `ruleId` зі
 * списку шукаємо `npm/rules/<ruleId>/coverage/coverage.mjs` і динамічно
 * імпортуємо. Якщо файлу немає — провайдер для цього правила відсутній (skip
 * silently, не помилка).
 *
 * Лок — прямий виклик `withLock('coverage', steps)`. Один CLI-консумер, один
 * callsite — спільна точка входу не виноситься (YAGNI, див. C4 у specs/2026-05-24-coverage-rule-design.md).
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { withLock } from '../../../scripts/utils/with-lock.mjs'

/** Корінь `npm/rules/` — `<rules>/test/coverage` → `<rules>` */
const RULES_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/**
 * Сума двох coverage-totals.
 * @param {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} a
 * @param {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} b
 */
export function addCoverage(a, b) {
  return {
    lines: { covered: a.lines.covered + b.lines.covered, total: a.lines.total + b.lines.total },
    functions: {
      covered: a.functions.covered + b.functions.covered,
      total: a.functions.total + b.functions.total
    }
  }
}

/**
 * Сума двох mutation-counts.
 * @param {{caught:number,total:number}} a
 * @param {{caught:number,total:number}} b
 */
export function addMutation(a, b) {
  return { caught: a.caught + b.caught, total: a.total + b.total }
}

/**
 * Форматує covered/total як `XX.XX% (covered/total)`.
 * @param {{covered:number,total:number}} metric
 */
export function formatCoverage({ covered, total }) {
  const percent = total === 0 ? '—' : `${((covered / total) * 100).toFixed(2)}%`
  return `${percent} (${covered}/${total})`
}

/**
 * Форматує мутаційний score як `XX.XX%`.
 * @param {{caught:number,total:number}} metric
 */
export function formatScore({ caught, total }) {
  return total === 0 ? '—' : `${((caught / total) * 100).toFixed(2)}%`
}

/**
 * Рендерить таблицю покриття + мутаційного тестування як Markdown.
 * Без timestamp, щоб git diff рухався лише при зміні метрик.
 * @param {Array<{area:string, coverage:object, mutation:{caught:number,total:number}}>} rows
 */
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
```

- [ ] **Step 3.3: Запустити тести — переконатись що pure-helper-и проходять**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/test/coverage/tests/coverage.test.mjs
```

Expected: PASS — 7 тестів (1 addCoverage, 1 addMutation, 2 formatCoverage, 2 formatScore, 1 renderMarkdown). Імпорт неіснуючих `runCoverageSteps`/`runCoverageCli` ще не використовуються, тому модуль завантажується успішно.

- [ ] **Step 3.4: Verify**

```bash
git status npm/rules/test/coverage/
git diff npm/rules/test/coverage/
```

---

### Task 4: js-lint провайдер — TDD `detect()`

**Files:**

- Create: `npm/rules/js-lint/coverage/coverage.mjs`
- Create: `npm/rules/js-lint/coverage/tests/coverage.test.mjs`

- [ ] **Step 4.1: Написати тест `detect()` — провайдер активується при наявності test:coverage у package.json**

```js
/**
 * Тести JS-coverage-провайдера (js-lint.mdc): detect() читає `package.json`
 * у cwd або workspace, повертає true якщо є `scripts.test:coverage` чи
 * `scripts.test` з прапором --coverage. collect() спавнить bun test + Stryker,
 * парсить lcov і mutation.json — тестується в Task 5.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detect } from '../coverage.mjs'

function makeFixture(pkg, { workspaceRoot = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'js-lint-coverage-detect-'))
  if (workspaceRoot) {
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'] }))
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify(pkg))
  } else {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
  }
  return dir
}

describe('js-lint coverage detect()', () => {
  test('повертає true коли scripts.test:coverage існує в кореневому package.json', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } })
    expect(await detect(dir)).toBe(true)
  })

  test('повертає true коли scripts.test:coverage існує в workspace-пакеті', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } }, { workspaceRoot: true })
    expect(await detect(dir)).toBe(true)
  })

  test('повертає true коли scripts.test містить --coverage', async () => {
    const dir = makeFixture({ scripts: { test: 'bun test --coverage src' } })
    expect(await detect(dir)).toBe(true)
  })

  test('повертає false коли немає coverage-сумісного скрипта', async () => {
    const dir = makeFixture({ scripts: { test: 'bun test src' } })
    expect(await detect(dir)).toBe(false)
  })

  test('повертає false коли немає package.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-lint-coverage-empty-'))
    expect(await detect(dir)).toBe(false)
  })
})
```

- [ ] **Step 4.2: Запустити тест — переконатись, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/js-lint/coverage/tests/coverage.test.mjs
```

Expected: FAIL — `Cannot find module '../coverage.mjs'`.

- [ ] **Step 4.3: Реалізувати `detect()` у `js-lint/coverage/coverage.mjs`**

```js
/**
 * JS-провайдер для `n-cursor coverage`: збирає метрики покриття (`bun test --coverage`)
 * і мутаційного тестування (Stryker) для JS/TS коду. Активується через `js-lint`
 * правило в `.n-cursor.json#rules`; реальна applies-логіка — у `detect(cwd)`.
 *
 * Контракт провайдера — у docs/superpowers/specs/2026-05-24-coverage-rule-design.md.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Резолвить cwd, у якому стоять JS-тести. Workspace-проєкти — перший workspace
 * (mail app: app/), single-package — корінь.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string|null>} абсолютний шлях або null якщо package.json відсутній
 */
async function resolveJsRoot(cwd) {
  const rootPkgPath = join(cwd, 'package.json')
  if (!existsSync(rootPkgPath)) return null
  const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
  const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
  if (workspaces.length > 0) {
    const wsPath = join(cwd, workspaces[0])
    if (existsSync(join(wsPath, 'package.json'))) return wsPath
  }
  return cwd
}

/**
 * Чи `scripts` містить coverage-сумісну команду.
 * @param {Record<string, string> | undefined} scripts
 * @returns {boolean}
 */
function hasCoverageScript(scripts) {
  if (!scripts || typeof scripts !== 'object') return false
  if (typeof scripts['test:coverage'] === 'string' && scripts['test:coverage'].length > 0) return true
  if (typeof scripts.test === 'string' && scripts.test.includes('--coverage')) return true
  return false
}

/**
 * Чи провайдер застосовний у поточному cwd.
 * @param {string} cwd
 * @returns {Promise<boolean>}
 */
export async function detect(cwd) {
  const jsRoot = await resolveJsRoot(cwd)
  if (jsRoot === null) return false
  const pkgPath = join(jsRoot, 'package.json')
  if (!existsSync(pkgPath)) return false
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  return hasCoverageScript(pkg.scripts)
}
```

- [ ] **Step 4.4: Запустити тест — переконатись що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/js-lint/coverage/tests/coverage.test.mjs
```

Expected: PASS — усі 5 тестів зелені.

- [ ] **Step 4.5: Verify**

```bash
git status npm/rules/js-lint/coverage/
git diff npm/rules/js-lint/coverage/
```

---

### Task 5: js-lint провайдер — TDD `collect()` з ін'єкцією spawner-а

`collect()` спавнить `bun test --coverage`, `bunx stryker run`. Щоб тестувати без реального runtime — ін'єктимо `runner` (default: реальний spawn; у тестах — fake).

**Files:**

- Modify: `npm/rules/js-lint/coverage/coverage.mjs`
- Modify: `npm/rules/js-lint/coverage/tests/coverage.test.mjs`

- [ ] **Step 5.1: Додати тести `collect()` з fake runner**

Додати у `tests/coverage.test.mjs` після existing блоку:

```js
import { collect } from '../coverage.mjs'
import { rmSync } from 'node:fs'
import { writeFileSync, mkdirSync } from 'node:fs'

describe('js-lint coverage collect()', () => {
  test('парсить lcov + stryker mutation.json і повертає один CoverageRow', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } })

    // Підготувати fake stryker report (Stryker завжди пише relative to jsRoot)
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(
      join(reportDir, 'mutation.json'),
      JSON.stringify({
        files: {
          'src/a.js': {
            mutants: [
              { status: 'Killed' },
              { status: 'Killed' },
              { status: 'Survived' },
              { status: 'CompileError' } // виключається з total
            ]
          }
        }
      })
    )

    const calls = []
    const runner = {
      // Симулюємо bun run test:coverage: пишемо lcov у temp dir
      async runJsCoverage({ cwd, lcovDir }) {
        calls.push({ kind: 'js', cwd, lcovDir })
        const lcov = ['LF:100', 'LH:50', 'FNF:20', 'FNH:10', ''].join('\n')
        writeFileSync(join(lcovDir, 'lcov.info'), lcov)
        return 0
      },
      async runStryker({ cwd }) {
        calls.push({ kind: 'stryker', cwd })
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(rows).toEqual([
      {
        area: 'JS',
        coverage: { lines: { covered: 50, total: 100 }, functions: { covered: 10, total: 20 } },
        mutation: { caught: 2, total: 3 }
      }
    ])
    expect(calls[0].kind).toBe('js')
    expect(calls[1].kind).toBe('stryker')

    rmSync(dir, { recursive: true, force: true })
  })

  test('падає з explainer-ом якщо коді JS-coverage exit ≠ 0', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } })
    const runner = {
      async runJsCoverage() {
        return 1
      },
      async runStryker() {
        return 0
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(/JS coverage.*exit 1/)
    rmSync(dir, { recursive: true, force: true })
  })

  test('падає якщо Stryker не залишив mutation.json', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } })
    const runner = {
      async runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:0\nLH:0\nFNF:0\nFNH:0\n')
        return 0
      },
      async runStryker() {
        return 0
      }
    }
    // Без створення reports/stryker/mutation.json
    await expect(collect(dir, { runner })).rejects.toThrow(/mutation\.json/)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 5.2: Запустити — переконатись, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/js-lint/coverage/tests/coverage.test.mjs
```

Expected: FAIL — `collect` не експортовано.

- [ ] **Step 5.3: Реалізувати `collect()` у `js-lint/coverage/coverage.mjs`**

Додати в `coverage.mjs` після `detect()`:

```js
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

/**
 * Парс lcov.info: сумує LF/LH (рядки) і FNF/FNH (функції) по всіх records.
 * @param {string} text
 * @returns {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}}
 */
function parseLcov(text) {
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
 * Парс Stryker mutation.json: Killed+Timeout → caught; Survived+NoCoverage → до total.
 * Compile/Runtime errors виключаються з total.
 * @param {{files:Record<string,{mutants:Array<{status:string}>}>}} report
 * @returns {{caught:number,total:number}}
 */
function parseStrykerReport(report) {
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
 * Default runner — спавнить реальні bun-команди. Замінюється у тестах.
 */
const defaultRunner = {
  async runJsCoverage({ cwd, lcovDir }) {
    const proc = Bun.spawn(['bun', 'run', 'test:coverage', '--coverage-reporter=lcov', `--coverage-dir=${lcovDir}`], {
      cwd,
      stdout: 'inherit',
      stderr: 'inherit'
    })
    return proc.exited
  },
  async runStryker({ cwd }) {
    const proc = Bun.spawn(['bunx', 'stryker', 'run'], { cwd, stdout: 'inherit', stderr: 'inherit' })
    return proc.exited
  }
}

/**
 * Збирає JS-метрики покриття + мутаційного тестування.
 * @param {string} cwd корінь проєкту
 * @param {{runner?: typeof defaultRunner}} [opts] runner-ін'єкція для тестів
 * @returns {Promise<Array<{area:string, coverage:object, mutation:{caught:number,total:number}}>>}
 */
export async function collect(cwd, opts = {}) {
  const runner = opts.runner ?? defaultRunner
  const jsRoot = await resolveJsRoot(cwd)
  if (jsRoot === null) throw new Error('js-lint coverage: package.json не знайдено')

  // 1. Coverage через bun test --coverage
  const lcovDir = await mkdtemp(join(tmpdir(), 'js-lint-cov-'))
  let coverage
  try {
    const code = await runner.runJsCoverage({ cwd: jsRoot, lcovDir })
    if (code !== 0) throw new Error(`JS coverage exit ${code}`)
    coverage = parseLcov(await readFile(join(lcovDir, 'lcov.info'), 'utf8'))
  } finally {
    await rm(lcovDir, { recursive: true, force: true })
  }

  // 2. Mutation через Stryker
  await runner.runStryker({ cwd: jsRoot })
  let mutationReport
  try {
    mutationReport = JSON.parse(await readFile(join(jsRoot, 'reports', 'stryker', 'mutation.json'), 'utf8'))
  } catch {
    throw new Error('js-lint coverage: stryker не залишив mutation.json — перевір stryker.config.mjs у проєкті')
  }
  const mutation = parseStrykerReport(mutationReport)

  return [{ area: 'JS', coverage, mutation }]
}
```

- [ ] **Step 5.4: Запустити — переконатись що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/js-lint/coverage/tests/coverage.test.mjs
```

Expected: PASS — усі 8 тестів зелені (5 detect + 3 collect).

- [ ] **Step 5.5: Verify**

```bash
git status npm/rules/js-lint/coverage/
git diff npm/rules/js-lint/coverage/
```

---

### Task 6: rust провайдер — TDD `detect()`

**Files:**

- Create: `npm/rules/rust/coverage/coverage.mjs`
- Create: `npm/rules/rust/coverage/tests/coverage.test.mjs`

- [ ] **Step 6.1: Написати тест `detect()` через існуючий `hasCargoTomlInTree`**

```js
/**
 * Тести Rust-coverage-провайдера (rust.mdc): detect() — наявність Cargo.toml
 * у cwd або workspace; collect() спавнить cargo llvm-cov + cargo-mutants,
 * парсить JSON-виводи. collect() тестується з ін'єктованим runner-ом.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detect } from '../coverage.mjs'

function makeFixture({ withCargo = true, nested = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rust-coverage-detect-'))
  if (withCargo) {
    if (nested) {
      mkdirSync(join(dir, 'src-tauri'), { recursive: true })
      writeFileSync(join(dir, 'src-tauri', 'Cargo.toml'), '[package]\nname="foo"\nversion="0.1.0"\n')
    } else {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="foo"\nversion="0.1.0"\n')
    }
  }
  return dir
}

describe('rust coverage detect()', () => {
  test('повертає true коли Cargo.toml у корені cwd', async () => {
    const dir = makeFixture()
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає true коли Cargo.toml у workspace-підкаталозі (app/src-tauri/)', async () => {
    const dir = makeFixture({ nested: true })
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає false без Cargo.toml', async () => {
    const dir = makeFixture({ withCargo: false })
    expect(await detect(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 6.2: Запустити — переконатись, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/rust/coverage/tests/coverage.test.mjs
```

Expected: FAIL — `Cannot find module '../coverage.mjs'`.

- [ ] **Step 6.3: Реалізувати `detect()` у `rust/coverage/coverage.mjs`**

```js
/**
 * Rust-провайдер для `n-cursor coverage`: збирає метрики покриття (`cargo llvm-cov`)
 * і мутаційного тестування (`cargo-mutants`) для Rust-коду. Активується через
 * правило `rust` у `.n-cursor.json#rules`; applies-логіка — у `detect(cwd)`
 * (наявність Cargo.toml у cwd або workspace-підкаталозі).
 *
 * Контракт провайдера — у docs/superpowers/specs/2026-05-24-coverage-rule-design.md.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { hasCargoTomlInTree } from '../lib/has-cargo-toml.mjs'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo', 'target'])

/**
 * Чи провайдер застосовний у поточному cwd.
 * @param {string} cwd
 * @returns {Promise<boolean>}
 */
export async function detect(cwd) {
  if (existsSync(join(cwd, 'Cargo.toml'))) return true
  return hasCargoTomlInTree(cwd, IGNORED_DIR_NAMES)
}
```

- [ ] **Step 6.4: Запустити — переконатись що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/rust/coverage/tests/coverage.test.mjs
```

Expected: PASS — 3 тести зелені.

- [ ] **Step 6.5: Verify**

```bash
git status npm/rules/rust/coverage/
git diff npm/rules/rust/coverage/
```

---

### Task 7: rust провайдер — TDD `collect()` з ін'єкцією runner-а

**Files:**

- Modify: `npm/rules/rust/coverage/coverage.mjs`
- Modify: `npm/rules/rust/coverage/tests/coverage.test.mjs`

- [ ] **Step 7.1: Додати тести `collect()` з fake runner**

```js
import { collect } from '../coverage.mjs'

describe('rust coverage collect()', () => {
  test('парсить llvm-cov JSON + cargo-mutants outcomes.json', async () => {
    const dir = makeFixture()
    const calls = []
    const runner = {
      async runLlvmCov({ manifestPath }) {
        calls.push({ kind: 'llvm-cov', manifestPath })
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: [
              {
                totals: {
                  lines: { covered: 80, count: 100, percent: 80 },
                  functions: { covered: 18, count: 20, percent: 90 }
                }
              }
            ]
          })
        }
      },
      async runCargoMutants({ manifestPath, outDir }) {
        calls.push({ kind: 'mutants', manifestPath, outDir })
        const dotOut = join(outDir, 'mutants.out')
        mkdirSync(dotOut, { recursive: true })
        writeFileSync(join(dotOut, 'outcomes.json'), JSON.stringify({ caught: 7, timeout: 1, missed: 2, unviable: 5 }))
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(rows).toEqual([
      {
        area: 'Rust',
        coverage: { lines: { covered: 80, total: 100 }, functions: { covered: 18, total: 20 } },
        mutation: { caught: 8, total: 10 } // caught + timeout = 8; (caught + timeout) + missed = 10; unviable виключено
      }
    ])
    expect(calls[0].kind).toBe('llvm-cov')
    expect(calls[1].kind).toBe('mutants')
    rmSync(dir, { recursive: true, force: true })
  })

  test('падає якщо llvm-cov exit ≠ 0 — explainer з install-командою', async () => {
    const dir = makeFixture()
    const runner = {
      async runLlvmCov() {
        return { exitCode: 1, stdout: '' }
      },
      async runCargoMutants() {
        return 0
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(/cargo install cargo-llvm-cov/)
    rmSync(dir, { recursive: true, force: true })
  })

  test('падає якщо cargo-mutants не залишив outcomes.json', async () => {
    const dir = makeFixture()
    const runner = {
      async runLlvmCov() {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: [{ totals: { lines: { covered: 0, count: 0 }, functions: { covered: 0, count: 0 } } }]
          })
        }
      },
      async runCargoMutants() {
        return 0
      } // outcomes.json не пишеться
    }
    await expect(collect(dir, { runner })).rejects.toThrow(/cargo install cargo-mutants/)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 7.2: Запустити — переконатись, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/rust/coverage/tests/coverage.test.mjs
```

Expected: FAIL — `collect` не експортовано.

- [ ] **Step 7.3: Реалізувати `collect()` у `rust/coverage/coverage.mjs`**

Додати в `coverage.mjs` після `detect()`:

```js
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

/**
 * Знайти Cargo.toml: cwd/Cargo.toml або в одному з workspace-підкаталогів.
 * @param {string} cwd
 * @returns {Promise<string>} абсолютний шлях до Cargo.toml
 */
async function resolveCargoManifest(cwd) {
  const rootManifest = join(cwd, 'Cargo.toml')
  if (existsSync(rootManifest)) return rootManifest

  // Спробувати workspace-каталоги через package.json#workspaces
  const rootPkgPath = join(cwd, 'package.json')
  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
    const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
    for (const ws of workspaces) {
      const candidate = join(cwd, ws, 'src-tauri', 'Cargo.toml')
      if (existsSync(candidate)) return candidate
      const flat = join(cwd, ws, 'Cargo.toml')
      if (existsSync(flat)) return flat
    }
  }

  throw new Error('rust coverage: Cargo.toml не знайдено (cwd + workspaces)')
}

const defaultRunner = {
  async runLlvmCov({ manifestPath }) {
    const proc = Bun.spawn(['cargo', 'llvm-cov', '--manifest-path', manifestPath, '--json', '--summary-only'], {
      stdout: 'pipe',
      stderr: 'inherit'
    })
    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    return { exitCode, stdout }
  },
  async runCargoMutants({ manifestPath, outDir }) {
    const proc = Bun.spawn(['cargo', 'mutants', '--in-place', '-o', outDir, '--manifest-path', manifestPath], {
      stdout: 'inherit',
      stderr: 'inherit'
    })
    return proc.exited
  }
}

/**
 * Збирає Rust-метрики покриття + мутаційного тестування.
 * @param {string} cwd корінь проєкту
 * @param {{runner?: typeof defaultRunner}} [opts]
 * @returns {Promise<Array<{area:string, coverage:object, mutation:{caught:number,total:number}}>>}
 */
export async function collect(cwd, opts = {}) {
  const runner = opts.runner ?? defaultRunner
  const manifestPath = await resolveCargoManifest(cwd)

  // 1. Coverage через cargo llvm-cov
  const { exitCode: llvmCode, stdout: llvmJson } = await runner.runLlvmCov({ manifestPath })
  if (llvmCode !== 0) {
    throw new Error('rust coverage: cargo llvm-cov упав — встанови: cargo install cargo-llvm-cov')
  }
  const totals = JSON.parse(llvmJson).data[0].totals
  const coverage = {
    lines: { covered: totals.lines.covered, total: totals.lines.count },
    functions: { covered: totals.functions.covered, total: totals.functions.count }
  }

  // 2. Mutation через cargo mutants
  const outDir = await mkdtemp(join(tmpdir(), 'rust-mutants-'))
  let mutation
  try {
    // cargo-mutants exit ≠ 0 коли є missed — це нормально, не помилка. Реальний крах — відсутній outcomes.json.
    await runner.runCargoMutants({ manifestPath, outDir })
    let outcomes
    try {
      outcomes = JSON.parse(await readFile(join(outDir, 'mutants.out', 'outcomes.json'), 'utf8'))
    } catch {
      throw new Error('rust coverage: cargo mutants не залишив outcomes.json — встанови: cargo install cargo-mutants')
    }
    const caught = (outcomes.caught ?? 0) + (outcomes.timeout ?? 0)
    mutation = { caught, total: caught + (outcomes.missed ?? 0) }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }

  return [{ area: 'Rust', coverage, mutation }]
}
```

- [ ] **Step 7.4: Запустити — переконатись що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/rust/coverage/tests/coverage.test.mjs
```

Expected: PASS — усі 6 тестів зелені (3 detect + 3 collect).

- [ ] **Step 7.5: Verify**

```bash
git status npm/rules/rust/coverage/
git diff npm/rules/rust/coverage/
```

---

### Task 8: Оркестратор — TDD `runCoverageSteps` з ін'єкцією rulesDir

`runCoverageSteps` приймає опційний `rulesDir`, щоб тести могли підставити fixture-каталог із stub-провайдерами.

**Files:**

- Modify: `npm/rules/test/coverage/coverage.mjs`
- Modify: `npm/rules/test/coverage/tests/coverage.test.mjs`

- [ ] **Step 8.1: Додати тести `runCoverageSteps` у `tests/coverage.test.mjs`**

```js
import { runCoverageSteps } from '../coverage.mjs'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

/**
 * Створює fixture-каталог із fake `.n-cursor.json`, заданими провайдерами
 * і опційним `rulesDir`. Повертає {cwd, rulesDir, cleanup}.
 */
function makeOrchestratorFixture({ rules = [], providers = {} } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-cwd-'))
  writeFileSync(join(cwd, '.n-cursor.json'), JSON.stringify({ rules }))

  const rulesDir = mkdtempSync(join(tmpdir(), 'orchestrator-rules-'))
  for (const [ruleId, providerSource] of Object.entries(providers)) {
    const providerDir = join(rulesDir, ruleId, 'coverage')
    mkdirSync(providerDir, { recursive: true })
    writeFileSync(join(providerDir, 'coverage.mjs'), providerSource)
  }

  return {
    cwd,
    rulesDir,
    cleanup() {
      rmSync(cwd, { recursive: true, force: true })
      rmSync(rulesDir, { recursive: true, force: true })
    }
  }
}

const ONE_ROW_PROVIDER = `
  export async function detect() { return true }
  export async function collect() {
    return [{
      area: 'Test',
      coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 3, total: 5 } },
      mutation: { caught: 4, total: 5 }
    }]
  }
`

const SKIP_PROVIDER = `
  export async function detect() { return false }
  export async function collect() { throw new Error('should not be called') }
`

describe('runCoverageSteps', () => {
  test('агрегує дані одного провайдера і додає рядок Разом', async () => {
    const fx = makeOrchestratorFixture({ rules: ['js-lint'], providers: { 'js-lint': ONE_ROW_PROVIDER } })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    const md = readFileSync(join(fx.cwd, 'COVERAGE.md'), 'utf8')
    expect(md).toContain('| Test |')
    expect(md).toContain('| **Разом** |')
    fx.cleanup()
  })

  test('пропускає правила без провайдера (silently)', async () => {
    const fx = makeOrchestratorFixture({
      rules: ['js-lint', 'no-such-rule'],
      providers: { 'js-lint': ONE_ROW_PROVIDER }
      // no-such-rule навмисно без коду
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    fx.cleanup()
  })

  test('пропускає правила де detect() === false', async () => {
    const fx = makeOrchestratorFixture({
      rules: ['js-lint', 'rust'],
      providers: { 'js-lint': ONE_ROW_PROVIDER, rust: SKIP_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    const md = readFileSync(join(fx.cwd, 'COVERAGE.md'), 'utf8')
    expect(md).toContain('| Test |')
    expect(md).not.toContain('rust')
    fx.cleanup()
  })

  test('exit 1 коли жоден провайдер не відпрацював', async () => {
    const fx = makeOrchestratorFixture({ rules: ['js-lint'], providers: { 'js-lint': SKIP_PROVIDER } })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(1)
    fx.cleanup()
  })

  test('агрегує два провайдери і рахує total коректно', async () => {
    const fx = makeOrchestratorFixture({
      rules: ['js-lint', 'rust'],
      providers: { 'js-lint': ONE_ROW_PROVIDER, rust: ONE_ROW_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    const md = readFileSync(join(fx.cwd, 'COVERAGE.md'), 'utf8')
    // Два рядки Test + один Разом = 3 рядки після хедера
    expect(md.match(/\| Test \|/g)).toHaveLength(2)
    // Разом: lines covered=20, total=40 → 50.00% (20/40); mutation: 8/10 → 80.00%
    expect(md).toContain('| **Разом** | 50.00% (20/40) | 50.00% (6/10) | 8/10 | 80.00% |')
    fx.cleanup()
  })
})
```

- [ ] **Step 8.2: Запустити — переконатись, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/test/coverage/tests/coverage.test.mjs
```

Expected: FAIL — `runCoverageSteps` не експортовано.

- [ ] **Step 8.3: Доповнити `coverage.mjs` функцією `runCoverageSteps` + `runCoverageCli`**

Додати в `coverage.mjs` після `renderMarkdown`:

```js
/**
 * Завантажує provider-модуль з `<rulesDir>/<ruleId>/coverage/coverage.mjs`.
 * Повертає null якщо файлу немає (skip silently).
 * @param {string} rulesDir
 * @param {string} ruleId
 * @returns {Promise<{detect:Function, collect:Function}|null>}
 */
async function loadProvider(rulesDir, ruleId) {
  const providerPath = join(rulesDir, ruleId, 'coverage', 'coverage.mjs')
  if (!existsSync(providerPath)) return null
  return import(providerPath)
}

/**
 * Будує підсумковий рядок «Разом» через сумування всіх coverage/mutation.
 * @param {Array<{area:string, coverage:object, mutation:object}>} rows
 */
function buildTotalsRow(rows) {
  const totalCoverage = rows.reduce((acc, row) => addCoverage(acc, row.coverage), {
    lines: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 }
  })
  const totalMutation = rows.reduce((acc, row) => addMutation(acc, row.mutation), { caught: 0, total: 0 })
  return { area: '**Разом**', coverage: totalCoverage, mutation: totalMutation }
}

/**
 * Виконує coverage-pipeline: discovery провайдерів за `.n-cursor.json#rules`,
 * detect+collect для кожного, агрегація, запис COVERAGE.md.
 * @param {{cwd?:string, rulesDir?:string}} [opts] ін'єкція для тестів
 * @returns {Promise<number>} exit code (0 OK, 1 коли жоден провайдер не дав даних)
 */
export async function runCoverageSteps(opts = {}) {
  const cwd = opts.cwd ?? process.cwd()
  const rulesDir = opts.rulesDir ?? RULES_DIR
  const config = await readNCursorConfigLite(cwd)
  const rows = []

  for (const ruleId of config.rules) {
    if (config.disableRules.includes(ruleId)) continue
    const provider = await loadProvider(rulesDir, ruleId)
    if (!provider) continue
    if (!(await provider.detect(cwd))) continue
    console.log(`→ ${ruleId} coverage…`)
    rows.push(...(await provider.collect(cwd)))
  }

  if (rows.length === 0) {
    console.error('✗ Жодного провайдера покриття не знайдено для активних правил у .n-cursor.json#rules')
    return 1
  }

  rows.push(buildTotalsRow(rows))
  const md = renderMarkdown(rows)
  await writeFile(join(cwd, 'COVERAGE.md'), md, 'utf8')
  console.log('✓ COVERAGE.md')
  return 0
}

// Один оркестратор, один callsite — `withLock` викликається напряму, без спільної
// точки входу. Канонічне обмеження «не імпортуй withLock у lint.mjs/fix.mjs напряму»
// (scripts.mdc § withLock) націлене на дедуплікацію preamble серед багатьох файлів —
// для одного coverage-консумера не релевантне (див. C4 у specs/2026-05-24-coverage-rule-design.md).
export const runCoverageCli = () => withLock('coverage', runCoverageSteps)
```

- [ ] **Step 8.4: Запустити — переконатись, що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test rules/test/coverage/tests/coverage.test.mjs
```

Expected: PASS — усі 12 тестів зелені (7 pure helpers + 5 runCoverageSteps).

- [ ] **Step 8.5: Verify**

```bash
git status npm/rules/test/coverage/
git diff npm/rules/test/coverage/
```

---

### Task 9: CLI wiring

**Files:**

- Modify: `npm/bin/n-cursor.js`

- [ ] **Step 9.1: Прочитати поточний `bin/n-cursor.js` секцію case-розгалуження**

```bash
cd /Users/vitaliytv/www/nitra/cursor
sed -n '1255,1330p' npm/bin/n-cursor.js
```

Expected: видно case'и для `lint-ga`, `lint-rego`, `lint-k8s`, `lint-docker`, `lint-text`, `skill`, `''`.

- [ ] **Step 9.2: Додати `case 'coverage'` після `case 'lint-text'`**

Скористатися Edit-tool для додавання після блоку `case 'lint-text':` (приблизно після `process.exitCode = await runLintTextCli()` і `break`):

```js
    case 'coverage': {
      // n-cursor coverage — оркестратор покриття + мутаційного тестування з discovery
      // провайдерів через .n-cursor.json#rules (test.mdc).
      const { runCoverageCli } = await import('../rules/test/coverage/coverage.mjs')
      process.exitCode = await runCoverageCli()
      break
    }
```

- [ ] **Step 9.3: Розширити help-string у `case '':`**

Знайти рядок ~1326 з `'   Очікується: (без аргументів) синхронізація правил, check, rename-yaml-extensions, stop-hook, lint-ga, lint-rego, lint-k8s, lint-docker, lint-text, skill'` і додати `coverage` перед `skill`:

```js
;`   Очікується: (без аргументів) синхронізація правил, check, rename-yaml-extensions, stop-hook, lint-ga, lint-rego, lint-k8s, lint-docker, lint-text, coverage, skill`
```

- [ ] **Step 9.4: Smoke-test `n-cursor coverage` у dev-режимі без споживача**

```bash
cd /tmp
mkdir -p test-coverage-empty && cd test-coverage-empty
echo '{"$schema":"https://unpkg.com/@nitra/cursor/schemas/n-cursor.json","rules":[]}' > .n-cursor.json
bun /Users/vitaliytv/www/nitra/cursor/npm/bin/n-cursor.js coverage
```

Expected: exit code 1, повідомлення «Жодного провайдера покриття не знайдено для активних правил у .n-cursor.json#rules».

- [ ] **Step 9.5: Verify**

```bash
cd /Users/vitaliytv/www/nitra/cursor
git status npm/bin/n-cursor.js
git diff npm/bin/n-cursor.js
```

---

### Task 10: Документація — `test.mdc`

**Files:**

- Modify: `npm/rules/test/test.mdc`

- [ ] **Step 10.1: Додати секцію «Покриття + мутаційне тестування» після поточного «Що перевіряє правило»**

Edit-tool: знайти кінець секції про конвенцію розміщення тестів і додати:

```markdown
## Покриття + мутаційне тестування

Канонічна команда — `n-cursor coverage`: збирає метрики покриття (`bun test --coverage`, `cargo llvm-cov` тощо) і мутаційного тестування (Stryker, `cargo-mutants`) з усіх активних провайдерів у `.n-cursor.json#rules` і пише `COVERAGE.md` у корінь проєкту. Лок і дедуп — `withLock('coverage', ...)`.

Провайдери живуть у `npm/rules/<rule>/coverage/coverage.mjs` (постачаються правилами мови/рантайму: `js-lint`, `rust`, у майбутньому `python` тощо). Оркестратор — у `npm/rules/test/coverage/coverage.mjs`.

У `package.json` (корінь) має бути `scripts.coverage` із викликом `n-cursor coverage`:

Канон `scripts.coverage` (substring requirement): [package.json.contains.json](./policy/package_json/template/package.json.contains.json)
```

(Жодного inline-fenced-блока з `title="package.json"` — посилання заінлайниться через `inlineTemplateLinks` під час `npx @nitra/cursor` sync.)

- [ ] **Step 10.2: Bump version у фронтматтері `test.mdc`**

`version: '1.1'` → `version: '1.2'`.

- [ ] **Step 10.3: Verify**

```bash
git diff npm/rules/test/test.mdc
```

Expected: додана секція, версія 1.2.

---

### Task 11: Документація — `js-lint.mdc` і `rust.mdc`

**Files:**

- Modify: `npm/rules/js-lint/js-lint.mdc`
- Modify: `npm/rules/rust/rust.mdc`

- [ ] **Step 11.1: Додати параграф у `js-lint.mdc` після секції «Тести»**

```markdown
## Покриття + мутаційне тестування JS

Покриття + мутаційне тестування JS постачаються через `n-cursor coverage` (правило `test.mdc`). Реалізація провайдера — у `npm/rules/js-lint/coverage/coverage.mjs`: `bun test --coverage --coverage-reporter=lcov` + `bunx stryker run`. Stryker конфігурується в `stryker.config.mjs` у JS-корені (single-package або `workspaces[0]`).
```

- [ ] **Step 11.2: Bump version у `js-lint.mdc`**

Знайти `version: '1.23'` → `'1.24'`.

- [ ] **Step 11.3: Додати параграф у `rust.mdc` після секції «Композиція з Tauri»**

```markdown
## Покриття + мутаційне тестування Rust

Покриття + мутаційне тестування Rust постачаються через `n-cursor coverage` (правило `test.mdc`). Реалізація провайдера — у `npm/rules/rust/coverage/coverage.mjs`: `cargo llvm-cov --json --summary-only` + `cargo mutants --in-place`. Бінарники: `cargo install cargo-llvm-cov && cargo install cargo-mutants`.
```

- [ ] **Step 11.4: Bump version у `rust.mdc`**

Знайти `version: '1.0'` → `'1.1'`.

- [ ] **Step 11.5: Verify**

```bash
git diff npm/rules/js-lint/js-lint.mdc npm/rules/rust/rust.mdc
```

---

### Task 12: Самоперевірка через `npx @nitra/cursor fix`

- [ ] **Step 12.1: Запустити повний test-suite пакета**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test
```

Expected: PASS — усі тести зелені (включно з новими 14+ кейсами).

- [ ] **Step 12.2: Запустити lint-rego**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun run lint-rego
```

Expected: PASS — усі rego-тести (включно з новим `test.package_json`) зелені, regal без warnings.

- [ ] **Step 12.3: Запустити `npx @nitra/cursor fix` на самому пакеті**

```bash
cd /Users/vitaliytv/www/nitra/cursor
npx @nitra/cursor fix
```

Expected: проходить без нових failure'ів (нова `test.package_json` policy перевіряється на корені пакета, де є `scripts.coverage`? — якщо нема, тоді показує очікувану підказку, що буде виправлено в Task 13 разом із bump'ом версії; може зачекати release-PR).

Якщо fix вказує на відсутність `scripts.coverage` у корені `@nitra/cursor/package.json` — додати: `"coverage": "n-cursor coverage"` у `npm/package.json#scripts` як самоприклад.

---

### Task 13: Bump version + CHANGELOG

**Files:**

- Modify: `npm/package.json`
- Modify: `npm/CHANGELOG.md`

- [ ] **Step 13.1: Bump `npm/package.json` version `1.16.0` → `1.17.0`**

```json
{
  "version": "1.17.0"
}
```

- [ ] **Step 13.2: Додати нову секцію в `npm/CHANGELOG.md` зверху (після заголовка)**

```markdown
## [1.17.0] - 2026-05-24

### Added

- CLI-команда `n-cursor coverage` — оркестратор покриття + мутаційного тестування з discovery провайдерів через `.n-cursor.json#rules`. Канон `scripts.coverage` (контейнер `package.json`) у правилі `test`.
- Провайдер `js-lint/coverage/` — `bun test --coverage --coverage-reporter=lcov` + `bunx stryker run`; парсить lcov.info і `reports/stryker/mutation.json`.
- Провайдер `rust/coverage/` — `cargo llvm-cov --json` + `cargo mutants --in-place`; парсить `data[0].totals` і `outcomes.json` (caught = caught + timeout; total = caught + missed; unviable виключено).
- Policy `test.package_json` з template `package.json.contains.json` — substring-вимога `scripts.coverage` містити `n-cursor coverage`.

### Changed

- `test.mdc` 1.1 → 1.2: додано секцію «Покриття + мутаційне тестування» з посиланням на template.
- `js-lint.mdc` 1.23 → 1.24: додано параграф із посиланням на JS-coverage-провайдер.
- `rust.mdc` 1.0 → 1.1: додано параграф із посиланням на Rust-coverage-провайдер.
- `npm/bin/n-cursor.js`: новий `case 'coverage'` + розширений help-string.
```

- [ ] **Step 13.3: Запустити `npx @nitra/cursor fix changelog`**

```bash
cd /Users/vitaliytv/www/nitra/cursor
npx @nitra/cursor fix changelog
```

Expected: PASS — версія 1.17.0 у package.json відповідає секції в CHANGELOG.md.

- [ ] **Step 13.4: Final review**

```bash
git status
git diff --stat
git diff npm/package.json npm/CHANGELOG.md
```

Expected: усі новостворені файли + модифіковані доки + version bump видно у git status. Жодних untracked артефактів типу tmp/, COVERAGE.md, .coverage.lock.

---

## PR2 — `mail app` cleanup (після релізу `@nitra/cursor@1.17.0`)

**ВАЖЛИВО:** виконуйте лише після того, як `@nitra/cursor@1.17.0` опублікований у npm. Інакше `n-cursor coverage` не існує в інстальованій версії, і `bun run coverage` падатиме.

### Task 14: Upgrade `@nitra/cursor` до 1.17.0

**Files:**

- Modify: `package.json` (mail app root)
- Modify: `bun.lockb`

- [ ] **Step 14.1: Upgrade dev-залежності**

```bash
cd /Users/vitaliytv/www/vitaliytv/mail app
bun add -D @nitra/cursor@^1.17.0
```

Expected: `@nitra/cursor` версію в `devDependencies` оновлено; `bun.lockb` оновлено.

- [ ] **Step 14.2: Перевірити CLI**

```bash
bun n-cursor coverage --help 2>&1 | head -5 || bun n-cursor 2>&1 | grep coverage
```

Expected: `coverage` фігурує у списку доступних команд.

---

### Task 15: Видалити локальні скрипти й тести

**Files:**

- Delete: `scripts/coverage.js`
- Delete: `scripts/with-lock.js`
- Delete: `scripts/__tests__/` (рекурсивно)

- [ ] **Step 15.1: Видалити три цілі**

```bash
cd /Users/vitaliytv/www/vitaliytv/mail app
git rm scripts/coverage.js scripts/with-lock.js
git rm -r scripts/__tests__/
```

- [ ] **Step 15.2: Verify**

```bash
git status scripts/
```

Expected: видалення помічене; інші файли в `scripts/` (`docs-regen.js` тощо) збережено.

---

### Task 16: Оновити `package.json` (корінь mail app)

**Files:**

- Modify: `package.json`

- [ ] **Step 16.1: Замінити `scripts.coverage` і видалити `scripts.test:scripts`**

Edit-tool на `package.json`:

```json
{
  "scripts": {
    "dev": "bun --cwd=app run tauri dev",
    "tauri": "bun --cwd=app run tauri",
    "lint": "bun run lint-js && bun run lint-text && bun run lint-style && bun run lint-ga && bun run lint-image && bun run lint-security && oxfmt .",
    "lint-ga": "n-cursor lint-ga",
    "lint-image": "npx @nitra/minify-image --src=. --write",
    "lint-js": "bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip --no-config-hints",
    "lint-security": "trufflehog filesystem . --no-update --exclude-paths .trufflehog-exclude --results=verified,unknown --fail",
    "lint-style": "npx stylelint '**/*.{css,scss,vue}' --fix",
    "lint-text": "n-cursor lint-text",
    "docs:regen": "bun run scripts/docs-regen.js",
    "coverage": "n-cursor coverage"
  }
}
```

(Видалено `test:scripts`, замінено значення `coverage`.)

- [ ] **Step 16.2: Verify**

```bash
git diff package.json
```

Expected: рядок `"test:scripts": "..."` видалено; `coverage` має нове значення.

---

### Task 17: Оновити `app/package.json` (mail app workspace)

**Files:**

- Modify: `app/package.json`

- [ ] **Step 17.1: Видалити `test:mutation` і `test:rust:mutation`**

Edit-tool: знайти ці два рядки у `app/package.json#scripts` і видалити. Решта (`test:coverage`, `test:rust:coverage`, `test:rust`, `test:all`) — лишається.

Після правки `scripts` має виглядати приблизно так:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "android": "tauri android dev",
    "test": "bun test --preload ./test/happy-dom.preload.js src",
    "test:watch": "bun test --watch --preload ./test/happy-dom.preload.js src",
    "test:coverage": "bun test --coverage --preload ./test/happy-dom.preload.js src",
    "test:rust": "cargo test --manifest-path src-tauri/Cargo.toml",
    "test:rust:coverage": "cargo llvm-cov --manifest-path src-tauri/Cargo.toml",
    "test:all": "bun run test && bun run test:rust"
  }
}
```

- [ ] **Step 17.2: Verify**

```bash
git diff app/package.json
```

Expected: видалено `test:mutation` і `test:rust:mutation`; інше без змін.

---

### Task 18: Golden-diff верифікація COVERAGE.md

- [ ] **Step 18.1: Зберегти baseline COVERAGE.md**

```bash
cd /Users/vitaliytv/www/vitaliytv/mail app
cp COVERAGE.md COVERAGE.md.baseline
```

(Якщо файлу немає — пропустити цей крок; перший прогін згенерує його.)

- [ ] **Step 18.2: Додати `test` до `.n-cursor.json#rules`** (опційно — щоб `n-cursor fix` валідував канон `scripts.coverage`)

Edit `.n-cursor.json`:

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/n-cursor.json",
  "rules": [
    "adr",
    "bun",
    "changelog",
    "ci4",
    "ga",
    "image-avif",
    "image-compress",
    "js-lint",
    "js-run",
    "rust",
    "security",
    "style-lint",
    "test",
    "text",
    "vue"
  ],
  "skills": ["adr-normalize", "fix", "lint", "llm-patch", "publish-telegram", "start-check", "taze"]
}
```

- [ ] **Step 18.3: Запустити `bun run coverage`**

```bash
cd /Users/vitaliytv/www/vitaliytv/mail app
bun run coverage
```

Expected: `→ js-lint coverage…`, `→ rust coverage…`, `✓ COVERAGE.md`. exit code 0.

- [ ] **Step 18.4: Порівняти з baseline**

```bash
diff COVERAGE.md.baseline COVERAGE.md && echo "IDENTICAL"
```

Expected: `IDENTICAL` (або acceptable дельта в десятих відсотка, якщо порядок мутацій змінився між прогонами). Якщо різниця значуща — діагностувати, чи правильно провайдери відтворюють поведінку старого скрипта.

- [ ] **Step 18.5: Cleanup baseline**

```bash
rm -f COVERAGE.md.baseline
```

- [ ] **Step 18.6: Final review**

```bash
cd /Users/vitaliytv/www/vitaliytv/mail app
git status
git diff --stat
git diff package.json app/package.json .n-cursor.json
```

Expected: видалені `scripts/coverage.js`, `scripts/with-lock.js`, `scripts/__tests__/`; модифіковані `package.json` (root + app); опційно `.n-cursor.json` (додано `test`). Жодних untracked артефактів.

---

## Self-Review Checklist (для виконавця після завершення)

**Spec coverage:**

- [ ] C1 (повне перенесення): Tasks 15-17 видаляють `coverage.js`, `with-lock.js`, `__tests__/`, обидва `test:*mutation`, замінюють `scripts.coverage`. ✓
- [ ] C2 (per-rule провайдери): Tasks 4-7 створюють `js-lint/coverage/` і `rust/coverage/`. ✓
- [ ] C3 (discovery через `.n-cursor.json#rules`): Task 8 — `runCoverageSteps` читає `readNCursorConfigLite`. ✓
- [ ] C4 (прямий `withLock`): Task 8 Step 8.3 — `withLock('coverage', runCoverageSteps)` без обгортки. ✓
- [ ] C5 (ключ `coverage`): закодовано прямо у Task 8 Step 8.3. ✓
- [ ] C6 (rego policy + template): Tasks 1-2 створюють `test/policy/package_json/`. ✓
- [ ] C7 (substring `n-cursor coverage`): Task 1 Step 1.2 template; Task 2 Step 2.1 _test_allow_extended_coverage_command_ перевіряє. ✓
- [ ] C8 (test:mutation/test:rust:mutation видалені; test:coverage збережено): Task 17. ✓
- [ ] C9 (rust rule як дане): Task 6/7 використовують `../lib/has-cargo-toml.mjs` від існуючого правила. ✓

**Placeholder scan:** жодного "TBD"/"TODO"/"implement later"/"appropriate error handling". Усі steps мають конкретний код або команду. ✓

**Type consistency:**

- `CoverageRow = { area, coverage: {lines, functions}, mutation: {caught, total} }` — узгоджено між провайдерами (js-lint, rust) і оркестратором (`renderMarkdown`, `addCoverage`, `addMutation`). ✓
- `detect(cwd) → Promise<boolean>` — узгоджено в js-lint та rust. ✓
- `collect(cwd, {runner}) → Promise<CoverageRow[]>` — узгоджено. ✓

---

## Execution Choice

Після збереження плану — обери спосіб виконання:

1. **Subagent-Driven (recommended):** Тато диспетчує fresh-subagent на кожну задачу, з review-чекпоінтами між ними. Швидка ітерація, ізольований контекст на задачу.
2. **Inline Execution:** Виконуєш задачі у цій сесії через executing-plans, batched-execution з checkpoint-ами для огляду.
