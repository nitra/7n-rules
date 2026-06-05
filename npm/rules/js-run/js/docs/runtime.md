# `runtime.mjs` — JS-runtime перевірки правила `js-run.mdc`

## Огляд

Модуль `npm/rules/js-run/js/runtime.mjs` — це **виконавча частина** правила `js-run.mdc`
для монорепо-перевірки командою `npx @nitra/cursor check`. Він обходить усі workspace-пакети
(виключаючи кореневий `.`) і для кожного пакета валідує дотримання набору JS-/інфраструктурних
конвенцій, які складно або неможливо виразити лише через Rego-політики per-document.

Покрите цим модулем:

- **Заборона `@nitra/bunyan` / `bunyan` в імпортах коду** — статичні `import`, CommonJS
  `require`, динамічний `import()`; знаходиться через AST-парсер (`oxc-parser`, делегується
  в `../lib/bunyan-imports.mjs`).
- **`OTEL_RESOURCE_ATTRIBUTES` у `k8s/base/configmap.yaml`** — наявність файлу (структуру
  валідує Rego через `npx @nitra/cursor fix`, namespace `js_run.configmap`).
- **Внутрішні аліаси `#conn/*`** — імпорти `bun#SQL`, `mssql`, `@nitra/graphql-request#GraphQLClient`
  дозволені лише в каталозі `src/conn/` (або в каталозі, заданому `package.json#imports['#conn/*']`).
- **Нейминг і експорти у `#conn/`** — `ql-<id>` / `(pg|mysql|mssql)-(read|write)[-<id>]`;
  `export default` заборонений; іменований експорт має дорівнювати camelCase від basename файла;
  `index.*` пропускається як reexport-барель.
- **`process.env` / `CheckEnv`** — пряме `process.env.X` заборонене; обов'язкові змінні —
  через `env` з `@nitra/check-env` + `checkEnv(['X', …])` у тому ж файлі (або коментар
  `// @nitra/cursor ignore-next-line checkEnv`); опційні — через `env` з `node:process`.
- **Паузи через `setTimeout`** — `new Promise(r => setTimeout(r, ms))` має бути замінений на
  `await setTimeout(ms)` з `node:timers/promises`.
- **`jsconfig.json` у backend-пакеті з `src/`** — наявність файла (структуру `NodeNext` і
  `include: src/**/*` валідує Rego `js_run.jsconfig` через `runConftestBatch`).

Per-document валідація `package.json` (заборона `@nitra/bunyan`/`bunyan` у залежностях,
правила для `node` у `scripts`) делегована окремому rego-пакету `js_run.package_json` у
`npm/rules/js-run/policy/package_json/`; цей JS-файл — про крос-файлові й AST-перевірки.

Frontend-пакети (з `vite` у `devDependencies`) повністю пропускаються — для них
актуальний інший контекст (браузерний бандл без `node:process`); bunyan-залежність
такого пакета все одно перевіряється Rego-частиною.

## Експорти / API

| Експорт       | Тип              | Призначення                                                                                                         |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `check(cwd?)` | `async function` | Єдина публічна точка входу. Запускає перевірку всіх workspace-пакетів. Повертає `0` (все OK) або `1` (є порушення). |

Усі інші функції модуля — внутрішні (без `export`) і використовуються лише з `check`.

## Функції

### `check(cwd = process.cwd())` _(export)_

- **Сигнатура:** `async function check(cwd?: string): Promise<number>`
- **Параметри:**
  - `cwd` _(string, опційний)_ — абсолютний корінь репозиторію; за замовчуванням
    `process.cwd()`.
- **Повертає:** `Promise<number>` — exit-код від `createCheckReporter().getExitCode()`
  (0 — успіх, 1 — є хоча б одне `fail(...)`).
- **Side effects:**
  - читає `package.json` коренева/workspace-пакетів через `getMonorepoPackageRootDirs`;
  - читає `.cursorignore` / конфіг через `loadCursorIgnorePaths`;
  - читає файли пакетів (`fs/promises`), синхронні `existsSync` / `statSync`;
  - друкує повідомлення `pass(...)` / `fail(...)` через репортер;
  - запускає `conftest` через `runConftestBatch` (зовнішній процес) для перевірки `jsconfig.json`.
