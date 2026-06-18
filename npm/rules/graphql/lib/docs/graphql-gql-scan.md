---
type: JS Module
title: graphql-gql-scan.mjs
resource: npm/rules/graphql/lib/graphql-gql-scan.mjs
docgen:
  crc: e110f9dd
---

Модуль `graphql-gql-scan.mjs` — це сканер сирцевих файлів проєкту, який визначає, чи містить файл tagged template літерал із тегом `gql` (тобто конструкцію виду `` gql`…` ``). Сканер призначений для роботи разом із правилом `graphql.mdc` і використовується інфраструктурою лінту/правил для виявлення місць, де описано GraphQL-запити у форматі вкладених шаблонних рядків.

Ключові властивості:

- **Підтримує** файли з розширеннями `.vue`, `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx`.
- Для **`.vue`** (Single File Component) бере **лише** вміст блоків `<script>` / `<script setup>`, ігноруючи `<template>` і `<style>`.
- Для парсингу використовує **`oxc-parser`** (`parseSync`) — отримує повний AST і виконує **рекурсивний обхід**, шукаючи вузли `TaggedTemplateExpression` із тегом-`Identifier` з ім'ям `gql`.
- Дозволяє пропускати типові generated-файли (`*.d.ts`, `auto-imports.d.ts`, `components.d.ts`).
- Реалізований як **самодостатній модуль**: не імпортує функцій з інших правил (наприклад, із паралельного `vue-forbidden-imports.mjs` — там екстрактор `<script>` реалізовано окремо), щоб уникати cross-rule імпортів.

Файл експортує три чисті функції: одна виконує перевірку наявності `gql`-тега, дві допоміжні класифікують шлях файлу (чи варто сканувати, чи варто пропустити).

## Експорти / API

Файл є ES-модулем (`.mjs`). Має такі іменовані експорти:

| Експорт                          | Тип                                  | Призначення                                                               |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `sourceFileHasGqlTaggedTemplate` | `(content, relativePath) => boolean` | Парсить вміст і повертає `true`, якщо знайдено `` gql`…` ``.              |
| `isGqlScanSourceFile`            | `(relativePath) => boolean`          | `true` якщо файл за розширенням підлягає скануванню.                      |
| `shouldSkipFileForGqlScan`       | `(relativePosix) => boolean`         | `true` якщо файл — типовий generated/declaration і його треба пропустити. |

Default-експорту **немає**. Усі допоміжні функції (`extractVueScriptBlocks`, `contentForGqlScan`, `langFromPath`, `virtualPathForParse`, `astContainsGqlTag`) — приватні (module-scope), назовні не експонуються.

## Функції

### `extractVueScriptBlocks(sfc)` _(приватна)_

- **Сигнатура**: `(sfc: string) => string`
- **Параметри**:
  - `sfc` — сирий вміст `.vue` файлу як рядок.
- **Повертає**: рядок-конкатенацію вмісту **усіх** блоків `<script>` (включно з `<script setup>`), з'єднаних подвійним `\n\n`. Якщо `<script>` блоків немає — повертає порожній рядок.
- **Side effects**: жодних мутацій зовнішнього стану; перед роботою примусово скидає `VUE_SCRIPT_BLOCK_RE.lastIndex = 0` (модуль-локальний `RegExp` з прапором `g` має stateful `lastIndex`), щоб попередні виклики не вплинули на новий парсинг.
- **Алгоритм**: цикл `RegExp.exec` по глобальному регулярному виразу `VUE_SCRIPT_BLOCK_RE` — `/<script\b[^>]*>([\s\S]*?)<\/script>/gi`. Перша захопна група містить тіло блоку без обгортки.

### `contentForGqlScan(content, filePath)` _(приватна)_

- **Сигнатура**: `(content: string, filePath: string) => string`
- **Параметри**:
  - `content` — сирий вміст файлу.
  - `filePath` — відносний шлях; використовується **лише** для перевірки розширення.
- **Повертає**: якщо `filePath` закінчується на `.vue`, повертає результат `extractVueScriptBlocks(content)`; інакше — без змін `content`.
- **Side effects**: немає.

### `langFromPath(filePath)` _(приватна)_

- **Сигнатура**: `(filePath: string) => 'js' | 'jsx' | 'ts' | 'tsx'`
- **Параметри**:
  - `filePath` — реальний або віртуальний шлях.
