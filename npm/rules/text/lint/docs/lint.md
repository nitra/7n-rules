---
docgen:
  source: npm/rules/text/lint/lint.mjs
  crc: bdaef0f8
---

# `lint.mjs` — CLI-обгортка `lint-text`

## Огляд

Модуль `lint.mjs` — це CLI-обгортка над канонічним підкомандним конвеєром `lint-text` (правило `text.mdc`). Він призначений для запуску ланцюжка лінтерів текстових і конфігураційних артефактів проєкту з автоматичним передвстановленням залежностей та послідовним виконанням кроків з ранньою зупинкою на першій помилці.

Що робить файл:

1. Авто-встановлює зовнішні бінарники `shellcheck` і `dotenv-linter` через `ensureTool` (механізм brew/scoop/GitHub Release per-platform).
2. Перевіряє наявність системного `patch` (необхідний для авто-фіксу `shellcheck`) і друкує install-hint, якщо `patch` відсутній.
3. Послідовно запускає п'ять кроків лінтінгу:
   - `cspell .` — перевірка правопису з використанням словника `@nitra/cspell-dict`;
   - `runShellcheckText()` — авто-фікс і фінальна перевірка `*.sh` через `shellcheck`;
   - `runDotenvLinter()` — авто-фікс і фінальна перевірка `.env*` через `dotenv-linter`;
   - `bunx markdownlint-cli2 --fix "**/*.md" "**/*.mdc"` — авто-фікс Markdown;
   - `runV8rWithGlobs()` — schema-валідація `json/json5/yaml/yml/toml` через `v8r`.
4. Першу ненульову exit-код у ланцюжку повертає як код виходу всього прогону; наступні кроки не запускаються.

Призначення preflight-блоку: без авто-встановлення локальний прогін може успішно пройти `cspell` і `markdownlint`, а CI на `ubuntu-latest` (де `shellcheck` є передвстановленим, але `dotenv-linter` — ні) падає на кроці `dotenv-linter` з неінформативним повідомленням. `ensureTool` збирає всі відсутні бінарники до запуску першого кроку.

Канон патерну `lint-*` (серіалізація через `runStandardLint`, без прямого `withLock`) описаний у `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд».

## Експорти / API

| Експорт          | Тип                     | Призначення                                                                                                                                                                                                                             |
| ---------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runLintTextCli` | `() => Promise<number>` | Публічна CLI-форма команди `lint-text`. Використовується з `bin/n-cursor.js` як підкоманда `lint-text`. Серіалізує виконання через `withLock('lint-text')` і додатково дедуплікує запуски за станом git-дерева через `runStandardLint`. |

Інші ідентифікатори модуля (`PATCH_PREFLIGHT`, `resolvePreflightBin`, `printPreflightMissingMessage`, `preflight`, `runLintTextSteps`) — внутрішні; не експортуються і не призначені для зовнішнього використання.

## Функції

### `resolvePreflightBin(dep)`

Шукає шлях до бінарника `dep.bin` у `PATH`. На Windows (`process.platform === 'win32'`) додатково перебирає альтернативні імена з `dep.winBins` (наприклад, для випадків з `.exe`/`.cmd` варіаціями).

- Сигнатура: `function resolvePreflightBin(dep: PreflightDep): string | null`
- Параметри:
  - `dep` — опис залежності з canon-списку preflight-перевірок (тип `PreflightDep`).
- Повертає: абсолютний шлях до знайденого бінарника або `null`, якщо бінарник не знайдено.
- Side effects: відсутні (виклик `resolveCmd` лише читає `PATH`, не модифікує процес).

### `printPreflightMissingMessage(dep)`

Друкує stderr-повідомлення про відсутній бінарник: рядок-маркер з іменем, пояснення наслідків, install-команди і посилання на правило `text.mdc`.

- Сигнатура: `function printPreflightMissingMessage(dep: PreflightDep): void`
- Параметри:
  - `dep` — опис залежності, джерело пояснення (`dep.explanation`) та install-команд (`dep.install`).
