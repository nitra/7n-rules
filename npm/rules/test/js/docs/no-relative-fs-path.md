# no-relative-fs-path.mjs

## Огляд

Модуль реалізує AST-based перевірку, яка забороняє передавати **relative-path**
аргументи у функції модулів `node:fs` / `node:fs/promises` (а також у тестові
helper-функції, що вимагають абсолютних шляхів) усередині JS-тестів
(`*.test.mjs` / `*.test.js`).

Мотивація задокументована у самому файлі та у правилі `test.mdc`, секція
«Заборона `process.chdir` у тестах»: після видалення хелпера `withTmpCwd` усі
тести отримують `dir` параметром і повинні будувати **абсолютні** шляхи через
`join(dir, …)`. Якщо хтось забуде префікс і напише, наприклад,
`writeFile('foo.json', …)` або `copyFile(src, 'foo.json')`, relative-path
зарезолвиться у `process.cwd()` (= `npm/`), що призведе до запису тестової
фікстури у production tree. Реальний інцидент v1.28.0
(`tests/check-rule-fixtures.test.mjs` із викликами
`copyFile(src, 'values-dev.ini')` та
`copyFile(src, 'default.conf.template')`) створив файли `npm/values-dev.ini` і
`npm/default.conf.template` поза `dir`.

Сканер парсить кожен тестовий файл через `oxc-parser` (через утиліту
`parseProgramOrNull`), обходить AST і шукає `CallExpression`, де callee
збігається з відомою FS-функцією, а path-аргумент є **string literal** (або
template literal без виразів), що НЕ починається з:

- `/`, `\\` — POSIX/Windows absolute;
- `file:`, `http:`, `https:`, `data:` — URL-схема (для `new URL(...)`);
- Windows drive letter `C:\…` або `C:/…`;
- та НЕ є template literal зі вставленим виразом `${…}` (такі вважаються
  обчисленими через `join`/`resolve` і пропускаються).

Виклики, у яких path-аргумент НЕ literal (наприклад, `join(...)`,
`BinaryExpression`, `Identifier`, `MemberExpression`), пропускаються —
припускається, що це абсолютний шлях.

Перевіряються лише файли, що відповідають `**/*.test.{js,mjs}`. Обхід дерева
використовує загальний `walkDir` з його скіп-правилами та користувацькими
`ignore`-шляхами з `.n-cursor.json`.

## Експорти / API

| Експорт            | Тип              | Призначення                                                                                                      |
| ------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `check(cwdParam?)` | `async function` | Точка входу перевірки. Сканує `*.test.{mjs,js}` під `cwd`, повертає exit code `0` (чисто) або `1` (є порушення). |

Усі решта функцій (`extractRelativeLiteralPath`, `isRelativeString`,
`extractFsFunctionName`, `isTestFile`, `findOffendersInBody`,
`computeLineOffsets`, `offsetToLineFromCache`) та константи
(`FS_PATH_ARG_POSITIONS`, `ABSOLUTE_PREFIXES`) — module-private, не
експортуються.

## Функції

### `extractRelativeLiteralPath(arg)`

- **Сигнатура:** `(arg: object) => string | null`
- **Параметри:**
  - `arg` — AST node аргументу виклику (Literal, TemplateLiteral тощо) або
    `undefined`.
- **Повертає:** значення relative-path (рядок) — якщо аргумент є
  string-літералом або template literal без виразів і його значення є
  відносним; `null` — якщо аргумент відсутній, обчислюваний або абсолютний.
- **Логіка:**
  - `arg.type === 'Literal' && typeof arg.value === 'string'` →
    `isRelativeString(arg.value) ? arg.value : null`.
  - `arg.type === 'TemplateLiteral' && expressions.length === 0` →
    конкатенує `quasis[i].value.cooked` і так само перевіряє через
    `isRelativeString`.
  - Будь-який інший вузол → `null` (не аналізується).
- **Side effects:** немає.

### `isRelativeString(s)`

- **Сигнатура:** `(s: string) => boolean`
- **Параметри:** `s` — рядок-шлях.
- **Повертає:** `true` — якщо рядок виглядає як relative path; `false` — якщо
  абсолютний, URL, Windows-drive-letter або порожній.
- **Логіка:**
  - Порожній рядок → `false` (не path).
  - Якщо починається з будь-якого з `ABSOLUTE_PREFIXES`
    (`/`, `\\`, `file:`, `http:`, `https:`, `data:`) → `false`.
  - Якщо відповідає `^[A-Za-z]:[\\/]/u` (наприклад, `C:\foo`, `C:/foo`) →
    `false`.
  - Інакше → `true`.
- **Side effects:** немає.

### `extractFsFunctionName(callee)`

- **Сигнатура:** `(callee: object) => string | null`
- **Параметри:** `callee` — AST callee node (Identifier або MemberExpression).
- **Повертає:** ім'я FS-функції з `FS_PATH_ARG_POSITIONS`, якщо callee
  розпізнано; інакше `null`.