- **Алгоритм:**
  1. Створює репортер `createCheckReporter()`.
  2. Бере список усіх коренів пакетів і відфільтровує кореневий `.`.
  3. Якщо workspace-пакетів немає — викликає `pass(...)` з відповідним повідомленням
     і повертає exit-код.
  4. Завантажує перелік `ignorePaths` (повністю виключені з обходу).
  5. По черзі викликає `checkWorkspacePackage(r, ignorePaths, fail, pass, cwd)` для кожного `r`.
  6. Повертає `reporter.getExitCode()`.

### `checkWorkspacePackage(rootDir, ignorePaths, fail, passFn, cwd)`

- **Сигнатура:**
  `async function checkWorkspacePackage(rootDir: string, ignorePaths: string[], fail: (msg: string) => void, passFn: (msg: string) => void, cwd: string): Promise<void>`
- **Параметри:**
  - `rootDir` — відносний шлях workspace-пакета (не `'.'`).
  - `ignorePaths` — абсолютні шляхи каталогів, виключені з обходу.
  - `fail` — callback реєстрації порушення.
  - `passFn` — callback повідомлення про успішну під-перевірку.
  - `cwd` — корінь репозиторію.
- **Повертає:** `Promise<void>`.
- **Side effects:** читає `package.json` пакета; запускає всі під-перевірки нижче;
  для frontend-пакета (vite у `devDependencies`) повертається одразу після `passFn`.
- **Алгоритм:**
  1. Формує `label = '[<rootDir>] '` і `absPackageRoot`.
  2. Завантажує `pkgJson = loadPackageJson(rootDir, cwd)`.
  3. Якщо `packageJsonHasViteDevDependency(pkgJson)` — `passFn(...)` і вихід.
  4. `checkBackendJsconfigWhenSrcPresent(...)` — gate на `jsconfig.json`.
  5. `checkBunyanImports(...)` → якщо `0` порушень, друкує позитивне повідомлення.
  6. `collectSourceFiles(...)` — спільний список JS/TS-файлів для подальших сканів.
  7. `checkConnImports(...)` → позитивне повідомлення з резолвленим `connDir`.
  8. `checkConnFileNamingAndExports(...)` → позитивне повідомлення про канон у `connDir/`.
  9. `checkProcessEnvUsage(...)` → позитивне повідомлення про `process.env`/`checkEnv`.
  10. `checkPromiseSetTimeoutPause(...)` → позитивне повідомлення про `setTimeout`-паузи.
  11. `checkOtelConfigmap(...)` — лише наявність `k8s/base/configmap.yaml`.

### `backendPackageHasSrcDir(absPackageRoot)`

- **Сигнатура:** `function backendPackageHasSrcDir(absPackageRoot: string): boolean`
- **Параметри:** `absPackageRoot` — абсолютний корінь пакета.
- **Повертає:** `true`, якщо `<absPackageRoot>/src` існує і це каталог.
- **Side effects:** синхронний `statSync`; помилки ловить і повертає `false`.

### `checkBackendJsconfigWhenSrcPresent(rootDir, absPackageRoot, label, fail, passFn, cwd)`

- **Сигнатура:**
  `function checkBackendJsconfigWhenSrcPresent(rootDir: string, absPackageRoot: string, label: string, fail: (msg: string) => void, passFn: (msg: string) => void, cwd: string): void`
- **Параметри:** як у `checkWorkspacePackage`.
- **Повертає:** `void`.
- **Side effects:** `existsSync` для `jsconfig.json`; виклик `runConftestBatch` (зовнішній
  процес `conftest`); виклик `fail`/`passFn`.
- **Алгоритм:**
  1. Якщо `src/` відсутній — повернутися (gate перевірки).
  2. Якщо `jsconfig.json` відсутній — `fail(...)` із повідомленням про канонічний файл і вихід.
  3. Викликає `runConftestBatch({ policyDirRel: 'js-run/jsconfig', namespace: 'js_run.jsconfig', files: [jcPath] })`.
  4. Якщо порушень немає — `passFn(...)`; інакше — `fail(...)` для кожного.

