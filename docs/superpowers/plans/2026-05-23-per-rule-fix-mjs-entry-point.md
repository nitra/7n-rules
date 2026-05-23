# Per-rule `fix.mjs` Entry-Point Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести всі 30 правил `npm/rules/<id>/` на власну точку входу `fix.mjs` + перейменувати каталог `fix/<concern>/` на `js/<concern>/`, з shared module-singleton walkCache. CLI делегує запуск через dynamic import замість convention-based discovery.

**Architecture:** Новий `runStandardRule(ruleDir, ctx)` інкапсулює оркестрацію (applies → JS → policy → mdc-refs). Кожне `rules/<id>/fix.mjs` — 8-рядковий wrapper, який делегує. CLI використовує `listRuleIds()` для перебору + dynamic import. Локальна логіка в правилах заборонена; розширення поведінки — лише через `RuleContext` опції в централізованому util'і.

**Tech Stack:** Node.js ESM, Bun 1.3+, `bun:test` (`describe`/`test`/`expect`), JSDoc typing, Rego (без змін), POSIX shell.

**Spec:** [docs/superpowers/specs/2026-05-23-per-rule-fix-mjs-entry-point-design.md](../specs/2026-05-23-per-rule-fix-mjs-entry-point-design.md)

**Working directory:** Усі команди припускають `/Users/vitaliytv/www/nitra/cursor` як CWD.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `npm/scripts/utils/walk-cache.mjs` | **Create** | Lazy-init Map singleton + reset (~15 LOC). |
| `npm/scripts/utils/list-rule-ids.mjs` | **Create** | Перебір `rules/<id>/` з фільтром `fix.mjs` (~20 LOC). |
| `npm/scripts/utils/run-standard-rule.mjs` | **Create** | Public API per-rule оркестрації; обгортка `discoverOneRule + runRule` (~25 LOC). |
| `npm/scripts/utils/discover-checkable-rules.mjs` | **Modify** | Виокремити `discoverOneRule(ruleDir, ruleId)`; rename константи `fix` → `js` у listJsConcerns. |
| `npm/scripts/utils/run-rule.mjs` | **Modify** | Шляхи `'fix'` → `'js'` у `resolveJsCheckPath`; JSDoc оновити. |
| `npm/scripts/cli-entry.mjs` | **Modify** | `discoverCheckableRules + foreach runRule` → `listRuleIds + dynamic import fix.mjs`. |
| `npm/rules/<id>/fix.mjs` × 30 | **Create** | 8-рядковий wrapper над `runStandardRule`. |
| `npm/rules/<id>/fix/` × 30 | **Rename → `js/`** | Через `git mv`, історія зберігається. |
| `npm/rules/<id>/policy/<concern>/*.rego` | **Modify** | Коментарі з `fix/<concern>` → `js/<concern>`. |
| `npm/rules/*/*.mdc` | **Modify** | Згадки `fix/<concern>` → `js/<concern>`. |
| `.cursor/rules/conftest.mdc` | **Modify** | Згадки `fix/<concern>` → `js/<concern>`. |
| `npm/tests/walk-cache.test.mjs` | **Create** | Контракт singleton + reset. |
| `npm/tests/list-rule-ids.test.mjs` | **Create** | Алфавіт, фільтр, hidden, missing fix.mjs. |
| `npm/tests/run-standard-rule.test.mjs` | **Create** | Прокидання ctx, повернення exit-коду. |
| `npm/tests/discover-one-rule.test.mjs` | **Create** | Контракт `discoverOneRule(ruleDir, ruleId)`. |
| `npm/tests/fix-mjs-contract.test.mjs` | **Create** | Smoke: всі 30 правил мають `fix.mjs` + `js/`. |
| `npm/tests/*.test.mjs` | **Modify** | Import-шляхи `rules/<id>/fix/<concern>/` → `rules/<id>/js/<concern>/`. |
| `npm/CHANGELOG.md` | **Modify** | Опис breaking + entry-point. |
| `npm/package.json` | **Modify** | `version` patch-bump. |

---

## Task 1: `walk-cache.mjs` — module-singleton

**Files:**
- Create: `npm/scripts/utils/walk-cache.mjs`
- Test: `npm/tests/walk-cache.test.mjs`

- [ ] **Step 1.1: Write the failing test**

```js
// npm/tests/walk-cache.test.mjs
import { beforeEach, describe, expect, test } from 'bun:test'

import { getOrCreateWalkCache, resetWalkCache } from '../scripts/utils/walk-cache.mjs'

describe('walk-cache module singleton', () => {
  beforeEach(() => {
    resetWalkCache()
  })

  test('getOrCreateWalkCache повертає Map', () => {
    expect(getOrCreateWalkCache()).toBeInstanceOf(Map)
  })

  test('повторні виклики повертають той самий instance', () => {
    const a = getOrCreateWalkCache()
    const b = getOrCreateWalkCache()
    expect(a).toBe(b)
  })

  test('resetWalkCache робить новий instance', () => {
    const a = getOrCreateWalkCache()
    a.set('x', Promise.resolve(['a.txt']))
    resetWalkCache()
    const b = getOrCreateWalkCache()
    expect(b).not.toBe(a)
    expect(b.size).toBe(0)
  })

  test('окрема module-instance: при сторонньому скиді — нова Map', () => {
    const before = getOrCreateWalkCache()
    before.set('k', Promise.resolve([]))
    resetWalkCache()
    expect(getOrCreateWalkCache().has('k')).toBe(false)
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd npm && bun test tests/walk-cache.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/utils/walk-cache.mjs'`.

- [ ] **Step 1.3: Create the module**

```js
// npm/scripts/utils/walk-cache.mjs
/**
 * Module-singleton FS-walk cache, спільний для всіх concerns одного `check`-прогону.
 * Ключі — рядкові glob/regex дескриптори; значення — `Promise<string[]>` зі списком файлів.
 * Кеш живий у межах одного процесу (Node/Bun module-instance). Тести скидають через `resetWalkCache()`.
 */

/** @type {Map<string, Promise<string[]>> | null} */
let cache = null

/**
 * Повертає поточний cache; lazy-ініціалізує при першому виклику.
 * @returns {Map<string, Promise<string[]>>}
 */
export function getOrCreateWalkCache() {
  if (cache === null) cache = new Map()
  return cache
}

/**
 * Скидає cache (для тестів між кейсами).
 */
export function resetWalkCache() {
  cache = new Map()
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `cd npm && bun test tests/walk-cache.test.mjs`
Expected: PASS — 4 кейси зелені.

- [ ] **Step 1.5: Commit**

```bash
git add npm/scripts/utils/walk-cache.mjs npm/tests/walk-cache.test.mjs
git commit -m "feat(utils): walk-cache module-singleton з reset для тестів

