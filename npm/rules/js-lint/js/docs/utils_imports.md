# utils_imports.mjs — перевірка кордону `utils/`-каталогів

## Огляд

Модуль `npm/rules/js-lint/js/utils_imports.mjs` реалізує одну з перевірок правила `js-lint.mdc`: жоден файл усередині будь-якого каталогу з ім'ям `utils/` не має імпортувати щось за межами цього самого каталогу через відносні шляхи з префіксом `..`.

Філософія перевірки:

- Каталог `utils/` за конвенцією тримає **generic helpers** — функції без бізнес-логіки, без знання про домен, без залежностей від конфігів конкретного проєкту.
- Якщо файлу треба сусідній модуль (наприклад, `lib/foo.mjs` чи cross-rule helper) — він мусить переїхати у `lib/`, а не отримувати доступ через `../lib/foo.mjs`.
- Дозволені імпорт-джерела: `./X`, `./sub/X` (свій каталог чи глибше), bare-package (`oxc-parser`, `@scope/pkg`), Node-builtin (`node:fs`, `fs`).
- Заборонено будь-який `..`-шлях (`../X`, `../../X`, ...).

Перевірка проходить по всьому monorepo: знаходить package-roots, у кожному рекурсивно шукає каталоги `utils/`, з кожного збирає не-тестові джерела (без `tests/` і `__fixtures__/`), парсить їх через `oxc-parser`, витягає всі імпорти (статичні, динамічні, `require(...)`) і логує fail-репорт для кожного імпорту з `..`-префіксом.

Файл є точкою входу check-runner-а (CI-чи-локальний прогон): експортує одну async-функцію `check()`, яка повертає exit-code.

## Експорти / API

| Експорт | Тип | Призначення |
|---------|-----|-------------|
| `check` | `() => Promise<number>` | named export; запускає перевірку від `process.cwd()` і повертає `0` (OK) або `1` (знайдено порушення) |

Усе інше — приватні helpers модуля без `export`.

## Функції

### `isIgnored(dir, ignorePaths)`

Перевіряє, чи каталог входить у список ignore (точний збіг або префіксне співпадіння).

- **Сигнатура:** `function isIgnored(dir: string, ignorePaths: string[]): boolean`
- **Параметри:**
  - `dir` — абсолютний posix-шлях каталогу.
  - `ignorePaths` — масив абсолютних posix-шляхів, отриманих з `.n-cursor.json` через `loadCursorIgnorePaths`.
- **Повертає:** `true`, якщо `dir` дорівнює якомусь елементу `ignorePaths` або починається з нього + `/`; інакше `false`.
- **Side effects:** немає.

### `findUtilsDirs(root, ignorePosix)`

Рекурсивно шукає всі каталоги з ім'ям `utils` під `root`.

- **Сигнатура:** `async function findUtilsDirs(root: string, ignorePosix: string[]): Promise<string[]>`
- **Параметри:**
  - `root` — абсолютний шлях кореня обходу (зазвичай корінь package).
  - `ignorePosix` — список абсолютних posix-шляхів, які пропускати.
- **Повертає:** масив абсолютних шляхів знайдених `utils/`-каталогів. Порядок — результат DFS у тому ж порядку, в якому повертає `readdir`.
- **Алгоритм:**
  - Вкладена рекурсивна функція `walk(dir)` читає `readdir(dir, { withFileTypes: true })`.
  - Помилка `readdir` (наприклад, нема прав чи каталог зник) проглинається через `try/catch` і дає ранній `return`.
  - Для кожного запису-каталогу:
    - якщо ім'я входить у `SKIP_DIR_NAMES` (`node_modules`, `.git`, `dist`, `coverage`, `.turbo`, `.next`, `__fixtures__`) — скіп;
    - повний шлях конвертується у posix і перевіряється через `isIgnored` — скіп якщо так;
    - якщо ім'я — рівно `utils`, додається у `found` і **не** заходить глибше (вкладені `utils/utils/` не очікуються; навіть якщо є — внутрішній `utils/` усе одно під самим `utils/` і його файли все одно пройдуть як файли зовнішнього `utils/`);
    - інакше — рекурсивно `walk(full)`.
- **Side effects:** filesystem-чтення.

### `collectUtilsSources(utilsDir)`

Збирає всі не-тестові source-файли під `utilsDir`.

- **Сигнатура:** `async function collectUtilsSources(utilsDir: string): Promise<string[]>`
- **Параметри:** `utilsDir` — абсолютний шлях каталогу `utils/`.
- **Повертає:** масив абсолютних шляхів файлів-джерел.
- **Фільтри:**
  - Каталоги `tests/`, `__fixtures__/` і будь-що з `SKIP_DIR_NAMES` — пропускаються (тести легально мають імпорти `../X` до свого модуля).
  - Файли мають матчити `JS_SOURCE_RE` (`.mjs`, `.mts`, `.cjs`, `.cts`, `.js`, `.ts`, `.jsx`, `.tsx`).
  - Файли, що матчать `TEST_FILE_RE` (`*.test.*`), — виключаються.
