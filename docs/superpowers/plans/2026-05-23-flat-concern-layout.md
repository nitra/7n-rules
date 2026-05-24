# Flat Concern Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести структуру JS-частини правил `@nitra/cursor` з вкладеної `npm/rules/<rule>/js/<concern>/check.mjs` на пласку `npm/rules/<rule>/js/<concern>.mjs`. Tests → `js/tests/`, templates → `js/templates/`, data → `js/data/` (JS-specific assets усередині `js/`). Helpers → `<rule>/utils/<helper>.mjs` peer до `js/` (existing convention від `abie/utils/`).

**Architecture:** Концерн — це **файл**, не каталог. `listJsConcerns` сканує `<rule>/js/` на `*.mjs`-файли (виключаючи `.test.mjs`; усі каталоги ігноруються через `!entry.isFile()`). `JsConcern.files` deprecated → drop'нутий (1 файл на концерн); `runRule` обчислює шлях як `js/<concern>.mjs`. JS-specific assets (tests/templates/data) живуть у власних підпапках усередині `js/` — симетрично до того, як rego-тести живуть у `policy/<concern>_test.rego`. Helpers — у peer-каталозі `utils/` поряд з `js/` (продовження existing convention з `npm/rules/abie/utils/` — 8 helpers + `tests/`).

**Tech Stack:** Node.js ESM, Bun 1.3+, `bun:test`, `git mv`, JSDoc, POSIX shell. Без нових deps.

**Working directory:** `/Users/vitaliytv/www/nitra/cursor`. Усі команди припускають це як CWD.

---

## Target Layout

```
npm/rules/<rule>/
├── <rule>.mdc            ← без змін
├── auto.md               ← без змін
├── fix.mjs               ← без змін (entry-point wrapper)
├── js/
│   ├── <concern1>.mjs    ← було js/<concern1>/check.mjs
│   ├── <concern2>.mjs
│   ├── tests/            ← NEW (симетрія з policy/<concern>_test.rego)
│   │   ├── <concern>.test.mjs       ← single-test concern: був js/<concern>/tests/check.test.mjs
│   │   └── <concern>/               ← multi-test concern: вкладена папка
│   │       ├── <test-name>.test.mjs ← був js/<concern>/tests/<name>.test.mjs
│   │       └── fixtures/            ← було js/<concern>/tests/fixtures/
│   ├── templates/        ← NEW (лише де є)
│   │   └── <concern>/
│   │       └── ...       ← було js/<concern>/template/
│   └── data/             ← NEW (лише де є; json/tsv)
│       └── <concern>/
│           └── ...       ← було js/<concern>/<*.json|*.tsv>
├── utils/                ← EXISTING convention (peer до js/, як в abie/utils/)
│   ├── <helper>.mjs      ← cross-concern та concern-private helpers, плоско
│   └── tests/            ← (вже так в abie/utils/tests/)
│       └── <helper>.test.mjs
└── policy/               ← без змін
    └── <concern>/
        ├── <concern>.rego
        ├── <concern>_test.rego   ← (вже так!)
        └── target.json
```

**Discovery rules:** `listJsConcerns(jsDir)` повертає кожен `*.mjs`-файл прямо в `js/`, фільтруючи `*.test.mjs` і **будь-які каталоги** (тобто `tests/`, `templates/`, `data/` — всі ігноруються `if (!entry.isFile()) continue`). `utils/` живе peer до `js/` — discovery його взагалі не бачить (сканує тільки `js/`).

**Convention для helpers:** імена помічників мають бути descriptive і namespace'овані (як зараз у abie: `k8s-tree.mjs`, `kustomization-patches.mjs`; у docker: `docker-mirror.mjs`, `docker-hadolint.mjs`; у vue: `vue-forbidden-imports.mjs`). Префікс типу `<rule>-` чи `<concern>-` робить колізії неможливими — concern-grouping каталогом не потрібен.

---

## File Structure (Inventory)

**Stats з поточного дерева (станом на момент написання плану):**

| Сутність | Кількість | Дія |
|---|---|---|
| `js/<concern>/check.mjs` файлів | 34 | rename → `js/<concern>.mjs` |
| Helper-модулів (поряд з check.mjs у concern) | ~12 | move → `<rule>/utils/<helper>.mjs` (peer до `js/`, плоско) |
| `js/<concern>/tests/` каталогів | 21 | move → `js/tests/<concern>.test.mjs` або `js/tests/<concern>/` |
| `js/<concern>/template/` каталогів | 3 | move → `js/templates/<concern>/` |
| Data-файлів (.json/.tsv у `js-lint/tooling/`) | 4 | move → `js/data/<concern>/` |
| `abie/utils/` existing | (no-op) | вже в правильному місці; convention reference |
| `npm/scripts/utils/*.mjs` для оновлення | 2 | `discover-checkable-rules.mjs`, `run-rule.mjs` |
| `npm/scripts/utils/tests/*.mjs` для оновлення | 3 | `discover-one-rule.test.mjs`, `discover-checkable-rules.test.mjs`, `run-rule.test.mjs` |
| Integration-тести в `npm/tests/` для оновлення imports | 3 | `integration-repo-checks.test.mjs`, `check-empty-trees.test.mjs`, `check-rule-fixtures.test.mjs` |
| `.cursor/rules/*.mdc` для оновлення тексту | 2 ключові (`scripts.mdc`, `conftest.mdc`) + ~10 правил | sweep |
| `.rego` коментарі що згадують `js/<concern>/` | ~5–10 файлів | sweep |
| CHANGELOG + package.json | 2 | minor bump + BREAKING note |

---

## Task 1: TDD — `listJsConcerns` повертає flat-concerns

**Files:**
- Modify: `npm/scripts/utils/discover-checkable-rules.mjs`
- Modify: `npm/scripts/utils/tests/discover-checkable-rules.test.mjs`
- Modify: `npm/tests/discover-one-rule.test.mjs`

- [ ] **Step 1.1: Прочитати поточні тести**

```bash
cat npm/scripts/utils/tests/discover-checkable-rules.test.mjs
cat npm/tests/discover-one-rule.test.mjs
```