- **Логіка:**
  - `Identifier` → перевіряє `callee.name` у `FS_PATH_ARG_POSITIONS`.
  - `MemberExpression`, не `computed`, `property.type === 'Identifier'` →
    бере `callee.property.name` (це покриває `fs.writeFile`, `fsp.writeFile`,
    `fs.promises.writeFile` тощо) і перевіряє у мапі.
  - Інакше → `null`.
- **Side effects:** немає.

### `isTestFile(absPath)`

- **Сигнатура:** `(absPath: string) => boolean`
- **Параметри:** `absPath` — абсолютний шлях файлу.
- **Повертає:** `true`, якщо `basename(absPath)` закінчується на
  `.test.mjs` або `.test.js`; інакше `false`.
- **Side effects:** немає.

### `findOffendersInBody(body)`

- **Сигнатура:**
  `(body: string) => Array<{ line: number, fn: string, path: string, argPos: number }>`
- **Параметри:** `body` — вміст тестового файлу (UTF-8).
- **Повертає:** масив порушень: `{ line, fn, path, argPos }`, де:
  - `line` — 1-індексований рядок початку аргументу (або виклику, якщо у
    аргументу немає `.start`);
  - `fn` — ім'я FS-функції;
  - `path` — фактичне значення relative-літералу;
  - `argPos` — 0-індексована позиція проблемного аргументу.
- **Логіка:**
  1. `parseProgramOrNull(body, 'test.mjs')` — парс через oxc-parser із
     використанням віртуального імені; якщо парс не вдався, повертає `[]`.
  2. Кешує newline-offsets через `computeLineOffsets`.
  3. `walkAstWithAncestors(program, [], cb)` — обходить усі вузли.
     Для кожного `CallExpression`:
     - визначає `fnName = extractFsFunctionName(node.callee)`; якщо `null` —
       пропускає;
     - для кожної позиції з `FS_PATH_ARG_POSITIONS.get(fnName)` бере
       `node.arguments[pos]`, перевіряє через `extractRelativeLiteralPath`;
     - якщо `relPath !== null` — обчислює `line` через
       `offsetToLineFromCache(lineOffsets, arg?.start ?? node.start ?? 0)` і
       додає об'єкт у `offenders`.
- **Side effects:** немає. Парсинг через `parseProgramOrNull` сам по собі
  чистий.

### `computeLineOffsets(body)`

- **Сигнатура:** `(body: string) => number[]`
- **Параметри:** `body` — джерельний рядок.
- **Повертає:** масив 0-індексованих offset-ів початків рядків
  (елемент `0` — позиція `0`, далі позиція кожного символу після `\n`).
- **Логіка:** лінійний прохід по символах; на кожному `\n` додає `pos + 1`.
- **Side effects:** немає.

### `offsetToLineFromCache(offsets, offset)`

- **Сигнатура:** `(offsets: number[], offset: number) => number`
- **Параметри:**
  - `offsets` — кеш із `computeLineOffsets`;
  - `offset` — 0-індекс символу у source.
- **Повертає:** 1-індексований номер рядка, що містить цей offset.
- **Логіка:** бінарний пошук правого діапазону (`lo`/`hi` із кроком
  `mid = floor((lo + hi + 1) / 2)`); кінцевий `lo + 1` — номер рядка.
- **Side effects:** немає.

### `check(cwdParam = process.cwd())`

- **Сигнатура:** `async (cwdParam?: string) => Promise<number>`
- **Параметри:** `cwdParam` — корінь репозиторію (за замовчуванням
  `process.cwd()`).
- **Повертає:** `0` — порушень немає; `1` — є хоча б одне порушення
  (через `reporter.getExitCode()`).
- **Логіка:**
  1. Створює репортер: `createCheckReporter()`, дістає `pass` і `fail`.
  2. Завантажує користувацькі ignore-шляхи через `loadCursorIgnorePaths(cwd)`
     (читає `.n-cursor.json#ignore`).
  3. Через `walkDir(cwd, cb, ignorePaths)` збирає у масив `testFiles` усі
     `absPath`, для яких `isTestFile(absPath) === true`.
  4. Для кожного тестового файлу: читає через
     `readFile(absPath, 'utf8')`, запускає `findOffendersInBody(body)`, до
     кожного знахідки додає `file: relative(cwd, absPath)`.
  5. Якщо `offenders.length === 0` — викликає
     `pass(\`Жоден з ${testFiles.length} тестових файлів не передає relative-path у FS-функції (test.mdc)\`)`і повертає`reporter.getExitCode()`.
  6. Інакше — для кожного порушення викликає `fail(...)` із повідомленням
     виду `${file}:${line}: ${fn}() — ${which} '${path}' relative; використовуй join(dir, …) (test.mdc, no-relative-fs-path)`,
     де `which` = `'1-й аргумент'` для `argPos === 0` і
     `'${argPos + 1}-й аргумент'` для решти.