- **Алгоритм:** аналогічний DFS через вкладену `walk(dir)` з тим самим проглинанням помилок `readdir`.
- **Side effects:** filesystem-чтення.

### `extractImportSources(source, filePath)`

Витягає всі рядкові імпорт-source з тексту файлу.

- **Сигнатура:** `function extractImportSources(source: string, filePath: string): string[]`
- **Параметри:**
  - `source` — текст файлу (UTF-8).
  - `filePath` — шлях до файлу, потрібен для визначення мови парсингу через `langFromPath`.
- **Повертає:** масив рядків — значення source кожного імпорту в тому вигляді, в якому вони записані в коді (`'./foo'`, `'../bar'`, `'oxc-parser'`, ...).
- **Що збирає:**
  - **Статичні імпорти** — з `parsed.module.staticImports[*].moduleRequest.value` (oxc-parser API).
  - **Динамічні імпорти** (`import('...')`) — через `dynamicImportModule(node)` під час обходу AST.
  - **CommonJS `require('...')`** — через `requireCallModule(node)`.
- **Обробка помилок парсингу:** `try/catch` на `parseSync` повертає порожній масив і **не** падає, бо синтаксична помилка — окремий концерн іншої перевірки; ця має запуститись чисто і не блокувати решту.
- **Side effects:** немає (виклик `parseSync` — CPU-only).

### `check()` (named export)

Точка входу. Виконує всю перевірку від поточного робочого каталогу.

- **Сигнатура:** `export async function check(): Promise<number>`
- **Параметри:** немає; використовує `process.cwd()` як корінь monorepo.
- **Повертає:** `0` — порушень немає; `1` — є хоча б одне (реальний exit-code обчислює `reporter.getExitCode()`).
- **Покроковий алгоритм:**
  1. Створити `reporter` через `createCheckReporter()`.
  2. `root = process.cwd()`.
  3. Завантажити `ignorePaths` з `.n-cursor.json` (`loadCursorIgnorePaths`) і перевести у posix-варіант (`ignorePosix`).
  4. Отримати relative-paths package-roots monorepo через `getMonorepoPackageRootDirs(root)`.
  5. Для кожного package-root знайти всі `utils/`-каталоги (`findUtilsDirs`) і покласти у `Set` (`utilsDirSet`) для де-дуплікації.
  6. Якщо `utils/`-каталогів немає взагалі — `reporter.pass(...)` з повідомленням про пропуск і повернути exit-code.
  7. Інакше пройти кожен `utils/`-каталог:
     - зібрати джерела (`collectUtilsSources`);
     - для кожного файлу прочитати контент, витягти імпорти (`extractImportSources`);
     - кожен import з префіксом `..` — `reporter.fail(...)` з relative-шляхом файлу та порушеним import-source, інкремент `violations`;
     - `checkedFiles` рахує всі перевірені файли.
  8. Якщо `violations === 0` — `reporter.pass(...)` зі статистикою (кількість utils-каталогів і файлів).
  9. Повернути `reporter.getExitCode()`.
- **Side effects:**
  - filesystem-чтення (рекурсивне сканування + `readFile`);
  - запис у `reporter` (виводить рядки у stdout/stderr, залежно від реалізації);
  - читає `process.cwd()`.

## Залежності

### Node-builtin

- `node:fs/promises` — `readdir`, `readFile`.
- `node:path` — `join`, `relative`, `sep`.

### npm-пакет

- `oxc-parser` — `parseSync` для парсингу JS/TS у AST з достовірною підтримкою сучасних синтаксисів (zero-config).

### Внутрішні модулі проєкту

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика репортера; має методи `pass`, `fail`, `getExitCode`. Уніфікований API для всіх check-функцій.
- `../../../scripts/lib/load-cursor-config.mjs` → `loadCursorIgnorePaths` — читає `.n-cursor.json` (чи аналог) і повертає масив абсолютних шляхів, які треба пропустити.
- `../../../scripts/lib/workspaces.mjs` → `getMonorepoPackageRootDirs` — повертає relative-paths коренів пакетів у monorepo (включно з `.`-коренем, якщо це теж пакет).
- `../../../scripts/utils/ast-scan-utils.mjs`:
  - `langFromPath(filePath)` — мапить розширення файлу у `lang`-параметр для `oxc-parser`.
  - `walkAstWithAncestors(program, ancestors, visitor)` — обхід AST з трекінгом предків.
  - `dynamicImportModule(node)` — повертає рядок source для `import('...')`, або `null`.
  - `requireCallModule(node)` — повертає рядок source для `require('...')`, або `null`.