- **Повертає** мову для `parseSync` із `oxc-parser` за пріоритетом перевірок (на lowercased рядку):
  1. `.tsx` → `'tsx'`
  2. `.ts` / `.mts` / `.cts` → `'ts'`
  3. `.jsx` → `'jsx'`
  4. усе інше → `'js'`
- **Side effects**: немає.

### `virtualPathForParse(relativePath)` _(приватна)_

- **Сигнатура**: `(relativePath: string) => string`
- **Параметри**:
  - `relativePath` — відносний шлях до сирцевого файлу.
- **Повертає**: для `.vue` — той самий шлях із розширенням, заміненим на `.ts` (через `VUE_EXTENSION_RE = /\.vue$/u`). Для всіх інших — повертає `relativePath` як є. Зроблено, щоб `oxc-parser` парсив SFC як TypeScript-код (бо `<script setup>` найчастіше TS).
- **Side effects**: немає.

### `astContainsGqlTag(node)` _(приватна)_

- **Сигнатура**: `(node: unknown) => boolean`
- **Параметри**:
  - `node` — будь-який вузол AST або корінь `program`, отриманий від `parseSync`.
- **Повертає**: `true`, якщо в дереві (поточному або будь-якому нащадку) знайдено вузол `TaggedTemplateExpression`, у якого `tag.type === 'Identifier'` **та** `tag.name === 'gql'`. Інакше — `false`.
- **Алгоритм** (рекурсивний DFS):
  1. Якщо `node` — `null`/`undefined` → `false`.
  2. Якщо `typeof node !== 'object'` (примітив) → `false`.
  3. Якщо масив — `Array.prototype.some` з рекурсивним викликом.
  4. Якщо `node.type === 'TaggedTemplateExpression'` і його `tag` — `Identifier` з ім'ям `gql` → `true`.
  5. Інакше — ітерація по `Object.keys(node)`, **пропускаючи** ключі `loc` та `range` (це позиційна метаінформація без AST-вузлів) і рекурсивно перевіряючи кожне значення.
- **Side effects**: немає; функція чиста.

### `sourceFileHasGqlTaggedTemplate(content, relativePath)` _(експорт)_

- **Сигнатура**: `(content: string, relativePath: string) => boolean`
- **Параметри**:
  - `content` — сирий вміст файлу.
  - `relativePath` — відносний posix-шлях (використовується для вибору режиму парсингу й мови).
- **Повертає**: `true`, якщо у файлі знайдено `gql`-tagged template; `false` — в усіх інших випадках, включно з помилками парсингу та винятками.
- **Алгоритм**:
  1. Отримати текст для сканування: `contentForGqlScan(content, relativePath)`.
  2. Обчислити шлях для парсера: `virtualPathForParse(relativePath)` (для SFC — `.ts`).
  3. Визначити мову: `langFromPath(pathForLang)`.
  4. Викликати `parseSync(pathForLang, scan, { lang, sourceType: 'module' })` всередині `try…catch`.
  5. Якщо `result.errors?.length` істинне (парсер повернув помилки, але не кинув виняток) — повернути `false`.
  6. Інакше — `astContainsGqlTag(result.program)`.
  7. Будь-який `throw` від `parseSync` ловиться `catch {}` і повертається `false`.
- **Side effects**:
  - Викликає синхронний `parseSync` з `oxc-parser` — CPU-bound операція над текстом.
  - **Не** мутує переданих аргументів і не модифікує жодного зовнішнього стану.
  - Помилки парсера не пробкидаються нагору — інтерпретація: «якщо не парситься, то й `gql` ми достеменно не знаємо, тому не сигналізуємо».

### `isGqlScanSourceFile(relativePath)` _(експорт)_

- **Сигнатура**: `(relativePath: string) => boolean`
- **Параметри**:
  - `relativePath` — відносний шлях.
- **Повертає**: `true`, якщо шлях відповідає `SOURCE_FILE_RE = /\.(vue|[cm]?[jt]sx?)$/u`, тобто закінчується на одне з: `.vue`, `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx`. Інакше — `false`.
- **Side effects**: немає.

### `shouldSkipFileForGqlScan(relativePosix)` _(експорт)_

- **Сигнатура**: `(relativePosix: string) => boolean`
- **Параметри**:
  - `relativePosix` — шлях у форматі posix (`/` як роздільник).
