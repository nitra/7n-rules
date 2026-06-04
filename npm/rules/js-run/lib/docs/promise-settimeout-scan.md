# promise-settimeout-scan.mjs

## Огляд

Модуль `promise-settimeout-scan.mjs` — це AST-сканер, який виявляє у вихідному коді JavaScript/TypeScript антипаттерн «обгортка `setTimeout` у `new Promise`» виду:

```js
new Promise(resolve => setTimeout(resolve, ms))
// або
await new Promise(resolve => setTimeout(resolve, ms))
```

Згідно з правилом `js-run.mdc` (секція «Паузи через `setTimeout`») такий код потрібно замінити на ідіоматичний імпорт із `node:timers/promises`:

```js
import { setTimeout as sleep } from 'node:timers/promises'
await sleep(ms)
```

Сканер працює **структурно** (по AST), без regex-у по тілу: шукає `NewExpression`, у якого callee — Identifier `Promise`, а єдиний аргумент — функція з одним параметром-resolve, тіло якої — єдиний виклик `setTimeout(<resolve>, ms)`. Перший аргумент `setTimeout` мусить бути «голим» resolve — або сам ідентифікатор, або тривіальна безпараметрична обгортка `() => resolve()` / `function () { resolve() }` без жодних переданих аргументів. Якщо у виклик `resolve` передається значення — це вже не «чиста пауза», і паттерн **не** вмикається.

Сканер **толерантний до синтаксичних помилок**: якщо файл не парситься, повертається порожній список (узгоджено з рештою AST-сканерів проєкту — спочатку треба полагодити синтаксис, а вже потім ловити структурні порушення).

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `findPromiseSetTimeoutInText` | `function` | Знаходить усі входження антипаттерну в тексті, повертає масив `{ line, snippet }`. |
| `isPromiseSetTimeoutScanSourceFile` | `function` | Фільтр по відносному шляху: чи варто взагалі сканувати цей файл (за розширенням). |

Внутрішні (не експортовані) хелпери, які формують ядро аналізу:

- `isBareResolveCallback(arg, paramName)` — перевірка «чистоти» першого аргументу `setTimeout`.
- `extractSingleCallExpression(body)` — витягнення єдиного `CallExpression` з тіла функції.
- `isPromiseSetTimeoutDelay(node)` — головний предикат паттерну на рівні `NewExpression`.
- `walkAst(node, visit)` — простий рекурсивний обхід AST.

Константа модульного рівня:

- `SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/` — regex розширень JS/TS-сім'ї (`.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, `.jsx`, `.tsx`).

## Функції

### `findPromiseSetTimeoutInText(content, virtualPath = 'scan.ts')`

**Призначення.** Публічна точка входу: парсить вихідний код, обходить AST і збирає всі позиції, де знайдено антипаттерн «`new Promise(... setTimeout ...)`».

**Сигнатура.**

```js
export function findPromiseSetTimeoutInText(
  content: string,
  virtualPath?: string
): { line: number, snippet: string }[]
```

**Параметри.**

- `content: string` — повний текст файлу для сканування.
- `virtualPath: string` (за замовчуванням `'scan.ts'`) — віртуальний шлях, який передається у `parseProgramOrNull` для вибору мови парсера (TS/JSX тощо). Не використовується для read/write-у на диск; впливає лише на режим парсингу.

**Повертає.** Масив об'єктів `{ line: number, snippet: string }` — по одному запису на кожне виявлене порушення:

- `line` — 1-based номер рядка, де починається `NewExpression` (через `offsetToLine`).
- `snippet` — нормалізований текст самого `new Promise(...)`-виразу (через `normalizeSnippet`).

Якщо AST не побудувався (синтаксична помилка), повертає порожній масив `[]`.

**Side effects.** Чиста функція — жодного I/O, читання env, мутацій глобального стану. Усі дані повертаються через return value.

---