Спільний FS-walk cache для concerns одного check-прогону. Module-instance
живий у межах одного процесу; тести викликають resetWalkCache() у
beforeEach.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `list-rule-ids.mjs` — discover rules by `fix.mjs`

**Files:**
- Create: `npm/scripts/utils/list-rule-ids.mjs`
- Test: `npm/tests/list-rule-ids.test.mjs`

- [ ] **Step 2.1: Write the failing test**

```js
// npm/tests/list-rule-ids.test.mjs
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listRuleIds } from '../scripts/utils/list-rule-ids.mjs'

/** @type {string[]} */
const tmpRoots = []

function makeFakeRules({ withFix, withoutFix = [], hidden = [] }) {
  const root = mkdtempSync(join(tmpdir(), 'list-rule-ids-'))
  tmpRoots.push(root)
  for (const id of withFix) {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, 'fix.mjs'), '')
  }
  for (const id of withoutFix) {
    mkdirSync(join(root, id), { recursive: true })
  }
  for (const id of hidden) {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, 'fix.mjs'), '')
  }
  return root
}

afterEach(() => {
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop(), { recursive: true, force: true })
})

describe('listRuleIds', () => {
  test('повертає алфавітно відсортовані id з fix.mjs', async () => {
    const root = makeFakeRules({ withFix: ['ga', 'abie', 'k8s'] })
    expect(await listRuleIds(root)).toEqual(['abie', 'ga', 'k8s'])
  })

  test('пропускає каталоги без fix.mjs', async () => {
    const root = makeFakeRules({ withFix: ['abie'], withoutFix: ['no-fix'] })
    const ids = await listRuleIds(root)
    expect(ids).toEqual(['abie'])
  })

  test('пропускає каталоги з dot-prefix навіть якщо мають fix.mjs', async () => {
    const root = makeFakeRules({ withFix: ['abie'], hidden: ['.hidden'] })
    const ids = await listRuleIds(root)
    expect(ids).toEqual(['abie'])
  })

  test('фільтрація через filter повертає лише цей id', async () => {
    const root = makeFakeRules({ withFix: ['abie', 'ga', 'k8s'] })
    expect(await listRuleIds(root, 'abie')).toEqual(['abie'])
  })

  test('фільтр на відсутнє правило — порожній масив', async () => {
    const root = makeFakeRules({ withFix: ['abie'] })
    expect(await listRuleIds(root, 'nope')).toEqual([])
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `cd npm && bun test tests/list-rule-ids.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/utils/list-rule-ids.mjs'`.

- [ ] **Step 2.3: Create the module**

```js
// npm/scripts/utils/list-rule-ids.mjs
/**
 * Перебір `rules/<id>/` директорій з фільтром на наявність `fix.mjs`.
 * Після атомарної міграції `fix.mjs` обов'язковий у кожному правилі — каталог без нього
 * пропускається (це not-a-rule або заглушка).
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @param {string} bundledRulesDir абсолютний шлях до `npm/rules/`
 * @param {string} [filter] id одного правила (через `--rule abie`)
 * @returns {Promise<string[]>} відсортовані алфавітно id
 */
export async function listRuleIds(bundledRulesDir, filter) {
  const entries = await readdir(bundledRulesDir, { withFileTypes: true })
  const ids = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .filter(id => existsSync(join(bundledRulesDir, id, 'fix.mjs')))
    .filter(id => filter === undefined || id === filter)
  return ids.toSorted((a, b) => a.localeCompare(b))
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `cd npm && bun test tests/list-rule-ids.test.mjs`
Expected: PASS — 5 кейсів зелені.

- [ ] **Step 2.5: Commit**

```bash
git add npm/scripts/utils/list-rule-ids.mjs npm/tests/list-rule-ids.test.mjs
git commit -m "feat(utils): listRuleIds — перебір rules/ з фільтром fix.mjs

Discovery нижчого рівня для нової CLI-логіки: каталог \`rules/<id>/\` —
правило, якщо містить \`fix.mjs\`. Підтримує \`--rule abie\` фільтр.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Виокремити `discoverOneRule(ruleDir, ruleId)` з `discover-checkable-rules.mjs`

Поточна `discoverCheckableRules(bundledRulesDir)` сканує всі правила. Витягнути логіку "побудувати `CheckableRule` для одного каталогу" в окрему публічну функцію `discoverOneRule(ruleDir, ruleId)`.

**Files:**
- Modify: `npm/scripts/utils/discover-checkable-rules.mjs`
- Test: `npm/tests/discover-one-rule.test.mjs`

- [ ] **Step 3.1: Write the failing test**

```js
// npm/tests/discover-one-rule.test.mjs
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverOneRule } from '../scripts/utils/discover-checkable-rules.mjs'

/** @type {string[]} */
const tmpRoots = []

function makeFakeRule({ id, jsConcerns = [], policyConcerns = [] }) {
  const root = mkdtempSync(join(tmpdir(), 'discover-one-rule-'))
  tmpRoots.push(root)
  const ruleDir = join(root, id)
  mkdirSync(ruleDir, { recursive: true })

  for (const concern of jsConcerns) {
    mkdirSync(join(ruleDir, 'fix', concern), { recursive: true })
    writeFileSync(join(ruleDir, 'fix', concern, 'check.mjs'), '')
  }
  for (const concern of policyConcerns) {
    mkdirSync(join(ruleDir, 'policy', concern), { recursive: true })
    writeFileSync(join(ruleDir, 'policy', concern, 'target.json'), '{}')
  }
  return ruleDir
}

afterEach(() => {
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop(), { recursive: true, force: true })
})

