# Lint quick/ci split (E1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Розщепити lint на `n-cursor lint` (quick, по змінених) і `n-cursor lint-ci` (повний) — data-driven через одне поле `meta.json.lint` (E1); виконавець кроку — `js/lint.mjs` правила.

**Architecture:** Оркестратор `lint-cli.mjs` сканує `rules/*/meta.json`, бере правила за `lint:"quick"|"ci"`, послідовно викликає `js/lint.mjs` кожного (quick → передає змінені файли, ci → undefined). Композит js-lint розщеплено на `js-lint` (quick: oxlint+eslint) і `js-lint-ci` (ci: jscpd+knip). Заміняє наявний timing-only `runLintCli`.

**Tech Stack:** Node ESM (.mjs), vitest, spawnSync (git + лінтери), наявний `rule-meta.mjs` (Spec B), `withLock`.

**Канон:** новий `.mjs` — верхній JSDoc українською; тести співрозташовані (`cd npm && npx vitest run`); НЕ `process.chdir` у тестах (`withTmpDir`+`cwd:dir`); кроки строго послідовні (заборона паралельного eslint); коміти часті; версію/CHANGELOG не руками (change-файл).

**Поточний стан:**

- `npm/bin/n-cursor.js:1466` `case 'lint'` → `runLintCli()` (timing-оркестратор). **Замінюємо**; додаємо `case 'lint-ci'`.
- `npm/scripts/lib/run-lint-cli.mjs` — старий timing-оркестратор; стане мертвим — видалити в Task 7 (звірити knip).
- `lint-ga`/`lint-text`/`lint-rego` (CLI пакета) НЕ приймають файли → `ci`.
- `rule-meta.mjs` (Spec B): `parseRuleAutoSpec`, `readRuleMetaRaw`. Схема має лише `auto`.
- Кореневий `package.json`: `lint-js = bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip --no-config-hints`; `lint-style = npx stylelint '**/*.{css,scss,vue}' --fix`.

---

## Task 1: Поле `lint` у парсері rule-meta + схема

**Files:** Modify `npm/scripts/lib/rule-meta.mjs`, `npm/scripts/lib/tests/rule-meta.test.mjs`, `npm/schemas/rule-meta.json`

- [ ] **Step 1: Падаючий тест** — додати у `rule-meta.test.mjs`:

```js
import { parseRuleLintPhase } from '../rule-meta.mjs'

describe('parseRuleLintPhase', () => {
  test('"quick" / "ci" → значення', () => {
    expect(parseRuleLintPhase('quick')).toBe('quick')
    expect(parseRuleLintPhase('ci')).toBe('ci')
  })
  test('відсутнє / невалідне → null', () => {
    expect(parseRuleLintPhase(undefined)).toBeNull()
    expect(parseRuleLintPhase('all')).toBeNull()
    expect(parseRuleLintPhase(42)).toBeNull()
  })
})
```

> Якщо `describe/test/expect` уже імпортовані — не дублювати; додати лише `parseRuleLintPhase` в наявний import з `../rule-meta.mjs`.

- [ ] **Step 2: FAIL** — `cd npm && npx vitest run scripts/lib/tests/rule-meta.test.mjs` → `parseRuleLintPhase is not a function`.

- [ ] **Step 3: Реалізувати** — у `rule-meta.mjs` додати:

```js
/** Допустимі фази lint. */
const LINT_PHASES = new Set(['quick', 'ci'])

/**
 * Нормалізує значення `meta.json.lint` у фазу lint.
 * @param {unknown} value значення поля `lint`
 * @returns {'quick' | 'ci' | null} фаза або `null` (відсутнє/невалідне = не lint-крок)
 */
export function parseRuleLintPhase(value) {
  return typeof value === 'string' && LINT_PHASES.has(value) ? /** @type {'quick'|'ci'} */ (value) : null
}
```

- [ ] **Step 4: PASS** — `cd npm && npx vitest run scripts/lib/tests/rule-meta.test.mjs`.

- [ ] **Step 5: Схема** — у `npm/schemas/rule-meta.json` `properties` додати після `auto`:

```json
    "lint": { "type": "string", "enum": ["quick", "ci"], "description": "Фаза lint-кроку: quick (по змінених, у lint і lint-ci) або ci (лише lint-ci)." }
```

- [ ] **Step 6: ajv-перевірка** — `cd npm && node -e "const A=require('ajv');const a=new (A.default||A)({allErrors:true});const v=a.compile(require('./schemas/rule-meta.json'));console.log('quick:',v({lint:'quick'}),'all-bad:',v({lint:'all'})===false);const fs=require('fs');let bad=0;for(const d of fs.readdirSync('rules')){const p='rules/'+d+'/meta.json';if(fs.existsSync(p)&&!v(JSON.parse(fs.readFileSync(p))))bad++}console.log('invalid:',bad)"` → `quick: true all-bad: true`, `invalid: 0`.

- [ ] **Step 7: Коміт**

```bash
git add npm/scripts/lib/rule-meta.mjs npm/scripts/lib/tests/rule-meta.test.mjs npm/schemas/rule-meta.json
git commit -m "feat(rule-meta): поле lint (quick/ci) у парсері + схемі

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `changed-files.mjs` (git diff HEAD + untracked)

**Files:** Create `npm/scripts/lib/changed-files.mjs` + `npm/scripts/lib/tests/changed-files.test.mjs`

- [ ] **Step 1: Падаючий тест**

```js
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { collectChangedFiles } from '../changed-files.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

function initRepo(dir) {
  spawnSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'base.js'), 'export const a = 1\n', 'utf8')
  spawnSync('git', ['add', '.'], { cwd: dir })
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

describe('collectChangedFiles', () => {
  test('modified tracked + untracked', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      writeFileSync(join(dir, 'base.js'), 'export const a = 2\n', 'utf8')
      writeFileSync(join(dir, 'new.ts'), 'export const b = 3\n', 'utf8')
      const files = collectChangedFiles(dir)
      expect(files).toContain('base.js')
      expect(files).toContain('new.ts')
    })
  })
  test('чисте дерево → порожньо', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      expect(collectChangedFiles(dir)).toEqual([])
    })
  })
  test('поза git → порожньо', async () => {
    await withTmpDir(async dir => {
      expect(collectChangedFiles(dir)).toEqual([])
    })
  })
})
```

- [ ] **Step 2: FAIL** — `cd npm && npx vitest run scripts/lib/tests/changed-files.test.mjs`.

- [ ] **Step 3: Реалізувати `changed-files.mjs`**

```js
/**
 * Збір змінених файлів для quick-режиму lint-оркестратора.
 *
 * Quick лінтить лише те, що змінено в робочому дереві: tracked-modified + staged
 * (`git diff HEAD`) і нові untracked (`git ls-files --others --exclude-standard`).
 * Видалені файли не повертаються. Поза git-репо або при помилці git — порожній список.
 */
import { spawnSync } from 'node:child_process'

/**
 * @param {string[]} args аргументи git
 * @param {string} cwd корінь
 * @returns {string[]} непорожні рядки stdout або [] при помилці
 */
function gitLines(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0 || r.error) return []
  return r.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Relative-posix список змінених + untracked файлів робочого дерева.
 * @param {string} [cwd] корінь репо
 * @returns {string[]} унікальні шляхи (без видалених)
 */
export function collectChangedFiles(cwd = process.cwd()) {
  const modified = gitLines(['diff', 'HEAD', '--name-only', '--diff-filter=ACMR'], cwd)
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard'], cwd)
  return [...new Set([...modified, ...untracked])]
}
```

- [ ] **Step 4: PASS** — `cd npm && npx vitest run scripts/lib/tests/changed-files.test.mjs`.

- [ ] **Step 5: Коміт**

```bash
git add npm/scripts/lib/changed-files.mjs npm/scripts/lib/tests/changed-files.test.mjs
git commit -m "feat(lint): collectChangedFiles (git diff HEAD + untracked)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `js/lint.mjs` для `js-lint` (quick: oxlint+eslint) + meta-поле

