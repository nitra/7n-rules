# Test Rule Mutation Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Правило `test` керує `stryker.config.mjs` (якщо `js-lint` у `.n-cursor.json#rules`) і `.cargo/mutants.toml` (якщо `rust`). Два self-gating JS-концерни + витяг спільних резолверів `resolveJsRoot`/`resolveCargoManifest` у `npm/scripts/utils/`.

**Architecture:** Кожен концерн читає `.n-cursor.json` через `readNCursorConfigLite`, silently skip-ить якщо gate-rule не enabled. Інакше — резолвить target dir через shared utility, копіює canonical baseline якщо файл відсутній (side-effect, як `knip.json` у `js-lint`). Coverage-провайдери реюзають резолвери замість локальних копій.

**Tech Stack:** Bun (runtime + test), Node `fs/promises` + `child_process`, `readNCursorConfigLite` з `scripts/lib/`.

**Spec:** [`docs/superpowers/specs/2026-05-24-test-rule-mutation-config-design.md`](../specs/2026-05-24-test-rule-mutation-config-design.md)

**Commit policy:** За user preference коміти НЕ створюються в межах плану. Кожна задача завершується `git status && git diff` для review.

---

## File Structure

### Створюються

```
npm/scripts/utils/
├── resolve-js-root.mjs
├── resolve-cargo-manifest.mjs
└── tests/
    ├── resolve-js-root.test.mjs
    └── resolve-cargo-manifest.test.mjs

npm/rules/test/js/
├── stryker_config.mjs
├── cargo_mutants_config.mjs
├── data/
│   ├── stryker_config/
│   │   └── stryker.config.baseline.mjs
│   └── cargo_mutants_config/
│       └── mutants.toml.baseline
└── tests/
    ├── stryker_config.test.mjs
    └── cargo_mutants_config.test.mjs
```

### Модифікуються

- `npm/rules/js-lint/coverage/coverage.mjs` — імпорт shared `resolveJsRoot`; оновлений error hint
- `npm/rules/js-lint/coverage/tests/coverage.test.mjs` — без функціональних змін (опційно)
- `npm/rules/rust/coverage/coverage.mjs` — імпорт shared `resolveCargoManifest`; контракт null-return
- `npm/rules/rust/coverage/tests/coverage.test.mjs` — без функціональних змін (опційно)
- `npm/rules/test/test.mdc` — `alwaysApply: false`, нові globs, версія `2.0`, секція «Налаштування mutation-testing»
- `npm/package.json` — version `1.17.1 → 1.18.0`
- `npm/CHANGELOG.md` — нова секція `[1.18.0]`

---

## Task 1: `resolveJsRoot` shared utility

**Files:**

- Create: `npm/scripts/utils/resolve-js-root.mjs`
- Create: `npm/scripts/utils/tests/resolve-js-root.test.mjs`

- [ ] **Step 1.1: Написати failing test**

```js
/**
 * Тести `resolveJsRoot`: резолвить JS-root проєкту (workspaces[0] якщо є,
 * інакше cwd; null без кореневого package.json).
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveJsRoot } from '../resolve-js-root.mjs'

function makeProj({ root, workspace }) {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-js-root-'))
  if (root) writeFileSync(join(dir, 'package.json'), JSON.stringify(root))
  if (workspace) {
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify(workspace))
  }
  return dir
}

describe('resolveJsRoot', () => {
  test('single-package — повертає cwd', async () => {
    const dir = makeProj({ root: { name: 'foo' } })
    expect(await resolveJsRoot(dir)).toBe(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  test('workspaces[0] з package.json — повертає workspace', async () => {
    const dir = makeProj({ root: { workspaces: ['app'] }, workspace: { name: 'app' } })
    expect(await resolveJsRoot(dir)).toBe(join(dir, 'app'))
    rmSync(dir, { recursive: true, force: true })
  })

  test('workspaces є, але без package.json у workspaces[0] — fallback на cwd', async () => {
    const dir = makeProj({ root: { workspaces: ['app'] } })
    // app/package.json не створено
    mkdirSync(join(dir, 'app'), { recursive: true })
    expect(await resolveJsRoot(dir)).toBe(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  test('кореневий package.json відсутній — null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-js-root-empty-'))
    expect(await resolveJsRoot(dir)).toBe(null)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 1.2: Запустити — переконатись що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test scripts/utils/tests/resolve-js-root.test.mjs
```

Expected: FAIL — `Cannot find module '../resolve-js-root.mjs'`.

- [ ] **Step 1.3: Реалізувати модуль**

```js
/**
 * Резолвить корінь JS-коду в проєкті: для workspace-projects — перший workspace
 * (наприклад `app/` у mlmail), для single-package — корінь cwd. Спільна утиліта
 * для coverage-провайдера js-lint і test-концерну stryker_config (DRY).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @param {string} cwd корінь проєкту (де `.n-cursor.json` і кореневий package.json)
 * @returns {Promise<string|null>} абсолютний шлях до JS-root або null без кореневого package.json
 */
export async function resolveJsRoot(cwd) {
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
```

