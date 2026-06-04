# deps.mjs — перевірка правила js-mssql.mdc

## Огляд

Модуль `npm/rules/js-mssql/js/deps.mjs` — це автоматичний `check`-скрипт для правила `js-mssql.mdc`. Він виконує дві логічно різні перевірки на корені репозиторію:

1. **Версійний аудит** усіх `package.json` (у тому числі workspace-пакетів): якщо в секції `dependencies` присутній пакет `mssql`, його semver-діапазон має давати ефективну версію не нижче `12.5.0`.
2. **Статичний аналіз вихідного коду** (JS/TS) на безпечне використання драйвера `mssql`:
   - заборона створення `new sql.ConnectionPool(...)` всередині функцій (пул має бути singleton на рівні модуля);
   - заборона спільного (shared) `Request`, наприклад `export const request = pool.request()`;
   - заборона викликів `query(\`...\`)` як звичайної функції — потрібен tagged template `query\`...\``;
   - заборона динамічних SQL-списків через `.join(',')` у конструкціях `IN (...)` / `VALUES (...)` (треба TVP, `sql.Table`);
   - вимога числового парсингу значень у `IN (${...})` (`parseInt` / `Number` / `BigInt` / `parseFloat` + фільтр від `NaN`);
   - вимога винести значення для `IN (${...})` в окрему змінну і додати guard на пустоту з `throw`.

Скрипт використовує спільну інфраструктуру репорту (`createCheckReporter`) і повертає числовий exit code, придатний для CI. Усі повідомлення префіксовані `js-mssql:` для зручної фільтрації.

Файл є ESM-модулем (`.mjs`), без top-level side effects: експортується лише асинхронна функція `check()`, яка ініціює виконання.

## Експорти / API

| Символ | Тип | Призначення |
| --- | --- | --- |
| `check` | `async function(): Promise<number>` | Єдиний публічний експорт. Виконує повну перевірку правила `js-mssql.mdc` у поточному `process.cwd()` і повертає `0` (OK) або `1` (є порушення). |

Інші функції в модулі (`findAllSourcePathsForMssqlScan`, `asObject`, `getMssqlDependencyRange`, `parseLeadingSemver`, `semverGte`, `auditMssqlVersionInPackageJson`, `aggregateMssqlVersionsAcrossPackages`, `scanMssqlOneSourceFile`, `reportZeroMssqlSourceViolations`, `auditMssqlSources`) є **внутрішніми** — не експортуються і призначені лише для декомпозиції логіки `check()`.

### Константи

| Константа | Значення | Опис |
| --- | --- | --- |
| `VERSION_PREFIX_RE` | `/^[\^~>=<]+\s*/u` | Регулярка для відрізання префіксів semver-діапазону (`^`, `~`, `>`, `=`, `<` та комбінацій) перед парсингом. |
| `SEMVER_RE` | `/^(\d+)\.(\d+)\.(\d+)/u` | Регулярка для захоплення першої semver-трійки `major.minor.patch` після очищення префіксу. |
| `MIN_MSSQL_VERSION` | `{ major: 12, minor: 5, patch: 0 }` | Мінімально дозволена версія `mssql`, як її задає правило `js-mssql.mdc`. |

## Функції

### `findAllSourcePathsForMssqlScan(repoRoot, ignorePaths)`

Внутрішня. Збирає абсолютні шляхи всіх JS/TS-файлів-кандидатів для скану `mssql`.

- **Сигнатура:** `async function findAllSourcePathsForMssqlScan(repoRoot: string, ignorePaths: string[]): Promise<string[]>`
- **Параметри:**
  - `repoRoot` — абсолютний шлях до кореня репозиторію;
  - `ignorePaths` — масив абсолютних шляхів каталогів, які повністю виключаються з обходу (зчитується з `.cursorignore`).