### `relPosix(absPackageRoot, absPath)`

- **Сигнатура:** `function relPosix(absPackageRoot: string, absPath: string): string`
- **Параметри:** корінь пакета й абсолютний шлях до файлу.
- **Повертає:** відносний шлях у posix-форматі (`/`), отриманий заміною `\\` → `/` у результаті
  `node:path#relative`.
- **Side effects:** немає (чиста функція).

### `checkBunyanImports(absPackageRoot, ignorePaths, label, fail)`

- **Сигнатура:**
  `async function checkBunyanImports(absPackageRoot: string, ignorePaths: string[], label: string, fail: (msg: string) => void): Promise<number>`
- **Повертає:** кількість знайдених порушень.
- **Side effects:** `walkDir` (читання каталогу), `readFile` для кожного source-файла, виклик `fail`.
- **Алгоритм:**
  1. Збирає `sourcePaths` обходом `walkDir`, фільтр: `!shouldSkipFileForBunyanScan(rel) && isBunyanScanSourceFile(rel)`.
  2. Для кожного — читає вміст і викликає `findBunyanImportsInText(content, rel)`.
  3. Для кожного `v` друкує повідомлення з номером рядка, ім'ям модуля й snippet'ом і
     інкрементує лічильник.

### `collectSourceFiles(absPackageRoot, ignorePaths)`

- **Сигнатура:**
  `async function collectSourceFiles(absPackageRoot: string, ignorePaths: string[]): Promise<string[]>`
- **Повертає:** масив абсолютних шляхів до файлів-кандидатів на скан (фільтр
  `isCheckEnvScanSourceFile`).
- **Side effects:** `walkDir`. Зверніть увагу: фільтр базується саме на правилах
  `check-env-scan`, але отриманий список потім перевикористовується для інших сканів
  (`conn-imports`, `conn-file-rules`, `process-env`, `promise-settimeout`), кожен з яких
  має свій додатковий внутрішній фільтр (`isConnImportsScanSourceFile` тощо).

### `checkConnImports(absPackageRoot, sourcePaths, pkgJson, label, fail)`

- **Сигнатура:**
  `async function checkConnImports(absPackageRoot: string, sourcePaths: string[], pkgJson: unknown, label: string, fail: (msg: string) => void): Promise<number>`
- **Повертає:** кількість порушень.
- **Side effects:** `readFile`, `fail`.
- **Алгоритм:**
  1. `connDir = resolveConnDirFromPackageJson(pkgJson)`.
  2. Для кожного файла зі `sourcePaths`:
     - пропускає, якщо не source-file для conn-imports-scan;
     - пропускає, якщо файл вже всередині `connDir/`;
     - читає вміст, викликає `findConnFactoryImportsInText(content, rel)` і друкує
       повідомлення `fail(...)` із форматуванням `{ <specifier> } from '<module>'` або
       `'<module>'` (коли `specifier === '*'`).

### `checkConnFileNamingAndExports(absPackageRoot, sourcePaths, pkgJson, label, fail)`

- **Сигнатура:**
  `async function checkConnFileNamingAndExports(absPackageRoot: string, sourcePaths: string[], pkgJson: unknown, label: string, fail: (msg: string) => void): Promise<number>`
- **Повертає:** кількість порушень.
- **Side effects:** `readFile`, `fail`.
- **Алгоритм:** для кожного файла, який `isConnFileToCheck(rel, connDir)`, читає вміст і
  для кожного `v` з `findConnFileRuleViolations(content, rel)` друкує повідомлення з
  `formatConnFileViolation(v, label, rel, connDir)`.

### `isConnFileToCheck(rel, connDir)`

- **Сигнатура:** `function isConnFileToCheck(rel: string, connDir: string): boolean`
- **Повертає:** `true`, коли файл:
  - лежить всередині `connDir/` (`isInsideConnDir`);
  - має розширення JS/TS, що відповідає `isConnFileRulesSourceFile`;
  - basename **не** починається з `index.` (бо це reexport-барель).