- Повертає: нічого (`undefined`).
- Side effects: виводить кілька рядків у `console.error` (stderr). Структура виводу:
  - `❌ <bin> не знайдено в PATH.`
  - відступний рядок з `dep.explanation`;
  - заголовок `   Встанови:`;
  - по рядку для кожного елемента `dep.install`;
  - підказку `   Деталі: text.mdc → секція про lint-text.`

### `preflight(dep)`

Виконує preflight-перевірку наявності бінарника й сигналізує результат через консоль.

- Сигнатура: `function preflight(dep: PreflightDep): boolean`
- Параметри:
  - `dep` — опис залежності для перевірки в `PATH`.
- Повертає: `true`, якщо бінарник знайдено; `false`, якщо відсутній.
- Side effects:
  - На pass-шляху друкує `dep.successMsg` у `console.log`;
  - На fail-шляху викликає `printPreflightMissingMessage(dep)` (вивід у `console.error`).

### `runLintTextSteps()`

Внутрішня функція, що послідовно прокручує всі кроки `lint-text` без захоплення локу (лок забезпечується зовнішньою обгорткою `runStandardLint`).

- Сигнатура: `function runLintTextSteps(): number`
- Параметри: немає.
- Повертає: `0`, якщо всі кроки успішні; інакше — exit-код першого кроку, що повернув ненульове значення.
- Алгоритм:
  1. `ensureTool('shellcheck')` — авто-встановлення `shellcheck`; кидає виключення на провал (поширюється як exit `1` через зовнішній `runStandardLint`).
  2. `ensureTool('dotenv-linter')` — те саме для `dotenv-linter`.
  3. `preflight(PATCH_PREFLIGHT)` — hint-only перевірка `patch`; якщо `patch` відсутній — повертає `1` без подальших спроб.
  4. `runLintStep('cspell', 'npx', ['cspell', '.'])` — `cspell .` через `npx`; ранній return при ненульовому коді.
  5. Друк заголовку `▶ shellcheck (авто-фікс + фінальна перевірка *.sh)` і виклик `runShellcheckText()`; ранній return при ненульовому коді.
  6. Друк заголовку `▶ dotenv-linter (авто-фікс + фінальна перевірка .env*)` і виклик `runDotenvLinter()`; ранній return при ненульовому коді.
  7. `runLintStep('markdownlint', 'bunx', ['markdownlint-cli2', '--fix', '**/*.md', '**/*.mdc'])` — авто-фікс Markdown; ранній return при ненульовому коді.
  8. Друк заголовку `▶ v8r (schema-валідація json/json5/yaml/yml/toml)` і повернення результату `runV8rWithGlobs()` як підсумкового exit-коду.
- Side effects: записує лог-рядки у `stdout`; запускає дочірні процеси через `runLintStep` / `ensureTool` / спеціалізовані обгортки; модифікує файлову систему через авто-фікс-кроки (`shellcheck -f diff` + `patch -p1`, `dotenv-linter --fix`, `markdownlint-cli2 --fix`).

### `runLintTextCli` (експорт)

Публічна CLI-форма команди.

- Сигнатура: `const runLintTextCli: () => Promise<number>`
- Параметри: немає.
- Повертає: `Promise<number>` — фінальний exit-код прогону (після lock + дедупу).
- Реалізація: делегує до `runStandardLint(import.meta.dirname, () => runLintTextSteps())`, тобто:
  - `runStandardLint` бере лок з ім'ям, похідним від директорії скрипту (`import.meta.dirname`);
  - дедуплікує запуски за станом git-дерева (якщо нічого не змінилося з попереднього успішного прогону — повторного виконання не буде);
  - всередині локу викликає `runLintTextSteps()`.
- Side effects: лок-файл, лог-рядки, дочірні процеси (через внутрішній `runLintTextSteps`).

## Типи

### `PreflightDep`

Опис однієї залежності preflight-блоку. Визначений локальним JSDoc `@typedef`-ом.