describe('discoverOneRule', () => {
  test('повертає JS + policy concerns для правила з обома', async () => {
    const ruleDir = makeFakeRule({
      id: 'abie',
      jsConcerns: ['env_dns', 'applies'],
      policyConcerns: ['http_route_base']
    })
    const rule = await discoverOneRule(ruleDir, 'abie')
    expect(rule.id).toBe('abie')
    expect(rule.jsConcerns.map(c => c.name)).toEqual(['applies', 'env_dns'])
    expect(rule.policyConcerns.map(c => c.name)).toEqual(['http_route_base'])
  })

  test('правило без policy — повертає пустий policyConcerns', async () => {
    const ruleDir = makeFakeRule({ id: 'js-lint', jsConcerns: ['tooling'] })
    const rule = await discoverOneRule(ruleDir, 'js-lint')
    expect(rule.policyConcerns).toEqual([])
  })

  test('правило без fix/ — повертає пустий jsConcerns', async () => {
    const ruleDir = makeFakeRule({ id: 'rego', policyConcerns: ['only_rego'] })
    const rule = await discoverOneRule(ruleDir, 'rego')
    expect(rule.jsConcerns).toEqual([])
    expect(rule.policyConcerns.map(c => c.name)).toEqual(['only_rego'])
  })
})
```

> **Примітка:** тест ще використовує літеральну `fix/` у фікстурах. Це навмисно — Task 3 рефакторить існуючий код, який досі знає `fix/`. У Task 6 ми переконфігуруємо константу на `js/`, оновимо й цей тест.

- [ ] **Step 3.2: Run test to verify it fails**

Run: `cd npm && bun test tests/discover-one-rule.test.mjs`
Expected: FAIL — `discoverOneRule` не експортується.

- [ ] **Step 3.3: Read current discover-checkable-rules.mjs to know exact location**

```bash
grep -n "export\|function" npm/scripts/utils/discover-checkable-rules.mjs
```

Очікувано: побачимо `listJsConcerns`, `listPolicyConcerns` (privately) і `export discoverCheckableRules`. Викремимо `discoverOneRule` як публічну функцію, що використовує існуючі helpers.

- [ ] **Step 3.4: Refactor — add `discoverOneRule` keeping the existing API**

Внести зміни в `npm/scripts/utils/discover-checkable-rules.mjs`:

1. Перед функцією `discoverCheckableRules` додати:

```js
/**
 * Будує `CheckableRule` для одного каталогу правила (без enumeration по `rules/`).
 * Використовується `runStandardRule` для per-rule entry-point flow.
 * @param {string} ruleDir абсолютний шлях `rules/<id>/`
 * @param {string} ruleId id правила (= basename(ruleDir))
 * @returns {Promise<CheckableRule>}
 */
export async function discoverOneRule(ruleDir, ruleId) {
  const jsConcerns = await listJsConcerns(join(ruleDir, 'fix'))
  const policyConcerns = await listPolicyConcerns(join(ruleDir, 'policy'))
  return { id: ruleId, jsConcerns, policyConcerns }
}
```

2. Refactor `discoverCheckableRules`, щоб використати `discoverOneRule` (DRY):

```js
export async function discoverCheckableRules(bundledRulesDir) {
  if (!existsSync(bundledRulesDir)) return []
  const entries = await readdir(bundledRulesDir, { withFileTypes: true })
  /** @type {CheckableRule[]} */
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const ruleDir = join(bundledRulesDir, entry.name)
    const rule = await discoverOneRule(ruleDir, entry.name)
    if (rule.jsConcerns.length > 0 || rule.policyConcerns.length > 0) {
      out.push(rule)
    }
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id))
}
```

- [ ] **Step 3.5: Run new test + existing tests**

```bash
cd npm && bun test tests/discover-one-rule.test.mjs tests/discover-checkable-rules.test.mjs
```

Expected: PASS у обох. (Якщо файла `tests/discover-checkable-rules.test.mjs` не існує — пропускаємо його; перевіримо тільки новий.)

- [ ] **Step 3.6: Commit**

```bash
git add npm/scripts/utils/discover-checkable-rules.mjs npm/tests/discover-one-rule.test.mjs
git commit -m "refactor(utils): виокремити discoverOneRule з discoverCheckableRules

Публічний API для per-rule discovery (без enumeration). discoverCheckableRules
тепер делегує discoverOneRule per directory — одне джерело істини для
побудови CheckableRule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `run-standard-rule.mjs` — public orchestration API

**Files:**
- Create: `npm/scripts/utils/run-standard-rule.mjs`
- Test: `npm/tests/run-standard-rule.test.mjs`

- [ ] **Step 4.1: Write the failing test**

```js
// npm/tests/run-standard-rule.test.mjs
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resetWalkCache } from '../scripts/utils/walk-cache.mjs'
import { runStandardRule } from '../scripts/utils/run-standard-rule.mjs'

/** @type {string[]} */
const tmpRoots = []

afterEach(() => {
  resetWalkCache()
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop(), { recursive: true, force: true })
})

function makeMinimalRule(id) {
  const root = mkdtempSync(join(tmpdir(), 'run-standard-rule-'))
  tmpRoots.push(root)
  const ruleDir = join(root, id)
  mkdirSync(ruleDir, { recursive: true })
  // Мінімум — applies, який ВИМИКАЄ правило (повертає false)
  mkdirSync(join(ruleDir, 'fix', 'applies'), { recursive: true })
  writeFileSync(
    join(ruleDir, 'fix', 'applies', 'check.mjs'),
    'export function applies() { return false }\nexport function check() { return 0 }\n'
  )
  return ruleDir
}

describe('runStandardRule', () => {
  test('повертає 0 коли applies() === false (правило пропущено)', async () => {
    const ruleDir = makeMinimalRule('test-rule')
    const code = await runStandardRule(ruleDir)
    expect(code).toBe(0)
  })

  test('використовує переданий walkCache замість singleton', async () => {
    const ruleDir = makeMinimalRule('test-rule')
    const customCache = new Map()
    customCache.set('marker', Promise.resolve(['fake']))
    await runStandardRule(ruleDir, { walkCache: customCache })
    // singleton не змінений
    expect(customCache.has('marker')).toBe(true)
  })
})
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `cd npm && bun test tests/run-standard-rule.test.mjs`
Expected: FAIL — модуль не існує.

- [ ] **Step 4.3: Create the module**

```js
// npm/scripts/utils/run-standard-rule.mjs
/**
 * Public API per-rule orchestration. Викликається з `rules/<id>/fix.mjs`.
 *
 * Інкапсулює: `discoverOneRule` → `runRule(applies → JS → policy → mdc-refs)`.
 * Локальна логіка в правилах заборонена; розширення поведінки — через `ctx`-опції.
 */