**Files:** Create `npm/rules/js-lint/js/lint.mjs` + `npm/rules/js-lint/js/tests/lint.test.mjs`; Modify `npm/rules/js-lint/meta.json`

- [ ] **Step 1: Падаючий тест** `npm/rules/js-lint/js/tests/lint.test.mjs`:

```js
import { describe, expect, test } from 'vitest'

import { filterJsFiles } from '../lint.mjs'

describe('filterJsFiles', () => {
  test('лишає лише js-подібні розширення', () => {
    expect(filterJsFiles(['a.js', 'b.ts', 'c.vue', 'd.css', 'e.md', 'f.tsx'])).toEqual([
      'a.js',
      'b.ts',
      'c.vue',
      'f.tsx'
    ])
  })
  test('порожній вхід → порожньо', () => {
    expect(filterJsFiles([])).toEqual([])
  })
})
```

> `lint(files)` (запуск oxlint/eslint) інтеграційно не юніт-тестуємо (дорого, потребує бінарів); покриваємо чисту `filterJsFiles`. Сам `lint` перевіряється smoke-прогоном у Task 6.

- [ ] **Step 2: FAIL** — `cd npm && npx vitest run rules/js-lint/js/tests/lint.test.mjs`.

- [ ] **Step 3: Реалізувати `npm/rules/js-lint/js/lint.mjs`**

```js
/**
 * Quick-крок lint правила js-lint: oxlint + eslint (з автофіксом).
 *
 * Викликається lint-оркестратором (`n-cursor lint` / `lint-ci`):
 *  - `files` = масив змінених файлів (quick) → лінтимо лише js-подібні з них;
 *  - `files` = undefined (ci) → лінтимо весь проєкт.
 * Крос-файлові jscpd/knip — окреме правило js-lint-ci (фаза ci).
 */
import { spawnSync } from 'node:child_process'

const JS_EXT_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx|vue)$/u

/**
 * Лишає лише js-подібні файли зі списку.
 * @param {string[]} files список шляхів
 * @returns {string[]} підмножина js-подібних
 */
export function filterJsFiles(files) {
  return files.filter(f => JS_EXT_RE.test(f))
}

/**
 * @param {string[]} args аргументи інструмента (бінар через bunx)
 * @param {string} cwd корінь
 * @returns {number} exit code
 */
function run(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, stdio: 'inherit' })
  return typeof r.status === 'number' ? r.status : 1
}

/**
 * Запускає oxlint+eslint з автофіксом.
 * @param {string[] | undefined} files quick: лише ці файли; undefined: весь проєкт
 * @param {string} [cwd] корінь репо
 * @returns {Promise<number>} 0 — OK, ≠0 — порушення
 */
export function lint(files, cwd = process.cwd()) {
  let oxArgs = ['oxlint', '--fix']
  let esArgs = ['eslint', '--fix']
  if (files === undefined) {
    esArgs.push('.')
  } else {
    const js = filterJsFiles(files)
    if (js.length === 0) return Promise.resolve(0)
    oxArgs = ['oxlint', '--fix', ...js]
    esArgs = ['eslint', '--fix', ...js]
  }
  const ox = run(oxArgs, cwd)
  if (ox !== 0) return Promise.resolve(ox)
  return Promise.resolve(run(esArgs, cwd))
}
```

- [ ] **Step 4: PASS** — `cd npm && npx vitest run rules/js-lint/js/tests/lint.test.mjs`.

- [ ] **Step 5: meta.json** — у `npm/rules/js-lint/meta.json` додати `"lint": "quick"` поряд з `auto`:

```json
{ "auto": { "glob": ["**/*.mjs", "**/*.cjs", "**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"] }, "lint": "quick" }
```

- [ ] **Step 6: Коміт**

