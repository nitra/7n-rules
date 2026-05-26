# Mutation Config Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Правило `test` автоматично розміщує canonical mutation configs (`stryker.config.mjs` і `.cargo/mutants.toml`) у відповідних project roots, якщо `js-lint`/`rust` активні в `.n-cursor.json#rules`.

**Architecture:** Два нових JS-концерни в `npm/rules/test/js/` — `stryker_config.mjs` і `cargo_mutants_config.mjs`. Обидва self-gate через `readNCursorConfigLite`, резолвять root через існуючий `resolveJsRoot`/`hasCargoTomlInTree`, і copy-on-absent canonical baseline. Discovery — авто через `runStandardRule` (алфавітний scan `js/*.mjs`). Ін'єкція залежностей через `runner` об'єкт (pattern з `js-lint/coverage/coverage.mjs`).

**Tech Stack:** Node.js (ESM `node:fs`, `node:child_process`), `bun:test`, `@nitra/cursor` internal APIs (`readNCursorConfigLite`, `isRuleEnabled`, `withTmpCwd`).

---

## File Map

| Статус | Файл                                                    | Відповідальність                         |
| ------ | ------------------------------------------------------- | ---------------------------------------- |
| Create | `npm/rules/test/js/stryker_config.mjs`                  | JS-концерн: check Stryker config         |
| Create | `npm/rules/test/js/cargo_mutants_config.mjs`            | Rust-концерн: check cargo-mutants config |
| Create | `npm/rules/test/js/data/stryker.config.canonical.mjs`   | Canonical Stryker baseline               |
| Create | `npm/rules/test/js/data/mutants.toml.canonical`         | Canonical cargo-mutants baseline         |
| Create | `npm/rules/test/js/tests/stryker_config.test.mjs`       | Unit-тести JS-концерну                   |
| Create | `npm/rules/test/js/tests/cargo_mutants_config.test.mjs` | Unit-тести Rust-концерну                 |
| Modify | `npm/rules/test/test.mdc`                               | Документація: секція mutation config     |
| Modify | `npm/package.json`                                      | Version: `1.17.1 → 1.18.0`               |
| Modify | `npm/CHANGELOG.md`                                      | Секція `[1.18.0]`                        |

---

## Task 1: Canonical baselines

**Files:**

- Create: `npm/rules/test/js/data/stryker.config.canonical.mjs`
- Create: `npm/rules/test/js/data/mutants.toml.canonical`

- [ ] **Step 1.1: Створити директорію data**

```bash
mkdir -p /Users/vitaliytv/www/nitra/cursor/npm/rules/test/js/data
```

- [ ] **Step 1.2: Написати Stryker canonical baseline**

Файл: `npm/rules/test/js/data/stryker.config.canonical.mjs`

```js
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'bun test' },
  reporters: ['json', 'clear-text'],
  jsonReporter: { fileName: 'reports/stryker/mutation.json' },
  coverageAnalysis: 'off'
}
```

- [ ] **Step 1.3: Написати cargo-mutants canonical baseline**

Файл: `npm/rules/test/js/data/mutants.toml.canonical`

```toml
# .cargo/mutants.toml — конфігурація cargo-mutants (опційно).
# Документація: https://mutants.rs/. Канон постачає test.mdc.
```

- [ ] **Step 1.4: Перевірити файли**

```bash
ls /Users/vitaliytv/www/nitra/cursor/npm/rules/test/js/data/
```

Очікувано: `mutants.toml.canonical  stryker.config.canonical.mjs`

---

## Task 2: Stryker config концерн — TDD

**Files:**

- Create: `npm/rules/test/js/tests/stryker_config.test.mjs`
- Create: `npm/rules/test/js/stryker_config.mjs`

- [ ] **Step 2.1: Написати тест (failing)**

Файл: `npm/rules/test/js/tests/stryker_config.test.mjs`

