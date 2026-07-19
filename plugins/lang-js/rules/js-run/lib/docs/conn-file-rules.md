---
type: JS Module
title: conn-file-rules.mjs
resource: plugins/lang-js/rules/js-run/lib/conn-file-rules.mjs
docgen:
  crc: eaa7a787
---

Модуль реалізує перевірки для файлів-підключень (connection files), що лежать у каталозі `src/conn/` (або в зоні дії lint-правила `conn-file` зі специфікації `js-run.mdc`, секції «Нейминг файлів у `src/conn/`» та «Експорти у файлах `src/conn/`»).

Він описує канонічну форму імені файла-підключення і канонічну форму його експорту, та надає функції для:

- визначення, чи файл взагалі підпадає під правило (за розширенням / типом);
- перевірки канонічного імені файла за регулярними виразами;
- утиліти `kebab-case → camelCase` для виведення очікуваного імені експорту з імені файла;
- статичного AST-аналізу через `oxc-parser` (обгорнутого в `parseProgramOrNull`) — пошук іменованих експортів і виявлення `export default`;
- збору списку порушень (`name` — невірне імʼя файла, `default-export` — наявність `export default`, `export-name` — відсутність очікуваного іменованого експорту).

Канонічні шаблони імен файлів:

- GraphQL: `ql-<id>.{js|mjs|cjs|ts|mts|cts|jsx|tsx}`, де `<id>` — kebab-case ідентифікатор endpoint.
- PostgreSQL: `pg-{read|write}.{ext}` або `pg-{read|write}-<id>.{ext}` (для multi-БД).
- MySQL: `mysql-{read|write}.{ext}` або `mysql-{read|write}-<id>.{ext}`.
- MSSQL: `mssql-{read|write}.{ext}` або `mssql-{read|write}-<id>.{ext}`.

Канонічна форма експорту — рівно один іменований експорт, без `export default`. Імʼя константи має дорівнювати camelCase від basename файла (без розширення); наприклад, `pg-write-contract.mjs` → `pgWriteContract`.

Якщо файл синтаксично невалідний (oxc не зміг розібрати), `findConnFileRuleViolations` не вигадує помилок — повертає лише ті, які можна впевнено зафіксувати (зокрема, порушення імені файла), а помилки синтаксису залишає іншим перевіркам, щоб не дублювати діагностику.

## Експорти / API

Модуль експортує тільки named-exports (узгоджено з `n-js` / `js-run.mdc`):

| Експорт                                                  | Тип                               | Призначення                                                                                       |
| -------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `isConnFileRulesSourceFile(relativePathPosix)`           | `(string) => boolean`             | Чи файл попадає під правило (JS/TS-сімʼя, без `.d.ts`).                                           |
| `kebabToCamel(kebab)`                                    | `(string) => string`              | Перетворення kebab-case на camelCase.                                                             |
| `isConnFileNameValid(relativePathPosix)`                 | `(string) => boolean`             | Чи basename файла відповідає одному з канонічних шаблонів (`ql-*`, `pg-*`, `mysql-*`, `mssql-*`). |
| `findConnFileRuleViolations(content, relativePathPosix)` | `(string, string) => Violation[]` | Повний прогін правил для конкретного файла.                                                       |

Тип `Violation` (інтенсіональний, не експортується явно):

```
{
  kind: 'name' | 'default-export' | 'export-name',
  expectedName?: string,
  foundNames?: string[],
}
```

- `kind: 'name'` — basename файла не відповідає жодному канонічному шаблону.
- `kind: 'default-export'` — у файлі знайдено `export default ...`.
- `kind: 'export-name'` — серед named-експортів немає очікуваного `expectedName` (виведеного з імені файла); у `foundNames` — реальний список знайдених імен (для повідомлення linter-а).

## Функції

### `isConnFileRulesSourceFile(relativePathPosix)`

**Сигнатура:** `(relativePathPosix: string) => boolean`

**Параметри:**

