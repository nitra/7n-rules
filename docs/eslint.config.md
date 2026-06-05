# `eslint.config.js`

## Огляд

Файл `eslint.config.js` — це кореневий ESLint flat-config монорепозиторію `nitra/cursor`. Він задає правила лінтингу JavaScript/Vue-коду через композицію спільної конфігурації `@nitra/eslint-config` і кількох локальних overrides. Файл експортує масив конфіг-об'єктів у форматі ESLint Flat Config (підтримується ESLint >= 9).

Основні задачі цього файлу:

1. Виключити з лінтингу згенеровані/побічні артефакти (`docs/**`, `coverage`, Stryker output, `auto-imports.d.ts`, `COVERAGE.md`).
2. Підключити спільну конфігурацію `@nitra/eslint-config` із вказівкою, що `npm/**` — це Node-код, а `demo` — це Vue-проєкт.
3. Додати Node globals (`globals.node`) для файлів `npm/**/*.mjs` і `npm/**/*.cjs`, які `@nitra/eslint-config` за замовчуванням не покриває.
4. Додати exception для правила `n/no-extraneous-import` у `npm/**/*.{js,mjs,cjs}` — дозволити імпорт `vitest`, `@vitest/coverage-v8`, `@stryker-mutator/vitest-runner` із кореневого `package.json` (через bun hoisted `node_modules`), оскільки в `npm/package.json` ці пакети як devDependencies заборонені.

## Експорти / API

### `export default` (масив)

Файл має один іменований експорт — `default`. Це масив із чотирьох конфіг-об'єктів формату ESLint Flat Config:

| Індекс | Тип об'єкта                                             | Призначення                                                                                                         |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `0`    | `{ ignores: string[] }`                                 | Глобальні ігнор-патерни для всього лінтингу                                                                         |
| `1..N` | `...getConfig({ node: ['npm'], vue: ['demo'] })`        | Розпакований масив базової конфігурації `@nitra/eslint-config` (кількість елементів визначається самим `getConfig`) |
| `N+1`  | `{ files, languageOptions: { globals } }`               | Додавання Node globals для `npm/**/*.{mjs,cjs}`                                                                     |
| `N+2`  | `{ files, rules: { 'n/no-extraneous-import': [...] } }` | Override правила `n/no-extraneous-import` для `npm/**/*.{js,mjs,cjs}`                                               |

ESLint застосовує елементи масиву послідовно: пізніші об'єкти можуть перевизначати/доповнювати раніші, якщо їх `files` патерн збігається з конкретним файлом, що лінтиться.

## Функції

У файлі `eslint.config.js` немає власно оголошених функцій. Використовується тільки виклик зовнішньої функції `getConfig` з пакета `@nitra/eslint-config` і spread-оператор `...` для його результату.

### Виклик `getConfig({ node, vue })`

- **Сигнатура (як використано тут):** `getConfig(options: { node?: string[]; vue?: string[] }): FlatConfigItem[]`
- **Параметри:**
  - `node: ['npm']` — масив імен директорій/префіксів workspace, для яких базова конфігурація вмикає Node-режим (Node globals, правила `eslint-plugin-n` тощо). Тут — лише `npm` (тобто `npm/**/*.js` за нотаткою у коментарі).
  - `vue: ['demo']` — масив імен директорій, для яких базова конфігурація вмикає Vue-режим (парсер `vue-eslint-parser`, правила `eslint-plugin-vue`). Тут — `demo`.
- **Що повертає:** масив `FlatConfigItem[]` — готові flat-config об'єкти, які потім розпаковуються spread-ом у фінальний масив експорту.
- **Side effects:** жодних на рівні `eslint.config.js`; внутрішня поведінка `getConfig` — поза межами цього файлу.

Важливе зауваження з коментаря у файлі: `getConfig({ node: ['npm'] })` всередині `@nitra/eslint-config` задає Node globals лише для glob `npm/**/*.js`, **не** для `.mjs` і `.cjs`. Саме тому в файлі `eslint.config.js` є додатковий override, що додає `globals.node` для `npm/**/*.{mjs,cjs}` (інакше ESLint видавав би `no-undef` на `process` і `console`).

## Залежності

### Зовнішні npm-пакети (імпорти)