- [ ] **Step 1.4: Запустити — переконатись що проходить**

```bash
bun test scripts/utils/tests/resolve-js-root.test.mjs
```

Expected: PASS — 4 тести зелені.

- [ ] **Step 1.5: Verify**

```bash
git status npm/scripts/utils/resolve-js-root.mjs npm/scripts/utils/tests/resolve-js-root.test.mjs
```

---

## Task 2: `resolveCargoManifest` shared utility

**Files:**

- Create: `npm/scripts/utils/resolve-cargo-manifest.mjs`
- Create: `npm/scripts/utils/tests/resolve-cargo-manifest.test.mjs`

- [ ] **Step 2.1: Написати failing test**

```js
/**
 * Тести `resolveCargoManifest`: знаходить Cargo.toml у cwd, у workspace-flat
 * або у Tauri-патерні (`<workspace>/src-tauri/`). Повертає null без manifest.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveCargoManifest } from '../resolve-cargo-manifest.mjs'

function makeProj({ rootCargo, workspaceFlat, workspaceTauri, rootPkg }) {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-cargo-'))
  if (rootCargo) writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="foo"\nversion="0.1.0"\n')
  if (rootPkg) writeFileSync(join(dir, 'package.json'), JSON.stringify(rootPkg))
  if (workspaceFlat) {
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(join(dir, 'app', 'Cargo.toml'), '[package]\nname="app"\nversion="0.1.0"\n')
  }
  if (workspaceTauri) {
    mkdirSync(join(dir, 'app', 'src-tauri'), { recursive: true })
    writeFileSync(join(dir, 'app', 'src-tauri', 'Cargo.toml'), '[package]\nname="tauri"\nversion="0.1.0"\n')
  }
  return dir
}

describe('resolveCargoManifest', () => {
  test('cwd/Cargo.toml існує — повертає його', async () => {
    const dir = makeProj({ rootCargo: true })
    expect(await resolveCargoManifest(dir)).toBe(join(dir, 'Cargo.toml'))
    rmSync(dir, { recursive: true, force: true })
  })

  test('Tauri-патерн — повертає <workspace>/src-tauri/Cargo.toml', async () => {
    const dir = makeProj({ rootPkg: { workspaces: ['app'] }, workspaceTauri: true })
    expect(await resolveCargoManifest(dir)).toBe(join(dir, 'app', 'src-tauri', 'Cargo.toml'))
    rmSync(dir, { recursive: true, force: true })
  })

  test('flat workspace — повертає <workspace>/Cargo.toml', async () => {
    const dir = makeProj({ rootPkg: { workspaces: ['app'] }, workspaceFlat: true })
    expect(await resolveCargoManifest(dir)).toBe(join(dir, 'app', 'Cargo.toml'))
    rmSync(dir, { recursive: true, force: true })
  })

  test('Tauri має пріоритет над flat у тому ж workspace', async () => {
    const dir = makeProj({ rootPkg: { workspaces: ['app'] }, workspaceFlat: true, workspaceTauri: true })
    expect(await resolveCargoManifest(dir)).toBe(join(dir, 'app', 'src-tauri', 'Cargo.toml'))
    rmSync(dir, { recursive: true, force: true })
  })

  test('ні root, ні workspaces без Cargo.toml — null', async () => {
    const dir = makeProj({ rootPkg: { workspaces: ['app'] } })
    expect(await resolveCargoManifest(dir)).toBe(null)
    rmSync(dir, { recursive: true, force: true })
  })

  test('кореневий package.json відсутній і Cargo.toml відсутній — null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-cargo-empty-'))
    expect(await resolveCargoManifest(dir)).toBe(null)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2.2: Запустити — переконатись що падає**

```bash
bun test scripts/utils/tests/resolve-cargo-manifest.test.mjs
```

Expected: FAIL — `Cannot find module '../resolve-cargo-manifest.mjs'`.

- [ ] **Step 2.3: Реалізувати модуль**

```js
/**
 * Резолвить шлях до Cargo.toml у проєкті: cwd/Cargo.toml або в одному з
 * workspace-підкаталогів (з підтримкою Tauri-патерну `<workspace>/src-tauri/`).
 * Спільна утиліта для coverage-провайдера rust і test-концерну cargo_mutants_config.
 * Повертає null (а не throw) щоб callsite-и могли gracefully skip-нути.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string|null>} абсолютний шлях до Cargo.toml або null
 */
