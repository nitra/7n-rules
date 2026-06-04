# env_dns.mjs

## Огляд

Файл `npm/rules/abie/js/env_dns.mjs` — це скрипт-перевірка (check) для правила `abie.mdc`, який сканує env-файли проєкту `abie` з іменами на кшталт `*.dev.env` та `*.ua.env` і перевіряє, що кожен внутрішньокластерний URL виду `http://<svc>.<ns>.svc.<dns>` відповідає кластеру, ідентифікованому за іменем файла.

Правила відповідності:

- `dev.env` → DNS-суфікс `abie-dev.internal` та namespace із префіксом `dev-*`.
- `ua.env`  → DNS-суфікс `abie-ua.internal` та namespace із префіксом `ua-*`.

Файл `.env` без env-суфікса (локальний для розробника) із цієї перевірки виключений.

Скрипт експортує одну асинхронну функцію `check(cwd)`, яка проходить по всіх знайдених у репозиторії abie-env-файлах, читає їх вміст, валідує URL-и через `validateAbieEnvInternalUrls` і повертає процесний exit code через `createCheckReporter`.

## Експорти / API

- `export async function check(cwd = process.cwd()): Promise<number>` — основна точка входу перевірки. Параметр `cwd` (опційний) — абсолютний шлях до кореня репозиторію; за замовчуванням — поточна робоча директорія процесу (`process.cwd()`). Повертає `Promise<number>` — exit code, отриманий від `reporter.getExitCode()` (зазвичай `0`, якщо всі перевірки пройшли, або ненульовий, якщо були `fail`).

Інших експортів (default, named) у файлі немає.

## Функції

### `check(cwd?)`

Сигнатура: `async function check(cwd = process.cwd()): Promise<number>`.

Параметри:

- `cwd` — `string`, опційний. Корінь репозиторію, від якого ведеться пошук env-файлів і обчислюються відносні шляхи для повідомлень. За замовчуванням — `process.cwd()`.

Повертає: `Promise<number>` — exit code від `reporter.getExitCode()`.

Покрокова поведінка `check`:

1. Створює об’єкт-репортер через `createCheckReporter()` і деструктурує з нього функції `pass` та `fail`.
2. Зберігає `root = cwd` як корінь обходу.
3. Завантажує перелік ігнорованих шляхів через `await loadCursorIgnorePaths(root)` (типово — те, що описано в `.cursorignore`/конфігах cursor).
4. Збирає всі релевантні env-файли через `await collectAbieEnvFiles(root, ignorePaths)`.
5. Якщо знайдених файлів немає (`envFiles.length === 0`), репортить успіх повідомленням `'Не знайдено dev.env / ua.env у репозиторії — перевірку env→cluster DNS пропущено (abie.mdc)'` і повертає `reporter.getExitCode()`.
6. Інакше для кожного абсолютного шляху `abs` із `envFiles`:
   - Обчислює відносний шлях `rel = relative(root, abs).replaceAll('\\', '/') || abs` (Windows-сепаратори нормалізовано в `/`; якщо `relative` повернув порожній рядок — використовується `abs`).
   - Визначає логічне ім’я env через `abieEnvNameFromBasename(basename(abs))`. Очікувані значення — `'dev'` або `'ua'` (за модулем `../lib/env-dns.mjs`).
   - Якщо `envName === null` — пропускає файл (не abie-env).
   - Намагається прочитати файл як utf8: `raw = await readFile(abs, 'utf8')`. У разі помилки виконує `fail(`${rel}: не вдалося прочитати (${msg})`)`, де `msg` — або `error.message`, якщо `error instanceof Error`, або `String(error)`. Після цього робить `continue` до наступного файлу.
   - Викликає `validateAbieEnvInternalUrls(raw, envName)` і отримує масив повідомлень про помилки.
   - Якщо `errors.length === 0` — викликає `pass(`${rel}: усі внутрішні URL відповідають env "${envName}" (abie.mdc)`)`.
   - Якщо є помилки — для кожного елемента `err` викликає `fail(`${rel}: ${err} (abie.mdc)`)`.
