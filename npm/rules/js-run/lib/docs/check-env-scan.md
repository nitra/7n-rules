---
docgen:
  source: npm/rules/js-run/lib/check-env-scan.mjs
  crc: 56c971d4
---

# `check-env-scan.mjs` — AST-сканер правила «process.env / CheckEnv»

## Огляд

Модуль `npm/rules/js-run/lib/check-env-scan.mjs` — це **статичний AST-сканер**,
що реалізує перевірку правила `js-run.mdc` для двох контрактів роботи зі
змінними оточення в JavaScript/TypeScript-коді:

1. **Заборона прямого `process.env.X`.** Будь-який доступ до `process.env.X`
   (через MemberExpression, computed-access чи деструктуризацію) завжди
   реєструється як порушення з підказкою замінити його:
   - на `env` із пакета `@nitra/check-env` (для обов'язкових змінних із
     явним викликом `checkEnv([...])`);
   - на `env` із `node:process` (для опційних).
2. **Обов'язкове «закриття» `env.X` викликом `checkEnv(['X', ...])`.** Якщо
   у файл імпортовано саме `env` з `@nitra/check-env`, то кожне використання
   `env.X` (як MemberExpression або через деструктуризацію `const { X } = env`)
   має бути зареєстроване хоча б одним літеральним викликом `checkEnv([...])`
   у тому ж файлі. Порядок викликів і доступів не важливий — всі імена з
   масивів `checkEnv(['A', 'B'])` зливаються в один спільний набір.

Точкове приглушення обох контрактів — коментар-маркер на рядку
**безпосередньо перед** порушенням:

```
// @nitra/cursor ignore-next-line checkEnv
```

Сканер працює тільки через AST (`parseProgramOrNull` з `oxc-parser` через
утиліту `ast-scan-utils.mjs`); по тілу файлу ніяких regex не виконується —
regex-перевірці підлягає лише сирий рядок із потенційним ignore-коментарем.

Якщо файл не парситься (синтаксична помилка), сканер повертає порожній
результат — спочатку треба полагодити синтаксис, лише потім запускати
правило.

### Які форми доступу покриті

- `process.env.X` — MemberExpression із object=Identifier `process`,
  property=Identifier `env`, потім parent MemberExpression із property=`X`;
- `process.env['X']` — те саме, але parent MemberExpression із
  `computed: true` і Literal-string-ключем;
- `const { X, Y } = process.env` — VariableDeclarator, де init це
  `process.env`, а id це ObjectPattern; ім'я береться **з ключа**
  (`property.key`), а не з alias-локального ідентифікатора;
- `env.X` / `env['X']` / `const { X } = env` — аналогічно, але вузол це
  Identifier `env`, і **тільки** якщо у файлі є
  `import { env } from '@nitra/check-env'`.

### Що ігнорується

- Обчислювані ключі (`process.env[varName]`, `env[varName]`): за статичним
  AST неможливо встановити фактичне ім'я ENV, тому такі вирази проходять
  тихо без помилки.
- `env` з інших джерел (локальна змінна, `node:process` import тощо):
  `hasCheckEnvImport` повертає `false`, і AST-обхід просто не дивиться на
  `env.X` для другого контракту. Перший контракт (`process.env`) при цьому
  все ще діє.
- Aliased-імпорти `import { env as someName }`: свідомо **не** підтримуються —
  правило вимагає канонічного імені `env`.
- Не-літеральні елементи всередині `checkEnv([...])` (Identifier, SpreadElement,
  TemplateLiteral): просто пропускаються при збиранні `checkedNames` —
  перевірка «ліберальна» і ловить лише явно неперевірені змінні.

## Експорти / API

Модуль експортує дві named-функції:

| Експорт                         | Тип                                                         | Призначення                                          |
| ------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `findUncheckedProcessEnvInText` | `(content: string, virtualPath?: string) => EnvViolation[]` | Сканує текст файлу й повертає список порушень        |
| `isCheckEnvScanSourceFile`      | `(relativePathPosix: string) => boolean`                    | Фільтр придатних до сканування файлів за розширенням |

Тип `EnvViolation` (внутрішній, описаний через JSDoc `@typedef`):