import { basename, dirname } from 'node:path'

import { discoverOneRule } from './discover-checkable-rules.mjs'
import { runRule } from './run-rule.mjs'
import { getOrCreateWalkCache } from './walk-cache.mjs'

/**
 * @typedef {object} RuleContext
 * @property {Map<string, Promise<string[]>>} [walkCache] FS-walk cache між concerns одного прогону
 *
 * Зарезервовано на майбутнє (поки не реалізовано — додається, коли з'явиться потреба):
 *   - `skipMdcRefs`, `skipApplies`, `onlyConcerns`.
 * Розширення поведінки правила робиться лише через нові поля тут, не через локальну
 * логіку в `rules/<id>/fix.mjs`.
 */

/**
 * @param {string} ruleDir абсолютний шлях до `rules/<id>/`
 * @param {RuleContext} [ctx]
 * @returns {Promise<number>} 0 OK, 1 violations
 */
export async function runStandardRule(ruleDir, ctx = {}) {
  const ruleId = basename(ruleDir)
  const bundledRulesDir = dirname(ruleDir)
  const rule = await discoverOneRule(ruleDir, ruleId)
  const walkCache = ctx.walkCache ?? getOrCreateWalkCache()
  return runRule(rule, bundledRulesDir, walkCache)
}
```

> **Примітка про сумісність:** `runRule` (поточна сигнатура) приймає 3 аргументи: `(rule, bundledRulesDir, walkCache)`. Цей виклик з'являється з 3 аргументами — тобто без модифікацій `runRule`. Поля `RuleContext.skipMdcRefs` / `skipApplies` / `onlyConcerns` — задекларовані як майбутнє API, але в цій PR не обробляються. Якщо колись з'явиться правило, що потребує цих опцій — додаватиметься новий 4-й параметр у `runRule` + JSDoc оновлення.

- [ ] **Step 4.4: Run test to verify it passes**

Run: `cd npm && bun test tests/run-standard-rule.test.mjs`
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add npm/scripts/utils/run-standard-rule.mjs npm/tests/run-standard-rule.test.mjs
git commit -m "feat(utils): runStandardRule — public per-rule entry-point API

Обгортка discoverOneRule + runRule + walkCache. Використовується з
rules/<id>/fix.mjs. RuleContext визначає простір варіацій поведінки;
локальна логіка в правилах заборонена.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Rename `rules/<id>/fix/` → `rules/<id>/js/` для всіх 30 правил

> ⚠️ Цей крок robить великий діф (~300 файлів). Виконуй у чистому стані (`git status` без unstaged змін у `rules/`).

**Files:**
- Rename: `npm/rules/*/fix/` → `npm/rules/*/js/`

- [ ] **Step 5.1: Перелічити правила**

```bash
ls npm/rules
```

Expected: 30 каталогів — abie, adr, bun, capacitor, changelog, ci4, docker, efes, feedback, ga, graphql, hasura, image-avif, image-compress, js-bun-db, js-bun-redis, js-lint, js-mssql, js-run, k8s, nginx-default-tpl, npm-module, php, rego, security, style-lint, tauri, test, text, vue.

- [ ] **Step 5.2: Перевірити, які правила реально мають каталог `fix/`**

```bash
for d in npm/rules/*/; do
  id=$(basename "$d")
  if [ -d "$d/fix" ]; then echo "HAS fix: $id"; else echo "NO  fix: $id"; fi
done
```

Expected: усі (або більшість) — `HAS fix:`. Якщо якесь — `NO fix:`, занотуй (можливо це правило лише з policy/).

- [ ] **Step 5.3: Виконати rename для всіх правил, де є fix/**

```bash
for d in npm/rules/*/; do
  id=$(basename "$d")
  if [ -d "$d/fix" ]; then
    git mv "$d/fix" "$d/js"
    echo "renamed $id"
  fi
done
```

Expected: лог "renamed <id>" для кожного правила з fix/.

- [ ] **Step 5.4: Перевірити, що нема залишків `fix/` як каталогу**

```bash
find npm/rules -maxdepth 2 -type d -name fix
```

Expected: порожній output.

- [ ] **Step 5.5: Зафіксувати rename окремим коммітом (БЕЗ оновлень коду — це наступний task)**

```bash
git commit -m "refactor(rules): rename fix/ → js/ у всіх правилах

