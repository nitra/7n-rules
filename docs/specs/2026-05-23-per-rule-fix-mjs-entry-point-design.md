# Per-rule `fix.mjs` entry-point — design

**Дата:** 2026-05-23
**Автор:** brainstorm-сесія (vitaliytv ↔ Claude)
**Статус:** draft, очікує review перед `writing-plans`

## Мотивація

Сьогодні правила `npm/rules/<id>/` не мають **власної точки входу**. CLI `n-cursor check` — єдиний спосіб їх запустити: він робить convention-based discovery через `scripts/utils/discover-checkable-rules.mjs` і централізовано оркеструє `applies-гейт → JS-concerns → policy-concerns → mdc-refs check` через `scripts/utils/run-rule.mjs`.

Це обмежує чотири реальні use-cases:

- **Debug одного правила:** немає файла, який можна "відкрити й запустити" — треба пам'ятати CLI-команду й працювати через додатковий шар.
- **IDE Run-button:** Cursor / VS Code пропонують Run-кнопку на `.mjs` файлах; правило без entry-point цього не має.
- **CI per-rule jobs:** `matrix.rule = [abie, k8s, ga, ...]` із спільним `run: bun rules/${{ matrix.rule }}/fix.mjs` — найчистіший CI-патерн, неможливий без entry-point.
- **Future portability:** якщо колись правило (чи підмножина правил) виноситиметься в окремий npm-пакет, entry-point — обов'язкова умова.

Користувач свідомо обрав варіант "справжньої" Inversion of Control (а не shim над поточною convention), з двома доповненнями:

1. Усі правила **обов'язково** мають entry-point — fallback на convention-discovery видаляється.
2. Для уникнення convention-drift локальна логіка в entry-point **заборонена** — все, що відхиляється від стандартної поведінки, додається як **опція в central util'і**, не в окремому правилі.

## Прийняті рішення

| #   | Рішення                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Entry-point — `rules/<id>/fix.mjs`.                                                                                                                                                                                                           |
| R2  | Контракт `fix.mjs`: `export async function run(ctx?) → Promise<number>` + auto-run через `if (import.meta.main)`.                                                                                                                             |
| R3  | Усе оркестрування інкапсульовано в новому `scripts/utils/run-standard-rule.mjs`. Локальна логіка в `fix.mjs` заборонена.                                                                                                                      |
| R4  | Convention-drift керується через **enumerated options у `RuleContext`** (типізовано, документовано), не через локальні відхилення.                                                                                                            |
| R5  | CLI більше не робить convention-based discovery на верхньому рівні — лише перебір каталогів + dynamic import `<id>/fix.mjs`.                                                                                                                  |
| R6  | Shared `walkCache` — **module-level singleton** у `scripts/utils/walk-cache.mjs` з API `getOrCreateWalkCache()` / `resetWalkCache()`.                                                                                                         |
| R7  | Міграція — **атомарна** в одній PR: скрипт-генератор створює 30 `fix.mjs` файлів + rename `fix/` → `js/` + patch CLI. Жодного перехідного fallback.                                                                                           |
| R8  | Папку `rules/<id>/fix/` перейменовуємо на `rules/<id>/js/`, щоб не плутати з корневим `fix.mjs`. Convention стає consistent за технологією: `js/` (JavaScript concerns) ↔ `policy/` (Rego concerns) ↔ `lint/` (зовнішні linter integrations). |

## Архітектура

### Структура каталогу правила (після міграції)

```
rules/abie/
├── abie.mdc                 — людиночитна специфікація
├── auto.md                  — auto-skill markdown
├── fix.mjs                  — НОВИЙ. Entry-point правила.
├── js/                      — RENAMED з fix/. JS-concerns: <concern>/check.mjs
│   ├── applies/check.mjs
│   ├── env_dns/check.mjs
│   ├── firebase_hosting/check.mjs
│   ├── hc_pairing/check.mjs
│   ├── ua_http_route/check.mjs
│   └── ua_node_selector/check.mjs
├── policy/                  — без змін: Rego-concerns <concern>/{*.rego, target.json}
└── utils/                   — без змін: shared helpers
```

**Convention за технологією, не функцією:** `js/` означає "JavaScript-implemented concerns" (паралельно `policy/` — "Rego-implemented"), а не "rule-fix functions". Це усуває семантичну колізію `fix.mjs` ↔ `fix/`: корневий `fix.mjs` тепер не «той самий fix» — це окрема назва entry-point'а правила.

### Контракт `rules/<id>/fix.mjs`

```js
// rules/abie/fix.mjs
import { runStandardRule } from '../../scripts/utils/run-standard-rule.mjs'

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
```

8 рядків. **Уніформно** для всіх 30 правил. Зміст ідентичний у всіх; шлях до util'у відносний (`../../scripts/utils/`).

