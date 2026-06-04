# packages.mjs

## Огляд

Модуль `packages.mjs` реалізує перевірку відповідності Vue-пакетів monorepo правилам `vue.mdc`. Він обходить усі workspace-пакети, знаходить серед них ті, що мають `vue` у `dependencies`, і виконує над кожним набір контрольних кроків:

- наявність та коректність `src/vite-env.d.ts` із triple-slash-посиланням на `vite/client`;
- наявність `jsconfig.json` у корені пакета;
- наявність та коректне конфігурування `vite.config.{js,ts,mjs}` (зокрема `VueMacros`, `AutoImport` і Bun-сумісність);
- наявність `'vue'` у списку `imports` плагіна `unplugin-auto-import` (`AutoImport`);
- відсутність заборонених явних value-імпортів з `'vue'` у джерелах пакета (скан через oxc-parser у сусідньому модулі);
- відсутність імпортів Node-нативних модулів (`node:*` або bare-ім’я кшталту `fs`, `path`) у `.vue` SFC;
- відсутність згадок `esbuild` у джерелах пакета (заохочується перехід на `rolldown`);
- наявність рекомендації розширення `Vue.volar` у `.vscode/extensions.json` на рівні всього репозиторію.

Перевірка залежностей `package.json` (`vite >= 8`, `@vitejs/plugin-vue`, `vue-macros`, `unplugin-auto-import`, `vite-plugin-vue-layouts-next`, заборона `esbuild`) виноситься у policy `vue.package_json` і викликається через CLI `npx @nitra/cursor fix`; цей модуль лише друкує підказку про це.

Результати збираються через `createCheckReporter()` і повертаються у вигляді exit-коду: `0` — все OK, `1` — є проблеми. Основна публічна точка входу — функція `check(cwd)`.

## Експорти / API

Модуль є ES-модулем (`*.mjs`) і має такі іменовані експорти:

- `isVueComponentLibraryPkg(pkg)` — predicate, що визначає, чи є пакет бібліотекою компонентів Vue (за наявністю `vue` у `peerDependencies`).
- `check(cwd?)` — головна функція перевірки усього репозиторію; повертає `Promise<number>` із exit-кодом.

Решта функцій модуля — приватні (file-local) helpers, які використовуються лише всередині `packages.mjs`.

## Функції

### `isEsbuildScanFile(relPosix)`

- **Сигнатура:** `function isEsbuildScanFile(relPosix: string): boolean`
- **Параметри:**
  - `relPosix` — відносний шлях у POSIX-форматі (з прямими слешами), відраховуваний від кореня пакета.
- **Повертає:** `boolean` — `true`, якщо файл варто перевіряти на текстові згадки `esbuild`, інакше `false`.
- **Логіка:** виключає типові службові каталоги (`node_modules/`, `dist/`, `build/`, `coverage/`, `.git/`), типові lock-файли (`bun.lock`, `bun.lockb`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), і допускає лише розширення з білого списку: `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.vue`, `.json`, `.jsonc`, `.yaml`, `.yml`, `.md`, `.mdc`.
- **Side effects:** немає.

### `appendEsbuildLineMatches(rel, content, matches, maxMatches)`

- **Сигнатура:** `function appendEsbuildLineMatches(rel: string, content: string, matches: { rel: string; line: number; snippet: string }[], maxMatches: number): void`
- **Параметри:**
  - `rel` — відносний шлях до файлу (для повідомлень).
  - `content` — повний вміст файлу як рядок.
  - `matches` — мутабельний буфер, у який дописуються знайдені збіги.
  - `maxMatches` — верхня межа кількості елементів у `matches`; при досягненні функція припиняє обробку.
- **Повертає:** `void`. Результат повертається через мутацію аргументу `matches`.
- **Логіка:** розбиває `content` на рядки, перевіряє регулярний вираз `\besbuild\b` і додає об’єкт `{ rel, line: i + 1, snippet: line.trim() }` для кожного збігу.
- **Side effects:** мутує переданий масив `matches`.

### `collectEsbuildMatchesInFiles(absPackageRoot, files, maxMatches)`

