# run-shellcheck.mjs

## Огляд

Модуль `run-shellcheck.mjs` — частина ланцюжка `lint-text` для перевірки якості shell-скриптів (`*.sh`) у проєкті за допомогою зовнішнього інструменту **ShellCheck**. Скрипт виконує два етапи:

1. **Авто-виправлення**: оскільки ShellCheck не має прапорця `--fix`, для кожного знайденого `*.sh` файла модуль запускає `shellcheck -f diff` і застосовує отриманий unified-diff через системну утиліту `patch -p1` у корені проєкту. Цикл повторюється до `MAX_FIX_ROUNDS_PER_FILE` (32) разів, поки залишаються авто-виправні зауваження.
2. **Фінальний прогон**: звичайний `shellcheck` по всіх зібраних файлах. Будь-яке попередження чи помилка дають ненульовий код виходу.

Модуль уміє працювати як **CLI** (через `isRunAsCli`) і як **бібліотека** (експортує функції). Шляхи скриптів збираються з `git ls-files` у git-репозиторії або через `globSync` (з виключенням `node_modules`) поза git-деревом.

Якщо у системі немає `shellcheck` чи `patch`, у stderr друкуються підказки встановлення для macOS (Homebrew), Debian/Ubuntu (apt) та Arch (pacman), а скрипт завершується з кодом 1.

## Експорти / API

| Експорт                     | Тип            | Призначення                                                                        |
| --------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `listShellScriptPaths(cwd)` | named function | Зібрати відсортований унікальний список відносних шляхів до `*.sh` файлів у `cwd`. |
| `runShellcheckText(cwd?)`   | named function | Запустити повний цикл: авто-фікси + фінальна перевірка. Повертає код виходу (0/1). |

Модуль також виконується як CLI: якщо `import.meta.url` відповідає поточному запуску — викликається `runShellcheckText()` і її результат присвоюється `process.exitCode`.

## Функції

### `printShellcheckInstallHints()`

- **Сигнатура**: `function printShellcheckInstallHints(): void`
- **Параметри**: немає.
- **Повертає**: `void`.
- **Side effects**: пише у `process.stderr` повідомлення з інструкціями встановлення `shellcheck` для macOS, Debian/Ubuntu та Arch.

### `printPatchInstallHints()`

- **Сигнатура**: `function printPatchInstallHints(): void`
- **Параметри**: немає.
- **Повертає**: `void`.
- **Side effects**: пише у `process.stderr` підказку про встановлення `patch` (на macOS зазвичай є; на Debian/Ubuntu — `sudo apt-get install -y patch`).

### `listShellScriptPaths(cwd)` (export)

- **Сигнатура**: `function listShellScriptPaths(cwd: string): string[]`
- **Параметри**:
  - `cwd` — абсолютний шлях до кореня проєкту (вже має бути нормалізований через `resolve`, якщо потрібно).
- **Повертає**: відсортований масив унікальних відносних шляхів до `*.sh` файлів від `cwd`. Слеші уніфікуються в forward-slash (`'/'`).
- **Side effects**: виконує `git rev-parse --is-inside-work-tree` і `git ls-files -z -- ':(glob)**/*.sh'` через `spawnSync`; у безгітовому контексті — викликає `globSync('**/*.sh')` з виключенням `node_modules`.
- **Логіка**:
  - Якщо `git` доступний і `cwd` — частина git-робочого дерева, читаються лише tracked файли (`ls-files` з NUL-розділенням, дублікати усуваються через `Set`).
  - Якщо `git` доступний, але `ls-files` повертає ненульовий статус — повертається порожній масив.
  - Інакше — `globSync` з `exclude`, який відкидає шляхи, що містять `node_modules` (на будь-якому рівні), і нормалізує бекслеші (`\\` → `/`).

### `runShellcheckText(cwd = process.cwd())` (export)

- **Сигнатура**: `function runShellcheckText(cwd?: string): number`
- **Параметри**:
  - `cwd` — необов'язковий робочий каталог. За замовчуванням — `process.cwd()`.
- **Повертає**: `0` — все OK; `1` — помилка середовища (немає `shellcheck`/`patch`), помилка spawn, або залишкові зауваження ShellCheck після авто-фіксів.
- **Side effects**:
  - Можливий вивід підказок у `stderr` (якщо немає `shellcheck`/`patch`).
  - Запис патчів у файли через `patch -p1` (модифікує source-файли).
  - Друк звичайного звіту ShellCheck у `stdout`/`stderr` на фінальному кроці.