export async function resolveCargoManifest(cwd) {
  const rootManifest = join(cwd, 'Cargo.toml')
  if (existsSync(rootManifest)) return rootManifest

  const rootPkgPath = join(cwd, 'package.json')
  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
    const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
    for (const ws of workspaces) {
      const tauri = join(cwd, ws, 'src-tauri', 'Cargo.toml')
      if (existsSync(tauri)) return tauri
      const flat = join(cwd, ws, 'Cargo.toml')
      if (existsSync(flat)) return flat
    }
  }
  return null
}
```

- [ ] **Step 2.4: Запустити — переконатись що проходить**

```bash
bun test scripts/utils/tests/resolve-cargo-manifest.test.mjs
```

Expected: PASS — 6 тестів зелені.

- [ ] **Step 2.5: Verify**

```bash
git status npm/scripts/utils/resolve-cargo-manifest.mjs npm/scripts/utils/tests/resolve-cargo-manifest.test.mjs
```

---

## Task 3: Refactor js-lint coverage provider — реюз resolveJsRoot

**Files:**

- Modify: `npm/rules/js-lint/coverage/coverage.mjs`

- [ ] **Step 3.1: Замінити локальну `resolveJsRoot` на імпорт**

У `npm/rules/js-lint/coverage/coverage.mjs`:

Замінити:

```js
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Резолвить cwd, у якому стоять JS-тести. Workspace-проєкти — перший workspace
 * (наприклад: app/), single-package — корінь.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string|null>} абсолютний шлях до JS-root або null без package.json
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
```

На:

```js
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveJsRoot } from '../../../scripts/utils/resolve-js-root.mjs'
```

- [ ] **Step 3.2: Оновити error hint при missing `mutation.json`**

Замінити в `collect()`:

```js
} catch {
  throw new Error('js-lint coverage: stryker не залишив mutation.json — перевір stryker.config.mjs у проєкті')
}
```

На:

```js
} catch {
  throw new Error(
    'js-lint coverage: stryker не залишив mutation.json — ' +
      'запусти `npx @nitra/cursor fix test` для встановлення canonical stryker.config.mjs, ' +
      'або налаштуй його вручну'
  )
}
```

- [ ] **Step 3.3: Перевірити що `existsSync` все ще потрібен**

`detect()` все ще використовує `existsSync` для перевірки package.json у jsRoot. Імпорт лишається.

- [ ] **Step 3.4: Оновити тест на новий hint-format**

У `npm/rules/js-lint/coverage/tests/coverage.test.mjs` знайти:

```js
const MUTATION_JSON_RE = /mutation\.json/
```

Замінити на:

```js
const MUTATION_JSON_RE = /запусти `npx @nitra\/cursor fix test`/
```

Це фіксує regression-тест на canonical hint (не лише substring `mutation.json`).

- [ ] **Step 3.5: Запустити js-lint coverage тести**

```bash
bun test rules/js-lint/coverage/tests/coverage.test.mjs
```

Expected: PASS — 8 тестів зелені.

- [ ] **Step 3.6: Verify**

```bash
git diff npm/rules/js-lint/coverage/coverage.mjs npm/rules/js-lint/coverage/tests/coverage.test.mjs
```

---

## Task 4: Refactor rust coverage provider — реюз resolveCargoManifest

**Files:**

- Modify: `npm/rules/rust/coverage/coverage.mjs`

- [ ] **Step 4.1: Замінити локальну `resolveCargoManifest` на імпорт**

У `npm/rules/rust/coverage/coverage.mjs`:

Замінити:

```js
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hasCargoTomlInTree } from '../lib/has-cargo-toml.mjs'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo', 'target'])

// ... detect() лишається ...

/**
 * Знайти Cargo.toml: cwd/Cargo.toml або в одному з workspace-підкаталогів.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string>} абсолютний шлях до Cargo.toml
 */
async function resolveCargoManifest(cwd) {
  const rootManifest = join(cwd, 'Cargo.toml')
  if (existsSync(rootManifest)) return rootManifest

  const rootPkgPath = join(cwd, 'package.json')
  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
    const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
    for (const ws of workspaces) {
      const tauriManifest = join(cwd, ws, 'src-tauri', 'Cargo.toml')
      if (existsSync(tauriManifest)) return tauriManifest
      const flatManifest = join(cwd, ws, 'Cargo.toml')
      if (existsSync(flatManifest)) return flatManifest
    }
  }

  throw new Error('rust coverage: Cargo.toml не знайдено (cwd + workspaces)')
}
```

На:

```js
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hasCargoTomlInTree } from '../lib/has-cargo-toml.mjs'
import { resolveCargoManifest } from '../../../scripts/utils/resolve-cargo-manifest.mjs'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo', 'target'])

