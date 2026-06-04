# stryker_config.mjs

## Огляд

Модуль `stryker_config` — це концерн (check) правила `test` (відповідає правилу `test.mdc` із набору `.cursor/rules/`). Його роль — гарантувати, що в усіх JS-roots проєкту присутні canonical baseline-файли конфігурації для mutation testing (Stryker) і unit-test runner-а (Vitest), а також що тестові артефакти не потрапляють у git.

Концерн виконує такі задачі:

- Self-gating: якщо в `.n-cursor.json` правило `js-lint` не включене або явно вимкнене (`disable-rules`), концерн нічого не робить і тихо повертає успіх.
- Визначення всіх JS-roots проєкту — кожен workspace із `package.json` у monorepo, або сам `cwd` у single-package режимі.
- Для кожного JS-root перевіряє наявність файлу `stryker.config.mjs`; якщо його немає — копіює canonical baseline з пакета. Для roots із Vue 3 SFC-файлами (`<script setup>`) використовує спеціальний vue-варіант baseline і додатково копіює локальний Stryker-плагін `stryker-vue-macros-ignorer.mjs`.
- Аналогічно для `vitest.config.js`.
- Додає в кореневий `.gitignore` патерни `**/reports/stryker/` і `**/coverage/`, щоб тестові артефакти не комітилися.

Файл є idempotent: повторні запуски на тому ж дереві не змінюють вже існуючі конфіги і не дублюють `.gitignore`-патерни.

## Експорти / API

Модуль експортує одну іменовану асинхронну функцію:

- `check(cwd?: string): Promise<number>` — entry-point концерна. Повертає exit code: `0` (успіх або silently skipped), `1` (порушення).

Інші функції модуля (`hasVueFiles`, `ensureBaselineFile`) є внутрішніми і не експортуються.

## Функції

### `hasVueFiles(jsRoot)`

```js
async function hasVueFiles(jsRoot)
```

- **Параметри:**
  - `jsRoot` (`string`) — абсолютний шлях до workspace-каталогу (JS-root).
- **Повертає:** `Promise<boolean>` — `true`, якщо в межах `<jsRoot>/src/**/*.vue` (виключаючи `node_modules`, `dist`, `reports`) знайдено хоча б один `.vue`-файл; інакше `false`.
- **Поведінка:** використовує `node:fs/promises#glob` із patterns `VUE_GLOB_PATTERN = 'src/**/*.vue'` і ignore-списком `VUE_GLOB_IGNORE = ['**/node_modules/**', '**/dist/**', '**/reports/**']`. Як тільки знаходить перший збіг — миттєво повертає `true` через `return` у тілі циклу `for await…of`, тому повний обхід директорії не виконується.
- **Side effects:** немає (read-only filesystem операція).

### `ensureBaselineFile(reporter, cwd, baselinePath, target, label)`

```js
async function ensureBaselineFile(reporter, cwd, baselinePath, target, label)
```

- **Параметри:**
  - `reporter` (`ReturnType<typeof createCheckReporter>`) — check-reporter для логування статусів pass/fail.
  - `cwd` (`string`) — корінь проєкту, використовується для побудови relative-шляхів у повідомленнях.
  - `baselinePath` (`string`) — абсолютний шлях до canonical baseline-файла у пакеті.
  - `target` (`string`) — абсолютний шлях, куди копіювати baseline.
  - `label` (`string`) — людиночитна мітка для логу (наприклад, `"stryker.config.mjs"` чи `"vitest.config.js"`).
- **Повертає:** `Promise<void>`.
- **Поведінка:** якщо `target` вже існує (`existsSync`) — логує `reporter.pass` із позначкою "існує" і виходить. Якщо ні — копіює `baselinePath` у `target` через `copyFile` і логує `reporter.pass` із поміткою "створено з canonical baseline ... (test.mdc)".
- **Side effects:** запис файлу через `copyFile` (тільки якщо target був відсутній); запис у reporter.
- **Idempotent:** так — повторний виклик на існуючому target не перезаписує файл.

### `check(cwd = process.cwd())`

```js
export async function check(cwd = process.cwd())
```

