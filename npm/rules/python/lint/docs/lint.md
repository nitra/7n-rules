---
type: JS Module
title: lint.mjs
resource: npm/rules/python/lint/lint.mjs
docgen:
  crc: 92c8f115
---

Модуль `npm/rules/python/lint/lint.mjs` реалізує крок `lint-python` — частину
загального лінт-пайплайну монорепозиторію. Крок виконує перевірку Python-частини
проєкту відповідно до правила `python.mdc` і базується на пакетному менеджері
[uv](https://docs.astral.sh/uv/).

Поведінкові ключові точки:

- Якщо у корені, переданому як `cwd` (за замовчуванням `process.cwd()`), немає
  файлу `pyproject.toml`, крок завершується успіхом (`exit code 0`) без запуску
  будь-яких інструментів. Це дозволяє безпечно вмикати крок у репозиторіях
  без Python-частини.
- Якщо `pyproject.toml` присутній, але бінарника `uv` немає в `PATH`, крок
  завершується помилкою. Інших пакет-менеджерів (Poetry, pip, pdm тощо) модуль
  не підтримує — `uv` є єдиним каноном.
- Обовʼязкові кроки `uv lock --check` і `uv sync --frozen` запускаються завжди,
  якщо `uv` доступний.
- Опційні лінтери (`ruff check --fix`, `ruff format`, `mypy`) запускаються
  лише якщо вони доступні через `uv run --frozen <tool> --version`. Якщо
  відповідного інструмента у uv-середовищі немає — крок пропускається з
  pass-повідомленням (аналогічно «optional vendor-tools» у `php.mdc`).
- `ruff` працює в auto-fix-режимі (`--fix`, потім `format`), тобто може
  мутувати робоче дерево, подібно до `markdownlint-cli2 --fix` у `lint-text`
  чи `clippy --fix` у `lint-rust`.
- Серіалізація запусків CLI організована через `runStandardLint` (а не через
  безпосередній `withLock`) — це відповідає канону патерну `lint-*`, описаному
  в `.cursor/rules/scripts.mdc` (секція «Серіалізація важких CLI-команд»).

Файл одночасно є:

1. Бібліотекою (експортує функції `runLintPythonSteps` та `runLintPython`).
2. CLI-точкою входу — при запуску напряму (`isRunAsCli`) виконує
   `runLintPython()` і виставляє `process.exitCode`.

## Експорти / API

| Експорт              | Тип                     | Призначення                                                                                                                                               |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runLintPythonSteps` | `function`              | Виконує внутрішні кроки `lint-python` (без зовнішнього локу). Призначений для повторного використання з обгортки `runStandardLint` та для тестування.     |
| `runLintPython`      | `() => Promise<number>` | Публічна CLI-форма: запускає `runLintPythonSteps` через `runStandardLint`, який бере глобальний лок `lint-python` і дедупає прогони за станом git-дерева. |

Модуль не має default-export. Усі експорти — іменовані ES Module exports.

Side effect модуля верхнього рівня: якщо файл запущений як CLI
(`isRunAsCli(import.meta.url)` повертає `true`), на верхньому рівні
виконується `await runLintPython()` і результат записується у
`process.exitCode`.

## Функції

### `runTool(label, cmd, args, pass, fail)`

Внутрішня (не експортується) функція-обгортка над `child_process.spawnSync`,
яка запускає вказаний CLI-крок і репортить результат через колбеки репортера.

- Сигнатура: `runTool(label: string, cmd: string, args: string[], pass: (msg: string) => void, fail: (msg: string) => void): boolean`
- Параметри:
  - `label` — людиночитана назва кроку, використовується у повідомленнях
    (`lint-python: <label> — OK` / `lint-python: <label> — помилка ...`).
  - `cmd` — абсолютний шлях до виконуваного файлу (наприклад, отриманий через
    `resolveCmd('uv')`).
  - `args` — масив аргументів CLI.
  - `pass` — callback репортера для успіху.
  - `fail` — callback репортера для невдачі.
- Повертає: `true`, якщо процес завершився з `status === 0`, інакше `false`.
- Спосіб запуску: `spawnSync(cmd, args, { stdio: 'inherit', shell: false })`.
  Це означає, що stdout/stderr CLI-кроку успадковуються від батьківського
  процесу (видно користувачу), а інтерпретація аргументів shell-ом
  вимкнена — аргументи передаються «as is».
- Обробка статусу: якщо `r.status` не число (наприклад, процес був убитий
  сигналом), у повідомлення про помилку підставляється `1`.
- Side effects: запуск зовнішнього процесу; запис у stdout/stderr батька;
  виклик `pass` або `fail` репортера.

### `uvToolAvailable(uv, tool)`

Внутрішня (не експортується) перевірка наявності лінтера всередині
uv-середовища.

- Сигнатура: `uvToolAvailable(uv: string, tool: string): boolean`
- Параметри:
  - `uv` — абсолютний шлях до бінарника `uv`.
  - `tool` — назва бінарника, що перевіряється (`ruff`, `mypy`, тощо).
- Повертає: `true`, якщо `uv run --frozen <tool> --version` завершився з
  кодом `0`, інакше `false`.
- Спосіб запуску: `spawnSync(uv, ['run', '--frozen', tool, '--version'],
{ stdio: 'ignore', shell: false })`. `stdio: 'ignore'` гасить весь вивід
  пробної команди, щоб не засмічувати лог.
- Side effects: запуск дочірнього процесу `uv run --frozen <tool> --version`.
  Опція `--frozen` гарантує, що `uv` не намагатиметься оновлювати lock-файл
  під час перевірки.

### `runLintPythonSteps(cwd?)`

Експортована функція. Виконує всю послідовність кроків `lint-python` без
зовнішнього серіалізаційного локу.

- Сигнатура: `runLintPythonSteps(cwd?: string): number`
- Параметри:
  - `cwd` — корінь репозиторію. За замовчуванням `process.cwd()`.
- Повертає: код виходу — `0`, якщо всі обовʼязкові кроки пройшли успішно,
  `1` — якщо хоча б один крок зафейлив. Кінцевий код повертається через
  `reporter.getExitCode()` (інстансу `createCheckReporter`).
- Алгоритм:
  1. Створює репортер: `const reporter = createCheckReporter()`,
     дістає колбеки `{ pass, fail }`.
  2. Перевіряє `existsSync(join(cwd, 'pyproject.toml'))`. Якщо файла
     немає — викликає `pass(...)` з повідомленням «кроки Python пропущено»
     і повертає `reporter.getExitCode()`.
  3. `const uv = resolveCmd('uv')` — резолвить абсолютний шлях до `uv`.
     Якщо `uv` не знайдено — `fail(...)` і повернення коду.
  4. Виконує `runTool('uv lock --check', uv, ['lock', '--check'], pass, fail)`.
     За невдачі — повертає поточний код (далі не йде).
  5. Виконує `runTool('uv sync --frozen', uv, ['sync', '--frozen'], pass,
fail)`. За невдачі — повертає поточний код.
  6. Створює локальний хелпер `runOptionalUvTool(tool, label, args)`
     (див. нижче) і послідовно запускає:
     - `runOptionalUvTool('ruff', 'ruff check --fix', ['check', '--fix', '.'])`
     - `runOptionalUvTool('ruff', 'ruff format', ['format', '.'])`
     - `runOptionalUvTool('mypy', 'mypy', ['.'])`
       За першої ж справжньої невдачі (повертає `false`) — повернення поточного
       коду виходу.
  7. Повертає `reporter.getExitCode()`.
- Side effects:
  - Запуск зовнішніх процесів (`uv lock`, `uv sync`, `uv run ruff`,
    `uv run mypy`).
  - `ruff check --fix` та `ruff format` можуть **модифікувати файли
    проєкту** (auto-fix Python-коду).
  - `uv sync --frozen` може створювати або оновлювати `.venv` (з повним
    дотриманням `uv.lock`).
  - Запис у stdout/stderr через `stdio: 'inherit'`.

### `runOptionalUvTool(tool, label, args)` (вкладена у `runLintPythonSteps`)

Внутрішній замикач, доступний лише всередині `runLintPythonSteps`. Захоплює
`uv`, `pass`, `fail` із зовнішньої області видимості.

- Сигнатура: `runOptionalUvTool(tool: string, label: string, args: string[]): boolean`
- Параметри:
  - `tool` — імʼя інструмента (`ruff`, `mypy`).
  - `label` — назва кроку для повідомлень.
  - `args` — аргументи, які слід передати інструменту після `uv run --frozen <tool>`.
- Повертає: `true`, якщо крок успішно завершився **або** інструмент
  відсутній у uv-середовищі (тоді крок пропускається з pass-повідомленням).
  `false` повертається тільки коли інструмент доступний і завершився з
  ненульовим статусом.
- Логіка:
  1. `if (!uvToolAvailable(uv, tool))` → `pass(...)` з повідомленням «крок
     пропущено» і повертає `true` (це коректне продовження пайплайну,
     інструмент трактується як optional).
  2. Інакше викликає `runTool(label, uv, ['run', '--frozen', tool, ...args],
pass, fail)`.
- Side effects: ті ж, що й у `runTool` / `uvToolAvailable` (запуск дочірніх
  процесів, оновлення репортера).

### `runLintPython`

Публічна обгортка-стрілкова функція.

- Сигнатура: `runLintPython(): Promise<number>`
- Параметри: немає.
- Повертає: `Promise<number>` — код виходу, отриманий з `runStandardLint`.
- Реалізація: `runStandardLint(import.meta.dirname, runLintPythonSteps)`.
  Сенс параметрів:
  - `import.meta.dirname` — директорія самого модуля; використовується
    `runStandardLint` як ідентифікатор для дедуплікації / стану git-дерева.
  - `runLintPythonSteps` — функція кроків, яку `runStandardLint` викличе
    всередині глобального локу `lint-python`.
- Серіалізація: `runStandardLint` бере глобальний лок `lint-python` (як
  описано в `scripts.mdc`) та дедупає прогони за станом git-дерева, тому
  паралельні виклики `runLintPython()` не перетинатимуться по запуску
  `uv`.
- Side effects: ті самі, що й у `runLintPythonSteps`, плюс блокування на
  файловому локу.

## CLI-вхід (верхній рівень модуля)

```js
if (isRunAsCli(import.meta.url)) {
  process.exitCode = await runLintPython()
}
```

- Перевірка `isRunAsCli(import.meta.url)` встановлює, чи запущений файл
  безпосередньо як CLI-точка входу (наприклад, `node lint.mjs` або через
  `n-cursor`), а не імпортований як модуль.
- Якщо так — виконується top-level `await runLintPython()`, а результат
  кладеться у `process.exitCode`. Це означає, що Node завершиться з цим
  кодом після того, як event loop спорожніє.
- Якщо файл імпортовано як модуль, цей блок не виконується — викликач сам
  вирішує, як використати експортовані функції.

## Залежності

### Стандартна бібліотека Node.js

- `node:child_process` → `spawnSync` — синхронний запуск зовнішніх процесів
  (`uv`, `uv run …`).
- `node:fs` → `existsSync` — перевірка наявності `pyproject.toml`.
- `node:path` → `join` — побудова повного шляху до `pyproject.toml` від `cwd`.

### Внутрішні модулі репозиторію

- `../../../scripts/cli-entry.mjs` → `isRunAsCli` — детекція CLI-режиму
  через `import.meta.url`.
- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` —
  фабрика репортера з методами `pass`, `fail`, `getExitCode`. Цей патерн
  єдиний для всіх лінт-кроків.
- `../../../scripts/utils/resolve-cmd.mjs` → `resolveCmd` — пошук
  виконуваного файлу в `PATH` (повертає абсолютний шлях або `null`).
- `../../../scripts/lib/run-standard-lint.mjs` → `runStandardLint` —
  стандартизована обгортка над лінт-кроком (глобальний лок + дедуплікація
  за станом git-дерева).

### Зовнішні бінарники (runtime-залежності)

- `uv` — обовʼязковий у `PATH`, якщо в репозиторії є `pyproject.toml`.
- `ruff` — опційний, перевіряється через `uv run --frozen ruff --version`.
- `mypy` — опційний, перевіряється через `uv run --frozen mypy --version`.

### Артефакти у проєкті

- `pyproject.toml` (у корені `cwd`) — тригер запуску Python-частини.
- `uv.lock` — використовується `uv lock --check` та `uv sync --frozen`,
  має бути актуальним.

## Потік виконання / Використання

### Сценарій 1: Python-частини немає

1. `runLintPython()` → `runStandardLint(...)` → `runLintPythonSteps()`.
2. `existsSync('<cwd>/pyproject.toml')` повертає `false`.
3. Репортер фіксує pass-повідомлення «немає pyproject.toml у корені — кроки
   Python пропущено».
4. Повертається `0`.

### Сценарій 2: Python є, але `uv` не встановлений

1. `existsSync('pyproject.toml')` → `true`.
2. `resolveCmd('uv')` → `null`.
3. `fail('lint-python: `uv` не знайдено в PATH ...')`.
4. Повертається `1`.

### Сценарій 3: Повний прогон з усіма лінтерами

1. `uv lock --check` — перевірка lock-файлу. За невдачі вихід `1`.
2. `uv sync --frozen` — інсталяція середовища строго за `uv.lock`. За
   невдачі вихід `1`.
3. `uvToolAvailable(uv, 'ruff')` → `true` → `uv run --frozen ruff check
--fix .`. Може **змінити файли**.
4. `uv run --frozen ruff format .`. Також може **змінити файли**.
5. `uvToolAvailable(uv, 'mypy')` → `true` → `uv run --frozen mypy .`.
   Лише читає, не змінює дерево.
6. Якщо всі кроки повернули `0` — підсумок `0`. Інакше — перший
   ненульовий код розриває послідовність і повертається.

### Сценарій 4: `ruff` або `mypy` не встановлені у uv-середовищі

- Для відповідного інструмента `uvToolAvailable` поверне `false`.
- Виводиться pass-повідомлення «<tool> недоступний у uv-середовищі —
  крок пропущено».
- Інші кроки виконуються штатно.

### Як викликати з коду

```js
import { runLintPython, runLintPythonSteps } from './lint.mjs'

// Стандартний шлях: з локом, дедуплікацією, асинхронно.
const code = await runLintPython()
process.exit(code)

// Прямий виклик без локу (наприклад, у тестах або з власною серіалізацією):
const codeRaw = runLintPythonSteps('/path/to/repo')
```

### Як викликати з CLI

Файл є виконуваною точкою входу для лінт-пайплайну. У звичайному монорепо
він викликається через спільний раннер (`n-cursor`, `bun run lint` тощо).
Прямий запуск:

```bash
node npm/rules/python/lint/lint.mjs
```

Кодом виходу буде число з `runLintPython()` (`0` — OK, `1` — є помилки).

## Rebuild Test

За цією документацією можна відтворити модуль так:

1. Створити ES Module-файл, що імпортує `spawnSync` з `node:child_process`,
   `existsSync` з `node:fs`, `join` з `node:path`, а також `isRunAsCli`,
   `createCheckReporter`, `resolveCmd`, `runStandardLint` з відповідних
   шляхів `../../../scripts/...`.
2. Реалізувати приватну `runTool(label, cmd, args, pass, fail)`:
   `spawnSync` з `stdio: 'inherit'`, `shell: false`; при `status === 0`
   викликати `pass`, інакше `fail` з кодом (типу number або `1` при
   неприродному завершенні); повертати `boolean`.
3. Реалізувати `uvToolAvailable(uv, tool)`: `spawnSync(uv, ['run',
'--frozen', tool, '--version'], { stdio: 'ignore', shell: false })` →
   `r.status === 0`.
4. Експортувати `runLintPythonSteps(cwd = process.cwd())`:
   - створити репортер;
   - якщо `pyproject.toml` відсутній → `pass(...)` і повернути код;
   - резолвити `uv`; якщо немає → `fail(...)` і повернути;
   - послідовно: `uv lock --check`, `uv sync --frozen` (обовʼязкові);
   - опційні через локальну функцію-замикач `runOptionalUvTool`: `ruff
check --fix .`, `ruff format .`, `mypy .` — кожен через
     `uvToolAvailable` + `runTool`;
   - повернути `reporter.getExitCode()`.
5. Експортувати `runLintPython = () => runStandardLint(import.meta.dirname,
runLintPythonSteps)`.
6. На верхньому рівні: `if (isRunAsCli(import.meta.url)) process.exitCode =
await runLintPython()`.

Результат повинен поведінково збігтися з оригіналом: ті самі повідомлення,
ті самі коди виходу, така ж серіалізація та обробка опційних інструментів.