- **Сигнатура:** `async function collectEsbuildMatchesInFiles(absPackageRoot: string, files: { rel: string }[], maxMatches: number): Promise<{ rel: string; line: number; snippet: string }[]>`
- **Параметри:**
  - `absPackageRoot` — абсолютний шлях до кореня пакета.
  - `files` — перелік відносних шляхів-кандидатів, відфільтрованих через `isEsbuildScanFile`.
  - `maxMatches` — максимальна кількість збігів, які треба зібрати.
- **Повертає:** `Promise` зі списком знайдених збігів `{ rel, line, snippet }`.
- **Логіка:** для кожного файлу читає вміст через `fs/promises.readFile(..., 'utf8')`; якщо у файлі немає згадки `esbuild`, переходить далі. Інакше викликає `appendEsbuildLineMatches`. Зупиняється, щойно `matches.length` досягає `maxMatches`.
- **Side effects:** виконує читання файлів з диска.

### `checkEsbuildMentions(rootDir, absPackageRoot, ignorePaths, prefix, passFn, fail)`

- **Сигнатура:** `async function checkEsbuildMentions(rootDir: string, absPackageRoot: string, ignorePaths: string[], prefix: string, passFn: (msg: string) => void, fail: (msg: string) => void): Promise<void>`
- **Параметри:**
  - `rootDir` — відносний шлях до пакета (для повідомлень).
  - `absPackageRoot` — абсолютний шлях до кореня пакета (для обходу).
  - `ignorePaths` — масив абсолютних шляхів каталогів, які повністю виключені з обходу.
  - `prefix` — текстовий префікс для повідомлень (`[<label>] `).
  - `passFn` — callback на успішне повідомлення (як у check-reporter).
  - `fail` — callback на помилку перевірки.
- **Повертає:** `Promise<void>`.
- **Логіка:** обходить дерево через `walkDir(absPackageRoot, visitor, ignorePaths)`; кожен файл прогоняється через `isEsbuildScanFile`; кандидати збираються у локальний масив. Далі викликає `collectEsbuildMatchesInFiles` з лімітом `maxMatches = 30`. Якщо збігів немає — друкує pass із підказкою «очікується `rolldown`». Якщо є — реєструє `fail` на кожен збіг з підказкою замінити на `rolldown` та (якщо ліміт вичерпано) додає ще один `fail`, що показано лише перші 30.
- **Side effects:** виконує читання файлів з диска; викликає `passFn`/`fail`.

### `packageLabel(rootDir)`

- **Сигнатура:** `function packageLabel(rootDir: string): string`
- **Параметри:**
  - `rootDir` — відносний шлях до пакета (`'.'` для кореня monorepo або, наприклад, `site`).
- **Повертає:** `string` — підпис для логів: `'корінь'` якщо `rootDir === '.'`, інакше сам `rootDir`.
- **Side effects:** немає.

### `ukFilesCountPhrase(n)`

- **Сигнатура:** `function ukFilesCountPhrase(n: number): string`
- **Параметри:**
  - `n` — невід’ємна кількість файлів.
- **Повертає:** фразу українською мовою з відмінком «файл» / «файли» / «файлів» відповідно до правил pluralization:
  - залишок від 100 у діапазоні 11..14 → `«N файлів»`;
  - залишок від 10 рівний 1 → `«N файл»`;
  - залишок від 10 у 2..4 → `«N файли»`;
  - решта → `«N файлів»`.
- **Side effects:** немає.

### `checkViteClientEnvAndEditorConfig(rootDir, prefix, passFn, fail, cwd)`

- **Сигнатура:** `async function checkViteClientEnvAndEditorConfig(rootDir: string, prefix: string, passFn: (msg: string) => void, fail: (msg: string) => void, cwd: string): Promise<void>`
- **Параметри:**
  - `rootDir` — відносний шлях до кореня пакета.
  - `prefix` — префікс повідомлень.
  - `passFn` / `fail` — callbacks check-reporter-а.
  - `cwd` — корінь репозиторію.
- **Повертає:** `Promise<void>`.
- **Логіка:**
  1. Перевіряє, що `<cwd>/<rootDir>/src/vite-env.d.ts` існує; якщо ні — `fail` з підказкою про `/// <reference types="vite/client" />`.
  2. Якщо файл існує, читає його вміст і перевіряє регулярним виразом `VITE_CLIENT_REFERENCE_RE = /\/\/\/\s*<reference\s+types\s*=\s*["']vite\/client["']\s*\/>/`. За відсутності збігу — `fail`.
  3. Якщо обидва кроки успішні — `passFn` про коректний `vite-env.d.ts`.
  4. Перевіряє наявність `<cwd>/<rootDir>/jsconfig.json`; за відсутності — `fail`, інакше `passFn`.