```js
/**
 * @typedef {{
 *   line: number,
 *   name: string,
 *   kind: 'process-env' | 'check-env-missing-checkEnv'
 * }} EnvViolation
 */
```

- `kind` — тип порушення:
  - `'process-env'` — прямий доступ до `process.env.X`;
  - `'check-env-missing-checkEnv'` — використання `env.X` без літерального
    `checkEnv(['X', ...])` у файлі.
- `name` — ім'я ENV-змінної (наприклад, `DB_HOST`).
- `line` — 1-based номер рядка з порушенням (отриманий через `offsetToLine`).

Список порушень повертається в порядку обходу AST. У межах одного виклику
застосовується дедуплікація за ключем `kind|name|line` — повторні зустрічі
ідентичного «kind+name+line» в результат не потрапляють.

## Функції

Нижче — повний перелік функцій модуля (у тому порядку, як вони визначені у файлі).

### `isProcessEnvAccess(node) → boolean`

Перевіряє, чи вузол AST є виразом `process.env`.

- **Параметри:** `node: unknown` — AST-вузол.
- **Повертає:** `true`, якщо це не-computed `MemberExpression`, де `object` —
  Identifier `process`, а `property` — Identifier `env`. Інакше `false`.
- **Side effects:** немає (чиста функція).

Зокрема, навмисно повертає `false` для `process['env']` (computed=true) —
це нестандартна форма, у нашому коді не зустрічається й окремо не
реєструється.

### `envNameFromMember(node) → string | null`

Витягує статичне ім'я ENV з MemberExpression `obj.X` / `obj['X']`.

- **Параметри:** `node: Record<string, unknown>` — MemberExpression, у якому
  `object` — це або `process.env` (тоді сам node — parent member), або
  Identifier `env`.
- **Повертає:**
  - Якщо `!node.computed && property.type === 'Identifier'` — `property.name`;
  - Якщо `node.computed && property.type === 'Literal' && typeof value === 'string'`
    — `property.value`;
  - Інакше `null` (обчислювані ключі, не-рядкові літерали тощо).
- **Side effects:** немає.

### `collectCheckedEnvNames(programNode) → Set<string>`

Збирає всі рядкові імена з літеральних викликів `checkEnv([...])` у файлі.

- **Параметри:** `programNode: unknown` — корінь AST (Program).
- **Повертає:** `Set<string>` — імена ENV, які явно перераховані як string-літерали
  у першому аргументі (`ArrayExpression`) будь-якого виклику `checkEnv(...)`.
- **Поведінка:**
  - Якщо `callee.type !== 'Identifier'` або `callee.name !== 'checkEnv'` —
    вузол пропускається;
  - Якщо `arguments` порожні або перший аргумент не `ArrayExpression` —
    пропускається;
  - Лише `Literal`-елементи з `typeof value === 'string'` додаються в set;
  - Identifier, SpreadElement, TemplateLiteral, обчислювані вирази —
    пропускаються (це робить перевірку «ліберальною»).
- **Side effects:** немає (обхід AST через `walkAstWithAncestors` —
  read-only).

### `hasCheckEnvImport(programNode) → boolean`

Перевіряє, чи у файлі є саме `import { env } from '@nitra/check-env'`.

- **Параметри:** `programNode: unknown` — корінь AST.
- **Повертає:** `true`, якщо знайдено `ImportDeclaration` з
  `source.value === '@nitra/check-env'` і серед `specifiers` є хоч один
  `ImportSpecifier` із `imported.name === 'env'` та `local.name === 'env'`.
  Інакше `false`.
- **Side effects:** немає. Внутрішньо використовує закриту змінну `found`
  для дострокового виходу — обхід AST все одно завершується, але
  внутрішні гілки рано повертаються після знахідки.

Aliased-варіанти (наприклад, `{ env as x }` де `local.name !== 'env'`)
свідомо ігноруються.

### `hasIgnoreDirective(lines, oneBasedLine) → boolean`

Перевіряє, чи попередній рядок містить маркер
`// @nitra/cursor ignore-next-line checkEnv`.

- **Параметри:**
  - `lines: string[]` — рядки файлу (split за `\n`, без trailing `\r`);
  - `oneBasedLine: number` — 1-based номер рядка з порушенням.