Каталог \`rules/<id>/fix/<concern>/check.mjs\` тепер \`rules/<id>/js/<concern>/check.mjs\`.
Convention за технологією (\`js/\` ↔ \`policy/\`), не функцією. Чистий
\`git mv\` без правок коду — наступні коміти патчать references.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> На цьому етапі CLI та тести зламані. Це нормально — наступні tasks їх лагодять.

---

## Task 6: Patch `discover-checkable-rules.mjs` + `run-rule.mjs` — `'fix'` → `'js'`

**Files:**
- Modify: `npm/scripts/utils/discover-checkable-rules.mjs`
- Modify: `npm/scripts/utils/run-rule.mjs`
- Modify: `npm/tests/discover-one-rule.test.mjs` (fixture'и теж міняються на `js/`)

- [ ] **Step 6.1: Оновити фікстури в `tests/discover-one-rule.test.mjs`**

У файлі `npm/tests/discover-one-rule.test.mjs` (з Task 3): функція `makeFakeRule` створює `join(ruleDir, 'fix', concern)`. Замінити на `join(ruleDir, 'js', concern)`:

```js
function makeFakeRule({ id, jsConcerns = [], policyConcerns = [] }) {
  const root = mkdtempSync(join(tmpdir(), 'discover-one-rule-'))
  tmpRoots.push(root)
  const ruleDir = join(root, id)
  mkdirSync(ruleDir, { recursive: true })

  for (const concern of jsConcerns) {
    mkdirSync(join(ruleDir, 'js', concern), { recursive: true })
    writeFileSync(join(ruleDir, 'js', concern, 'check.mjs'), '')
  }
  for (const concern of policyConcerns) {
    mkdirSync(join(ruleDir, 'policy', concern), { recursive: true })
    writeFileSync(join(ruleDir, 'policy', concern, 'target.json'), '{}')
  }
  return ruleDir
}
```

Окремо в комент-блоку `discover-one-rule.test.mjs` (зверху, біля примітки про "fix/") видалити пояснення "ще використовує літеральну fix/" — вже не актуальне.

Аналогічно `tests/run-standard-rule.test.mjs` з Task 4: замінити `'fix', 'applies'` на `'js', 'applies'` у `makeMinimalRule`.

- [ ] **Step 6.2: Запустити тести — побачити, що падають**

```bash
cd npm && bun test tests/discover-one-rule.test.mjs tests/run-standard-rule.test.mjs
```

Expected: FAIL — фікстури тепер мають `js/`, а код досі шукає `fix/`.

- [ ] **Step 6.3: Patch `discover-checkable-rules.mjs`**

У `npm/scripts/utils/discover-checkable-rules.mjs`:

1. У JSDoc-у на початку файла замінити:
   - `'fix/<concern>/check.mjs'` → `'js/<concern>/check.mjs'`
   - `'fix/utils/'` → `'js/utils/'`
   - згадку "переїзду всіх 26 правил у `fix/`" → "переїзду всіх 30 правил у `js/`"

2. У JSDoc `listJsConcerns`:
   - `fix/<name>` → `js/<name>`
   - параметр-опис `'абсолютний шлях rules/<id>/fix/'` → `'rules/<id>/js/'`

3. У JSDoc `JsConcern.name`:
   - `'fix/<name>/'` → `'js/<name>/'`

4. У `discoverOneRule` (з Task 3):

```js
export async function discoverOneRule(ruleDir, ruleId) {
  const jsConcerns = await listJsConcerns(join(ruleDir, 'js'))
  const policyConcerns = await listPolicyConcerns(join(ruleDir, 'policy'))
  return { id: ruleId, jsConcerns, policyConcerns }
}
```

(Заміна `'fix'` → `'js'` у виклику `join`.)

- [ ] **Step 6.4: Patch `run-rule.mjs::resolveJsCheckPath`**

У `npm/scripts/utils/run-rule.mjs`, функція `resolveJsCheckPath`:

```js
function resolveJsCheckPath(bundledRulesDir, ruleId, concern, fileName) {
  return join(bundledRulesDir, ruleId, 'js', concern.name, fileName)
}
```

(Заміна `'fix'` → `'js'`.)

JSDoc функції теж оновити: `'rules/<id>/fix/<concern>/<file>'` → `'rules/<id>/js/<concern>/<file>'`.

У JSDoc файла на початку — `'fix/<concern>'` → `'js/<concern>'` усюди.

- [ ] **Step 6.5: Run tests to verify they pass**

```bash
cd npm && bun test tests/discover-one-rule.test.mjs tests/run-standard-rule.test.mjs tests/walk-cache.test.mjs tests/list-rule-ids.test.mjs
```

Expected: PASS у всіх 4.

- [ ] **Step 6.6: Commit**

```bash
git add npm/scripts/utils/discover-checkable-rules.mjs npm/scripts/utils/run-rule.mjs npm/tests/discover-one-rule.test.mjs npm/tests/run-standard-rule.test.mjs
git commit -m "refactor(utils): discover/runRule шляхи rules/<id>/fix → js

Узгоджено з перейменуванням каталогу. JSDoc і фікстури тестів теж
оновлено. Це робить попередній git mv (rename fix/ → js/) працюючим.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Оновити references у `.rego`, `.mdc`, `.cursor/rules/conftest.mdc`

**Files:**
- Modify: `npm/rules/*/policy/*/check-*.rego`, `*.rego` — коментарі
- Modify: `npm/rules/*/*.mdc` — згадки `fix/<concern>`
- Modify: `.cursor/rules/conftest.mdc`

- [ ] **Step 7.1: Знайти всі активні згадки**

```bash
grep -rn "fix/" npm/rules .cursor/rules 2>/dev/null | grep -v ".github/" | grep -v CHANGELOG | grep -v "fix.mjs"
```

Expected: список конкретних рядків у `.rego`, `.mdc` файлах. (CHANGELOG/історія — ігноруємо.)

- [ ] **Step 7.2: Замінити `/fix/<word>` на `/js/<word>` у активних файлах**

```bash
# .rego коментарі — у всіх правилах
grep -lrZ "/fix/" npm/rules --include="*.rego" | xargs -0 sed -i.bak -E 's|/fix/([a-z_]+)|/js/\1|g'
find npm/rules -name "*.rego.bak" -delete

# .mdc — обережно, бо deg згадки на cli-команду "fix" як verb можуть бути коректними. Дивитись ручно.
grep -lrZ "/fix/" npm/rules --include="*.mdc" | xargs -0 sed -i.bak -E 's|/fix/([a-z_]+)|/js/\1|g'
find npm/rules -name "*.mdc.bak" -delete

# .cursor/rules/conftest.mdc — точечно
sed -i.bak -E 's|rules/abie/fix/|rules/abie/js/|g' .cursor/rules/conftest.mdc
rm -f .cursor/rules/conftest.mdc.bak
```

- [ ] **Step 7.3: Перевірити, що замін нема "false positive"**

```bash
grep -rn "/fix/" npm/rules .cursor/rules 2>/dev/null | grep -v ".github/" | grep -v CHANGELOG | grep -v "fix.mjs"
```

Expected: порожньо (або тільки CHANGELOG — який ми не чіпаємо).

- [ ] **Step 7.4: Точечно перевірити `.mdc` правил, що мали згадки `fix/<concern>`**

Подивись diff:

```bash
git diff npm/rules/*/abie.mdc npm/rules/*/k8s.mdc .cursor/rules/conftest.mdc
```

Переконайся, що жодного слова, де "fix/" — це VERB (наприклад "fix/correct"), не замінено помилково. У наших правилах це нормально, але візуально звір.

- [ ] **Step 7.5: Commit**