- `relativePathPosix` — відносний posix-шлях файла від кореня пакета (наприклад, `src/conn/pg-write.mjs`).

**Повертає:** `true`, якщо файл має розширення зі множини `[cm]?[jt]sx?` (тобто `.js | .mjs | .cjs | .jsx | .ts | .mts | .cts | .tsx`) і не є файлом декларацій типів (`.d.ts`). Інакше — `false`.

**Side effects:** немає (pure).

**Примітки:** перевірка `endsWith('.d.ts')` навмисно стоїть після regex, бо `.d.ts` теж задовольняє `SOURCE_FILE_RE` (`.ts`), а тип-декларації не повинні скануватись як код-підключень.

---

### `kebabToCamel(kebab)`

**Сигнатура:** `(kebab: string) => string`

**Параметри:**

- `kebab` — рядок у kebab-case (`pg-write-contract`, `ql-list-users`).

**Повертає:** camelCase-варіант: усі послідовності `-<x>` (де `x ∈ [a-z0-9]`) замінюються на `X` (літера капіталізується). Не змінює провідну літеру: `pg-...` → `pg...` (тобто результат у lower-camelCase).

**Side effects:** немає (pure).

**Деталі:** реалізовано через `replaceAll(/-([a-z0-9])/gu, (_m, c) => c.toUpperCase())`. Для дефіса перед не-[a-z0-9] символом нічого не робиться, тому функція стійка до неочікуваних символів (вони залишаються як є).

---

### `isConnFileNameValid(relativePathPosix)`

**Сигнатура:** `(relativePathPosix: string) => boolean`

**Параметри:**

- `relativePathPosix` — відносний posix-шлях файла.

**Повертає:** `true`, якщо basename (без шляху, з розширенням) відповідає одному з двох регулярних виразів:

- `CONN_FILENAME_QL_RE` — `^ql-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[cm]?[jt]sx?$`;
- `CONN_FILENAME_DB_RE` — `^(?:pg|mysql|mssql)-(?:read|write)(?:-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)?\.[cm]?[jt]sx?$`.

**Side effects:** немає (pure).

**Чому два regex:** обидва шаблони мають однакову `<id>`-частину, але GraphQL-форма не має `read|write` — обʼєднати їх у єдиний regex без зростання комплексності (sonarjs/regex-complexity) важко, тому розділили навмисно.

---

### `basenameNoExt(relativePathPosix)` _(внутрішня)_

**Сигнатура:** `(relativePathPosix: string) => string`

**Параметри:**

- `relativePathPosix` — posix-шлях файла.

**Повертає:** basename без розширення. Якщо у шляху немає `/`, обробляється весь рядок. Якщо немає `.` у basename (`dot <= 0`) — повертає basename як є. Це коректно для імен на кшталт `.env` (там `dot === 0`, ext не відрізаємо).

**Side effects:** немає.

---

### `namesFromVariableDeclaration(decl)` _(внутрішня)_

**Сигнатура:** `(decl: Record<string, unknown>) => string[]`

**Параметри:**

- `decl` — AST-вузол `VariableDeclaration` (тіло `export const/let/var ...`).

**Повертає:** масив імен усіх декларованих змінних, чий `id.type === 'Identifier'`. Підтримує множинні declarators в одному `export const a, b = 1`. Деструктурізації `export const { x } = ...` _не_ підтримуються — їхні `id` не є `Identifier`, тож пропускаються (зазвичай у conn-файлах їх немає).

**Side effects:** немає.

---

### `nameFromFnOrClassDeclaration(decl)` _(внутрішня)_

**Сигнатура:** `(decl: Record<string, unknown>) => string | null`

**Параметри:**

- `decl` — AST-вузол `FunctionDeclaration` або `ClassDeclaration`, що йде як `declaration` у `ExportNamedDeclaration`.

**Повертає:** імʼя функції/класу або `null`, якщо це не FunctionDeclaration / ClassDeclaration, або `id` відсутній/анонімний.