- **Повертає:** масив абсолютних шляхів файлів, відсортований за відносним шляхом (`localeCompare`), щоб порядок звітів був детермінованим.
- **Side effects:** читає файлову систему через `walkDir`; нормалізує windows-роздільники `\` у POSIX `/` перед перевіркою `isMssqlScanSourceFile`.

### `asObject(v)`

Внутрішня. Безпечне приведення невідомого значення до plain-object.

- **Сигнатура:** `function asObject(v: unknown): Record<string, unknown>`
- **Логіка:** повертає `{}`, якщо `v` falsy, не `object`, або масив; інакше повертає сам `v` як `Record<string, unknown>` (через JSDoc-cast).
- **Side effects:** немає.

### `getMssqlDependencyRange(deps)`

Внутрішня. Витягає рядок версії `dependencies.mssql`.

- **Сигнатура:** `function getMssqlDependencyRange(deps: unknown): string | null`
- **Параметри:** `deps` — значення поля `dependencies` з `package.json` (може бути будь-чим).
- **Повертає:** триманий (`trim`) рядок версії, або `null`, якщо ключ відсутній / значення не є непорожнім рядком.
- **Side effects:** немає.

### `parseLeadingSemver(range)`

Внутрішня. Парсить першу semver-трійку з діапазону виду `"^12.5.0"`, `">=12.5.0"`, `"12.5.0"`.

- **Сигнатура:** `function parseLeadingSemver(range: string): { major: number, minor: number, patch: number } | null`
- **Параметри:** `range` — версійний діапазон у синтаксисі npm.
- **Повертає:** об'єкт `{ major, minor, patch }` або `null`, якщо не вдалось розпарсити (або будь-який компонент — `NaN`).
- **Алгоритм:**
  1. `String(range).trim()` → видалення префіксів через `VERSION_PREFIX_RE`;
  2. `match(SEMVER_RE)` → захоплення трьох чисел;
  3. конвертація через `Number`, перевірка `Number.isNaN`.
- **Side effects:** немає.

### `semverGte(a, b)`

Внутрішня. Порівняння semver "більше або дорівнює".

- **Сигнатура:** `function semverGte(a: SemverObj, b: SemverObj): boolean`
- **Параметри:** обидві трійки `{ major, minor, patch }`.
- **Повертає:** `true`, якщо `a >= b` за лексикографічним порядком `(major, minor, patch)`.
- **Side effects:** немає.

### `auditMssqlVersionInPackageJson(rel, parsed, pass, fail)`

Внутрішня. Аудит одного `package.json` на `dependencies.mssql`.

- **Сигнатура:** `function auditMssqlVersionInPackageJson(rel: string, parsed: unknown, pass: (msg: string) => void, fail: (msg: string) => void): { found: 0 | 1, bad: 0 | 1 }`
- **Параметри:**
  - `rel` — людино-читабельний шлях (відносний, з `/` як роздільник);
  - `parsed` — розпарсений JSON `package.json`;
  - `pass`, `fail` — колбеки звіту з `createCheckReporter`.
- **Повертає:** інкремент лічильників:
  - `found` — `1`, якщо в `dependencies` знайдено ключ `mssql`, інакше `0`;
  - `bad` — `1`, якщо знайдено, але версія нечитабельна або менша за `MIN_MSSQL_VERSION`.
- **Side effects:** виклики `pass(...)` / `fail(...)` з конкретними повідомленнями (формат `js-mssql: <rel>: ... (js-mssql.mdc)`).

### `aggregateMssqlVersionsAcrossPackages(repoRoot, pkgJsonPaths, pass, fail)`

Внутрішня. Прогін усіх `package.json` із підсумками.

- **Сигнатура:** `async function aggregateMssqlVersionsAcrossPackages(repoRoot: string, pkgJsonPaths: string[], pass: (msg: string) => void, fail: (msg: string) => void): Promise<{ found: number, bad: number }>`
- **Параметри:**
  - `repoRoot` — корінь репозиторію;
  - `pkgJsonPaths` — абсолютні шляхи до всіх знайдених `package.json`.
- **Повертає:** сукупні лічильники `{ found, bad }` по всіх файлах.
- **Side effects:**
  - читає кожен `package.json` через `readFile`;
  - якщо файл — невалідний JSON, викликає `fail('js-mssql: <rel> — невалідний JSON')` і пропускає його (`continue`);
  - акумулює інкременти з `auditMssqlVersionInPackageJson`.

### `scanMssqlOneSourceFile(rel, content, counters, fail)`

Внутрішня. Прогін **одного** JS/TS-файлу через шість сканерів з `../lib/mssql-pool-scan.mjs`.

- **Сигнатура:** `function scanMssqlOneSourceFile(rel: string, content: string, counters: Record<string, number>, fail: (msg: string) => void): void`
- **Параметри:**
  - `rel` — relative-шлях файлу (для повідомлень);
  - `content` — повний вихідний код файлу;
  - `counters` — мутабельний агрегатор лічильників (див. нижче);
  - `fail` — колбек звіту про порушення.
- **Лічильники в `counters` (інкрементуються по одному за порушення):**
  - `violations` — `new sql.ConnectionPool(...)` всередині функції;
  - `sharedRequestViolations` — shared `Request` (наприклад `export const request = pool.request()`);
  - `unsafeQueryCalls` — `query(\`...\`)` як виклик функції замість tagged template;
  - `unsafeDynamicSqlLists` — динамічні SQL-списки через `.join(',')` у `IN/VALUES`;
  - `unparsedInLists` — `IN (${...})` без числового парсера значень;
  - `inListGuardViolations` — відсутній або неправильно розташований guard на пустоту IN-списку (розгалуження за `v.reason === 'missing_guard'` дає різні тексти повідомлень).
- **Side effects:** виклики `fail(...)` з конкретним `:line` та `snippet` для кожного знайденого порушення; мутує `counters`.

### `reportZeroMssqlSourceViolations(counters, pass)`

Внутрішня. Для кожного лічильника, що залишився `0`, дає один `pass`-рядок.

- **Сигнатура:** `function reportZeroMssqlSourceViolations(counters: Record<string, number>, pass: (msg: string) => void): void`
- **Семантика:** перетворює "відсутність порушень" на явні позитивні рядки звіту — щоб у вихідному логу було видно, які саме інваріанти виконано (а не лише сумарний `OK`).
- **Side effects:** виклики `pass(...)` (від 0 до 6, залежно від лічильників).

### `auditMssqlSources(repoRoot, ignorePaths, pass, fail)`

Внутрішня. Повний аудит усіх JS/TS-джерел репо щодо безпечного використання `mssql`.

- **Сигнатура:** `async function auditMssqlSources(repoRoot: string, ignorePaths: string[], pass: (msg: string) => void, fail: (msg: string) => void): Promise<void>`
- **Алгоритм:**
  1. збирає список файлів через `findAllSourcePathsForMssqlScan`;
  2. якщо файлів немає — один `pass`-рядок `'js-mssql: немає JS/TS файлів для скану singleton ConnectionPool'` і `return`;
  3. ініціалізує `counters` нулями (`violations`, `sharedRequestViolations`, `unsafeQueryCalls`, `unsafeDynamicSqlLists`, `unparsedInLists`, `inListGuardViolations`);
  4. послідовно читає кожен файл через `readFile(absPath, 'utf8')`, нормалізує `rel` і викликає `scanMssqlOneSourceFile`;
  5. в кінці викликає `reportZeroMssqlSourceViolations(counters, pass)`.
- **Side effects:** I/O (читання файлів); виклики `pass` / `fail`.

### `check()` *(export)*

Публічна. Виконує повну перевірку правила.

- **Сигнатура:** `export async function check(): Promise<number>`
- **Параметри:** немає (працює відносно `process.cwd()`).
- **Повертає:** `number` — exit code від `reporter.getExitCode()` (`0` — OK, `1` — є проблеми).
- **Алгоритм:**
  1. створює репортер: `createCheckReporter()` → деструктурує `{ pass, fail }`;
  2. `repoRoot = process.cwd()`;
  3. **early-return**: якщо в корені немає `package.json` (`existsSync`), записує `pass('js-mssql: package.json у корені відсутній — перевірку пропущено')` і повертає поточний exit code;
  4. зчитує `ignorePaths` через `loadCursorIgnorePaths(repoRoot)`;
  5. збирає всі `package.json` у репозиторії через `findAllPackageJsonPaths(repoRoot, ignorePaths)`;
  6. **early-return**: якщо `package.json` не знайдено зовсім — `pass('js-mssql: package.json не знайдено — перевірку пропущено')` + повернення exit code;
  7. виконує `aggregateMssqlVersionsAcrossPackages(...)` → `{ found, bad }`;
  8. **early-return**: якщо `found === 0`, `pass('js-mssql: пакет mssql не знайдено в dependencies жодного package.json')` + повернення exit code (статичний аналіз не запускається, бо `mssql` у проєкті не використовується);
  9. якщо `bad === 0` — `pass('js-mssql: всі знайдені dependencies.mssql відповідають мінімальній версії 12.5.0 (<found>)')`;
  10. виконує `auditMssqlSources(repoRoot, ignorePaths, pass, fail)`;
  11. повертає `reporter.getExitCode()`.
- **Side effects:** I/O (читання FS), звітування через `pass`/`fail` репортера.

## Залежності

### Стандартні модулі Node.js

| Імпорт | Звідки | Використання |
| --- | --- | --- |
| `existsSync` | `node:fs` | Перевірка наявності `package.json` у корені (швидкий синхронний guard). |
| `readFile` | `node:fs/promises` | Асинхронне читання `package.json` та джерельних файлів у UTF-8. |
| `join`, `relative` | `node:path` | Побудова шляху до `package.json` та нормалізація відносних шляхів для повідомлень. |

### Внутрішні модулі репозиторію

| Імпорт | Звідки | Призначення |
| --- | --- | --- |
| `createCheckReporter` | `../../../scripts/lib/check-reporter.mjs` | Уніфікований репортер для всіх `check`-скриптів: накопичує `pass`/`fail` рядки і формує exit code. |
| `findAllPackageJsonPaths` | `../../../scripts/utils/find-package-json-paths.mjs` | Рекурсивний пошук усіх `package.json` (моно-репо/workspaces) з урахуванням ignore-шляхів. |
| `findMssqlPerRequestConnectionInText` | `../lib/mssql-pool-scan.mjs` | Пошук `new sql.ConnectionPool(...)` всередині функцій. |
| `findSharedMssqlRequestInText` | `../lib/mssql-pool-scan.mjs` | Пошук shared `Request` (наприклад `export const request = pool.request()`). |
| `findUnsafeMssqlQueryTemplateCallInText` | `../lib/mssql-pool-scan.mjs` | Пошук `query(\`...\`)` як звичайного виклику замість tagged template. |
| `findUnsafeMssqlDynamicSqlListInText` | `../lib/mssql-pool-scan.mjs` | Пошук динамічних SQL-списків через `.join(',')` у `IN/VALUES`. |
| `findUnsafeMssqlInListUnparsedInText` | `../lib/mssql-pool-scan.mjs` | Пошук `IN (${...})` без числового парсингу значень. |
| `findUnsafeMssqlInListMissingEmptyGuardInText` | `../lib/mssql-pool-scan.mjs` | Пошук IN-списків без guard'у на пустоту з `throw`. |
| `isMssqlScanSourceFile` | `../lib/mssql-pool-scan.mjs` | Фільтр-предикат: чи треба сканувати файл за його relative-шляхом. |
| `loadCursorIgnorePaths` | `../../../scripts/lib/load-cursor-config.mjs` | Завантаження `.cursorignore` → масив абсолютних ignore-шляхів. |
| `walkDir` | `../../../scripts/utils/walkDir.mjs` | Рекурсивний обхід файлової системи з callback на кожен файл і ignore-каталогами. |

### Очікувана форма колбеків репортера

```js
const reporter = createCheckReporter()
// reporter: { pass(msg: string): void, fail(msg: string): void, getExitCode(): number }
```

`pass` додає позитивне повідомлення (не впливає на exit code), `fail` — фіксує порушення і змушує `getExitCode()` повернути `1`.

## Потік виконання / Використання

### Сценарій інтеграції

Модуль є частиною інфраструктури `n-cursor` правил `npm/rules/js-mssql/`. Він викликається універсальним runner'ом правил (наприклад через `bun run` або `n-cursor` CLI), який імпортує `check` і використовує її exit code як підсумок.

Типове використання:

```js
import { check } from './deps.mjs'

const exitCode = await check()
process.exit(exitCode)
```

### Послідовність дій усередині `check()`

1. **Ініціалізація репортера.** Створюється локальний `reporter` через `createCheckReporter()`.
2. **Guard 1 — кореневий `package.json`.** Якщо в `process.cwd()` немає `package.json`, перевірка вважається непридатною; виставляється `pass` і повертається exit code (зазвичай `0`).
3. **Завантаження ignore-шляхів.** Зчитуються через `loadCursorIgnorePaths(repoRoot)`.
4. **Збір усіх `package.json`.** `findAllPackageJsonPaths(repoRoot, ignorePaths)` повертає масив абсолютних шляхів усіх `package.json` репозиторію (з урахуванням workspace-пакетів і ignore).
5. **Guard 2 — порожній список.** Якщо `package.json` зовсім немає — пропуск перевірки з відповідним `pass`.
6. **Версійний аудит.** `aggregateMssqlVersionsAcrossPackages` обходить кожен `package.json`, парсить JSON, для кожного знайденого `dependencies.mssql` запускає `auditMssqlVersionInPackageJson`. Підсумок — `{ found, bad }`.
7. **Guard 3 — `mssql` не використовується.** Якщо `found === 0`, фіксується позитивний рядок `'js-mssql: пакет mssql не знайдено в dependencies жодного package.json'` і виконання завершується — статичний аналіз джерел **не запускається** (немає сенсу шукати порушення для пакета, якого немає в залежностях).
8. **Підсумковий pass про версії.** Якщо `bad === 0` (всі версії OK), додається підсумковий `pass` з кількістю знайдених.
9. **Аудит джерел.** `auditMssqlSources` сканує всі JS/TS-файли (через `walkDir` + `isMssqlScanSourceFile`), застосовує шість сканерів безпеки і фіксує кожне порушення через `fail`. Відсутність порушень за кожним типом конвертується у явний `pass` через `reportZeroMssqlSourceViolations`.
10. **Повернення exit code.** `reporter.getExitCode()` → `0` якщо жодного `fail` не було, інакше `1`.

### Формати повідомлень

Усі повідомлення мають префікс `js-mssql:` і додатково цитують правило `js-mssql.mdc` у негативних випадках. Приклади:

- **Версія OK:** `js-mssql: package.json: dependencies.mssql "^12.5.0" (>=12.5.0)`
- **Версія нижче мінімуму:** `js-mssql: package.json: dependencies.mssql "^11.0.0" — має бути >=12.5.0 (js-mssql.mdc)`
- **Невалідний JSON:** `js-mssql: package.json — невалідний JSON`
- **Per-request pool:** `js-mssql: src/db.js:42 — не створюй new sql.ConnectionPool(...) на кожен запит; використовуй singleton sql.ConnectionPool: <snippet>`
- **Відсутній guard для IN:** `js-mssql: src/db.js:58 — перед IN-списком "ids" потрібна перевірка на пустоту з throw (наприклад if (!ids.length) throw ...), інакше можливі некоректні запити (js-mssql.mdc): <snippet>`

### Платформо-незалежна нормалізація шляхів

У всіх місцях, де формується `rel`, послідовно застосовується `relative(repoRoot, absPath).split('\\').join('/')`. Це робить повідомлення стабільними на Windows і POSIX одночасно й узгодженими з шаблонами `isMssqlScanSourceFile`.

### Корнер-кейси

- **Відсутній `package.json` у корені** — перевірка повністю пропускається з позитивним `pass`.
- **Жодного `package.json`** (наприклад, у нестандартному репо без npm) — перевірка пропускається.
- **`dependencies` відсутній або не object** — `getMssqlDependencyRange` повертає `null` через `asObject`, лічильник не збільшується.
- **Нечитабельна версія** (наприклад `"latest"`, `"workspace:*"`, `"git+..."` без чистого `MAJOR.MINOR.PATCH`) — `parseLeadingSemver` повертає `null`, фіксується `fail` "має нечитабельну версію".
- **Версія дорівнює мінімуму** — `semverGte(parsedVer, MIN_MSSQL_VERSION)` дає `true`, фіксується `pass`.
- **`mssql` відсутній у всіх `package.json`** — статичний аналіз не запускається (оптимізація для проєктів, які не використовують MSSQL).
- **Файл — невалідний JSON** — фіксується `fail`, обхід продовжується (`continue`).
- **Жодного JS/TS-файлу** у репо для скану — фіксується позитивний `pass`, виконання продовжується нормально.