```js
/**
 * Тести JS-концерну stryker_config: copy-on-absent логіка для stryker.config.mjs.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { checkStrykerConfig } from '../stryker_config.mjs'
import { withTmpCwd } from '../../../../scripts/utils/test-helpers.mjs'

function makeRunner({ copied = [], exists = /** @type {Record<string,boolean>} */ ({}) } = {}) {
  return {
    existsSync: (/** @type {string} */ p) => (p in exists ? exists[p] : false),
    copyFile: async (/** @type {string} */ _src, /** @type {string} */ dst) => {
      copied.push(dst)
    }
  }
}

describe('checkStrykerConfig', () => {
  test('skip: js-lint не в rules → exit 0, не копіює', async () => {
    await withTmpCwd(async dir => {
      await writeFile(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['test'] }))
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'pkg' }))
      const copied = /** @type {string[]} */ ([])
      const code = await checkStrykerConfig({ cwd: dir, runner: makeRunner({ copied }) })
      expect(code).toBe(0)
      expect(copied).toHaveLength(0)
    })
  })

  test('copy: js-lint в rules, stryker.config.mjs відсутній → exit 0, copy викликано', async () => {
    await withTmpCwd(async dir => {
      await writeFile(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['js-lint', 'test'] }))
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'pkg' }))
      const copied = /** @type {string[]} */ ([])
      const code = await checkStrykerConfig({ cwd: dir, runner: makeRunner({ copied }) })
      expect(code).toBe(0)
      expect(copied).toHaveLength(1)
      expect(copied[0]).toContain('stryker.config.mjs')
    })
  })

  test('no-op: stryker.config.mjs вже існує → exit 0, copy не викликано', async () => {
    await withTmpCwd(async dir => {
      await writeFile(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['js-lint', 'test'] }))
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'pkg' }))
      const strykerPath = join(dir, 'stryker.config.mjs')
      const copied = /** @type {string[]} */ ([])
      const code = await checkStrykerConfig({
        cwd: dir,
        runner: makeRunner({ copied, exists: { [strykerPath]: true } })
      })
      expect(code).toBe(0)
      expect(copied).toHaveLength(0)
    })
  })

  test('monorepo: jsRoot = workspaces[0] → copy у app/stryker.config.mjs', async () => {
    await withTmpCwd(async dir => {
      await writeFile(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['js-lint', 'test'] }))
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['app'] }))
      await mkdir(join(dir, 'app'), { recursive: true })
      await writeFile(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app' }))
      const copied = /** @type {string[]} */ ([])
      const code = await checkStrykerConfig({ cwd: dir, runner: makeRunner({ copied }) })
      expect(code).toBe(0)
      expect(copied[0]).toContain(join('app', 'stryker.config.mjs'))
    })
  })

  test('js-lint в disable-rules → skip, exit 0', async () => {
    await withTmpCwd(async dir => {
      await writeFile(
        join(dir, '.n-cursor.json'),
        JSON.stringify({ rules: ['js-lint', 'test'], 'disable-rules': ['js-lint'] })
      )
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'pkg' }))
      const copied = /** @type {string[]} */ ([])
      const code = await checkStrykerConfig({ cwd: dir, runner: makeRunner({ copied }) })
      expect(code).toBe(0)
      expect(copied).toHaveLength(0)
    })
  })
})
```

- [ ] **Step 2.2: Запустити тест — переконатись у провалі**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test rules/test/js/tests/stryker_config.test.mjs 2>&1 | tail -10
```

Очікувано: `Cannot find module '../stryker_config.mjs'`

- [ ] **Step 2.3: Написати реалізацію**

Файл: `npm/rules/test/js/stryker_config.mjs`

```js
/**
 * JS-концерн правила test: розміщує canonical `stryker.config.mjs` у jsRoot,
 * якщо правило `js-lint` активне в `.n-cursor.json#rules`.
 *
 * Активується через `runStandardRule` (auto-discovery `js/*.mjs`).
 * Self-gates через `readNCursorConfigLite` — правило `test` лишається `alwaysApply: true`.
 */
import { existsSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isRuleEnabled, readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

const CANONICAL_PATH = join(dirname(fileURLToPath(import.meta.url)), 'data', 'stryker.config.canonical.mjs')
const TARGET_FILENAME = 'stryker.config.mjs'

/**
 * Резолвить jsRoot: перший workspace (якщо є) або cwd.
 * @param {string} cwd корінь проєкту
 * @param {{ existsSync: (p: string) => boolean, readFile?: typeof readFile }} runner
 * @returns {Promise<string|null>} абсолютний шлях до jsRoot або null
 */
async function resolveJsRoot(cwd, runner) {
  const rootPkgPath = join(cwd, 'package.json')
  if (!runner.existsSync(rootPkgPath)) return null
  const readFileFn = runner.readFile ?? readFile
  const rootPkg = JSON.parse(await readFileFn(rootPkgPath, 'utf8'))
  const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
  if (workspaces.length > 0) {
    const wsPath = join(cwd, workspaces[0])
    if (runner.existsSync(join(wsPath, 'package.json'))) return wsPath
  }
  return cwd
}

const defaultRunner = {
  existsSync,
  copyFile,
  readFile
}

/**
 * @param {{ cwd?: string, runner?: typeof defaultRunner }} [opts]
 * @returns {Promise<number>} 0 = ok, 1 = error
 */
export async function checkStrykerConfig({ cwd = process.cwd(), runner = defaultRunner } = {}) {
  const config = await readNCursorConfigLite(cwd)
  if (!isRuleEnabled(config, 'js-lint')) return 0

  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const jsRoot = await resolveJsRoot(cwd, runner)
  if (jsRoot === null) {
    pass('⚠ не знайдено package.json у проєкті — stryker config пропущено')
    return reporter.getExitCode()
  }

  const targetPath = join(jsRoot, TARGET_FILENAME)
  if (runner.existsSync(targetPath)) {
    pass(`${TARGET_FILENAME} OK`)
    return reporter.getExitCode()
  }

  try {
    await runner.copyFile(CANONICAL_PATH, targetPath)
    pass(`${TARGET_FILENAME} створено (baseline — відредагуй commandRunner.command)`)
  } catch (err) {
    fail(`не вдалося створити ${TARGET_FILENAME}: ${err.message}`)
  }

  return reporter.getExitCode()
}
```

- [ ] **Step 2.4: Запустити тести — переконатись у проходженні**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test rules/test/js/tests/stryker_config.test.mjs 2>&1 | tail -8
```

Очікувано: `5 pass 0 fail`

- [ ] **Step 2.5: Перевірити git status**

```bash
git status --short
```

---

## Task 3: cargo-mutants config концерн — TDD

**Files:**

- Create: `npm/rules/test/js/tests/cargo_mutants_config.test.mjs`
- Create: `npm/rules/test/js/cargo_mutants_config.mjs`

- [ ] **Step 3.1: Написати тест (failing)**

Файл: `npm/rules/test/js/tests/cargo_mutants_config.test.mjs`

```js
/**
 * Тести Rust-концерну cargo_mutants_config: copy-on-absent логіка для .cargo/mutants.toml.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { checkCargoMutantsConfig } from '../cargo_mutants_config.mjs'
import { withTmpCwd } from '../../../../scripts/utils/test-helpers.mjs'

function makeRunner({ copied = [], madeDir = [], exists = /** @type {Record<string,boolean>} */ ({}) } = {}) {
  return {
    existsSync: (/** @type {string} */ p) => (p in exists ? exists[p] : false),
    mkdir: async (/** @type {string} */ p, /** @type {unknown} */ _opts) => {
      madeDir.push(p)
    },
    copyFile: async (/** @type {string} */ _src, /** @type {string} */ dst) => {
      copied.push(dst)
    },
    findCargoTomlDir: async (/** @type {string} */ cwd) => {
      // Сканує cwd/*/Cargo.toml або cwd/Cargo.toml
      const direct = join(cwd, 'Cargo.toml')
      if (exists[direct]) return cwd
      // shallow check перший рівень
      return null
    }
  }
}

describe('checkCargoMutantsConfig', () => {
  test('skip: rust не в rules → exit 0, не копіює', async () => {
    await withTmpCwd(async dir => {
      await writeFile(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['test'] }))
      const copied = /** @type {string[]} */ ([])
      const code = await checkCargoMutantsConfig({ cwd: dir, runner: makeRunner({ copied }) })
      expect(code).toBe(0)
      expect(copied).toHaveLength(0)
    })
  })

  test('copy: rust в rules, .cargo/mutants.toml відсутній → exit 0, copy викликано', async () => {
    await withTmpCwd(async dir => {
      await writeFile(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['rust', 'test'] }))
      // Cargo.toml існує у cwd
      const cargoPath = join(dir, 'Cargo.toml')
      const copied = /** @type {string[]} */ ([])
      const code = await checkCargoMutantsConfig({
        cwd: dir,
        runner: makeRunner({ copied, exists: { [cargoPath]: true } })
      })
      expect(code).toBe(0)
      expect(copied).toHaveLength(1)
      expect(copied[0]).toContain(join('.cargo', 'mutants.toml'))
    })
  })

  test('no-op: .cargo/mutants.toml вже існує → exit 0, copy не викликано', async () => {
    await withTmpCwd(async dir => {
      await writeFile(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['rust', 'test'] }))
      const cargoPath = join(dir, 'Cargo.toml')
      const mutantsPath = join(dir, '.cargo', 'mutants.toml')
      const copied = /** @type {string[]} */ ([])
      const code = await checkCargoMutantsConfig({
        cwd: dir,
        runner: makeRunner({ copied, exists: { [cargoPath]: true, [mutantsPath]: true } })
      })
      expect(code).toBe(0)
      expect(copied).toHaveLength(0)
    })
  })

  test('monorepo: Cargo.toml у app/src-tauri/ → copy у app/src-tauri/.cargo/mutants.toml', async () => {
    await withTmpCwd(async dir => {
      await writeFile(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['rust', 'test'] }))
      await mkdir(join(dir, 'app', 'src-tauri'), { recursive: true })
      await writeFile(join(dir, 'app', 'src-tauri', 'Cargo.toml'), '[package]\nname = "app"\n')
      const cargoInSubdir = join(dir, 'app', 'src-tauri', 'Cargo.toml')
      const copied = /** @type {string[]} */ ([])
      const madeDir = /** @type {string[]} */ ([])
      const code = await checkCargoMutantsConfig({
        cwd: dir,
        runner: makeRunner({ copied, madeDir, exists: { [cargoInSubdir]: true } })
      })
      expect(code).toBe(0)
      expect(copied[0]).toContain(join('src-tauri', '.cargo', 'mutants.toml'))
    })
  })
})
```

- [ ] **Step 3.2: Запустити тест — переконатись у провалі**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test rules/test/js/tests/cargo_mutants_config.test.mjs 2>&1 | tail -10
```

Очікувано: `Cannot find module '../cargo_mutants_config.mjs'`

- [ ] **Step 3.3: Написати реалізацію**

Файл: `npm/rules/test/js/cargo_mutants_config.mjs`

```js
/**
 * Rust-концерн правила test: розміщує canonical `.cargo/mutants.toml` у rustRoot,
 * якщо правило `rust` активне в `.n-cursor.json#rules`.
 *
 * Активується через `runStandardRule` (auto-discovery `js/*.mjs`).
 * Self-gates через `readNCursorConfigLite` — правило `test` лишається `alwaysApply: true`.
 */
import { existsSync, readdirSync } from 'node:fs'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isRuleEnabled, readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

const CANONICAL_PATH = join(dirname(fileURLToPath(import.meta.url)), 'data', 'mutants.toml.canonical')
const TARGET_RELATIVE = join('.cargo', 'mutants.toml')

const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', 'target'])

/**
 * Знаходить директорію з першим Cargo.toml у дереві cwd (синхронно, з раннім return).
 * @param {string} root
 * @returns {string|null} абсолютний шлях каталогу з Cargo.toml або null
 */
function findCargoTomlDirSync(root) {
  function walk(/** @type {string} */ dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'Cargo.toml') return dir
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
        const found = walk(join(dir, entry.name))
        if (found) return found
      }
    }
    return null
  }
  return walk(root)
}

