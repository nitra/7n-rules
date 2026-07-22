# Dev-design: концерн coverage правила test (влиття @7n/test)

**Дата:** 2026-07-22
**Статус:** дизайн — база для реалізації
**Зв'язані документи:** `docs/specs/2026-07-22-absorb-7n-test-into-rules.md` (рішення А-З)

## 1. Вихідні факти (з дослідження обох репо)

- Provider-підсистема `@7n/test` видалена 2026-07-10: оркестратор самодостатній, вбудований `coverage/js-collector.mjs` (932 рядки, vitest+Stryker+storybook). На боці @7n/rules провайдерів немає. Отже provider-контракт створюється заново, а не переноситься.
- Rust/Python-колекторів у @7n/test не існує — лише JS/TS. Нові провайдери = нова розробка (окремі задачі після JS-каркасу).
- Score-гейта з exit-кодом у @7n/test немає (exit 0 незалежно від метрик) — гейт пишеться заново як lint-детектор.
- Делта/`--full`/`lint test` уже розрізняються диспетчером: `scope: "per-file"` дає `ctx.files` у делті й whole-repo (`ctx.files === undefined`) у `--full` та у scoped `lint test`. Нових полів схеми concern.json не потрібно.
- Fix-механіка канонічна: `fix-worker.mjs` (`FixWorkerFn`, `ctx.recordWrite`/`tier`/`timeoutMs`/`feedback`, success — лише canonical re-detect).
- LLM-транспорт @7n/test уже централізований у `lib/llm.mjs` → мапиться на прямі виклики `@7n/llm-lib` (вже dependency rules).
- `rollup/parseAst` → `oxc-parser` (потрібні лише ESTree `type` + числові `start`/`end`; звірити `Literal.raw`/`UnaryExpression.prefix`).

## 2. Архітектура

### 2.1 Концерн `coverage` — core-mixin правила test

Тека: `npm/rules/test/coverage/` (**core**, не lang-js) — бо coverage наскрізний для всіх мов, а `readLintConcernsByRuleMulti` мерджить концерни правила з усіх джерел (core + плагіни) за rule-id. Правило test лишається за власником lang-js (main.json/main.mdc там), core лише домішує концерн.

```
npm/rules/test/coverage/
├── concern.json      # { lint: { scope: "per-file", glob: ["**/*.{js,mjs,ts,vue}"] }, fixability: "code", skipLocalTier: true }
├── main.mjs          # export lint(ctx) — гейт
├── fix-worker.mjs    # export fixWorker(violations, ctx) — gen-tests/fix-tests/coverage-fix
├── lib/              # перенесені модулі оркестрації (див. 3)
├── docs/  tests/
```

Увага реалізації: перевірити, що mixin-тека `npm/rules/test/` без власного main.json не перехоплює ownership правила (core перший у resolveRulesDirs); якщо перехоплює — main.json правила переїздить у core, mdc лишається в lang-js.

### 2.2 Поведінка lint(ctx) за режимами

| Режим | ctx.files | Що робить | Порушення |
|---|---|---|---|
| делта-lint | список змінених | `quickClassify` (локальна евристика, без LLM) відсіює файли, яким тести не потрібні; per-file line coverage через vitest scoped (логіка coverage-per-file.mjs). Без мутаційки. | файл із покриттям < порогу |
| `lint --full`, `lint test` | undefined | повний прогін провайдерів усіх активних мов (collect: coverage + мутаційка + storybook-вимір), LLM-класифікація survived (coverage-classify, allowed gaps) | workspace зі score < порогу; survived-мутанти в details порушення |

Exit-code гейт безкоштовний: порушення → lint не зелений. CI-крок: `npx @7n/rules lint test --no-fix`.

### 2.3 Provider-порт `coverage` (plugin-api v2)

`npm/scripts/lib/plugin-api.mjs` додає порт (аналог `EcosystemProvider`):

```js
/** @typedef {Object} CoverageProvider
 *  @property {string} id                    // 'js' | 'rust' | 'python'
 *  @property {(cwd) => Promise<boolean>} detect
 *  @property {(cwd, {files?, mutation?, signal?}) => Promise<Row[]>} collect
 */
// Row = { area, coverage:{lines,functions}, mutation:{caught,total}, survived:[] } — shape із js-collector
export function assertCoverageProvider(candidate, source) { ... }
```

Маніфести плагінів: `contributes.handlers.coverage = "./coverage/provider.mjs"`. Ядро резолвить через `getHandlers(cwd, config, 'coverage')` — той самий шлях, що taze. `plugins/lang-js/coverage/provider.mjs` обгортає перенесений js-collector; lang-rust (cargo llvm-cov + cargo-mutants) і lang-python (pytest-cov + мутаційка) — окремі наступні задачі, контракт готовий.

### 2.4 fix-worker (LLM-шлях)

