# `npm/rules/ga/lint/lint.mjs`

## Огляд

Модуль `lint.mjs` — це **CLI-обгортка над канонічним `lint-ga`** (правило `ga.mdc`), яка виконує комплексну перевірку GitHub Actions workflow-файлів проєкту. Модуль не є самостійним перевіряльником: він агрегує кілька стадій external-tools і делегує JS/Rego-частину перевірок в `rules/ga/fix.mjs::check()`.

Ключові зони відповідальності:

1. **Авто-встановлення обов'язкових бінарників** — `shellcheck` і `conftest` через `ensureTool` (підбирається менеджер пакетів per-platform: `brew`/`scoop`/GitHub Release).
2. **Preflight для `uv`** — м'яка перевірка, що `uv` (а отже `uvx`) є в `PATH`; інакше друкується hint з командами встановлення й функція повертає `1` без авто-install.
3. **Послідовний запуск трьох стадій перевірки** workflow-ів:
   - `bunx github-actionlint` — синтаксис/семантика GH Actions, включно з вбудованим `shellcheck` у `run:` блоках (звідси preflight на `shellcheck`).
   - `uvx zizmor --offline --collect=workflows .` — second-stage security-аудит workflow на ризики (через `uv`/`uvx`).
   - `rules/ga/fix.mjs::check()` — Rego-полісі (батч `conftest` для `npm/policy/ga/`) **плюс** JS cross-file перевірки правил `ga.mdc`. Це та сама перевірка, що й `npx @nitra/cursor check ga`, тож `lint-ga` є суперсетом цієї підкоманди.