- **Side effects:** читання файлів з диска; виклики `passFn`/`fail`.

### `isVueComponentLibraryPkg(pkg)` *(експорт)*

- **Сигнатура:** `function isVueComponentLibraryPkg(pkg: { peerDependencies?: Record<string, string> }): boolean`
- **Параметри:**
  - `pkg` — розпарсений `package.json` пакета.
- **Повертає:** `boolean` — `true`, якщо `vue` присутній у `peerDependencies`.
- **Семантика:** такі пакети — бібліотеки компонентів Vue. Їхні джерела не проходять через `unplugin-auto-import` споживача (auto-import резолвиться лише в коді додатка, не в `node_modules`), тому правило «без явних value-імпортів з `'vue'`» до них не застосовується.
- **Side effects:** немає.

### `extractAutoImportCallArgs(content)`

- **Сигнатура:** `function extractAutoImportCallArgs(content: string): string | null`
- **Параметри:**
  - `content` — повний текст `vite.config.*`.
- **Повертає:** текст усередині найближчого виклику `AutoImport(...)` без зовнішніх дужок, або `null`, якщо виклик не знайдено або дужки не збалансовані.
- **Логіка:** шукає marker `AutoImport(`, після нього просувається посимвольно з лічильником глибини дужок (`(` → `+1`, `)` → `-1`) і повертає підрядок від першого символу після `(` до символу, на якому `depth` стає `0`.
- **Side effects:** немає.

### `viteConfigHasVueInAutoImports(content)`

- **Сигнатура:** `function viteConfigHasVueInAutoImports(content: string): boolean`
- **Параметри:**
  - `content` — повний текст `vite.config.*`.
- **Повертає:** `boolean` — `true`, якщо у `AutoImport(...)` як рядковий елемент `imports` фігурує `'vue'` або `"vue"`.
- **Логіка:** делегує до `extractAutoImportCallArgs`; якщо `null` — `false`; інакше повертає `args.includes("'vue'") || args.includes('"vue"')`. Зауважте: перевірка є текстовим contains, без парсингу JS — точкою обʼєктивізації пошуку є вже відокремлений виклик `AutoImport(...)`.
- **Side effects:** немає.

### `checkViteConfig(rootDir, isComponentLibrary, prefix, passFn, fail, cwd)`

- **Сигнатура:** `async function checkViteConfig(rootDir: string, isComponentLibrary: boolean, prefix: string, passFn: (msg: string) => void, fail: (msg: string) => void, cwd: string): Promise<{ hasVueAutoImport: boolean }>`
- **Параметри:**
  - `rootDir` — відносний шлях до пакета.
  - `isComponentLibrary` — чи це бібліотека компонентів Vue.
  - `prefix`, `passFn`, `fail` — як вище.
  - `cwd` — корінь репозиторію.
- **Повертає:** `Promise<{ hasVueAutoImport: boolean }>` — ознака, чи AutoImport сконфігуровано на `'vue'`. Її використовує `checkVueImportViolations`.
- **Логіка:**
  1. Шукає перший наявний з `vite.config.js`, `vite.config.ts`, `vite.config.mjs`; якщо жоден не існує — `fail` і повертає `{ hasVueAutoImport: false }`.
  2. Читає вміст vite.config.
  3. Якщо вміст містить `esbuild` (за регуляркою `ESBUILD_RE`) — `fail` з підказкою замінити на `rolldown`.
  4. Викликає `viteConfigHasVueInAutoImports(content)` → `hasVueAutoImport`.
  5. Якщо це бібліотека компонентів — `passFn`, що `VueMacros`/`AutoImport` не вимагаються.
  6. Інакше — пробігає список перевірок `[ VueMacros, AutoImport ]` і реєструє `passFn`/`fail` за наявністю токенів у вмісті. Якщо у файлі є виклик `AutoImport(`, додатково перевіряє `hasVueAutoImport`: `pass` — якщо `'vue'` у `imports`, інакше `fail` з підказкою додати `'vue'` (бо інакше прибирати явні value-імпорти `from 'vue'` небезпечно).
  7. Незалежно від типу пакета, якщо у vite.config фігурує `process.env.npm_lifecycle_event` — `fail` з підказкою перейти на `mode` з `defineConfig(({ mode }) => ...)` (Bun не підставляє `npm_lifecycle_event` так, як npm).
