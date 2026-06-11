---
docgen:
  source: npm/rules/docker/lint/lint.mjs
  crc: 98a98d10
---

# lint.mjs — реалізація підкоманди `lint-docker`

## Огляд

Модуль `npm/rules/docker/lint/lint.mjs` реалізує підкоманду `lint-docker` інструмента `n-cursor`. Її задача — знайти у дереві репозиторію канонічні Dockerfile-и та пропустити їх через `hadolint`, фіксуючи результат у форматі звіту `check-reporter` і виставляючи числовий код виходу.

Особливості, що визначають поведінку:

- Перевіряються **лише** файли з іменем, що рівне `Dockerfile` (регістр не важливий) та файли, ім’я яких закінчується на суфікс `.dockerfile` (наприклад, `app.Dockerfile`, `worker.dockerfile`). Файли виду `Dockerfile.dev`, `Containerfile` й інші варіанти, які бере `check-docker`, тут навмисно **не** обробляються.
- Обхід дерева виконується тим самим `walkDir`, що й у `check-docker`, з тими самими пропусками каталогів (на основі `.cursorignore`/конфігу Cursor).
- Виклик `hadolint` йде через `lintDockerfileWithHadolint` із `../lib/docker-hadolint.mjs` — інструмент шукається у `PATH` або запускається в Docker (`docker run`).
- Серіалізація важкої CLI-команди (тільки один паралельний прогін на репозиторій і дедуплікація за станом git-дерева) виконана через `runStandardLint` — це канонічний патерн для `lint-*` команд згідно з `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд». Прямий `withLock` тут не використовується.
- Запуск файла напряму через Node (`node lint.mjs`) працює як CLI: модуль ставить `process.exitCode` у код, повернений `runLintDocker`.

## Експорти / API

| Експорт                   | Вид                     | Призначення                                                                                    |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `isLintDockerfileName`    | `function`              | Перевіряє basename файла: чи входить він до набору `lint-docker`.                              |
| `findLintDockerfilePaths` | `async function`        | Збирає відсортований список абсолютних шляхів придатних для `lint-docker` файлів.              |
| `runLintDocker`           | `() => Promise<number>` | Публічна CLI-форма команди `lint-docker`: серіалізований прогон з кешуванням за станом дерева. |

Внутрішня (не експортована) функція:

- `runLintDockerSteps()` — самі кроки lint-у без обгортки локу й дедупу. Викликається `runStandardLint`.

CLI-режим (`if (isRunAsCli(import.meta.url))`) при прямому запуску файла ставить `process.exitCode = await runLintDocker()`.

## Функції

### `isLintDockerfileName(name)`

```js
export function isLintDockerfileName(name): boolean
```

- **Параметри:**
  - `name: string` — basename шляху (тобто лише ім’я файла, без каталогів).
- **Повертає:** `boolean` — `true`, якщо файл підходить під набір `lint-docker`, інакше `false`.
- **Логіка:**
  1. Зводить ім’я до нижнього регістру (`n`).
  2. Якщо `n === 'dockerfile'` — повертає `true`.
  3. Інакше повертає `true`, лише якщо `n` закінчується на `.dockerfile` **і** довжина `n` строго більша за довжину суфікса `.dockerfile`. Завдяки цій додатковій умові саме `.dockerfile` (без префікса) — не валідний кейс.
- **Side effects:** немає.
- **Приклади:**
  - `isLintDockerfileName('Dockerfile')` → `true`
  - `isLintDockerfileName('dockerfile')` → `true`
  - `isLintDockerfileName('app.Dockerfile')` → `true`
  - `isLintDockerfileName('worker.dockerfile')` → `true`
  - `isLintDockerfileName('.dockerfile')` → `false`
  - `isLintDockerfileName('Dockerfile.dev')` → `false`
  - `isLintDockerfileName('Containerfile')` → `false`

### `findLintDockerfilePaths(root, ignorePaths = [])`

```js
export async function findLintDockerfilePaths(root, ignorePaths = []): Promise<string[]>
```

- **Параметри:**
  - `root: string` — корінь обходу (зазвичай корінь репозиторію).
  - `ignorePaths?: string[]` — абсолютні шляхи каталогів, повністю виключених з обходу (за замовчуванням пустий масив).
- **Повертає:** `Promise<string[]>` — масив абсолютних шляхів придатних файлів, відсортований за `String.prototype.localeCompare` через `Array.prototype.toSorted` (не мутує проміжний масив).
- **Логіка:**
  1. Створює локальний акумулятор `out`.
  2. Викликає `walkDir(root, visit, ignorePaths)`, де `visit(p)` додає `p` до `out`, якщо `isLintDockerfileName(basename(p))` істинне.
  3. Повертає `out.toSorted((a, b) => a.localeCompare(b))`.
- **Side effects:** виконує асинхронний обхід файлової системи через `walkDir`. Не пише нічого на диск і нічого не виводить у stdout/stderr.

### `runLintDockerSteps()` _(internal)_

```js
async function runLintDockerSteps(): Promise<number>
```

- **Параметри:** немає.
- **Повертає:** `Promise<number>` — `reporter.getExitCode()`: `0`, якщо помилок не зафіксовано, `1`, якщо хоча б один `fail`.
- **Логіка:**
  1. Створює репортер: `const reporter = createCheckReporter(); const { pass, fail } = reporter`.
  2. Бере `root = process.cwd()`.
  3. Завантажує `ignorePaths` через `await loadCursorIgnorePaths(root)`.
  4. Шукає кандидатів: `files = await findLintDockerfilePaths(root, ignorePaths)`.
  5. Якщо `files.length === 0` — викликає `pass('lint-docker: немає Dockerfile / *.Dockerfile — hadolint пропущено')` і повертає `reporter.getExitCode()`.
  6. Інакше повідомляє `pass(\`lint-docker: файлів для hadolint: ${files.length}\`)`.
  7. Для кожного абсолютного шляху `abs`:
     - Обчислює відносний шлях `rel = posixRel(root, abs) || basename(abs)` — якщо `posixRel` повернула порожній рядок, береться лише basename.
     - Викликає `const { ok, stdout, stderr, via } = lintDockerfileWithHadolint(root, abs)` (синхронний виклик, як видно з відсутності `await`).
     - Об’єднує `stdout + stderr`, тримує (`trim()`) у `tail`.
     - Якщо `ok` — `pass(\`${rel} (${via})\`)`.
     - Якщо ні — формує `detail = tail ? \`:\n${tail}\` : ''` і викликає `fail(\`${rel} (${via})${detail}\`)`.
  8. Повертає `reporter.getExitCode()`.
- **Side effects:**
  - Читає поточну робочу директорію (`process.cwd()`).
  - Читає файлову систему репозиторію через `walkDir`/`loadCursorIgnorePaths`.
  - Запускає зовнішній процес `hadolint` (через `PATH` або через `docker run`) для кожного знайденого Dockerfile.
  - Пише повідомлення у консоль/звіт через `pass`/`fail` репортера.

### `runLintDocker`

```js
export const runLintDocker = (): Promise<number> =>
  runStandardLint(import.meta.dirname, runLintDockerSteps)
```

- **Параметри:** немає.
- **Повертає:** `Promise<number>` — фінальний код виходу команди.
- **Логіка:** делегує виконання у `runStandardLint`, передаючи:
  - `import.meta.dirname` — каталог цього модуля (`npm/rules/docker/lint`); `runStandardLint` використовує його як ідентифікатор/корінь для серіалізації та для дедуплікації запусків за станом git-дерева;
  - `runLintDockerSteps` — асинхронну функцію з фактичними кроками lint-у.
- **Side effects:** усі побічні ефекти `runStandardLint` (взяття локу `lint-docker`, перевірка попереднього стану git, можливе пропускання запуску при ідентичному стані тощо) + усі ефекти `runLintDockerSteps`.

### CLI-ентрі

```js
if (isRunAsCli(import.meta.url)) {
  process.exitCode = await runLintDocker()
}
```

- **Поведінка:** при прямому запуску модуля як Node-скрипта (`node npm/rules/docker/lint/lint.mjs` або у вигляді ESM bin) встановлює `process.exitCode` у значення, повернене `runLintDocker()`. Імпорт як модуля з іншого файла не активує цю гілку.
- **Side effects:** мутує `process.exitCode`.

## Залежності

### Зовнішні (Node API)

- `node:path` — використовується лише `basename` для виділення імені файла зі шляху.

### Внутрішні модулі репозиторію

| Імпорт                                        | Що з нього береться                      | Роль у цьому модулі                                                                         |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `../../../scripts/cli-entry.mjs`              | `isRunAsCli`                             | Визначення, чи модуль запущено як CLI напряму.                                              |
| `../lib/docker-hadolint.mjs`                  | `lintDockerfileWithHadolint`, `posixRel` | Власне виклик `hadolint` (через PATH або `docker run`) і обчислення POSIX-відносного шляху. |
| `../../../scripts/lib/check-reporter.mjs`     | `createCheckReporter`                    | Створення репортера з методами `pass`/`fail` і фінальним `getExitCode`.                     |
| `../../../scripts/lib/load-cursor-config.mjs` | `loadCursorIgnorePaths`                  | Завантаження списку каталогів, які потрібно ігнорувати під час обходу.                      |
| `../../../scripts/utils/walkDir.mjs`          | `walkDir`                                | Асинхронний обхід дерева файлів з підтримкою списку ігнорувань.                             |
| `../../../scripts/lib/run-standard-lint.mjs`  | `runStandardLint`                        | Канонічна обгортка `lint-*`-команд: лок, дедуп за станом git-дерева, уніфікований запуск.   |

### Зовнішні CLI/інструменти, що викликаються опосередковано

- `hadolint` — або з `PATH`, або через `docker run` (визначається в `lintDockerfileWithHadolint`).
- Опосередковано — `git` (для обчислення стану дерева всередині `runStandardLint`), `docker` (якщо `hadolint` запускається в контейнері).

## Потік виконання / Використання

### Послідовність дій при `n-cursor lint-docker`

1. `bin/n-cursor.js` диспатчить підкоманду `lint-docker` на `runLintDocker` із цього модуля.
2. `runLintDocker` → `runStandardLint(import.meta.dirname, runLintDockerSteps)`:
   - бере серіалізаційний лок на ім’я `lint-docker`;
   - перевіряє стан git-дерева; якщо стан збігається з попереднім успішним прогоном — крок може бути пропущено (дедуп);
   - інакше викликає `runLintDockerSteps`.
3. `runLintDockerSteps`:
   - читає `cwd`;
   - завантажує `ignorePaths`;
   - обходить дерево і збирає Dockerfile-кандидатів (тільки `Dockerfile` і `*.Dockerfile`/`*.dockerfile`);
   - якщо нічого не знайдено — фіксує `pass` про пропуск і виходить;
   - інакше повідомляє кількість файлів і по кожному викликає `lintDockerfileWithHadolint`;
   - кожен результат маркується як `pass` або `fail` (з прикладеним хвостом `stdout`+`stderr`).
4. Підсумковий `reporter.getExitCode()` повертається у `runStandardLint`, а той — у `runLintDocker`.
5. При прямому запуску файла Node — код виходу пишеться у `process.exitCode`.

### Як це використовується ззовні

- **CLI:** `bun run n-cursor lint-docker` (або відповідний bin-скрипт) — основний сценарій.
- **Програмно з інших скриптів:**

  ```js
  import { runLintDocker } from 'npm/rules/docker/lint/lint.mjs'

  const code = await runLintDocker() // 0 — OK, 1 — є зауваження/помилки
  ```

- **Тести/допоміжний код:**

  ```js
  import { isLintDockerfileName, findLintDockerfilePaths } from 'npm/rules/docker/lint/lint.mjs'

  isLintDockerfileName('Dockerfile') // true
  isLintDockerfileName('app.Dockerfile') // true
  isLintDockerfileName('Dockerfile.dev') // false

  const files = await findLintDockerfilePaths(process.cwd(), [])
  ```

### Контракт коду виходу

- `0` — або не знайдено Dockerfile-ів, або всі знайдені пройшли `hadolint`.
- `1` — хоча б один файл не пройшов `hadolint` (або зафіксована інша помилка через `fail`).

### Відмінності від `check-docker`

- `check-docker` працює з ширшим набором імен (зокрема `Dockerfile.*`, `Containerfile` тощо).
- `lint-docker` свідомо звужений до канонічного `Dockerfile` та суфікса `.dockerfile`, що відповідає правилу `docker.mdc` для самого hadolint-кроку.
- Серіалізація `lint-docker` — через `runStandardLint`, а не через прямий `withLock`, як того вимагає `scripts.mdc`.
