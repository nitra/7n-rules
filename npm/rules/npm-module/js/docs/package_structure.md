# package_structure.mjs

## Огляд

Модуль `package_structure.mjs` — це checker правила `npm-module.mdc` у пакеті `@nitra/cursor`. Він валідує структуру npm-модуля в монорепо: наявність каталогу `npm/`, файлу `npm/package.json`, конфігурації hk (`hk.pkl` або `.config/hk.pkl`), workflow `npm-publish.yml`, та узгодженість TypeScript-emit (поле `types`, генерація `index.d.ts`, виклик `tsc` у pre-commit hook).

Модуль підтримує два альтернативні layout-и npm-модуля:

1. **`npm/src` + `.js`-файли** — канонічний layout зі згенерованим `npm/types/index.d.ts` через `tsc` з прапорцями `--declaration --allowJs --emitDeclarationOnly --outDir types --skipLibCheck`.
2. **`npm/tsconfig.emit-types.json`** — коли `.js`-файлів під `npm/src` немає; типи виганяються через `tsc -p tsconfig.emit-types.json`.

Окремо модуль контролює, щоб опублікований пакет (`npm pack`) не містив тестів і фікстур: сканує каталог `npm/` за полем `"files"` з `package.json` (з урахуванням негативних glob-патернів) і відсіює test-style каталоги, імена файлів та AST-імпорти test-фреймворків.

Деякі перевірки (структура `npm/package.json`, валідація `compilerOptions` у `tsconfig.emit-types.json`, валідація полів `npm-publish.yml`) делеговані Rego-полісі у `npm/policy/npm_module/`. У цьому файлі лишається лише cross-file / FS / AST-частина: чи реально існує файл на диску, чи містить опублікований tarball тести, чи має `hk.pkl` правильні підрядки команди `tsc`.

Узгодженість `version`/`CHANGELOG.md` у файлі **не** перевіряється — це робить `changelog/js/consistency.mjs` за моделлю `n-changelog.mdc`.

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `globToRegex(glob)` | `function` | Перетворює glob-патерн на `RegExp` із якорями `^` / `$`; підтримує `**`, `*`, `?`, `{a,b,c}`. |
| `findTestFrameworkImport(content, virtualPath)` | `async function` | Парсить JS/TS через `oxc-parser` і повертає назву модуля test-фреймворку, якщо знайдено import / require / dynamic import. |
| `classifyPublishedFileAsTest(relPath, cwd?)` | `async function` | Класифікує файл як test/fixture за каталогом, basename або AST-імпортом. |
| `check(cwd?)` | `async function` | Головна точка входу checker-а правила `npm-module.mdc`; повертає exit-code `0` / `1`. |

Решта функцій (`npmSrcTreeHasJsFile`, `readHkConfig`, `missingHkSrcLayoutFragments`, `missingHkEmitTypesConfigFragments`, `npmTypesFileFromPackageField`, `checkNpmPackageJson`, `checkEmitTypesConfig`, `checkPublishWorkflow`, `collectPublishedFiles`, `checkNoTestsInPublishedFiles`, `checkNpmModuleBasicStructure`) — приватні для модуля.

## Константи

| Константа | Значення / Опис |
| --- | --- |
| `EMIT_TYPES_CONFIG` | `'npm/tsconfig.emit-types.json'` — шлях до TS-config для emit без `src`. |
| `TEST_DIR_NAMES` | `Set` з `'tests'`, `'__tests__'`, `'fixtures'`, `'__fixtures__'`, `'spec'`, `'test'`. |
| `TEST_FILE_PATTERNS` | `[/^.+\.(test|spec)\.[cm]?[jt]sx?$/iu]` — патерн test-файлів за basename. Rego-файли (`*_test.rego`) свідомо не входять (conftest-конвенція). |
| `JS_LIKE_EXT_RE` | `/\.[cm]?[jt]sx?$/iu` — розширення, у яких сканується AST на імпорти test-фреймворків. |
| `TEST_FRAMEWORK_MODULES` | `Set` з `'bun:test'`, `'node:test'`, `'vitest'`, `'@jest/globals'`, `'jest'`, `'mocha'`, `'ava'`, `'tap'`, `'tape'`. |
| `REGEX_SPECIAL_IN_GLOB` | `Set` спецсимволів regex, які екрануються у glob-сегменті (без `*`/`?`). |
| `GLOBSTAR_LEADING_RE` | `/^__GLOBSTAR__\//u` — маркер `**/` на початку. |
| `GLOBSTAR_TRAILING_RE` | `/\/__GLOBSTAR__$/u` — маркер `/**` у кінці. |

