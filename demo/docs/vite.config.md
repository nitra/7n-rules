# vite.config.js

## Огляд

Файл `demo/vite.config.js` — це конфігураційний файл збирача Vite для демонстраційного застосунку у теці `demo/`. Файл формує об'єкт конфігурації Vite через хелпер `defineConfig` і реєструє три плагіни-обгортки: `VueMacros`, `Vue` (плагін `@vitejs/plugin-vue`, переданий усередину `VueMacros`) та `AutoImport`. Конфігурація вмикає підтримку Vue SFC, розширених Vue Macros і автоматичного імпорту API з пакета `vue` з генерацією TypeScript-декларацій у `src/auto-imports.d.ts`.

Файл є ESM-модулем (використовує синтаксис `import` / `export default`). Поза `export default` файл не містить власних функцій, класів чи runtime-логіки — лише декларативну конфігурацію.

## Експорти / API

Файл `demo/vite.config.js` має один експорт:

- `export default` — результат виклику `defineConfig({ plugins: [...] })`. За контрактом `vite` цей default-експорт є об'єктом конфігурації Vite (тип `UserConfig` або функція, що його повертає; в цьому файлі — об'єкт). Vite автоматично підхоплює цей default-експорт при запуску команд `vite`, `vite build`, `vite preview`.

Іменованих експортів немає.

## Функції

Власних функцій у файлі `demo/vite.config.js` не оголошено. Усі виклики у файлі — це виклики імпортованих функцій від сторонніх пакетів:

### defineConfig

- **Походження**: імпортується з `vite`.
- **Сигнатура (контракт Vite)**: `defineConfig(config: UserConfig | UserConfigFn): UserConfig | UserConfigFn`.
- **Параметри**: `config` — об'єкт конфігурації Vite. У файлі `demo/vite.config.js` передається `{ plugins: [VueMacros({...}), AutoImport({...})] }`.
- **Що повертає**: той самий об'єкт `config` без модифікацій; функція існує лише для типізації / автодоповнення в IDE.
- **Side effects**: відсутні.

### VueMacros

- **Походження**: імпортується як default-експорт з `vue-macros/vite`.
- **Сигнатура (контракт `vue-macros/vite`)**: `VueMacros(options): Plugin | Plugin[]`.
- **Параметри у файлі `demo/vite.config.js`**: `{ plugins: { vue: Vue() } }` — об'єкт із полем `plugins.vue`, у яке передано результат виклику `Vue()` (тобто інстанс плагіна `@vitejs/plugin-vue`).
- **Що повертає**: Vite-плагін або масив плагінів, що додають підтримку Vue Macros (розширений синтаксис у Vue SFC) поверх стандартного плагіна Vue.
- **Side effects**: під час збирання модифікує конвеєр обробки `.vue`-файлів, обгортаючи плагін `Vue()`.

### Vue

- **Походження**: імпортується як default-експорт з `@vitejs/plugin-vue`.
- **Сигнатура (контракт `@vitejs/plugin-vue`)**: `Vue(options?): Plugin`.
- **Параметри у файлі `demo/vite.config.js`**: викликається без аргументів — `Vue()`.
- **Що повертає**: офіційний Vite-плагін для обробки Vue 3 Single-File Components (`.vue`).
- **Side effects**: компілює `.vue`-файли під час dev-сервера та продакшн-збірки.

### AutoImport

- **Походження**: імпортується як default-експорт з `unplugin-auto-import/vite`.
- **Сигнатура (контракт `unplugin-auto-import/vite`)**: `AutoImport(options): Plugin`.
- **Параметри у файлі `demo/vite.config.js`**:
  - `imports: ['vue']` — пресет автоімпорту: автоматично робить доступними у вихідному коді API з пакета `vue` (наприклад, `ref`, `computed`, `watch`, `onMounted` тощо) без явного `import { ... } from 'vue'`.
  - `dts: 'src/auto-imports.d.ts'` — шлях до файлу TypeScript-декларацій, який плагін згенерує/оновлюватиме, аби IDE та tsc бачили автоімпортовані символи.
