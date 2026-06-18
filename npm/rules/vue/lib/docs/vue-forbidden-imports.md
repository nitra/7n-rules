---
type: JS Module
title: vue-forbidden-imports.mjs
resource: npm/rules/vue/lib/vue-forbidden-imports.mjs
docgen:
  crc: 946eb1a6
---

Модуль `vue-forbidden-imports.mjs` — це бібліотека статичного аналізу `import`-декларацій, призначена для виявлення двох категорій порушень у вихідному коді Vue-проєкту:

1. **Явні (runtime) імпорти з модуля `vue`** у будь-яких файлах, що сканує правило. За конвенцією `vue.mdc` у проєкті працює `unplugin-auto-import`, тому імпорти `ref`, `computed`, `watch` тощо мають бути неявними. Дозволено лише: side-effect форму (`import 'vue'`), повністю type-only імпорти (`import type { ... } from 'vue'`) та змішані форми, де **всі** іменовані записи мають флаг `isType` (наприклад, `import { type A, type B } from 'vue'`).
2. **Імпорти Node-нативних модулів усередині `.vue` SFC** — `node:fs`, `node:timers/promises`, а також bare-форми вбудованих модулів (`fs`, `path`, `crypto`, `fs/promises` тощо). Vue Single-File Components виконуються в браузерному середовищі, де Node API недоступне, тому такі імпорти зривають збірку чи призводять до runtime-помилок.

Аналіз виконується через **oxc-parser** (`parseSync`) — ESTree-сумісний AST-парсер, що повертає об'єкт із полем `module.staticImports`. Це усуває потребу в крихких регулярних виразах для розпізнавання структури імпортів і коректно обробляє TypeScript-синтаксис (включно з type-only записами через флаг `entries[].isType`).

Для `.vue` файлів виконується попередній етап: регулярним виразом витягуються вмісти всіх тегів `<script>` / `<script setup>` (template ігнорується), і вже цей конкатенований код подається парсеру з віртуальним ім'ям `*.ts`, щоб увімкнути TypeScript-режим.

Модуль чисто функціональний: жодних звернень до файлової системи, мережі чи глобального стану — усі функції приймають уже прочитаний контент і повертають структуровані дані про порушення.

## Експорти / API

Усі експорти — іменовані (named exports), default export відсутній.

| Експорт                                                      | Тип      | Призначення                                                                          |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `extractVueScriptBlocks(sfc)`                                | function | Витягує конкатенований код усіх `<script>` блоків з `.vue` SFC.                      |
| `contentForVueImportScan(content, filePath)`                 | function | Повертає текст для сканування: для `.vue` — лише script-блоки, інакше — увесь вміст. |
| `findForbiddenVueImportsInText(content, virtualPath?)`       | function | Знаходить заборонені static-імпорти з `vue` у вже підготовленому тексті.             |
| `shouldSkipFileForVueImportScan(relativePosix)`              | function | Чи пропустити файл під час обходу пакета (генерація, `.d.ts`).                       |
| `isVueImportScanSourceFile(relativePath)`                    | function | Чи розширення файлу підходить для сканування.                                        |
| `findForbiddenVueImportsInSourceFile(content, relativePath)` | function | Об'єднує підготовку контенту та парсинг для одного файлу.                            |
| `isNodeBuiltinSpecifier(spec)`                               | function | Чи специфікатор імпорту відповідає Node-нативному модулю.                            |
| `findForbiddenNodeImportsInText(content, virtualPath?)`      | function | Знаходить заборонені Node-імпорти у тексті.                                          |
| `findForbiddenNodeImportsInVueFile(content, relativePath)`   | function | Знаходить заборонені Node-імпорти лише у `.vue` файлах (template ігнорується).       |

Внутрішні (не експортовані) допоміжні функції: `langFromPath`, `offsetToLine`, `normalizeSnippet`, `isAllowedVueStaticImport`, `virtualPathForParse`.

Внутрішні (не експортовані) константи:

- `NODE_BUILTIN_MODULES` — `Set<string>` з повного списку `builtinModules` Node.js на момент запуску (наприклад, `fs`, `path`, `crypto`, ...).
- `VUE_EXT_RE` — регекс `/\.vue$/u` для перевірки розширення `.vue`.
- `SOURCE_FILE_RE` — регекс `/\.(vue|[cm]?[jt]sx?)$/`, що покриває `.vue`, `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`.