- **Параметри:**
  - `cwd` (`string`, опціональний) — корінь проєкту. За замовчуванням `process.cwd()` для CLI-сумісності.
- **Повертає:** `Promise<number>` — exit code (`0` — OK або silently skipped, `1` — порушення).
- **Side effects:**
  - Читає `.n-cursor.json` через `readNCursorConfigLite`.
  - Викликає `resolveAllJsRoots` для отримання списку JS-roots.
  - Перевіряє існування canonical baseline-файлів у самому пакеті.
  - Копіює `stryker.config.mjs` (canonical або vue-варіант), `vitest.config.js`, а для Vue-roots — `stryker-vue-macros-ignorer.mjs` у кожен JS-root, де відповідний файл відсутній.
  - Додає у кореневий `.gitignore` патерни `**/reports/stryker/` і `**/coverage/`, якщо їх там немає, через `ensureGitignoreEntries` із коментарем-секцією `"Test artifacts: Stryker + coverage (test.mdc)"`.
  - Накопичує статуси у reporter і повертає його exit code.

## Залежності

Стандартні модулі Node.js:

- `node:fs` — `existsSync` (синхронна перевірка наявності файла).
- `node:fs/promises` — `copyFile` (копіювання baseline у target), `glob` (пошук `.vue` файлів).
- `node:path` — `dirname`, `join`, `relative` (побудова абсолютних і relative шляхів).
- `node:url` — `fileURLToPath` (конвертація `import.meta.url` у POSIX-шлях для `dirname`).

Внутрішні залежності пакета:

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика reporter-а з API `pass(msg)`, `fail(msg)`, `getExitCode()`.
- `../../../scripts/lib/read-n-cursor-config-lite.mjs` → `readNCursorConfigLite` — читання `.n-cursor.json`, повертає об'єкт із полями `rules: string[]`, `disableRules: string[]`.
- `../../../scripts/utils/ensure-gitignore-entries.mjs` → `ensureGitignoreEntries(cwd, entries, sectionLabel)` — idempotent додавання патернів у кореневий `.gitignore`. Повертає `{ added: string[] }`.
- `../../../scripts/utils/resolve-js-root.mjs` → `resolveAllJsRoots(cwd)` — повертає масив абсолютних шляхів до всіх JS-roots: усі workspaces із `package.json` у monorepo, або `[cwd]` у single-package.

Зовнішні дані-файли (canonical baseline у пакеті `@nitra/cursor`):

- `data/stryker_config/stryker.config.baseline.mjs` — стандартний baseline Stryker (vitest-runner + perTest, mutate-патерни на Stryker defaults `src/**/*.{js,mjs,ts,jsx,tsx,cjs}`).
- `data/stryker_config/stryker.config.vue.baseline.mjs` — vue-варіант baseline; реєструє локальний Ignore-плагін `vue-macros`, щоб Stryker не загортав `defineProps`/`defineEmits`/... у coverage-тернарник (інакше `@vue/compiler-sfc` падає при компіляції SFC).
- `data/stryker_config/stryker-vue-macros-ignorer.mjs` — сам Stryker-плагін, який копіюється поруч із vue-варіантом baseline і реєструється з нього.
- `data/vitest_config/vitest.config.baseline.js` — мінімальний baseline Vitest для runner-а.

## Константи модуля

- `HERE` — каталог самого `stryker_config.mjs` (`dirname(fileURLToPath(import.meta.url))`).
- `STRYKER_BASELINE_PATH` — абсолютний шлях до стандартного `stryker.config.baseline.mjs`.
- `STRYKER_VUE_BASELINE_PATH` — абсолютний шлях до vue-варіанта baseline.
- `STRYKER_VUE_PLUGIN_PATH` — абсолютний шлях до `stryker-vue-macros-ignorer.mjs` у пакеті.
- `STRYKER_VUE_PLUGIN_FILENAME = 'stryker-vue-macros-ignorer.mjs'` — ім'я файлу, під яким плагін копіюється у jsRoot.
- `VITEST_BASELINE_PATH` — абсолютний шлях до canonical `vitest.config.baseline.js`.
- `TEST_GITIGNORE_ENTRIES = ['**/reports/stryker/', '**/coverage/']` — патерни, які додаються в корений `.gitignore`. Подвійний-зірочка-префікс `**/` забезпечує покриття всіх workspaces у monorepo (єдиний root `.gitignore`).
- `VUE_GLOB_PATTERN = 'src/**/*.vue'` — scope пошуку `.vue` файлів (відповідає Stryker mutate defaults для `src/`).
- `VUE_GLOB_IGNORE = ['**/node_modules/**', '**/dist/**', '**/reports/**']` — пропускаються build-артефакти і чужі `node_modules`, щоб не активувати vue-варіант через transitive-deps.