### `formatConnFileViolation(v, label, rel, connDir)`

- **Сигнатура:**
  `function formatConnFileViolation(v: { kind: 'name'|'default-export'|'export-name', expectedName?: string, foundNames?: string[] }, label: string, rel: string, connDir: string): string`
- **Повертає:** готовий текст повідомлення для `fail(...)`.
- **Поведінка за `kind`:**
  - `'name'` — повідомлення про канон імен (`ql-<id>`, `pg-/mysql-/mssql-{read|write}[-<id>]`,
    kebab-case `[a-z0-9-]`).
  - `'default-export'` — заборонений `export default` у `connDir/`.
  - інше (`'export-name'`) — очікувано `export const <expectedName>`; знайдені імена
    показуються через кому, якщо `foundNames` непорожній, інакше тире.

### `checkProcessEnvUsage(absPackageRoot, sourcePaths, label, fail)`

- **Сигнатура:**
  `async function checkProcessEnvUsage(absPackageRoot: string, sourcePaths: string[], label: string, fail: (msg: string) => void): Promise<number>`
- **Повертає:** кількість порушень.
- **Side effects:** `readFile`, `fail`.
- **Алгоритм:** для кожного файла читає вміст і викликає `findUncheckedProcessEnvInText`.
  Залежно від `v.kind` формує різне повідомлення:
  - `'process-env'` — пряме `process.env.X`: підказує замінити на `env` з
    `@nitra/check-env` + `checkEnv(['X'])` або з `node:process` (опційно).
  - інакше — `env.X` з `@nitra/check-env`, не закритий `checkEnv(['X'])` (або
    `// @nitra/cursor ignore-next-line checkEnv`).

### `checkPromiseSetTimeoutPause(absPackageRoot, sourcePaths, label, fail)`

- **Сигнатура:**
  `async function checkPromiseSetTimeoutPause(absPackageRoot: string, sourcePaths: string[], label: string, fail: (msg: string) => void): Promise<number>`
- **Повертає:** кількість порушень.
- **Side effects:** `readFile`, `fail`.
- **Алгоритм:** фільтрує файли через `isPromiseSetTimeoutScanSourceFile`, для решти
  читає вміст і викликає `findPromiseSetTimeoutInText` — порушення друкуються з
  підказкою «`await setTimeout(ms)` з `node:timers/promises`».

### `packageJsonHasViteDevDependency(pkgJson)`

- **Сигнатура:** `function packageJsonHasViteDevDependency(pkgJson: unknown): boolean`
- **Повертає:** `true`, якщо `pkgJson.devDependencies` — об'єкт і має ключ `'vite'`.
- **Side effects:** немає.
- **Семантика:** ідентично `packageJsonLacksViteDevDependency` з `auto-rules.mjs`, але
  приймає вже розпарсений об'єкт (без I/O).

### `loadPackageJson(rootDir, cwd)`

- **Сигнатура:** `async function loadPackageJson(rootDir: string, cwd: string): Promise<unknown>`
- **Повертає:** розпарсений `package.json` пакета або `null`, якщо файла немає.
- **Side effects:** `existsSync`, `readFile`, `JSON.parse`.
- **Примітка:** заборону `@nitra/bunyan` / `bunyan` у `dependencies` / `devDependencies`
  перенесено в Rego-пакет `npm/policy/js_run/package_json/`; тут залишилась лише AST-перевірка
  імпортів.

### `checkOtelConfigmap(rootDir, passFn, cwd)`

- **Сигнатура:**
  `function checkOtelConfigmap(rootDir: string, passFn: (msg: string) => void, cwd: string): void`
- **Повертає:** `void`.
- **Side effects:** `existsSync`, `passFn`.
- **Алгоритм:** якщо `<rootDir>/k8s/base/configmap.yaml` існує — друкує повідомлення про
  факт наявності й нагадує, що структуру (OTEL-атрибути) перевіряє Rego через
  `npx @nitra/cursor fix` → `js_run.configmap`.

## Залежності

### Node.js стандартна бібліотека

