# conn-imports-scan.mjs

## Огляд

Модуль реалізує AST-сканер для правила «Внутрішні аліаси» з `js-run.mdc`. Його завдання — знаходити в JS/TS-файлах ті імпорти, що створюють підключення до бази даних або зовнішнього GraphQL-сервісу, і які повинні жити **лише** в каталозі `conn` пакета (типово `src/conn/`). Решта коду пакета має споживати ці підключення через `pkg-import` `#conn/...`, оголошений у полі `imports` файла `package.json`.

Сканер ловить три типи імпортів:

- `import { SQL } from 'bun'` — named-специфікатор `SQL` з модуля `bun`;
- `import ... from 'mssql'` — будь-який імпорт із модуля `mssql`;
- `import { GraphQLClient } from '@nitra/graphql-request'` — named-специфікатор `GraphQLClient` з пакета `@nitra/graphql-request`.

Каталог `conn` визначається динамічно за полем `package.json#imports['#conn/*']`. Якщо запис відсутній або має невідомий формат — використовується дефолтне значення `src/conn`. Поле `imports` — це нативний для Node.js механізм pkg-aliases, той самий, що задокументований у правилі.

Семантика імпортів читається через **`oxc-parser`** (`module.staticImports`); regex по тілу файлу свідомо **не** використовується (щоб не плутати рядкові літерали, коментарі, динамічні `import()` тощо). Якщо файл не парситься (синтаксична помилка) — сканер повертає порожній список: спершу треба полагодити синтаксис, інакше будь-які звіти будуть нерелевантні.

Модуль не виконує жодних побічних дій (read-only): не читає файлову систему, не пише, не звертається до мережі. Працює виключно з переданими аргументами (вмістом файлу та результатом парсингу `package.json`).

## Експорти / API

Модуль експортує чотири публічні функції (іменовані експорти):