### Контракт `scripts/utils/run-standard-rule.mjs`

```js
// scripts/utils/run-standard-rule.mjs
import { basename, dirname } from 'node:path'

import { discoverOneRule } from './discover-checkable-rules.mjs'
import { runRule } from './run-rule.mjs'
import { getOrCreateWalkCache } from './walk-cache.mjs'

/**
 * @typedef {object} RuleContext
 * @property {Map<string, Promise<string[]>>} [walkCache] FS-walk cache між concerns одного прогону
 * @property {boolean} [skipMdcRefs] вимкнути mdc-template-refs гейт
 * @property {boolean} [skipApplies] вимкнути applies-гейт (для тестів)
 * @property {string[]} [onlyConcerns] обмежити запуск до підмножини concerns (debug)
 */

/**
 * Запускає стандартну оркестрацію правила: applies → JS-concerns → policy → mdc-refs.
 * Відхилення від стандарту описуються як опції в `ctx`, не як локальна логіка.
 * @param {string} ruleDir абсолютний шлях до `rules/<id>/`
 * @param {RuleContext} [ctx]
 * @returns {Promise<number>} 0 OK, 1 violations
 */
export async function runStandardRule(ruleDir, ctx = {}) {
  const ruleId = basename(ruleDir)
  const bundledRulesDir = dirname(ruleDir)
  const rule = await discoverOneRule(ruleDir, ruleId)
  const walkCache = ctx.walkCache ?? getOrCreateWalkCache()
  return runRule(rule, bundledRulesDir, walkCache, ctx)
}
```

### Контракт CLI

Поточний `cli-entry.mjs` (check-команда) переходить з `discoverCheckableRules → runRule` на `listRuleIds → dynamic import + mod.run`.

```js
// scripts/cli-entry.mjs (фрагмент)
import { join } from 'node:path'

import { listRuleIds } from './utils/list-rule-ids.mjs'
import { getOrCreateWalkCache } from './utils/walk-cache.mjs'

async function checkAll(bundledRulesDir, opts) {
  const ctx = { walkCache: getOrCreateWalkCache() }
  let exitCode = 0
  const ruleIds = await listRuleIds(bundledRulesDir, opts.rule)
  for (const id of ruleIds) {
    const fixPath = join(bundledRulesDir, id, 'fix.mjs')
    // eslint-disable-next-line no-unsanitized/method — id з whitelist'у readdir, fixPath перевіряється existsSync
    const mod = await import(fixPath)
    if (typeof mod.run !== 'function') {
      throw new Error(`${id}: rules/${id}/fix.mjs не експортує run()`)
    }
    exitCode |= await mod.run(ctx)
  }
  return exitCode
}
```

`listRuleIds` — нова утиліта (~15 рядків):

```js
// scripts/utils/list-rule-ids.mjs
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Каталог `rules/<id>/` вважається правилом, якщо містить `fix.mjs`.
 * Після атомарної міграції це інваріант — усі 30 правил мають entry-point.
 * @param {string} bundledRulesDir
 * @param {string} [filter] — id одного правила (`--rule abie`)
 * @returns {Promise<string[]>} відсортовані id
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

### Shared state — `walk-cache.mjs`

```js
// scripts/utils/walk-cache.mjs
/** @type {Map<string, Promise<string[]>> | null} */
let cache = null

/** @returns {Map<string, Promise<string[]>>} */
export function getOrCreateWalkCache() {
  if (cache === null) cache = new Map()
  return cache
}