// ... detect() лишається ...
```

- [ ] **Step 4.2: Адаптувати null-контракт у `collect()`**

Знайти в `collect()`:

```js
const manifestPath = await resolveCargoManifest(cwd)
```

Залишити рядок як є — `resolveCargoManifest` тепер shared утиліта, але додати перевірку `null` після нього:

```js
const manifestPath = await resolveCargoManifest(cwd)
if (manifestPath === null) {
  throw new Error('rust coverage: Cargo.toml не знайдено (cwd + workspaces)')
}
```

Це зберігає попередній user-facing message при missing manifest.

- [ ] **Step 4.3: Запустити rust coverage тести**

```bash
bun test rules/rust/coverage/tests/coverage.test.mjs
```

Expected: PASS — 6 тестів зелені.

- [ ] **Step 4.4: Verify**

```bash
git diff npm/rules/rust/coverage/coverage.mjs
```

---

## Task 5: Концерн `stryker_config` — baseline data

**Files:**

- Create: `npm/rules/test/js/data/stryker_config/stryker.config.baseline.mjs`

- [ ] **Step 5.1: Створити каталог + baseline**

```bash
mkdir -p /Users/vitaliytv/www/nitra/cursor/npm/rules/test/js/data/stryker_config
```

- [ ] **Step 5.2: Написати canonical baseline**

`npm/rules/test/js/data/stryker_config/stryker.config.baseline.mjs`:

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

- [ ] **Step 5.3: Verify**

```bash
cat /Users/vitaliytv/www/nitra/cursor/npm/rules/test/js/data/stryker_config/stryker.config.baseline.mjs
```

Expected: 7-line baseline видно.

---

## Task 6: Концерн `stryker_config` — TDD test → impl

**Files:**

- Create: `npm/rules/test/js/stryker_config.mjs`
- Create: `npm/rules/test/js/tests/stryker_config.test.mjs`

- [ ] **Step 6.1: Написати failing test**

`npm/rules/test/js/tests/stryker_config.test.mjs`:

```js
/**
 * Тести концерну `stryker_config` (test.mdc): self-gates через js-lint
 * у `.n-cursor.json#rules`, side-effect-копіює canonical baseline у jsRoot
 * якщо stryker.config.mjs відсутній.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { chdir, cwd as getCwd } from 'node:process'
import { join } from 'node:path'

import { check } from '../stryker_config.mjs'

/**
 * Створює тимчасовий проєкт із заданим `.n-cursor.json#rules` і опційним
 * workspace-layout. Повертає {cwd, cleanup}.
 */
function makeProj({ rules = [], disableRules = [], workspaceRoot = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stryker-config-concern-'))
  writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules, 'disable-rules': disableRules }))
  if (workspaceRoot) {
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'] }))
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app' }))
  } else {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pkg' }))
  }
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/**
 * Викликає check() з chdir у заданий каталог, щоб концерн читав .n-cursor.json
 * саме звідти (бо check читає process.cwd()).
 */
async function runCheckIn(dir) {
  const prev = getCwd()
  chdir(dir)
  try {
    return await check()
  } finally {
    chdir(prev)
  }
}

describe('stryker_config concern', () => {
  test('js-lint НЕ в rules — silent skip, exit 0, файл не створюється', async () => {
    const proj = makeProj({ rules: ['test'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'stryker.config.mjs'))).toBe(false)
    proj.cleanup()
  })

  test('js-lint у disable-rules — silent skip', async () => {
    const proj = makeProj({ rules: ['js-lint', 'test'], disableRules: ['js-lint'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'stryker.config.mjs'))).toBe(false)
    proj.cleanup()
  })

  test('js-lint enabled + stryker.config.mjs відсутній — копіює baseline у cwd (single-package)', async () => {
    const proj = makeProj({ rules: ['js-lint'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const target = join(proj.dir, 'stryker.config.mjs')
    expect(existsSync(target)).toBe(true)
    const content = readFileSync(target, 'utf8')
    expect(content).toContain("testRunner: 'command'")
    expect(content).toContain("commandRunner: { command: 'bun test' }")
    expect(content).toContain("jsonReporter: { fileName: 'reports/stryker/mutation.json' }")
    proj.cleanup()
  })

  test('js-lint enabled + workspace — копіює у workspaces[0] (app/)', async () => {
    const proj = makeProj({ rules: ['js-lint'], workspaceRoot: true })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'app', 'stryker.config.mjs'))).toBe(true)
    expect(existsSync(join(proj.dir, 'stryker.config.mjs'))).toBe(false)
    proj.cleanup()
  })

  test('js-lint enabled + stryker.config.mjs існує — не перезаписує', async () => {
    const proj = makeProj({ rules: ['js-lint'] })
    const target = join(proj.dir, 'stryker.config.mjs')
    writeFileSync(target, '// custom config')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('// custom config')
    proj.cleanup()
  })

  test('js-lint enabled + кореневий package.json відсутній — fail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stryker-no-pkg-'))
    writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['js-lint'] }))
    const exitCode = await runCheckIn(dir)
    expect(exitCode).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 6.2: Запустити — переконатись що падає**

```bash
bun test rules/test/js/tests/stryker_config.test.mjs
```

Expected: FAIL — `Cannot find module '../stryker_config.mjs'`.

- [ ] **Step 6.3: Реалізувати концерн**