- **Side effects:**
  - Читає файли з диска (через `readFile` та `walkDir`).
  - Пише у stdout/stderr через репортер (`pass`/`fail`).
  - Не змінює файли.

## Константи

### `FS_PATH_ARG_POSITIONS`

`Map<string, number[]>` — імена FS-функцій → масив 0-індексованих позицій
path-аргументів. Включає:

- з одним path-аргументом (`[0]`): `writeFile`, `writeFileSync`, `readFile`,
  `readFileSync`, `appendFile`, `appendFileSync`, `mkdir`, `mkdirSync`,
  `rmdir`, `rmdirSync`, `rm`, `rmSync`, `unlink`, `unlinkSync`, `access`,
  `accessSync`, `stat`, `statSync`, `lstat`, `lstatSync`, `chmod`,
  `chmodSync`, `chown`, `chownSync`, `truncate`, `truncateSync`,
  `existsSync`, `readdir`, `readdirSync`;
- з двома path-аргументами (`[0, 1]`): `copyFile`, `copyFileSync`, `rename`,
  `renameSync`, `symlink`, `symlinkSync`, `link`, `linkSync`, `cp`, `cpSync`;
- тестові-хелпери (зайвий захист, тільки 1-й): `writeJson`, `ensureDir`.

### `ABSOLUTE_PREFIXES`

`string[]` зі значенням `['/', '\\', 'file:', 'http:', 'https:', 'data:']` —
префікси, які вважаються «явно абсолютним або URL-шляхом» і виключають
рядок зі списку relative-path.

## Залежності

Зовнішні / стандартні модулі:

- `node:fs/promises` → `readFile` — читання тестових файлів.
- `node:path` → `basename`, `relative` — визначення імені файлу та шляху
  відносно `cwd` для повідомлень.

Внутрішні модулі (відносні шляхи у репозиторії):

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — стандартний
  репортер перевірок (методи `pass`, `fail`, `getExitCode`).
- `../../../scripts/lib/load-cursor-config.mjs` → `loadCursorIgnorePaths` —
  читає `.n-cursor.json#ignore` для виключення шляхів.
- `../../../scripts/utils/ast-scan-utils.mjs` → `parseProgramOrNull`,
  `walkAstWithAncestors` — обгортка над oxc-parser і AST-обхід з
  трекінгом ancestors (тут ancestors не використовуються — `[]`).
- `../../../scripts/utils/walkDir.mjs` → `walkDir` — рекурсивний обхід
  директорії із загальними skip-правилами та підтримкою `ignorePaths`.

## Потік виконання / Використання

Файл реалізує одну з перевірок з папки `npm/rules/test/js/`, що
викликається через загальний механізм запуску правил (зазвичай
`bun n-cursor rules` або еквівалентну команду). Загальний потік виклику
`check(cwd)`:

1. Створення `reporter` через `createCheckReporter()`.
2. Завантаження `ignorePaths` з `.n-cursor.json`.
3. `walkDir(cwd, ..., ignorePaths)` рекурсивно проходить дерево;
   collector-callback відбирає лише файли, що задовольняють `isTestFile`.
4. Для кожного тестового файлу:
   - читається вміст;
   - `parseProgramOrNull` намагається спарсити; при невдачі файл
     мовчазно пропускається (`return []`);
   - `walkAstWithAncestors` обходить AST і кожен `CallExpression`
     перевіряється проти `FS_PATH_ARG_POSITIONS`;
   - кожен виявлений relative-path-літерал перетворюється на запис
     `offender` з `file`/`line`/`fn`/`path`/`argPos`.
5. Якщо порушень немає — викликається `pass(...)` і
   повертається `reporter.getExitCode()` (зазвичай `0`).
6. Якщо є — кожне порушення емітиться через `fail(...)` із заздалегідь
   сформатованим повідомленням; підсумковий exit code — `1`.

Типове використання — як check-функція у конвеєрі правил `test.mdc`
(адже повідомлення містять згадку `(test.mdc, no-relative-fs-path)`),
де `cwd` — корінь монорепо. Файл є частиною підкаталогу
`npm/rules/test/js/` (правила, що відповідають `test.mdc`).

Edge-cases:

- Невалідний JS → `parseProgramOrNull` повертає `null` → файл пропускається
  без помилки.
- Шлях обчислюється через `join`/`resolve` → пропускається (припускається
  абсолютний).
- Template literal зі вставленим виразом (`expressions.length > 0`) →
  пропускається.
- `existsSync` та інші sync-варіанти аналізуються нарівні з async.
- Виклики через `fs.promises.X` — обробляються коректно, бо
  `extractFsFunctionName` бере `callee.property.name` і не залежить від
  глибини доступу.

Інтеграція з CI: повертає ненульовий код у разі порушень → провалює
відповідний крок CI; формат повідомлень містить `file:line: …`, що
розпізнають IDE/CI-інтерфейси.
