---
type: JS Module
title: redis-imports.mjs
resource: npm/rules/js-bun-redis/lib/redis-imports.mjs
docgen:
  crc: 887fc929
---

Модуль `redis-imports.mjs` — це сканер вихідного коду, який знаходить **заборонені** імпорти Redis-клієнтів (`ioredis`, `node-redis`, кореневий пакет `redis` та супутні підпакети сімейства `@redis/*`) у JavaScript/TypeScript-файлах. Метою сканера є **виявлення місць, які треба замінити на Bun native Redis** — стандартизований API `import { redis } from 'bun'` (див. `https://bun.com/docs/runtime/redis`).

Семантичне розпізнавання імпортів виконується через AST-парсер **`oxc-parser`** (а не regex по тілу файлу), тож сканер коректно відрізняє рядкові літерали, коментарі та реальні `import`/`require`. Підтримуються три форми входу модулів:

1. **Статичні ES-імпорти** — через `result.module.staticImports`.
2. **CommonJS `require('...')`** — через обхід AST і утиліту `requireCallModule`.
3. **Динамічні `import('...')`** — через обхід AST і утиліту `dynamicImportModule`.

Це дає змогу єдиним проходом покривати і ESM-код, і CommonJS, і змішані сценарії з динамічним підвантаженням у межах одного файлу.

Сканер є **частиною правила** `js-bun-redis.mdc` у системі правил `n-cursor` (директорія `npm/rules/js-bun-redis/`) і використовується чек-скриптами правила для пошуку порушень у пакетах монорепо.

Сканер **не вимагає**, щоб файл був синтаксично коректним: якщо `oxc-parser` повертає помилку або `result.errors` непорожній, функція повертає порожній масив порушень. Тобто спершу треба полагодити синтаксис, а вже потім перезапускати перевірку — інакше сканер просто «нічого не знайде».

## Експорти / API

Модуль експортує **три** іменовані функції:

| Експорт                                         | Тип        | Призначення                                                                                 |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `findRedisImportsInText(content, virtualPath?)` | `function` | Повертає масив знайдених заборонених імпортів Redis у переданому коді.                      |
| `isRedisScanSourceFile(relativePath)`           | `function` | Предикат: чи треба сканувати файл за розширенням (`.js/.mjs/.cjs/.jsx/.ts/.mts/.cts/.tsx`). |
| `shouldSkipFileForRedisScan(relativePosix)`     | `function` | Предикат: чи слід пропустити файл (декларації типів `.d.ts`).                               |

Default export відсутній.

## Функції

### `isForbiddenRedisModule(mod)` (внутрішня)

**Сигнатура:** `function isForbiddenRedisModule(mod: string): boolean`

**Параметри:**

- `mod` — рядкове значення специфікатора модуля з конструкцій `import '...'`, `require('...')` або `import('...')`.

**Повертає:** `true`, якщо `mod`:

- входить у множину точних збігів `FORBIDDEN_MODULE_NAMES`: `'ioredis'`, `'node-redis'`, `'redis'`, `'@redis/client'`, `'@redis/json'`, `'@redis/search'`, `'@redis/time-series'`, `'@redis/bloom'`;
- **або** починається з префіксу `'ioredis/'`, `'redis/'`, `'@redis/'` — для підшляхів (`ioredis/built/utils`, `redis/dist/...`, `@redis/<sub>`).

Інакше повертає `false`. Префіксний підхід **навмисно** ловить підшляхи Redis-пакетів, але **не зачіпає** сторонні пакети-сусіди типу `redis-mock` (бо вони не починаються з `redis/`, а саме з `redis-`).

**Side effects:** немає (чиста функція).

**Видимість:** локальна для модуля; не експортується.

### `findRedisImportsInText(content, virtualPath = 'scan.ts')`

**Сигнатура:**

```js
export function findRedisImportsInText(
  content: string,
  virtualPath?: string
): { line: number, snippet: string, module: string }[]
```

**Параметри:**

- `content` — повний текст вихідного файлу як рядок.
- `virtualPath` _(необовʼязковий, дефолт `'scan.ts'`)_ — шлях, який передається в парсер і використовується для визначення мови через `langFromPath(...)`. Може бути «віртуальним», тобто не існувати на ФС — потрібен лише для вибору режиму парсингу (наприклад, `.ts` vs `.tsx`). Якщо передати порожній рядок чи `undefined`, всередині буде підставлено `'scan.ts'`.

**Повертає:** масив обʼєктів-порушень, де кожен елемент має поля:

- `line: number` — 1-based номер рядка, де починається `import`/`require`/`import(...)` (через `offsetToLine(content, start)`);
- `snippet: string` — нормалізований фрагмент коду цього вузла (через `normalizeSnippet(content.slice(start, end))`);
- `module: string` — фактичний специфікатор модуля (`'ioredis'`, `'redis/dist/...'`, `'@redis/json'` тощо).