- **Side effects:** читання `vite.config.*` з диска; виклики `passFn`/`fail`.

### `checkVueNodeImportViolations(rootDir, absPackageRoot, ignorePaths, prefix, passFn, fail)`

- **Сигнатура:** `async function checkVueNodeImportViolations(rootDir: string, absPackageRoot: string, ignorePaths: string[], prefix: string, passFn: (msg: string) => void, fail: (msg: string) => void): Promise<void>`
- **Параметри:** як в інших чек-функцій; `absPackageRoot` — абсолютний шлях до пакета.
- **Повертає:** `Promise<void>`.
- **Логіка:**
  1. Обходить `absPackageRoot` через `walkDir(absPackageRoot, visitor, ignorePaths)`, збирає абсолютні шляхи всіх `.vue`-файлів, що не пропускаються через `shouldSkipFileForVueImportScan(rel)`.
  2. Для кожного `.vue` читає вміст і викликає `findForbiddenNodeImportsInVueFile(content, rel)`; на кожне порушення — `fail` з підказкою винести логіку у server-side утіліту (SFC виконується у браузері, Node API недоступне).
  3. Якщо порушень немає — `passFn` з фразою «`немає імпортів Node-нативних модулів у .vue (проскановано N файлів)`», де `N` форматується через `ukFilesCountPhrase`.
- **Side effects:** обхід та читання файлів з диска; виклики `passFn`/`fail`.

### `checkVueImportViolations(rootDir, absPackageRoot, ignorePaths, isComponentLibrary, hasVueAutoImport, prefix, passFn, fail)`

- **Сигнатура:** `async function checkVueImportViolations(rootDir: string, absPackageRoot: string, ignorePaths: string[], isComponentLibrary: boolean, hasVueAutoImport: boolean, prefix: string, passFn: (msg: string) => void, fail: (msg: string) => void): Promise<void>`
- **Параметри:**
  - `rootDir` — відносний шлях до пакета.
  - `absPackageRoot` — абсолютний шлях до кореня пакета.
  - `ignorePaths` — каталоги, повністю виключені з обходу.
  - `isComponentLibrary` — чи це бібліотека компонентів (`vue` у `peerDependencies`).
  - `hasVueAutoImport` — чи AutoImport сконфігуровано на `'vue'` (з `checkViteConfig`).
  - `prefix`, `passFn`, `fail` — як вище.
- **Повертає:** `Promise<void>`.
- **Логіка:**
  1. Якщо `isComponentLibrary === true` — `passFn` із поясненням, що для бібліотек компонентів явні value-імпорти з `'vue'` дозволені, і повертається. Джерела бібліотеки не проходять через `unplugin-auto-import` споживача.
  2. Інакше якщо `hasVueAutoImport === false` — `passFn` з підказкою спершу додати `'vue'` до `AutoImport.imports` (fail про це вже зареєстровано в `checkViteConfig`), і повертається.
  3. Інакше обходить пакет через `walkDir`, збирає абсолютні шляхи всіх source-файлів, для яких `isVueImportScanSourceFile(rel) === true` і `shouldSkipFileForVueImportScan(rel) === false`.
  4. Для кожного такого файлу читає вміст і викликає `findForbiddenVueImportsInSourceFile(content, rel)`; на кожне порушення — `fail` з підказкою прибрати явний value-імпорт з `'vue'`.
  5. Якщо порушень не знайдено — `passFn` з фразою «немає заборонених value-імпортів з `'vue'` у джерелах (проскановано N файлів)».
- **Side effects:** обхід та читання файлів з диска; виклики `passFn`/`fail`.

### `checkVuePackage(rootDir, isComponentLibrary, ignorePaths, fail, passFn, cwd)`

- **Сигнатура:** `async function checkVuePackage(rootDir: string, isComponentLibrary: boolean, ignorePaths: string[], fail: (msg: string) => void, passFn: (msg: string) => void, cwd: string): Promise<void>`
- **Параметри:**
  - `rootDir` — відносний шлях до пакета.
  - `isComponentLibrary` — чи це бібліотека компонентів Vue.
  - `ignorePaths` — каталоги, повністю виключені з обходу.
  - `fail`, `passFn` — callbacks check-reporter-а (порядок `fail` перед `passFn` тут зворотний до інших функцій).
  - `cwd` — корінь репозиторію.