### Константи модуля

| Ім'я | Значення | Призначення |
|------|----------|-------------|
| `JS_SOURCE_RE` | `/\.(?:[cm]?[jt]sx?)$/u` | матчить `.mjs`, `.mts`, `.cjs`, `.cts`, `.js`, `.ts`, `.jsx`, `.tsx` |
| `TEST_FILE_RE` | `/\.test\.[cm]?[jt]sx?$/u` | матчить `*.test.{js,ts,...}` для виключення тестів |
| `PARENT_RELATIVE_RE` | `/^\.\.(?:\/|$)/u` | матчить `..` як цілий сегмент (`..` або `../*`); відсіює false-positive типу `..foo` |
| `SKIP_DIR_NAMES` | `Set(['node_modules', '.git', 'dist', 'coverage', '.turbo', '.next', '__fixtures__'])` | каталоги, які скіпаємо при обходах |

## Потік виконання / Використання

### Інтеграція в перевірочний рантайм

Модуль викликається check-runner-ом правила `js-lint.mdc` (зазвичай із `npm/rules/js-lint/js/`). Runner імпортує named export `check` і чекає на її resolved-значення як на process exit-code. Сам файл **не** має top-level executable коду — лише визначення; це дозволяє безпечно імпортувати його у тестах.

Типовий виклик (псевдокод):

```mjs
import { check } from './utils_imports.mjs'
const exitCode = await check()
process.exit(exitCode)
```

### Сценарій "усе чисто"

1. Runner запускається з кореня monorepo.
2. `check()` знаходить `utils/` каталоги в усіх package-roots.
3. Для кожного non-test source файлу витягає імпорти.
4. Жоден імпорт не починається з `..`.
5. `reporter.pass('utils-каталогів: N, перевірено M файлів — domain-bound імпортів немає (js-lint.mdc)')`.
6. `getExitCode() → 0`.

### Сценарій "є порушення"

1. Знайдено файл `packages/foo/utils/helper.mjs`.
2. У ньому є `import bar from '../lib/bar.mjs'`.
3. `PARENT_RELATIVE_RE` матчить `../lib/bar.mjs`.
4. `reporter.fail('packages/foo/utils/helper.mjs: заборонений імпорт \'../lib/bar.mjs\' — utils/-файли мають бути generic (js-lint.mdc)')`.
5. `violations` інкрементується.
6. По завершенню `getExitCode() → 1`.

### Сценарій "немає utils/"

1. У жодному package немає каталогу `utils/`.
2. `utilsDirSet.size === 0`.
3. `reporter.pass('utils-каталогів немає — перевірку пропущено (js-lint.mdc)')`.
4. `getExitCode() → 0`.

### Сценарій "файл із синтаксичною помилкою"

1. `parseSync` кидає виключення.
2. `extractImportSources` ловить його у `try/catch` і повертає `[]`.
3. Цей файл не дає порушень. Проблему синтаксису ловить інша перевірка.

### Сценарій "ignore-шлях"

1. У `.n-cursor.json` зазначено абсолютний шлях, що покриває певний `utils/`-каталог.
2. `findUtilsDirs` через `isIgnored` пропускає його ще на стадії обходу — той `utils/` навіть не потрапляє у `utilsDirSet`.

### Особливості/edge cases

- **Тести**: каталог `tests/` усередині `utils/` ігнорується повністю; також ігноруються файли `*.test.{js,ts,...}` будь-де всередині `utils/`. Це свідомо: тести легально імпортують свій модуль через `../X`.
- **`__fixtures__/`**: ігнорується і в `findUtilsDirs`, і в `collectUtilsSources` — фікстури можуть бути будь-якими.
- **Bare-imports** (`oxc-parser`, `node:fs`): не відсіюються спеціально, бо просто не матчать `PARENT_RELATIVE_RE`.
- **Same-dir імпорти** (`./X`): дозволені автоматично з тієї ж причини.
- **POSIX-шляхи для ignore**: під Windows `sep` — `\\`, тому шляхи нормалізуються у `/`-формат перед порівнянням з ignore-конфігом.
- **De-duplication** через `Set`: якщо monorepo-структура повертає однаковий `utils/`-шлях двічі (наприклад, `.`-root і назва вкладеного пакета перетинаються), він обробиться лише раз.
- **Помилки `readdir`** глушаться — недоступний каталог просто пропускається без падіння всієї перевірки.

### Залежність від конвенцій правила `js-lint.mdc`

Файл є технічною реалізацією одного з пунктів правила `js-lint.mdc`. Усі повідомлення `reporter.pass/fail` посилаються на `(js-lint.mdc)`, щоб користувач знав, де читати про сам принцип розділу `utils/` ↔ `lib/`.