- `node:fs` — `existsSync`, `statSync` (синхронні перевірки наявності каталогу / файла).
- `node:fs/promises` — `readFile` (читання текстових файлів).
- `node:path` — `join`, `relative` (формування шляхів; `relPosix` додатково нормалізує).

### Локальні модулі (`../lib/`)

- `../lib/bunyan-imports.mjs` — `findBunyanImportsInText`, `isBunyanScanSourceFile`,
  `shouldSkipFileForBunyanScan`.
- `../lib/check-env-scan.mjs` — `findUncheckedProcessEnvInText`, `isCheckEnvScanSourceFile`.
- `../lib/conn-file-rules.mjs` — `findConnFileRuleViolations`, `isConnFileRulesSourceFile`.
- `../lib/conn-imports-scan.mjs` — `findConnFactoryImportsInText`, `isConnImportsScanSourceFile`,
  `isInsideConnDir`, `resolveConnDirFromPackageJson`.
- `../lib/promise-settimeout-scan.mjs` — `findPromiseSetTimeoutInText`,
  `isPromiseSetTimeoutScanSourceFile`.

### Скрипти каркасу (`../../../scripts/`)

- `scripts/lib/check-reporter.mjs` — `createCheckReporter` (репортер `pass`/`fail` +
  `getExitCode`).
- `scripts/lib/run-conftest-batch.mjs` — `runConftestBatch` (запуск `conftest` на наборі
  файлів, повертає `violations[]`).
- `scripts/lib/load-cursor-config.mjs` — `loadCursorIgnorePaths` (читання списку шляхів
  для виключення з обходу).
- `scripts/utils/walkDir.mjs` — `walkDir` (рекурсивний обхід каталогу з callback'ом і
  списком ігнорувань).
- `scripts/lib/workspaces.mjs` — `getMonorepoPackageRootDirs` (перелік коренів
  workspace-пакетів монорепо).

### Зовнішні залежності (через посередників)

- `conftest` — викликається з `runConftestBatch`; виконує Rego-політики, наприклад
  `js_run.jsconfig` із `npm/rules/js-run/policy/jsconfig/`.
- `oxc-parser` — використовується в `bunyan-imports.mjs` для AST-сканування імпортів
  (через залежність, не імпортується прямо тут).

## Потік виконання / Використання

### Точка входу

Модуль експортує лише `check(cwd?)`, яку викликає диспетчер правил (`@nitra/cursor check`)
для правила `js-run`. Очікуваний контракт — повернути exit-код для агрегації по всіх правилах.

### Високорівневий потік

```
check(cwd)
  └─ createCheckReporter()
  └─ getMonorepoPackageRootDirs(cwd) → roots
  └─ workspaceRoots = roots.filter(r => r !== '.')
  └─ [if empty] pass('немає workspace-пакетів') → return exitCode
  └─ loadCursorIgnorePaths(cwd) → ignorePaths
  └─ for each r ∈ workspaceRoots:
        checkWorkspacePackage(r, ignorePaths, fail, pass, cwd)
            ├─ loadPackageJson(r, cwd)
            ├─ [if vite-frontend] passFn → return
            ├─ checkBackendJsconfigWhenSrcPresent(...)
            │     ├─ backendPackageHasSrcDir → gate
            │     ├─ [no jsconfig] fail
            │     └─ runConftestBatch (Rego: js_run.jsconfig)
            ├─ checkBunyanImports(...)
            │     ├─ walkDir → sourcePaths (фільтр bunyan-scan)
            │     └─ for each → findBunyanImportsInText
            ├─ collectSourceFiles(...) → sourcePaths (фільтр check-env)
            ├─ checkConnImports(...)
            │     └─ resolveConnDirFromPackageJson + findConnFactoryImportsInText
            ├─ checkConnFileNamingAndExports(...)
            │     ├─ isConnFileToCheck
            │     └─ findConnFileRuleViolations → formatConnFileViolation
            ├─ checkProcessEnvUsage(...)
            │     └─ findUncheckedProcessEnvInText
            ├─ checkPromiseSetTimeoutPause(...)
            │     └─ findPromiseSetTimeoutInText
            └─ checkOtelConfigmap(...)  [лише існування k8s/base/configmap.yaml]
  └─ return reporter.getExitCode()
```

