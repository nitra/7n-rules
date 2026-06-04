# `cli-entry.mjs`

## Огляд

Модуль `npm/scripts/cli-entry.mjs` — невеликий утилітарний ESM-модуль (Node.js, `.mjs`), який дає можливість іншому модулю-caller'у з'ясувати, **чи запущено його як точку входу CLI** (тобто прямим викликом `node my-script.mjs` або через `bin`-shim з `package.json`), **чи його просто імпортували** з іншого модуля (наприклад, з юніт-тестів, з фасадного CLI-агрегатора, з devtools).

Це класична Node.js-задача: ESM-модулі не мають `require.main === module` ідіоми CommonJS, і canonical-альтернативою служить порівняння `import.meta.url` (URL поточного файлу-модуля) із `process.argv[1]` (шлях, переданий Node.js при запуску). Модуль інкапсулює цю перевірку в одну іменовану функцію `isRunAsCli(metaUrl)` і вирішує три типові проблеми «з полів»:

1. **`import.meta` лексично прив'язаний до файлу, де записаний.** Якщо помістити `import.meta.url` усередину helper-функції тут, у `cli-entry.mjs`, то будь-який модуль, що викличе helper, отримає URL **цього** helper-файлу, а не URL caller-модуля. Тому функція **обов'язково** приймає `metaUrl` як аргумент від caller'а.
2. **Symlink-розбіжності.** На macOS `/tmp` — це симлінка на `/private/tmp`; npm/pnpm-bin'и створюють shim-скрипти в `node_modules/.bin/*`, які часто є симлінками або обгортками; pnpm-style content-addressable links теж дають різні поверхневі шляхи. Без нормалізації naive-порівняння рядків дасть `false` навіть для коректного прямого запуску. Тому модуль обертає **обидві** сторони порівняння у `realpathSync()`.
3. **Безпечні fallback'и.** Якщо `metaUrl` не передано, або `process.argv[1]` відсутній (наприклад, REPL, embedded-runtime), або `realpathSync` кидає (файл видалено / нема прав / шлях не існує) — функція повертає `false`, а не throw. Семантика: «не впевнені, що CLI → вважаємо, що не CLI».

Модуль не має side-effects на рівні top-level (лише imports), не має CLI-shebang, не виконується самостійно. Це чисто бібліотечний експорт для consumer-модулів.

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `isRunAsCli` | `function` (named export) | Перевірити, чи модуль-caller є точкою входу процесу. |

Default export відсутній.

## Функції

### `isRunAsCli(metaUrl)`

#### Сигнатура

```js
export function isRunAsCli(metaUrl)
```

Згідно JSDoc у файлі:

```js
/**
 * @param {string | URL} [metaUrl] `import.meta.url` модуля-caller'а. Без нього — завжди `false`.
 * @returns {boolean} `true`, якщо файл, з якого передано `metaUrl`, є `process.argv[1]`.
 */
```

#### Параметри

- **`metaUrl`** — `string | URL | undefined`. Очікується значення `import.meta.url` модуля-caller'а. Це може бути або рядок виду `file:///abs/path/to/caller.mjs`, або об'єкт `URL` із тим самим протоколом `file:`. Параметр опціональний: якщо `undefined`/`null`/порожній рядок — функція коротко повертає `false`, не виконуючи решту перевірок.

#### Повертає

- **`boolean`**:
  - `true` — якщо canonical-шлях файлу caller'а (отриманий через `realpathSync(fileURLToPath(metaUrl))`) **точно дорівнює** canonical-шляху `process.argv[1]` (отриманому через `realpathSync(resolve(entry))`).
  - `false` у всіх інших випадках:
    - `metaUrl` не передано (`!metaUrl`);
    - `process.argv[1]` відсутній/порожній (`!entry`);
    - будь-яка з операцій `realpathSync`/`fileURLToPath`/`resolve` кидає виняток (зокрема `ENOENT`, `EACCES`, некоректний URL-формат, не-`file:` протокол);
    - canonical-шляхи відрізняються (звичайний випадок «модуль імпортовано, а не запущено»).