## Функції

### `langFromPath(filePath)` — внутрішня

- **Сигнатура:** `(filePath: string) => 'js' | 'jsx' | 'ts' | 'tsx'`
- **Параметри:**
  - `filePath` — віртуальний або реальний шлях; розпізнавання йде за суфіксом у lowercase.
- **Повертає:** значення опції `lang` для `parseSync`. Розширення `.ts`, `.mts`, `.cts` → `'ts'`; `.tsx` → `'tsx'`; `.jsx` → `'jsx'`; решта (включно з `.js`, `.mjs`, `.cjs`, відсутність розширення) → `'js'`.
- **Side effects:** немає.

### `offsetToLine(content, offset)` — внутрішня

- **Сигнатура:** `(content: string, offset: number) => number`
- **Параметри:**
  - `content` — повний текст файлу.
  - `offset` — байтове зміщення (точніше — індекс кодової одиниці UTF-16) початку фрагмента.
- **Повертає:** 1-based номер рядка для зміщення. Алгоритм лінійно проходить діапазон `[0, min(offset, content.length))` і збільшує лічильник для кожного `\n` (code point `10`).
- **Side effects:** немає.

### `normalizeSnippet(s)` — внутрішня

- **Сигнатура:** `(s: string) => string`
- **Параметри:**
  - `s` — довільний фрагмент коду.
- **Повертає:** однорядковий рядок: усі послідовності whitespace замінено одним пробілом, обрізано початкові/кінцеві пробіли, обмежено перші 160 символів.
- **Side effects:** немає.

### `isAllowedVueStaticImport(imp)` — внутрішня

- **Сигнатура:** `(imp: { moduleRequest: { value: string }, entries: { isType: boolean }[] }) => boolean`
- **Параметри:**
  - `imp` — один запис із масиву `module.staticImports`, отриманого від `parseSync`.
- **Повертає:** `true`, якщо:
  - `entries.length === 0` (це `import 'vue'` — side-effect форма), **або**
  - усі `entries` мають `isType === true` (повністю type-only або змішана форма з `import { type X } from 'vue'`).
- **Side effects:** немає.

### `extractVueScriptBlocks(sfc)` — експортована

- **Сигнатура:** `(sfc: string) => string`
- **Параметри:**
  - `sfc` — повний вміст `.vue` файлу.
- **Повертає:** конкатенацію (роздільник `\n\n`) тіл усіх знайдених `<script>` блоків. Регекс `/<script\b[^>]*>([\s\S]*?)<\/script>/gi` дозволяє атрибути після `<script` (наприклад, `setup`, `lang="ts"`, `generic="T"`) і не чіпає шаблон `<template>` чи стилі `<style>`.
- **Side effects:** немає.

### `contentForVueImportScan(content, filePath)` — експортована

- **Сигнатура:** `(content: string, filePath: string) => string`
- **Параметри:**
  - `content` — сирий вміст файлу.
  - `filePath` — шлях, потрібний лише для перевірки суфікса `.vue`.
- **Повертає:** для `.vue` — результат `extractVueScriptBlocks(content)`; інакше — `content` без змін.
- **Side effects:** немає.

### `virtualPathForParse(relativePath)` — внутрішня

- **Сигнатура:** `(relativePath: string) => string`
- **Параметри:**
  - `relativePath` — шлях файлу в пакеті/репо.
- **Повертає:** якщо суфікс `.vue` — той самий шлях із заміною `.vue` на `.ts` (для `langFromPath` → `'ts'`); інакше — шлях без змін.
- **Side effects:** немає.

### `findForbiddenVueImportsInText(content, virtualPath?)` — експортована

- **Сигнатура:** `(content: string, virtualPath?: string) => { line: number, snippet: string }[]`
- **Параметри:**
  - `content` — вже підготовлений текст для парсингу (для `.vue` — лише `<script>` блоки).
  - `virtualPath` — необов'язковий шлях для вибору `lang`. Значення за замовчуванням — `'scan.ts'` (TypeScript-режим). Якщо передано порожнє/falsy значення — використовується той самий fallback `'scan.ts'`.
