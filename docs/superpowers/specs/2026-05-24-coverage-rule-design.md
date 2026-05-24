---
type: spec
title: "n-cursor coverage — оркестратор покриття + мутаційного тестування"
---

# `n-cursor coverage` — design

**Дата:** 2026-05-24
**Автор:** brainstorm-сесія (vitaliytv ↔ Claude)
**Статус:** draft, очікує review перед `writing-plans`

## Мотивація

У mlmail зараз живе скрипт `scripts/coverage.js` (236 рядків) + допоміжний `scripts/with-lock.js`, які агрегують покриття (`bun test --coverage`, `cargo llvm-cov`) і мутаційне тестування (Stryker, `cargo-mutants`), а тоді записують `COVERAGE.md`. Скрипт жорстко прибитий до форми проєкту (`app/` + `src-tauri/`), не перевикористовується, дублює власну реалізацію локу замість канонічного `withLock` із [`@nitra/cursor`](../../npm).

Інші проєкти (поточні Vue/Tauri й майбутні Python/Rust-крейти) не мають однотипного механізму. Канонічна команда має жити в `@nitra/cursor` — як `lint-ga`/`lint-text`/майбутній `lint-rust` — і автоматично підбирати релевантних провайдерів метрик за `.n-cursor.json#rules`.

## Прийняті рішення (підсумок brainstorm)