| Імпорт      | Джерело                | Призначення                                                                                                                                                       |
| ----------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getConfig` | `@nitra/eslint-config` | Фабрика, що генерує базовий масив flat-config об'єктів для монорепозиторію (правила, парсери, plugin-и для Node/Vue)                                              |
| `globals`   | `globals`              | Стандартний npm-пакет із наборами глобальних змінних для різних середовищ; тут використовується `globals.node` (`process`, `console`, `Buffer`, `__dirname` тощо) |

### Неявні залежності (через `@nitra/eslint-config`)

Базова конфігурація `@nitra/eslint-config` приносить з собою плагіни/парсери, які `getConfig` використовує. У `eslint.config.js` ці імена явно не імпортуються, але присутні через результат `getConfig`:

- `eslint-plugin-n` — постачальник правила `n/no-extraneous-import`, яке override-иться у четвертому елементі масиву.
- (Інші — парсери для Vue, базові правила тощо — деталі залежать від реалізації `@nitra/eslint-config`.)

### Файли/глобальні артефакти, на які посилається конфіг

- `**/auto-imports.d.ts` — згенерований TypeScript-файл (наприклад, від `unplugin-auto-import`).
- `docs/**` — директорія документації (наприклад, ця сама `docs/eslint.config.md` буде проігнорована).
- `.claude/worktrees/**` — захищена директорія Claude Code worktrees.
- `**/coverage/**` — звіти тестового покриття.
- `**/reports/stryker/**` — sandbox/output мутаційного тестування Stryker.
- `COVERAGE.md`, `**/COVERAGE.md` — згенерований markdown-звіт покриття (містить JS-snippets).

## Потік виконання / Використання

### Як ESLint застосовує цей файл

1. ESLint (через `bun run lint` або прямий запуск `eslint .`) шукає у корені проєкту файл `eslint.config.js` (Flat Config — стандарт у ESLint >= 9, активований через `package.json` `type: "module"` або через `.mjs`).
2. ESLint імпортує `default`-експорт цього файлу — масив конфіг-об'єктів.
3. Для кожного файлу-кандидата ESLint:
   - Перевіряє перший елемент масиву — `{ ignores: [...] }`. Якщо шлях файлу збігається з будь-яким із глобальних патернів — файл повністю виключається з лінтингу.
   - Інакше — застосовує всі елементи масиву, у яких `files`-патерн (або відсутність `files`) збігається з файлом, у порядку від першого до останнього. Пізніші правила можуть перевизначати раніші.

### Конкретні сценарії

- **Файл `npm/foo/bar.js`** — потрапляє під `getConfig({ node: ['npm'] })` (Node globals, правила n/), плюс під override `n/no-extraneous-import` (дозвіл на `vitest`/`@vitest/coverage-v8`/`@stryker-mutator/vitest-runner`).
- **Файл `npm/foo/bar.mjs`** — НЕ отримує Node globals від `getConfig` (за коментарем у файлі), тому отримує їх через override `{ files: ['npm/**/*.{mjs,cjs}'], languageOptions: { globals: { ...globals.node } } }`. Також отримує override `n/no-extraneous-import`.
- **Файл `npm/foo/bar.cjs`** — поведінка ідентична `.mjs`-кейсу: Node globals через override, `n/no-extraneous-import` через override.
- **Файл `demo/src/App.vue`** — лінтується у Vue-режимі (через `getConfig({ vue: ['demo'] })`). Overrides `npm/**` його не торкаються.
- **Файл `docs/eslint.config.md`** — ігнорується глобальним `ignores: ['docs/**']`.
- **Файл `COVERAGE.md`** (як у корені, так і вкладений `**/COVERAGE.md`) — ігнорується.
- **Файли під `**/coverage/**`і`**/reports/stryker/**`** — ігноруються (згенеровані артефакти, gitignored).

### Команди, що використовують цей конфіг

Будь-який запуск ESLint у корені монорепозиторію `nitra/cursor` автоматично читає `eslint.config.js`. Типові команди (за конвенціями монорепозиторію):

- `bun run lint` — кореневий аліас, який запускає ESLint (і, ймовірно, інші лінтери) для всього проєкту.
- `bun run lint-js` — підкоманда, що лінтить лише JavaScript/Vue.
- `eslint <path>` — прямий запуск.

Правила паралельності з кореневого `CLAUDE.md`: заборонено запускати `eslint` паралельно у різних задачах/субагентах — один послідовний прогон на сесію.

### Rebuild Test (відтворення логіки за документом)

Для відтворення `eslint.config.js` із цього документа достатньо:

1. Імпортувати `getConfig` з `@nitra/eslint-config` і `globals` з `globals`.
2. Експортувати default-масив із чотирьох елементів:
   - **Елемент 1.** Об'єкт `{ ignores: [...] }` із масивом патернів: `'**/auto-imports.d.ts'`, `'docs/**'`, `'.claude/worktrees/**'`, `'**/coverage/**'`, `'**/reports/stryker/**'`, `'COVERAGE.md'`, `'**/COVERAGE.md'`.
   - **Елементи 2..N.** Розпакувати spread-ом результат `getConfig({ node: ['npm'], vue: ['demo'] })`.
   - **Елемент N+1.** Об'єкт `{ files: ['npm/**/*.{mjs,cjs}'], languageOptions: { globals: { ...globals.node } } }`.
   - **Елемент N+2.** Об'єкт `{ files: ['npm/**/*.{js,mjs,cjs}'], rules: { 'n/no-extraneous-import': ['error', { allowModules: ['vitest', '@vitest/coverage-v8', '@stryker-mutator/vitest-runner'] }] } }`.

Жодних інших побічних ефектів, виконання логіки чи мутацій модуль не має — це декларативний конфіг.
