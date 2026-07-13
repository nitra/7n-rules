# `rename-yaml-extensions.mjs`

## Огляд

Файл `npm/bin/rename-yaml-extensions.mjs` — це **тонкий CLI-адаптер** (bin-обгортка) для перейменування розширень YAML-файлів у двох конвенціях:

- у каталозі `k8s` — файли `.yml` перейменовуються на `.yaml`;
- у каталозі `.github` — файли `.yaml` перейменовуються на `.yml`.

Сама **бізнес-логіка** перейменування реалізована окремо у `../scripts/rename-yaml-extensions.mjs` (звідти імпортуються `parseRenameYamlArgs` і `renameYamlExtensions`). Файл `npm/bin/rename-yaml-extensions.mjs` лише:

1. парсить аргументи командного рядка;
2. викликає функцію бізнес-логіки `renameYamlExtensions`;
3. форматує вивід у консоль (список перейменувань, повідомлення про відсутність змін, помилки);
4. повертає код виходу (`0` — успіх, `1` — були помилки).

Файл є **модулем для головного CLI пакета `n-rules`** (через `bin/n-rules.js`). Публічна точка входу для користувача — підкоманда головного CLI:

- `npx @7n/rules rename-yaml-extensions [опції]`
- або у репозиторії пакета: `bun ./bin/n-rules.js rename-yaml-extensions`.

Прямий запуск `node ./bin/rename-yaml-extensions.mjs` підтримується, але вважається режимом для розробки/тестів — у production-сценарії використовується диспетчер `n-rules.js`.

Підтримувані опції:

- `--dry-run` — лише вивести список запланованих перейменувань, нічого не змінюючи у файловій системі;
- `--root=<шлях>` — корінь обходу (за замовчуванням — `process.cwd()`).

## Експорти / API

Файл `npm/bin/rename-yaml-extensions.mjs` експортує одну функцію:

### `runRenameYamlExtensionsCli(argv)`

- **Тип**: `async function (argv: string[]): Promise<number>`
- **Призначення**: запустити перейменування YAML-розширень із форматованим виводом у консоль.
- **Параметри**:
  - `argv: string[]` — масив аргументів **без імені команди**. Тобто це все, що йде після `rename-yaml-extensions` при виклику через `n-rules`, або `process.argv.slice(2)` при прямому запуску.
- **Повертає**: `Promise<number>` — код виходу:
  - `0` — успіх (немає помилок, незалежно від кількості перейменованих файлів);
  - `1` — у процесі трапилися помилки (наприклад, цільовий файл уже існує).

Експорт — **named export** (`export async function`). За замовчуванням (`default`) нічого не експортується.

## Функції

### `runRenameYamlExtensionsCli(argv)` (експортна)

Алгоритм виконання:

1. **Парсинг аргументів**.
   - Викликається `parseRenameYamlArgs(argv)`, яка повертає об'єкт `{ dryRun, root }`:
     - `dryRun: boolean` — чи це режим симуляції;
     - `root: string` — абсолютний/відносний корінь обходу файлів.
2. **Префікс для виводу**.
   - Якщо `dryRun === true`, рядки логу починаються з `[dry-run] `; інакше — з порожнього префіксу.
3. **Виклик бізнес-логіки**.
   - Викликається `renameYamlExtensions(root, { dryRun })`, яка повертає об'єкт `{ renamed, errors }`:
     - `renamed: Array<{ relFrom: string, relTo: string }>` — успішні (або заплановані у dry-run) перейменування з відносними шляхами;
     - `errors: string[]` — повідомлення про помилки (наприклад, конфлікт існуючого цільового файлу).
4. **Вивід результатів**.
   - Для кожного елемента `renamed` друкується рядок виду `${label}${relFrom} → ${relTo}` (у `stdout`).
   - Якщо `renamed.length === 0` **і** `errors.length === 0` — друкується повідомлення `Немає файлів для перейменування (k8s + .yml → .yaml; .github + .yaml → .yml).` з префіксом `label`.
   - Для кожного елемента `errors` друкується рядок `  ❌ ${err}` у `stderr` (через `console.error`).
5. **Повернення коду**.
   - Якщо `errors.length > 0` — повертається `1`; інакше — `0`.

Функція **не кидає** виключень самостійно: помилки бізнес-логіки повертаються як масив `errors` і виводяться у `stderr`. Якщо `renameYamlExtensions` чи `parseRenameYamlArgs` кинуть exception, він пробрасується вище — і у блоці `if (isRunAsCli(...))` приведе до необробленого reject промісу.

### Топ-рівневий блок CLI

Не є функцією, але є виконуваним кодом на верхньому рівні модуля:

```js
if (isRunAsCli(import.meta.url)) {
  const code = await runRenameYamlExtensionsCli(process.argv.slice(2))
  if (code !== 0) {
    process.exitCode = 1
  }
}
```

Логіка:

- Перевіряється, чи цей модуль запущений як CLI (а не імпортований як бібліотека) через `isRunAsCli(import.meta.url)`.
- Якщо так — викликається `runRenameYamlExtensionsCli` з `process.argv.slice(2)` (аргументи без `node` та шляху до скрипту).
- Якщо код виходу не нульовий — встановлюється `process.exitCode = 1`. **Зауваження**: тут використано `process.exitCode = 1`, а **не** `process.exit(1)` — це дозволяє Node.js завершити поточний event loop коректно й уникнути обриву флешу `stdout`/`stderr`.

При імпорті модуля (як це робить `bin/n-rules.js`) цей блок **не виконується**, бо `isRunAsCli` поверне `false`.

## Залежності