#### Алгоритм (покроково)

1. Early-return: якщо `metaUrl` falsy — `false`.
2. Зчитати `entry = process.argv[1]` (другий елемент `argv`: перший — шлях до бінарника `node`, другий — шлях до скрипта-точки входу).
3. Early-return: якщо `entry` falsy — `false`.
4. У `try`-блоці:
   - Конвертувати `metaUrl` (URL вигляду `file://...`) у звичайний абсолютний шлях через `fileURLToPath(metaUrl)`.
   - Нормалізувати симлінки в цьому шляху через `realpathSync(...)` → `callerPath`.
   - Зробити `resolve(entry)` (на випадок, якщо `argv[1]` був відносним) і теж прогнати через `realpathSync(...)` → `entryPath`.
   - Повернути `callerPath === entryPath` (строге порівняння рядків).
5. У `catch` — повернути `false` (без логування, без re-throw). Будь-яка помилка трактується як «не CLI».

#### Side effects

- **Sync I/O:** `realpathSync` — це **синхронний** виклик файлової системи (двічі за виклик: для caller-шляху й для entry-шляху). Це блокує event loop на час stat-операцій. Для CLI-entry-перевірки, що зазвичай робиться один раз при старті — прийнятно.
- **Файли:** функція **тільки читає** метадані файлової системи (resolve симлінків). Не пише, не створює, не видаляє.
- **Глобальний стан:** не змінює `process`, `globalThis`, не реєструє listener'ів.
- **Кидає:** ніколи (внутрішній `try/catch` ловить усі винятки `realpathSync`).
- **Детермінізм:** результат залежить від (a) поточного `process.argv[1]`, (b) існування й canonical-шляху обох файлів у ФС на момент виклику. Те саме `metaUrl` за різних `argv[1]` дасть різні відповіді.

## Залежності

### Зовнішні (Node.js core, без npm-залежностей)

- **`node:fs`** → `realpathSync` — синхронне розкриття симлінків і нормалізація шляху до canonical-форми.
- **`node:path`** → `resolve` — приведення `process.argv[1]` до абсолютного шляху (на випадок відносного шляху в `argv[1]`).
- **`node:url`** → `fileURLToPath` — конвертація URL-форми `file://...` (як у `import.meta.url`) у platform-native шлях ФС (включно з обробкою percent-encoding і Windows-шляхів виду `file:///C:/...`).

Усі імпорти — з prefix-формою `node:` (best practice для ESM, явно вказує на built-in-модулі й виключає колізії з npm-пакетами).

### Внутрішні (npm/scripts/...)

Немає. Модуль не імпортує жодного локального файлу — чиста утиліта поверх Node.js core.

### Зворотні залежності (хто може його використовувати)

Будь-який ESM-скрипт у `npm/scripts/**`, який має «двоїсту» природу: експортує функціонал для тестів/інших модулів **і** може бути запущений напряму як CLI. Типовий патерн:

```js
import { isRunAsCli } from './cli-entry.mjs' // або відносний шлях

export async function runCli(argv) {
  // ...
}

if (isRunAsCli(import.meta.url)) {
  await runCli(process.argv.slice(2))
}
```

## Потік виконання / Використання

### Базовий use-case (типовий CLI-скрипт)

```js
// my-tool.mjs
import { isRunAsCli } from '../scripts/cli-entry.mjs'

export function doWork(args) { /* ... */ }

if (isRunAsCli(import.meta.url)) {
  // Гарантовано: цей файл запущено як `node my-tool.mjs ...`
  // або через bin-shim з package.json.
  const result = doWork(process.argv.slice(2))
  process.exit(result.exitCode ?? 0)
}
```