7. Після обходу повертає `reporter.getExitCode()`.

Особливості та інваріанти:

- Жодного запису у файлову систему: функція лише читає файли.
- Кожне повідомлення `pass`/`fail` явно посилається на правило `abie.mdc`.
- Жодних винятків назовні не кидається з циклу читання — помилка читання трактується як `fail`, а не як throw.
- `envName === null` означає, що файл не відповідає шаблону abie-env (наприклад, `.env` без префікса) і просто ігнорується.

## Залежності

Імпорти Node.js:

- `import { readFile } from 'node:fs/promises'` — асинхронне читання вмісту env-файлів.
- `import { basename, relative } from 'node:path'` — обчислення базового імені файла (для `abieEnvNameFromBasename`) і відносного шляху (для діагностики у повідомленнях).

Імпорти проєкту:

- `import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'` — фабрика репортера, який збирає виклики `pass`/`fail` і повертає сумарний exit code через `getExitCode()`.
- `import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'` — завантаження списку шляхів, які мають бути виключені з обходу (зчитує конфіг cursor).
- `import { abieEnvNameFromBasename, collectAbieEnvFiles, validateAbieEnvInternalUrls } from '../lib/env-dns.mjs'` — основна бізнес-логіка:
  - `collectAbieEnvFiles(root, ignorePaths)` — повертає масив абсолютних шляхів до abie-env-файлів.
  - `abieEnvNameFromBasename(basename)` — мапить ім’я файла на логічний env (`'dev'`, `'ua'` або `null`).
  - `validateAbieEnvInternalUrls(raw, envName)` — повертає масив рядків-помилок для тих рядків env, де внутрішній URL не узгоджений з очікуваним кластером/namespace.

## Потік виконання / Використання

Призначення файла — бути частиною механізму перевірок правил `cursor`/`abie`. Типовий сценарій виклику:

1. CI або локальний інструмент завантажує модуль через `import { check } from 'npm/rules/abie/js/env_dns.mjs'`.
2. Викликає `const exitCode = await check(repoRoot)`, де `repoRoot` — корінь монорепо (або не передає аргумент, щоб використовувалось `process.cwd()`).
3. Внутрішньо `check` робить наступне:
   - `loadCursorIgnorePaths(root)` визначає, які теки/файли виключити з обходу.
   - `collectAbieEnvFiles(root, ignorePaths)` повертає список abie-env-файлів. Якщо список порожній — одразу `pass` і вихід.
   - Для кожного знайденого файла: визначається `envName`, читається вміст, виконується `validateAbieEnvInternalUrls`, формується по одному `pass` (якщо помилок немає) або по `fail` на кожну помилку.
4. Результат — exit code (`reporter.getExitCode()`), який можна повернути зі скрипта-обгортки і використати як `process.exit(exitCode)`.

Семантика повідомлень:

- `pass` без файлів: `'Не знайдено dev.env / ua.env у репозиторії — перевірку env→cluster DNS пропущено (abie.mdc)'`.
- `pass` для конкретного файла: `` `${rel}: усі внутрішні URL відповідають env "${envName}" (abie.mdc)` ``.
- `fail` при помилці читання: `` `${rel}: не вдалося прочитати (${msg}) ` `` (де `msg` — повідомлення винятку).
- `fail` для кожної невідповідності: `` `${rel}: ${err} (abie.mdc)` ``, де `err` — рядок з `validateAbieEnvInternalUrls`.

Таким чином, `check` — це чиста синхронна (з погляду побічних ефектів — лише читання) функція звітування, яка делегує специфіку парсингу та валідації внутрішнього DNS у `../lib/env-dns.mjs`, а сама лише оркеструє обхід файлів, обробку помилок читання і друк звіту через `createCheckReporter`.