**Side effects:** немає.

---

### `nameFromExportSpecifier(specifier)` _(внутрішня)_

**Сигнатура:** `(specifier: Record<string, unknown> | null | undefined) => string | null`

**Параметри:**

- `specifier` — AST `ExportSpecifier` (елемент масиву `specifiers` у `export { X }` / `export { X as Y }`).

**Повертає:** імʼя, під яким значення експортовано назовні:

- якщо `exported.type === 'Identifier'` і `exported.name` — рядок → повертає `exported.name`;
- інакше якщо `exported.value` — рядок (форма `export { x as "string-name" }` із TS/ESTree) → повертає `exported.value`;
- інакше `null`.

**Side effects:** немає.

---

### `namesFromNamedExport(rec)` _(внутрішня)_

**Сигнатура:** `(rec: Record<string, unknown>) => string[]`

**Параметри:**

- `rec` — AST `ExportNamedDeclaration`.

**Повертає:** масив імен, отриманих з цього експортного вузла:

1. якщо `rec.declaration` присутній — обробляє вкладену декларацію:
   - `VariableDeclaration` → `namesFromVariableDeclaration`;
   - `FunctionDeclaration` / `ClassDeclaration` → одиничний масив із `nameFromFnOrClassDeclaration` або `[]` для анонімних;
2. якщо `declaration === null` — проходить `specifiers` і збирає імена через `nameFromExportSpecifier`.

`export * from 'x'` (тип `ExportAllDeclaration`) сюди не попадає (фільтрується вище за `type !== 'ExportNamedDeclaration'`).

**Side effects:** немає.

---

### `collectNamedExportNames(program)` _(внутрішня)_

**Сигнатура:** `(program: unknown) => string[]`

**Параметри:**

- `program` — корінь AST (результат `parseProgramOrNull`).

**Повертає:** конкатенацію всіх імен named-експортів у `program.body`. Захищена від nullish/неoбʼєктних значень і відсутнього `body` — повертає `[]`.

**Side effects:** немає.

---

### `hasDefaultExport(program)` _(внутрішня)_

**Сигнатура:** `(program: unknown) => boolean`

**Параметри:**

- `program` — корінь AST.

**Повертає:** `true`, якщо у `program.body` знайдено хоча б один вузол із `type === 'ExportDefaultDeclaration'`. Інакше — `false` (включно з випадками, коли AST неприйнятний).

**Side effects:** немає.

---

### `findConnFileRuleViolations(content, relativePathPosix)`

**Сигнатура:**

```
(content: string, relativePathPosix: string) =>
  { kind: 'name' | 'default-export' | 'export-name',
    expectedName?: string,
    foundNames?: string[] }[]
```

**Параметри:**

- `content` — вихідний код файла.
- `relativePathPosix` — відносний posix-шлях файла від кореня пакета.

**Повертає:** масив порушень (можливо порожній).

**Side effects:** немає (read-only по строці; `parseProgramOrNull` теж не має сайд-ефектів окрім CPU).

**Алгоритм:**

1. Якщо `isConnFileNameValid(relativePathPosix)` повертає `false` — додається порушення `{ kind: 'name' }`. У цьому випадку перевірка камелкейс-імені експорту далі **не виконується**, бо очікуване імʼя неоднозначне (фactually undefined behavior для нестандартного імені файла).
2. Парсимо `content` через `parseProgramOrNull(content, relativePathPosix)`:
   - якщо повернувся `null` (синтаксис не зайшов) — повертаємо вже зібрані порушення (тільки `name`, якщо було);
3. Якщо `hasDefaultExport(program)` — додаємо `{ kind: 'default-export' }`.
4. Якщо серед уже накопичених порушень є `name` — повертаємо без перевірки імені експорту (див. п. 1).
5. Інакше виводимо очікуване імʼя експорту: `kebabToCamel(basenameNoExt(<basename з шляху>))`. Зверніть увагу — у виклику передається `relativePathPosix.slice(lastIndexOf('/') + 1)`, тобто basename з розширенням, а `basenameNoExt` далі ріже розширення.
6. Збираємо реальні named-експорти через `collectNamedExportNames(program)`. Якщо очікуваного `expectedName` серед них немає — додаємо `{ kind: 'export-name', expectedName, foundNames: names }`.