const defaultRunner = {
  existsSync,
  mkdir,
  copyFile,
  findCargoTomlDir: async (/** @type {string} */ cwd) => findCargoTomlDirSync(cwd)
}

/**
 * @param {{ cwd?: string, runner?: typeof defaultRunner }} [opts]
 * @returns {Promise<number>} 0 = ok, 1 = error
 */
export async function checkCargoMutantsConfig({ cwd = process.cwd(), runner = defaultRunner } = {}) {
  const config = await readNCursorConfigLite(cwd)
  if (!isRuleEnabled(config, 'rust')) return 0

  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const rustRoot = await runner.findCargoTomlDir(cwd)
  if (rustRoot === null) {
    pass('⚠ не знайдено Cargo.toml у проєкті — cargo-mutants config пропущено')
    return reporter.getExitCode()
  }

  const targetPath = join(rustRoot, TARGET_RELATIVE)
  if (runner.existsSync(targetPath)) {
    pass('.cargo/mutants.toml OK')
    return reporter.getExitCode()
  }

  try {
    await runner.mkdir(join(rustRoot, '.cargo'), { recursive: true })
    await runner.copyFile(CANONICAL_PATH, targetPath)
    pass('.cargo/mutants.toml створено (baseline — відредагуй за потреби)')
  } catch (err) {
    fail(`не вдалося створити .cargo/mutants.toml: ${err.message}`)
  }

  return reporter.getExitCode()
}
```

- [ ] **Step 3.4: Запустити тести — переконатись у проходженні**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test rules/test/js/tests/cargo_mutants_config.test.mjs 2>&1 | tail -8
```