## Функції

### `npmSrcTreeHasJsFile(cwd, ignorePaths = [])`

- **Сигнатура:** `async (cwd: string, ignorePaths?: string[]) => Promise<boolean>`
- **Параметри:**
  - `cwd` — корінь репозиторію.
  - `ignorePaths` — абсолютні шляхи каталогів, повністю виключених з обходу (з `loadCursorIgnorePaths`).
- **Повертає:** `true`, якщо хоча б один `.js` під `npm/src` (рекурсивно); інакше `false`. Якщо `npm/src` не існує — одразу `false`.
- **Side effects:** жодних (тільки FS-читання).

### `readHkConfig(cwd)`

- **Сигнатура:** `async (cwd: string) => Promise<{ path: string, text: string } | null>`
- **Параметри:** `cwd` — корінь репозиторію.
- **Повертає:** обʼєкт із relative-шляхом (`hk.pkl` або `.config/hk.pkl`) і повним текстом файлу; `null`, якщо жоден кандидат не існує.
- **Side effects:** читання файлу через `readFile`.

### `missingHkSrcLayoutFragments(hkText)`

- **Сигнатура:** `(hkText: string) => string[]`
- **Параметри:** `hkText` — текст hk-конфігурації.
- **Повертає:** список фрагментів, яких немає в тексті. Очікувані фрагменти: `["pre-commit"]`, `bunx -p typescript tsc`, `src/**/*.js`, `--declaration`, `--allowJs`, `--emitDeclarationOnly`, `--outDir types`, `--skipLibCheck`.
- **Side effects:** немає.

### `missingHkEmitTypesConfigFragments(hkText)`

- **Сигнатура:** `(hkText: string) => string[]`
- **Параметри:** `hkText` — текст hk-конфігурації.
- **Повертає:** список відсутніх фрагментів для layout-у через `tsconfig.emit-types.json`: `["pre-commit"]`, `bunx -p typescript tsc`, `tsconfig.emit-types.json`.
- **Side effects:** немає.

### `npmTypesFileFromPackageField(typesField)`

- **Сигнатура:** `(typesField: unknown) => string | null`
- **Параметри:** `typesField` — значення поля `types` з `npm/package.json`.
- **Повертає:** posix-шлях `npm/<rel>` (наприклад, `npm/types/bin/x.d.ts`) або `null`, якщо значення не починається з `./types/` чи не є рядком.
- **Side effects:** немає.

### `checkNpmPackageJson(useSrcJsLayout, passFn, failFn, cwd)`

- **Сигнатура:** `async (useSrcJsLayout: boolean, passFn, failFn, cwd: string) => Promise<void>`
- **Поведінка:**
  - Якщо `npm/package.json` відсутній — нічого не робить (вище у потоці це вже відловлено).
  - Для layout `src+js`: очікує існування `npm/types/index.d.ts`.
  - Для layout `emit-types`: бере `npm/<types-field>` і перевіряє існування.
- **Викликає:** `passFn(msg)` при успіху, `failFn(msg)` при помилці.
- **Side effects:** читає `npm/package.json`.

### `checkEmitTypesConfig(passFn, failFn, cwd)`

- **Сигнатура:** `(passFn, failFn, cwd: string) => void`
- **Поведінка:** перевіряє лише існування `npm/tsconfig.emit-types.json`. Структуру `compilerOptions` валідує Rego-полісі `npm_module/emit_types_config`.