| Поле          | Тип               | Опис                                                                         |
| ------------- | ----------------- | ---------------------------------------------------------------------------- |
| `bin`         | `string`          | Ім'я виконуваного файлу (POSIX-варіант).                                     |
| `winBins`     | `string[]` (опц.) | Альтернативні імена бінарника на Windows.                                    |
| `explanation` | `string`          | Наслідки відсутності бінарника (для людино-зрозумілого stderr-повідомлення). |
| `install`     | `string[]`        | Команди встановлення, по одному рядку на спосіб/платформу.                   |
| `successMsg`  | `string`          | Повідомлення для `console.log` на pass-шляху preflight.                      |

## Константи

### `PATCH_PREFLIGHT`

Єдиний об'єкт типу `PreflightDep`, що описує системний `patch` як hint-only залежність:

- `bin: 'patch'`;
- `explanation: 'Без `patch` не застосуються авто-виправлення shellcheck (`shellcheck -f diff`+`patch -p1`).'` (зібраний через `[...].join('\n   ')` з одного елемента; результат — рівно одна логічна підказка з відступом сумісним з шаблоном виводу `printPreflightMissingMessage`);
- `install`:
  - `'macOS:         зазвичай уже є в системі'`;
  - `'Debian/Ubuntu: sudo apt-get install -y patch'`;
- `successMsg: '✅ patch знайдено в PATH — shellcheck auto-fix працюватиме'`.

`winBins` не задано — на Windows для `patch` шукається лише власне ім'я.

## Залежності

### Зовнішні модулі (Node built-ins)

- `node:process` — імпортується іменована змінна `platform` для детекції Windows у `resolvePreflightBin`.

### Внутрішні модулі (відносні імпорти)

| Модуль                                       | Що використовується                                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../../../scripts/lib/run-lint-step.mjs`     | `runLintStep` — обгортка для запуску одного кроку лінту з префіксованим логом і нормалізованим exit-кодом. Використовується для `cspell` і `markdownlint`. |
| `../../../scripts/utils/resolve-cmd.mjs`     | `resolveCmd` — пошук бінарника в `PATH`. Викликається з `resolvePreflightBin`.                                                                             |
| `../../../scripts/lib/run-standard-lint.mjs` | `runStandardLint` — каноном обгортка `lint-*`: серіалізація через `withLock` + дедуп за станом git-дерева. Викликається з `runLintTextCli`.                |
| `../../../scripts/lib/ensure-tool.mjs`       | `ensureTool` — авто-встановлення бінарників (brew/scoop/GitHub Release). Викликається для `shellcheck` і `dotenv-linter` на початку `runLintTextSteps`.    |
| `./run-dotenv-linter.mjs`                    | `runDotenvLinter` — авто-фікс + фінальна перевірка `.env*`.                                                                                                |
| `./run-shellcheck.mjs`                       | `runShellcheckText` — авто-фікс + фінальна перевірка `*.sh` через `shellcheck`.                                                                            |
| `./run-v8r.mjs`                              | `runV8rWithGlobs` — schema-валідація `json/json5/yaml/yml/toml`.                                                                                           |

### Зовнішні CLI-інструменти (запускаються як дочірні процеси)

- `npx cspell .` — перевірка правопису (зі словником `@nitra/cspell-dict`).
- `shellcheck` — статичний аналізатор `*.sh` (передвстановлюється `ensureTool`).
- `dotenv-linter` — лінтер `.env*` (передвстановлюється `ensureTool`).
- `patch` — потрібен для `shellcheck -f diff | patch -p1` (hint-only, не встановлюється авто).
- `bunx markdownlint-cli2 --fix '**/*.md' '**/*.mdc'` — авто-фікс Markdown.
- `v8r` — schema-валідація конфігів (через `runV8rWithGlobs`).

### Правила-довідники

- `.cursor/rules/text.mdc` (`text.mdc`) — канонічний опис набору `lint-text`.
- `.cursor/rules/scripts.mdc` — секція «Серіалізація важких CLI-команд», що описує патерн `runStandardLint`/`withLock`.

## Потік виконання / Використання

### Виклик з CLI

Файл експортує `runLintTextCli`, який підключається з `bin/n-cursor.js` як підкоманда `lint-text`. Очікувана схема виклику:

```bash
n-cursor lint-text
```

Команда повертає exit-код процесу, рівний фінальному коду повернення з `runLintTextCli`.

### Послідовність кроків (happy path)

1. Зовнішній `runStandardLint` намагається взяти лок `lint-text`. Якщо лок вже зайнятий або стан git-дерева не змінився — прогон може дедуплікуватися або зачекати.
2. Всередині локу викликається `runLintTextSteps()`:
   1. `ensureTool('shellcheck')` — авто-встановлення (на CI/локально).
   2. `ensureTool('dotenv-linter')` — те саме.
   3. `preflight(PATCH_PREFLIGHT)` — друкує `✅ patch знайдено в PATH — shellcheck auto-fix працюватиме` або hint про встановлення.
   4. `cspell .` — друк префіксованих логів через `runLintStep`.
   5. `▶ shellcheck (авто-фікс + фінальна перевірка *.sh)` → `runShellcheckText()`.
   6. `▶ dotenv-linter (авто-фікс + фінальна перевірка .env*)` → `runDotenvLinter()`.
   7. `markdownlint-cli2 --fix '**/*.md' '**/*.mdc'` через `bunx`.
   8. `▶ v8r (schema-валідація json/json5/yaml/yml/toml)` → `runV8rWithGlobs()`; повертає його результат.
3. `runStandardLint` повертає підсумковий exit-код як `Promise<number>`.

### Семантика помилок

- Якщо `ensureTool` падає (не вдалося встановити `shellcheck` або `dotenv-linter`) — викидає виключення, яке поширюється з `runLintTextSteps` і обробляється на верхньому рівні (`runStandardLint`) як exit `1`.
- Якщо `patch` відсутній — `preflight` повертає `false`, `runLintTextSteps` повертає `1` ще до запуску `cspell`.
- Будь-який наступний крок (`cspell`, `shellcheck`, `dotenv-linter`, `markdownlint`, `v8r`), який повернув ненульовий код, припиняє ланцюжок: цей код повертається з `runLintTextSteps` і далі з `runLintTextCli`.

### Приклад використання у скрипті (Node)

```js
import { runLintTextCli } from './lint.mjs'