### `isPromiseSetTimeoutScanSourceFile(relativePath)`

**Призначення.** Фільтр для зовнішнього раннера/обхідника файлів: чи варто взагалі парсити цей файл.

**Сигнатура.**

```js
export function isPromiseSetTimeoutScanSourceFile(
  relativePath: string
): boolean
```

**Параметри.**

- `relativePath: string` — відносний шлях до файлу (наприклад, `src/utils/sleep.ts`).

**Повертає.** `true`, якщо:

1. Розширення збігається з `SOURCE_FILE_RE` (JS/TS-сім'я), **та**
2. Шлях **не** закінчується на `.d.ts` (декларації типів пропускаються).

Інакше — `false`.

**Side effects.** Немає.

---

### `isBareResolveCallback(arg, paramName)` (внутрішня)

**Призначення.** Перевіряє, що перший аргумент `setTimeout` — це або сам ідентифікатор `resolve`, або тривіальна безпараметрична обгортка, яка викликає `resolve()` без значення.

**Сигнатура.**

```js
function isBareResolveCallback(
  arg: Record<string, unknown> | null | undefined,
  paramName: string
): boolean
```

**Параметри.**

- `arg` — AST-вузол першого аргументу виклику `setTimeout`.
- `paramName` — ім'я параметра-resolve у тіла-функції `Promise` (зазвичай `'resolve'`, але приймається будь-яке ім'я-Identifier).

**Повертає.** `true`, якщо аргумент — це:

- `Identifier` з іменем `paramName` (наприклад, `setTimeout(resolve, ms)`); **або**
- `ArrowFunctionExpression` / `FunctionExpression` без параметрів, тіло якого — рівно один `CallExpression`, callee — `Identifier paramName`, а список аргументів виклику — порожній (наприклад, `() => resolve()` або `function () { resolve() }`).

В інших випадках — `false`. Зокрема, якщо у виклик `resolve(x)` передається значення — це **не** «чиста пауза» (бо результат `await` був би `x`, а не `undefined`), і антипаттерн **не** фіксується.

**Side effects.** Немає.

---

### `extractSingleCallExpression(body)` (внутрішня)

**Призначення.** Витягує єдиний `CallExpression` з тіла функції — як у концизній стрілковій формі (`() => foo()`), так і в блоковій з рівно одним стейтментом (`() => { foo() }`).

**Сигнатура.**

```js
function extractSingleCallExpression(
  body: unknown
): Record<string, unknown> | null
```

**Параметри.**

- `body` — AST-вузол тіла функції (може бути `CallExpression`, `BlockStatement` або щось інше).

**Повертає.** AST-вузол `CallExpression`, якщо:

- `body.type === 'CallExpression'` — повертає сам body; **або**
- `body.type === 'BlockStatement'`, масив `body.body` містить рівно один елемент, цей елемент — `ExpressionStatement`, а його `expression.type === 'CallExpression'` — повертає цей `expression`.

Інакше — `null`.

**Side effects.** Немає.

---

### `isPromiseSetTimeoutDelay(node)` (внутрішня)

**Призначення.** Головний предикат паттерну: чи це `NewExpression` виду `new Promise(<resolve> => setTimeout(<resolve>, ms))`.

**Сигнатура.**

```js
function isPromiseSetTimeoutDelay(
  node: Record<string, unknown> | null | undefined
): boolean
```

**Параметри.**

- `node` — довільний AST-вузол (під час обходу через `walkAst`).

**Повертає.** `true`, якщо всі наступні умови виконані:

1. `node.type === 'NewExpression'`;
2. `node.callee` — `Identifier` з іменем `'Promise'` (саме глобальний/локальний ідентифікатор, без member-доступу `foo.Promise`);
3. `node.arguments.length === 1`;
4. Цей єдиний аргумент — `ArrowFunctionExpression` або `FunctionExpression` з мінімум одним параметром;
5. Перший параметр — `Identifier` (запам'ятовується його `name` як ім'я resolve);
6. Тіло функції містить рівно один `CallExpression` (через `extractSingleCallExpression`);
7. Callee цього виклику — `Identifier` з іменем `'setTimeout'` (джерело — глобальне, з `node:timers`, з `globalThis` — для сканера не важливо);
8. У виклику `setTimeout` хоча б один аргумент;
9. Перший аргумент `setTimeout` — «голий» resolve (через `isBareResolveCallback`).

Якщо будь-яка умова порушена — повертає `false`.

**Side effects.** Немає.

---

### `walkAst(node, visit)` (внутрішня)

**Призначення.** Простий generic-обхід AST: рекурсивно спускається по всіх властивостях і елементах масивів, викликаючи `visit` для кожного об'єкта-вузла, який має поле `type` (тобто справжнього AST-вузла, а не службового мета-обʼєкта).

**Сигнатура.**

```js
function walkAst(
  node: unknown,
  visit: (n: Record<string, unknown>) => void
): void
```

**Параметри.**

- `node` — корінь або під-вузол (Program, окремий вузол, масив, скаляр — все підтримується).
- `visit` — колбек, який отримує кожен AST-вузол із полем `type`. Викликається **до** спуску в дочірні поля (pre-order).

**Поведінка.**

- `null`/примітиви — пропускаються;
- Масиви — обходяться поелементно;
- Об'єкти з `typeof node.type === 'string'` — спершу передаються у `visit`, потім обходяться їхні поля;
- Поле з ключем `'parent'` пропускається (захист від циклів у деяких AST-моделях, де є зворотні посилання);
- Інші поля-об'єкти — рекурсивно обходяться.

**Повертає.** `undefined`.

**Side effects.** Викликає `visit` зовнішнього коду — single side effect виноситься назовні через колбек.

## Залежності

### Зовнішні (relative imports)

Із `../../../scripts/utils/ast-scan-utils.mjs`:

- `parseProgramOrNull(content, virtualPath)` — парсить вихідний код у Program-вузол AST з урахуванням мови (вибір TS/JS/JSX за розширенням у `virtualPath`); повертає `null` при синтаксичних помилках.
- `offsetToLine(content, offset)` — перетворює byte/char offset у 1-based номер рядка.
- `normalizeSnippet(text)` — нормалізує текст сніпета (стискання пробілів/переносів) для зручного виводу у звітах.

### Глобальні

- `RegExp` (`SOURCE_FILE_RE`), `Array.isArray`, `Object.keys`, `String.prototype.endsWith`, `String.prototype.slice`, `Array.prototype.push` — стандартні API ES.

### Без рантайм-залежностей

Жодних `node:`-вбудованих модулів, жодних npm-пакетів, жодних звернень до файлової системи, env або мережі.

## Потік виконання / Використання

### Типовий сценарій (з раннера/перевіряча)

```js
import {
  findPromiseSetTimeoutInText,
  isPromiseSetTimeoutScanSourceFile
} from './promise-settimeout-scan.mjs'
import { readFile } from 'node:fs/promises'

async function scanRepo(files) {
  const violations = []
  for (const relPath of files) {
    if (!isPromiseSetTimeoutScanSourceFile(relPath)) continue
    const content = await readFile(relPath, 'utf8')
    const hits = findPromiseSetTimeoutInText(content, relPath)
    for (const hit of hits) {
      violations.push({ file: relPath, line: hit.line, snippet: hit.snippet })
    }
  }
  return violations
}
```

### Алгоритм всередині `findPromiseSetTimeoutInText`