```bash
git add npm/rules/js-lint/js/lint.mjs npm/rules/js-lint/js/tests/lint.test.mjs npm/rules/js-lint/meta.json
git commit -m "feat(js-lint): js/lint.mjs (oxlint+eslint) + lint:quick

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Нове правило `js-lint-ci` (jscpd+knip, фаза ci)

**Files:** Create `npm/rules/js-lint-ci/{js-lint-ci.mdc, meta.json, js/lint.mjs}`

- [ ] **Step 1: `meta.json`** — `npm/rules/js-lint-ci/meta.json`:

```json
{ "lint": "ci" }
```

- [ ] **Step 2: `js-lint-ci.mdc`** — `npm/rules/js-lint-ci/js-lint-ci.mdc`:

```markdown
---
description: Крос-файловий ci-етап js-lint — jscpd (детектор клонів) і knip (невикористані експорти). Лише у lint-ci, по всьому репо.
globs:
alwaysApply: true
---

# js-lint-ci — крос-файловий ci-етап

`jscpd` і `knip` аналізують увесь граф проєкту, тож мають сенс лише у повному прогоні
`npx @nitra/cursor lint-ci` (не в швидкому `lint` по змінених файлах). Per-file режиму нема.

Швидкий етап js-lint (oxlint/eslint) — у правилі `js-lint` (`lint: quick`).
```

- [ ] **Step 3: `js/lint.mjs`** — `npm/rules/js-lint-ci/js/lint.mjs`:

```js
/**
 * Ci-крок: jscpd (детектор клонів) + knip (невикористані експорти).
 *
 * Крос-файлові аналізатори — працюють лише по всьому репо, тож `files` ігнорується
 * (викликається лише у `lint-ci` з undefined). Per-file режиму ці інструменти не мають.
 */
import { spawnSync } from 'node:child_process'

/**
 * @param {string[] | undefined} _files ігнорується (крос-файловий аналіз)
 * @param {string} [cwd] корінь репо
 * @returns {Promise<number>} 0 — OK, ≠0 — порушення
 */
export function lint(_files, cwd = process.cwd()) {
  const jscpd = spawnSync('bunx', ['jscpd', '.'], { cwd, stdio: 'inherit' })
  const jc = typeof jscpd.status === 'number' ? jscpd.status : 1
  if (jc !== 0) return Promise.resolve(jc)
  const knip = spawnSync('bunx', ['knip', '--no-config-hints'], { cwd, stdio: 'inherit' })
  return Promise.resolve(typeof knip.status === 'number' ? knip.status : 1)
}
```

- [ ] **Step 4: Перевірити, що правило валідне (нема auto → opt-in, lint:ci)**

Run: `cd npm && node -e "const m=require('./scripts/lib/rule-meta.mjs');const raw=m.readRuleMetaRaw('rules/js-lint-ci');console.log('phase:', m.parseRuleLintPhase(raw.lint))"`
Expected: `phase: ci`.

- [ ] **Step 5: Коміт**

```bash
git add npm/rules/js-lint-ci/
git commit -m "feat(js-lint-ci): нове правило jscpd+knip (lint:ci, крос-файлове)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `lint-cli.mjs` оркестратор

**Files:** Create `npm/scripts/lint-cli.mjs` + `npm/scripts/tests/lint-cli.test.mjs`

- [ ] **Step 1: Падаючий тест** `npm/scripts/tests/lint-cli.test.mjs`:

```js
import { describe, expect, test } from 'vitest'

import { selectLintRules } from '../lint-cli.mjs'

const META = {
  'js-lint': { lint: 'quick' },
  'js-lint-ci': { lint: 'ci' },
  'style-lint': { lint: 'quick' },
  ga: { lint: 'ci' },
  adr: {}
}

describe('selectLintRules', () => {
  test('quick → лише quick-правила, алфавітно', () => {
    expect(selectLintRules(META, 'quick')).toEqual(['js-lint', 'style-lint'])
  })
  test('ci → quick + ci, алфавітно', () => {
    expect(selectLintRules(META, 'ci')).toEqual(['ga', 'js-lint', 'js-lint-ci', 'style-lint'])
  })
})
```

- [ ] **Step 2: FAIL** — `cd npm && npx vitest run scripts/tests/lint-cli.test.mjs`.

