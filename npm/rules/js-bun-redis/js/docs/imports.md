# imports.mjs

## Огляд

Модуль реалізує AST/текстову перевірку правила `js-bun-redis.mdc` для JavaScript/TypeScript-джерел проєкту. Його завдання — гарантувати, що в усіх JS/TS-файлах репозиторію відсутні заборонені статичні чи динамічні імпорти (а також CommonJS `require`) Redis-клієнтів `ioredis`, `node-redis`, `redis` і підпакетів `@redis/*` / підшляхів `ioredis/...` / `redis/...`. Замість них код повинен використовувати Bun native Redis API: `import { redis } from 'bun'` (див. <https://bun.com/docs/runtime/redis>).

Модуль експортує одну головну функцію `check()`, яка:

1. Перевіряє наявність `package.json` у корені репозиторію (інакше перевірка пропускається як неактуальна).
2. Завантажує список ігнорованих шляхів через cursor-конфіг.
3. Обходить дерево репозиторію, збираючи JS/TS-джерела, придатні для скану.
4. Сканує кожне зібране джерело шукачем заборонених імпортів і генерує звіт через стандартний check-reporter.

Перевірка `package.json` (заборона залежностей `ioredis` / `node-redis` / `redis` / `@redis/*`) реалізована окремо — у Rego-полісі `npm/policy/js_bun_redis/package_json/`, яку запускає `npx @nitra/cursor check`. Поточний файл відповідає виключно за AST/текстовий скан коду.

## Експорти / API

| Експорт | Тип                                 | Призначення                                                                                                                                                        |
| ------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check` | `async function(): Promise<number>` | Головна точка входу check-скрипта правила `js-bun-redis`. Повертає код виходу: `0` — порушень немає, `1` — є порушення або є інша помилка, зафіксована репортером. |

Інші функції (`findAllSourcePathsForRedisScan`, `scanSourcesForRedisImports`) є приватними допоміжними і не експортуються.

## Функції

### `findAllSourcePathsForRedisScan(repoRoot, ignorePaths)`

Збирає список абсолютних шляхів JS/TS-джерел, які треба просканувати на заборонені redis-імпорти.

- Сигнатура: `async function findAllSourcePathsForRedisScan(repoRoot: string, ignorePaths: string[]): Promise<string[]>`
- Параметри:
  - `repoRoot` — абсолютний шлях до кореня репозиторію, від якого формуються відносні шляхи.
  - `ignorePaths` — масив абсолютних шляхів каталогів, повністю виключених з обходу `walkDir`.
- Повертає: `Promise<string[]>` — абсолютні шляхи знайдених файлів, відсортовані за їх відносним шляхом (локалекомпаратор за `relative(repoRoot, ...)`).
- Поведінка / логіка:
  1. Створює локальний масив `paths`.
  2. Викликає `walkDir(repoRoot, callback, ignorePaths)`. Для кожного абсолютного шляху callback:
     - Будує відносний шлях `relative(repoRoot, absPath)` і нормалізує сепаратори (Windows `\\` → `/`).
     - Якщо `isRedisScanSourceFile(rel)` повертає `true` (тобто це JS/TS-подібне джерело, цільове для скану) і `shouldSkipFileForRedisScan(rel)` повертає `false` — додає `absPath` у `paths`.
  3. Сортує `paths` за відносним шляхом через `String.prototype.localeCompare`.
- Side effects: лише читання структури директорій через `walkDir` (синхронні чи асинхронні `stat`/`readdir` за реалізацією утиліти). Файли не читаються на цьому етапі.

### `scanSourcesForRedisImports(sourcePaths, repoRoot, fail)`

Сканує текстовий вміст кожного з переданих файлів на заборонені redis-імпорти та звітує про порушення.

- Сигнатура: `async function scanSourcesForRedisImports(sourcePaths: string[], repoRoot: string, fail: (msg: string) => void): Promise<number>`
- Параметри:
  - `sourcePaths` — абсолютні шляхи джерел, отримані з `findAllSourcePathsForRedisScan`.
  - `repoRoot` — абсолютний шлях до кореня репозиторію (для нормалізації відносного шляху у повідомленнях).
  - `fail` — callback репортера, який треба викликати з повідомленням про кожне порушення; саме він контролює exitCode.
- Повертає: `Promise<number>` — загальну кількість виявлених порушень (`violations`).
- Поведінка / логіка:
  1. Ініціалізує лічильник `violations = 0`.
  2. Для кожного `absPath` зі `sourcePaths`:
     - Обчислює `rel = relative(repoRoot, absPath)` з нормалізацією `\\` → `/`.
     - Читає файл `await readFile(absPath, 'utf8')`.
     - Викликає `findRedisImportsInText(content, rel)` і ітерує його результат `v` (об’єкти з полями `line`, `module`, `snippet`).
     - Для кожного `v` інкрементує `violations` і викликає `fail(...)` з форматованим повідомленням:
       `js-bun-redis: <rel>:<line> — заміни '<module>' на Bun native Redis (import { redis } from 'bun', https://bun.com/docs/runtime/redis): <snippet>`.
  3. Повертає підсумкову `violations`.
- Side effects:
  - Читання файлів з диска (`readFile`) — потенційно великий I/O залежно від розміру репозиторію.
  - Виклик `fail` має побічний ефект: змінює внутрішній стан репортера так, що його `getExitCode()` поверне ненульовий код.

### `check()` (експортована)

Головна точка входу check-скрипта правила `js-bun-redis`.

- Сигнатура: `export async function check(): Promise<number>`
- Параметри: відсутні. Робочий каталог визначається через `process.cwd()`.
- Повертає: `Promise<number>` — фінальний код виходу: `0` — все гаразд, `1` (або інший ненульовий за реалізацією репортера) — є порушення або інші зафіксовані помилки.
- Поведінка / логіка:
  1. Створює репортер `reporter = createCheckReporter()` і деструктурує з нього `pass`, `fail`.
  2. Визначає `repoRoot = process.cwd()`.
  3. Перевіряє наявність `package.json`: якщо `existsSync(join(repoRoot, 'package.json'))` повертає `false` — викликає `pass('js-bun-redis: package.json у корені відсутній — перевірку пропущено')` і повертає `reporter.getExitCode()` (рання гілка).
  4. Завантажує `ignorePaths` через `await loadCursorIgnorePaths(repoRoot)`.
  5. Збирає `sourcePaths = await findAllSourcePathsForRedisScan(repoRoot, ignorePaths)`.
  6. Якщо `sourcePaths.length === 0` — викликає `pass('js-bun-redis: немає JS/TS файлів для скану імпортів ioredis / node-redis / redis')` і повертає `reporter.getExitCode()`.
  7. Інакше викликає `violations = await scanSourcesForRedisImports(sourcePaths, repoRoot, fail)`.
  8. Якщо `violations === 0` — викликає `pass('js-bun-redis: немає імпортів \'ioredis\' / \'node-redis\' / \'redis\' / \'@redis/*\' у джерелах (використовується Bun native Redis або redis взагалі не задіяно)')`.
  9. Повертає `reporter.getExitCode()`.
- Side effects:
  - Читання файлової системи (`existsSync`, `walkDir`, `readFile`).
  - Виведення повідомлень через репортер (через `pass`/`fail` — у консоль або інше призначене місце, що визначається реалізацією `createCheckReporter`).
  - Залежить від поточного робочого каталогу процесу (`process.cwd()`).

## Залежності

### Зовнішні (node:\* / runtime)

- `node:fs`
  - `existsSync` — синхронна перевірка наявності `package.json` у корені.
- `node:fs/promises`
  - `readFile` — асинхронне читання вмісту кожного JS/TS-файлу у кодуванні `utf8`.
- `node:path`
  - `join` — побудова шляху до `package.json`.
  - `relative` — обчислення відносних шляхів для логування та сортування.

### Внутрішні (проєктні)

- `../../../scripts/lib/check-reporter.mjs`
  - `createCheckReporter` — фабрика стандартного репортера для check-скриптів правил. Дає API `{ pass, fail, getExitCode }`.
- `../../../scripts/lib/load-cursor-config.mjs`
  - `loadCursorIgnorePaths` — завантажує абсолютні шляхи, які слід виключити з обходу (з cursor-конфігу/ignore-файлів).
- `../lib/redis-imports.mjs`
  - `findRedisImportsInText(text, relPath)` — шукає у тексті заборонені redis-імпорти/`require`/динамічні `import()`; повертає масив порушень з полями `line`, `module`, `snippet`.
  - `isRedisScanSourceFile(relPath)` — предикат: чи цей відносний шлях належить до набору JS/TS-джерел, придатних для скану.
  - `shouldSkipFileForRedisScan(relPath)` — предикат: чи слід пропустити конкретний файл (наприклад, тестові фікстури, генеровані файли тощо).
- `../../../scripts/utils/walkDir.mjs`
  - `walkDir(rootAbs, visit, ignorePaths)` — асинхронний обхід директорії з викликом `visit(absPath)` для кожного файлу та пропуском заданих `ignorePaths`.

## Потік виконання / Використання

Файл є частиною інфраструктури check-скриптів правил Cursor для проєкту. Очікувано він викликається оркестратором, який імпортує `check` із цього модуля і запускає її з робочою директорією, що дорівнює кореню репозиторію.

Узагальнений потік виконання `check()`:

1. Інстанціювання репортера `createCheckReporter()`.
2. Гілка раннього виходу: відсутній кореневий `package.json` → `pass(...)` → `return reporter.getExitCode()`.
3. Завантаження `ignorePaths` через `loadCursorIgnorePaths(repoRoot)`.
4. Збір кандидатів через `findAllSourcePathsForRedisScan(repoRoot, ignorePaths)`:
   - Обхід `walkDir` з відсіюванням за `isRedisScanSourceFile` і `shouldSkipFileForRedisScan`.
   - Детермінований порядок через `localeCompare` за відносним шляхом.
5. Гілка раннього виходу: порожній список кандидатів → `pass(...)` → `return reporter.getExitCode()`.
6. Скан кожного джерела через `scanSourcesForRedisImports`:
   - Читання `readFile(..., 'utf8')`.
   - Виклик `findRedisImportsInText(content, rel)`.
   - На кожне порушення — `fail('js-bun-redis: <rel>:<line> — заміни \'<module>\' на Bun native Redis (...): <snippet>')` та `violations++`.
7. Якщо `violations === 0` — повідомлення про успіх через `pass(...)`.
8. Фінальне повернення `reporter.getExitCode()`:
   - `0` — лише `pass`/нуль порушень.
   - Ненульове значення — щонайменше один `fail`.

Приклад типового підключення з оркестратора правил (схематично):

```js
import { check } from './imports.mjs'

const code = await check()
process.exit(code)
```

Команда `npx @nitra/cursor check` запускає цей скрипт у пайплайні разом із Rego-полісом `npm/policy/js_bun_redis/package_json/`, який перевіряє відсутність заборонених redis-пакетів у `dependencies`/`devDependencies`/`peerDependencies` будь-якого `package.json` у репозиторії. Цей файл доповнює полісі рівнем скану реальних імпортів у коді, бо самих лише обмежень у `package.json` недостатньо: пакет може бути транзитивно встановлений або підвантажений з підшляху.

Особливості та граничні випадки:

- Шляхи нормалізуються до прямих слешів (`/`) перед тим як прогнатись через предикати, щоб логіка `isRedisScanSourceFile` / `shouldSkipFileForRedisScan` працювала однаково на Linux/macOS і Windows.
- Сортування результатів `findAllSourcePathsForRedisScan` забезпечує стабільний детермінований порядок виводу повідомлень про порушення, що корисно для CI-діффів.
- Якщо у файлі знайдено кілька порушень — кожне репортується окремим повідомленням, але сумарний `violations` повертається з усієї пробіжки.
- `check()` свідомо не кидає винятків самостійно: усі помилки оформлюються як `fail(...)` для коректного коду виходу через `reporter.getExitCode()`. Винятки від `readFile`/`walkDir` будуть проксі через `await` і призведуть до rejected promise (це залишається на відповідальності оркестратора).

## Rebuild Test

Якщо за цією документацією треба відновити модуль, він повинен:

1. Імпортувати з `node:fs` — `existsSync`; з `node:fs/promises` — `readFile`; з `node:path` — `join`, `relative`.
2. Імпортувати з `../../../scripts/lib/check-reporter.mjs` — `createCheckReporter`.
3. Імпортувати з `../../../scripts/lib/load-cursor-config.mjs` — `loadCursorIgnorePaths`.
4. Імпортувати з `../lib/redis-imports.mjs` — `findRedisImportsInText`, `isRedisScanSourceFile`, `shouldSkipFileForRedisScan`.
5. Імпортувати з `../../../scripts/utils/walkDir.mjs` — `walkDir`.
6. Оголосити приватну `findAllSourcePathsForRedisScan(repoRoot, ignorePaths)`, що:
   - обходить `walkDir(repoRoot, cb, ignorePaths)`;
   - усередині callback нормалізує `relative(repoRoot, absPath)` до прямих слешів, фільтрує через `isRedisScanSourceFile && !shouldSkipFileForRedisScan` і пушить у локальний масив;
   - сортує масив за `relative(repoRoot, x).localeCompare(...)`;
   - повертає його.
7. Оголосити приватну `scanSourcesForRedisImports(sourcePaths, repoRoot, fail)`, що:
   - ітерує `sourcePaths`, для кожного читає `readFile(..., 'utf8')`, нормалізує `rel`, прогоняє `findRedisImportsInText` і на кожне порушення інкрементує лічильник + викликає `fail(...)` з повідомленням формату `js-bun-redis: <rel>:<line> — заміни '<module>' на Bun native Redis (import { redis } from 'bun', https://bun.com/docs/runtime/redis): <snippet>`;
   - повертає кількість порушень.
8. Експортувати `async function check()`, що:
   - створює `reporter = createCheckReporter()`, бере `pass`/`fail` з нього;
   - якщо `package.json` у `process.cwd()` відсутній — `pass('... перевірку пропущено')` і повертає `reporter.getExitCode()`;
   - завантажує `ignorePaths` через `loadCursorIgnorePaths(repoRoot)`;
   - збирає `sourcePaths`, якщо порожньо — `pass('... немає JS/TS файлів для скану ...')` і вихід;
   - інакше викликає `scanSourcesForRedisImports`, на нуль порушень — `pass('... немає імпортів ioredis / node-redis / redis / @redis/* ...')`;
   - повертає `reporter.getExitCode()`.
