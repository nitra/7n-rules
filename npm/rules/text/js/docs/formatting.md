# `formatting.mjs` — перевірка текстового стека й форматування за правилом `text.mdc`

## Огляд

Модуль `formatting.mjs` реалізує **JS-частину** перевірки правила `n-text.mdc` / `npm/mdc/text.mdc` для пакета `@nitra/cursor`. Його роль — **доповнити** Rego-перевірки тими аспектами, які не вдається коректно описати декларативно: наявність файлів на файловій системі, вміст plain-text файлу `.v8rignore`, наявність абзацу про український апостроф у markdown-тексті правила, форма скрипта `lint-text` у `package.json` та виклик `bun run lint-text` у GitHub Actions workflow.

Модуль експортує функцію `check(cwd)`, яка повертає код виходу процесу (`0` — все ок, `1` — є порушення). Усі повідомлення про успіх/провал агрегує `createCheckReporter()` зі спільної бібліотеки `scripts/lib/check-reporter.mjs`.

Розподіл відповідальностей JS ↔ Rego (зафіксований у JSDoc-коментарі на початку файлу):

- **JS (цей файл):**
  - `.v8rignore` (текстовий формат, рядки шляхів);
  - наявність FS-файлів `.oxfmtrc.json`, `.cspell.json`, `.markdownlint-cli2.jsonc`, `.vscode/extensions.json`, `.vscode/settings.json`, `package.json`;
  - абзац про український апостроф у `.cursor/rules/n-text.mdc` / `npm/mdc/text.mdc` (markdown-текст);
  - перевірка скрипта `lint-text` у `package.json`;
  - наявність кроку `bun run lint-text` у workflow `lint-text.yml`.
- **Rego (`npx @nitra/cursor check`):**
  - `npm/policy/text/oxfmtrc/` — обовʼязкові ключі `.oxfmtrc.json` і канонічні значення (`semi`/`singleQuote`/`tabWidth`/`useTabs`/`printWidth`) + канонічні `ignorePatterns`;
  - `npm/policy/text/cspell/` — `.cspell.json` (`version "0.2"`, `language`, імпорт `@nitra/cspell-dict`, заборона `@cspell/dict-*`, обовʼязкові `ignorePaths`);
  - `npm/policy/text/markdownlint/` — `.markdownlint-cli2.jsonc` (`gitignore: true`, валідний JSON без коментарів);
  - `npm/policy/text/package_json/` — заборона Prettier (`prettier` поле + `prettier`/`@nitra/prettier-config` у залежностях), `@nitra/cspell-dict ^2.0.0+` у `devDependencies`, заборона `markdownlint-cli2` у залежностях;
  - `npm/policy/bun/package_json/` — у `devDependencies` лише пакети з `@nitra/*`;
  - `text.vscode_extensions` / `text.vscode_settings` — вміст `.vscode/extensions.json` та `.vscode/settings.json`.

## Експорти / API

| Назва | Тип | Опис |
| --- | --- | --- |
| `check` | `(cwd?: string) => Promise<number>` | Єдиний публічний експорт. Виконує всі перевірки текстового стека й повертає код виходу: `0` — порушень немає, `1` — є хоча б одне. |

Решта функцій (`verifyUkApostropheRuleParagraph`, `checkV8rIgnore`, `checkTextConfigsExistence`, `checkPackageJsonText`, `checkLintTextScript`) — внутрішні, не експортуються.

Також у файлі є модульна константа:

| Назва | Значення | Призначення |
| --- | --- | --- |
| `UK_APOSTROPHE_HEADING` | `'**Український апостроф:**'` | Заголовок абзацу про апостроф у `text.mdc` / `n-text.mdc`, по якому ведеться пошук у вмісті правила. |

## Функції

### `verifyUkApostropheRuleParagraph(filePath, body, failFn, passFn)`

**Сигнатура:** `(filePath: string, body: string, failFn: (msg: string) => void, passFn: (msg: string) => void) => void`

**Параметри:**

- `filePath` — шлях до файлу `.mdc`, використовується лише для повідомлень.
- `body` — вміст `.mdc` у кодуванні UTF-8 (рядок).
- `failFn` — callback, який реєструє порушення (фактично змушує `check()` повернути `1`).
- `passFn` — callback успіху для звіту.

**Повертає:** `void`. Чистих значень не повертає; вплив — виключно через callback-и.

**Поведінка:**