Очікувано: `4 pass 0 fail`

---

## Task 4: End-to-end та полний suite

**Files:**

- None нових — верифікація

- [ ] **Step 4.1: Запустити повний suite**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test 2>&1 | tail -6
```

Очікувано: `~1000 pass 0 fail`

- [ ] **Step 4.2: Smoke-test `npx @nitra/cursor fix test` у mlmail**

```bash
cd /Users/vitaliytv/www/vitaliytv/mlmail && bun /Users/vitaliytv/www/nitra/cursor/npm/bin/n-cursor.js fix test 2>&1 | tail -15
```

Очікувано:

- `✅ stryker.config.mjs OK` (існує в `app/`) або `stryker.config.mjs створено`
- `✅ .cargo/mutants.toml OK` (існує у `app/src-tauri/`) або `.cargo/mutants.toml створено`
- `✅ Всі N файлів *.test.mjs у каталозі tests/`
- exit 0

- [ ] **Step 4.3: Smoke-test `npx @nitra/cursor fix test` у @nitra/cursor**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun npm/bin/n-cursor.js fix test 2>&1 | tail -10
```

Очікувано:

- `stryker config пропущено` (js-lint в rules, але package.json → workspaces → npm; stryker.config.mjs відсутня там → copy)
- АБО `stryker.config.mjs OK` (якщо вже створено)
- `⚠ не знайдено Cargo.toml — cargo-mutants config пропущено` (rust не в rules для @nitra/cursor)