| # | Рішення |
|---|---|
| C1 | Перенесення повне: `scripts/coverage.js` і `scripts/with-lock.js` видаляються з mlmail; команда `n-cursor coverage` живе в `@nitra/cursor`. |
| C2 | Сегментація провайдерів — **per-rule**: кожне правило мови/рантайму, що активне в `.n-cursor.json#rules`, постачає свій `coverage/coverage.mjs`. Зараз: `js-lint`, `rust`. Майбутнє: `python` тощо. |
| C3 | Discovery провайдерів — через існуючий **`.n-cursor.json#rules`** (варіант δ з brainstorm). Жодних нових полів конфігу, нових механізмів активації. |
| C4 | Лок — через **нову стандартну точку входу `runStandardCoverage`** ([`scripts.mdc § withLock`](../../.cursor/rules/scripts.mdc)). Власні `lint.mjs` / `coverage.mjs` НЕ викликають `withLock` напряму. |
| C5 | Ключ локу — **константа `'coverage'`** (один оркестратор → один ключ). Майбутні per-rule coverage-команди (якщо колись з'являться) дістануть свій ключ через basename-derivation як у `runStandardLint`. |
| C6 | Канон `scripts.coverage` у `package.json` — через **rego policy + template snippet** у `npm/rules/test/policy/package_json/` ([`scripts.mdc § Канон через template`](../../.cursor/rules/scripts.mdc)). У `test.mdc` — markdown-link, не inline fenced-block з `title="<filename>"`. |
| C7 | Канонічна форма скрипта — `"coverage": "n-cursor coverage"` (substring-вимога через слот `.contains.json` — узгоджено з підходом `rust.package_json` у `2026-05-23-rust-rule-design.md`). |
| C8 | `app/package.json` у mlmail втрачає `test:mutation` і `test:rust:mutation` — Stryker і `cargo-mutants` тепер запускаються виключно через провайдери. `test:coverage` (workspace-локальний `bun test --coverage`) **лишається** — провайдер JS викликає його через `bun --cwd=app run test:coverage` (або еквівалент). |
| C9 | Залежність від правила `rust` ([2026-05-23-rust-rule-design.md](2026-05-23-rust-rule-design.md)) — це окреме затверджене правило в drafts. Для повної функціональності в mlmail цей spec потребує, щоб `rust` rule був імплементований **до або разом** з coverage. План реалізації нижче окреслює два варіанти sequencing. |

## Архітектура

### Структура каталогів у `@nitra/cursor`

```
npm/scripts/utils/
├── run-standard-coverage.mjs               ← НОВА wrapper: withLock('coverage', stepsFn)
└── tests/
    └── run-standard-coverage.test.mjs

npm/rules/test/
├── test.mdc                                ← + секція «Покриття» з markdown-links на template
├── fix.mjs                                 ← (без змін — runStandardRule)
├── js/
│   ├── location.mjs                        ← (без змін)
│   └── tests/location.test.mjs
├── coverage/                               ← НОВЕ peer-dir (як ga/lint/)
│   ├── coverage.mjs                        ← оркестратор: runCoverageCli = runStandardCoverage(steps)
│   └── tests/
│       └── coverage.test.mjs
└── policy/                                 ← НОВЕ (досі test/ не мав policy/)
    └── package_json/
        ├── target.json                     ← {"files":{"single":"package.json","required":true},"missingMessage":"..."}
        ├── package_json.rego               ← `package test.package_json` + `import rego.v1`
        ├── package_json_test.rego          ← golden pass + per-substring fail + drift-test
        └── template/
            └── package.json.contains.json  ← {"scripts":{"coverage":["n-cursor coverage"]}}

npm/rules/js-lint/
├── js-lint.mdc                             ← + згадка про JS-coverage-провайдер (markdown-link на coverage/)
└── coverage/                               ← НОВЕ peer-dir
    ├── coverage.mjs                        ← detect() + collect(): bun test --coverage + Stryker
    └── tests/
        └── coverage.test.mjs

npm/rules/rust/                             ← rule сам по собі будується у 2026-05-23-rust-rule-design.md
└── coverage/                               ← НОВЕ peer-dir (4-й концерн поряд з трьома lint-концернами)
    ├── coverage.mjs                        ← detect() + collect(): cargo llvm-cov + cargo-mutants
    └── tests/
        └── coverage.test.mjs

npm/bin/n-cursor.js                         ← case 'coverage': await runCoverageCli()
```

**Convention відповідно до [`scripts.mdc`](../../.cursor/rules/scripts.mdc):**
- `coverage/` — peer-dir, як `lint/` у `ga` — призначений для CLI-підкоманди (`n-cursor coverage`), що НЕ обслуговується `js/<concern>.mjs` discovery'єм. Файли тут НЕ авто-реєструються в `fix`-flow.
- Тести співрозташовані з джерелом (`coverage/tests/coverage.test.mjs`).
- Жодного `withLock(...)` у `coverage/coverage.mjs` — лок іде через `runStandardCoverage`.
- У `test.mdc` секція «Покриття» лінкує `package.json.contains.json` через markdown-link; жодного inline-fenced-блока з `title="package.json"` ([`scripts.mdc § Red flag pure-doc`](../../.cursor/rules/scripts.mdc)).

### Контракт провайдера

Кожне правило мови/рантайму, що бере участь у `n-cursor coverage`, постачає файл `npm/rules/<rule>/coverage/coverage.mjs` з контрактом:

```js
/**
 * @typedef {object} CoverageRow
 * @property {string} area                                          назва секції в COVERAGE.md, напр. "JS (app)"
 * @property {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} coverage
 * @property {{caught:number,total:number}} mutation                # caught = killed + timeout
 */

/**
 * Швидкий gate: чи провайдер застосовний у поточному cwd.
 * Лише FS-перевірки (existSync, readFile JSON-конфігів); жодних spawn'ів.
 * @param {string} cwd
 * @returns {Promise<boolean>}
 */
export async function detect(cwd)

/**
 * Збирає метрики. Може повернути 0+ рядків (наприклад js-lint віддасть один JS-рядок).
 * Усі важкі spawn'и (test runner, mutation tool) — тут.
 * @param {string} cwd
 * @returns {Promise<CoverageRow[]>}
 */
export async function collect(cwd)
```

#### `js-lint/coverage/coverage.mjs` — JS-провайдер

`detect(cwd)`:
- `package.json` існує **І** містить `scripts["test:coverage"]` або `scripts["test"]` з `--coverage`-сумісністю.

`collect(cwd)`:
1. `bun --cwd=<jsRoot> run test:coverage --coverage-reporter=lcov --coverage-dir=<tmpdir>` (де `<jsRoot>` — `app/` у workspace-проєктах або корінь у single-package). Парс `lcov.info`.
2. `bunx stryker run` у `<jsRoot>` — парс `reports/stryker/mutation.json`. Killed + Timeout = `caught`; Survived + NoCoverage = до `total`; Compile/Runtime errors виключені.

Резолвер `<jsRoot>`: `package.json#workspaces[0]` якщо є — інакше `cwd`. У mlmail дасть `app/`. Точна стратегія — деталізується при реалізації; може стати `.n-cursor.json#coverage.jsRoot` опційно якщо знадобиться override.

Повертає 1 рядок: `{ area: 'JS', coverage: {...}, mutation: {...} }`.

#### `rust/coverage/coverage.mjs` — Rust-провайдер

`detect(cwd)`:
- Існує `Cargo.toml` у `cwd` або у будь-якому workspace-каталозі (повторне використання walker'а з `rust/js/applies/check.mjs` — `hasCargoTomlInWorkspaces`).

`collect(cwd)`:
1. `cargo llvm-cov --manifest-path <Cargo.toml> --json --summary-only` — парс `data[0].totals`.
2. `cargo mutants --in-place -o <tmpOutDir> --manifest-path <Cargo.toml>` — парс `<tmpOutDir>/mutants.out/outcomes.json`. `caught = outcomes.caught + outcomes.timeout`; `total = caught + outcomes.missed`. Не-нульовий exit code від cargo-mutants очікуваний (мутанти missed → exit ≠ 0); вірогідний справжній крах детектиться відсутністю `outcomes.json`.
3. Errors: `cargo-llvm-cov` / `cargo-mutants` не встановлені → відповідь з конкретною інструкцією `cargo install cargo-llvm-cov` / `cargo install cargo-mutants`.

Резолвер `<Cargo.toml>`: `cwd/Cargo.toml` якщо є, інакше перший знайдений у workspace-каталогах (для mlmail — `app/src-tauri/Cargo.toml`).

Повертає 1 рядок: `{ area: 'Rust', coverage: {...}, mutation: {...} }`.

### Оркестратор (`test/coverage/coverage.mjs`)

```js
/**
 * Канонічна команда `n-cursor coverage`: збирає метрики покриття + мутаційного
 * тестування з усіх провайдерів, чиє правило активне у `.n-cursor.json#rules`,
 * агрегує та записує COVERAGE.md у корінь проєкту.
 *
 * Discovery провайдерів — за `.n-cursor.json#rules`: для кожного `ruleId` зі
 * списку шукаємо `npm/rules/<ruleId>/coverage/coverage.mjs` і динамічно
 * імпортуємо. Якщо файлу немає — провайдер для цього правила відсутній (skip
 * silently, не помилка).
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadNCursorConfig } from '../../../scripts/utils/load-cursor-config.mjs'  // або read-n-cursor-config-lite; уточниться при реалізації
import { runStandardCoverage } from '../../../scripts/utils/run-standard-coverage.mjs'

const RULES_DIR = dirname(dirname(fileURLToPath(import.meta.url)))  // .../rules/test → .../rules

async function loadProvider(ruleId) {
  const providerPath = join(RULES_DIR, ruleId, 'coverage', 'coverage.mjs')
  if (!existsSync(providerPath)) return null
  return import(providerPath)
}

async function runCoverageSteps() {
  const cwd = process.cwd()
  const config = await loadNCursorConfig(cwd)
  const rows = []

  for (const ruleId of config.rules ?? []) {
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

`buildTotalsRow`, `renderMarkdown` — переносяться з mlmail/scripts/coverage.js (функції `addCoverage`, `addMutation`, `formatCoverage`, `formatScore`, `renderMarkdown`); лишаються чистими функціями для unit-тестування.

### `runStandardCoverage` ([`npm/scripts/utils/run-standard-coverage.mjs`](../../npm/scripts/utils/))

```js
/**
 * Спільна точка входу для `n-cursor coverage`.
 *
 * Дзеркально до `runStandardLint` / `runStandardRule`: тут крос-cutting concerns
 * (телеметрія, env-toggle вимкнення локу для дебагу, common preflight-логування)
 * додаються в одному місці.
 *
 * Зараз робить рівно одне: серіалізує + дедуплікує запуски через `withLock('coverage')`.
 *
 * Ключ — константа `'coverage'`, бо оркестратор один. Якщо колись з'являться
 * per-rule coverage CLI (`n-cursor coverage-js`), вони матимуть власні ключі
 * через basename-derivation як у `runStandardLint`.
 */
import { withLock } from './with-lock.mjs'

/**
 * @param {() => number | Promise<number>} stepsFn
 * @param {object} [opts]
 * @returns {Promise<number>}
 */
export function runStandardCoverage(stepsFn, opts) {
  return withLock('coverage', stepsFn, opts)
}
```

### Канон у `package.json` ([`test/policy/package_json/`](../../npm/rules/test/policy/package_json/))

#### `template/package.json.contains.json`

Слот `.contains.json` — масив підрядків, що мають бути присутніми у відповідному leaf (`scripts.coverage`):

```json
{
  "scripts": {
    "coverage": ["n-cursor coverage"]
  }
}
```

Канонічна повна форма (для документації / `fix`-репортів) — `n-cursor coverage`. Через substring-семантику дозволено локальні розширення (як приклад, `bun run pre-coverage && n-cursor coverage` — допустимо, бо `n-cursor coverage` присутнє як підрядок).

#### `package_json.rego`

```rego
package test.package_json

import rego.v1

# для кожного `s` у data.template.contains.package_json.scripts.coverage:
#   якщо contains(input.scripts.coverage, s) == false → deny
deny contains msg if {
    some s in data.template.contains.package_json.scripts.coverage
    not contains(object.get(object.get(input, "scripts", {}), "coverage", ""), s)
    msg := sprintf("package.json: scripts.coverage має містити %q (test.mdc)", [s])
}
```

`package_json_test.rego` — golden pass + per-substring fail + drift-test (підміна `data.template.contains.package_json.scripts.coverage` → нова deny substring).

#### `target.json`

```json
{
  "files": { "single": "package.json", "required": true },
  "missingMessage": "package.json не знайдено — створи з канонічним scripts.coverage (test.mdc)"
}
```

### Доповнення `test.mdc`

Додати секцію після поточного «Що перевіряє правило» (приблизно з рядка 56):

> ## Покриття + мутаційне тестування
>
> Канонічна команда — `n-cursor coverage`: збирає метрики покриття (`bun test --coverage`, `cargo llvm-cov` тощо) і мутаційного тестування (Stryker, `cargo-mutants`) з усіх активних провайдерів у `.n-cursor.json#rules` і пише `COVERAGE.md` у корінь проєкту. Лок і дедуп — через `runStandardCoverage` (`withLock('coverage')`).
>
> Провайдери живуть у `npm/rules/<rule>/coverage/coverage.mjs` (постачаються правилами мови/рантайму: `js-lint`, `rust`, у майбутньому `python` тощо). Оркестратор — у `npm/rules/test/coverage/coverage.mjs`.
>
> У кожному `package.json` (корінь) має бути:
>
> Канон `scripts.coverage` (substring requirement): [`package.json.contains.json`](./policy/package_json/template/package.json.contains.json)

(Жодного inline fenced-блока з `title="package.json"` — link заінлайнується через `inlineTemplateLinks` під час `npx @nitra/cursor` sync.)

### Доповнення `js-lint.mdc`

Додати один параграф (приблизно після секції «Тести») з посиланням на провайдер:

> Покриття + мутаційне тестування JS постачаються через `n-cursor coverage` (правило `test.mdc`). Реалізація провайдера — у `npm/rules/js-lint/coverage/coverage.mjs`: `bun test --coverage --coverage-reporter=lcov` + `bunx stryker run`.

(Без template, просто крос-посилання, бо вміст canonical-команди валідується через `test/policy/package_json/`.)

### Доповнення `rust.mdc`

(Узгоджується з [2026-05-23-rust-rule-design.md](2026-05-23-rust-rule-design.md): rust rule додає 4-й концерн — `coverage/`.) Додати один параграф:

> Покриття + мутаційне тестування Rust постачаються через `n-cursor coverage` (правило `test.mdc`). Реалізація провайдера — у `npm/rules/rust/coverage/coverage.mjs`: `cargo llvm-cov --json --summary-only` + `cargo mutants --in-place`. Бінарники: `cargo install cargo-llvm-cov && cargo install cargo-mutants`.

### CLI ([`npm/bin/n-cursor.js`](../../npm/bin/n-cursor.js))

Новий `case 'coverage'` (вставити між `case 'lint-text':` і `case 'skill':` за алфавітом або в кінці lint-блоку):

```js
case 'coverage': {
  const { runCoverageCli } = await import('../rules/test/coverage/coverage.mjs')
  process.exitCode = await runCoverageCli()
  break
}
```

Допомогове повідомлення на `case '':` (~рядок 1326) розширити: додати `coverage` у список доступних команд.

## Інтеграція з пакетом

### `npm/scripts/auto-rules.mjs`

Без змін. Coverage — це нова **CLI-команда** правила `test`, не нове правило, тож `AUTO_RULE_ORDER` не зачіпається. `rust` уже наявне в `AUTO_RULE_ORDER` preemptively (хоча саме правило в drafts) — тобто для cовместності з provider-discovery нічого додавати не потрібно.

**Важливе застереження про активацію `test` у споживачі:** правило `test` зараз НЕ авто-детектиться через `auto-rules.mjs` (відсутнє в `AUTO_RULE_ORDER` — наразі не змінюємо). Тобто `npx @nitra/cursor fix` валідуватиме нову `test/policy/package_json/` (вимога `scripts.coverage`) **лише якщо `test` є в `.n-cursor.json#rules` споживача**. У mlmail `test` зараз відсутнє у списку — тож після релізу варто додати, щоб канон scripts.coverage перевірявся в `fix`. CLI-команда `n-cursor coverage` працює незалежно від цього (вона провайдерів шукає, а не правило `test`).

### `npm/package.json`

- `scripts` — без змін.
- `version` — bump minor (нова CLI-команда).
- `engines` — без змін.

### `npm/CHANGELOG.md`

Нова секція ([`scripts.mdc § Завершення задачі`](../../.cursor/rules/scripts.mdc) + [`n-changelog.mdc`](../../.cursor/rules/n-changelog.mdc)):

- **Added:** CLI-команда `n-cursor coverage` — оркестратор покриття + мутаційного тестування з discovery провайдерів через `.n-cursor.json#rules`. Канон `scripts.coverage` (контейнер `package.json`) у правилі `test`. Провайдери: `js-lint` (bun test + Stryker), `rust` (cargo llvm-cov + cargo-mutants). Спільна точка входу `runStandardCoverage` у `npm/scripts/utils/`.

### `CLAUDE.md` (root `nitra/cursor`)

Без змін — `n-test.mdc` уже зареєстровано.

## Зміни в mlmail (post-release у `@nitra/cursor`)

| Файл/каталог | Дія |
|---|---|
| `scripts/coverage.js` | Видалити. |
| `scripts/with-lock.js` | Видалити. |
| `scripts/__tests__/` | Видалити (тести, що покривають coverage.js / with-lock.js). Якщо там є unrelated-тести — мігрувати в `scripts/tests/` за конвенцією `test.mdc#location`. |
| `package.json#scripts.test:scripts` | Видалити (host для `__tests__/`). |
| `package.json#scripts.coverage` | `"bun scripts/with-lock.js bun scripts/coverage.js"` → `"n-cursor coverage"`. |
| `app/package.json#scripts.test:mutation` | Видалити. Stryker тепер запускається тільки через `js-lint/coverage/coverage.mjs`. |
| `app/package.json#scripts.test:rust:mutation` | Видалити. cargo-mutants тепер тільки через `rust/coverage/coverage.mjs`. |
| `app/package.json#scripts.test:coverage` | **Лишається** — workspace-локальний `bun test --coverage --preload …`; провайдер JS викликає його через `bun --cwd=app run test:coverage`. |
| `.n-cursor.json#rules` | Уже містить `rust` (підтверджено `vitaliytv`). **Опційно додати `test`**, щоб `npx @nitra/cursor fix` валідував канон `scripts.coverage` через `test/policy/package_json/`. Без `test` у списку CLI-команда `n-cursor coverage` усе одно працює (provider-discovery агностичний). |

**Verification у mlmail після перенесення:** `bun run coverage` → той самий `COVERAGE.md`, що генерувався локальним скриптом до перенесення (порівняти git diff на згенерованому файлі).

## План тестування (`bun test` у `npm/`)

### Unit-тести (співрозташовані з джерелом)

`npm/scripts/utils/tests/run-standard-coverage.test.mjs`:
- `runStandardCoverage(steps)` викликає `withLock('coverage', steps)` — ключ константа.
- Прокидує `opts` у `withLock` без змін.

`npm/rules/test/coverage/tests/coverage.test.mjs`:
- `runCoverageSteps`: коли `.n-cursor.json#rules = ['js-lint']` і `js-lint` provider stub повертає 1 рядок → COVERAGE.md записаний з 2 рядками (`js` + total).
- Коли `rules = ['js-lint', 'rust']` і обидва провайдери активні → 3 рядки (`js`, `rust`, total).
- Коли `rules = ['js-lint']` але `detect` повертає `false` → 0 рядків зібрано, exit `1` з повідомленням про відсутніх провайдерів.
- Коли в `rules` присутнє правило без `coverage/coverage.mjs` — пропускається без помилки.
- `renderMarkdown`, `addCoverage`, `addMutation`, `formatCoverage`, `formatScore` — golden tests (перевірити, що формат `COVERAGE.md` ідентичний поточному mlmail).

`npm/rules/js-lint/coverage/tests/coverage.test.mjs`:
- `detect(cwd)`: повертає `true` у fixture-проєкті з `app/package.json#scripts.test:coverage`, `false` у проєкті без.
- `collect(cwd)`: stub Bun.spawn → ідентичний lcov-парсинг як у mlmail; ідентичний Stryker JSON-парсинг.
- Парс edge cases: пустий lcov, лише `LF:0`, лише `Survived` мутанти.

`npm/rules/rust/coverage/tests/coverage.test.mjs`:
- `detect(cwd)`: `true` у fixture з `Cargo.toml`, `false` без.
- `collect(cwd)`: stub spawn → ідентичний JSON-парсинг cargo-llvm-cov і cargo-mutants outcomes.
- Edge: cargo-mutants exit ≠ 0 але outcomes.json є → не помилка; outcomes.json відсутній → помилка з install-підказкою.

### Rego-тести

`npm/rules/test/policy/package_json/package_json_test.rego`:
- golden pass (`scripts.coverage = "n-cursor coverage"`).
- per-substring fail (`scripts.coverage = "echo nope"`).
- drift-test: підміна `data.template.contains.package_json.scripts.coverage` → нова `deny` з новою substring.

### Інтеграційний smoke

`npm/tests/coverage-smoke.test.mjs` (опційно — у `npm/tests/` як package-level integration):
- Мінімальний fixture-проєкт із `.n-cursor.json#rules = ['js-lint']`, фіктивні `bun test --coverage` через mock.
- `runCoverageCli` повертає 0 і пише валідний `COVERAGE.md`.

## Залежність від `2026-05-23-rust-rule-design.md`

Цей spec доповнює `2026-05-23-rust-rule-design.md` (додає 4-й концерн `coverage/` поряд з трьома lint-концернами). Можливі sequencing'и:

| Варіант | Опис | Ризик |
|---|---|---|
| **A. Rust rule перший, coverage другий** | Rust rule імплементується повністю за своїм spec; потім окрема PR додає `rust/coverage/`. | Низький. Найчистіше. mlmail тимчасово втрачає Rust-покриття між видаленням `coverage.js` і ландінгом rust rule. |
| **B. Coverage перший зі скелетом rust** | Цей spec ландиться зі скелетом `npm/rules/rust/{rust.mdc-stub, fix.mjs, coverage/}` без lint-концернів. Повна імплементація rust rule — окрема PR. | Середній. `rust.mdc` тимчасово неповний. |
| **C. Спільний реліз** | Rust rule + coverage в одній PR / спорідненій парі. | Низький по логіці, високий по обсягу. |

**Рекомендований варіант:** A, але з порядком: rust rule імплементується **до** того, як mlmail видаляє `scripts/coverage.js`. Тобто:
1. PR1: rust rule (без coverage концерну).
2. PR2: цей spec — `runStandardCoverage` + оркестратор `test/coverage/` + js-lint провайдер + rust провайдер (`rust/coverage/`) + `test/policy/package_json/` + CLI subcommand + version bump + CHANGELOG.
3. PR3: mlmail cleanup — видалення скриптів, оновлення `package.json` + `app/package.json`.

## Non-goals

- Per-language coverage CLI (`n-cursor coverage-js`, `n-cursor coverage-rust`). Якщо знадобиться — додається пізніше без переробки оркестратора (basename-derivation у `runStandardCoverage`-варіанті).
- Дедуп невдалих прогонів (зберігання й відтворення виводу помилок). Як у [`2026-05-22-lint-ga-concurrency-lock-design.md § Поза обсягом пілота`](2026-05-22-lint-ga-concurrency-lock-design.md) — `withLock` дедуплікує лише успіх.
- Покриття на рівні пакетів workspace (per-package метрики у COVERAGE.md). Наразі одне агреговане число per-провайдер.
- Підтримка `python` / `php` / `go` провайдерів. Архітектура підтримує — додавання нового провайдера = `mkdir npm/rules/<rule>/coverage && touch coverage.mjs`. Реалізація — окремими PR per мова.
- Експорт у Cobertura / GitHub Actions annotations / Codecov. COVERAGE.md лишається єдиним форматом виводу.
- Конфігурація через `.n-cursor.json#coverage.*` (override jsRoot, manifest path). Якщо знадобиться — додається пізніше; зараз провайдери самі резолвлять.

## Послідовність реалізації (для writing-plans)

1. **Передумова:** rust rule (`npm/rules/rust/`) уже існує за [2026-05-23-rust-rule-design.md](2026-05-23-rust-rule-design.md). Якщо ні — окрема попередня PR.

2. **`runStandardCoverage`:** створити [`npm/scripts/utils/run-standard-coverage.mjs`](../../npm/scripts/utils/) + `tests/run-standard-coverage.test.mjs`. Тести: ключ константа `'coverage'`, прокидання `opts`, делегування у `withLock`.

3. **`test/policy/package_json/`:**
   - `target.json` за форматом `{"files":{"single":"package.json","required":true},"missingMessage":"..."}`.
   - `template/package.json.contains.json` — `{"scripts":{"coverage":["n-cursor coverage"]}}`.
   - `package_json.rego` (`package test.package_json` + `import rego.v1`, читає `data.template.contains.*`).
   - `package_json_test.rego` (golden pass + per-substring fail + drift-test).

4. **`test/coverage/coverage.mjs`** + `tests/coverage.test.mjs`: оркестратор з discovery провайдерів через `.n-cursor.json#rules`, агрегацією, `renderMarkdown` (перенесений з mlmail).

5. **`js-lint/coverage/coverage.mjs`** + `tests/coverage.test.mjs`: JS-провайдер (`bun test --coverage` + Stryker). Логіка з `mlmail/scripts/coverage.js::collectJsCoverage` + `collectJsMutation`, перенесена як чисті функції.

6. **`rust/coverage/coverage.mjs`** + `tests/coverage.test.mjs`: Rust-провайдер (`cargo llvm-cov` + `cargo-mutants`). Логіка з `mlmail/scripts/coverage.js::collectRustCoverage` + `collectRustMutation`.

7. **`test.mdc`**: додати секцію «Покриття + мутаційне тестування» з markdown-link на `package.json.contains.json`. Жодного inline fenced-блока з `title="<filename>"`.

8. **`js-lint.mdc`**, **`rust.mdc`**: коротке посилання на провайдер (без template, бо canonical валідується через `test/policy/`).

9. **CLI:** додати `case 'coverage'` у `npm/bin/n-cursor.js`; розширити help-string.

10. **Тести:** `bun test` у `npm/`; `bun run lint-rego`. Зелено.

11. **Завершення в `@nitra/cursor`** ([`scripts.mdc § Завершення задачі`](../../.cursor/rules/scripts.mdc)): bump `npm/package.json` minor → нова секція в `npm/CHANGELOG.md` → `npx @nitra/cursor fix changelog` зеленим.

12. **mlmail cleanup (окрема PR після релізу `@nitra/cursor`):**
    - `bun add -D @nitra/cursor@<new-version>` (frozen-lockfile-сумісний bump).
    - Видалити `scripts/coverage.js`, `scripts/with-lock.js`, `scripts/__tests__/`.
    - `package.json`: видалити `test:scripts`; замінити `coverage` на `"n-cursor coverage"`.
    - `app/package.json`: видалити `test:mutation`, `test:rust:mutation`.
    - `bun run coverage` → COVERAGE.md ідентичний попередньому (golden diff).