- **Повертає:** `true`, якщо `lines[oneBasedLine - 2]` (тобто рядок безпосередньо
  над порушенням) матчиться regex `IGNORE_DIRECTIVE_RE`. Якщо `oneBasedLine <= 1`
  (порушення в першому рядку — попереднього рядка не існує) — повертає `false`.
- **Side effects:** немає.

### `isEnvIdentifierMember(node) → boolean`

Чи вузол — MemberExpression виду `env.<...>` (де `env` — Identifier).

- **Параметри:** `node: unknown` — AST-вузол.
- **Повертає:** `true`, якщо `node.type === 'MemberExpression'` і
  `object.type === 'Identifier' && object.name === 'env'`. Інакше `false`.
- **Side effects:** немає.

Фільтр **джерела** імпорту `env` робиться окремо через `hasCheckEnvImport` —
ця функція лише розпізнає форму AST.

### `isParentEnvMember(parent, node) → boolean`

Чи `parent` — це MemberExpression, у якому `node` (тобто `process.env`)
виступає як `object`.

- **Параметри:**
  - `parent: unknown` — найближчий ancestor вузла;
  - `node: unknown` — сам вузол `process.env`.
- **Повертає:** `true` для конструкцій `process.env.X` та `process.env['X']`.
- **Side effects:** немає.

### `isParentObjectPatternDeclarator(parent, node) → boolean`

Чи `parent` — це `VariableDeclarator` виду `const { ... } = <node>`.

- **Параметри:**
  - `parent: unknown` — ancestor;
  - `node: unknown` — `process.env` (або інший init-вираз).
- **Повертає:** `true`, якщо `parent.type === 'VariableDeclarator'`,
  `parent.init === node`, `parent.id.type === 'ObjectPattern'` і
  `parent.id.properties` — масив. Інакше `false`.
- **Side effects:** немає.

### `isEnvObjectPatternDeclarator(node) → boolean`

Чи `node` сам — це `VariableDeclarator` виду `const { ... } = env`, де
`env` — Identifier.

- **Параметри:** `node: Record<string, unknown>` — AST-вузол.
- **Повертає:** `true`, якщо `node.type === 'VariableDeclarator'`,
  `init.type === 'Identifier' && init.name === 'env'` і
  `id.type === 'ObjectPattern'`.
- **Side effects:** немає.

Різниця з `isParentObjectPatternDeclarator` у тому, що ця функція дивиться
**на сам поточний вузол**, бо `Identifier 'env'` сам по собі обходить
небагато інформації — простіше реагувати на VariableDeclarator як корінь
паттерна.

### `staticPropertyName(property) → string | null`

Витягує статичне ім'я з вузла `Property` у `ObjectPattern`.

- **Параметри:** `property: unknown` — елемент
  `ObjectPattern.properties[i]`.
- **Повертає:**
  - `null`, якщо `type !== 'Property'` або `computed === true`;
  - `key.name` для `key.type === 'Identifier'`;
  - `key.value` для `key.type === 'Literal'` із `typeof value === 'string'`;
  - інакше `null`.
- **Side effects:** немає.

Ім'я береться **з ключа** (`property.key`), а не з `value` (alias-локального
ідентифікатора), бо саме ключ відповідає реальному імені ENV-змінної.

### `collectViolations(program, content, lines, checkedNames, envFromCheckEnv) → EnvViolation[]`

Серцева функція модуля: один прохід по AST, що реєструє всі порушення.

- **Параметри:**
  - `program: unknown` — корінь AST;
  - `content: string` — вихідний код (потрібен для `offsetToLine`);
  - `lines: string[]` — split-рядки `content` (без CR), потрібні для
    `hasIgnoreDirective`;
  - `checkedNames: Set<string>` — імена, закриті літеральним `checkEnv([...])`;
  - `envFromCheckEnv: boolean` — чи імпортовано `env` саме з
    `@nitra/check-env`.
- **Повертає:** `EnvViolation[]` — список порушень у порядку обходу AST,
  з дедуплікацією за ключем `kind|name|line`.
- **Side effects:** немає за межами повернутого масиву. Внутрішньо тримає
  замикання-стан (`out`, `reported`), які живуть лише в межах виклику.