Expected: бачимо `writeFile(join('rules', ruleId, 'js', concern, fileName), 'export const check = () => 0\n')` патерн — фікстури створюють `js/<concern>/check.mjs`.

- [ ] **Step 1.2: Оновити фікстури в обох тестах на flat-layout**

У `npm/scripts/utils/tests/discover-checkable-rules.test.mjs`: помічник `writeConcernJs(ruleId, concern, fileName, ...)` зараз пише в `js/<concern>/<fileName>`. Змінити на flat-layout: пише в `js/<concern>.mjs` (ім'я файла = concern name, параметр `fileName` ігнорується для звичайних concerns; для backwards compatibility лишити signature, але внутрішньо мапити).

Conкретно: знайди всі `writeFile(join('rules', ruleId, 'js', concern, fileName), …)` і заміни на `writeFile(join('rules', ruleId, 'js', `${concern}.mjs`), …)`. Параметр `fileName` ставав ім'ям файла — у flat-layout він непотрібен; видалити з call-sites де він `'check.mjs'`.

У `npm/tests/discover-one-rule.test.mjs`: функція `makeFakeRule` пише в `join(ruleDir, 'js', concern, 'check.mjs')` — змінити на `join(ruleDir, 'js', `${concern}.mjs`)`.

- [ ] **Step 1.3: Запустити обидва тести — побачити FAIL**

```bash
cd npm && bun test scripts/utils/tests/discover-checkable-rules.test.mjs tests/discover-one-rule.test.mjs 2>&1 | tail -20
```

Expected: failures з повідомленнями типу `expected ['applies', 'env_dns'] received []` — discover не бачить flat-файлів.

- [ ] **Step 1.4: Переписати `listJsConcerns` під flat-layout**

У `npm/scripts/utils/discover-checkable-rules.mjs`:

1. Видалити константу `CHECK_FILENAME_RE` та `TEST_SUFFIX` (більше не потрібні в новому коді):

```js
// Видалити ці два рядки:
// const CHECK_FILENAME_RE = /^check(?:-.+)?\.mjs$/u
// const TEST_SUFFIX = '.test.mjs'
```

2. Спростити `JsConcern` JSDoc — без `files`:

```js
/**
 * @typedef {object} JsConcern
 * @property {string} name імʼя концерну (= basename файла `js/<name>.mjs` без розширення)
 */
```

3. Переписати `listJsConcerns`:

```js
/**
 * Перелічує JS-концерни одного правила: файли `js/<name>.mjs` (один файл — один concern).
 *
 * Усі підкаталоги (`tests/`, `templates/`, `data/`) ігноруються через `!entry.isFile()`.
 * `*.test.mjs` фільтруються окремо (хоч вони й живуть у `tests/`, додаткова перевірка
 * захищає від випадкового `concern.test.mjs` файла прямо в `js/`).
 * @param {string} jsDir абсолютний шлях `rules/<id>/js/`
 * @returns {Promise<JsConcern[]>} концерни в алфавітному порядку
 */
async function listJsConcerns(jsDir) {
  if (!existsSync(jsDir)) return []
  const entries = await readdir(jsDir, { withFileTypes: true })
  /** @type {JsConcern[]} */
  const concerns = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.mjs')) continue
    if (entry.name.endsWith('.test.mjs')) continue
    if (entry.name.startsWith('.')) continue
    const name = entry.name.slice(0, -'.mjs'.length)
    concerns.push({ name })
  }
  return concerns.toSorted((a, b) => a.name.localeCompare(b.name))
}
```

4. Оновити JSDoc на початку файла:

```js
/**
 * Discovery rules для CLI `fix`. Шукає правила, для яких є щось «прогонне»:
 *   - JS concerns:   `rules/<id>/js/<concern>.mjs` — один файл = один concern.
 *   - Policy concerns: `rules/<id>/policy/<concern>/target.json` — пара з `<concern>.rego`.
 *
 * Discovery дивиться тільки на `*.mjs`-файли прямо в `js/`; усі підкаталоги
 * (`tests/`, `templates/`, `data/`) скіпаються. Helpers живуть у peer-каталозі
 * `<rule>/utils/` (не в `js/`) — discovery їх взагалі не торкається.
 *
 * Намеренно НЕ парсимо `target.json` тут (це робить runner). Discovery — швидкий скан структури:
 * шляхи + назви, без I/O вмісту.
 *
 * Історичний контекст: convention пройшла еволюцію
 *   `js/<concern>/check.mjs` (1.13.80–1.13.89)
 *   → `js/<concern>.mjs` (1.14.0+, flat: концерн = файл, не каталог)
 * Tests, templates і data винесені в підпапки усередині `js/` (`js/tests/`, `js/templates/`,
 * `js/data/`). Helpers — у peer-каталозі `<rule>/utils/` (existing convention від `abie/utils/`).
 */
```

- [ ] **Step 1.5: Запустити тести — мають пройти**

```bash
cd npm && bun test scripts/utils/tests/discover-checkable-rules.test.mjs tests/discover-one-rule.test.mjs 2>&1 | tail -10
```

Expected: PASS у обох.

- [ ] **Step 1.6: Commit**

```bash
git add npm/scripts/utils/discover-checkable-rules.mjs npm/scripts/utils/tests/discover-checkable-rules.test.mjs npm/tests/discover-one-rule.test.mjs
git commit -m "feat(utils): listJsConcerns шукає flat js/<concern>.mjs

Прибрано CHECK_FILENAME_RE і вкладену структуру js/<concern>/check.mjs.
Тепер кожен файл js/<concern>.mjs — окремий concern. Підкаталоги js/
(tests/, templates/, data/) скіпаються через !isFile().

JsConcern.files більше не потрібен (один файл на concern) — дроп.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: TDD — `runRule`/`resolveJsCheckPath` під flat-layout

**Files:**
- Modify: `npm/scripts/utils/run-rule.mjs`
- Modify: `npm/scripts/utils/tests/run-rule.test.mjs`

- [ ] **Step 2.1: Прочитати поточний тест**

```bash
cat npm/scripts/utils/tests/run-rule.test.mjs | head -120
```

Шукай `writeConcernJs('text', 'cspell', 'check.mjs', …)` патерн — фікстури пишуть `js/<concern>/check.mjs`.

- [ ] **Step 2.2: Оновити фікстури тестів `run-rule.test.mjs`**

Замінити `writeConcernJs('text', 'cspell', 'check.mjs', code)` на `writeConcernJs('text', 'cspell', code)` (без `fileName`-параметра — він тепер завжди `${concern}.mjs`). Сам helper `writeConcernJs` теж переписати у файлі:

```js
async function writeConcernJs(ruleId, concern, body) {
  await mkdir(join('rules', ruleId, 'js'), { recursive: true })
  await writeFile(join('rules', ruleId, 'js', `${concern}.mjs`), body, 'utf8')
}
```

(Прибрати створення піддиректорії `js/<concern>/`; писати прямо `js/<concern>.mjs`.)

- [ ] **Step 2.3: Запустити тести — побачити FAIL**

```bash
cd npm && bun test scripts/utils/tests/run-rule.test.mjs 2>&1 | tail -15
```

Expected: failures (модуль не знайдено, бо `resolveJsCheckPath` ще будує старий шлях).

- [ ] **Step 2.4: Переписати `runRule` + `resolveJsCheckPath`**

У `npm/scripts/utils/run-rule.mjs`:

1. Переписати `resolveJsCheckPath` (тепер без параметра `fileName`):

```js
/**
 * Обчислює абсолютний шлях до файла-концерну: `rules/<id>/js/<concern>.mjs`.
 * Flat-convention з'явилася в 1.13.90 — концерн = файл, не каталог.
 * @param {string} bundledRulesDir абсолютний `rules/`
 * @param {string} ruleId id правила
 * @param {import('./discover-checkable-rules.mjs').JsConcern} concern опис концерну
 * @returns {string} абсолютний шлях
 */
function resolveJsCheckPath(bundledRulesDir, ruleId, concern) {
  return join(bundledRulesDir, ruleId, 'js', `${concern.name}.mjs`)
}
```

2. Оновити `evaluateAppliesGate` — прибрати `concern.files[0]`:

```js
async function evaluateAppliesGate(bundledRulesDir, rule) {
  const concern = rule.jsConcerns.find(c => c.name === APPLIES_CONCERN_NAME)
  if (!concern) return true
  const path = resolveJsCheckPath(bundledRulesDir, rule.id, concern)
  // eslint-disable-next-line no-unsanitized/method -- path з discovered concern, файл з whitelist'у readdir
  const mod = await import(path)
  if (typeof mod.applies !== 'function') return true
  return Boolean(await mod.applies())
}
```

3. Оновити основний цикл у `runRule` — прибрати `for (const fileName of concern.files)`:

```js
for (const concern of rule.jsConcerns) {
  const path = resolveJsCheckPath(bundledRulesDir, rule.id, concern)
  // eslint-disable-next-line no-unsanitized/method -- path з discovered concern
  const mod = await import(path)
  if (typeof mod.check === 'function') {
    const code = await mod.check()
    if (code !== 0) totalCode = 1
  }
}
```

4. Оновити top-JSDoc:

```js
/**
 * Оркестратор одного правила під CLI `fix`.
 *
 * Послідовність (concerns у межах правила — алфавітно):
 *   1. **applies-гейт** з `js/applies.mjs`. Якщо модуль експортує `applies()` і вона повертає
 *      false — друкуємо `✅ правило не застосовне` і завершуємо без подальших викликів.
 *   2. **JS-концерни** — кожен файл `js/<concern>.mjs`. Concern `applies` теж може мати
 *      `check()` для друку контексту (його `applies()` уже відпрацював на кроці 1, він не повторюється).
 *   3. **Policy-концерни** — кожен `policy/<concern>/target.json` через `runConftestBatch`.
 *
 * Кожен concern має власний `createCheckReporter` — їхні exit-коди OR-яться в один на рівні правила.
 */
```

- [ ] **Step 2.5: Запустити тести — мають пройти**

```bash
cd npm && bun test scripts/utils/tests/run-rule.test.mjs 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 2.6: Запустити всі тести utils — пересвідчитись, нічого не зламано**

```bash
cd npm && bun test scripts/utils/tests/ 2>&1 | tail -10
```

Expected: PASS у всіх.

- [ ] **Step 2.7: Commit**

```bash
git add npm/scripts/utils/run-rule.mjs npm/scripts/utils/tests/run-rule.test.mjs
git commit -m "feat(utils): runRule працює з flat js/<concern>.mjs

resolveJsCheckPath приймає лише (rules, id, concern) і будує
\`rules/<id>/js/<concern>.mjs\` — без проміжного fileName-параметра.
evaluateAppliesGate / runRule розгорнуті відповідно (немає
для-fileName-вкладеного циклу).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migration script (one-off)

Згенерувати скрипт, що для кожного правила переносить структуру. Скрипт використовується ОДИН раз, після виконання — видаляється.

**Files:**
- Create: `npm/scripts/migrate-flat-concerns.mjs`

- [ ] **Step 3.1: Створити скрипт**

```js
// npm/scripts/migrate-flat-concerns.mjs
/**
 * Одноразова міграція: `rules/<rule>/js/<concern>/{check.mjs,helpers,tests,template,data}`
 * → flat-структура:
 *   - `js/<concern>.mjs` (concern entry)
 *   - `js/tests/<concern>.test.mjs` або `js/tests/<concern>/...` (JS tests)
 *   - `js/templates/<concern>/...` (JS templates)
 *   - `js/data/<concern>/...` (JS data, json/tsv)
 *   - `<rule>/utils/<helper>.mjs` (helpers — peer до js/, existing convention від abie/utils/)
 *
 * Працює з `git mv` (зберігає історію). Видалити після успішного PR.
 *
 * Run: bun npm/scripts/migrate-flat-concerns.mjs
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const RULES_DIR = new URL('../rules/', import.meta.url).pathname

function gitMv(from, to) {
  const res = spawnSync('git', ['mv', from, to], { stdio: 'inherit' })
  if (res.status !== 0) throw new Error(`git mv ${from} → ${to} failed`)
}

async function migrateOneRule(ruleDir, ruleId) {
  const jsDir = join(ruleDir, 'js')
  if (!existsSync(jsDir)) return

  const concerns = (await readdir(jsDir, { withFileTypes: true }))
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))

  for (const concernEntry of concerns) {
    const concern = concernEntry.name
    const concernDir = join(jsDir, concern)
    const entries = await readdir(concernDir, { withFileTypes: true })

    // 1. Rename check.mjs → <concern>.mjs.tmp (avoid collision з папкою concern/)
    if (entries.some(e => e.isFile() && e.name === 'check.mjs')) {
      gitMv(join(concernDir, 'check.mjs'), join(jsDir, `${concern}.mjs.tmp`))
    }

    // 2. Move helpers → <rule>/utils/<helper>.mjs (peer до js/, плоско)
    //    Якщо ім'я не має namespace-префікса (rule/concern), варто проконтролювати вручну,
    //    щоб не зіткнутися з існуючими файлами в utils/. Зараз усі helpers вже мають
    //    префікси (vue-, docker-, mssql-, bun-, bunyan-, check-env-, conn-, promise-).
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (entry.name === 'check.mjs') continue
      if (entry.name.endsWith('.mjs')) {
        await mkdir(join(ruleDir, 'utils'), { recursive: true })
        const dest = join(ruleDir, 'utils', entry.name)
        if (existsSync(dest)) {
          throw new Error(`utils collision: ${dest} вже існує. Перейменуй helper'а або глянь конфлікт вручну.`)
        }
        gitMv(join(concernDir, entry.name), dest)
      }
    }

    // 3. Move data files (json/tsv) → js/data/<concern>/
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (entry.name.endsWith('.mjs')) continue
      await mkdir(join(jsDir, 'data', concern), { recursive: true })
      gitMv(join(concernDir, entry.name), join(jsDir, 'data', concern, entry.name))
    }

    // 4. Move template/ → js/templates/<concern>/
    if (entries.some(e => e.isDirectory() && e.name === 'template')) {
      await mkdir(join(jsDir, 'templates'), { recursive: true })
      gitMv(join(concernDir, 'template'), join(jsDir, 'templates', concern))
    }

    // 5. Move tests/ → js/tests/<concern>/ або js/tests/<concern>.test.mjs
    if (entries.some(e => e.isDirectory() && e.name === 'tests')) {
      const testsSrc = join(concernDir, 'tests')
      const testsContents = await readdir(testsSrc, { withFileTypes: true })
      const onlyOneTestFile =
        testsContents.length === 1 &&
        testsContents[0].isFile() &&
        testsContents[0].name === 'check.test.mjs'
      await mkdir(join(jsDir, 'tests'), { recursive: true })
      if (onlyOneTestFile) {
        gitMv(join(testsSrc, 'check.test.mjs'), join(jsDir, 'tests', `${concern}.test.mjs`))
        await rmdir(testsSrc)
      } else {
        gitMv(testsSrc, join(jsDir, 'tests', concern))
      }
    }

    // 6. Remove empty concernDir/
    await rmdir(concernDir).catch(() => {
      console.warn(`⚠️  ${concernDir} не порожній — залишилось щось не оброблене`)
    })

    // 7. Rename <concern>.mjs.tmp → <concern>.mjs
    if (existsSync(join(jsDir, `${concern}.mjs.tmp`))) {
      gitMv(join(jsDir, `${concern}.mjs.tmp`), join(jsDir, `${concern}.mjs`))
    }
  }
}

const ruleEntries = (await readdir(RULES_DIR, { withFileTypes: true }))
  .filter(e => e.isDirectory() && !e.name.startsWith('.'))
  .toSorted((a, b) => a.name.localeCompare(b.name))

for (const entry of ruleEntries) {
  console.log(`\n=== ${entry.name} ===`)
  await migrateOneRule(join(RULES_DIR, entry.name), entry.name)
}

console.log('\n✅ Міграція завершена')
```

- [ ] **Step 3.2: Перевірити чисту git-tree перед запуском**

```bash
git status --short | grep -v "^A " | head -20
```

Expected: лише модифіковані файли з Task 1, 2 — це OK (вони закомічені). Untracked файли НЕ в `npm/rules/`.

> ⚠️ Якщо є uncommitted untracked файли в `npm/rules/`, спершу їх закомітити або винести з дерева — інакше `git mv` може не зрозуміти стан.

- [ ] **Step 3.3: Run migration**

```bash
bun npm/scripts/migrate-flat-concerns.mjs 2>&1 | tail -60
```

Expected: серія `git mv` логів, по 1–7 на правило, фінал `✅ Міграція завершена`.

- [ ] **Step 3.4: Перевірити, що нема залишкових `js/<concern>/` каталогів**

```bash
find npm/rules -mindepth 3 -maxdepth 3 -path "*/js/*" -type d 2>/dev/null | grep -vE "/(tests|templates|data)$"
```

Expected: порожній output (лишилися тільки службові `tests/`, `templates/`, `data/` усередині `js/`).

- [ ] **Step 3.5: Перевірити інвентар: усі `js/<concern>.mjs` створено**

```bash
find npm/rules -mindepth 3 -maxdepth 3 -name "*.mjs" -path "*/js/*" 2>/dev/null | wc -l
```

Expected: 34 (стільки ж, скільки було `check.mjs` до міграції).

- [ ] **Step 3.5a: Helpers — у `<rule>/utils/`**

```bash
# Усі helper-модулі (без abie/utils/, що вже там були) — у нових utils/-каталогах
find npm/rules -mindepth 2 -maxdepth 3 -name "*.mjs" -path "*/utils/*" 2>/dev/null | wc -l
```

Expected: ~20 (8 abie existing + ~12 нових з міграції; залежно від точної кількості helpers).

- [ ] **Step 3.6: Commit міграції (структурні move'и)**

```bash
git add npm/rules npm/scripts/migrate-flat-concerns.mjs
git commit -m "refactor(rules): flat layout js/<concern>.mjs (міграційний move)

Усі 34 concerns переведено з js/<concern>/check.mjs на js/<concern>.mjs.
Helpers → <rule>/utils/<helper>.mjs (peer до js/, existing convention з abie/utils/).
Tests → js/tests/<concern>.test.mjs (single) або js/tests/<concern>/ (multi).
Templates → js/templates/<concern>/.
Data → js/data/<concern>/.

Виконано через git mv (історія збережена). Імпорти в тестах і
посилання в .mdc/.rego оновлюються наступними коммітами.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> На цьому етапі тести зламані (імпорти посилаються на старі шляхи). Це нормально — наступні tasks їх лагодять.

---

## Task 4: Fix imports у integration tests

**Files:**
- Modify: `npm/tests/integration-repo-checks.test.mjs`
- Modify: `npm/tests/check-empty-trees.test.mjs`
- Modify: `npm/tests/check-rule-fixtures.test.mjs`
- Modify: будь-які інші `npm/tests/*.test.mjs`, що містять `rules/<id>/js/<concern>/check.mjs`

- [ ] **Step 4.1: Знайти всі сламані імпорти**

```bash
grep -rln "rules/.*/js/.*/check\.mjs" npm/tests 2>/dev/null
```

Expected: 3+ файли.

- [ ] **Step 4.2: Замінити patterns через sed**

```bash
grep -lZ "rules/[a-z0-9_-]\+/js/[a-z0-9_-]\+/check\.mjs" npm/tests/*.test.mjs 2>/dev/null | xargs -0 -r sed -i.bak -E "s|(rules/[a-z0-9_-]+)/js/([a-z0-9_-]+)/check\.mjs|\1/js/\2.mjs|g"
find npm/tests -name "*.test.mjs.bak" -delete
```

- [ ] **Step 4.3: Перевірити, що нема залишків**

```bash
grep -rn "rules/.*/js/.*/check\.mjs" npm/tests 2>/dev/null
```

Expected: порожньо.

- [ ] **Step 4.4: Якщо переміщені per-concern тести мали `import { check } from '../check.mjs'` — виправити**

Тести, які тепер живуть у `npm/rules/<rule>/js/tests/<concern>.test.mjs`, раніше імпортували `../check.mjs` (з `js/<concern>/tests/` ↑ `js/<concern>/check.mjs`). Новий шлях: `../<concern>.mjs`.

Знайди всі:

```bash
grep -rn "from '\.\./check\.mjs'" npm/rules/*/js/tests/ 2>/dev/null
grep -rn "from '\.\./\.\./check\.mjs'" npm/rules/*/js/tests/ 2>/dev/null
```

Для одиничних test файлів типу `<rule>/js/tests/<concern>.test.mjs`:
- Старе (було в `js/<concern>/tests/`): `from '../check.mjs'`
- Нове (живе в `<rule>/js/tests/`): `from '../<concern>.mjs'`

Аналогічно для нинішніх `<rule>/js/tests/<concern>/*.test.mjs` (multi-test concerns):
- Старе (було в `js/<concern>/tests/`): `from '../check.mjs'`, `from '../<helper>.mjs'`
- Нове (живе в `<rule>/js/tests/<concern>/`): `from '../../<concern>.mjs'`, `from '../../../utils/<helper>.mjs'` (три рівні вгору від `js/tests/<concern>/` → корінь правила → `utils/`)

Скрипт-помічник для авто-заміни:

```bash
# Single-file concern tests: <rule>/js/tests/<concern>.test.mjs
for f in $(find npm/rules -path "*/js/tests/*.test.mjs" -mindepth 5 -maxdepth 5); do
  concern=$(basename "$f" .test.mjs)
  sed -i.bak -E "s|from '\\.\\./check\\.mjs'|from '../${concern}.mjs'|g" "$f"
  # Helpers were `from '../<helper>.mjs'`; тепер `from '../../utils/<helper>.mjs'` (з js/tests/ ↑↑ → utils/)
  sed -i.bak -E "s|from '\\.\\./([a-z0-9_-]+)\\.mjs'|from '../../utils/\\1.mjs'|g" "$f"
done
find npm/rules -name "*.test.mjs.bak" -delete

# Multi-file concern tests: <rule>/js/tests/<concern>/<name>.test.mjs
for f in $(find npm/rules -path "*/js/tests/*/*.test.mjs" -mindepth 6); do
  concern=$(basename "$(dirname "$f")")
  sed -i.bak -E "s|from '\\.\\./check\\.mjs'|from '../../${concern}.mjs'|g" "$f"
  # Helpers: з js/tests/<concern>/ → utils/ — це '../../../utils/'
  sed -i.bak -E "s|from '\\.\\./([a-z0-9_-]+)\\.mjs'|from '../../../utils/\\1.mjs'|g" "$f"
done
find npm/rules -name "*.test.mjs.bak" -delete
```

> ⚠️ Перевір вручну тести в `abie/utils/tests/` — вони існували ДО міграції й мають свої локальні імпорти (`from '../<helper>.mjs'`). Ці імпорти **залишаються правильними** (тест → batja helper у `utils/`), скрипт не повинен їх торкатися — оскільки шлях не починається з `js/tests/`, find їх і не знайде.

- [ ] **Step 4.5: Перевірити, що жоден relative import не залишився сламаним**

```bash
grep -rn "from '\.\./check\.mjs'\|from '\.\./\.\./check\.mjs'" npm/ 2>/dev/null
```

Expected: порожньо.

- [ ] **Step 4.6: Run all tests — більшість має пройти**

```bash
cd npm && bun test 2>&1 | tail -30
```

Expected: 95%+ зелено. Залишки — діагностувати окремо (наприклад, концерн-файл `js/<concern>.mjs` ще може імпортувати helper як `from './<helper>.mjs'` — треба змінити на `from '../utils/<helper>.mjs'`).

- [ ] **Step 4.7: Виправити імпорти концернів, що звертаються до helpers**

Після міграції файл `js/<concern>.mjs` (колишній `check.mjs`) міг імпортувати helper як `./helper.mjs` (бо лежали в одному каталозі). Тепер helper переїхав у `<rule>/utils/`, тому імпорт має бути `../utils/<helper>.mjs`.

```bash
# Знайти concern-файли, що імпортують щось з './<helper>.mjs' (відносний імпорт у тому ж каталозі)
grep -rn "from '\\./[a-z0-9_-]\\+\\.mjs'" npm/rules/*/js/*.mjs 2>/dev/null | grep -v "\\.test\\.mjs"
```

Для кожного знайденого:
- Якщо це import helper'а, що переїхав у `utils/` — замінити `from './<helper>.mjs'` → `from '../utils/<helper>.mjs'`.
- Якщо це import іншого concern'а — лишити (бо вони обидва в `js/`).

Скрипт-помічник (auto-fix):

```bash
# Спочатку знайди список helpers, що реально живуть у utils/ кожного правила
for rule_dir in npm/rules/*/; do
  rule=$(basename "$rule_dir")
  utils_dir="$rule_dir/utils"
  [ -d "$utils_dir" ] || continue
  for helper_file in "$utils_dir"/*.mjs; do
    [ -f "$helper_file" ] || continue
    helper=$(basename "$helper_file" .mjs)
    # У concern-файлах того ж правила: замінити './$helper.mjs' → '../utils/$helper.mjs'
    for concern_file in "$rule_dir/js"/*.mjs; do
      [ -f "$concern_file" ] || continue
      sed -i.bak -E "s|from '\\./${helper}\\.mjs'|from '../utils/${helper}.mjs'|g" "$concern_file"
    done
  done
done
find npm/rules -name "*.mjs.bak" -delete
```

- [ ] **Step 4.8: Run tests знов, до повного зеленого**

```bash
cd npm && bun test 2>&1 | tail -10
```

Expected: усі зелено.

- [ ] **Step 4.9: Commit**

```bash
git add npm/tests npm/rules
git commit -m "test: оновити import-шляхи rules/<id>/js/<concern>/check.mjs → js/<concern>.mjs

Integration-тести (npm/tests/) і per-rule тести (npm/rules/*/js/tests/)
тепер імпортують flat-концерни (js/<concern>.mjs) і helpers з
<rule>/utils/<helper>.mjs (peer до js/).