`npm/rules/test/js/stryker_config.mjs`:

```js
/**
 * Концерн `stryker_config` правила test (test.mdc): якщо `js-lint` присутнє в
 * `.n-cursor.json#rules` і не у `disable-rules` — резолвить jsRoot (workspaces[0]
 * або cwd) і копіює canonical baseline `stryker.config.mjs` якщо файлу немає.
 *
 * Self-gating: концерн silently skips коли `js-lint` не enabled — це навмисно,
 * щоб не шуміти у single-language проєктах без JS coverage tooling.
 *
 * Baseline — мінімум для запуску Stryker з bun test runner; mutate-патерни
 * лишаються на Stryker defaults (`src/**\/*.{js,mjs,ts,jsx,tsx,cjs}`).
 */
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { resolveJsRoot } from '../../../scripts/utils/resolve-js-root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASELINE_PATH = join(HERE, 'data', 'stryker_config', 'stryker.config.baseline.mjs')

/**
 * @returns {Promise<number>} 0 — OK або silently skipped, 1 — порушення
 */
export async function check() {
  const reporter = createCheckReporter()
  const cwd = process.cwd()
  const config = await readNCursorConfigLite(cwd)

  // Self-gate: js-lint має бути enabled
  if (!config.rules.includes('js-lint') || config.disableRules.includes('js-lint')) {
    return reporter.getExitCode()
  }

  const jsRoot = await resolveJsRoot(cwd)
  if (jsRoot === null) {
    reporter.fail('test: js-lint enabled, але кореневий package.json не знайдено (test.mdc)')
    return reporter.getExitCode()
  }

  const target = join(jsRoot, 'stryker.config.mjs')
  if (existsSync(target)) {
    reporter.pass(`stryker.config.mjs існує (${relative(cwd, target)})`)
    return reporter.getExitCode()
  }

  if (!existsSync(BASELINE_PATH)) {
    reporter.fail(
      `stryker.config.mjs відсутній і canonical baseline не знайдено (${BASELINE_PATH}) — перевстанови @nitra/cursor`
    )
    return reporter.getExitCode()
  }

  await copyFile(BASELINE_PATH, target)
  reporter.pass(`stryker.config.mjs створено з canonical baseline (${relative(cwd, target)}) (test.mdc)`)
  return reporter.getExitCode()
}
```

- [ ] **Step 6.4: Запустити — переконатись що проходить**

```bash
bun test rules/test/js/tests/stryker_config.test.mjs
```

Expected: PASS — 6 тестів зелені.

- [ ] **Step 6.5: Verify**

```bash
git status npm/rules/test/js/stryker_config.mjs npm/rules/test/js/tests/stryker_config.test.mjs
```

---

## Task 7: Концерн `cargo_mutants_config` — baseline data

**Files:**

- Create: `npm/rules/test/js/data/cargo_mutants_config/mutants.toml.baseline`

- [ ] **Step 7.1: Створити каталог + baseline**

```bash
mkdir -p /Users/vitaliytv/www/nitra/cursor/npm/rules/test/js/data/cargo_mutants_config
```

- [ ] **Step 7.2: Написати canonical baseline**

`npm/rules/test/js/data/cargo_mutants_config/mutants.toml.baseline`:

```toml
# .cargo/mutants.toml — конфігурація cargo-mutants (опційно).
# cargo-mutants має робочі defaults; цей файл — стартова точка для customization.
# Документація: https://mutants.rs/
# Канон постачає правило `test` (@nitra/cursor).
```

- [ ] **Step 7.3: Verify**

```bash
cat /Users/vitaliytv/www/nitra/cursor/npm/rules/test/js/data/cargo_mutants_config/mutants.toml.baseline
```

Expected: 4-line comment baseline видно.

---

## Task 8: Концерн `cargo_mutants_config` — TDD test → impl

**Files:**

- Create: `npm/rules/test/js/cargo_mutants_config.mjs`
- Create: `npm/rules/test/js/tests/cargo_mutants_config.test.mjs`

- [ ] **Step 8.1: Написати failing test**

`npm/rules/test/js/tests/cargo_mutants_config.test.mjs`:

```js
/**
 * Тести концерну `cargo_mutants_config` (test.mdc): self-gates через rust
 * у `.n-cursor.json#rules`, side-effect-копіює canonical baseline у
 * <cargoDir>/.cargo/mutants.toml якщо відсутній.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chdir, cwd as getCwd } from 'node:process'

import { check } from '../cargo_mutants_config.mjs'

function makeProj({ rules = [], disableRules = [], layout = 'flat' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mutants-config-concern-'))
  writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules, 'disable-rules': disableRules }))
  if (layout === 'flat') {
    // Cargo.toml у cwd
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n')
  } else if (layout === 'tauri') {
    // <workspace>/src-tauri/Cargo.toml
    mkdirSync(join(dir, 'app', 'src-tauri'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'] }))
    writeFileSync(join(dir, 'app', 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\nversion="0.1.0"\n')
  } else if (layout === 'noCargo') {
    // ні root, ні workspaces з Cargo.toml — rust enabled але manifest відсутній
  }
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function runCheckIn(dir) {
  const prev = getCwd()
  chdir(dir)
  try {
    return await check()
  } finally {
    chdir(prev)
  }
}

describe('cargo_mutants_config concern', () => {
  test('rust НЕ в rules — silent skip', async () => {
    const proj = makeProj({ rules: ['test'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, '.cargo', 'mutants.toml'))).toBe(false)
    proj.cleanup()
  })

  test('rust у disable-rules — silent skip', async () => {
    const proj = makeProj({ rules: ['rust'], disableRules: ['rust'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    proj.cleanup()
  })

  test('rust enabled + Cargo.toml у cwd — копіює baseline у cwd/.cargo/mutants.toml', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'flat' })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const target = join(proj.dir, '.cargo', 'mutants.toml')
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toContain('cargo-mutants')
    proj.cleanup()
  })

  test('rust enabled + Tauri-патерн — копіює у app/src-tauri/.cargo/mutants.toml', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'tauri' })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
    proj.cleanup()
  })

  test('rust enabled + .cargo/ існує — не псує існуючі файли всередині', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'flat' })
    const cargoDir = join(proj.dir, '.cargo')
    mkdirSync(cargoDir, { recursive: true })
    writeFileSync(join(cargoDir, 'config.toml'), '[build]\ntarget = "x86_64-unknown-linux-gnu"\n')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(cargoDir, 'mutants.toml'))).toBe(true)
    expect(readFileSync(join(cargoDir, 'config.toml'), 'utf8')).toContain('[build]')
    proj.cleanup()
  })

  test('rust enabled + mutants.toml існує — не перезаписує', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'flat' })
    const cargoDir = join(proj.dir, '.cargo')
    mkdirSync(cargoDir, { recursive: true })
    writeFileSync(join(cargoDir, 'mutants.toml'), '# my custom config')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(join(cargoDir, 'mutants.toml'), 'utf8')).toBe('# my custom config')
    proj.cleanup()
  })

  test('rust enabled, але Cargo.toml відсутній — silent skip (не fail)', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'noCargo' })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    proj.cleanup()
  })
})
```

- [ ] **Step 8.2: Запустити — переконатись що падає**

```bash
bun test rules/test/js/tests/cargo_mutants_config.test.mjs
```

Expected: FAIL — `Cannot find module '../cargo_mutants_config.mjs'`.

- [ ] **Step 8.3: Реалізувати концерн**

`npm/rules/test/js/cargo_mutants_config.mjs`:

```js
/**
 * Концерн `cargo_mutants_config` правила test (test.mdc): якщо `rust` присутнє
 * в `.n-cursor.json#rules` і не у `disable-rules` — резолвить Cargo.toml
 * (cwd або workspace) і копіює canonical baseline `.cargo/mutants.toml` у
 * каталог manifest'а, якщо файлу немає.
 *
 * Self-gating: концерн silently skips коли `rust` не enabled.
 * Якщо `rust` enabled, але Cargo.toml не знайдено — теж silently skip (manifest
 * може з'явитися пізніше; це не помилка).
 *
 * Baseline — порожній файл з коментом; cargo-mutants має робочі defaults.
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { resolveCargoManifest } from '../../../scripts/utils/resolve-cargo-manifest.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASELINE_PATH = join(HERE, 'data', 'cargo_mutants_config', 'mutants.toml.baseline')

/**
 * @returns {Promise<number>} 0 — OK або silently skipped, 1 — порушення
 */