1. Якщо в тексті немає підрядка `**Український апостроф:**` — `failFn` з підказкою «додай абзац» і одразу `return`.
2. Якщо немає згадки `U+0027` **або** `U+2019` — `failFn`, `return`.
3. Якщо у вмісті немає символу `’` (типографська одинарна лапка U+2019) — `failFn`, `return`.
4. Інакше — `passFn('… абзац про український апостроф на місці')`.

**Side effects:** виклики `failFn` / `passFn` (запис у звіт `check-reporter`).

---

### `checkV8rIgnore(passFn, failFn, cwd)`

**Сигнатура:** `async (passFn: (msg: string) => void, failFn: (msg: string) => void, cwd: string) => Promise<void>`

**Параметри:**

- `passFn`, `failFn` — callback-и звіту.
- `cwd` — корінь репозиторію.

**Повертає:** `Promise<void>`.

**Поведінка:**

1. Будує шлях `cwd + '.v8rignore'` через `path.join`.
2. Якщо файлу немає (`existsSync` → `false`) — `failFn` з підказкою про мінімально потрібний вміст, `return`.
3. Читає файл `readFile(..., 'utf8')`.
4. Парсить рядки: розбиває за `\n`, обрізає пробіли (`trim`), відкидає порожні й коментарі (рядки, що починаються з `#`), кладе результат у `Set`.
5. Для кожного з обовʼязкових шляхів `.vscode/extensions.json`, `.vscode/settings.json` перевіряє наявність у `Set`: знайдено → `passFn`, ні → `failFn` з підказкою додати рядок.

**Side effects:** читання файлу `.v8rignore` з диска (`fs/promises.readFile`), виклики `failFn` / `passFn`.

---

### `checkTextConfigsExistence(passFn, failFn, cwd)`

**Сигнатура:** `(passFn: (msg: string) => void, failFn: (msg: string) => void, cwd: string) => Promise<void>`

Хоч JSDoc описує функцію як таку, що повертає `Promise<void>`, тіло функції — синхронне. Наприкінці явно повертається `Promise.resolve()` для збереження асинхронного контракту (можна `await`-ити без шкоди).

**Параметри:**

- `passFn`, `failFn` — callback-и звіту.
- `cwd` — корінь репозиторію.

**Повертає:** `Promise<void>`.

**Поведінка:**

Ітерується по фіксованому масиву пар `[path, mdcRef]`:

| path | mdcRef (Rego-пакет із описом структури) |
| --- | --- |
| `.oxfmtrc.json` | `text.oxfmtrc` |
| `.cspell.json` | `text.cspell` |
| `.markdownlint-cli2.jsonc` | `text.markdownlint` |
| `.vscode/extensions.json` | `text.vscode_extensions` |
| `.vscode/settings.json` | `text.vscode_settings` |

Для кожної пари:

- `existsSync(join(cwd, path))` → `passFn` із підказкою, що структуру перевіряє `npx @nitra/cursor fix` через відповідний Rego-пакет.
- Файлу немає → `failFn('<path> не існує — створи згідно n-text.mdc')`.

**Side effects:** `existsSync` (синхронне звернення до файлової системи), виклики callback-ів. Запис у файли не виконується.

---

### `checkPackageJsonText(passFn, failFn, cwd)`

**Сигнатура:** `async (passFn: (msg: string) => void, failFn: (msg: string) => void, cwd: string) => Promise<void>`

**Параметри:**

- `passFn`, `failFn` — callback-и звіту.
- `cwd` — корінь репозиторію.

**Повертає:** `Promise<void>`.

**Поведінка:**

1. `pkgPath = join(cwd, 'package.json')`. Якщо файлу немає — мовчазний `return` (відсутність `package.json` — окремий concern, цей модуль його не валідує).
2. `pkg = JSON.parse(await readFile(pkgPath, 'utf8'))` — кидає виключення, якщо JSON битий (свідома відмова: краще вибух у CI, ніж проковтнута помилка).
3. Викликає `checkLintTextScript(pkg.scripts?.['lint-text'], passFn, failFn)` — валідація команди.
4. `lintTextWf = join(cwd, '.github/workflows/lint-text.yml')`.
   - Якщо workflow існує:
     - читає YAML, парсить `parseWorkflowYaml(wf)`.
     - якщо парсер повернув root — перевіряє `anyRunStepIncludes(root, 'bun run lint-text')`; якщо ні — fallback `wf.includes('bun run lint-text')`.
     - результат: `passFn('lint-text.yml викликає bun run lint-text')` або `failFn('lint-text.yml має містити крок bun run lint-text')`.
   - Якщо workflow немає — `failFn('.github/workflows/lint-text.yml не існує — створи згідно n-text.mdc')`.