1. **Парсинг.** `parseProgramOrNull(content, virtualPath)` → якщо `null` (синтаксична помилка), функція одразу повертає `[]`.
2. **Ініціалізація.** Створюється порожній масив `out` для накопичення знахідок.
3. **Обхід AST.** `walkAst(program, visit)` рекурсивно проходить весь Program-вузол.
4. **Перевірка паттерну.** Для кожного AST-вузла з полем `type` викликається `visit`, який:
   - Перевіряє `isPromiseSetTimeoutDelay(node)`;
   - Якщо `true` — пушить у `out` об'єкт `{ line, snippet }`, де `line` обчислюється з `node.start` через `offsetToLine`, а `snippet` — з `content.slice(node.start, node.end)` через `normalizeSnippet`.
5. **Повернення.** Масив `out` повертається як результат (може бути порожнім, якщо порушень немає).

### Що сканер ловить (приклади позитивних спрацювань)

```js
new Promise(resolve => setTimeout(resolve, 1000))
await new Promise(r => setTimeout(r, ms))
new Promise(resolve => setTimeout(() => resolve(), 500))
new Promise(function (resolve) { setTimeout(resolve, 200) })
new Promise(resolve => { setTimeout(function () { resolve() }, 100) })
```

### Що сканер свідомо **не** ловить (негативні приклади)

- `new Promise(resolve => setTimeout(() => resolve(value), ms))` — у `resolve` передається значення; це не «чиста пауза».
- `new Promise((resolve, reject) => setTimeout(() => doStuff().then(resolve, reject), ms))` — у тілі більше ніж один call або інший callee.
- `new MyPromise(resolve => setTimeout(resolve, ms))` — callee — не `Promise`.
- `globalThis.Promise` як callee (MemberExpression) — не Identifier.
- Файли з синтаксичними помилками — `parseProgramOrNull` повертає `null`, сканер віддає `[]`.
- Файли з розширенням `.d.ts` — фільтруються `isPromiseSetTimeoutScanSourceFile`.

### Інтеграція з правилом `js-run.mdc`

Цей сканер — частина перевірок правила js-run, секція «Паузи через `setTimeout`». Він використовується check-скриптом правила для збору списку порушень, які потім виводяться користувачу зі вказівкою замінити обгортку на `setTimeout` із `node:timers/promises`. Сам файл `promise-settimeout-scan.mjs` не виконує жодних дій з виправлення — лише детектує.

## Rebuild Test

Перевірка контрактів модуля (умоглядно, без запуску):

1. **`isPromiseSetTimeoutScanSourceFile`:**
   - `'src/a.ts'` → `true`; `'src/a.tsx'` → `true`; `'src/a.mjs'` → `true`; `'src/a.cjs'` → `true`.
   - `'src/a.d.ts'` → `false` (декларації пропускаються).
   - `'src/a.md'` / `'src/a.json'` → `false` (інше розширення).

2. **`findPromiseSetTimeoutInText` — позитивний кейс:**
   - Вхід: `const s = new Promise(r => setTimeout(r, 100))`.
   - Очікувано: масив з одним записом, `line === 1`, `snippet` містить нормалізований текст `new Promise(r => setTimeout(r, 100))`.

3. **`findPromiseSetTimeoutInText` — негативний кейс (передача значення):**
   - Вхід: `new Promise(r => setTimeout(() => r(42), 10))`.
   - Очікувано: `[]` (бо `isBareResolveCallback` відсіває виклики з аргументами).

4. **`findPromiseSetTimeoutInText` — синтаксична помилка:**
   - Вхід: `const x = (` (незакритий вираз).
   - Очікувано: `[]` (бо `parseProgramOrNull` повертає `null`).

5. **`findPromiseSetTimeoutInText` — інший callee:**
   - Вхід: `new MyPromise(r => setTimeout(r, 1))`.
   - Очікувано: `[]` (бо `node.callee.name !== 'Promise'`).

6. **`isPromiseSetTimeoutDelay` — більше одного стейтменту в блоці:**
   - Тіло Promise-функції: `{ doSomething(); setTimeout(resolve, 10) }`.
   - Очікувано: `false` (бо `extractSingleCallExpression` вимагає рівно один стейтмент).