Мапа порушення → дія:

- файл без/з низьким покриттям → `assess-need` (LLM-підтвердження потреби) → `gen-tests` (per-export tiered routing, `ctx.tier`/`ctx.model` замість власних констант тирів) або `gen-stories` (Vue у storybook-root);
- survived-мутанти → логіка coverage-fix (batch-промпти по мутантах, контекст ±3 рядки);
- падаючі тести після генерації → fix-tests.

Адаптація до контракту: `ctx.recordWrite` перед кожним записом, `ctx.timeoutMs` прокидається в chain-виклики, повернення `{ touchedFiles }`, ніяких власних re-run-циклів — конвергенцію жене ladder ядра (re-detect = повторний вимір делта-скоупу). Скіл `n-coverage-fix` і CLI `coverage-fix index/slice` **зникають**: survived приходять у violations in-memory, читати COVERAGE.md більше не треба.

### 2.5 Що вмирає при переносі

- `COVERAGE.md` (render/parse: renderMarkdown, coverage-fix-extract.mjs повністю) — вивід стає violation-звітом lint.
- CLI-поверхня @7n/test (bin, index.js, run.mjs auto-loop — його Phase 1/2 стають делта/fix-циклами lint), `--changed` (делта природна), `with-lock` (є lint-lock ядра), власний changed-files (є `scripts/lib/changed-files.mjs` ядра).
- `lib/llm.mjs`-адаптер — виклики йдуть напряму через `@7n/llm-lib` + `ctx` ladder-а.
- Скіл `n-coverage-fix`, rollup із deps.

### 2.6 Storybook: влиття правила у test (lang-js)

Концерни `plugins/lang-js/rules/storybook/{ci,hygiene,scaffold,scope,vitest-config}` переїздять у `plugins/lang-js/rules/test/` з префіксом `storybook-` (storybook-ci, storybook-hygiene, …), fix-файли й capability-гейт (`ci:github`) зберігаються. `mocking` (doc-only) — вміст у main.mdc. `main.mdc` storybook вливається секцією в test/main.mdc; `auto`-glob правила test уже "завжди". Тека rules/storybook/ зникає. gen-stories/storybook-mutation стають частиною lang-js coverage-провайдера і fix-worker.

### 2.7 Пороги

`.n-rules.json` → `rules.test`: `{ "coverageThreshold": 80, "mutationThreshold": 80 }` (читання через наявний конфіг-шлях правил). Дефолти — константи в `main.mjs` концерну (не в concern.json — схема additionalProperties:false; відхилення від спеки зафіксовано). `classifyConfidenceThreshold` (allowed gaps) переїздить із `.n-cursor.json#coverage` у `rules.test`.

## 3. Мапа переносу файлів

| 7n-test/npm/src | → @7n/rules | примітка |
|---|---|---|
| coverage/js-collector.mjs, aggregate, storybook, bun-native, fs-walk, storybook-mutation*.mjs | plugins/lang-js/coverage/ | провайдер; parseAst→oxc-parser |
| coverage-per-file.mjs, coverage/coverage.mjs (оркестрація, без render/COVERAGE.md) | npm/rules/test/coverage/lib/ | ядро гейта |
| coverage-classify/* | npm/rules/test/coverage/lib/classify/ | allowed gaps |
| assess-need, classify-exports, gen-tests, gen-stories, fix-tests, coverage-fix | npm/rules/test/coverage/lib/ (fix-частина) | gen-stories — у lang-js частину |
| lib/ast-analyze, runtime-probe, vitest-shim, resolve-js-root | plugins/lang-js/coverage/lib/ | JS-специфіка |
| run.mjs, index.js, bin, coverage-fix-extract, scripts/{lib,utils} | — | вмирають (2.5) |
| *.test.mjs | поряд у tests/ | під vitest монорепо |
| src/docs/*.md | поряд у docs/ | CRC перегенерувати |

## 4. Порядок реалізації

1. Каркас: plugin-api порт + concern.json + main.mjs-гейт делта-режиму + lang-js провайдер (перенос js-collector як є, parseAst→oxc). Мінімальний робочий `lint test --no-fix`.
2. Full-режим: мутаційка + classify + пороги + violations із survived.
3. fix-worker: gen-tests/fix-tests/coverage-fix під ladder-контрактом.
4. Storybook-влиття (2.6).
5. Чистка: mdc, тести, доки, files-глоби, CHANGELOG.

## Відкриті питання

- Замір тривалості повного прогону на великому проєкті vs 45-хв таймаут full-черги (рішення: піднімати таймаут чи мутаційка лише в scoped `lint test`) — після кроку 2.
- oxc-parser: звірка `Literal.raw`/`UnaryExpression.prefix` в ESTree-виводі — на кроці 1.
- lang-rust/lang-python провайдери — окремі задачі після каркасу.