```bash
git add npm/rules .cursor/rules
git commit -m "docs: оновити refs rules/<id>/fix/<concern> → js/<concern>

У .rego коментарях, .mdc документації та conftest.mdc — заміна шляхів
згідно з перейменуванням каталогу.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Згенерувати 30 `fix.mjs` через скрипт

**Files:**
- Create (temporary): `npm/scripts/generate-fix-mjs.mjs`
- Create: `npm/rules/<id>/fix.mjs` × 30

- [ ] **Step 8.1: Create the generator script**

```js
// npm/scripts/generate-fix-mjs.mjs
/**
 * Одноразовий скрипт: для кожного `rules/<id>/` створює канонічний `fix.mjs`.
 * Видалити після успішного PR.
 *
 * Run: bun npm/scripts/generate-fix-mjs.mjs
 */
import { existsSync } from 'node:fs'
import { writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const TEMPLATE = `import { runStandardRule } from '../../scripts/utils/run-standard-rule.mjs'

/**
 * @param {import('../../scripts/utils/run-standard-rule.mjs').RuleContext} [ctx]
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export async function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

if (import.meta.main) {
  process.exit(await run())
}
`

const rulesDir = new URL('../rules/', import.meta.url).pathname
const entries = await readdir(rulesDir, { withFileTypes: true })

let created = 0
let skipped = 0
for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue
  const fixPath = join(rulesDir, entry.name, 'fix.mjs')
  if (existsSync(fixPath)) {
    skipped += 1
    continue
  }
  await writeFile(fixPath, TEMPLATE, 'utf8')
  console.log(`created ${entry.name}/fix.mjs`)
  created += 1
}
console.log(`\nЗгенеровано: ${created}, пропущено: ${skipped}`)
```

- [ ] **Step 8.2: Run the generator**

```bash
bun npm/scripts/generate-fix-mjs.mjs
```

Expected: лог "created <id>/fix.mjs" × 30 і "Згенеровано: 30, пропущено: 0" (або менша кількість, якщо якесь правило вже має fix.mjs).

- [ ] **Step 8.3: Verify all 30 rules have fix.mjs**

```bash
for d in npm/rules/*/; do
  id=$(basename "$d")
  if [ ! -f "$d/fix.mjs" ]; then echo "MISSING fix.mjs: $id"; fi
done
echo "---"
ls npm/rules | wc -l  # 30
find npm/rules -maxdepth 2 -name fix.mjs | wc -l  # 30
```

Expected: жодного "MISSING"; обидва числа `30`.

- [ ] **Step 8.4: Перевірити вміст одного з файлів**

```bash
cat npm/rules/abie/fix.mjs
```

Expected: канонічний template, 11 рядків.

- [ ] **Step 8.5: Sanity-check — `bun rules/abie/fix.mjs` запускається**

```bash
bun npm/rules/abie/fix.mjs
```

Expected: відомий вивід (правило виконує реальну перевірку поточного проекту), exit-code 0 або 1 залежно від стану. ВАЖЛИВО: тут НЕ перевіряємо контент output'а — лише що процес запускається без ImportError / SyntaxError.

- [ ] **Step 8.6: Видалити generator (одноразовий)**

```bash
rm npm/scripts/generate-fix-mjs.mjs
```

- [ ] **Step 8.7: Commit**

```bash
git add npm/rules
git commit -m "feat(rules): додати rules/<id>/fix.mjs у всі 30 правил

Канонічний 11-рядковий wrapper над runStandardRule. Identical у всіх
30 правилах. Generator-скрипт видалено після виконання — генерація
одноразова, повторно не потрібна.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Smoke-тест "all rules have fix.mjs + js/"

**Files:**
- Create: `npm/tests/fix-mjs-contract.test.mjs`

- [ ] **Step 9.1: Write the test**

```js
// npm/tests/fix-mjs-contract.test.mjs
/**
 * Smoke-контракт: кожне правило `rules/<id>/` має `fix.mjs` з валідним експортом `run`,
 * а каталог `js/` (бо саме він — конвенція замість legacy fix/).
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const RULES_DIR = new URL('../rules/', import.meta.url).pathname

const ruleIds = (await readdir(RULES_DIR, { withFileTypes: true }))
  .filter(e => e.isDirectory() && !e.name.startsWith('.'))
  .map(e => e.name)
  .toSorted((a, b) => a.localeCompare(b))

describe('fix.mjs contract — усі правила', () => {
  test('30 правил знайдено', () => {
    expect(ruleIds.length).toBe(30)
  })

  for (const id of ruleIds) {
    test(`${id}: rules/${id}/fix.mjs існує`, () => {
      expect(existsSync(join(RULES_DIR, id, 'fix.mjs'))).toBe(true)
    })

    test(`${id}: rules/${id}/fix.mjs експортує run()`, async () => {
      const mod = await import(join(RULES_DIR, id, 'fix.mjs'))
      expect(typeof mod.run).toBe('function')
    })

    test(`${id}: rules/${id}/ містить js/ або policy/ (не legacy fix/)`, () => {
      const hasJs = existsSync(join(RULES_DIR, id, 'js'))
      const hasPolicy = existsSync(join(RULES_DIR, id, 'policy'))
      const hasLegacyFix = existsSync(join(RULES_DIR, id, 'fix'))
      expect(hasLegacyFix).toBe(false)
      expect(hasJs || hasPolicy).toBe(true)
    })
  }
})
```

- [ ] **Step 9.2: Run the test**

```bash
cd npm && bun test tests/fix-mjs-contract.test.mjs
```

Expected: PASS — 1 + 30×3 = 91 кейс.

- [ ] **Step 9.3: Commit**

```bash
git add npm/tests/fix-mjs-contract.test.mjs
git commit -m "test(contract): smoke-перевірка fix.mjs + js/ у всіх правилах

91 кейс (1 sanity + 30×3): існування fix.mjs, експорт run(), наявність
js/ або policy/ і відсутність legacy fix/. Швидко детектить пропущене
правило у майбутньому.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Patch CLI — `cli-entry.mjs` використовує `listRuleIds` + dynamic import

**Files:**
- Modify: `npm/scripts/cli-entry.mjs`

- [ ] **Step 10.1: Прочитати поточну реалізацію check-команди**

```bash
grep -n "discoverCheckableRules\|runRule\|check\b" npm/scripts/cli-entry.mjs | head -30
```

Identify the section that loops over discovered rules and calls `runRule`.

- [ ] **Step 10.2: Замінити section на нову логіку**

У `npm/scripts/cli-entry.mjs` знайти блок, що використовує `discoverCheckableRules` + `runRule`, і замінити на:

```js
import { listRuleIds } from './utils/list-rule-ids.mjs'
import { getOrCreateWalkCache } from './utils/walk-cache.mjs'

/**
 * Виконує check-команду: перебирає правила, кожне запускає через `fix.mjs::run(ctx)`.
 * @param {string} bundledRulesDir
 * @param {{ rule?: string }} opts
 * @returns {Promise<number>} aggregated exit code
 */