### `checkPublishWorkflow(passFn, failFn, cwd)`

- **Сигнатура:** `(passFn, failFn, cwd: string) => void`
- **Поведінка:** перевіряє лише існування `.github/workflows/npm-publish.yml`. Структуру полів workflow валідує Rego-полісі `npm_module/npm_publish_yml`.

### `globToRegex(glob)` (експортована)

- **Сигнатура:** `(glob: string) => RegExp`
- **Параметри:** `glob` — posix-шлях у glob-нотації.
- **Повертає:** `RegExp` з якорями `^` / `$` і прапорцем `u`.
- **Підтримка синтаксису:**
  - `**` — нуль або більше сегментів (`(?:/.*/|/)` між сегментами, `(?:.*/)?` на початку, `(?:/.*)?` у кінці, `.*` як єдиний токен).
  - `*` — будь-які символи без `/` (`[^/]*`).
  - `?` — один символ без `/` (`[^/]`).
  - `{a,b,c}` — brace-альтернативи (`(?:a|b|c)`).
- **Не підтримує:** клас `[…]` (для негативних патернів `files` цього достатньо).
- **Safety:** усі спецсимволи екрануються через `REGEX_SPECIAL_IN_GLOB`; eslint правило `security/detect-non-literal-regexp` явно вимкнено, бо вхід контрольований (поле `files` з `npm/package.json`).

### `collectPublishedFiles(filesField, cwd)`

- **Сигнатура:** `async (filesField: string[], cwd: string) => Promise<string[]>`
- **Параметри:**
  - `filesField` — значення поля `files` з `npm/package.json`.
  - `cwd` — корінь репозиторію.
- **Алгоритм:**
  1. Розділяє patterns на позитивні і негативні (за префіксом `!`).
  2. Для кожного позитивного pattern: якщо це файл — додає до `collected`; якщо директорія — рекурсивно через `walkDir` додає всі знайдені файли (posix-шляхи без `npm/` префікса).
  3. Фільтрує: викидає файли, які матчать будь-який негативний `globToRegex`.
  4. Сортує `[].sort()` (лексикографічно) і повертає.
- **Side effects:** `stat()` для кожного позитивного pattern, `walkDir` для директорій.
- **Обмеження:** не дублює всю логіку `npm pack` (LICENSE / README / mandatory files); сканує лише простір імен `files`.

### `findTestFrameworkImport(content, virtualPath)` (експортована)

- **Сигнатура:** `(content: string, virtualPath: string) => string | null`
- **Параметри:**
  - `content` — повний текст файлу.
  - `virtualPath` — шлях файлу (для вибору `lang` через `langFromPath`).
- **Повертає:** ім'я модуля test-фреймворку (з `TEST_FRAMEWORK_MODULES`), якщо знайдено; `null` інакше.
- **Алгоритм:**
  1. Парсить через `parseSync` із `oxc-parser`; при помилці парсингу — повертає `null` (це не AST-checker для синтаксису).
  2. Якщо `result.errors.length` ≠ 0 — повертає `null`.
  3. Спочатку перевіряє `result.module.staticImports`.
  4. Якщо в static-import не знайдено — обходить AST через `walkAstWithAncestors` і шукає `require(...)` (через `requireCallModule`) та `import(...)` dynamic (через `dynamicImportModule`).
- **Side effects:** немає.

### `classifyPublishedFileAsTest(relPath, cwd = process.cwd())` (експортована)

- **Сигнатура:** `async (relPath: string, cwd?: string) => Promise<string | null>`
- **Параметри:**
  - `relPath` — posix-шлях відносно `npm/`.
  - `cwd` — корінь репозиторію (за замовчуванням `process.cwd()`).
- **Повертає:** рядок-причину порушення або `null`, якщо файл валідний.
- **Класифікація (за пріоритетом):**
  1. У path є сегмент із `TEST_DIR_NAMES` → `'test-style каталог "<seg>/"'`.
  2. Basename матчить `TEST_FILE_PATTERNS` → `"test-style ім'я файлу"`.
  3. Розширення JS-like і AST містить імпорт test-фреймворку → `'імпорт test-фреймворку "<mod>"'`.