- [ ] **Step 3: Реалізувати `lint-cli.mjs`**

```js
/**
 * Оркестратор `n-cursor lint` (quick) / `n-cursor lint-ci` (full).
 *
 * Data-driven: сканує `rules/<id>/meta.json` за полем `lint` (`quick`|`ci`),
 * послідовно (заборона паралельного eslint) викликає `rules/<id>/js/lint.mjs`:
 *  - quick: `lint(changedFiles)` — лише змінені файли (git diff HEAD + untracked);
 *  - ci:    `lint(undefined)` — весь проєкт.
 * Порядок правил — алфавітний; ci-набір = quick ∪ ci. Fail-fast: перший ненульовий код спиняє.
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cwd as processCwd } from 'node:process'

import { parseRuleLintPhase, readRuleMetaRaw } from './lib/rule-meta.mjs'
import { collectChangedFiles } from './lib/changed-files.mjs'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RULES_DIR = join(PACKAGE_ROOT, 'rules')

/**
 * Вибирає id правил для фази, алфавітно.
 * @param {Record<string, {lint?: unknown}>} metaById мапа id → meta-обʼєкт
 * @param {'quick'|'ci'} phase цільова фаза (quick → лише quick; ci → quick+ci)
 * @returns {string[]} відсортовані id
 */
export function selectLintRules(metaById, phase) {
  const out = []
  for (const [id, raw] of Object.entries(metaById)) {
    const p = parseRuleLintPhase(raw?.lint)
    if (p === 'quick' || (phase === 'ci' && p === 'ci')) out.push(id)
  }
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Зчитує meta всіх правил пакета.
 * @param {string} rulesDir каталог rules
 * @returns {Record<string, Record<string, unknown>>} id → meta
 */
function readAllMeta(rulesDir) {
  const out = {}
  if (!existsSync(rulesDir)) return out
  for (const e of readdirSync(rulesDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const raw = readRuleMetaRaw(join(rulesDir, e.name))
    if (raw) out[e.name] = raw
  }
  return out
}

/**
 * Запускає lint-оркестрацію.
 * @param {{ ci?: boolean, cwd?: string, rulesDir?: string, log?: Function }} [opts] параметри
 * @returns {Promise<number>} exit code
 */
export async function runLint(opts = {}) {
  const ci = opts.ci === true
  const cwd = opts.cwd ?? processCwd()
  const rulesDir = opts.rulesDir ?? RULES_DIR
  const log = opts.log ?? (s => process.stdout.write(s))

  const changed = ci ? undefined : collectChangedFiles(cwd)
  if (!ci && changed.length === 0) {
    log('\nℹ️  lint: немає змінених файлів — нічого перевіряти.\n')
    return 0
  }

  const ids = selectLintRules(readAllMeta(rulesDir), ci ? 'ci' : 'quick')
  for (const id of ids) {
    const lintPath = join(rulesDir, id, 'js', 'lint.mjs')
    if (!existsSync(lintPath)) {
      log(`⚠️  lint: правило ${id} має lint-фазу, але немає js/lint.mjs — пропускаю.\n`)
      continue
    }
    // eslint-disable-next-line no-unsanitized/method -- шлях з discovered rule dir
    const mod = await import(lintPath)
    const code = await mod.lint(changed, cwd)
    if (code !== 0) return code
  }
  return 0
}
```

- [ ] **Step 4: PASS** — `cd npm && npx vitest run scripts/tests/lint-cli.test.mjs`.

- [ ] **Step 5: Коміт**

```bash
git add npm/scripts/lint-cli.mjs npm/scripts/tests/lint-cli.test.mjs
git commit -m "feat(lint): оркестратор runLint quick/ci (data-driven за meta.lint)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: style-lint quick + ci-фази для ga/rego/text/security

**Files:** Create `npm/rules/style-lint/js/lint.mjs` (+тест); Modify `meta.json` у `style-lint`, `ga`, `rego`, `text`, `security`

- [ ] **Step 1: Падаючий тест** `npm/rules/style-lint/js/tests/lint.test.mjs`:

```js
import { describe, expect, test } from 'vitest'
import { filterStyleFiles } from '../lint.mjs'

