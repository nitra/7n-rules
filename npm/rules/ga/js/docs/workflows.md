# workflows.mjs

## Огляд

Модуль `workflows.mjs` реалізує JS-частину перевірки правила **ga.mdc** (GitHub Actions) у пакеті `@nitra/cursor`. Він валідує конфігурацію `.github/workflows/` цільового репозиторію: розширення файлів (`.yml`, не `.yaml`), наявність обовʼязкових workflow, відсутність MegaLinter-залишків, коректність triggers `on.*.paths`, наявність composite-action `setup-bun-deps` і локальне встановлення `shellcheck`.

Модуль працює в парі з **Rego-полісі** з `npm/policy/ga/`: пер-документні структурні перевірки (поля YAML, `concurrency`, заборона `oven-sh/setup-bun` / `actions/cache` / `bun install`, мінімальні версії `uses`, наявність `actions/checkout@v6` перед локальним `setup-bun-deps`, shell-продовження `\` у `run`) делеговані Rego і викликаються через `runConftestBatch`. У JS лишилися ті перевірки, які потребують доступу до файлової системи / git-індексу (`git ls-files :(glob)`, `existsSync`, читання `readdir`) і не можуть бути виражені declarative-полісі.

Точка входу — асинхронна функція `check(cwd)`, яка повертає exit code (`0` — успіх, `1` — є проблеми). Її викликає `bun run lint-ga` разом з `actionlint` і `zizmor`.

Plan B-патерн: rego-частина авторитетна для пер-документних правил; JS виконує cross-file і tooling-перевірки. Hard-fail якщо `conftest` відсутній у PATH (узгоджено з `runConftestBatch`).

## Експорти / API

| Експорт                          | Тип       | Призначення                                                                  |
| -------------------------------- | --------- | ---------------------------------------------------------------------------- |
| `check(cwd?)`                    | `async function` | Головна точка входу: валідує `ga.mdc` для репозиторію `cwd`.            |
| `checkShellcheckInstalled(pass, fail)` | `function` | Перевіряє наявність бінарника `shellcheck` у PATH (актуальне для `actionlint`). |

Решта функцій модуля — приватні (module-local) хелпери, які не експортуються.

## Функції

### `gitHasAnyTrackedFileMatchingGlob(globPattern, cwd)`

- **Сигнатура:** `(globPattern: string, cwd: string) => boolean`
- **Параметри:**
  - `globPattern` — glob із workflow (наприклад `files/**`, `image-migration-new/**`).
  - `cwd` — робочий каталог для виклику `git`.
- **Повертає:** `true`, якщо хоча б один tracked-файл у git-індексі матчить glob; `true` для негативних патернів (починаються з `!`); `false` — якщо patternstring порожній або `git` упав.
- **Side effects:** спавн дочірнього процесу `git ls-files -z -- :(glob)<pattern>` через `execFileSync` (синхронно).
- **Особливості:** використовує pathspec `:(glob)`, щоб делегувати glob-матчинг git-у, без ручної реалізації glob-engine і без рекурсивного сканування FS.

### `shouldValidateWorkflowPathsGlob(p)`

- **Сигнатура:** `(p: string) => boolean`
- **Параметри:** `p` — рядковий glob із `on.*.paths`.
- **Повертає:** `true`, якщо glob варто валідувати на існування файлів; `false` для негативних патернів (`!...`) та для патернів зі вставкою `*.` (типу `*.vue`, `*.php` — заготовки для майбутніх файлів).
- **Side effects:** немає (чиста функція).

### `verifyOnePathsGlob(relPath, eventName, raw, passFn, failFn, cwd)`

- **Сигнатура:** `(relPath: string, eventName: string, raw: unknown, passFn: (msg: string) => void, failFn: (msg: string) => void, cwd: string) => void`
- **Параметри:**
  - `relPath` — відносний шлях workflow-файлу для повідомлень.
  - `eventName` — назва події (`push` або `pull_request`).
  - `raw` — сирий елемент із масиву `paths` (може бути будь-яким типом).
  - `passFn`/`failFn` — колбеки звітування.
  - `cwd` — корінь репозиторію для `git`.
- **Повертає:** `void`.
- **Side effects:** виклики `passFn` або `failFn` (запис у reporter).
- **Поведінка:**
  - Порожній/нерядковий glob — ігнорує.
  - Glob, який не треба валідувати (`shouldValidateWorkflowPathsGlob === false`) — звітує `pass` з поясненням «пропущено для перевірки існування».
  - Інакше викликає `gitHasAnyTrackedFileMatchingGlob` і звітує відповідно `pass` (є збіги) або `fail` (немає жодного).

### `verifyWorkflowEventPathsGlobsExist(relPath, root, passFn, failFn, cwd)`

- **Сигнатура:** `(relPath: string, root: Record<string, unknown>, passFn, failFn, cwd: string) => void`
- **Параметри:** `root` — розпарсений YAML workflow.
- **Повертає:** `void`.
- **Side effects:** делеговано `verifyOnePathsGlob`.
- **Логіка:** дістає `on.push.paths` та `on.pull_request.paths` через `getObjKey`, ітерує масивами і викликає `verifyOnePathsGlob` для кожного елемента. Якщо `on` відсутній, не є обʼєктом, або `paths` не є масивом — нічого не робить.

### `getObjKey(obj, key)`

- **Сигнатура:** `(obj: unknown, key: string) => unknown`
- **Повертає:** значення поля `obj[key]`, якщо `obj` — non-array object; інакше `undefined`.
- **Side effects:** немає.
- **Призначення:** безпечний доступ до вкладеного поля YAML, де root може виявитись не-обʼєктом після парсингу.

### `checkApplyWorkflow(wfDir, files, filename, expectedPath, passFn, failFn)`

- **Сигнатура:** `async (wfDir: string, files: string[], filename: string, expectedPath: string, passFn, failFn) => Promise<void>`
- **Параметри:**
  - `wfDir` — абсолютна директорія `.github/workflows`.
  - `files` — список файлів у `wfDir`.
  - `filename` — імʼя apply-workflow (наприклад `apply-k8s.yml`).
  - `expectedPath` — очікуваний шаблон у `on.push.paths` (наприклад `**/k8s/**/*.yaml`).
- **Повертає:** `Promise<void>`.
- **Side effects:** читає файл `wfDir/filename`, звітує через `passFn`/`failFn`.
- **Логіка:** якщо `filename` відсутній у `files` — повертає без перевірки. Інакше парсить YAML через `parseWorkflowYaml`; перевірку наявності `expectedPath` у `on.push.paths` робить точно через `eventPathsIncludeExact`, а якщо YAML не розпарсився — fallback на наївний `content.includes`.

### `checkMegalinter(wfDir, ymlWorkflows, wfDirRel, cwd, passFn, failFn)`

- **Сигнатура:** `async (wfDir, ymlWorkflows: string[], wfDirRel, cwd, passFn, failFn) => Promise<void>`
- **Повертає:** `Promise<void>`.
- **Side effects:** читає всі `*.yml` у `wfDir`, перевіряє `existsSync` для кореневих конфіг-файлів.
- **Що шукає:**
  1. У вмісті кожного `.yml` workflow — патерни `MEGALINTER_USE_PATTERNS` (`oxsecurity/megalinter-action`, `megalinter/megalinter`).
  2. У корені репо — файли з `MEGALINTER_CONFIG_NAMES` (`.mega-linter.yml`, `.megalinter.yaml`, `.mega-linter.yaml`).
- Знайшов — `fail` з вимогою видалити інтеграцію; не знайшов — один `pass`.

### `checkShellcheckInstalled(passFn, failFn)` *(export)*

- **Сигнатура:** `(passFn, failFn) => void`
- **Повертає:** `void`.
- **Side effects:** `resolveCmd('shellcheck')` (`which`/`where`).
- **Призначення:** `actionlint` (через `bunx github-actionlint`) перевіряє shell-код у `run:` блоках лише коли `shellcheck` доступний; інакше тихо пропускає SC-правила. Локальний `bun lint-ga` міг би бути зеленим, тоді як CI на `ubuntu-latest` (де `shellcheck` передвстановлений) падатиме. Тому відсутність бінарника локально — `fail` з порадами встановлення для macOS/Debian/Ubuntu/Arch.
- **Крос-платформність:** через `resolveCmd` коректно знаходить `shellcheck` і `shellcheck.exe` на Windows.

### `checkGaWorkflowFiles(wfDirRel, files, pass, fail)`

- **Сигнатура:** `(wfDirRel: string, files: string[], pass, fail) => void`
- **Повертає:** `void`.
- **Side effects:** виклики `pass`/`fail`.
- **Перевірки:**
  - Файли з розширенням `.yaml` → `fail` (вимога перейменувати на `.yml`); якщо таких немає — один `pass` про відповідність розширень.
  - Файли без розширення `.yml` → `fail`.
  - Кожен з `REQUIRED_WORKFLOWS` (`clean-ga-workflows.yml`, `clean-merged-branch.yml`, `lint-ga.yml`, `git-ai.yml`) має існувати: є — `pass`, немає — `fail`.

### `runAllGaRego(wfDir, ymlWorkflows, cwd, pass, fail)`

- **Сигнатура:** `async (wfDir: string, ymlWorkflows: string[], cwd: string, pass, fail) => Promise<void>`
- **Повертає:** `Promise<void>`.
- **Side effects:** спавн `conftest` через `runConftestBatch`; читання шаблонів через `loadTemplate`.
- **Логіка:**
  1. **Per-workflow Rego (4 окремих спавни):** для кожного запису в `GA_PER_WORKFLOW_REGO_TARGETS` (4 канонічні workflow), якщо файл існує — підтягує `loadTemplate(concernDir)`, бере `templateData[basename(workflow)]` і викликає `runConftestBatch` з відповідним `policyDirRel`/`namespace`/одним файлом. Кожне порушення → `fail` з префіксом шляху; нуль порушень → один `pass` «відповідає `<namespace>` (rego)».
  2. **Workflow-common батч:** один спавн `conftest` з полісі `ga/workflow_common` на ВСІ `*.yml` у `wfDir`. Шаблон `uses-min-versions.snippet` (якщо є) передається у `templateData`. Порушення → `fail` з префіксом filename; нуль — `pass` про кількість файлів, що відповідають `ga.workflow_common`.
- **Чому 4 окремих спавни, а не один:** namespace ↔ конкретний workflow; інакше правила одного workflow застосуються до неправильного файла.

### `check(cwd?)` *(export, точка входу)*

- **Сигнатура:** `async (cwd?: string) => Promise<number>`
- **Параметри:** `cwd` — корінь репозиторію (за замовчуванням `process.cwd()`).
- **Повертає:** exit code: `0` — все OK, `1` — є порушення (отримується з `reporter.getExitCode()`).
- **Side effects:** створення reporter, читання FS, виклики `git`, спавни `conftest`.
- **Послідовність перевірок:**
  1. Створює `reporter` через `createCheckReporter()`.
  2. Перевіряє наявність директорії `.github/workflows` — якщо немає, негайно `fail` і повертає exit code.
  3. Зчитує `files = readdir(wfDir)`; виокремлює `ymlWorkflows` (`*.yml`).
  4. **Rego-крок** (`runAllGaRego`) — першим, як authoritative source для пер-документних правил.
  5. Наявність `composite action` `.github/actions/setup-bun-deps/action.yml` (його розкочує `npx @nitra/cursor`).
  6. `checkGaWorkflowFiles` — розширення і обовʼязкові workflow.
  7. `checkApplyWorkflow` × 2 — `apply-k8s.yml` (`**/k8s/**/*.yaml`) і `apply-nats-consumer.yml` (`**/consumer.yaml`).
  8. `checkMegalinter` — залишки інтеграції/конфіги.
  9. Для кожного `*.yml` — парсить YAML і викликає `verifyWorkflowEventPathsGlobsExist` (git-залежна перевірка `on.*.paths`).
  10. `checkShellcheckInstalled` — наявність бінарника локально.
  11. Повертає `reporter.getExitCode()`.

## Залежності

### Node.js core

- `node:fs` — `existsSync` (синхронна перевірка існування шляхів).
- `node:fs/promises` — `readdir`, `readFile` (асинхронні).
- `node:child_process` — `execFileSync` (для `git ls-files`).
- `node:path` — `basename`, `dirname`, `join`.
- `node:url` — `fileURLToPath` (резолв `import.meta.url` → шлях).

### Внутрішні модулі (`@nitra/cursor`)

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика reporter з `pass`/`fail`/`getExitCode`.
- `../../../scripts/lib/gha-workflow.mjs` → `eventPathsIncludeExact`, `parseWorkflowYaml` — YAML-парсер workflow і helper для перевірки точного шляху в `on.<event>.paths`.
- `../../../scripts/utils/resolve-cmd.mjs` → `resolveCmd` — крос-платформний `which`/`where`.
- `../../../scripts/lib/run-conftest-batch.mjs` → `runConftestBatch` — батч-обгортка над `conftest` (hard-fail без `conftest` у PATH).
- `../../../scripts/lib/template.mjs` → `loadTemplate` — підтягує `template.json`-снипети з директорій Rego-полісі.

### Зовнішні бінарники (runtime)

- `git` — для `git ls-files -z -- :(glob)<pattern>`.
- `conftest` — викликається через `runConftestBatch` (hard-fail без нього).
- `shellcheck` — перевіряється на наявність у PATH (інформаційно).

### Дані конфігурації

- `MEGALINTER_USE_PATTERNS` — regexp-патерни для пошуку MegaLinter у workflow.
- `MEGALINTER_CONFIG_NAMES` — імена конфіг-файлів MegaLinter у корені.
- `REQUIRED_WORKFLOWS` — 4 обовʼязкових workflow з ga.mdc.
- `GA_PER_WORKFLOW_REGO_TARGETS` — мапінг `workflow → namespace → policyDirRel` для пер-документного rego.
- `GA_POLICY_DIR` — обчислюється як `dirname(import.meta.url)/../policy` → абсолютний шлях до `npm/rules/ga/policy/`.
- `HERE` — `dirname(fileURLToPath(import.meta.url))` (директорія самого `workflows.mjs`).

## Потік виконання / Використання

### Виклик з лінт-пайплайну

Модуль викликається непрямо через CLI `@nitra/cursor` як частина правила ga (роутер у `npm/rules/ga/`). Цільовий репозиторій запускає `bun run lint-ga`, який також виконує `actionlint` і `zizmor` поза цією функцією, але `check()` цього модуля — інтегрована частина того ж run.

### Програмний виклик

```js
import { check } from '@nitra/cursor/rules/ga/js/workflows.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Послідовність на рівні `check()`

1. `createCheckReporter()` створює пару колбеків `pass`/`fail` і лічильник exit code.
2. Перевірка наявності `.github/workflows/` — early return при відсутності.
3. `readdir` всіх файлів у директорії, фільтрація `*.yml`.
4. **Rego-фаза:** 4 окремих `conftest` для канонічних workflow + 1 батч `ga.workflow_common` на всі `*.yml`. Усі порушення → `fail` через reporter.
5. **JS-фаза cross-file:**
   - Перевірка `.github/actions/setup-bun-deps/action.yml`.
   - Розширення (`yaml→yml`) і набір обовʼязкових workflow.
   - `apply-k8s.yml` / `apply-nats-consumer.yml` — точна перевірка `paths` через AST.
   - MegaLinter-залишки (workflow + конфіги).
   - Кожен workflow → парс YAML → перевірка `on.*.paths` через `git ls-files :(glob)`.
   - `shellcheck` у PATH.
6. Повертає `reporter.getExitCode()` (`0` або `1`).

### Інтерпретація результатів

- Кожен виклик `pass(msg)` додає ОК-рядок у reporter.
- Кожен виклик `fail(msg)` додає помилку і встановлює exit code = 1.
- Звіт виводиться форматтером `check-reporter.mjs` (поза цим модулем).

### Розширення модуля

Нові пер-документні перевірки workflow слід додавати в Rego-полісі (`npm/policy/ga/<concern>/`) — не сюди. Тут — лише ті перевірки, які потребують FS/git/external-tool доступу. Якщо додаєш новий канонічний workflow:

1. Додай у `REQUIRED_WORKFLOWS`.
2. Створи новий пакет у `npm/policy/ga/<name>/` з Rego-правилами.
3. Зареєструй у `GA_PER_WORKFLOW_REGO_TARGETS` (`workflow`/`namespace`/`policyDirRel`).
4. За потреби — додай `apply-...` стилю trigger-перевірку через `checkApplyWorkflow`.