Внутрішня структура:

- `report(kind, name, line)` — додає порушення з урахуванням
  `hasIgnoreDirective` і дедуплікації за `kind|name|line`;
- `reportObjectPatternKeys(declarator, kind, skipName)` — для VariableDeclarator
  з ObjectPattern обходить усі properties; для кожного статичного імені
  (`staticPropertyName`) перевіряє `skipName(name)` і реєструє порушення.
  Якщо `p.start` відсутній — використовує `declarator.start` як
  fallback-offset;
- `handleProcessEnv(node, ancestors)` — обробляє `process.env`-доступ:
  читає `ancestors.at(-1)`, для MemberExpression-parent реєструє ім'я через
  `envNameFromMember(parent)`, для VariableDeclarator-parent — через
  `reportObjectPatternKeys(parent, 'process-env', () => false)` (для
  `process.env` skipName завжди false — закрити прямий `process.env` через
  `checkEnv` не можна);
- `handleCheckEnvAccess(node)` — обробляє `env.X` і `const { X } = env`;
  для перших — реєструє лише якщо `!checkedNames.has(envName)`; для
  деструктуризації — пропускає імена, що вже у `checkedNames`.

Сам обхід:

```
walkAstWithAncestors(program, [], (node, ancestors) => {
  if (isProcessEnvAccess(node)) { handleProcessEnv(node, ancestors); return }
  if (envFromCheckEnv) handleCheckEnvAccess(node)
})
```

Тобто `process.env` має пріоритет над `env`-перевіркою: якщо вузол — це
`process.env`, ми реєструємо порушення і виходимо, не дивлячись на нього як
на потенційний `env.X`.

### `findUncheckedProcessEnvInText(content, virtualPath = 'scan.ts') → EnvViolation[]` _(export)_

Публічна точка входу: знаходить порушення правила в одному файлі.

- **Параметри:**
  - `content: string` — вихідний код файлу;
  - `virtualPath?: string` — шлях, який передається в `parseProgramOrNull`
    для вибору `lang` парсера (`.ts`, `.tsx`, `.js`, `.mjs`, …). За
    замовчуванням `'scan.ts'` — це означає, що content за замовчуванням
    парситься як TypeScript.
- **Повертає:** `EnvViolation[]`. Порожній масив, якщо:
  - файл не парситься (`parseProgramOrNull` повернув `null`);
  - порушень не знайдено;
  - усі порушення приглушено `ignore-next-line`-маркером.
- **Side effects:** немає — функція **чиста**, не читає файлів з диска і
  нічого не пише.

Порядок дій усередині:

1. `parseProgramOrNull(content, virtualPath)` — отримати AST; якщо `null`,
   повертаємо `[]`.
2. `collectCheckedEnvNames(program)` — зібрати імена з `checkEnv([...])`.
3. `hasCheckEnvImport(program)` — визначити, чи активний другий контракт.
4. Розбити `content` на `lines` (split за `\n`, без trailing `\r` —
   нормалізація CRLF/LF).
5. `collectViolations(...)` — отримати фінальний список і повернути.

### `isCheckEnvScanSourceFile(relativePathPosix) → boolean` _(export)_

Фільтр придатних до сканування файлів за розширенням.

- **Параметри:** `relativePathPosix: string` — відносний шлях у posix-стилі
  (з `/`-розділювачами).
- **Повертає:** `true`, якщо:
  - `SOURCE_FILE_RE.test(relativePathPosix)` — розширення у множині
    `{.js, .mjs, .cjs, .ts, .mts, .cts, .jsx, .tsx}` (regex
    `/\.([cm]?[jt]sx?)$/u`);
  - **і** шлях **не** закінчується на `.d.ts` (declaration-файли
    декларують лише типи й не виконують коду — їх скан не цікавить).
- **Side effects:** немає.

## Залежності

Модуль має **одну** локальну залежність (зовнішніх npm-пакетів напряму не
імпортує):

- `../../../scripts/utils/ast-scan-utils.mjs` — спільні AST-утиліти:
  - `parseProgramOrNull(content, virtualPath)` — обгортка над `oxc-parser`,
    повертає корінь AST або `null` при синтаксичних помилках;
  - `walkAstWithAncestors(root, ancestors, visitor)` — обхід дерева з
    підтримкою стеку предків;
  - `offsetToLine(content, offset)` — конвертація байтового зміщення в
    1-based номер рядка.