describe('filterStyleFiles', () => {
  test('лишає css/scss/vue', () => {
    expect(filterStyleFiles(['a.css', 'b.scss', 'c.vue', 'd.js'])).toEqual(['a.css', 'b.scss', 'c.vue'])
  })
})
```

- [ ] **Step 2: FAIL** — `cd npm && npx vitest run rules/style-lint/js/tests/lint.test.mjs`.

- [ ] **Step 3: Реалізувати `npm/rules/style-lint/js/lint.mjs`**

```js
/**
 * Quick-крок lint правила style-lint: stylelint --fix по css/scss/vue.
 *
 * `files` (quick) → лише style-файли з них; undefined (ci) → весь glob `**\/*.{css,scss,vue}`.
 */
import { spawnSync } from 'node:child_process'

const STYLE_EXT_RE = /\.(?:css|scss|vue)$/u

/**
 * @param {string[]} files список шляхів
 * @returns {string[]} лише css/scss/vue
 */
export function filterStyleFiles(files) {
  return files.filter(f => STYLE_EXT_RE.test(f))
}

/**
 * @param {string[] | undefined} files quick: ці файли; undefined: весь проєкт
 * @param {string} [cwd] корінь
 * @returns {Promise<number>} exit code
 */
export function lint(files, cwd = process.cwd()) {
  const args = ['stylelint', '--fix']
  if (files === undefined) {
    args.push('**/*.{css,scss,vue}')
  } else {
    const style = filterStyleFiles(files)
    if (style.length === 0) return Promise.resolve(0)
    args.push(...style)
  }
  const r = spawnSync('npx', args, { cwd, stdio: 'inherit' })
  return Promise.resolve(typeof r.status === 'number' ? r.status : 1)
}
```

- [ ] **Step 4: PASS** — `cd npm && npx vitest run rules/style-lint/js/tests/lint.test.mjs`.

- [ ] **Step 5: meta.json — додати `lint`-поле**

`style-lint/meta.json` → додати `"lint": "quick"`.
`ga/meta.json`, `rego/meta.json`, `security/meta.json` → додати `"lint": "ci"`.
`text/meta.json` → `"lint": "ci"` (CLI lint-text не приймає файли — звірено: `runLintTextSteps()` без args).

> Для кожного — зберегти наявне поле `auto`, лише додати `lint`. Приклад `ga`: `{ "auto": { "glob": ".github/workflows/**" }, "lint": "ci" }`.

- [ ] **Step 6: ci-правила потребують `js/lint.mjs`-делегати в CLI пакета**

`ga`/`rego`/`text`/`security` ганяються наявними CLI (`n-cursor lint-ga` тощо), не мають `js/lint.mjs`. Створити тонкий делегат для кожного, напр. `npm/rules/ga/js/lint.mjs`:

```js
/**
 * Ci-крок ga: делегує у наявний `runLintGaCli` (actionlint/zizmor по всьому .github/workflows).
 * Per-file режиму немає — `files` ігнорується.
 */
import { runLintGaCli } from '../lint/lint.mjs'

/**
 * @param {string[] | undefined} _files ігнорується
 * @returns {Promise<number>} exit code
 */
