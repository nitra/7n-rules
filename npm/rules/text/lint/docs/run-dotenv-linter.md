---
type: JS Module
title: run-dotenv-linter.mjs
resource: npm/rules/text/lint/run-dotenv-linter.mjs
docgen:
  crc: 4719ac66
---

Модуль `run-dotenv-linter.mjs` інкапсулює інтеграцію зовнішнього інструмента **dotenv-linter** у ланцюжок `lint-text` правила `text` (тека `npm/rules/text/lint/`). Він виконує дві послідовні фази:

1. **Авто-фікс** — `dotenv-linter fix -r --no-backup --quiet . --exclude …`. dotenv-linter сам застосовує всі підтримувані виправлення на місці (на відміну від shellcheck, який лише пропонує diff).
2. **Фінальна перевірка** — `dotenv-linter check -r --quiet . --exclude …`. Якщо лишаються порушення, їх вивід ретранслюється у `stdout`/`stderr`, а функція повертає код `1`.

`dotenv-linter` — швидкий лінтер для `.env`-файлів, що ловить правила на кшталт `LowercaseKey`, `DuplicatedKey`, `IncorrectDelimiter`, `UnorderedKey` тощо. Він **очікується у `PATH`** і **не** додається в `dependencies` / `devDependencies` проєкту (та сама модель, що й `shellcheck`). Якщо бінарника немає, користувач отримує підказки встановлення (`brew`, `curl`, `cargo`), а функція повертає `1`.

Файли модуль не перераховує самостійно — це робить сам `dotenv-linter` у режимі `-r` (рекурсивний обхід дерева проєкту). З обходу виключаються `node_modules` (стороння кодова база) та `.envrc` (синтаксис direnv shell, не `key=value`). Резервні `.bak`-файли інструмент ігнорує самостійно. За відсутності `.env*`-файлів `dotenv-linter` повертає `0` ("Nothing to check").

Файл одночасно є **бібліотечним модулем** (експортує функцію `runDotenvLinter`) та **CLI-точкою входу**: за прямого запуску (`node run-dotenv-linter.mjs`) він викликає функцію та виставляє `process.exitCode` у її результат.

## Експорти / API

| Експорт                 | Тип            | Призначення                                                                                                          |
| ----------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `runDotenvLinter(cwd?)` | named function | Запуск двофазного циклу `fix` + `check` для `.env`-файлів у дереві `cwd`. Повертає числовий exit-code (`0` або `1`). |

Інші ідентифікатори модуля (`EXCLUDED_PATHS`, `printDotenvLinterInstallHints`, `buildExcludeArgs`) — внутрішні, **не** експортуються.

## Функції

### `runDotenvLinter(cwd?)`

Публічний експорт; основна логіка модуля.

- **Сигнатура:** `export function runDotenvLinter(cwd = process.cwd()): number`
- **Параметри:**
  - `cwd` _(string, optional)_ — кореневий каталог для рекурсивного сканування. За замовчуванням — `process.cwd()`. Перед використанням нормалізується через `node:path#resolve` в абсолютний шлях.
- **Повертає:** `number`
  - `0` — `dotenv-linter check` завершився без порушень (включно з ситуацією "Nothing to check").
  - `1` — будь-яка з наступних умов:
    - бінарник `dotenv-linter` не знайдено у `PATH` (`resolveCmd` повернув falsy);
    - `spawnSync` для фази `fix` повернув `error` (наприклад, помилка спавну процесу);
    - `spawnSync` для фази `check` повернув `error`;
    - `check`-прогон завершився з ненульовим `status` (виявлені залишкові порушення).
- **Побічні ефекти:**
  - Викликає `spawnSync` із зовнішнім бінарником `dotenv-linter` — два окремих процеси (`fix`, потім `check`).
  - Може модифікувати файли `.env*` у дереві `cwd` (фаза `fix`). Прапорець `--no-backup` гарантує, що `.bak`-файли не створюються.
  - Записує підказки встановлення у `process.stderr`, якщо бінарника немає.
  - Записує повідомлення про помилку `spawnSync` у `process.stderr` (поле `.error.message`), якщо процес не вдалося запустити.
  - На фазі `check`: при ненульовому `status` ретранслює зібрані `stdout`/`stderr` дочірнього процесу в `process.stdout` / `process.stderr` (захищено `?.length`).
  - Не змінює глобального стану модуля; чистий exit-code-based контракт.
- **Контракт виклику дочірніх процесів:**
  - Аргументи fix: `['fix', '-r', '--no-backup', '--quiet', ...exclude, '.']`.
  - Аргументи check: `['check', '-r', '--quiet', ...exclude, '.']`.
  - `cwd` — нормалізований `root`.
  - `encoding: 'utf8'`, `env: process.env`, `stdio: ['ignore', 'pipe', 'pipe']` (stdin закритий, stdout/stderr захоплюються в буфер).

### `printDotenvLinterInstallHints()` _(internal)_

- **Сигнатура:** `function printDotenvLinterInstallHints(): void`
- **Параметри:** немає.
- **Повертає:** `void`.
- **Побічні ефекти:** Пише у `process.stderr` багаторядкове повідомлення з трьома варіантами встановлення (`brew`, `curl … sh`, `cargo install`) та заголовком `❌ dotenv-linter не знайдено в PATH.`. Завершується порожнім рядком (зручне відокремлення в логах).

### `buildExcludeArgs()` _(internal)_

- **Сигнатура:** `function buildExcludeArgs(): string[]`
- **Параметри:** немає.
- **Повертає:** плоский масив аргументів CLI у форматі, який очікує `dotenv-linter`: `['--exclude', 'node_modules', '--exclude', '.envrc']`. Формується через `EXCLUDED_PATHS.flatMap(p => ['--exclude', p])`, тож додавання нового елемента в `EXCLUDED_PATHS` автоматично продовжує перелік прапорців.
- **Побічні ефекти:** немає (чиста функція).