Якщо файл синтаксично некоректний (`parseSync` кинув виключення) або `result.errors` непорожній — повертає `[]`.

**Side effects:** немає (чиста функція; не звертається до ФС, не пише в stdout).

**Алгоритм:**

1. Обирає `lang` для парсера через `langFromPath(pathForLang)`.
2. Викликає `parseSync(pathForLang, content, { lang, sourceType: 'module' })` у `try/catch`.
3. Якщо парсинг кинув / повернув помилки — `return []`.
4. Проходить **статичні імпорти** через `result.module?.staticImports ?? []`; для кожного, де `imp.moduleRequest?.value` — рядок і `isForbiddenRedisModule(...)` істинне, додає запис у вихідний масив.
5. Проходить AST програми через `walkAstWithAncestors(result.program, [], node => {...})`:
   - якщо `requireCallModule(node)` повертає рядок із забороненим модулем — додає запис і **повертається** (`return`), щоб не дублювати спробу як динамічний `import` для того самого вузла;
   - інакше пробує `dynamicImportModule(node)` і так само додає запис при збігу.
6. Повертає накопичений масив `out`.

### `isRedisScanSourceFile(relativePath)`

**Сигнатура:** `export function isRedisScanSourceFile(relativePath: string): boolean`

**Параметри:**

- `relativePath` — відносний шлях до файлу.

**Повертає:** `true`, якщо шлях підпадає під регулярний вираз `SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u`, тобто має одне з розширень `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx`. Інакше — `false`.

**Side effects:** немає.

### `shouldSkipFileForRedisScan(relativePosix)`

**Сигнатура:** `export function shouldSkipFileForRedisScan(relativePosix: string): boolean`

**Параметри:**

- `relativePosix` — шлях з POSIX-роздільниками (`/`).

**Повертає:** `true`, якщо файл закінчується на `.d.ts` — декларації типів TypeScript не виконуваний код, у них не може бути «реальних» імпортів-споживачів Redis, тому їх сканувати не варто. Для решти файлів — `false`.

**Side effects:** немає.

## Залежності

### Зовнішні (npm)

- **`oxc-parser`** — використовується через іменований імпорт `parseSync` для отримання AST програми та переліку статичних імпортів модуля.

### Внутрішні (репозиторій)

Імпорт із `'../../../scripts/utils/ast-scan-utils.mjs'` — спільні утиліти AST-сканера для всіх правил у `npm/rules/*/lib/`:

- `dynamicImportModule(node)` — якщо вузол AST є динамічним `import('mod')`, повертає рядок `'mod'`, інакше `null`/`undefined`.
- `langFromPath(path)` — обчислює `lang` для `oxc-parser` за розширенням шляху.
- `normalizeSnippet(src)` — нормалізує сирий зріз коду (приведення пробілів/обрізання) для зручного звіту.
- `offsetToLine(content, offset)` — конвертує абсолютний offset символа у 1-based номер рядка.
- `requireCallModule(node)` — якщо вузол є викликом `require('mod')`, повертає рядок `'mod'`, інакше `null`/`undefined`.
- `walkAstWithAncestors(program, ancestors, visitor)` — обхід AST програми з накопиченням предків.

### Константи модуля

- `SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u` — регекс розширень JS/TS-сімʼї.
- `FORBIDDEN_MODULE_NAMES` — `Set<string>` із вісьмома точними іменами заборонених модулів.

## Потік виконання / Використання

### Типовий сценарій

1. Обхідник пакета монорепо отримує список файлів через `readdir/walk`.
2. Для кожного файлу:
   - перевіряє `shouldSkipFileForRedisScan(relativePosix)` → якщо `true`, файл пропускається (наприклад, `*.d.ts`);
   - перевіряє `isRedisScanSourceFile(relativePosix)` → якщо `false`, файл пропускається (нерелевантне розширення);
   - інакше читає вміст файлу та викликає `findRedisImportsInText(content, virtualPath)`.
3. Отриманий масив порушень агрегується у звіт правила `js-bun-redis`.

### Приклад

```js
import { readFileSync } from 'node:fs'
import { findRedisImportsInText, isRedisScanSourceFile, shouldSkipFileForRedisScan } from './redis-imports.mjs'

const file = 'pkg/src/cache.ts'
if (!shouldSkipFileForRedisScan(file) && isRedisScanSourceFile(file)) {
  const content = readFileSync(file, 'utf8')
  const violations = findRedisImportsInText(content, file)
  for (const v of violations) {
    console.log(`${file}:${v.line} forbidden import of ${v.module} -> ${v.snippet}`)
  }
}
```

### Що саме розпізнається як порушення