- **Повертає**: `true`, якщо файл — typical generated/declaration і його не варто сканувати:
  - Базове ім'я (останній сегмент після `/`) дорівнює `auto-imports.d.ts` **або** `components.d.ts`; **або**
  - Шлях закінчується на `.d.ts`.
- В інших випадках — `false`.
- **Side effects**: немає.

### Огляд приватних констант

| Константа             | Значення                                  | Призначення                                                       |
| --------------------- | ----------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `VUE_EXTENSION_RE`    | `/\.vue$/u`                               | Перевірка/заміна розширення `.vue` на `.ts` у віртуальному шляху. |
| `SOURCE_FILE_RE`      | `/\.(vue                                  | [cm]?[jt]sx?)$/u`                                                 | Класифікатор «це сирцевий файл, що підлягає скануванню». |
| `VUE_SCRIPT_BLOCK_RE` | `/<script\b[^>]*>([\s\S]*?)<\/script>/gi` | Глобальний матч блоків `<script>` у `.vue` файлі.                 |

## Залежності

### Зовнішні (`import`)

- **`oxc-parser`** — JavaScript-парсер на Rust (через native-bindings); експортує `parseSync(filePath, sourceCode, options)`. У цьому модулі використовується для побудови AST і визначає семантику `gql` як **tag identifier** (а не звичайного виклику функції чи стрічкового збігу).
  - Виклик: `parseSync(pathForLang, scan, { lang, sourceType: 'module' })`.
  - Очікувана відповідь — об'єкт `{ program, errors? }`, де `program` — корінь ESTree-сумісного AST.

### Внутрішні

- Цей модуль **не** імпортує жодних інших модулів проєкту. Це усвідомлене рішення: правила в `npm/rules/<rule>/` тримаються самодостатніми, щоб уникати cross-rule імпортів. Аналогічний (паралельний) екстрактор `<script>` блоків існує в `rules/vue/js/packages/vue-forbidden-imports.mjs` — модулі не діляться кодом.

### Зовнішні споживачі (де модуль використовується)

Експортовані функції призначені для виклику з шарів інтеграції правила `graphql.mdc` (наприклад, скриптів-перевірок `check-*.mjs` у правилі `graphql`). Конкретний caller у цьому файлі не описаний — він зовнішній відносно модуля.

## Потік виконання / Використання

### Типовий потік для одного файлу

1. Caller обходить файли проєкту (наприклад, через `git ls-files`).
2. Для кожного шляху викликає `isGqlScanSourceFile(relativePath)`. Якщо `false` — пропустити.
3. Викликає `shouldSkipFileForGqlScan(relativePosix)`. Якщо `true` (наприклад, це `*.d.ts` або `auto-imports.d.ts`/`components.d.ts`) — пропустити.
4. Читає вміст файлу з диска (як рядок UTF-8) — це робить caller, не цей модуль.
5. Викликає `sourceFileHasGqlTaggedTemplate(content, relativePath)`:
   - Для `.vue` — вирізаються блоки `<script>`/`<script setup>`, склеюються через `\n\n`, парсяться як TypeScript.
   - Для решти — парситься увесь вміст з мовою, виведеною з розширення.
   - Помилки парсера (як у `result.errors`, так і у вигляді винятків) тихо повертають `false`.
