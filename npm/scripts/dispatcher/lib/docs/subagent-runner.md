# subagent-runner.mjs

## Огляд

`subagent-runner.mjs` — модуль абстракції спавну сфокусованого субагента для Активного Раннера (фаза Ф3/Ф4 диспетчера). Реалізує специфікацію §15.1: надає уніфікований інтерфейс `runStep(prompt, opts)` поверх трьох можливих backend-ів:

1. `claude-agent-sdk` — програмний доступ через пакет `@anthropic-ai/claude-agent-sdk`, потребує змінної середовища `ANTHROPIC_API_KEY`.
2. `claude -p` — CLI-аутентифікація користувача через виконуваний `claude` у `PATH`.
3. `cursor-agent -p` — CLI-аутентифікація через виконуваний `cursor-agent` у `PATH`.

Якщо жоден backend недоступний — модуль кидає виняток із текстом `NO_BACKEND` (polyfill без runner-а не стартує, §2.2).

Згідно з коментарем у заголовку файлу, для inner-спавну навмисно НЕ використовується pi.dev: у автономному режимі pi.dev — це зовнішній драйвер, тож спавнити ним внутрішні субагенти призвело б до рекурсії (§9.1).

Усі probe-залежності (`spawn`, `isInPath`, `canImportSdk`, `query`) проектовані під ін'єкцію — для тестування без реальних процесів та без встановленого SDK.

## Експорти / API

Модуль експортує чотири іменовані функції:

- `isBinaryInPath(name, spawn?)` — перевірка наявності бінарника в `PATH`.
- `selectBackend({ hasApiKey, canImportSdk, isInPath })` — вибір backend-а за пріоритетом.
- `cliRunner(bin, deps?)` — фабрика runner-а для CLI-варіанту.
- `sdkRunner(deps?)` — фабрика runner-а для SDK-варіанту.
- `createRunner(deps?)` — головний фасад, що сам визначає та повертає потрібний runner.

Внутрішня (не експортована) функція: `probeSdk()` — перевіряє можливість динамічного імпорту SDK.

Константа модульного рівня `NO_BACKEND` — текст повідомлення помилки, коли жоден backend недоступний.

## Функції

### `isBinaryInPath(name, spawn = spawnSync)`

Перевіряє, чи є виконуваний бінарник у `PATH` через виклик `command -v <name>`.

- Параметри:
  - `name` (`string`) — ім'я виконуваного.
  - `spawn` (`typeof spawnSync`, optional) — ін'єкція для тестів; за замовчуванням `spawnSync` із `node:child_process`.
- Повертає: `boolean` — `true`, якщо `spawn` повернув статус `0`; інакше `false`. Якщо `r.status` дорівнює `null`/`undefined`, трактується як `1` (тобто `false`).
- Side effects: виклик дочірнього процесу `command -v` через shell (`shell: true`).

### `selectBackend({ hasApiKey, canImportSdk, isInPath })`

Вибирає backend за чітко зафіксованим пріоритетом: SDK > Claude CLI > Cursor CLI.