- **Повертає:** `Promise<void>` — завершується після усього набору перевірок пакета.
- **Логіка послідовно виконує:**
  1. Формує `prefix = "[" + packageLabel(rootDir) + "] "`.
  2. Реєструє інформаційний `passFn`: «`package.json` залежності перевіряє `npx @nitra/cursor fix → vue.package_json`».
  3. `checkViteClientEnvAndEditorConfig(rootDir, prefix, passFn, fail, cwd)`.
  4. `checkViteConfig(rootDir, isComponentLibrary, prefix, passFn, fail, cwd)` → отримує `hasVueAutoImport`.
  5. `checkVueImportViolations(rootDir, join(cwd, rootDir), ignorePaths, isComponentLibrary, hasVueAutoImport, prefix, passFn, fail)`.
  6. `checkVueNodeImportViolations(rootDir, join(cwd, rootDir), ignorePaths, prefix, passFn, fail)`.
  7. `checkEsbuildMentions(rootDir, join(cwd, rootDir), ignorePaths, prefix, passFn, fail)`.
- **Side effects:** виконує всі вкладені перевірки (читання файлів, виклики `passFn`/`fail`).

### `collectVueRoots(roots, cwd)`

- **Сигнатура:** `async function collectVueRoots(roots: string[], cwd: string): Promise<Array<{ rootDir: string, isComponentLibrary: boolean }>>`
- **Параметри:**
  - `roots` — усі корені пакетів monorepo (відносні шляхи), отримані від `getMonorepoPackageRootDirs`.
  - `cwd` — корінь репозиторію.
- **Повертає:** масив описів пакетів, у яких `vue` зазначений у `dependencies`, з ознакою `isComponentLibrary`.
- **Логіка:**
  1. Для кожного `r` будує абсолютний шлях `<cwd>/<r>/package.json` і пропускає його, якщо файл відсутній.
  2. Парсить JSON-вміст `package.json`.
  3. Якщо `pkg.dependencies?.vue` істина — додає до результату об’єкт `{ rootDir: r, isComponentLibrary: isVueComponentLibraryPkg(pkg) }`.
  4. Пакети, у яких `vue` лише в `peerDependencies` (без `dependencies`), не додаються — це самостійні бібліотеки компонентів, до них app-перевірки не застосовуються.
- **Side effects:** читання `package.json` файлів з диска.

### `checkVueVolarRecommendation(pass, fail, cwd)`

- **Сигнатура:** `async function checkVueVolarRecommendation(pass: (msg: string) => void, fail: (msg: string) => void, cwd: string): Promise<void>`
- **Параметри:**
  - `pass`, `fail` — callbacks check-reporter-а.
  - `cwd` — корінь репозиторію.
- **Повертає:** `Promise<void>`.
- **Логіка:**
  1. Перевіряє наявність `<cwd>/.vscode/extensions.json`; за відсутності — `fail` з поясненням, що для Vue-проєкту потрібна рекомендація `Vue.volar`.
  2. Парсить JSON; якщо `recommendations` містить `'Vue.volar'` — `pass`, інакше — `fail` з підказкою додати рекомендацію.
- **Side effects:** читання `extensions.json` з диска; виклики `pass`/`fail`.

### `check(cwd)` *(експорт, точка входу)*

- **Сигнатура:** `async function check(cwd: string = process.cwd()): Promise<number>`
- **Параметри:**
  - `cwd` — корінь репозиторію; за замовчуванням `process.cwd()`.
- **Повертає:** `Promise<number>` — `0`, якщо всі перевірки успішні; `1`, якщо є зареєстровані `fail`.
- **Логіка:**
  1. Створює `reporter = createCheckReporter()` і деструктурує `{ pass, fail }`.
  2. Отримує корені всіх workspace-пакетів через `getMonorepoPackageRootDirs(cwd)`.
  3. Викликає `collectVueRoots(roots, cwd)` → список Vue-пакетів.
  4. Якщо список порожній — друкує два `pass`-повідомлення (про пропуск Volar і про відсутність `vue` у будь-яких `dependencies`) і одразу повертає `reporter.getExitCode()`.
  5. Інакше викликає `checkVueVolarRecommendation(pass, fail, cwd)`.
  6. Завантажує абсолютні `ignorePaths` через `loadCursorIgnorePaths(cwd)` (читає `.cursorignore`-подібну конфігурацію).
  7. Для кожного `{ rootDir, isComponentLibrary }` із `vueRoots` викликає `checkVuePackage(rootDir, isComponentLibrary, ignorePaths, fail, pass, cwd)`.
  8. Повертає `reporter.getExitCode()`.