6. Якщо повернулось `true` — caller знає, що у файлі є `` gql`…` ``-літерал, і може застосувати свою логіку правила (наприклад, обов'язково винести запит у `.gql`/`.graphql` файл, або навпаки — це очікувано і допустимо).

### Приклад (псевдокод використання)

```js
import { isGqlScanSourceFile, shouldSkipFileForGqlScan, sourceFileHasGqlTaggedTemplate } from './graphql-gql-scan.mjs'
import { readFile } from 'node:fs/promises'

/**
 *
 */
async function findFilesWithGqlTag(relativePaths) {
  const hits = []
  for (const rel of relativePaths) {
    if (!isGqlScanSourceFile(rel)) continue
    if (shouldSkipFileForGqlScan(rel)) continue
    const content = await readFile(rel, 'utf8')
    if (sourceFileHasGqlTaggedTemplate(content, rel)) {
      hits.push(rel)
    }
  }
  return hits
}
```

### Семантичні гарантії

- **Тільки `Identifier` з ім'ям `gql`**: вираз виду `gql.foo\`…\``(MemberExpression як tag) **не** буде матчитися, тому що перевіряється`tag.type === 'Identifier'`. Це навмисно — правило ловить канонічну форму `` gql`…` ``.
- **Імпорт `gql`**: модуль не аналізує імпорти й не вимагає, щоб ідентифікатор `gql` був реально визначений у файлі — достатньо, що він використаний як тег. Перевірка походження тега — це справа окремих правил/перевірок (наприклад, `@apollo/client` vs `graphql-tag`).
- **`.vue` без `<script>`**: SFC без скриптових блоків матиме порожній вхід для парсера → `parseSync` поверне валідний порожній AST → `astContainsGqlTag` → `false`.
- **Невалідний код**: повертає `false` (як helpers `result.errors?.length`, так і try/catch). Це консервативна поведінка: краще пропустити, ніж дати false-positive.

## Rebuild Test

Цю секцію можна використати як «специфікацію»: за наведеним нижче переліком сигнатур, констант та поведінкових тверджень файл `graphql-gql-scan.mjs` можна перевідтворити з нуля.

**Імпорти**:

- Іменований імпорт `parseSync` з `'oxc-parser'`.

**Module-scope константи**:

- `VUE_EXTENSION_RE = /\.vue$/u`
- `SOURCE_FILE_RE = /\.(vue|[cm]?[jt]sx?)$/u`
- `VUE_SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi`

**Функції (порядок як у файлі)**:

1. `function extractVueScriptBlocks(sfc)` — приватна. Скидає `VUE_SCRIPT_BLOCK_RE.lastIndex = 0`; у циклі `while` викликає `VUE_SCRIPT_BLOCK_RE.exec(sfc)`; складає захоплення `m[1]` у масив `chunks`; повертає `chunks.join('\n\n')`.
2. `function contentForGqlScan(content, filePath)` — приватна. Якщо `filePath.endsWith('.vue')` → `extractVueScriptBlocks(content)`; інакше → `content`.
3. `function langFromPath(filePath)` — приватна. `lower = filePath.toLowerCase()`; повертає `'tsx' | 'ts' | 'jsx' | 'js'` за пріоритетом `.tsx`, `.ts|.mts|.cts`, `.jsx`, інакше `js`.
4. `function virtualPathForParse(relativePath)` — приватна. Якщо `.vue` → `replace(VUE_EXTENSION_RE, '.ts')`; інакше — без змін.
5. `function astContainsGqlTag(node)` — приватна, рекурсивна. Послідовність перевірок: `null`/`undefined` → `false`; не object → `false`; масив → `some` рекурсивно; `node.type === 'TaggedTemplateExpression'` і `node.tag?.type === 'Identifier'` і `node.tag.name === 'gql'` → `true`; інакше для кожного `key` з `Object.keys(node)`, окрім `loc` і `range`, рекурсивна перевірка; за замовчуванням → `false`.
6. `export function sourceFileHasGqlTaggedTemplate(content, relativePath)` — головна перевірка: `scan = contentForGqlScan(content, relativePath)`; `pathForLang = virtualPathForParse(relativePath)`; `lang = langFromPath(pathForLang)`; в `try`: `result = parseSync(pathForLang, scan, { lang, sourceType: 'module' })`, якщо `result.errors?.length` → `false`, інакше `astContainsGqlTag(result.program)`; у `catch` → `false`.
7. `export function isGqlScanSourceFile(relativePath)` — повертає `SOURCE_FILE_RE.test(relativePath)`.
8. `export function shouldSkipFileForGqlScan(relativePosix)` — обчислює `base = relativePosix.split('/').pop() || ''`; якщо `base === 'auto-imports.d.ts'` або `base === 'components.d.ts'` → `true`; якщо `relativePosix.endsWith('.d.ts')` → `true`; інакше `false`.

**Експортується** саме три функції: `sourceFileHasGqlTaggedTemplate`, `isGqlScanSourceFile`, `shouldSkipFileForGqlScan`. Default-експорту немає.

**Поведінкові інваріанти**:

- Чисті функції (без I/O і без глобальних мутацій), окрім обережного скидання `lastIndex` на `VUE_SCRIPT_BLOCK_RE` перед `exec`-циклом.
- Будь-яка помилка парсера (як `errors` у відповіді, так і виняток) → результат `false`.
- Збіг лише на `Identifier`-тег з ім'ям `gql`; `gql.x\`…\`` **не** збігається.
- Ключі `loc` і `range` ігноруються при обході AST, інакше — обходяться всі property values.