- **Що повертає**: Vite-плагін, що додає авто-імпорти до конвеєра збирання.
- **Side effects**:
  - на диску створюється/оновлюється файл `src/auto-imports.d.ts` (відносно кореня запуску Vite — тобто `demo/src/auto-imports.d.ts`).
  - під час трансформації коду плагін інжектить необхідні `import`-вирази для використаних, але не імпортованих явно символів з пресету `vue`.

## Залежності

### Імпорти ESM

- `@vitejs/plugin-vue` → default-експорт `Vue` (рядок 1: `import Vue from '@vitejs/plugin-vue'`).
- `unplugin-auto-import/vite` → default-експорт `AutoImport` (рядок 2: `import AutoImport from 'unplugin-auto-import/vite'`).
- `vue-macros/vite` → default-експорт `VueMacros` (рядок 3: `import VueMacros from 'vue-macros/vite'`).
- `vite` → іменований експорт `defineConfig` (рядок 4: `import { defineConfig } from 'vite'`).

### Очікувані пакети у `package.json`

Файл `demo/vite.config.js` припускає наявність у `devDependencies` (або `dependencies`) пакетів: `vite`, `@vitejs/plugin-vue`, `unplugin-auto-import`, `vue-macros`. Без них Node/Bun не зможе resolved-ити імпорти й виконати конфіг.

### Файлові артефакти

- `src/auto-imports.d.ts` — згенерує плагін `AutoImport` при першому запуску Vite з цією конфігурацією (відносно поточної робочої теки Vite — тобто `demo/src/auto-imports.d.ts`).

## Потік виконання / Використання

### Запуск

1. Розробник запускає Vite з кореня `demo/` (наприклад, `bunx vite`, `bun run dev`, `vite build`).
2. Vite читає файл `demo/vite.config.js` як ESM-модуль.
3. Виконуються `import`-и: завантажуються `Vue`, `AutoImport`, `VueMacros`, `defineConfig`.
4. Обчислюється default-експорт:
   - викликається `Vue()` без аргументів — отримуємо плагін `@vitejs/plugin-vue`.
   - результат `Vue()` передається у `VueMacros({ plugins: { vue: Vue() } })` — отримуємо плагін(и) Vue Macros, налаштовані поверх плагіна Vue.
   - викликається `AutoImport({ imports: ['vue'], dts: 'src/auto-imports.d.ts' })` — отримуємо плагін авто-імпорту.
   - формується масив `plugins: [VueMacros(...), AutoImport(...)]`.
   - `defineConfig` повертає об'єкт `{ plugins: [...] }` як є.
5. Vite реєструє масив плагінів у тому порядку, в якому вони вказані: спочатку `VueMacros` (з вкладеним `Vue`), потім `AutoImport`.

### Поведінка під час dev / build

- `.vue`-файли компілюються плагіном `Vue` (через `VueMacros`), із підтримкою розширеного синтаксису Vue Macros.
- У `.vue`/`.js`/`.ts` файлах застосунку можна вживати API з пакета `vue` (наприклад, `ref`, `reactive`, `computed`) без явних `import`-ів — їх інжектить `AutoImport`.
- Декларації автоімпортів виносяться у `src/auto-imports.d.ts`, щоб TypeScript/IDE бачили доступні символи.

### Rebuild Test (відтворення логіки)

Щоб відтворити файл `demo/vite.config.js` за цією документацією:

1. Створити ESM-файл `vite.config.js`.
2. Імпортувати default-експорти: `Vue` з `@vitejs/plugin-vue`, `AutoImport` з `unplugin-auto-import/vite`, `VueMacros` з `vue-macros/vite`.
3. Імпортувати іменований `defineConfig` з `vite`.
4. Зробити `export default defineConfig({ ... })` з полем `plugins`, що містить два елементи у такому порядку:
   - `VueMacros({ plugins: { vue: Vue() } })`,
   - `AutoImport({ imports: ['vue'], dts: 'src/auto-imports.d.ts' })`.
5. Жодних інших полів конфігурації, жодних іменованих експортів, жодних додаткових викликів у файлі не повинно бути.