/** Скидає cache (для тестів між кейсами). */
export function resetWalkCache() {
  cache = new Map()
}
```

**Чому singleton:**

- CLI — одиничний процес, одне дерево FS, один час життя кешу.
- Зайвий зайвий шар прокидання (CLI → fix.mjs → runStandardRule → runRule) усувається.
- Тести викликають `resetWalkCache()` у `beforeEach`.
- Прямий `bun rules/abie/fix.mjs` автоматично отримує власний свіжий cache (новий процес — нова module-instance).

## Розширення поведінки — _тільки_ через `RuleContext`

**Заборонено** додавати локальну логіку в `rules/<id>/fix.mjs` за межі двох рядків wrapper'а.

Якщо правилу потрібне відхилення від стандарту, додається:

1. Опція в `RuleContext` (типізована JSDoc, документована в JSDoc функції).
2. Обробка опції в `runStandardRule` або `runRule` — у центральному місці.
3. Виклик у правилі: `runStandardRule(import.meta.dirname, { ...ctx, skipMdcRefs: true })`.

**Наслідок:** простір варіацій поведінки повністю описаний у `RuleContext` JSDoc. Code review одного файла (`run-standard-rule.mjs` + `run-rule.mjs`) показує всі можливі відхилення. Convention-drift як клас проблем виключений на рівні дизайну, а не code review.

## Use-cases — як виконуються

| Use-case             | Команда                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| Debug одного правила | `bun npm/rules/abie/fix.mjs`                                                     |
| IDE Run-button       | Open `rules/abie/fix.mjs`, Run File                                              |
| CI per-rule (matrix) | `bun npm/rules/${{ matrix.rule }}/fix.mjs`                                       |
| Всі правила          | `npx @nitra/cursor check`                                                        |
| Конкретне через CLI  | `npx @nitra/cursor check abie` (зворотна сумісність)                             |
| Future portability   | Файл `fix.mjs` — готовий entry-point; для відриву додати `package.json` і `bin`. |

## Міграція — атомарна, в одній PR

Усе в одному PR (без перехідного fallback'а):

1. **Створити нові utils:**
   - `scripts/utils/walk-cache.mjs`
   - `scripts/utils/list-rule-ids.mjs`
   - `scripts/utils/run-standard-rule.mjs`
   - Експортувати `discoverOneRule(ruleDir, ruleId)` з `discover-checkable-rules.mjs` (виокремити з існуючого `discoverCheckableRules`).

2. **Rename `rules/<id>/fix/` → `rules/<id>/js/`** для всіх 30 правил (через `git mv`, щоб історія збереглася):
   - Оновити `discover-checkable-rules.mjs`: константа `FIX_DIR_NAME = 'fix'` → `'js'`; в JSDoc-ах усі `rules/<id>/fix/<concern>/` → `rules/<id>/js/<concern>/`.
   - Оновити `run-rule.mjs::resolveJsCheckPath`: `join(bundledRulesDir, ruleId, 'fix', ...)` → `join(bundledRulesDir, ruleId, 'js', ...)`.
   - Оновити коментарі в .rego файлах (`policy/<concern>/*.rego`), які посилаються на `fix/<concern>/check.mjs` → `js/<concern>/check.mjs`.
   - Оновити документацію в `.mdc` правилах та `.cursor/rules/conftest.mdc` (згадки `fix/<concern>` → `js/<concern>`).
   - Оновити inter-rule cross-references (наприклад, `npm/rules/hasura/js/internal_urls/check.mjs` посилається на abie-перевірки).

3. **Згенерувати 30 `fix.mjs`:**
   - Скрипт `scripts/generate-fix-mjs.mjs` (одноразовий, після виконання видаляється): пройти `rules/*/`, створити ідентичний `fix.mjs` у кожному каталозі. Шаблон один — змінюється лише шлях у import'і (всі — `../../scripts/utils/run-standard-rule.mjs`).

4. **Переписати CLI:**
   - У `cli-entry.mjs` замінити `discoverCheckableRules + foreach runRule` на `listRuleIds + foreach (await import).run()`.
   - Прибрати top-level виклик `discoverCheckableRules` із CLI. Функція залишається — використовується всередині `runStandardRule`.

5. **Оновити тести:**
   - Додати `tests/run-standard-rule.test.mjs` (контракт util'у — mock'пропустити `discoverOneRule` + `runRule`, перевірити прокидання `ctx`).
   - Додати `tests/walk-cache.test.mjs` (singleton + reset).
   - Додати `tests/list-rule-ids.test.mjs` (фільтрація, сортування).
   - Smoke-тест "усі 30 правил мають `fix.mjs` з валідним експортом `run` та папку `js/`" — швидко детектить пропущене правило в майбутньому.
   - **Оновити import-шляхи в існуючих `tests/*.test.mjs`** — `integration-repo-checks.test.mjs`, `check-empty-trees.test.mjs`, `check-rule-fixtures.test.mjs` та інші літерально імпортують з `rules/<id>/fix/<concern>/check.mjs`. Замінити на `rules/<id>/js/<concern>/check.mjs`. Уважно: міняти лише `/fix/<word>` (папка), не чіпати `fix.mjs` (entry-point) — найпростіше точечно через `git grep` + ручний review. Логіка тестів не змінюється.

6. **CHANGELOG + version bump:**
   - `@nitra/cursor` patch-bump (1.13.79 → 1.13.80).
   - У CHANGELOG зафіксувати: (a) новий entry-point контракт `rules/<id>/fix.mjs`; (b) rename `fix/` → `js/` як **breaking** для зовнішніх інтеграторів, що пишуть власні правила (внутрішнього API це не торкається).

## Тестування — що покривати

| Файл                                            | Що тестує                                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/run-standard-rule.test.mjs`              | `runStandardRule(ruleDir, ctx)` — викликає `discoverOneRule(ruleDir, id)` + `runRule(rule, bundleDir, cache, ctx)` з правильними аргументами. Mock'и обох. |
| `tests/walk-cache.test.mjs`                     | `getOrCreateWalkCache()` повертає той самий instance; `resetWalkCache()` створює новий.                                                                    |
| `tests/list-rule-ids.test.mjs`                  | Фільтрація через `--rule`; сортування; пропуск каталогів без `fix.mjs`; пропуск `.skip`-prefix.                                                            |
| `tests/cli-entry.test.mjs`                      | Integration: `n-cursor check abie` повертає 0 на чистому test-fixture; повертає 1 коли concern fails.                                                      |
| `tests/fix-mjs-contract.test.mjs` (новий smoke) | Для кожного каталогу `rules/<id>/` існує `fix.mjs`; модуль експортує функцію `run`; `await run()` повертає `number`.                                       |

Існуючі `tests/*.test.mjs` для concerns — логіка без змін; модифікуються лише `import`-шляхи `/fix/<concern>/` → `/js/<concern>/` (див. крок 5 міграції).

## Що залишається на наступних кроках (не в цьому spec'і)

- **CLI-прапорці `--changed-only`, format options** — поки не прокидаються в `RuleContext`; додаються пізніше, коли з'явиться конкретна потреба.
- **Hooks per-rule (`before.mjs` / `after.mjs`)** — НЕ додаємо за замовчуванням; обговорюємо тоді, коли реальна потреба з'явиться. Цей spec свідомо тримає поверхню API мінімальною.
- **Поділ правил на окремі npm-пакети** — можливість залишається відкритою (entry-point готовий), реалізується окремим spec'ом.

## Відкриті ризики

| Ризик                                                                    | Митigaція                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Хтось додасть локальну логіку в `fix.mjs` (порушить convention)          | ESLint-правило / lint-конвенція: `fix.mjs` мусить містити лише дозволений шаблон (2 imports, 1 export, 1 main-блок). Можна як smoke-тест: парсити AST і порівнювати з template.                                                          |
| `import.meta.main` (Bun-specific) — не працює в Node.js                  | Sprint обмежений Bun-середовищем (`engines.bun >= 1.3` у root `package.json`). Для Node.js — `process.argv[1] === fileURLToPath(import.meta.url)` як fallback, але це YAGNI поки немає вимоги Node-сумісності.                           |
| Прямий `bun rules/abie/fix.mjs` не отримує CLI-флагів (`--rule`, формат) | `import.meta.main` блок не парсить `process.argv` — для debug це ОК, для CI можна додати мінімальний argv-парсер пізніше якщо знадобиться.                                                                                               |
| 30 однакових `fix.mjs` файлів — duplication смутку                       | Прийнято свідомо: це trivial wrapper з 8 рядків. Альтернатива (генерація на ходу через "magic" loader) — складніше. Можна додати ESLint-rule, що блокує модифікацію `fix.mjs` без спеціального коментаря — захист від "розумних" правок. |

## Acceptance criteria

- [ ] Усі 30 правил мають `rules/<id>/fix.mjs` з ідентичним шаблоном (8 рядків).
- [ ] Усі 30 правил мають перейменовану папку `rules/<id>/js/` (раніше `fix/`); жодного залишку `fix/` як каталогу.
- [ ] Жодне посилання на `rules/<id>/fix/<concern>/` не лишилось у `.mdc`, `.rego`, `.mjs` (поза CHANGELOG-історією) — перевірка grep'ом.
- [ ] `bun npm/rules/abie/fix.mjs` запускає правило abie і повертає той самий exit-code, що `npx @nitra/cursor check abie`.
- [ ] `npx @nitra/cursor check` (без аргументів) перебирає всі правила в алфавітному порядку через `listRuleIds`.
- [ ] `npx @nitra/cursor check abie` працює як раніше (фільтрація через `--rule` або позиційний аргумент).
- [ ] `walkCache` шариться між концернами в одному прогоні (перевіряється через smoke-тест на shared invocation count).
- [ ] Існуючі тести `tests/*.test.mjs` проходять після оновлення import-шляхів `rules/<id>/fix/<concern>/` → `rules/<id>/js/<concern>/`. Логіка тестів не змінюється.
- [ ] Нові тести (`run-standard-rule`, `walk-cache`, `list-rule-ids`, `fix-mjs-contract`) проходять.
- [ ] CHANGELOG + version bump зафіксовано; `npx @nitra/cursor check changelog` зелений.

## Зворотна сумісність

- `npx @nitra/cursor check [<rule>]` — поведінка незмінна для користувачів.
- Команди в CI (`bun run lint` через root `package.json`) — без змін.
- Внутрішня структура `rules/<id>/policy/` — без змін.
- **Breaking для зовнішніх інтеграторів**, що пишуть кастомні правила і покладаються на каталог `rules/<id>/fix/`: треба rename на `js/`. У `@nitra/cursor` всі вбудовані правила мігруються атомарно в цій же PR.
- Додається новий обов'язковий файл `fix.mjs` у корені кожного правила — без нього CLI не запустить правило.