- **Повертає:** масив об'єктів `{ line, snippet }`, де:
  - `line` — 1-based номер рядка, де починається `import`,
  - `snippet` — стиснений однорядковий фрагмент тексту `content.slice(imp.start, imp.end)` (≤ 160 символів).
- **Поведінка:**
  - У разі будь-якої exception з `parseSync` (`try/catch`) повертає `[]`.
  - Якщо `result.errors?.length > 0` — повертає `[]` (тобто за наявності синтаксичних помилок порушення не репортяться; коментар у файлі прямо радить «спочатку виправ синтаксис»).
  - Інакше проходить `result.module.staticImports` і додає в результат запис, якщо `moduleRequest.value === 'vue'` **і** `!isAllowedVueStaticImport(imp)`.
- **Side effects:** немає (читання Node-builtins трапилось лише на старті модуля).

### `shouldSkipFileForVueImportScan(relativePosix)` — експортована

- **Сигнатура:** `(relativePosix: string) => boolean`
- **Параметри:**
  - `relativePosix` — шлях файлу з posix-слешами (форвард-слеш як роздільник).
- **Повертає:** `true`, якщо:
  - basename дорівнює `auto-imports.d.ts` або `components.d.ts` (типові згенеровані файли від `unplugin-auto-import` / `unplugin-vue-components`), **або**
  - шлях закінчується на `.d.ts` (будь-який type-declaration файл).
- **Side effects:** немає.

### `isVueImportScanSourceFile(relativePath)` — експортована

- **Сигнатура:** `(relativePath: string) => boolean`
- **Параметри:**
  - `relativePath` — відносний шлях.
- **Повертає:** `true`, якщо суфікс файлу відповідає `SOURCE_FILE_RE` (тобто `.vue`, `.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.cts`, `.mts`, `.tsx`).
- **Side effects:** немає.

### `findForbiddenVueImportsInSourceFile(content, relativePath)` — експортована

- **Сигнатура:** `(content: string, relativePath: string) => { line: number, snippet: string }[]`
- **Параметри:**
  - `content` — сирий вміст файлу.
  - `relativePath` — шлях відносно кореня пакета чи репо.
- **Повертає:** результат `findForbiddenVueImportsInText(scan, virtualPath)`, де:
  - `scan = contentForVueImportScan(content, relativePath)` — для `.vue` витягнуті `<script>` блоки, для решти — `content`;
  - `virtualPath = virtualPathForParse(relativePath)` — для `.vue` замінено суфікс на `.ts`, для решти — без змін.
- **Side effects:** немає.

### `isNodeBuiltinSpecifier(spec)` — експортована

- **Сигнатура:** `(spec: string) => boolean`
- **Параметри:**
  - `spec` — значення `moduleRequest.value` (текст специфікатора імпорту).
- **Повертає:** `true`, якщо специфікатор — Node-нативний модуль. Послідовність перевірок:
  1. Якщо `spec` не рядок або порожній → `false`.
  2. Префікс `node:` → `true` (покриває `node:fs`, `node:timers/promises`, `node:test` тощо).
  3. Точне співпадіння в `NODE_BUILTIN_MODULES` → `true` (наприклад, `fs`, `path`, `crypto`).
  4. Якщо є слеш на позиції > 0 — перевірити «head» (`spec.slice(0, slashIdx)`); якщо head у `NODE_BUILTIN_MODULES` → `true` (покриває підшляхи на кшталт `fs/promises`, `stream/web`, `timers/promises`).
  5. Інакше → `false`.
- **Side effects:** немає.

### `findForbiddenNodeImportsInText(content, virtualPath?)` — експортована

- **Сигнатура:** `(content: string, virtualPath?: string) => { line: number, snippet: string, specifier: string }[]`
- **Параметри:**
  - `content` — підготовлений текст (для `.vue` — `<script>` блоки).
  - `virtualPath` — шлях для вибору `lang`. Default — `'scan.ts'`; при falsy використовується той самий fallback.