**Side effects:** читання `package.json` і потенційно `lint-text.yml`, виклики callback-ів, можливе виключення `JSON.parse` на пошкодженому `package.json`.

---

### `checkLintTextScript(lintText, passFn, failFn)`

**Сигнатура:** `(lintText: unknown, passFn: (msg: string) => void, failFn: (msg: string) => void) => void`

**Параметри:**

- `lintText` — значення `scripts['lint-text']` із `package.json` (очікувано — рядок, але приймається `unknown` для безпечного narrowing).
- `passFn`, `failFn` — callback-и звіту.

**Повертає:** `void`.

**Поведінка:**

1. Якщо `typeof lintText === 'string'` — обрізає пробіли (`trim`), інакше `lt = ''`.
2. Якщо `lt === 'n-cursor lint-text'` — `passFn('lint-text делегує CLI n-cursor lint-text (cspell + shellcheck + markdownlint + v8r)')`.
3. Інакше — `failFn('package.json: lint-text має бути "n-cursor lint-text" — CLI пакета @nitra/cursor виконує cspell → shellcheck → markdownlint-cli2 → v8r (text.mdc)')`.

Це канонічна форма: пакет `@nitra/cursor` CLI-командою `n-cursor lint-text` всередині запускає послідовність `cspell` → `runShellcheckText()` → `bunx markdownlint-cli2 --fix` → `runV8rWithGlobs()`. Дозволені тільки пробіли навколо команди — інші варіанти забороняються.

**Side effects:** виклики callback-ів.

---

### `check(cwd = process.cwd())`

**Сигнатура:** `async (cwd?: string) => Promise<number>`

**Параметри:**

- `cwd` — корінь репозиторію. За замовчуванням `process.cwd()` (звичайний кейс — запуск зі скрипта `npx @nitra/cursor`).

**Повертає:** `Promise<number>` — `0`, якщо порушень немає; `1`, якщо є хоча б одне (значення обчислюється `reporter.getExitCode()`).

**Поведінка (послідовність кроків):**

1. `reporter = createCheckReporter()` — створює агрегатор звіту з полями `pass`, `fail`, `getExitCode`.
2. `await checkV8rIgnore(pass, fail, cwd)` — перевірка `.v8rignore`.
3. `await checkTextConfigsExistence(pass, fail, cwd)` — наявність FS-конфігів.
4. Шукає `.cursor/rules/n-text.mdc` та `npm/mdc/text.mdc` (через `existsSync`):
   - якщо жодного — нейтральний `pass('n-text.mdc / npm/mdc/text.mdc відсутні — перевірку абзацу про апостроф пропущено')`;
   - якщо є — для кожного існуючого файлу читає вміст і викликає `verifyUkApostropheRuleParagraph(p, body, fail, pass)`.
5. `await checkPackageJsonText(pass, fail, cwd)` — `lint-text` + workflow.
6. Повертає `reporter.getExitCode()`.

**Side effects:** читання файлів `.v8rignore`, `.cursor/rules/n-text.mdc`, `npm/mdc/text.mdc`, `package.json`, `.github/workflows/lint-text.yml`; `existsSync`-перевірки конфігів і файлів правил. Запис у файлову систему не виконується.

Зверніть увагу: коментар у тілі функції `check` фіксує, що **Prettier-конфіги / ignore** — окремий concern, обробляється в `rules/text/js/forbidden-prettier.mjs`, тут не валідується.

## Залежності

### Стандартна бібліотека Node.js

- `node:fs` → `existsSync` — синхронна перевірка наявності файлу.
- `node:fs/promises` → `readFile` — асинхронне читання текстових файлів у UTF-8.
- `node:path` → `join` — кросплатформенне склеювання шляхів від `cwd`.

### Внутрішні модулі пакета `@nitra/cursor`

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика звіту з API `{ pass, fail, getExitCode }`.
- `../../../scripts/lib/gha-workflow.mjs` → `anyRunStepIncludes`, `parseWorkflowYaml` — парсер GitHub Actions workflow YAML + утиліта пошуку фрагмента в командах `run:`.

### Файли в репозиторії, які читає модуль

- `.v8rignore` (text).
- `.cursor/rules/n-text.mdc`, `npm/mdc/text.mdc` (markdown зі сторінки правила).
- `package.json` (JSON.parse).
- `.github/workflows/lint-text.yml` (YAML, парситься, з fallback на текстовий `includes`).