- **Carve-out:** для `rules/<rule-name>/...` сегмент `<rule-name>` (індекс 1) ігнорується, бо це ім'я правила (наприклад, правило з id `test` саме описує конвенцію тестів і не є fixture-каталогом). Подальші сегменти (`rules/<r>/js/<c>/tests/`) продовжують перевірятись.
- **Side effects:** для JS-like розширень — `readFile(join(cwd, 'npm', relPath))`.

### `checkNoTestsInPublishedFiles(pass, fail, cwd)`

- **Сигнатура:** `async (pass, fail, cwd: string) => Promise<void>`
- **Поведінка:**
  - Якщо `npm/package.json` відсутній або поле `files` не масив — нічого не робить.
  - Інакше збирає файли через `collectPublishedFiles` і прогонить кожен через `classifyPublishedFileAsTest`.
  - На порушення викликає `fail(...)` з підказкою додати негативний glob у `files`.
  - На повну чистоту — `pass(...)` з кількістю перевірених файлів.

### `checkNpmModuleBasicStructure(pass, fail, cwd)`

- **Сигнатура:** `async (pass, fail, cwd: string) => Promise<void>`
- **Поведінка:** перевіряє наявність `package.json`, директорії `npm/` і `npm/package.json`. Поле `workspaces ∋ "npm"` у кореневому `package.json` валідує Rego.

### `check(cwd = process.cwd())` (експортована, головна)

- **Сигнатура:** `async (cwd?: string) => Promise<number>`
- **Повертає:** `0` — все OK, `1` — є проблеми (через `reporter.getExitCode()`).
- **Алгоритм:**
  1. Створює `createCheckReporter()`, дістає `pass`, `fail`.
  2. `checkNpmModuleBasicStructure` — `package.json`, `npm/`, `npm/package.json`.
  3. `checkNoTestsInPublishedFiles` — компактність tarball.
  4. `loadCursorIgnorePaths(cwd)` для подальшого скану `npm/src`.
  5. `npmSrcTreeHasJsFile` → визначає `useSrcJsLayout`.
  6. `checkNpmPackageJson(useSrcJsLayout, ...)` — поле `types` і відповідний файл на диску.
  7. Якщо НЕ `useSrcJsLayout` — `checkEmitTypesConfig`.
  8. `readHkConfig` → знайти hk; перевірити pre-commit-фрагменти через `missingHkSrcLayoutFragments` або `missingHkEmitTypesConfigFragments` залежно від layout.
  9. `.github/workflows/` існує.
  10. `checkPublishWorkflow` — `npm-publish.yml`.
  11. `return reporter.getExitCode()`.

## Залежності

### Node.js core

- `node:fs` — `existsSync`.
- `node:fs/promises` — `readFile`, `stat`.
- `node:path` — `join`, `sep`.

### Зовнішні npm

- `oxc-parser` — `parseSync` для AST-парсингу JS/TS у `findTestFrameworkImport`.

### Внутрішні (relative)

- `../../../scripts/utils/ast-scan-utils.mjs` — `dynamicImportModule`, `langFromPath`, `requireCallModule`, `walkAstWithAncestors`.
- `../../../scripts/lib/check-reporter.mjs` — `createCheckReporter` (повертає `{ pass, fail, getExitCode }`).
- `../../../scripts/lib/load-cursor-config.mjs` — `loadCursorIgnorePaths` (читає `.cursorignore`-подібні шляхи).
- `../../../scripts/utils/walkDir.mjs` — `walkDir(root, callback, ignorePaths?)` для рекурсивного обходу.

## Потік виконання / Використання

### Базовий потік `check(cwd)`