Усі наступні форми у `cache.ts` будуть знайдені:

```ts
import Redis from 'ioredis' // ESM static, точна назва
import { createClient } from 'redis' // ESM static, кореневий node-redis
import json from '@redis/json' // ESM static, підпакет @redis/*
import utils from 'ioredis/built/utils' // ESM static, підшлях ioredis/
const Redis2 = require('ioredis') // CommonJS require
const lib = await import('node-redis') // динамічний ESM import
```

А ось такі **не** будуть позначені (бо це сторонні пакети):

```ts
import { mock } from 'redis-mock' // not ioredis/redis/@redis
import x from 'my-redis-helpers' // довільний сторонній пакет
```

### Поведінка на помилках

- Якщо `parseSync` кинув виняток — порожній результат `[]`.
- Якщо `result.errors?.length` істинний — порожній результат `[]`.
- Користувач має спершу полагодити синтаксис файлу, тільки тоді повторно запускати перевірку.

### Інтеграція з правилом

Модуль є **бібліотечним** шаром (`lib/`) правила `js-bun-redis`. Чек-скрипт правила (типово `npm/rules/js-bun-redis/check-*.mjs`) імпортує ці три функції, обходить файли пакета і формує звіт. Заміна — на Bun native Redis (`import { redis } from 'bun'`).

## Rebuild Test

Контрольний перелік, за яким можна **відтворити** функціонал модуля «з нуля»:

1. Створити файл `redis-imports.mjs`, що імпортує `parseSync` з `oxc-parser`.
2. Імпортувати з `'../../../scripts/utils/ast-scan-utils.mjs'` шість утиліт: `dynamicImportModule`, `langFromPath`, `normalizeSnippet`, `offsetToLine`, `requireCallModule`, `walkAstWithAncestors`.
3. Оголосити константу `SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u`.
4. Оголосити константу `FORBIDDEN_MODULE_NAMES` як `Set` із елементами: `'ioredis'`, `'node-redis'`, `'redis'`, `'@redis/client'`, `'@redis/json'`, `'@redis/search'`, `'@redis/time-series'`, `'@redis/bloom'`.
5. Реалізувати приватну функцію `isForbiddenRedisModule(mod)`: повертає `true`, якщо `FORBIDDEN_MODULE_NAMES.has(mod)` **або** `mod.startsWith('ioredis/')` **або** `mod.startsWith('redis/')` **або** `mod.startsWith('@redis/')`.
6. Експортувати функцію `findRedisImportsInText(content, virtualPath = 'scan.ts')`:
   1. `pathForLang = virtualPath || 'scan.ts'`;
   2. `lang = langFromPath(pathForLang)`;
   3. у `try { parseSync(pathForLang, content, { lang, sourceType: 'module' }) } catch { return [] }`;
   4. якщо `result.errors?.length` — `return []`;
   5. ініціалізувати `out = []`;
   6. пройти `result.module?.staticImports ?? []` — для кожного, де `imp.moduleRequest?.value` рядок і `isForbiddenRedisModule(...)` істинне, пушити `{ line: offsetToLine(content, imp.start), snippet: normalizeSnippet(content.slice(imp.start, imp.end)), module: mod }`;
   7. викликати `walkAstWithAncestors(result.program, [], node => {...})`:
      - спершу спробувати `requireCallModule(node)`; на збігу пушити запис і `return`;
      - потім `dynamicImportModule(node)`; на збігу пушити запис;
   8. повернути `out`.
7. Експортувати функцію `isRedisScanSourceFile(relativePath)`: `return SOURCE_FILE_RE.test(relativePath)`.
8. Експортувати функцію `shouldSkipFileForRedisScan(relativePosix)`: `return relativePosix.endsWith('.d.ts')`.

Контрольні очікування:

- Виклик `findRedisImportsInText("import x from 'ioredis'", 'a.ts')` повертає масив із одного елемента, де `module === 'ioredis'`, `line === 1`.
- Виклик `findRedisImportsInText("import x from 'redis-mock'", 'a.ts')` повертає `[]`.
- Виклик `findRedisImportsInText("const r = require('@redis/json')", 'a.js')` повертає масив із одного елемента, де `module === '@redis/json'`.
- Виклик `findRedisImportsInText("await import('redis/dist/x')", 'a.mjs')` повертає масив із одного елемента, де `module === 'redis/dist/x'`.
- Виклик `findRedisImportsInText("import 'ioredis'; syntax error here {{", 'a.ts')` повертає `[]` (через помилку парсингу/`errors`).
- `isRedisScanSourceFile('foo.ts')` → `true`; `isRedisScanSourceFile('foo.md')` → `false`.
- `shouldSkipFileForRedisScan('types/foo.d.ts')` → `true`; `shouldSkipFileForRedisScan('src/foo.ts')` → `false`.