- **Повертає:** масив `{ line, snippet, specifier }`. Структура `line` / `snippet` ідентична `findForbiddenVueImportsInText`; поле `specifier` — це сирий рядок з `imp.moduleRequest.value` (наприклад, `'node:fs'` або `'fs/promises'`).
- **Поведінка:**
  - Парсинг через `parseSync(pathForLang, content, { lang, sourceType: 'module' })` всередині `try/catch` — будь-яка exception → `[]`.
  - Якщо `result.errors?.length > 0` → `[]`.
  - Для кожного `imp` із `result.module.staticImports` перевіряється `isNodeBuiltinSpecifier(spec)`; при `true` додається запис у результат.
  - Зверніть увагу: правило репортить **усі** Node-імпорти у Vue-контексті, у тому числі type-only (`import type { Stats } from 'fs'`) — коментар у вихідному коді пояснює, що type-only імпорти Node-модулів у SFC заплутують і доцільніше тримати такий код у server-side утилітах.
- **Side effects:** немає.

### `findForbiddenNodeImportsInVueFile(content, relativePath)` — експортована

- **Сигнатура:** `(content: string, relativePath: string) => { line: number, snippet: string, specifier: string }[]`
- **Параметри:**
  - `content` — сирий вміст файлу.
  - `relativePath` — шлях відносно кореня пакета чи репо.
- **Повертає:**
  - Якщо суфікс не `.vue` → `[]` (правило стосується лише SFC; композаблі та утиліти на Node-side можуть жити у `.ts`/`.js`).
  - Інакше: `findForbiddenNodeImportsInText(extractVueScriptBlocks(content), virtualPathForParse(relativePath))`.
- **Side effects:** немає.

## Залежності

### Зовнішні модулі

- **`node:module` (Node.js builtin)** — імпортується `builtinModules` для формування `NODE_BUILTIN_MODULES`. Список фіксується на момент запуску модуля (одноразово).
- **`oxc-parser`** — `parseSync(filename, source, options)`. Очікувані опції:
  - `lang: 'js' | 'jsx' | 'ts' | 'tsx'` — обирається `langFromPath`;
  - `sourceType: 'module'` — фіксовано як ES-module.
  - Результат використовується через:
    - `result.errors` — масив синтаксичних помилок; за наявності повертається `[]`;
    - `result.module.staticImports` — масив записів виду `{ moduleRequest: { value }, entries: [{ isType }], start, end }`.

### Внутрішні залежності між функціями цього файлу

- `findForbiddenVueImportsInSourceFile` → `contentForVueImportScan`, `virtualPathForParse`, `findForbiddenVueImportsInText`.
- `findForbiddenVueImportsInText` → `langFromPath`, `offsetToLine`, `normalizeSnippet`, `isAllowedVueStaticImport`.
- `findForbiddenNodeImportsInVueFile` → `extractVueScriptBlocks`, `virtualPathForParse`, `findForbiddenNodeImportsInText`.
- `findForbiddenNodeImportsInText` → `langFromPath`, `offsetToLine`, `normalizeSnippet`, `isNodeBuiltinSpecifier`.
- `contentForVueImportScan` → `extractVueScriptBlocks`.
- `isNodeBuiltinSpecifier` → `NODE_BUILTIN_MODULES`.

### Зовнішні споживачі (за конвенцією)

Файл лежить у `npm/rules/vue/lib/` і призначений для використання з `check-*.mjs` сценаріїв правила `n-vue`-родини. Сценарії-перевірки самі обходять пакети, читають файли з диска, фільтрують їх через `shouldSkipFileForVueImportScan` та `isVueImportScanSourceFile`, і викликають `findForbiddenVueImportsInSourceFile` / `findForbiddenNodeImportsInVueFile`.

## Потік виконання / Використання

### Типовий потік для сканера-перевірки

1. Сценарій-перевірка обходить файли в пакеті, отримуючи `(relativePath, absolutePath)`.
2. Фільтрація:
   - `if (shouldSkipFileForVueImportScan(relativePosix)) continue;` — пропустити `.d.ts` і згенеровані файли.
   - `if (!isVueImportScanSourceFile(relativePath)) continue;` — пропустити не-source файли (скажімо, `.json`, `.md`).
3. Прочитати `content = fs.readFileSync(absolutePath, 'utf8')`.
4. Знайти порушення:
   - `const vueViolations = findForbiddenVueImportsInSourceFile(content, relativePath);`
   - `const nodeViolations = findForbiddenNodeImportsInVueFile(content, relativePath);`
5. Якщо масиви непорожні — зрепортити користувачу: `relativePath:${line}` + `snippet` (+ `specifier` для Node-порушень).

### Точкове використання