- **Side effects:** усе разом — повний обхід monorepo, читання багатьох файлів з диска, накопичення pass/fail у check-reporter-і.

## Залежності

### Імпорти зі стандартної бібліотеки Node.js

- `node:fs` — `existsSync` (синхронна перевірка існування файлу).
- `node:fs/promises` — `readFile` (асинхронне читання файлу як `utf8`).
- `node:path` — `join`, `relative` (компонування і обчислення відносних шляхів).

### Внутрішні модулі проєкту

- `../../../scripts/lib/check-reporter.mjs` — `createCheckReporter()`: створює reporter з API `{ pass, fail, getExitCode }`, який накопичує повідомлення перевірки та підраховує підсумковий exit-код.
- `../lib/vue-forbidden-imports.mjs` — функції сканування заборонених імпортів:
  - `findForbiddenNodeImportsInVueFile(content, rel)` — повертає список порушень із Node-імпортами у `.vue` SFC.
  - `findForbiddenVueImportsInSourceFile(content, rel)` — повертає список явних value-імпортів з `'vue'` у звичайних source-файлах.
  - `isVueImportScanSourceFile(rel)` — чи варто файл взагалі сканувати на value-імпорти з `'vue'` (за розширенням/типом).
  - `shouldSkipFileForVueImportScan(rel)` — predicate-фільтр (`node_modules/`, `dist/`, lock-файли тощо).
- `../../../scripts/lib/load-cursor-config.mjs` — `loadCursorIgnorePaths(cwd)`: повертає масив абсолютних шляхів каталогів, які повністю виключаються з обходу.
- `../../../scripts/utils/walkDir.mjs` — `walkDir(absRoot, visitor, ignorePaths)`: рекурсивний обхід дерева; visitor викликається з абсолютним шляхом кожного файлу.
- `../../../scripts/lib/workspaces.mjs` — `getMonorepoPackageRootDirs(cwd)`: повертає відносні шляхи всіх workspace-пакетів monorepo (включно з коренем `'.'`, якщо він є пакетом).

### Зовнішні (вказані у документації, не у коді цього модуля)

- `oxc-parser` — використовується транзитивно через `../lib/vue-forbidden-imports.mjs` для парсингу і аналізу `module.staticImports`. У самому `packages.mjs` прямого виклику парсера немає.
- Vue/Vite-стек, для якого писано перевірки: `vite >= 8`, `@vitejs/plugin-vue`, `vue-macros`, `unplugin-auto-import`, `vite-plugin-vue-layouts-next`. Заборонено: `esbuild` (треба використовувати `rolldown`).

### Константи

- `ESBUILD_RE = /\besbuild\b/` — регулярний вираз для пошуку слова `esbuild` як цілого ідентифікатора.
- `VITE_CLIENT_REFERENCE_RE = /\/\/\/\s*<reference\s+types\s*=\s*["']vite\/client["']\s*\/>/` — triple-slash-директива для `vite/client` у `src/vite-env.d.ts`.

## Потік виконання / Використання

### Виклик

Модуль експортує `check(cwd)`. Зовнішній runner (CLI `@nitra/cursor` або pipeline-перевірка) викликає його приблизно так:

```js
import { check } from './npm/rules/vue/js/packages.mjs'

const code = await check(process.cwd())
process.exit(code)
```

### Послідовність кроків `check()`