## Константи

### `EXCLUDED_PATHS`

- **Тип:** `string[]`
- **Значення:** `['node_modules', '.envrc']`
- **Призначення:** Перелік каталогів/файлів, які виключаються з рекурсивного сканування `dotenv-linter -r`. Семантика:
  - `node_modules` — стороння кодова база, її `.env*` не наша зона відповідальності.
  - `.envrc` — файл direnv із shell-синтаксисом (`export FOO=bar`, `source_up` тощо), формально не key=value `.env`, лінтер на ньому давав би false positives.

## Залежності

### Стандартна бібліотека Node.js

- `node:child_process` — функція `spawnSync` для синхронного запуску дочірніх процесів `dotenv-linter`.
- `node:path` — функція `resolve` для нормалізації `cwd` в абсолютний шлях.

### Внутрішні модулі проєкту

- `../../../scripts/cli-entry.mjs` — функція `isRunAsCli(import.meta.url)`. Детектує, чи модуль запущений як CLI (а не імпортований). При `true` виставляється `process.exitCode`.
- `../../../scripts/utils/resolve-cmd.mjs` — функція `resolveCmd(name)`. Шукає виконуваний файл у `PATH`; повертає абсолютний шлях або falsy-значення, якщо бінарника немає.

### Зовнішній інструмент

- **`dotenv-linter`** — нативний бінарник, очікується у `PATH`. **Не** є npm-залежністю проєкту. Встановлюється окремо командами:
  - macOS: `brew install dotenv-linter`
  - Linux: `curl -sSfL https://git.io/JLbXn | sh -s -- -b /usr/local/bin`
  - cargo: `cargo install dotenv-linter`

## Потік виконання / Використання

### Як CLI

Файл містить хвостовий блок:

```js
if (isRunAsCli(import.meta.url)) {
  process.exitCode = runDotenvLinter()
}
```

Тобто прямий запуск виставить exit-code процесу у `0` (успіх) або `1` (помилка/порушення). Виклик:

```sh
node npm/rules/text/lint/run-dotenv-linter.mjs
```

`cwd` при цьому — поточний робочий каталог процесу (`process.cwd()`).

### Як бібліотечний модуль

Імпортується з оркестратора `lint-text`:

```js
import { runDotenvLinter } from './run-dotenv-linter.mjs'

const code = runDotenvLinter('/abs/path/to/project')
if (code !== 0) process.exit(code)
```

### Покроковий потік

1. **Нормалізація `cwd`.** `resolve(cwd)` → абсолютний `root`.
2. **Резолв бінарника.** `resolveCmd('dotenv-linter')` шукає виконуваний файл у `PATH`.
   - Якщо `null`/`undefined`/порожній рядок → виклик `printDotenvLinterInstallHints()` → повернення `1`. Подальші кроки не виконуються.
3. **Підготовка списку виключень.** `buildExcludeArgs()` → `['--exclude', 'node_modules', '--exclude', '.envrc']`.
4. **Фаза fix.** `spawnSync(bin, ['fix', '-r', '--no-backup', '--quiet', '--exclude', 'node_modules', '--exclude', '.envrc', '.'], { cwd: root, encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })`.
   - Якщо `fixRun.error` (наприклад, EACCES/ENOENT при спавні) → запис `fixRun.error.message` у `stderr` → повернення `1`.
   - `status` фази `fix` **не** перевіряється — інструмент може повертати ненульовий код, якщо лишилися ще не виправлені порушення; це штатно, бо далі йде фінальний `check`.
5. **Фаза check.** `spawnSync(bin, ['check', '-r', '--quiet', '--exclude', 'node_modules', '--exclude', '.envrc', '.'], …)` з тими самими опціями оточення.
   - Якщо `checkRun.error` → запис `checkRun.error.message` у `stderr` → повернення `1`.
   - Якщо `checkRun.status === 0` → повернення `0` (успіх).
   - Інакше: за наявності `checkRun.stdout` пишемо його у `process.stdout`, за наявності `checkRun.stderr` — у `process.stderr`, повертаємо `1`.

### Контракт побічних ефектів

| Подія                          | Куди пишеться    | Коли                                     |
| ------------------------------ | ---------------- | ---------------------------------------- |
| Підказки встановлення          | `process.stderr` | бінарника немає у `PATH`                 |
| `error.message` зі `spawnSync` | `process.stderr` | помилка спавну `fix` або `check`         |
| `stdout` дочірнього `check`    | `process.stdout` | `check.status !== 0` та буфер непорожній |
| `stderr` дочірнього `check`    | `process.stderr` | `check.status !== 0` та буфер непорожній |
| Модифікація `.env*`-файлів     | дерево `cwd`     | фаза `fix` (без `.bak`)                  |

### Інтеграція в `lint-text`

Модуль викликається сусіднім оркестратором `lint.mjs` тієї ж теки разом із `run-shellcheck.mjs` і `run-v8r.mjs`. Кожен раннер повертає `0` / `1`, оркестратор агрегує коди для фінального exit-status команди `lint-text`. Кожна перевірка ізольована — падіння одного раннера не блокує запуск інших, якщо це визначено архітектурою оркестратора.

### Тестування

Поруч у теці є `tests/`, що містить юніт-тести для раннерів `lint-`. Модуль навмисно структуровано так, щоб тестам було легко мокати `spawnSync` і `resolveCmd`: усі гілки повернення (`bin not found`, `fix error`, `check error`, `check non-zero`, `check ok`) відокремлені й деталі поведінки видимі через `process.stdout`/`process.stderr`.