- **Тільки сирий код (без файлів):** виклик `findForbiddenVueImportsInText(code, 'scan.ts')` або `findForbiddenNodeImportsInText(code, 'scan.ts')` напряму — корисно для unit-тестів модуля.
- **Лише витяг `<script>` блоків:** `extractVueScriptBlocks(sfc)` повертає конкатенований код; зручно для інших сканерів, що працюють лише з JS/TS-частиною SFC.

### Контракти й тонкі моменти

- **Помилки парсингу = «не репортимо».** Якщо `parseSync` кинув exception **або** повернув `result.errors.length > 0`, обидві `find*InText` функції повертають `[]`. Це навмисний дизайн: правило не намагається лагодити синтаксис — спочатку файл має бути коректним, тоді сканер дасть осмислений вихід.
- **Default `virtualPath = 'scan.ts'`.** Без передачі `virtualPath` режим парсингу — TypeScript. Це безпечно і для чистого JS (TS-парсер приймає JS-синтаксис), і дозволяє type-only синтаксис.
- **Type-only синтаксис у `vue` дозволено.** `import type { Ref } from 'vue'` і `import { type Ref } from 'vue'` пройдуть перевірку через `entries[].isType === true`. Це не суперечить ідеї auto-import: типи завжди потрібно імпортувати явно.
- **Type-only синтаксис у Node-імпортах НЕ дозволено.** Для `.vue` навіть `import type { Stats } from 'fs'` буде в результаті — модуль не розглядає `isType` для Node-перевірки.
- **`offsetToLine` рахує `\n` посимвольно.** Складність `O(offset)`. На великих файлах із багатьма імпортами це сумарно `O(N·M)`, але на практиці прийнятно (файли SFC рідко > 10k рядків).
- **`normalizeSnippet` обмежує 160 символів** і стискає whitespace — формат повідомлення про порушення стабільний, незалежно від форматування у коді.

## Rebuild Test

За цією документацією має бути можливо відновити функціональний еквівалент модуля. Контрольні точки відтворення:

- **Експорти:** `extractVueScriptBlocks`, `contentForVueImportScan`, `findForbiddenVueImportsInText`, `shouldSkipFileForVueImportScan`, `isVueImportScanSourceFile`, `findForbiddenVueImportsInSourceFile`, `isNodeBuiltinSpecifier`, `findForbiddenNodeImportsInText`, `findForbiddenNodeImportsInVueFile` — усі named, default відсутній.
- **Регулярні вирази:**
  - `<script>` екстрактор: `/<script\b[^>]*>([\s\S]*?)<\/script>/gi`.
  - `.vue` суфікс: `/\.vue$/u`.
  - Source files: `/\.(vue|[cm]?[jt]sx?)$/`.
- **Skip-файли:** basename `auto-imports.d.ts` / `components.d.ts` або суфікс `.d.ts`.
- **`langFromPath` мапінг:** `.tsx`→`tsx`; `.ts|.mts|.cts`→`ts`; `.jsx`→`jsx`; default→`js` (через lowercase порівняння суфіксів).
- **Vue allow-list:** порожній `entries` (side-effect `import 'vue'`) або `entries.every(e => e.isType)`.
- **Node-builtin перевірка:**
  1. Не рядок або порожній → `false`.
  2. `startsWith('node:')` → `true`.
  3. У `Set(builtinModules)` → `true`.
  4. Якщо є слеш (індекс > 0) і head у Set → `true`.
  5. Інакше → `false`.
- **Парсер:** `parseSync(virtualPath, content, { lang, sourceType: 'module' })`; обробка `try/catch` + перевірка `result.errors?.length`.
- **Результат-формат:** Vue-порушення — `{ line, snippet }`; Node-порушення — `{ line, snippet, specifier }`.
- **Default `virtualPath`:** `'scan.ts'` (включно з fallback при falsy значенні).
- **`findForbiddenNodeImportsInVueFile` гарантія:** для не-`.vue` повертає `[]` навіть якщо файл містить Node-імпорти.
- **`virtualPathForParse`:** `.vue` → той самий шлях з суфіксом `.ts`; інакше — без змін.
- **Snippet:** `replaceAll(/\s+/g, ' ').trim().slice(0, 160)`.
- **`offsetToLine`:** 1-based, лічить `\n` (code point 10) у діапазоні `[0, min(offset, length))`.
