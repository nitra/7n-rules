# Влиття @7n/test у @7n/rules як lint-концерну test

**Дата:** 2026-07-22
**Статус:** погоджено — готово до реалізації
**Зв'язані документи:** `docs/specs/2026-07-18-lang-plugins-extraction-spec.md` (плагінна архітектура), `docs/specs/2026-07-17-disable-concerns-granular.md` (гранулярні концерни), правило `test` у `plugins/lang-js/rules/test/`

## 1. Проблема / Мета

`@7n/test` живе окремим репо (`nitra/7n-test`) без розділення по мовах, тоді як `@7n/rules` уже має плагінну архітектуру (lang-js/lang-rust/lang-python). Оркестратор coverage у `@7n/test` резолвить провайдери з `node_modules/@7n/rules/rules` — інвертована залежність із version-skew ризиком. Сценарій «маєш rust → маєш тести» означає, що тестування — наскрізна потреба кожної мови, а не опційна фіча: місце цій логіці — в ядрі `@7n/rules` + мовних плагінах, а не в окремому пакеті.

Мета: повністю влити `@7n/test` у `@7n/rules` за моделлю lint-концерну, репо `7n-test` заархівувати, пакет `@7n/test` депрекейтнути. Важкі залежності — одна глобальна копія на машину (npx/bunx-кеш), не в node_modules кожного проєкту.

## 2. Ухвалені рішення

| # | Питання | Рішення |
|---|---|---|
| А | Доля репо/пакета | Повний архів: код переїздить у монорепо cursor/, репо `7n-test` → GitHub archive (read-only, README-вказівник), `npm deprecate @7n/test`. Без форвардера і без bin-аліаса `7n-test` — міграція споживачів одним заходом (проєктів мало, всі свої). |
| Б | Архітектурна модель | Не нові топ-команди і не плагін — **розширення існуючого lint-правила `test`**: check-шлях = coverage-метрики vs поріг, fix-шлях = LLM-догенерація/починка тестів (`fix-worker.mjs` за канонічною fix-механікою). Оркестрація — core + скіл (taze-модель: скіл задає флоу, мовна специфіка — провайдери у плагінах `plugins/lang-*/coverage/provider.mjs`). |
| В | CLI-поверхня | `npx @7n/rules lint test --no-fix` — coverage-збір + перевірка порогу (CI-гейт: нижче порогу → не зелений). `npx @7n/rules lint test` — fix: догенерація тестів, починка survived-мутантів. Прапор `--changed` зникає як окремий (делта — природний режим lint). **COVERAGE.md прибирається** — цінний exit-code/звіт у виводі, не файл. |
| Г | Скоупи прогонів | Комбінація: **делта-lint** жене легкий coverage лише по змінених файлах (vitest --coverage scoped, без мутаційки); **`lint --full`** включає повний coverage+мутаційний гейт; **`lint test`** — явний повний прогін концерну (і єдиний вхід у fix). |
| Д | Важкі залежності | `@7n/llm-lib`, `@earendil-works/pi-coding-agent` → звичайні `dependencies` @7n/rules (після заміру ваги; фасилітатор рекомендував саме це проти окремого пакета `@7n/rules-llm` — нова OIDC/lockstep-сутність не окупається). `rollup` — перевірити фактичне використання, ймовірно викинути. `vitest`/`@vitest/coverage-v8`/`@stryker-mutator/*` — лишаються devDependencies споживчих проєктів, @7n/rules лише шеллаутить. Канон споживання — `npx`/`bunx`-кеш без devDependency на @7n/rules. |
| Е | Storybook | Правило `storybook` (lang-js) **вливається в правило `test`** lang-js (stories = компонентні тести, інших мов не стосується): `gen-stories`/`storybook-run` стають fix-механізмом test-концерну. Мінус одне правило-поверхня. |
| Ж | Git-історія | Не переноситься — архівний репо і є історія. `CHANGELOG.md` 7n-test зберігається (архівна секція/файл), перший реліз rules після влиття — запис «absorbed @7n/test@0.17.1». |
| З | Версіонування | Minor-бамп @7n/rules (maxBump: minor вже стоїть). |

## 3. Деталі реалізації

### 3.1 Перенос коду (звідки → куди)

Джерело: `7n-test/npm/src/`. Розподіл за призначенням:

- **Оркестрація coverage** (`coverage-per-file.mjs`, агрегація метрик, multi-workspace ітерація) → core-частина lint-концерну `test` (обчислення порогу, звіт, exit-code). Точка інтеграції — та сама механіка concern.json, що в усіх lint-концернів.
- **Мовні провайдери**: контракт `coverage/provider.mjs` у плагінах — `plugins/lang-js/coverage/` (vitest --coverage + Stryker perTest), `plugins/lang-rust/coverage/` (cargo llvm-cov + cargo-mutants), `plugins/lang-python/coverage/` (pytest-cov + мутаційний інструмент — див. відкриті питання). Активація — автоматична від наявності lang-плагіна в проєкті, без opt-in. Взірець контракту — `taze/provider.mjs`.
- **LLM fix-шлях** (`gen-tests.mjs`, `fix-tests.mjs`, `coverage-fix.mjs`, `coverage-fix-extract.mjs`, `assess-need.mjs`, `coverage-classify/`) → `fix-worker.mjs` test-концерну + допоміжні модулі поряд. Скіл (`npm/skills/`) задає флоу fix-процесу за taze-моделлю.
- **Storybook** (`gen-stories.mjs`, `storybook-run.mjs`) → fix-механізм test-правила lang-js; наявні концерни правила `storybook` переїздять у `plugins/lang-js/rules/test/` як додаткові концерни, тека `rules/storybook/` зникає.
- **Тести самого коду** (`*.test.mjs`) — переносяться поряд (канон `tests/`-піддиректорій), мають пройти під vitest-конфігом монорепо.
- **Файлові доки** (`src/docs/`) — переносяться разом з кодом; CRC у frontmatter перегенерувати (шляхи змінюються).
- **Skills 7n-test** (`7n-test/npm/skills/`) — інвентаризувати: дублікати викинути, унікальне влити в `npm/skills/`.

### 3.2 Поведінка концерну test за скоупами

| Прогін | Що біжить | Гейт |
|---|---|---|
| делта-lint (`lint`) | легкий coverage лише по змінених файлах, без мутаційки | падає, якщо покриття змінених файлів нижче порогу |
| `lint --full` | повний coverage + мутаційка | повний гейт |
| `lint test` (явний) | повний концерн + **fix** (без `--no-fix` — це і є режим догенерації) | — |
| `lint test --no-fix` | повний концерн, лише перевірка | повний гейт (канонічний CI-крок) |

Поріг — конфігурується у `.n-rules.json` (rules.test), дефолт — у concern.json концерну.

### 3.3 Міграція споживачів (один захід)

1. Замір ваги інсталу @7n/rules з новими депами (до/після) — фіксація в PR.
2. Перевірка `rollup`: якщо викидається — викинути до переносу.
3. Grep-інвентаризація по всіх репо nitra: `@7n/test`, `7n-test`, `scripts.coverage`, `COVERAGE.md`.
4. Кодмод у n-cursor sync: `scripts.coverage` → `npx @7n/rules lint test --no-fix`; прибрати `@7n/test` з devDependencies; видалити `COVERAGE.md`.
5. Оновити mdc: `n-test.mdc` (канонічна команда, прибрати згадки пакета @7n/test і COVERAGE.md, влити storybook-канон), прибрати окремий storybook-mdc.
6. CI споживачів: окремий step `npx @7n/rules lint test --no-fix` (не в складі загального lint-степу).
7. Реліз @7n/rules (minor) → `npm deprecate @7n/test "moved into @7n/rules: npx @7n/rules lint test"` → архівація репо `nitra/7n-test` з README-вказівником.

### 3.4 Ризики і мітигації

- **45-хв fail-closed таймаут full-черги**: повна мутаційка на великому проєкті може не влізти. Мітигація на вибір при реалізації: піднятий таймаут для прогонів із test-концерном, або мутаційка лише в явному `lint test` (делегувати рішення на замір часу на efes/backend-масштабі).
- **pi-breakage блокує весь rules** (прецедент pi 0.80.10): контракт-тести pi-інтеграції в CI rules, не fake-registry (ті поломок не ловлять).
- **Розмір tarball**: перевірити `files`-глоби — tests/fixtures не мають потрапити в publish.
- **Дев-цикл**: npx тягне опубліковане — розробка test-концерну локально через `bun npm/bin/n-rules.js lint test` (задокументувати в README-розділі).
- **gen-tests пише файли в проєкт**: переконатися, що PostToolUse/doc-files каскад не зациклюється на згенерованих тестах.

## Відкриті питання

- Мутаційний інструмент для python-провайдера (mutmut vs cosmic-ray) — вирішити при реалізації lang-python coverage.
- Мутаційка в `--full`: включати завжди чи лише в явному `lint test` — після заміру тривалості (див. ризик таймауту).
- Точне місце конфігурації порогу (глобальний дефолт vs per-mova в провайдері) — на етапі dev-design концерну.