- **Алгоритм**:
  1. `root = resolve(cwd)`.
  2. `shellcheck = resolveCmd('shellcheck')` → якщо немає, друк підказки та `return 1`.
  3. `patchBin = resolveCmd('patch')` → якщо немає, друк підказки та `return 1`.
  4. `files = listShellScriptPaths(root)` → якщо порожньо, `return 0`.
  5. Для кожного `rel` із `files`: `autofixOneFile(...)`. Якщо ненульовий код — негайний `return`.
  6. `return runFinalShellcheck(shellcheck, files, root)`.

### `autofixOneFile(shellcheck, patchBin, root, rel)`

- **Сигнатура**: `function autofixOneFile(shellcheck: string, patchBin: string, root: string, rel: string): number`
- **Параметри**:
  - `shellcheck` — абсолютний шлях до бінарника ShellCheck.
  - `patchBin` — абсолютний шлях до бінарника `patch`.
  - `root` — абсолютний `cwd` для spawn.
  - `rel` — відносний шлях файла від `root`.
- **Повертає**: `0` — більше нема чого фіксити (нормальне завершення циклу); `1` — помилка spawn чи помилка `patch`.
- **Side effects**: до 32 викликів `spawnSync(shellcheck, ['-f', 'diff', rel])` і `applyShellcheckDiff(...)` на файл; модифікує сам файл через `patch`.
- **Логіка**:
  - У циклі `0..MAX_FIX_ROUNDS_PER_FILE-1`:
    - Запускає `shellcheck -f diff <rel>` з `maxBuffer: 10MiB`.
    - Якщо `diffResult.error` — друкує повідомлення і повертає 1.
    - Якщо `shouldStopAutofixLoop(diffResult)` — повертає 0.
    - Інакше — `applyShellcheckDiff(...)`. На помилку — повертає 1.
  - Якщо досягнуто `MAX_FIX_ROUNDS_PER_FILE` — повертає 0 (захист від зациклення).

### `shouldStopAutofixLoop(diffResult)`

- **Сигнатура**: `function shouldStopAutofixLoop(diffResult: { status: number | null, stdout?: string | null, stderr?: string | null }): boolean`
- **Параметри**:
  - `diffResult` — об'єкт результату `spawnSync` (потрібні `status`, `stdout`, `stderr`).
- **Повертає**: `true`, якщо подальші ітерації авто-фіксів не мають сенсу.
- **Side effects**: немає (чиста перевірка).
- **Логіка**: повертає `true`, якщо
  - `status === 0` (ShellCheck не знайшов зауважень), **або**
  - `stderr` містить підрядок `'none were auto-fixable'` (`NON_AUTOFIXABLE_HINT`), **або**
  - `stdout` після `trim()` порожній (нема дифу для застосування).

### `applyShellcheckDiff(patchBin, root, rel, diffStdout)`

- **Сигнатура**: `function applyShellcheckDiff(patchBin: string, root: string, rel: string, diffStdout: string): number`
- **Параметри**:
  - `patchBin` — абсолютний шлях до `patch`.
  - `root` — `cwd` для spawn (корінь проєкту).
  - `rel` — відносний шлях файла, для якого формується diff (використовується тільки у повідомленні про помилку).
  - `diffStdout` — вміст unified-diff, отриманий від `shellcheck -f diff`.
- **Повертає**: `0` — патч застосовано; `1` — `patch` повернув ненульовий код.
- **Side effects**:
  - Запускає `patch -p1` із `diffStdout` через stdin.
  - На помилку виливає `stderr` і `stdout` процесу `patch` у `process.stderr`, а також додає рядок `run-shellcheck-text: patch не застосував diff для ${rel}`.

### `runFinalShellcheck(shellcheck, files, root)`

- **Сигнатура**: `function runFinalShellcheck(shellcheck: string, files: string[], root: string): number`
- **Параметри**:
  - `shellcheck` — абсолютний шлях до ShellCheck.
  - `files` — відносні шляхи усіх файлів для перевірки.
  - `root` — `cwd` для spawn.
- **Повертає**: `0` — звіт чистий; `1` — `spawnSync` віддав `error` або `status !== 0`.
- **Side effects**:
  - Виконує `shellcheck <files...>` без прапорця `-f diff`, з `maxBuffer: 10MiB` і `stdio: ['ignore', 'pipe', 'pipe']`.
  - Якщо є помилка — друкує `error.message` у `stderr`.
  - Якщо `status !== 0` — друкує `stdout` у `process.stdout` і `stderr` у `process.stderr`.