### Внутрішні (з цього ж пакета)

- `../scripts/cli-entry.mjs` — імпорт **`isRunAsCli`**.
  - Призначення: визначає, чи поточний модуль запущено як CLI напряму (через `node ./bin/rename-yaml-extensions.mjs`) або імпортовано іншим модулем.
  - Параметр: `import.meta.url` поточного модуля.
- `../scripts/rename-yaml-extensions.mjs` — імпорт **`parseRenameYamlArgs`** і **`renameYamlExtensions`**.
  - `parseRenameYamlArgs(argv)` — розбирає прапорці `--dry-run` і `--root=<шлях>`, повертає `{ dryRun, root }`.
  - `renameYamlExtensions(root, options)` — виконує фактичний обхід `k8s` та `.github` і перейменування файлів. Опція `{ dryRun }` керує тим, чи лише симулювати дію.

### Зовнішні

Жодних `npm`-залежностей цей файл напряму не використовує. Усе, що потрібно, — це вбудовані Node.js глобали:

- `process` — для читання `process.argv` і встановлення `process.exitCode`;
- `console` — для `console.log` (успіх) і `console.error` (помилки);
- `import.meta.url` — для перевірки режиму запуску через `isRunAsCli`.

### Зв'язки в інший бік (хто використовує цей файл)

- `npm/bin/n-rules.js` — головний CLI пакета. Імпортує `runRenameYamlExtensionsCli` і викликає її для підкоманди `rename-yaml-extensions`.

## Потік виконання / Використання

### Сценарій 1. Запуск як підкоманда `n-rules` (типовий випадок)

```bash
npx @7n/rules rename-yaml-extensions
npx @7n/rules rename-yaml-extensions --dry-run
npx @7n/rules rename-yaml-extensions --root=./packages/my-app
```

Послідовність:

1. `n-rules.js` отримує `process.argv`, визначає підкоманду `rename-yaml-extensions`.
2. `n-rules.js` імпортує `runRenameYamlExtensionsCli` з `./rename-yaml-extensions.mjs`.
3. Викликає `runRenameYamlExtensionsCli(argvBezKomandy)`, де `argvBezKomandy` — усі аргументи **після** `rename-yaml-extensions`.
4. Функція парсить опції, викликає бізнес-логіку, друкує результат, повертає код.
5. `n-rules.js` встановлює `process.exitCode` відповідно до повернутого коду.

### Сценарій 2. Прямий запуск (розробка/тести)

```bash
node ./bin/rename-yaml-extensions.mjs
node ./bin/rename-yaml-extensions.mjs --dry-run
node ./bin/rename-yaml-extensions.mjs --root=/abs/path
```

Послідовність:

1. Node.js завантажує модуль.
2. Імпортуються `isRunAsCli`, `parseRenameYamlArgs`, `renameYamlExtensions`.
3. Експортується `runRenameYamlExtensionsCli`.
4. Виконується топ-рівневий блок `if (isRunAsCli(import.meta.url)) { ... }`.
5. У ньому викликається `runRenameYamlExtensionsCli(process.argv.slice(2))`.
6. За результатом встановлюється `process.exitCode = 1`, якщо є помилки.

### Сценарій 3. Імпорт як бібліотеки

```js
import { runRenameYamlExtensionsCli } from '@7n/rules/bin/rename-yaml-extensions.mjs'

const code = await runRenameYamlExtensionsCli(['--dry-run', '--root=./tmp'])
// code === 0 → успіх; code === 1 → були помилки
```

У цьому випадку:

- `isRunAsCli(import.meta.url)` повертає `false` (бо модуль завантажено через `import`, а не як точку входу Node.js);
- топ-рівневий блок CLI **не виконується**;
- викликач сам обробляє повернутий код.

### Приклади виводу

**Успішне перейменування**:

```
k8s/deployment.yml → k8s/deployment.yaml
.github/workflows/ci.yaml → .github/workflows/ci.yml
```

**Режим `--dry-run`**:

```
[dry-run] k8s/deployment.yml → k8s/deployment.yaml
[dry-run] .github/workflows/ci.yaml → .github/workflows/ci.yml
```

**Нічого не потрібно міняти**:

```
Немає файлів для перейменування (k8s + .yml → .yaml; .github + .yaml → .yml).
```

**Помилка** (наприклад, цільовий файл уже існує):

```
  ❌ k8s/deployment.yaml вже існує — пропускаю k8s/deployment.yml
```

(І процес завершиться з кодом виходу `1`.)

### Коди виходу

| Код | Значення                                                                 |
| --- | ------------------------------------------------------------------------ |
| `0` | Успіх. Усі заплановані перейменування виконано (або нічого не потрібно). |
| `1` | Виникли помилки (масив `errors` непорожній).                             |

### Архітектурні нотатки

- Файл свідомо тонкий: уся **алгоритмічна** робота (обхід директорій `k8s` та `.github`, перевірка існуючих файлів, фактичне `fs.rename`) — у `../scripts/rename-yaml-extensions.mjs`. Це дає змогу:
  - **тестувати** бізнес-логіку без процесу-обгортки;
  - **підключати** цю ж логіку до інших точок входу (наприклад, до підкоманд `n-rules`).
- Використання `process.exitCode` замість `process.exit(N)` — best practice для CLI, що працюють із асинхронним I/O: дозволяє коректно дочекатися флешу потоків перед завершенням.
- Перевірка `isRunAsCli(import.meta.url)` — стандартний у цьому пакеті патерн dual-mode модулів (одночасно і CLI, і imported lib). Реалізація — у `../scripts/cli-entry.mjs`.