Коли той самий `my-tool.mjs` імпортується в юніт-тесті (`import { doWork } from '.../my-tool.mjs'`), `process.argv[1]` вказуватиме на runner тестів (наприклад, `bun test` або `vitest`), не на `my-tool.mjs`, тому `isRunAsCli(import.meta.url)` поверне `false` і блок CLI-запуску не виконається. Це core-патерн testability для ESM CLI.

### Сценарії, у яких функція повертає `false`

1. **Caller не передав `metaUrl`** — `isRunAsCli()` без аргументу. Логічно: helper не може дізнатися caller'а без явної передачі `import.meta.url`.
2. **`process.argv[1]` відсутній** — REPL (`node` без аргументу), embedded-runtime, runtime'и без `argv`.
3. **Модуль імпортовано іншим модулем** — `argv[1]` указує на інший файл, canonical-шляхи різні.
4. **Файл-caller видалено / нема прав** — `realpathSync` кидає → `catch` → `false`.
5. **`metaUrl` не є валідним `file:`-URL** — `fileURLToPath` кидає → `catch` → `false`. Наприклад, `data:`-URL, HTTP-loader-URL, або синтаксично битий рядок.

### Сценарії, у яких функція повертає `true`

1. **Прямий запуск:** `node /abs/path/to/my-tool.mjs` — `argv[1] === '/abs/path/to/my-tool.mjs'`, `metaUrl === 'file:///abs/path/to/my-tool.mjs'`. Після canonicalization — рівні.
2. **Запуск через bin-shim:** `npx my-tool` або `bun my-tool` (якщо `package.json` має `"bin": { "my-tool": "./my-tool.mjs" }`). `argv[1]` указує на shim у `node_modules/.bin/`, який є симлінкою на `my-tool.mjs`. `realpathSync` розкриває симлінку, шляхи стають однакові.
3. **Запуск з відносним шляхом:** `node ./my-tool.mjs` із CWD = `/abs/path/to/`. `resolve(entry)` приведе до `/abs/path/to/my-tool.mjs`, потім `realpathSync` нормалізує.
4. **macOS `/tmp` vs `/private/tmp`:** якщо файл лежить у `/tmp/x.mjs` (тобто `/private/tmp/x.mjs`), а `argv[1]` указує `/tmp/x.mjs` — `realpathSync` обидва зведе до `/private/tmp/x.mjs`.

### Граничні випадки й нюанси

- **Windows.** `fileURLToPath` коректно обробляє `file:///C:/...` → `C:\\...`. `realpathSync` працює і на Windows-junction'ах. Функція кросплатформенна.
- **Workers/child processes.** У worker-thread `process.argv` зазвичай той самий, що в parent (якщо не змінено через `argv`-опцію `Worker`). У child-process через `spawn('node', ['child.mjs'])` `argv[1]` буде `child.mjs` — функція працює очікувано.
- **Bun.** Bun підтримує ту саму ESM-семантику `import.meta.url` й `process.argv`. Модуль ідентично працює під Bun.
- **`node --experimental-loader` / custom loaders.** `import.meta.url` залишається `file:`-URL для звичайних модулів. Якщо loader переписує URL на не-`file:` схему — `fileURLToPath` кине, `catch` поверне `false`. Безпечна деградація.
- **Без розширення / з різним розширенням.** Якщо `argv[1]` без `.mjs`, а Node.js резолвить його з extension lookup — `realpathSync` повертає реальний файл із розширенням, тому порівняння лишається коректним.

### Rebuild test

Reading через `import { isRunAsCli } from './cli-entry.mjs'`, виклик `isRunAsCli(import.meta.url)` із caller-скрипта, прогон у двох режимах (прямий запуск `node caller.mjs` → очікуємо `true`; імпорт із іншого скрипта `node other.mjs` → очікуємо `false`) відтворюють поведінку 1-в-1. Жодних схованих залежностей від env-змінних чи глобального стану модуль не має; усі вхідні дані — `metaUrl` (параметр) і `process.argv[1]` (стандарт Node.js).