### Файли, які лише перевіряються на існування

- `.oxfmtrc.json`, `.cspell.json`, `.markdownlint-cli2.jsonc`, `.vscode/extensions.json`, `.vscode/settings.json`.

## Потік виконання / Використання

Файл — частина «JS-чек-пакета» правила `text` усередині CLI `@nitra/cursor`. Типовий запуск:

1. CI / локально викликає кореневий скрипт пакета `@nitra/cursor`, який обходить `npm/rules/<rule>/js/*.mjs` і шукає експорт `check`.
2. Для правила `text` серед інших підключається й `formatting.mjs`. CLI імпортує `check` і викликає `await check(repoRoot)`.
3. Усередині `check`:
   - Запускаються чотири блоки перевірок: `.v8rignore`, FS-існування конфігів, абзац про апостроф у `.mdc`, `package.json` + workflow.
   - Кожна знахідка фіксується в `reporter` (через локально розпаковані `pass` / `fail`).
   - Після всіх перевірок `reporter.getExitCode()` повертає `0` або `1`.
4. CLI агрегує результати з усіх правил і виходить з відповідним кодом, який підхоплює GitHub Actions як статус кроку.

Контракт із Rego-частиною: цей модуль **не дублює** контентну валідацію. Якщо файл `.oxfmtrc.json` / `.cspell.json` / `.markdownlint-cli2.jsonc` / `.vscode/*.json` існує, його структуру перевіряє відповідний Rego-пакет (див. таблицю в розділі «Огляд»). JS-модуль гарантує лише сам факт існування, формат `.v8rignore` (plain-text), markdown-абзац про апостроф та форму скрипта `lint-text` + наявність workflow-кроку.

Розширення: щоб додати ще одну FS-перевірку — додай пару `[path, mdcRef]` у масив `checkTextConfigsExistence`. Щоб міняти канонічну команду — править `checkLintTextScript`. Більш складна валідація структурованих файлів повинна йти **в Rego**, а не в цей JS-модуль.

## Rebuild Test

Цей розділ — контрольний перелік фактів, за якими файл `formatting.mjs` має бути відновлюваним:

- Експорт єдиний — `async function check(cwd = process.cwd()): Promise<number>`.
- Імпорти: `existsSync` із `node:fs`; `readFile` із `node:fs/promises`; `join` із `node:path`; `createCheckReporter` із `../../../scripts/lib/check-reporter.mjs`; `anyRunStepIncludes`, `parseWorkflowYaml` із `../../../scripts/lib/gha-workflow.mjs`.
- Константа `UK_APOSTROPHE_HEADING = '**Український апостроф:**'`.
- `verifyUkApostropheRuleParagraph` — 4 кроки (heading → `U+0027` і `U+2019` → `’` → pass), кожен невдалий крок робить `failFn` і `return`.
- `checkV8rIgnore` — обовʼязкові рядки `['.vscode/extensions.json', '.vscode/settings.json']`; парсинг: split `\n` → `trim` → відкинути порожні й `#`-коментарі → `Set`.
- `checkTextConfigsExistence` — точна таблиця з 5 пар `[path, mdcRef]`; синхронне тіло; повертає `Promise.resolve()`.
- `checkPackageJsonText` — silent return якщо `package.json` відсутній; `JSON.parse` без try/catch; передає `pkg.scripts?.['lint-text']` у `checkLintTextScript`; перевіряє `.github/workflows/lint-text.yml`, спочатку через `parseWorkflowYaml` + `anyRunStepIncludes(..., 'bun run lint-text')`, з fallback на `wf.includes('bun run lint-text')`, якщо парсер не повернув root.
- `checkLintTextScript` — успіх **тільки** на `'n-cursor lint-text'` (після `trim`).
- `check`:
  1. `createCheckReporter()` → деструктуризація `{ pass, fail }`;
  2. `await checkV8rIgnore(pass, fail, cwd)`;
  3. `await checkTextConfigsExistence(pass, fail, cwd)`;
  4. збір `textRulePaths` із `.cursor/rules/n-text.mdc` і `npm/mdc/text.mdc` через `existsSync` → якщо пусто, `pass('… пропущено')`; інакше `for…of` із `readFile` і `verifyUkApostropheRuleParagraph(p, body, fail, pass)`;
  5. `await checkPackageJsonText(pass, fail, cwd)`;
  6. `return reporter.getExitCode()`.
- Коментар у тілі `check` явно фіксує, що `text.forbidden-prettier` живе в `rules/text/js/forbidden-prettier.mjs`.