| Експорт                                               | Тип      | Призначення                                                                                              |
| ----------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `resolveConnDirFromPackageJson(pkgJson)`              | function | Визначає відносний шлях до каталогу `conn` за `package.json#imports['#conn/*']` (з дефолтом `src/conn`). |
| `isInsideConnDir(relPosix, connDir)`                  | function | Перевіряє, чи лежить файл у каталозі `conn` (точно або вкладено).                                        |
| `findConnFactoryImportsInText(content, virtualPath?)` | function | Знаходить у тексті JS/TS-файлу всі імпорти-«фабрики підключень», повертає список знахідок із позиціями.  |
| `isConnImportsScanSourceFile(relativePathPosix)`      | function | Фільтр: чи варто сканувати файл за розширенням (JS/TS-сім'я, виключно без `.d.ts`).                      |

Дві допоміжні функції (`stripTrailingSlashes`, `toPosixDir`) і одна класифікуюча (`classifyConnImport`) — приватні модульні (не експортуються).

На модульному рівні оголошена константа `SOURCE_FILE_RE` — regex для перевірки розширень:

```text
/\.([cm]?[jt]sx?)$/u
```

Збігається з `.js`, `.cjs`, `.mjs`, `.jsx`, `.cjsx`, `.mjsx`, `.ts`, `.cts`, `.mts`, `.tsx`, `.ctsx`, `.mtsx`.

## Функції

### `stripTrailingSlashes(s)` (приватна)

- **Сигнатура:** `function stripTrailingSlashes(s: string): string`
- **Параметри:** `s` — рядок зі шляхом.
- **Повертає:** той самий рядок без хвостових `/`. Якщо хвостових слешів не було — повертає вхідне значення без копії (через `end === s.length`).
- **Алгоритм:** ітерує з кінця, поки кодова точка дорівнює `47` (символ `/` в ASCII), декрементує `end`. Реалізовано **без regex** свідомо — щоб уникнути попереджень про «slow regex» з боку лінтерів.
- **Side effects:** немає (pure).

### `toPosixDir(p)` (приватна)

- **Сигнатура:** `function toPosixDir(p: unknown): string`
- **Параметри:** `p` — вхідний шлях (може бути не-рядком; буде приведений через `String(p)`); допускає зворотні слеші (`\`) та префікс `./`.
- **Повертає:** нормалізований posix-шлях без хвостового `/`.
- **Алгоритм:**
  1. Приводить до рядка через `String(p)`.
  2. Усі `\` замінює на `/` (`replaceAll('\\', '/')`).
  3. Тримінгує пробіли (`trim()`).
  4. Якщо рядок починається з `./` — обрізає префікс.
  5. Прибирає хвостові `/` через `stripTrailingSlashes`.
- **Side effects:** немає (pure).

### `resolveConnDirFromPackageJson(pkgJson)` (експорт)

- **Сигнатура:** `function resolveConnDirFromPackageJson(pkgJson: unknown): string`
- **Параметри:** `pkgJson` — будь-яке значення; зазвичай розпарсений `package.json` (об'єкт) або `null`. Функція стійка до невалідного вхідного типу.
- **Повертає:** відносний posix-шлях до каталогу `conn` без хвостового `/`. Дефолт — `'src/conn'`.
- **Алгоритм:**
  1. Якщо `pkgJson` не об'єкт — повертає дефолт `'src/conn'`.
  2. Бере поле `imports`. Якщо його немає або воно не об'єкт — повертає дефолт.
  3. Шукає ключ `'#conn/*'`. Підтримує два формати запису:
     - **Рядок:** `"#conn/*": "./src/conn/*"` — береться як є.
     - **Об'єкт умовних експортів:** `{ default: '...', import: '...' }` — береться `default`, а якщо його немає — `import`.
  4. Якщо знайдене значення не є рядком — повертає дефолт.
  5. Нормалізує шлях через `toPosixDir`.
  6. Якщо шлях закінчується на `/*` — обрізає ці два символи.
  7. Прибирає хвостові слеші. Якщо в результаті порожній рядок — повертає дефолт.
- **Приклади:**
  - `{ imports: { '#conn/*': './src/conn/*' } }` → `'src/conn'`.
  - `{ imports: { '#conn/*': { default: 'lib/db/*' } } }` → `'lib/db'`.
  - `{ imports: { '#conn/*': './src/conn/' } }` → `'src/conn'`.
  - `null` або `{}` → `'src/conn'` (дефолт).
- **Side effects:** немає (pure).

### `isInsideConnDir(relPosix, connDir)` (експорт)

- **Сигнатура:** `function isInsideConnDir(relPosix: string, connDir: string): boolean`
- **Параметри:**
  - `relPosix` — відносний posix-шлях до файлу;
  - `connDir` — posix-шлях каталогу `conn` без хвостового `/`.
- **Повертає:** `true`, якщо файл лежить **точно** в каталозі `conn` або **вкладено** (тобто шлях починається з `${connDir}/`).
- **Алгоритм:**
  1. Якщо `connDir` порожній/falsy — `false`.
  2. Перевіряє точну рівність `relPosix === connDir` або початок з `${connDir}/`.
- **Зауваження:** функція не нормалізує `relPosix` — викликач повинен подавати вже нормалізований posix-шлях.
- **Side effects:** немає (pure).

### `classifyConnImport(staticImport)` (приватна)

- **Сигнатура:** `function classifyConnImport(staticImport: Record<string, unknown>): { module: string, specifier: string } | null`
- **Параметри:** `staticImport` — один елемент масиву `module.staticImports` з результату `oxc-parser`.
- **Повертає:** опис порушення `{ module, specifier }` або `null`, якщо це не «фабричний» імпорт підключення.
- **Алгоритм:**
  1. Витягує назву модуля з `staticImport.moduleRequest?.value`; якщо не рядок — `null`.
  2. Бере `entries` (named-специфікатори); якщо не масив — порожній список.
  3. Розгалуження за іменем модуля:
     - `'bun'`: шукає у `entries` запис із `importName.name === 'SQL'`. Повертає `{ module: 'bun', specifier: 'SQL' }`. Інакше — `null`.
     - `'mssql'`: будь-який імпорт з цього модуля вважається порушенням; повертає `{ module: 'mssql', specifier: '*' }`. Тут `'*'` означає «будь-який специфікатор / default-імпорт», що відповідає JSDoc `import sql from 'mssql'` або інших форм.
     - `'@nitra/graphql-request'`: шукає `entries` із `importName.name === 'GraphQLClient'`. Повертає `{ module, specifier: 'GraphQLClient' }`. Інакше — `null`.
     - Інші модулі — `null`.
- **Side effects:** немає (pure).

### `findConnFactoryImportsInText(content, virtualPath?)` (експорт)

- **Сигнатура:** `function findConnFactoryImportsInText(content: string, virtualPath?: string): { line: number, snippet: string, module: string, specifier: string }[]`
- **Параметри:**
  - `content` — вихідний код файлу;
  - `virtualPath` — необов'язковий «віртуальний» шлях (наприклад `'pkg/src/index.ts'`), потрібен лише для визначення `lang` (мови парсера). Дефолт — `'scan.ts'`.
- **Повертає:** масив порушень. Кожен елемент:
  - `line` — номер рядка з 1-based (через `offsetToLine`);
  - `snippet` — нормалізований уривок коду імпорту (через `normalizeSnippet`);
  - `module` — назва модуля (`'bun'` | `'mssql'` | `'@nitra/graphql-request'`);
  - `specifier` — `'SQL'` | `'*'` | `'GraphQLClient'`.
- **Алгоритм:**
  1. Визначає `lang` через `langFromPath(virtualPath || 'scan.ts')`.
  2. Викликає `parseSync(virtualPath || 'scan.ts', content, { lang, sourceType: 'module' })`.
  3. Якщо парсер кинув виняток — повертає `[]` (silently).
  4. Якщо `result.errors` непорожній — теж повертає `[]` (некоректний синтаксис не сканується).
  5. Ітерує `result.module?.staticImports ?? []`. Для кожного — `classifyConnImport`; якщо повернув `null`, пропускає.
  6. Для збігу формує запис із `line` (через `offsetToLine(content, imp.start)`) і `snippet` (через `normalizeSnippet(content.slice(imp.start, imp.end))`).
- **Side effects:** немає; функція повністю pure щодо аргументів, але внутрішньо викликає `parseSync`, що може кидати.

### `isConnImportsScanSourceFile(relativePathPosix)` (експорт)

- **Сигнатура:** `function isConnImportsScanSourceFile(relativePathPosix: string): boolean`
- **Параметри:** `relativePathPosix` — відносний posix-шлях.
- **Повертає:** `true`, якщо файл має JS/TS-розширення (за `SOURCE_FILE_RE`) **і** не закінчується на `.d.ts` (декларації типів виключені).
- **Side effects:** немає (pure).

## Залежності

### Зовнішні (npm)

- **`oxc-parser`** — швидкий парсер JS/TS, з якого використовується іменований експорт `parseSync(filename, source, options)`. У результаті очікується структура з полем `module.staticImports` (масив static-імпортів з полями `moduleRequest.value`, `entries[].importName.name`, `start`, `end`) та полем `errors` (синтаксичні помилки парсера).

### Внутрішні (відносні)

- **`../../../scripts/utils/ast-scan-utils.mjs`** — спільні утиліти для AST-сканерів:
  - `langFromPath(path)` — визначає мову парсера за розширенням (`'js'` | `'ts'` тощо).
  - `normalizeSnippet(text)` — нормалізує сирий уривок коду для звітів (тримінг, прибирання зайвих пробілів/перенесень).
  - `offsetToLine(content, offset)` — конвертує байтовий/символьний offset у номер рядка (зазвичай 1-based).

### Стандартна бібліотека / runtime

- Тільки рядкові методи (`String`, `replaceAll`, `slice`, `startsWith`, `endsWith`, `trim`, `codePointAt`) і `Array.isArray`. Жодного `fs`, `path`, `process`.

## Потік виконання / Використання

Модуль — це «бібліотека» для check-скрипта правила «Внутрішні аліаси» (зазвичай викликається з `check-<id>.mjs` в `npm/rules/js-run/`). Типовий сценарій використання:

1. **Резолв конфігурації пакета.** Викликач читає `package.json` пакета, парсить JSON і передає об'єкт у `resolveConnDirFromPackageJson(pkgJson)` → отримує рядок `connDir`, наприклад `'src/conn'`.
2. **Фільтр кандидатів.** Для кожного файлу пакета викликач отримує відносний posix-шлях `relPath` і пропускає через два фільтри:
   - `isConnImportsScanSourceFile(relPath)` — лише JS/TS-розширення, без `.d.ts`;
   - `!isInsideConnDir(relPath, connDir)` — файл **не** в каталозі `conn`. Файли в `conn` дозволено мати такі імпорти — це їх роль.
3. **AST-скан.** Для кандидатів читає вміст файлу і викликає `findConnFactoryImportsInText(content, relPath)`. Передача `relPath` як `virtualPath` важлива, щоб `langFromPath` правильно обрав `ts`/`tsx`/`js`.
4. **Звіт про порушення.** Кожен елемент результату — це окреме порушення з:
   - номером рядка для вказівки в логах/PR-коментарях;
   - snippet-уривком (для контексту);
   - модулем і специфікатором (для людиночитного формулювання правила, наприклад: «`bun:SQL` має жити в `#conn/*`»).

### Поведінка у крайових випадках

- **Файл із синтаксичною помилкою** — повертається порожній масив. Сканер не намагається відновлюватися; правило вимагає спершу полагодити синтаксис, інакше будь-який AST-аналіз ненадійний.
- **Файл без імпортів** — порожній масив (`staticImports` буде або порожнім, або відсутнім; `?? []` дбає про обидва випадки).
- **`package.json` без `imports['#conn/*']`** — повертається дефолт `'src/conn'`.
- **`package.json` із умовним експортом** — береться `default`, fallback на `import`. Інші ключі (`require`, `node`, тощо) ігноруються — політика правила орієнтована на ESM.
- **Хвостові слеші / `./`-префікс / windows-слеші** в шляху `imports` — нормалізуються в posix без хвостового `/`.
- **Інші модулі** (наприклад `pg`, `mysql2`, `mongodb`) — **не** ловляться цим сканером. Список цільових модулів навмисно вузький: `bun`/`SQL`, `mssql`, `@nitra/graphql-request`/`GraphQLClient`. Розширення списку — окрема зміна правила.
- **Default-імпорт з `bun` чи `@nitra/graphql-request`** — не вважається порушенням, бо умова перевіряє named-специфікатор. А для `mssql` ловиться будь-яка форма імпорту.

### Зв'язок із правилом `js-run.mdc`

Цей файл — частина пакета `npm/rules/js-run/`, який імплементує правило «Внутрішні аліаси». Документ правила (`.mdc`) задає **що** заборонено (підключення до БД/GraphQL поза `src/conn`), а цей модуль — **як** це виявити статично через AST. Назви функцій (`isConnImportsScanSourceFile`, `findConnFactoryImportsInText`) узгоджені з конвенцією наіменування check-скриптів у `n-cursor`.

## Rebuild Test

Цей розділ описує, як перевірити, що документація відповідає коду. Якщо реалізація зміниться — оновити документ так, щоб виконувалися всі пункти нижче.

1. **Експорти.** Модуль експортує рівно 4 функції: `resolveConnDirFromPackageJson`, `isInsideConnDir`, `findConnFactoryImportsInText`, `isConnImportsScanSourceFile`. Жодних default-експортів.
2. **Дефолтний conn-каталог.** Для `null`, `{}`, `{ imports: {} }`, `{ imports: { '#conn/*': 42 } }` функція `resolveConnDirFromPackageJson` повертає `'src/conn'`.
3. **Парсинг conn-каталогу зі string-target.** Для `{ imports: { '#conn/*': './src/conn/*' } }` повертається `'src/conn'`; хвіст `/*` і префікс `./` зрізаються.
4. **Парсинг conn-каталогу з умовним експортом.** Для `{ imports: { '#conn/*': { default: 'lib/db/*' } } }` повертається `'lib/db'`. Якщо `default` відсутній, але є `import` — береться `import`.
5. **`isInsideConnDir`.** `('src/conn', 'src/conn')` → `true`; `('src/conn/db.ts', 'src/conn')` → `true`; `('src/conn-other/x.ts', 'src/conn')` → `false`; `('x', '')` → `false`.
6. **Фільтр розширень.** `isConnImportsScanSourceFile`:
   - `'a.js'`, `'a.mjs'`, `'a.cjs'`, `'a.ts'`, `'a.mts'`, `'a.cts'`, `'a.jsx'`, `'a.tsx'` → `true`;
   - `'a.d.ts'` → `false`;
   - `'a.json'`, `'a.vue'`, `'a.md'`, `'README'` → `false`.
7. **AST-скан `bun`.** Текст `import { SQL } from 'bun'` дає одну знахідку з `module: 'bun'`, `specifier: 'SQL'`, `line: 1`.
8. **AST-скан `bun` без `SQL`.** Текст `import { serve } from 'bun'` дає порожній масив.
9. **AST-скан `mssql`.** Будь-яка форма (`import sql from 'mssql'`, `import * as mssql from 'mssql'`, `import 'mssql'`) дає одну знахідку з `module: 'mssql'`, `specifier: '*'`.
10. **AST-скан `@nitra/graphql-request`.** `import { GraphQLClient } from '@nitra/graphql-request'` дає знахідку з `specifier: 'GraphQLClient'`; інші named-імпорти з цього модуля — порожній результат.
11. **Синтаксична помилка.** Невалідний JS/TS (наприклад `import {{`) повертає порожній масив — без винятків назовні.
12. **`virtualPath` впливає лише на `lang`.** Виклик із `'x.ts'` парсить як TypeScript; з `'x.js'` — як JavaScript; з `'x.tsx'` — як TSX. Уривок коду в `snippet` — нормалізований через `normalizeSnippet`.
13. **Read-only.** Жодних викликів `fs`, `path`, `process`, мережі. Усі функції pure щодо своїх аргументів (єдиний нечистий аспект — `parseSync` усередині `findConnFactoryImportsInText`, який ловиться `try/catch`).