export async function check() {
  const reporter = createCheckReporter()
  const cwd = process.cwd()
  const config = await readNCursorConfigLite(cwd)

  // Self-gate: rust має бути enabled
  if (!config.rules.includes('rust') || config.disableRules.includes('rust')) {
    return reporter.getExitCode()
  }

  const manifestPath = await resolveCargoManifest(cwd)
  if (manifestPath === null) {
    // rust enabled, але Cargo.toml ще немає — silently skip (manifest може з'явитися пізніше)
    return reporter.getExitCode()
  }

  const cargoDir = dirname(manifestPath)
  const target = join(cargoDir, '.cargo', 'mutants.toml')

  if (existsSync(target)) {
    reporter.pass(`.cargo/mutants.toml існує (${relative(cwd, target)})`)
    return reporter.getExitCode()
  }

  if (!existsSync(BASELINE_PATH)) {
    reporter.fail(
      `.cargo/mutants.toml відсутній і canonical baseline не знайдено (${BASELINE_PATH}) — перевстанови @nitra/cursor`
    )
    return reporter.getExitCode()
  }

  await mkdir(dirname(target), { recursive: true })
  await copyFile(BASELINE_PATH, target)
  reporter.pass(`.cargo/mutants.toml створено з canonical baseline (${relative(cwd, target)}) (test.mdc)`)
  return reporter.getExitCode()
}
```

- [ ] **Step 8.4: Запустити — переконатись що проходить**

```bash
bun test rules/test/js/tests/cargo_mutants_config.test.mjs
```

Expected: PASS — 7 тестів зелені.

- [ ] **Step 8.5: Verify**

```bash
git status npm/rules/test/js/cargo_mutants_config.mjs npm/rules/test/js/tests/cargo_mutants_config.test.mjs
```

---

## Task 9: `test.mdc` — alwaysApply: false + нові globs + секція

**Files:**

- Modify: `npm/rules/test/test.mdc`

- [ ] **Step 9.1: Оновити frontmatter**

У `npm/rules/test/test.mdc` замінити перший блок:

```yaml
---
description: JS-тести (*.test.mjs) живуть у каталозі tests/ поряд із джерельним файлом, а не безпосередньо в тій же директорії
version: '1.2'
alwaysApply: true
---
```

На:

```yaml
---
description: JS-тести (*.test.mjs) живуть у tests/. Правило `test` керує stryker.config.mjs (якщо js-lint enabled) і .cargo/mutants.toml (якщо rust enabled).
version: '2.0'
globs: '**/{.n-cursor.json,package.json,Cargo.toml,stryker.config.mjs,.cargo/mutants.toml},**/*.test.mjs'
alwaysApply: false
---
```

- [ ] **Step 9.2: Додати секцію «Налаштування mutation-testing»**

Після поточної секції «Покриття + мутаційне тестування» (приблизно після останнього markdown-лінка на `package.json.contains.json`) додати:

```markdown
## Налаштування mutation-testing