**Не перевіряється навмисно:** наявність `export default` фіксується незалежно від валідності імені файла (можна одночасно отримати `name` + `default-export`). Зайвість додаткових іменованих експортів (наприклад, два expected експорти) не вважається порушенням цим правилом — звіряється лише наявність очікуваного імені.

## Залежності

**Імпорти:**

- `parseProgramOrNull` з `../../../scripts/utils/ast-scan-utils.mjs` — обгортка над `oxc-parser`, повертає `null` для синтаксично невалідних файлів. Це єдина зовнішня залежність модуля.

**Стандартна бібліотека:** немає (тільки рядкові операції та regex).

**Споживачі (типовий профіль):** lint-правило `conn-file` у пакеті `npm/rules/js-run` (модуль вказує на правило `js-run.mdc`). Очікується, що зовнішній runner викликає `isConnFileRulesSourceFile` для відбору кандидатів і `findConnFileRuleViolations` для звіту.

## Потік виконання / Використання

Типовий цикл lint-runner:

1. Зібрати perfile-список через `git ls-files` або `glob` у каталозі `src/conn/`.
2. Для кожного файла перевірити `isConnFileRulesSourceFile(relativePath)`; якщо `false` — пропустити.
3. Прочитати вміст і викликати `findConnFileRuleViolations(content, relativePath)`.
4. Для кожного `Violation` сформувати читабельне повідомлення:
   - `name` → «імʼя файла не відповідає шаблонам `ql-*` / `pg-{read|write}*` / `mysql-{read|write}*` / `mssql-{read|write}*`»;
   - `default-export` → «у файлах `src/conn/` заборонено `export default`»;
   - `export-name` → «очікуваний named-експорт `expectedName`, знайдено: `foundNames.join(', ')`».

**Приклад використання (Node.js / Bun):**

```
import { readFileSync } from 'node:fs'
import {
  isConnFileRulesSourceFile,
  findConnFileRuleViolations,
} from './conn-file-rules.mjs'

const rel = 'src/conn/pg-write-contract.mjs'
if (isConnFileRulesSourceFile(rel)) {
  const content = readFileSync(rel, 'utf8')
  const violations = findConnFileRuleViolations(content, rel)
  for (const v of violations) {
    console.log(v.kind, v.expectedName ?? '', v.foundNames ?? '')
  }
}
```

Для прикладу, якщо файл `src/conn/pg-write-contract.mjs` містить:

```
export const pgWriteContract = createPool({ /* ... */ })
```

→ `violations === []`. Якщо ж замість `pgWriteContract` стоїть `export default createPool(...)`, отримаємо два порушення: `default-export` і `export-name` (бо очікуване імʼя `pgWriteContract` не знайдене).

**Граничні випадки:**

- Файл з `.d.ts` — `isConnFileRulesSourceFile` → `false`, перевірка не запускається.
- Файл із валідним іменем, але невалідним JS-синтаксисом — повертається тільки `default-export`/`export-name`-перевірок не буде (бо `program === null`), порушення імені теж не буде (бо імʼя валідне). Це навмисна делегація: помилка синтаксису репортнеться іншим linter-правилом.
- Файл із нестандартним іменем (наприклад, `src/conn/connection.mjs`) — повертається лише `{ kind: 'name' }`, навіть якщо там є `export default`. Це усвідомлена відмова, щоб не дублювати шум — спочатку треба виправити імʼя файла.
- `export *` — ігнорується (немає конкретного імені для звірки).
- `export { x as "string-literal" }` — string-form імені вилучається з `exported.value` (підтримується сучасний ESTree-формат).