## Потік виконання / Використання

Концерн запускається або через CLI пакета `@nitra/cursor` (як один із checks правила `test`), або імпортно з іншого скрипта.

Алгоритм `check(cwd)` крок за кроком:

1. Створює `reporter` через `createCheckReporter()`.
2. Читає конфіг `.n-cursor.json` через `readNCursorConfigLite(cwd)`.
3. **Self-gate:** якщо `js-lint` відсутнє в `config.rules`, або присутнє в `config.disableRules` — повертає `reporter.getExitCode()` без жодних повідомлень (silently skipped). Це навмисна поведінка, щоб не шуміти у проєктах без JS coverage tooling.
4. Викликає `resolveAllJsRoots(cwd)`. Якщо повернувся порожній масив — це аномалія (`js-lint` enabled, але немає `package.json`); `reporter.fail` із повідомленням `'test: js-lint enabled, але кореневий package.json не знайдено (test.mdc)'` і повернення exit code.
5. Перевіряє існування всіх чотирьох canonical baseline-файлів у пакеті (`STRYKER_BASELINE_PATH`, `STRYKER_VUE_BASELINE_PATH`, `STRYKER_VUE_PLUGIN_PATH`, `VITEST_BASELINE_PATH`). Якщо будь-якого з них немає — `reporter.fail` із вимогою перевстановити `@nitra/cursor` і early-return.
6. Для кожного `jsRoot` із `jsRoots`:
   - Визначає `isVueRoot = await hasVueFiles(jsRoot)`.
   - Обирає `strykerBaseline = isVueRoot ? STRYKER_VUE_BASELINE_PATH : STRYKER_BASELINE_PATH`.
   - Через `ensureBaselineFile` копіює `strykerBaseline` у `<jsRoot>/stryker.config.mjs` (якщо відсутній).
   - Якщо `isVueRoot` — додатково через `ensureBaselineFile` копіює `STRYKER_VUE_PLUGIN_PATH` у `<jsRoot>/stryker-vue-macros-ignorer.mjs`.
   - Через `ensureBaselineFile` копіює `VITEST_BASELINE_PATH` у `<jsRoot>/vitest.config.js`.
7. Викликає `ensureGitignoreEntries(cwd, TEST_GITIGNORE_ENTRIES, 'Test artifacts: Stryker + coverage (test.mdc)')` — додає в кореневий `.gitignore` патерни `**/reports/stryker/` і `**/coverage/` (якщо їх там немає). Якщо щось дійсно було додане (`added.length > 0`) — `reporter.pass` із перелічуванням доданих патернів.
8. Повертає `reporter.getExitCode()` — `0`, якщо жодного `fail` не було, інакше `1`.

### Приклад використання

```js
import { check } from '@nitra/cursor/rules/test/js/stryker_config.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

Зазвичай безпосередній виклик не потрібен — концерн запускається диспетчером правила `test` (`test.mdc`) у складі команди `n-cursor fix` / `n-cursor check`.

### Спостережувані ефекти у файловій системі

Після успішного прогону в кожному JS-root з'являються:

- `stryker.config.mjs` (стандартний або vue-варіант, залежно від наявності `.vue` у `src/`).
- `vitest.config.js`.
- `stryker-vue-macros-ignorer.mjs` — тільки для Vue-roots.

У кореневому `.gitignore` гарантовано присутні:

- `**/reports/stryker/`
- `**/coverage/`

Якщо файл уже існував — він не перезаписується, що дозволяє користувачу безпечно кастомізувати baseline під специфіку проєкту.