const code = await runLintTextCli()
process.exit(code)
```

### Побічні ефекти на файлову систему

Кроки `runShellcheckText`, `runDotenvLinter`, `markdownlint-cli2 --fix` і потенційно `v8r` можуть модифікувати файли (авто-фікс). Це штатна поведінка `lint-text` — після прогону можливі правки в робочому дереві.

## Rebuild Test

З цієї документації можна відновити поведінку модуля:

- Один експорт — асинхронна функція `runLintTextCli()` без параметрів, повертає `Promise<number>` (exit-код).
- Реалізація `runLintTextCli`: `() => runStandardLint(import.meta.dirname, () => runLintTextSteps())`.
- `runLintTextSteps()` синхронно:
  1. викликає `ensureTool('shellcheck')` і `ensureTool('dotenv-linter')`;
  2. виконує `preflight(PATCH_PREFLIGHT)` і повертає `1`, якщо `patch` відсутній;
  3. послідовно запускає кроки `cspell` → `runShellcheckText` → `runDotenvLinter` → `markdownlint-cli2 --fix '**/*.md' '**/*.mdc'` → `runV8rWithGlobs`, друкуючи відповідні `▶`-заголовки перед shellcheck/dotenv/v8r;
  4. ранній return на першому ненульовому коді; інакше повертає результат `runV8rWithGlobs()`.
- Допоміжні функції: `resolvePreflightBin` (з підтримкою `winBins` на Windows), `printPreflightMissingMessage` (формат stderr-повідомлення), `preflight` (об'єднання resolve+print і друк `successMsg` на pass).
- Константа `PATCH_PREFLIGHT` з полями `bin/explanation/install/successMsg` (без `winBins`).
- Залежності: `node:process` (`platform`); локальні модулі `run-lint-step`, `resolve-cmd`, `run-standard-lint`, `ensure-tool`, `run-dotenv-linter`, `run-shellcheck`, `run-v8r`.