- Параметри (один об'єкт):
  - `hasApiKey` (`boolean`) — чи задана `ANTHROPIC_API_KEY`.
  - `canImportSdk` (`boolean`) — чи імпортується `@anthropic-ai/claude-agent-sdk`.
  - `isInPath` (`(name: string) => boolean`) — предикат наявності бінарника у `PATH`.
- Повертає: рядковий літерал `'sdk'`, `'claude'`, `'cursor'` або `null`.
- Логіка:
  1. Якщо `hasApiKey` і `canImportSdk` одночасно істинні — `'sdk'`.
  2. Інакше якщо `isInPath('claude')` — `'claude'`.
  3. Інакше якщо `isInPath('cursor-agent')` — `'cursor'`.
  4. Інакше — `null`.
- Side effects: відсутні (за умови, що `isInPath` чистий).

### `cliRunner(bin, deps = {})`

Створює CLI-runner на основі бінарника `claude` або `cursor-agent` (обидва підтримують прапор `-p` для подачі промпта зі stdin).

- Параметри:
  - `bin` (`'claude' | 'cursor-agent'`) — який саме CLI запускати.
  - `deps.spawn` (`typeof spawnSync`, optional) — ін'єкція; за замовчуванням `spawnSync`.
- Повертає об'єкт:
  - `backend` — рядок, що дорівнює переданому `bin`.
  - `runStep(prompt, { cwd } = {})` — синхронна функція, що викликає `spawn(bin, ['-p'], { input: prompt, cwd, encoding: 'utf8' })`. Повертає `{ ok: boolean, output: string }`, де:
    - `ok` — `true`, якщо `r.status === 0` (null/undefined трактується як 1 → `false`).
    - `output` — конкатенація `stdout` та `stderr` (порожні рядки, якщо undefined).
- Side effects: спавн дочірнього CLI-процесу при кожному виклику `runStep`.

### `sdkRunner(deps = {})`

Створює SDK-runner, який працює через async-iterable `query` з пакета `@anthropic-ai/claude-agent-sdk`.

- Параметри:
  - `deps.query` (`(input: object) => AsyncIterable`, optional) — ін'єкція функції `query` для тестів. Якщо не задано — модуль динамічно імпортує `@anthropic-ai/claude-agent-sdk` і бере звідти `query`.
- Повертає об'єкт:
  - `backend` — рядок `'sdk'`.
  - `runStep(prompt, { cwd } = {})` — `async` функція, що повертає `Promise<{ ok: boolean, output: string }>`.
- Логіка `runStep`:
  1. Лінива ініціалізація `query` (якщо не передано в `deps`).
  2. Виклик `query({ prompt, options: { cwd, maxTurns: 20, allowedTools: ['Read', 'Edit', 'Bash'] } })`.
  3. Ітерує асинхронно по повідомленнях:
     - Якщо `msg.text` — рядок, додає його до `output`.
     - Якщо `msg.type === 'result'`, фіналізує `ok = msg.is_error !== true`.
  4. У разі винятку — повертає `{ ok: false, output: String(error?.message ?? error) }`.
- Side effects: динамічний імпорт SDK (один раз на виклик, якщо `query` не ін'єктовано); мережеві/процесні дії SDK; обмеження інструментів виключно до `Read`, `Edit`, `Bash`.

### `createRunner(deps = {})`

Головний фасад модуля. Підбирає та повертає runner відповідно до доступних backend-ів.

- Параметри (об'єкт `deps` для тестів; усі поля опціональні):
  - `backend` — явне переозначення вибору (`'sdk'`/`'claude'`/`'cursor'`).
  - `env` — мапа змінних середовища; за замовчуванням `processEnv` (`process.env`).
  - `isInPath` — функція; за замовчуванням обгортка над `isBinaryInPath(name, deps.spawn)`.
  - `canImportSdk` — заздалегідь обчислений прапор; інакше викликається `probeSdk()`.
  - `spawn` — використовується як `deps.spawn` для дефолтного `isInPath`.
  - `query` — пробрасується в `sdkRunner` як `deps.query`.
- Повертає: `Promise<runner>`, де `runner` має форму `{ backend, runStep }` (синхронний для CLI, асинхронний для SDK — обидва типи представлені в одному фасаді).
- Логіка:
  1. Резолвить `env`, `isInPath`, `canImportSdk`.
  2. Якщо `deps.backend` не задано — викликає `selectBackend({ hasApiKey: Boolean(env.ANTHROPIC_API_KEY), canImportSdk, isInPath })`.
  3. Якщо backend усе ще `null`/falsy — `throw new Error(NO_BACKEND)`.
  4. Для `'sdk'` — повертає `sdkRunner(deps)`.
  5. Для `'claude'` — повертає `cliRunner('claude', deps)`.
  6. Для будь-якого іншого ненульового — повертає `cliRunner('cursor-agent', deps)` (тобто `'cursor'` мапиться на `cursor-agent`).
- Side effects: можливий динамічний імпорт SDK через `probeSdk()`; виклики `spawn` через дефолтний `isInPath`.

### `probeSdk()` (внутрішня)

Перевіряє, чи можна динамічно імпортувати `@anthropic-ai/claude-agent-sdk`.

- Параметри: відсутні.
- Повертає: `Promise<boolean>` — `true`, якщо `import` успішний, інакше `false` (виняток поглинається порожнім `catch`).
- Side effects: динамічний `import()` модуля SDK.

## Залежності

- `node:child_process` — `spawnSync` (синхронний спавн дочірніх процесів для `command -v` та CLI-runner-а).
- `node:process` — `env` як `processEnv` (читання змінних середовища, передусім `ANTHROPIC_API_KEY`).
- `@anthropic-ai/claude-agent-sdk` (optional, динамічний `import`) — джерело функції `query` для SDK-runner-а; відсутність пакета — допустимий сценарій (`probeSdk()` ловить виняток).

Зовнішні виконувані файли, очікувані у `PATH`:

- `command` — POSIX-shell builtin для `command -v`.
- `claude` — CLI Claude Code.
- `cursor-agent` — CLI Cursor Agent.

Жодних інших імпортів із локального проєкту модуль не робить — він самодостатній.

## Потік виконання / Використання

Типовий сценарій використання у диспетчері (Активний Раннер, фази Ф3/Ф4):

1. Виклик `await createRunner()` без параметрів.
2. Усередині `createRunner` виконується probe доступних backend-ів:
   - перевіряється `process.env.ANTHROPIC_API_KEY`;
   - намагається динамічно імпортувати `@anthropic-ai/claude-agent-sdk`;
   - перевіряються `claude` та `cursor-agent` у `PATH` через `command -v`.
3. `selectBackend` повертає перший доступний backend за пріоритетом SDK → claude → cursor.
4. Якщо нічого не знайдено — кидається `Error(NO_BACKEND)`, що зупиняє стартування polyfill-а (§2.2).
5. Інакше повертається об'єкт `{ backend, runStep }`.
6. Викликаючий код передає `runStep(prompt, { cwd })`:
   - для SDK — отримує `Promise<{ ok, output }>`, працюючи з обмеженим набором інструментів `Read`/`Edit`/`Bash` та лімітом `maxTurns: 20`;
   - для CLI — отримує синхронний `{ ok, output }` після завершення дочірнього процесу.

Для тестування потік ін'єктується наскрізно: будь-яку із залежностей (`spawn`, `isInPath`, `canImportSdk`, `query`, `env`, `backend`) можна перевизначити, що дозволяє покривати модуль unit-тестами без реальних процесів і без SDK.

Особливості та інваріанти:

- Пріоритет backend-ів зафіксований у `selectBackend` і не змінюється від виклику до виклику.
- `runStep` у CLI-варіанті завжди синхронний, у SDK-варіанті — асинхронний; форма результату `{ ok, output }` уніфікована.
- `output` у CLI завжди склеює `stdout` та `stderr` без розділювача.
- У SDK-варіанті помилки під час ітерації `query` ловляться й конвертуються в `{ ok: false, output: <message> }`, тобто `runStep` не пробрасує винятки нагору.
- Значення `null`/`undefined` для `r.status` у `spawnSync`-результатах послідовно нормалізується через `?? 1`, що дає поведінку "невідомий статус == помилка".

## Rebuild Test

Документ описує лише той API, що присутній у файлі `subagent-runner.mjs`:

- Експорти: `isBinaryInPath`, `selectBackend`, `cliRunner`, `sdkRunner`, `createRunner` — усі п'ять перевірено за вихідним кодом.
- Внутрішня функція `probeSdk` зафіксована як приватна (не експортована).
- Константа `NO_BACKEND` згадана як модульна.
- Імпорти `spawnSync` із `node:child_process` та `env` як `processEnv` із `node:process` зафіксовані.
- Опційна залежність `@anthropic-ai/claude-agent-sdk` згадана з акцентом на динамічний import у двох місцях (`sdkRunner.runStep` та `probeSdk`).
- Пріоритет `sdk → claude → cursor` і поведінка `createRunner` за відсутності backend (throw `NO_BACKEND`) відповідають коду.
- Деталі `sdkRunner` (`maxTurns: 20`, `allowedTools: ['Read', 'Edit', 'Bash']`, обробка `msg.type === 'result'` та `msg.is_error`) узяті безпосередньо з тіла функції.
- Формула `r.status ?? 1` для нормалізації статусу описана точно так, як у коді.

Жодних припущень про невидимі в файлі деталі (тестові файли, інтеграцію з конкретними викликами в інших модулях диспетчера) у документі не зроблено.