### Логіка пропусків (gate'и)

- **Кореневий `.`** workspace відфільтровується одразу.
- **Frontend (vite у `devDependencies`)** — увесь `js-run` пропускається на рівні
  workspace.
- **`jsconfig.json`** — перевіряється лише там, де є `src/` каталог.
- **Conn-сканування** — імпорти `bun#SQL` / `mssql` / `@nitra/graphql-request#GraphQLClient`
  перевіряються тільки **поза** каталогом `connDir` (а нейминг/експорти — тільки
  всередині нього, окрім `index.*`).
- **Bunyan-сканування** — додатково керується `shouldSkipFileForBunyanScan` для специфічних
  шляхів і `isBunyanScanSourceFile` для розширень.
- **`k8s/base/configmap.yaml`** — лише наявність; OTEL-атрибути перевіряє Rego.

### Як модуль інтегрується із суміжними частинами правила

- **AST-частина**: бере на себе крос-файлову й AST-логіку, яку складно виразити в Rego.
- **Per-document Rego**: `js_run.package_json` (bunyan/scripts.node), `js_run.configmap`
  (OTEL), `js_run.jsconfig` (canonical `compilerOptions`/`include`).
- **JS-оркестрація Rego через `runConftestBatch`**: модуль викликає `conftest` лише там, де
  попередній gate (наявність `src/` + наявність `jsconfig.json`) дозволяє це робити —
  _Plan B_: Rego-authoritative, JS оркеструє per-package gate.

### Приклад використання

```js
import { check } from './runtime.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Поведінкові інваріанти

- Будь-який `fail(...)` → exit-code 1.
- Відсутність помилок у під-перевірці → відповідне інформаційне `pass(...)`.
- Frontend-пакет (vite) ніколи не отримує жодного `fail` від цього модуля.
- Кореневий пакет монорепо ніколи не перевіряється цим модулем.

## Rebuild Test

Документ написано на основі повного читання вихідного файла `runtime.mjs` (446 рядків).
Якщо повністю відновлювати модуль за цим описом, відтворюються:

- Єдиний експорт `check(cwd?)` та його контракт із `createCheckReporter`.
- Список workspace-фільтрації (`r !== '.'`) та early-return при порожньому списку.
- Виклик `loadCursorIgnorePaths` й передача `ignorePaths` в усі скани.
- Послідовність дев'яти кроків у `checkWorkspacePackage` із саме такими повідомленнями
  для `passFn` / `fail`.
- Gate `vite у devDependencies` → пропуск усього `js-run` для frontend-пакета.
- Gate `src/` для `jsconfig.json` та делегування структури до Rego `js_run.jsconfig`
  через `runConftestBatch({ policyDirRel: 'js-run/jsconfig', namespace: 'js_run.jsconfig',
files: [jcPath] })`.
- Дев'ять допоміжних функцій (`backendPackageHasSrcDir`, `relPosix`, `checkBunyanImports`,
  `collectSourceFiles`, `checkConnImports`, `checkConnFileNamingAndExports`,
  `isConnFileToCheck`, `formatConnFileViolation`, `checkProcessEnvUsage`,
  `checkPromiseSetTimeoutPause`, `packageJsonHasViteDevDependency`, `loadPackageJson`,
  `checkOtelConfigmap`, `checkBackendJsconfigWhenSrcPresent`) із зазначеними сигнатурами,
  параметрами й side effects.
- Перелік модулів-залежностей (`../lib/*`, `../../../scripts/lib/*`,
  `../../../scripts/utils/walkDir.mjs`) і стандартних модулів Node.js (`node:fs`,
  `node:fs/promises`, `node:path`).
- Інваріант, що `collectSourceFiles` використовує фільтр `isCheckEnvScanSourceFile`,
  а інші скани мають свої внутрішні фільтри (`isConnImportsScanSourceFile`,
  `isPromiseSetTimeoutScanSourceFile`).
- Формат повідомлень `fail(...)` із префіксом `[<pkg>] ` та номером рядка `${rel}:${v.line}`.