```text
check(cwd)
├── createCheckReporter() → { pass, fail, getExitCode }
├── checkNpmModuleBasicStructure(pass, fail, cwd)
│     ├── existsSync(cwd/package.json) ? pass : fail
│     ├── existsSync(cwd/npm) && stat(...).isDirectory() ? pass : fail
│     └── existsSync(cwd/npm/package.json) ? pass : fail
├── checkNoTestsInPublishedFiles(pass, fail, cwd)
│     ├── readFile(npm/package.json) → pkg
│     ├── if !Array.isArray(pkg.files) → return
│     ├── files = collectPublishedFiles(pkg.files, cwd)
│     └── for rel of files: classifyPublishedFileAsTest(rel, cwd)
├── ignorePaths = loadCursorIgnorePaths(cwd)
├── useSrcJsLayout = npmSrcTreeHasJsFile(cwd, ignorePaths)
├── checkNpmPackageJson(useSrcJsLayout, pass, fail, cwd)
├── if !useSrcJsLayout → checkEmitTypesConfig(pass, fail, cwd)
├── hk = readHkConfig(cwd)
│     ├── hk == null → fail (потрібен hk.pkl)
│     └── inakshe →
│           missing = useSrcJsLayout
│             ? missingHkSrcLayoutFragments(hk.text)
│             : missingHkEmitTypesConfigFragments(hk.text)
│           missing.length === 0 ? pass : fail
├── existsSync(.github/workflows/) ? pass : fail
├── checkPublishWorkflow(pass, fail, cwd)
└── return reporter.getExitCode()
```

### Точка інтеграції

Цей файл — частина пакету `@nitra/cursor` (`npm/rules/npm-module/js/`). Він викликається CLI `npx @nitra/cursor fix` (або `n-cursor`) у режимі checker правила `npm-module`. Експортована функція `check(cwd?)` — стандартний контракт для checker-ів правил у каталозі `npm/rules/<rule>/js/`.

### Розподіл відповідальностей із Rego

- **Цей JS:** FS-existence (чи є файл / директорія), AST-сканування (test-imports), glob-обчислення для `files`, cross-file (`package.json` ↔ файли на диску).
- **Rego (`npm/policy/npm_module/`):**
  - `npm_package_json` — структура `npm/package.json` (whitelist `files`, заборона `devDependencies`, тощо).
  - `emit_types_config` — `compilerOptions` у `npm/tsconfig.emit-types.json`.
  - `npm_publish_yml` — поля workflow (`on.push.paths`, `branches`, `id-token: write`, кроки JS-DevTools/npm-publish), парсяться після YAML-parse.
  - `root_package_json` — `workspaces ∋ "npm"` у кореневому `package.json`.

### Приклад інтеграції

```js
import { check } from '@nitra/cursor/rules/npm-module/js/package_structure.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Що НЕ робить файл

- Не перевіряє узгодженість `version` ↔ `CHANGELOG.md` — це `changelog/js/consistency.mjs` (правило `n-changelog.mdc`).
- Не валідує сам формат AST/синтаксис коду — за помилки парсингу `findTestFrameworkImport` мовчки повертає `null`.
- Не дублює логіку `npm pack` (LICENSE / README / mandatory files) — сканує лише простір імен `files`.
- Не перевіряє вміст Rego-полісі — лише дискову наявність / FS / AST.

## Rebuild Test

Файл можна повністю відтворити з опису вище:

- Імпорти: `node:fs` (`existsSync`), `node:fs/promises` (`readFile`, `stat`), `node:path` (`join`, `sep`), `oxc-parser` (`parseSync`), і чотири внутрішні модулі (`ast-scan-utils.mjs`, `check-reporter.mjs`, `load-cursor-config.mjs`, `walkDir.mjs`).
- Константи: `EMIT_TYPES_CONFIG`, `TEST_DIR_NAMES`, `TEST_FILE_PATTERNS`, `JS_LIKE_EXT_RE`, `TEST_FRAMEWORK_MODULES`, `REGEX_SPECIAL_IN_GLOB`, `GLOBSTAR_LEADING_RE`, `GLOBSTAR_TRAILING_RE`.
- Експорти: `globToRegex`, `findTestFrameworkImport`, `classifyPublishedFileAsTest`, `check`.
- Алгоритми описано у секціях "Функції" і "Потік виконання".