Якщо у `.n-cursor.json#rules` присутнє правило `js-lint` — правило `test` створює canonical baseline `stryker.config.mjs` у JS-root проєкту (`workspaces[0]` або корінь), якщо файлу немає.

Канон Stryker config (мінімум для роботи з `bun test`): [stryker.config.baseline.mjs](./js/data/stryker_config/stryker.config.baseline.mjs)

Аналогічно, якщо `rust` присутнє в `rules` — створюється `.cargo/mutants.toml` у каталозі Cargo.toml-маніфесту (з підтримкою Tauri-патерну `<workspace>/src-tauri/`):

Канон cargo-mutants config: [mutants.toml.baseline](./js/data/cargo_mutants_config/mutants.toml.baseline)

Customization (mutate patterns, exclude rules, timeout) — відповідальність проєкту-споживача; концерни лише забезпечують наявність файлу як стартового baseline.
```

- [ ] **Step 9.3: Verify**

```bash
git diff npm/rules/test/test.mdc
```

Expected: бачимо `version: '2.0'`, `alwaysApply: false`, нові globs, нова секція.

---

## Task 10: Full test-suite + lint-rego

- [ ] **Step 10.1: Прогнати весь test suite**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun test 2>&1 | tail -10
```

Expected: усі тести зелені (988+ pass, 0 fail, окрім integration-test про version bump, який вирішується у Task 11).

- [ ] **Step 10.2: Прогнати lint-rego**

```bash
rm -rf node_modules/.cache/n-cursor/lint-rego
bun bin/n-cursor.js lint-rego
```

Expected: exit 0, 497+ conftest tests pass, regal 0 violations.

---

## Task 11: Version bump + CHANGELOG

**Files:**

- Modify: `npm/package.json`
- Modify: `npm/CHANGELOG.md`

- [ ] **Step 11.1: Bump version**

У `npm/package.json` замінити:

```json
  "version": "1.17.1",
```

на:

```json
  "version": "1.18.0",
```

- [ ] **Step 11.2: Додати секцію в CHANGELOG**

У `npm/CHANGELOG.md` знайти рядок:

```
Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), нумерація — [SemVer](https://semver.org/lang/uk/).
```

Додати після нього (перед `## [1.17.1]`):

```markdown
## [1.18.0] - 2026-05-24

### Added

- Правило `test`: два нових концерни — `stryker_config` і `cargo_mutants_config`. Self-gating через `.n-cursor.json#rules`: концерн активний лише якщо відповідне залежне правило (`js-lint` / `rust`) enabled. При відсутності цільового файлу копіює canonical baseline:
  - `stryker.config.mjs` у JS-root (workspaces[0] або cwd) — мінімум для роботи з `bun test`.
  - `.cargo/mutants.toml` у dir-і Cargo.toml-маніфесту (з підтримкою Tauri-патерну) — комент-плейсхолдер; cargo-mutants має робочі defaults.
- Спільні резолвери `resolveJsRoot` і `resolveCargoManifest` у `npm/scripts/utils/`. Замінюють локальні копії в coverage-провайдерах js-lint і rust.

### Changed