export async function lint(_files) {
  return runLintGaCli()
}
```

Аналогічно: `rego/js/lint.mjs` → `runLintRego`; `text/js/lint.mjs` → `runLintTextCli`; `security/js/lint.mjs` → запуск trufflehog (звірити, чи є CLI; якщо нема — `spawnSync('trufflehog', [...])` з наявного `lint-security` скрипта). **Звірити точні імена експортів** при impl (`grep "export const runLint" npm/rules/*/lint/lint.mjs`).

> ⚠️ Імпорт-шлях з `js/lint.mjs` до `lint/lint.mjs`: `from '../lint/lint.mjs'`. Перевірити, що ці CLI вже обгорнуті `withLock` (вони є) — повторний lock усередині оркестратора не потрібен.

- [ ] **Step 7: Коміт**

```bash
git add npm/rules/style-lint/ npm/rules/ga/ npm/rules/rego/ npm/rules/text/ npm/rules/security/
git commit -m "feat(lint): style-lint quick + ga/rego/text/security ci-фази (js/lint.mjs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Підключити `case 'lint'` / `case 'lint-ci'` у CLI

**Files:** Modify `npm/bin/n-cursor.js`; (можливо) видалити `npm/scripts/lib/run-lint-cli.mjs`

- [ ] **Step 1: Замінити імпорт і case**

У `npm/bin/n-cursor.js`: замінити `import { runLintCli } from '../scripts/lib/run-lint-cli.mjs'` на:

```js
import { runLint } from '../scripts/lint-cli.mjs'
```

Замінити `case 'lint'` (рядок ~1466):

```js
    case 'lint': {
      process.exitCode = await runLint({ ci: false })
      break
    }
    case 'lint-ci': {
      process.exitCode = await runLint({ ci: true })
      break
    }
```

- [ ] **Step 2: Оновити перелік команд у `default`** — додати `lint-ci` у рядок `console.error('Очікується: …')`.

- [ ] **Step 3: Видалити мертвий `run-lint-cli.mjs`, якщо більше не імпортується**

Run: `grep -rl "run-lint-cli" npm/ --include='*.mjs' --include='*.js' | grep -v 'tests/'`
Якщо лишилось лише `run-lint-cli.mjs` сам — `git rm npm/scripts/lib/run-lint-cli.mjs npm/scripts/lib/tests/run-lint-cli.test.mjs` (і його тест). Якщо щось ще імпортує — лишити.

- [ ] **Step 4: Smoke-тест на тимчасовому репо**

```bash
cd /tmp && rm -rf lintsmoke && mkdir lintsmoke && cd lintsmoke && git init -q
echo '{"name":"x"}' > package.json && echo 'export const a=1' > a.js
git add . && git commit -qm init
echo 'export const a=2 ' > a.js   # зміна
node /Users/vitaliytv/www/nitra/cursor/npm/bin/n-cursor.js lint 2>&1 | tail -15
cd /Users/vitaliytv/www/nitra/cursor
```

Expected: оркестратор бачить змінений `a.js`, запускає js-lint quick (oxlint/eslint на ньому). Помилки відсутності конфігів — ок (це порожній проєкт); головне — quick стартує на змінених, не на всьому.

- [ ] **Step 5: Коміт**

```bash
git add npm/bin/n-cursor.js
git rm npm/scripts/lib/run-lint-cli.mjs npm/scripts/lib/tests/run-lint-cli.test.mjs 2>/dev/null || true
git commit -m "feat(lint): case lint (quick) / lint-ci (full) у n-cursor CLI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Валідація, docs, change-файл, регресія

**Files:** Modify `npm/rules/js-lint/js-lint.mdc`, `.cursor/rules/scripts.mdc`; check-концерн; change-файл

- [ ] **Step 1: Концерн валідації lint↔lint.mjs** — розширити `npm/rules/npm-module/js/rule_meta.mjs` (зі Spec B): якщо `meta.lint` присутнє → `parseRuleLintPhase(raw.lint) !== null` і існує `rules/<id>/js/lint.mjs`. Додати кейс у його тест `rule_meta.test.mjs`.

```js
// у rule_meta.mjs, у циклі по правилах, після auto-перевірки:
import { parseRuleLintPhase } from '../../../scripts/lib/rule-meta.mjs'
import { existsSync } from 'node:fs' // вже є
// ...
if (raw.lint !== undefined) {
  if (parseRuleLintPhase(raw.lint) === null) {
    reporter.fail(`rules/${id}: meta.json.lint нерозпізнане (очікується "quick"|"ci")`)
    ruleOk = false
  } else if (!existsSync(join(ruleDir, 'js', 'lint.mjs'))) {
    reporter.fail(`rules/${id}: lint:"${raw.lint}" але немає js/lint.mjs`)
    ruleOk = false
  }
}
```

- [ ] **Step 2: Тест концерну** — у `rule_meta.test.mjs` додати кейс: правило з `lint:"quick"` без `js/lint.mjs` → 1; з валідним → 0. Прогнати: `cd npm && npx vitest run rules/npm-module/js/tests/rule_meta.test.mjs`.

- [ ] **Step 3: `js-lint.mdc`** — оновити канонічні кореневі скрипти: `lint` → `n-cursor lint`, додати `lint-ci → n-cursor lint-ci`. Прибрати з канону окремі `lint-ga/js/rego/style/text/security` (стають внутрішніми). ⚠️ Звірити з наявним check `js-lint`, що перевіряє `scripts.lint-js` — узгодити, щоб не суперечити.

- [ ] **Step 4: `scripts.mdc`** — додати абзац про lint-конвенцію: поле `meta.json.lint` (quick/ci), виконавець `js/lint.mjs`, оркестратор `n-cursor lint`/`lint-ci`, заборона паралелі.

- [ ] **Step 5: Change-файл**

```bash
cd npm && npx @nitra/cursor change --bump minor --section Added \
  --message "lint: розділення на n-cursor lint (quick, по змінених) і lint-ci (повний) — data-driven за meta.json.lint; js-lint-ci (jscpd+knip) винесено в ci-фазу" && cd ..
```

- [ ] **Step 6: Повний сюїт + автодетект-регресія**

Run: `cd npm && npx vitest run 2>&1 | tail -12`
Expected: зелено (крім відомих flaky). Особливо `auto-rules.test.mjs` (нове правило `js-lint-ci` зʼявилось у `rules/` — переконатись, що воно opt-in: нема `auto`, тож не ламає автодетект-тести; якщо ALL_RULES-перелік фіксований і тест падає на новому каталозі — додати `js-lint-ci` до очікувань або переконатись, що тест сканує лише наявне).

- [ ] **Step 7: changelog-check**

Run: `cd /Users/vitaliytv/www/nitra/cursor && node npm/bin/n-cursor.js fix changelog 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 8: Коміт**

```bash
git add npm/rules/npm-module/ npm/rules/js-lint/js-lint.mdc .cursor/rules/scripts.mdc npm/.changes/
git commit -m "feat(lint): валідація lint↔lint.mjs, docs, change-файл (Spec lint-split E1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (автор плану)

**Spec coverage:** поле `lint` quick/ci → T1; changed-files → T2; js-lint quick → T3; js-lint-ci → T4; оркестратор → T5; style-lint quick + ga/rego/text/security ci → T6; case lint/lint-ci → T7; валідація+docs+change → T8. ✅

**Placeholder scan:** усі кроки з кодом мають повний код; «звірити при impl» лишено свідомо там, де факт треба підтвердити на місці (експорти CLI, js-lint check-узгодження, ALL_RULES).

**Type consistency:** `parseRuleLintPhase`, `collectChangedFiles`, `selectLintRules`, `runLint({ci})`, `lint(files, cwd)`, `filterJsFiles`/`filterStyleFiles` — імена узгоджені між задачами й тестами.

**Відомі ризики:**

- `text`/`security`/`ga`/`rego` `js/lint.mjs`-делегати: точні імена експортів CLI звірити (T6 Step 6).
- js-lint наявний check vs нові кореневі скрипти (T8 Step 3) — узгодити, щоб два check не суперечили.
- `auto-rules.test.mjs` міг мати фіксований ALL_RULES; нове `js-lint-ci` (opt-in, без auto) не має активуватись, але якщо тест перевіряє повний перелік каталогів — оновити (T8 Step 6).
- `js-lint-ci` без `auto` — opt-in; у кореневому `.n-cursor.json` його треба додати в `rules`, щоб `lint-ci` його підхопив? Ні — оркестратор сканує `npm/rules/` пакета напряму, не `.n-cursor.json`. Звірити, що `runLint` бере правила з пакета (так, `RULES_DIR`), тож працює незалежно від конфігу проєкту.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-31-lint-quick-ci-e1.md`.