4. **Серіалізація запуску** через `runStandardLint(import.meta.dirname, steps)` згідно з каноном патерну `lint-*` (див. `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд») — без прямого `withLock`.

Plan B-патерн (rego-authoritative): сама Rego-полісі `npm/policy/ga/` запускає `rules/ga/fix.mjs::check()` як перший крок — `lint.mjs` про це не знає. Раніше `lint.mjs` сам спавнив `conftest` per-workflow для `ga.<name>` і `ga.workflow_common` (PoC); тепер уся логіка централізована в `rules/ga/fix.mjs`, тому одне джерело істини без дублювання між `lint-ga` і `npx @nitra/cursor check ga`.

Чому preflight на `shellcheck` обов'язковий: без нього `bunx github-actionlint` **мовчки** пропускає shell-перевірки у `run:` блоках; локально `bun lint-ga` лишається зеленим, а CI на `ubuntu-latest` (де `shellcheck` передвстановлений) падає. `ensureTool('shellcheck')` усуває цю різницю.

Чому `uv` — окремо й лише як hint: бінарник `uv` не входить у реєстр `ensureTool` для авто-install у цьому проєкті, тому модуль обмежується інформативною підказкою з командами встановлення (brew / curl / pip), щоб користувач не отримав неінформативну помилку від `uvx zizmor`.

Модуль експортує одну іменовану стрілкову функцію `runLintGaCli`, яку імпортує `bin/n-cursor.js` як обробник підкоманди `lint-ga`.

## Експорти / API

| Символ         | Тип                             | Експорт                | Опис                                                                                                                                                                   |
| -------------- | ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runLintGaCli` | `() => Promise<number>` (arrow) | `export const` (named) | Точка входу CLI-команди `lint-ga`. Обгортає `runLintGaSteps` у `runStandardLint(import.meta.dirname, ...)` — серіалізація + стандартні timing/exit-code/log конвенції. |

Жодних інших експортів модуль не надає: усі допоміжні функції (`resolvePreflightBin`, `printPreflightMissingMessage`, `preflight`, `runLintGaSteps`) і константа `UV_PREFLIGHT` — внутрішні.

JSDoc-typedef `PreflightDep` описує форму внутрішніх preflight-конфігів і не експортується.

## Функції

### `resolvePreflightBin(dep)`

```
function resolvePreflightBin(dep: PreflightDep): string | null
```

- **Параметри:**
  - `dep: PreflightDep` — опис preflight-залежності з полями `bin`, `winBins`, `explanation`, `install`, `successMsg`.
- **Повертає:** `string | null` — абсолютний шлях до бінарника або `null`, якщо нічого не знайдено в `PATH`.
- **Поведінка:**
  - Якщо `platform === 'win32'` (з `node:process`), спершу ітерує `dep.winBins` (наприклад, `['uv.exe']`) і повертає перший резолвлений шлях.
  - Якщо жоден `winBins` не знайдено або платформа не Windows — фолбек на `resolveCmd(dep.bin)`.
- **Side effects:** немає (читання `PATH` через `resolveCmd` — pure-resolve).

### `printPreflightMissingMessage(dep)`

```
function printPreflightMissingMessage(dep: PreflightDep): void
```

- **Параметри:** `dep: PreflightDep`.
- **Повертає:** `void`.
- **Поведінка:** друкує у `stderr` блок із кількох рядків:
  1. `❌ <bin> не знайдено в PATH.` (червоний хрестик у вигляді емодзі).
  2. Пояснення з `dep.explanation` (одинарний відступ на 3 пробіли).
  3. Заголовок `Встанови:` і список команд із `dep.install` з відступом на 5 пробілів.
  4. Фінальний рядок-вказівка: `Деталі: ga.mdc → секція про lint-ga.`
- **Side effects:** запис у `process.stderr` через `console.error`. Жодних винятків не кидає.

### `preflight(dep)`

```
function preflight(dep: PreflightDep): boolean
```

- **Параметри:** `dep: PreflightDep`.
- **Повертає:** `boolean` — `true`, якщо бінарник знайдено в `PATH`; `false`, якщо ні.
- **Поведінка:**
  - Викликає `resolvePreflightBin(dep)`.
  - На pass: друкує `dep.successMsg` через `console.log` і повертає `true`.
  - На fail: викликає `printPreflightMissingMessage(dep)` і повертає `false`.
- **Side effects:** запис у `stdout` (success) або `stderr` (fail) через `console.log`/`console.error`.

### `runLintGaSteps()`

```
async function runLintGaSteps(): Promise<number>
```

- **Параметри:** немає.
- **Повертає:** `Promise<number>` — `0`, якщо всі кроки успішні; інакше — exit-code першого кроку, що впав.
- **Поведінка (послідовно):**
  1. `ensureTool('shellcheck')` — авто-install або hard-fail (кидає виняток, який підхоплює `runStandardLint` і конвертує в `exit 1`).
  2. `ensureTool('conftest')` — те саме.
  3. `preflight(UV_PREFLIGHT)` — якщо `uv` не знайдено, повертає `1` без падіння (hint-only).
  4. `runLintStep('actionlint', 'bunx', ['github-actionlint'])` → якщо код ≠ 0, повертає його.
  5. `runLintStep('zizmor', 'uvx', ['zizmor', '--offline', '--collect=workflows', '.'])` → якщо код ≠ 0, повертає його.
  6. Друкує заголовок `▶ check-ga (rego-полісі npm/policy/ga/ + JS cross-file перевірки)` і повертає `await checkGa()` (з `../js/workflows.mjs`).
- **Side effects:**
  - Можлива інсталяція пакетів через `ensureTool` (мутує систему: brew/scoop/завантаження бінарників).
  - Спавн процесів `bunx`, `uvx` через `runLintStep`.
  - Виклик `conftest` (батчем) і JS-перевірки всередині `checkGa()`.
  - Запис у `stdout`/`stderr`.

### `runLintGaCli` (експортовано)

```
export const runLintGaCli: () => Promise<number>
```

- **Параметри:** немає.
- **Повертає:** `Promise<number>` — результат `runStandardLint(...)`, тобто фінальний exit-code лінт-команди.
- **Поведінка:** обгортає `runLintGaSteps` у `runStandardLint(import.meta.dirname, runLintGaSteps)`. `import.meta.dirname` визначає каталог `npm/rules/ga/lint/`, що використовується для лок-файлу серіалізації та для службових логів.
- **Side effects:** успадковуються від `runStandardLint` (lock-файл / cleanup) і `runLintGaSteps`.

## Внутрішні дані

### `UV_PREFLIGHT`

```
const UV_PREFLIGHT: PreflightDep
```

Конфігурація preflight для `uv`:

- `bin: 'uv'`
- `winBins: ['uv.exe']`
- `explanation`: двохрядкове пояснення про те, що без `uv`/`uvx` не запуститься `uvx zizmor` (second-stage аудит workflow на ризики GitHub Actions).
- `install`:
  - `'macOS:        brew install uv'`
  - `'Universal:    curl -LsSf https://astral.sh/uv/install.sh | sh'`
  - `'pip:          pip install uv'`
- `successMsg: '✅ uv знайдено в PATH — uvx zizmor запуститься'`

### `PreflightDep` (JSDoc typedef)

Структура опису однієї preflight-залежності:

| Поле          | Тип        | Опис                                                                                           |
| ------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `bin`         | `string`   | Базове ім'я виконуваного файлу (на Windows додається `.exe` за потреби — через `winBins`).     |
| `winBins`     | `string[]` | Альтернативні імена на Windows (наприклад, `shellcheck.exe`); якщо порожньо — фолбек на `bin`. |
| `explanation` | `string`   | 1–2 рядки, що пояснюють наслідки відсутності бінарника.                                        |
| `install`     | `string[]` | Список рядків з командами встановлення (друкуються «як є», з відступом).                       |
| `successMsg`  | `string`   | Повідомлення, яке друкується на pass-шлях preflight-у.                                         |

## Залежності

### Зовнішні (Node.js core)

- `node:process` — імпортується `platform` (рядок типу `'darwin' | 'linux' | 'win32' | ...`) для гілки Windows у `resolvePreflightBin`.

### Внутрішні (проєктні)

- `../js/workflows.mjs` — імпорт `check as checkGa`. Виконує Rego-полісі (батч `conftest` для `npm/policy/ga/`) і JS cross-file перевірки правил `ga.mdc`. Це фінальний крок `runLintGaSteps`.
- `../../../scripts/utils/resolve-cmd.mjs` — `resolveCmd(name): string | null`. Pure-resolve бінарника у `PATH` (без спавну).
- `../../../scripts/lib/run-lint-step.mjs` — `runLintStep(label, cmd, args): number`. Стандартизований обгортковий спавн одного кроку lint-у з консистентним логом і exit-code-семантикою.
- `../../../scripts/lib/run-standard-lint.mjs` — `runStandardLint(dirname, fn): Promise<number>`. Канонічна серіалізація lint-команди (lock-файл, тривалість, sentry-style cleanup). Згідно з `.cursor/rules/scripts.mdc` (секція «Серіалізація важких CLI-команд»), цей хелпер заміняє прямий `withLock` у lint-обгортках.
- `../../../scripts/lib/ensure-tool.mjs` — `ensureTool(name): void`. Перевіряє наявність бінарника в `PATH` і автоматично встановлює його через відповідний менеджер пакетів per-platform (brew/scoop/GitHub Release). Кидає виняток на нездатність встановити.

### Зовнішні CLI-інструменти (запускаються в рантаймі)

- `shellcheck` — авто-install через `ensureTool`. Потрібен для shell-перевірок у `run:` блоках, які виконує `actionlint`.
- `conftest` — авто-install через `ensureTool`. Використовується **всередині** `checkGa()` для виконання Rego-полісі з `npm/policy/ga/`.
- `uv` / `uvx` — hint-only preflight. Потрібен для запуску `uvx zizmor`.
- `bunx` / `github-actionlint` — виконується через `runLintStep('actionlint', 'bunx', ['github-actionlint'])`.
- `uvx` / `zizmor` — виконується через `runLintStep('zizmor', 'uvx', ['zizmor', '--offline', '--collect=workflows', '.'])`.

## Потік виконання / Використання

### Інтеграція в CLI

Модуль експортує `runLintGaCli`, яку імпортує `bin/n-cursor.js` як обробник підкоманди:

```
npx @nitra/cursor lint-ga
# або
bun lint-ga
```

### Сценарій типового запуску (happy path)

1. `runLintGaCli()` → викликає `runStandardLint(import.meta.dirname, runLintGaSteps)` — отримується lock на `npm/rules/ga/lint/`, починається timing.
2. Усередині `runLintGaSteps`:
   - `ensureTool('shellcheck')` — якщо нема, авто-встановлення (brew/scoop/release).
   - `ensureTool('conftest')` — те саме.
   - `preflight(UV_PREFLIGHT)` — друкує `✅ uv знайдено в PATH — uvx zizmor запуститься`.
   - `runLintStep('actionlint', 'bunx', ['github-actionlint'])` — exit `0`.
   - `runLintStep('zizmor', 'uvx', ['zizmor', '--offline', '--collect=workflows', '.'])` — exit `0`.
   - Лог `▶ check-ga (rego-полісі npm/policy/ga/ + JS cross-file перевірки)`.
   - `await checkGa()` — повертає `0`.
3. `runStandardLint` логує загальну тривалість, знімає lock і повертає `0`.

### Сценарії з falure

- `shellcheck` або `conftest` не встановлено й `ensureTool` не зміг встановити — виняток пробивається крізь `runLintGaSteps`, `runStandardLint` ловить його та конвертує у `exit 1`.
- `uv` відсутній — `preflight(UV_PREFLIGHT)` друкує hint, `runLintGaSteps` повертає `1`, наступні кроки не виконуються.
- `actionlint` повертає не-нульовий код — `runLintGaSteps` повертає цей код, `zizmor` і `checkGa()` не запускаються.
- `zizmor` повертає не-нульовий код — те саме: одразу повертається його exit-code.
- `checkGa()` повертає не-нульовий код — він і є фінальним результатом `runLintGaCli`.

### Контракт «суперсет `check ga`»

Оскільки фінальний крок `runLintGaSteps` — `checkGa()` (та сама `check`-функція з `../js/workflows.mjs`, що використовується підкомандою `npx @nitra/cursor check ga`), `lint-ga` є суперсетом цієї перевірки: він додає `actionlint` (синтаксис) і `zizmor` (security-аудит) перед `check`. Це усуває потребу запускати `check ga` окремо в pipeline-ах, що вже виконують `lint-ga`.

### Канон патерну `lint-*`

Файл сповідує канон патерну `lint-*` із `.cursor/rules/scripts.mdc` (секція «Серіалізація важких CLI-команд»):

- Серіалізація — через `runStandardLint`, **не** через прямий `withLock`.
- Кожна стадія — через `runLintStep` (узгоджений лог-формат, semantic exit-codes).
- Експортована функція має назву `run<Name>Cli` (тут — `runLintGaCli`).
- Фінальна делегація бізнес-частини — у відповідний `rules/<name>/fix.mjs::check()`, щоб бути одним джерелом істини з `npx @nitra/cursor check <name>`.