---

## Task 5: Документація та version bump

**Files:**

- Modify: `npm/rules/test/test.mdc`
- Modify: `npm/package.json`
- Modify: `npm/CHANGELOG.md`

- [ ] **Step 5.1: Оновити `test.mdc` — додати секцію про mutation config**

В `test.mdc` знайти розділ `## Покриття` (або після rego-секції) і додати:

```markdown
## Mutation config

Якщо у `.n-cursor.json#rules` активне правило `js-lint` — `npx @nitra/cursor fix test` (concern `stryker_config`) розміщує canonical `stryker.config.mjs` у `jsRoot`, якщо файл відсутній. Baseline: [`stryker.config.canonical.mjs`](./js/data/stryker.config.canonical.mjs).

Якщо активне правило `rust` — concern `cargo_mutants_config` розміщує canonical `.cargo/mutants.toml` у директорії з `Cargo.toml`, якщо файл відсутній. Baseline: [`mutants.toml.canonical`](./js/data/mutants.toml.canonical).

Обидва концерни — copy-on-absent: існуючі конфіги не перезаписуються.
```

- [ ] **Step 5.2: Bumper version у frontmatter `test.mdc`**

```yaml
version: '1.3'
```

- [ ] **Step 5.3: Bumper версію пакета**

У `npm/package.json` змінити `"version": "1.17.1"` → `"version": "1.18.0"`.

- [ ] **Step 5.4: Додати запис у CHANGELOG**

Після заголовка вставити:

```markdown
## [1.18.0] - 2026-05-24

### Added

- JS-концерн `test/js/stryker_config.mjs` — автоматично розміщує canonical `stryker.config.mjs` у `jsRoot`, якщо правило `js-lint` активне. Не перезаписує існуючі конфіги.
- Rust-концерн `test/js/cargo_mutants_config.mjs` — автоматично розміщує canonical `.cargo/mutants.toml` у rustRoot, якщо правило `rust` активне. Не перезаписує існуючі конфіги.
- Canonical baselines: `test/js/data/stryker.config.canonical.mjs`, `test/js/data/mutants.toml.canonical`.
```

- [ ] **Step 5.5: Перевірити fix changelog**

```bash
cd /Users/vitaliytv/www/nitra/cursor && npx @nitra/cursor fix changelog 2>&1 | tail -5
```

Очікувано: `✅ npm: @nitra/cursor — нова локальна версія (1.17.1 → 1.18.0)`, exit 0

- [ ] **Step 5.6: Запустити фінальний full suite**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test 2>&1 | tail -6
```

Очікувано: `~1000 pass 0 fail`

---

## Self-Review

**Spec coverage:**

- ✓ JS концерн (`stryker_config.mjs`) — Task 2
- ✓ Rust концерн (`cargo_mutants_config.mjs`) — Task 3
- ✓ Baselines (мінімум Б) — Task 1
- ✓ Self-gate через `readNCursorConfigLite` — обидва концерни
- ✓ `runner` DI для тестів — Task 2/3
- ✓ `test.mdc` version 1.2 → 1.3 + секція — Task 5
- ✓ Version `1.17.1 → 1.18.0` + CHANGELOG — Task 5
- ✓ E2E smoke test у mlmail + @nitra/cursor — Task 4

**Placeholder scan:** жодного "TBD"/"TODO"/"implement later". ✓

**Type consistency:**

- `checkStrykerConfig({ cwd, runner })` — підпис однаковий у тесті (Step 2.1) і реалізації (Step 2.3) ✓
- `checkCargoMutantsConfig({ cwd, runner })` — підпис однаковий у тесті (Step 3.1) і реалізації (Step 3.3) ✓
- `runner.findCargoTomlDir(cwd)` — async у defaultRunner (Step 3.3), і тест-runner (Step 3.1) теж async ✓
- `runner.existsSync` — sync у обох концернах і fake runners ✓