Concern-файли (js/<concern>.mjs) — імпорти helpers переписано з
'./<helper>.mjs' на '../utils/<helper>.mjs'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Smoke test CLI

**Files:** жодних змін; лише валідація.

- [ ] **Step 5.1: Прямий запуск pilot-правила (`abie`, у нього найбільше JS-концернів)**

```bash
bun npm/rules/abie/fix.mjs 2>&1 | tail -20
```

Expected: успішний прогон (exit-code 0 чи 1 без crash'у); вивід містить per-concern summary типу `✅ applies: …`, `✅ env_dns: …` тощо. Жодного `Cannot find module` / `ENOENT`.

- [ ] **Step 5.2: Запуск через CLI**

```bash
npx --no @nitra/cursor fix abie 2>&1 | tail -20
```

Expected: ідентичний вивід (CLI делегує до того ж fix.mjs).

- [ ] **Step 5.3: Запуск всіх правил**

```bash
npx --no @nitra/cursor fix 2>&1 | tail -50
```

Expected: усі правила перелічені в алфавітному порядку, кожне з summary. Reasonable exit-code (0 або 1 з реальними violations, без crash'у).

> ⚠️ Якщо тут крах — діагностувати конкретно. Найімовірніша причина — десь не оновлено імпорт, або lazy `await import(...)` падає. Дивись stack trace, виправляй точечно, додавай unit-тест якщо знайдено пропуск.

- [ ] **Step 5.4: Commit (якщо були виправлення; інакше — пропустити)**

```bash
git add -A
git status --short
# Якщо щось залишилось — commit:
git commit -m "fix(rules): доводимо flat-міграцію до зеленого CLI

Залишкові правки шляхів/імпортів після міграції — щоб
\`npx @nitra/cursor fix\` запускався без помилок.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Оновити `.cursor/rules/scripts.mdc` canon

**Files:**
- Modify: `.cursor/rules/scripts.mdc`

- [ ] **Step 6.1: Прочитати поточну версію scripts.mdc**

```bash
cat .cursor/rules/scripts.mdc | head -60
```

Шукай згадки `js/<concern>/check.mjs`, `rules/<rule>/js/<concern>/`. Згідно з 1.13.87 CHANGELOG, scripts.mdc — це канон для патернів `lint-*` і `withLock`; він не описує JS-discovery детально, але може мати приклади шляхів.

- [ ] **Step 6.2: Замінити усі legacy-шляхи**

Знайди й заміни:
- `rules/<rule>/js/<concern>/check.mjs` → `rules/<rule>/js/<concern>.mjs`
- `rules/<rule>/js/<concern>/<helper>.mjs` → `rules/<rule>/utils/<helper>.mjs`
- `rules/<rule>/js/<concern>/tests/` → `rules/<rule>/js/tests/`

Зроби через Edit-тулзу точечно (бо це канон-документ, треба зрозуміти кожну згадку в контексті).

- [ ] **Step 6.3: Додати секцію про flat-layout (якщо її ще немає)**

Додати після опису структури `rules/<rule>/` коротку нотатку:

```markdown
## Flat концерн-лейаут (з 1.14.0)

Кожен JS-концерн правила — це **один файл** `npm/rules/<rule>/js/<concern>.mjs`. Каталоги
`js/<concern>/` більше не використовуються.

- **Concerns** — `npm/rules/<rule>/js/<concern>.mjs`. Discovery (`listJsConcerns`) сканує
  `<rule>/js/`, повертає файли `*.mjs` без `.test.mjs`. Підкаталоги пропускаються через
  `!entry.isFile()`. Кожен файл = окремий concern; ім'я concern'у = basename(file, '.mjs').
- **Tests** — `npm/rules/<rule>/js/tests/<concern>.test.mjs` (single) або
  `npm/rules/<rule>/js/tests/<concern>/<name>.test.mjs` (multi-file + fixtures).
  Симетрія з `policy/<concern>_test.rego` — тести там, де імплементація.
- **Templates** — `npm/rules/<rule>/js/templates/<concern>/`.
- **Data** (json/tsv) — `npm/rules/<rule>/js/data/<concern>/`.
- **Helpers (cross-concern та concern-private)** — `npm/rules/<rule>/utils/<helper>.mjs`,
  peer до `js/` (existing convention з `abie/utils/`). Плоско, з namespace'ованими іменами
  (`vue-forbidden-imports.mjs`, `docker-mirror.mjs`, `mssql-pool-scan.mjs`). Тести для helpers —
  у `npm/rules/<rule>/utils/tests/<helper>.test.mjs` (так уже робить abie).

Імпорти:
- Concern → helper: `from '../utils/<helper>.mjs'`
- Test (single) → concern: `from '../<concern>.mjs'` (з `js/tests/<concern>.test.mjs`)
- Test (multi) → concern: `from '../../<concern>.mjs'` (з `js/tests/<concern>/<name>.test.mjs`)
- Test (multi) → helper: `from '../../../utils/<helper>.mjs'` (з `js/tests/<concern>/<name>.test.mjs`)
```

- [ ] **Step 6.4: Bump version-comment у scripts.mdc (якщо є метадані версії)**

Якщо в scripts.mdc є рядок типу `<!-- version: 1.10 -->` — bump на наступну minor.

- [ ] **Step 6.5: Commit**

```bash
git add .cursor/rules/scripts.mdc
git commit -m "docs(scripts): оновити канон під flat js/<concern>.mjs

Шляхи rules/<rule>/js/<concern>/check.mjs → js/<concern>.mjs;
додано секцію про tests/, templates/, data/ всередині js/, helpers
у <rule>/utils/ (peer до js/, existing convention з abie/utils/).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Оновити `.cursor/rules/conftest.mdc` + sweep всіх rule .mdc

**Files:**
- Modify: `.cursor/rules/conftest.mdc`
- Modify: `npm/rules/*/<rule>.mdc` (якщо є згадки старих шляхів)
- Modify: `npm/rules/*/policy/*/*.rego` (коментарі)

- [ ] **Step 7.1: conftest.mdc — замінити usage examples**

```bash
grep -n "js/<concern>/check\|rules/<rule>/js/<concern>/" .cursor/rules/conftest.mdc
```

Заміни усі знайдені patterns:
- `rules/<rule>/js/<concern>/check.mjs` → `rules/<rule>/js/<concern>.mjs`
- `js/<concern>/check.mjs::check()` → `js/<concern>.mjs::check()`
- `rules/<rule>/js/<concern>/tests/check.test.mjs` → `rules/<rule>/js/tests/<concern>.test.mjs`

- [ ] **Step 7.2: Sweep правил .mdc**

```bash
grep -rln "js/[a-z0-9_-]\+/check\.mjs\|js/<concern>/check" npm/rules/*/*.mdc 2>/dev/null
```

Для кожного знайденого файла — Edit точечно. Аналогічна заміна.

- [ ] **Step 7.3: Sweep rego comments**

```bash
grep -rln "js/[a-z0-9_-]\+/check\.mjs" npm/rules/*/policy/*/*.rego 2>/dev/null
```

Для кожного — Edit точечно.

- [ ] **Step 7.4: Перевірити, що нема залишків**

```bash
grep -rn "js/[a-z0-9_-]\+/check\.mjs" npm/ .cursor/ 2>/dev/null | grep -v node_modules | grep -v "\.git/"
```

Expected: порожньо (або тільки CHANGELOG-історія).

- [ ] **Step 7.5: Commit**

```bash
git add .cursor/rules npm/rules
git commit -m "docs: sweep references rules/<id>/js/<concern>/check.mjs → js/<concern>.mjs

Оновлено conftest.mdc, всі rule .mdc з прикладами шляхів, і rego-коментарі
що згадували старий вкладений лейаут.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Видалити migration script + final verification

**Files:**
- Delete: `npm/scripts/migrate-flat-concerns.mjs`

- [ ] **Step 8.1: Видалити one-off скрипт**

```bash
git rm npm/scripts/migrate-flat-concerns.mjs
```

- [ ] **Step 8.2: Run all tests**

```bash
cd npm && bun test 2>&1 | tail -10
```

Expected: усі зелено.

- [ ] **Step 8.3: Run lint (один послідовний прогон)**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun run lint 2>&1 | tail -30
```

Expected: zero errors. ⚠️ Згідно `CLAUDE.md` правилом — лише **один** послідовний прогон на сесію, без `&` фону.

- [ ] **Step 8.4: Smoke fix-команда — фінальна верифікація**

```bash
npx --no @nitra/cursor fix abie 2>&1 | tail -10
npx --no @nitra/cursor fix changelog 2>&1 | tail -10
```

Expected: обидві команди успішні.

- [ ] **Step 8.5: Commit**

```bash
git commit -m "chore: видалено one-off migration script

Міграція flat-концернів завершена; скрипт більше не потрібен.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: CHANGELOG + version bump + BREAKING note

**Files:**
- Modify: `npm/CHANGELOG.md`
- Modify: `npm/package.json`

- [ ] **Step 9.1: Перевірити поточну версію**

```bash
grep '"version"' npm/package.json
```

Note: `1.13.89` (або новіша). Наступний — **minor** bump (порушуємо публічну структуру пакета): `1.14.0`.

- [ ] **Step 9.2: Bump до `1.14.0`**

```bash
# Через Edit:
# "version": "1.13.89" → "version": "1.14.0"
```

- [ ] **Step 9.3: Додати запис у CHANGELOG**

Edit `npm/CHANGELOG.md` — після `# Changelog ...` header додати:

```markdown
## [1.14.0] - 2026-05-23

### Changed (BREAKING)

- **Flat концерн-лейаут:** кожен JS-концерн правила тепер — один файл `npm/rules/<rule>/js/<concern>.mjs` замість вкладеного `js/<concern>/check.mjs`. Tests — у `js/tests/<concern>.test.mjs` (single) або `js/tests/<concern>/` (multi+fixtures), templates — у `js/templates/<concern>/`, data (json/tsv) — у `js/data/<concern>/`. Helpers — у `<rule>/utils/<helper>.mjs` peer до `js/` (існуюча конвенція з `abie/utils/`, поширена на всі правила).
- **`JsConcern.files` removed:** один файл на concern, поле більше не потрібне. `runRule` обчислює шлях як `<rule>/js/<concern.name>.mjs`.
- **`CHECK_FILENAME_RE` removed:** discovery більше не використовує regex `check-*.mjs` — `listJsConcerns` фільтрує `*.mjs` без `.test.mjs` (підкаталоги скіпаються через `!isFile()`).

### Breaking

- **Для зовнішніх інтеграторів власних правил:** Old `npm/rules/<rule>/js/<concern>/check.mjs` тепер `npm/rules/<rule>/js/<concern>.mjs`. Tests → `js/tests/`, templates → `js/templates/`, data → `js/data/` (усе всередині `js/`); helpers → `<rule>/utils/<helper>.mjs` (peer до `js/`, як `abie/utils/`). Імпорти helpers з concern-файлів: `from '../utils/<helper>.mjs'`. Міграційний скрипт у git-історії: коміт `refactor(rules): flat layout`.

### Notes

- Internal `JsConcern.files` дроп: якщо ваші скрипти будували шлях вручну через `concern.files[0]`, тепер це `${concern.name}.mjs`.
- Convention для helper-імен: namespace-префікс (наприклад `<rule>-` або `<concern>-`) робить колізії в плоскому `utils/` неможливими (як уже робить abie: `k8s-tree.mjs`, `kustomization-patches.mjs`; docker: `docker-mirror.mjs`; vue: `vue-forbidden-imports.mjs`).
```

(Дату підкорегувати, якщо PR іде не 2026-05-23.)

- [ ] **Step 9.4: Run check changelog**

```bash
npx --no @nitra/cursor fix changelog 2>&1 | tail -10
```

Expected: `✅` без зауважень.

- [ ] **Step 9.5: Final commit**

```bash
git add npm/CHANGELOG.md npm/package.json
git commit -m "release: 1.14.0 — flat концерн-лейаут (BREAKING)

CHANGELOG + minor bump. Структурний refactor:
- js/<concern>/check.mjs → js/<concern>.mjs
- tests → js/tests/
- templates → js/templates/
- data → js/data/
- helpers → <rule>/utils/ (peer до js/, existing convention з abie/utils/)
JsConcern.files і CHECK_FILENAME_RE removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 9.6: Final verification — повний цикл**

```bash
git status                              # має бути clean
bun npm/rules/abie/fix.mjs              # прямий run
npx --no @nitra/cursor fix abie         # CLI run
npx --no @nitra/cursor fix changelog    # 1/1 без зауважень
cd npm && bun test 2>&1 | tail -5       # всі зелено
```

Expected: усі п'ять успішні.

---

## Acceptance Criteria

- [ ] Усі 34 концерни мають файл `npm/rules/<rule>/js/<concern>.mjs`.
- [ ] Жодного каталогу `npm/rules/<rule>/js/<concern>/` (тільки `tests/`, `templates/`, `data/` всередині `js/`).
- [ ] Helpers всі в `npm/rules/<rule>/utils/<helper>.mjs` (peer до `js/`).
- [ ] Per-rule тести в `npm/rules/<rule>/js/tests/<concern>.test.mjs` (single) або `npm/rules/<rule>/js/tests/<concern>/...` (multi).
- [ ] Templates в `npm/rules/<rule>/js/templates/<concern>/`, data в `npm/rules/<rule>/js/data/<concern>/`.
- [ ] `abie/utils/` лишилися без змін (existing convention reference).
- [ ] `cd npm && bun test` — усе зелено.
- [ ] `npx @nitra/cursor fix` (no args) — перебирає всі правила без crash'у.
- [ ] `npx @nitra/cursor fix abie` — той самий вивід, що `bun npm/rules/abie/fix.mjs`.
- [ ] `.cursor/rules/scripts.mdc` має секцію про flat-layout.
- [ ] `.cursor/rules/conftest.mdc` згадки `js/<concern>/check.mjs` замінено на `js/<concern>.mjs`.
- [ ] CHANGELOG має 1.14.0 запис з BREAKING секцією.
- [ ] `npm/scripts/migrate-flat-concerns.mjs` видалено.

---

## Rollback Plan

Якщо після Task 5 (CLI smoke) щось критичне зламано:

```bash
git log --oneline | head -15        # знайти хеш перед Task 3 (migration commit)
git reset --hard <hash-before-task-3>
```

Кожен Task — окремий комміт → можна відкочуватись інкрементально:
- Якщо тести в Task 4 (imports) проблема — revert лише цей комміт; Task 3 (move) лишається.
- Якщо тільки Task 6/7 (docs) — revert лише doc-комміт.

---

## Notes for the Implementing Engineer

1. **TDD дисципліна для Task 1, 2** — фікстури тестів спершу, потім код. Не змішуй.
2. **Migration script (Task 3) — одноразовий**. Не комічай разом з рештою. Окремий комміт → можна revert тільки міграцію, якщо потрібно.
3. **Один послідовний прогон lint** на сесію — без `&` фону, без паралелі (CLAUDE.md правило `n-lint`).
4. **Smoke CLI (Task 5)** — якщо abie дає crash, найімовірніша причина — забутий імпорт у helper або в інтеграційному тесті. Stack trace вкаже точку.
5. **Helpers — у `<rule>/utils/`** (peer до `js/`, не всередині). Discovery в `js/` не торкається `utils/`. Імена helpers — namespace'овані префіксом (rule або concern), щоб у плоскому каталозі не було колізій.
6. **При rename (Task 3) перевірити `git status` перед запуском** — якщо є untracked файли в `npm/rules/`, спершу їх закомітити або винести з дерева.
7. **Migration script має guard на utils collision** — якщо два concerns мають helper з однаковим іменем (наприклад обидва називаються `scan.mjs`), скрипт кине помилку й зупиниться. Виправити вручну: перейменувати один із helpers додаючи префікс concern'у.
8. **`abie/utils/` уже існує** і має 8 helpers + tests/. Міграційний скрипт його не торкається (всі helpers abie вже на правильному місці; concerns abie у `js/<concern>/check.mjs` НЕ мають інших helpers поруч). Якщо в майбутньому з'являться concern-private helpers в abie — вони теж їдуть у `abie/utils/` плоско.