async function checkAll(bundledRulesDir, opts) {
  const ctx = { walkCache: getOrCreateWalkCache() }
  const ruleIds = await listRuleIds(bundledRulesDir, opts.rule)
  let exitCode = 0
  for (const id of ruleIds) {
    const fixPath = join(bundledRulesDir, id, 'fix.mjs')
    // eslint-disable-next-line no-unsanitized/method -- id з whitelist'у readdir + existsSync; fixPath не з зовнішнього input
    const mod = await import(fixPath)
    if (typeof mod.run !== 'function') {
      throw new Error(`${id}: rules/${id}/fix.mjs не експортує run()`)
    }
    const code = await mod.run(ctx)
    if (code !== 0) exitCode = 1
  }
  return exitCode
}
```

Прибрати імпорти `discoverCheckableRules`, `runRule` з top-level якщо вони більше не використовуються тут. (Функції залишаються — вони викликаються всередині `runStandardRule`.)

> ⚠️ Точна форма залежить від поточної структури `cli-entry.mjs`. Якщо там CAC-CLI з `cac` командами, інтегрувати `checkAll` як action для `check`-команди.

- [ ] **Step 10.3: Smoke test CLI**

```bash
cd /Users/vitaliytv/www/nitra/cursor && npx @nitra/cursor check abie 2>&1 | tail -20
```

Expected: успішний прогон, вивід "📋 abie:" + результати концернів. Exit-code 0 або 1 — без crash'у.

```bash
cd /Users/vitaliytv/www/nitra/cursor && npx @nitra/cursor check 2>&1 | head -50
```

Expected: перебір усіх 30 правил у алфавітному порядку.

- [ ] **Step 10.4: Commit**

```bash
git add npm/scripts/cli-entry.mjs
git commit -m "feat(cli): check-команда делегує rules/<id>/fix.mjs замість convention discovery

CLI перебирає через listRuleIds + dynamic import + mod.run(ctx).
discoverCheckableRules/runRule лишаються — викликаються всередині
runStandardRule. Зворотна сумісність: \`check\` та \`check <rule>\`
працюють як раніше.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Оновити import-шляхи в існуючих `tests/*.test.mjs`

**Files:**
- Modify: `npm/tests/integration-repo-checks.test.mjs`
- Modify: `npm/tests/check-empty-trees.test.mjs`
- Modify: `npm/tests/check-rule-fixtures.test.mjs`
- Modify: будь-які інші `npm/tests/*.test.mjs`, що містять літеральні `rules/<id>/fix/<concern>`

- [ ] **Step 11.1: Знайти всі тести з застарілими шляхами**

```bash
grep -rln "rules/.*/fix/" npm/tests 2>/dev/null
```

Expected: список файлів (мінімум 3 із spec'у; може бути більше).

- [ ] **Step 11.2: Перевірити кожний знайдений файл grep'ом по точному substring**

```bash
grep -n "rules/.*/fix/" npm/tests/*.test.mjs
```

Очікувано: побачимо рядки з `import { ... } from '../rules/<id>/fix/<concern>/check.mjs'`.

- [ ] **Step 11.3: Заміна `/fix/<concern>/` → `/js/<concern>/` через `sed` (точечно)**

```bash
# Працює лише для рядків з patterns 'rules/<id>/fix/<id_concern>/...'
grep -lZ "rules/.*/fix/" npm/tests/*.test.mjs 2>/dev/null | xargs -0 -r sed -i.bak -E "s|(rules/[a-z0-9_-]+)/fix/([a-z0-9_-]+/)|\1/js/\2|g"
find npm/tests -name "*.test.mjs.bak" -delete
```

- [ ] **Step 11.4: Перевірити, що нема залишків**

```bash
grep -rn "rules/.*/fix/" npm/tests 2>/dev/null
```

Expected: порожній output.

- [ ] **Step 11.5: Run all tests to ensure nothing broke**

```bash
cd npm && bun test
```

Expected: усі тести зелені. Якщо щось падає — діагностувати конкретно (це індикатор іншої залежності, не covered цим планом).

- [ ] **Step 11.6: Commit**

```bash
git add npm/tests
git commit -m "test: оновити import-шляхи rules/<id>/fix → js у tests

Логіка тестів не змінена; лише замінено застарілі літеральні шляхи
концернів згідно з перейменуванням каталогу.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: CHANGELOG + version bump + фінальна верифікація

**Files:**
- Modify: `npm/CHANGELOG.md`
- Modify: `npm/package.json`

- [ ] **Step 12.1: Перевірити поточну версію**

```bash
grep '"version"' npm/package.json
```

Note: `1.13.79` (або вище — підкорегувати під реальний стан).

- [ ] **Step 12.2: Version bump до наступного patch**

Edit `npm/package.json`: `"version": "1.13.79"` → `"version": "1.13.80"` (або відповідне наступне patch-число).

- [ ] **Step 12.3: Додати запис у CHANGELOG**

Edit `npm/CHANGELOG.md` — після `# Changelog ...` header додати:

```markdown
## [1.13.80] - 2026-05-23

### Changed

- **Per-rule `fix.mjs` entry-point + rename `fix/` → `js/`:** кожне з 30 правил тепер має `rules/<id>/fix.mjs` — 11-рядковий wrapper над новим `runStandardRule`. CLI більше не робить convention-based discovery на верхньому рівні — перебирає правила через `listRuleIds` і викликає `await import(rules/<id>/fix.mjs).run(ctx)`. Каталог `fix/<concern>/` перейменовано на `js/<concern>/` для усунення колізії з кореневим `fix.mjs` та узгодження з `policy/` (за технологією, не функцією).
- **Локальна логіка в `fix.mjs` заборонена** — розширення поведінки правил тільки через опції в `RuleContext` (`skipMdcRefs`, `skipApplies`, `onlyConcerns`, `walkCache`). Простір варіацій повністю описано в `RuleContext` JSDoc; convention-drift виключений на рівні дизайну.
- **Shared `walkCache`** як module-level singleton у `scripts/utils/walk-cache.mjs` (`getOrCreateWalkCache` + `resetWalkCache` для тестів). Прокидається через ctx до всіх concerns одного прогону.
- **Нові utils:** `scripts/utils/run-standard-rule.mjs`, `scripts/utils/list-rule-ids.mjs`, `scripts/utils/walk-cache.mjs`. Експорт `discoverOneRule(ruleDir, ruleId)` з `discover-checkable-rules.mjs` (виокремлено з існуючого `discoverCheckableRules`).
- **Нові тести:** `tests/fix-mjs-contract.test.mjs` (91 кейс — smoke на всі правила), `tests/run-standard-rule.test.mjs`, `tests/list-rule-ids.test.mjs`, `tests/walk-cache.test.mjs`, `tests/discover-one-rule.test.mjs`. Існуючі тести оновлено лише в частині import-шляхів `/fix/<concern>` → `/js/<concern>`.

### Breaking

- **Для зовнішніх інтеграторів, що пишуть власні правила:** каталог `rules/<id>/fix/<concern>/check.mjs` перейменовано на `rules/<id>/js/<concern>/check.mjs`; додатково потрібен файл `rules/<id>/fix.mjs` з канонічним вмістом (див. будь-яке вбудоване правило для шаблону). CLI більше не запустить правило без `fix.mjs`.

### Notes

- Зворотна сумісність CLI: `npx @nitra/cursor check` та `npx @nitra/cursor check abie` працюють як раніше.
- Use-cases: `bun npm/rules/abie/fix.mjs` (debug); `bun npm/rules/${{ matrix.rule }}/fix.mjs` (CI per-rule jobs); IDE Run-button на `fix.mjs`.

```

(Дату підкорегувати, якщо коміт іде не 2026-05-23. Версію — на реальний наступний patch.)

- [ ] **Step 12.4: Run check changelog**

```bash
cd /Users/vitaliytv/www/nitra/cursor && npx @nitra/cursor check changelog 2>&1 | tail -10
```

Expected: `✅` для всіх правил, `1/1 правил без зауважень` (або 2/2 з огляду на новий entry-point).

- [ ] **Step 12.5: Run all tests one more time**

```bash
cd npm && bun test 2>&1 | tail -20
```

Expected: усі зелені.

- [ ] **Step 12.6: Run lint (одиничний послідовний прогон)**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun run lint 2>&1 | tail -30
```

Expected: zero ESLint errors, zero rego violations, no formatting diff.

> ⚠️ Згідно з CLAUDE.md правилом `n-lint`: **один** послідовний прогон на сесію, без паралелі.

- [ ] **Step 12.7: Final commit**

```bash
git add npm/CHANGELOG.md npm/package.json
git commit -m "release: 1.13.80 — per-rule fix.mjs + rename fix/→js/

CHANGELOG із описом breaking для зовнішніх інтеграторів і нового
контракту \`rules/<id>/fix.mjs\`. Version bump до 1.13.80.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 12.8: Final verification — повний цикл**

```bash
cd /Users/vitaliytv/www/nitra/cursor
git status                          # має бути clean
bun npm/rules/abie/fix.mjs          # прямий run
npx @nitra/cursor check abie        # CLI run; вивід має бути еквівалентним
npx @nitra/cursor check             # all-rules run
npx @nitra/cursor check changelog   # 1/1 без зауважень
```

Expected: усі чотири команди успішні, exit-code 0 (або 1 з реальними violations — без crash'у).

---

## Acceptance Criteria

Перенесено з spec'у:

- [ ] Усі 30 правил мають `rules/<id>/fix.mjs` з ідентичним шаблоном (11 рядків).
- [ ] Усі 30 правил мають перейменовану папку `rules/<id>/js/`; жодного залишку `fix/` як каталогу.
- [ ] Жодне посилання на `rules/<id>/fix/<concern>/` не лишилось у `.mdc`, `.rego`, `.mjs` (поза CHANGELOG-історією) — перевірка `grep -rn "fix/" npm/rules .cursor/rules | grep -v CHANGELOG | grep -v fix.mjs`.
- [ ] `bun npm/rules/abie/fix.mjs` запускає правило abie і повертає той самий exit-code, що `npx @nitra/cursor check abie`.
- [ ] `npx @nitra/cursor check` (без аргументів) перебирає всі правила в алфавітному порядку через `listRuleIds`.
- [ ] `npx @nitra/cursor check abie` працює як раніше.
- [ ] `walkCache` шариться між concerns одного прогону (тестується singleton-тестом).
- [ ] Існуючі тести `tests/*.test.mjs` проходять після оновлення import-шляхів.
- [ ] Нові тести (`run-standard-rule`, `walk-cache`, `list-rule-ids`, `discover-one-rule`, `fix-mjs-contract`) проходять.
- [ ] CHANGELOG + version bump зафіксовано; `npx @nitra/cursor check changelog` зелений.

---

## Rollback Plan

Якщо після Task 12 щось критичне зламалося і потрібно швидко відкотитися:

```bash
# Знайти коміт до початку міграції (перед Task 1):
git log --oneline | head -20

# Відкотитися (без втрати uncommitted робіт):
git reset --hard <hash-before-task-1>
```

Кожна Task закомічена окремо → можна відкочуватися інкрементально:
- Task 5 (rename) ламає світ → решта tasks теж зламана. Відкат після Task 5 простий: `git revert <rename-commit>`.
- Якщо тільки Task 10 (CLI) зламав — `git revert` лише цей коміт; rules + utils лишаються в новому стані.

---

## Notes for the Implementing Engineer

1. **Один послідовний прогон lint** на сесію — без `&` фону, без паралелі Bash-задач (CLAUDE.md правило `n-lint`).
2. **Зберігати кожен Task у власному коміті** — це робить rollback тривіальним.
3. **Не пропускати TDD цикли** — навіть для тривіальних утиліт. Сам тест — це частина дизайну.
4. **При rename (Task 5) тримати `git status` чистим** перед `git mv` — інакше merge conflict'и важко роз'плутати.
5. **Якщо точна форма `cli-entry.mjs` відрізняється від припущень у Task 10** — інтегруй `checkAll` як новий handler для `check`-команди фреймворку, що там використовується (CAC чи інший).