- `test.mdc` 1.2 → 2.0 (major): `alwaysApply: true → false`; явні `globs` (`.n-cursor.json`, `package.json`, `Cargo.toml`, mutation-config-цілі, `*.test.mjs`). Нова секція «Налаштування mutation-testing» з посиланнями на baselines.
- `js-lint/coverage/coverage.mjs`: hint при missing `mutation.json` тепер вказує на `npx @nitra/cursor fix test`. `resolveJsRoot` витягнуто у спільний модуль.
- `rust/coverage/coverage.mjs`: `resolveCargoManifest` витягнуто у спільний модуль (контракт `null` замість throw для missing manifest; user-facing throw зберігся на callsite).
```

- [ ] **Step 11.3: Запустити `npx @nitra/cursor fix changelog`**

```bash
cd /Users/vitaliytv/www/nitra/cursor
npx @nitra/cursor fix changelog
```

Expected: `Результат: 1/1 правил без зауважень`; знайдено запис для версії 1.18.0.

- [ ] **Step 11.4: Final test + lint-rego прогін після bump**

```bash
cd npm
bun test 2>&1 | tail -6
rm -rf node_modules/.cache/n-cursor/lint-rego
bun bin/n-cursor.js lint-rego
```

Expected: усі тести зелені, lint-rego clean.

- [ ] **Step 11.5: Self-перевірка через `npx @nitra/cursor fix test`**

```bash
cd /Users/vitaliytv/www/nitra/cursor
rm -rf npm/node_modules/.cache/n-cursor/fix-test
npx @nitra/cursor fix test 2>&1 | tail -20
```

Expected:

- `location` концерн: проходить (всі `*.test.mjs` у `tests/`).
- `stryker_config` концерн: `js-lint` у `.n-cursor.json#rules` → видить що `npm/stryker.config.mjs` (workspaces[0] = 'npm') відсутній → копіює baseline → `pass`.
- `cargo_mutants_config` концерн: `rust` НЕ в `.n-cursor.json#rules` у `@nitra/cursor` (немає Cargo.toml у корені) → silent skip.

Якщо `stryker.config.mjs` створено у `npm/` — це очікувано (це side-effect рішення). Користувач може вирішити, лишати чи прибирати.

- [ ] **Step 11.6: Final review**

```bash
git status
git diff --stat
```

Expected:

- Modified: `npm/package.json`, `npm/CHANGELOG.md`, `npm/rules/test/test.mdc`, `npm/rules/js-lint/coverage/coverage.mjs`, `npm/rules/js-lint/coverage/tests/coverage.test.mjs`, `npm/rules/rust/coverage/coverage.mjs`
- Untracked: `npm/scripts/utils/resolve-js-root.mjs`, `npm/scripts/utils/resolve-cargo-manifest.mjs`, `npm/scripts/utils/tests/resolve-js-root.test.mjs`, `npm/scripts/utils/tests/resolve-cargo-manifest.test.mjs`, `npm/rules/test/js/stryker_config.mjs`, `npm/rules/test/js/cargo_mutants_config.mjs`, `npm/rules/test/js/data/`, `npm/rules/test/js/tests/stryker_config.test.mjs`, `npm/rules/test/js/tests/cargo_mutants_config.test.mjs`
- Possibly: `npm/stryker.config.mjs` (створений self-перевіркою у Step 11.5)

---

## Self-Review Checklist

**Spec coverage:**

- [ ] M1 (per-concern self-gating через readNCursorConfigLite): Tasks 6, 8 — концерни читають config і skip silently. ✓
- [ ] M2 (мінімум baseline): Tasks 5, 7 — Stryker 7-line + mutants.toml порожній з коментами. ✓
- [ ] M3 (резолвери в scripts/utils/): Tasks 1, 2. Refactor у Tasks 3, 4. ✓
- [ ] M4 (test.mdc alwaysApply: false + globs + версія 2.0): Task 9. ✓
- [ ] M5 (coverage provider hints): Task 3 Step 3.2 для js-lint. Rust — без змін за дизайном. ✓
- [ ] M6 (скоуп — лише config-management, не змінюємо парсинг): тести й код підтверджують. ✓
- [ ] M7 (version 1.18.0): Task 11. ✓

**Placeholder scan:** жодного "TBD/TODO/implement later/appropriate error handling". Усі steps з конкретним кодом або командами. ✓

**Type consistency:**

- `resolveJsRoot(cwd) → Promise<string|null>` узгоджено: Tasks 1, 3, 6.
- `resolveCargoManifest(cwd) → Promise<string|null>` узгоджено: Tasks 2, 4, 8.
- `check() → Promise<number>` (exit code) — стандартний концерн-контракт; Tasks 6, 8.
- `readNCursorConfigLite(cwd) → Promise<{exists, rules, disableRules}>` (з existing infra) — Tasks 6, 8.

---

## Execution Choice

**Plan complete and saved to `docs/superpowers/plans/2026-05-24-test-rule-mutation-config.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