1. Інстанціювання check-reporter-а.
2. Отримання списку workspace-пакетів через `getMonorepoPackageRootDirs(cwd)`.
3. Фільтрація пакетів через `collectVueRoots(roots, cwd)`: залишаються лише ті, що мають `vue` у `dependencies`. Кожному обчислюється `isComponentLibrary` через `isVueComponentLibraryPkg(pkg)` (за наявністю `vue` у `peerDependencies`).
4. Якщо Vue-пакетів немає — друкує два інформаційних `pass`-повідомлення і повертає exit-код reporter-а (`0`).
5. Перевіряє `.vscode/extensions.json` на рекомендацію `Vue.volar` (`checkVueVolarRecommendation`).
6. Завантажує `ignorePaths` через `loadCursorIgnorePaths(cwd)`.
7. Для кожного Vue-пакета послідовно виконує `checkVuePackage`:
   1. Інформаційний `pass` про `package.json`-перевірку через `npx @nitra/cursor fix → vue.package_json`.
   2. `checkViteClientEnvAndEditorConfig` — `src/vite-env.d.ts` + `jsconfig.json`.
   3. `checkViteConfig` — наявність `vite.config.*`, `VueMacros`, `AutoImport`, `'vue'` у `AutoImport.imports`, заборона `process.env.npm_lifecycle_event`, заборона `esbuild` у vite.config.
   4. `checkVueImportViolations` — скан source-файлів пакета на заборонені value-імпорти з `'vue'` (тільки якщо це не бібліотека компонентів і AutoImport налаштовано на `'vue'`).
   5. `checkVueNodeImportViolations` — скан `.vue` SFC на заборонені імпорти Node-нативних модулів.
   6. `checkEsbuildMentions` — текстовий скан усіх scan-сумісних файлів пакета на згадки `esbuild` із підказкою переходу на `rolldown`.
8. Повертає `reporter.getExitCode()` — `0` за умови відсутності `fail`, `1` за наявності.

### Особливості/інваріанти

- Перевірки vite.config — текстові (`String.prototype.includes` / regex). Винятком є `extractAutoImportCallArgs`, яка точково виокремлює аргументи виклику `AutoImport(...)` за збалансованими дужками, щоб уникнути false-positive поза цим викликом.
- Перевірка `'vue'` у `AutoImport.imports` свідомо не використовує AST-парсер: вона працює лише після того, як аргументи `AutoImport(...)` уже виокремлено, і обмежується пошуком підрядків `'vue'` або `"vue"`.
- Скан value-імпортів `'vue'` пропускається, якщо `'vue'` ще не доданий до `AutoImport.imports` — інакше пропозиція прибрати імпорти зламала б код (нікому буде надати `ref`/`createApp` тощо). Користувача спершу штовхають полагодити `vite.config`, і лише наступний прогін викриє самі заборонені імпорти.
- Бібліотеки компонентів (`vue` у `peerDependencies`) звільнюються від вимог `VueMacros`/`AutoImport` і правила «без явних value-імпортів з `'vue'`».
- Сканування `.vue` SFC на Node-імпорти виконується завжди, незалежно від типу пакета.
- Скан `esbuild`-згадок має жорсткий ліміт у 30 збігів; при перевищенні додатково реєструється fail-маркер «показано перші 30 збігів».
- Обхід `walkDir` керується `ignorePaths` із `.cursor`-конфігу; усередині кожної чек-функції додатково діють фільтри `isEsbuildScanFile` / `isVueImportScanSourceFile` / `shouldSkipFileForVueImportScan`.

### Корисність окремих експортів

- `isVueComponentLibraryPkg(pkg)` — корисна як reusable predicate в інших правилах/інструментах, які мають відрізняти бібліотеки компонентів Vue від додатків.
- `check(cwd)` — основна публічна точка для запуску перевірки. Повертає exit-код, який інтегрується у будь-який runner перевірок.

## Rebuild Test

За цим документом має бути можливо однозначно відтворити поведінку `packages.mjs`:

- Імпорти, експорти (`isVueComponentLibraryPkg`, `check`) і їхні сигнатури документовані.
- Усі file-local helper-функції перераховані з параметрами, поверненнями, логікою та side effects.
- Описано константи (`ESBUILD_RE`, `VITE_CLIENT_REFERENCE_RE`), залежні модулі і їхні ролі.
- Описано послідовність викликів у `check(cwd)` і `checkVuePackage(...)`.
- Зафіксовано інваріанти: ліміт у 30 esbuild-збігів, виключення для бібліотек компонентів, пропуск value-імпорт-скану до додавання `'vue'` у `AutoImport.imports`, скан Node-імпортів у `.vue` незалежно від типу пакета, заборона `process.env.npm_lifecycle_event` у vite.config (Bun-сумісність), вимога `mode` з `defineConfig(({ mode }) => ...)`.