## Константи

| Ім'я                      | Значення                   | Призначення                                                                                            |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `NON_AUTOFIXABLE_HINT`    | `'none were auto-fixable'` | Маркер у stderr ShellCheck про відсутність авто-виправлень — критерій виходу з циклу `autofixOneFile`. |
| `MAX_FIX_ROUNDS_PER_FILE` | `32`                       | Жорсткий ліміт ітерацій `diff`+`patch` на один файл для уникнення зациклення.                          |

## Залежності

### Node.js (built-in)

- `node:child_process` → `spawnSync` — синхронний запуск `git`, `shellcheck`, `patch`.
- `node:fs` → `globSync` — пошук `*.sh` поза git-деревом.
- `node:path` → `resolve` — нормалізація `cwd` у абсолютний шлях.

### Внутрішні модулі

- `../../../scripts/cli-entry.mjs` → `isRunAsCli(import.meta.url)` — перевіряє, чи модуль запущено напряму як CLI (а не імпортовано).
- `../../../scripts/utils/resolve-cmd.mjs` → `resolveCmd(name)` — повертає абсолютний шлях до бінарника з PATH або `null`.

### Зовнішні бінарники (runtime)

- **shellcheck** — обов'язковий; без нього `runShellcheckText` повертає 1.
- **patch** — обов'язковий для авто-фіксів; без нього `runShellcheckText` повертає 1.
- **git** — необов'язковий: якщо доступний і ми у робочому дереві — використовується `git ls-files`; інакше — `globSync`.

## Потік виконання / Використання

### CLI

Скрипт можна запустити напряму:

```bash
node npm/rules/text/lint/run-shellcheck.mjs
```

Логіка CLI-входу:

```js
if (isRunAsCli(import.meta.url)) {
  process.exitCode = runShellcheckText()
}
```

`process.exitCode` встановлюється у значення, повернуте `runShellcheckText()` (0 або 1).

### Програмний виклик

```js
import { runShellcheckText, listShellScriptPaths } from './run-shellcheck.mjs'

// Повний прогон у поточному каталозі:
const code = runShellcheckText()

// Тільки список *.sh файлів:
const files = listShellScriptPaths(process.cwd())
```

### Високорівнева послідовність кроків `runShellcheckText`

1. `resolve(cwd)` → абсолютний `root`.
2. `resolveCmd('shellcheck')` → перевірка наявності бінарника. **Fail-fast**: підказка + `return 1`.
3. `resolveCmd('patch')` → перевірка наявності бінарника. **Fail-fast**: підказка + `return 1`.
4. `listShellScriptPaths(root)`:
   - `git` доступний і ми в робочому дереві → `git ls-files -z -- ':(glob)**/*.sh'` (NUL-роздільник, унікальні, відсортовані).
   - Інакше → `globSync('**/*.sh', { exclude: ... })` з виключенням `node_modules` (forward-slashes).
5. Якщо файлів немає → `return 0` (no-op).
6. Для кожного файла → `autofixOneFile(...)`:
   - Цикл до 32 разів: `shellcheck -f diff <rel>` → `patch -p1` (через stdin).
   - Виходить раніше, якщо `status === 0`, `none were auto-fixable`, або порожній diff.
7. `runFinalShellcheck(shellcheck, files, root)`:
   - `shellcheck <files...>` без формату diff.
   - Будь-який ненульовий статус → друк stdout/stderr у консоль і `return 1`.

### Коди виходу

| Код | Причина                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0` | Немає `*.sh` файлів, або всі пройшли фінальний `shellcheck` чисто (можливо, після авто-фіксів).                                                              |
| `1` | Немає `shellcheck`/`patch` у PATH; помилка `spawnSync` (наприклад, `ENOENT`); `patch` не застосував diff; фінальний `shellcheck` повернув ненульовий статус. |

### Ефекти на файлову систему

Авто-фікси **модифікують сам source `.sh`-файл** через `patch -p1`. Запуск передбачає, що користувач готовий побачити змінений вміст (наприклад, виконує перевірку перед коммітом у CI або локально).

### Контекст застосування

Модуль використовується у складі `lint-text` ланцюжка (правила `npm/rules/text/lint/`) для перевірки текстової частини проєкту, де shell-скрипти підлягають аналізу ShellCheck. Це частина набору `rules/text/lint/*`, описаного у `n-text.mdc` і `n-js-lint.mdc`.