Внутрішні константи модуля:

- `SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u` — regex розширень для
  `isCheckEnvScanSourceFile`;
- `IGNORE_DIRECTIVE_RE = /\/\/\s*@nitra\/cursor\s+ignore-next-line\s+checkEnv\b/u`
  — regex маркера приглушення;
- `CHECK_ENV_PACKAGE = '@nitra/check-env'` — спеціальне ім'я пакета, з
  якого має імпортуватися `env`.

Опосередковано модуль покладається на формат AST, що його повертає
`oxc-parser`: типи вузлів і поля (`type`, `object`, `property`, `computed`,
`source.value`, `specifiers[].imported.name`, `id.type`, `id.properties[]`,
`init`, `start` і т.д.) — близькі до ESTree, але з нюансами oxc.

## Потік виконання / Використання

### Типове використання (caller — runner правила `js-run`)

```js
import { readFileSync } from 'node:fs'
import { findUncheckedProcessEnvInText, isCheckEnvScanSourceFile } from './check-env-scan.mjs'

const relativePath = 'src/db/connect.ts' // posix
if (isCheckEnvScanSourceFile(relativePath)) {
  const content = readFileSync(relativePath, 'utf8')
  const violations = findUncheckedProcessEnvInText(content, relativePath)
  for (const v of violations) {
    console.log(`${relativePath}:${v.line}  [${v.kind}]  ${v.name}`)
  }
}
```

### Приклади порушень

**Контракт 1 — `process-env`:**

```ts
// src/db/connect.ts
const host = process.env.DB_HOST // kind: 'process-env', name: 'DB_HOST'
const { DB_PORT } = process.env // kind: 'process-env', name: 'DB_PORT'
```

**Контракт 2 — `check-env-missing-checkEnv`** (тільки якщо є відповідний
імпорт):

```ts
import { env, checkEnv } from '@nitra/check-env'

checkEnv(['DB_HOST']) // закриває DB_HOST
const host = env.DB_HOST // OK
const port = env.DB_PORT // kind: 'check-env-missing-checkEnv', name: 'DB_PORT'

const { DB_USER } = env // kind: 'check-env-missing-checkEnv', name: 'DB_USER'
```

**Приглушення:**

```ts
// @nitra/cursor ignore-next-line checkEnv
const host = process.env.DB_HOST // НЕ реєструється
```

### Внутрішній порядок виконання `findUncheckedProcessEnvInText`

1. `parseProgramOrNull(content, virtualPath)` → AST (або `null` → `[]`).
2. `collectCheckedEnvNames(program)` → `Set<string> checkedNames`.
3. `hasCheckEnvImport(program)` → `boolean envFromCheckEnv`.
4. `content.split('\n').map(...)` → `string[] lines` (CRLF-нормалізація).
5. `collectViolations(program, content, lines, checkedNames, envFromCheckEnv)`:
   - один прохід `walkAstWithAncestors`;
   - для кожного `process.env` — `handleProcessEnv` (member-access або
     ObjectPattern);
   - для кожного `env.X` / `const { X } = env` (тільки коли
     `envFromCheckEnv === true`) — `handleCheckEnvAccess` з урахуванням
     `checkedNames`;
   - `report(...)` накладає `hasIgnoreDirective` і дедуплікацію.
6. Повернути масив порушень.

### Інтеграція з правилом `js-run.mdc`

Це частина «фікс/лінт»-шару правил `npm/rules/js-run/...`: runner правила
викликає `isCheckEnvScanSourceFile` як фільтр, потім —
`findUncheckedProcessEnvInText` на відфільтрованих файлах, і за вмістом
повернутого масиву звітує діагностику в стандартному форматі
правила (з `kind`, `name` і `line` будуються повідомлення-підказки про
заміну `process.env.X` на `env`/`checkEnv`).

Жодних інших побічних ефектів модуль не має: не пише на диск, не змінює
`process.env`, не виконує парс-коду інакше, ніж через `oxc-parser` усередині
`parseProgramOrNull`.
