---
type: JS Module
title: lint.mjs
resource: npm/rules/k8s/lint/lint.mjs
docgen:
  crc: b6119c36
---

Модуль `lint.mjs` реалізує підкоманду `lint-k8s` CLI `n-cursor`. Він автоматично знаходить у репозиторії всі дерева Kubernetes-маніфестів за конвенційним сегментом шляху `k8s/`, а потім послідовно валідує їх двома інструментами:

1. **`kubeconform`** — структурна валідація YAML-маніфестів проти OpenAPI-схем Kubernetes; підтримує CRD-схеми з каталогу Datree.
2. **`kubescape`** — сканування на misconfiguration / compliance (NSA, MITRE, CIS тощо), з пріоритетом по `kustomize`-білдах (через `kubectl kustomize <dir>`), щоб коректно матчити `namespace`, `podSelector`, network-policies та overlay-структури.

Логіка реалізує канон правила `k8s.mdc`:

- шукаємо лише `*.yaml` (розширення `.yml` під `k8s` заборонене каноном);
- виключаємо `.github/` — це домен `ga.mdc`;
- враховуємо `.cursorignore` для виключення дерев;
- якщо `*.yaml`-файлів під `k8s` немає — виходимо з кодом `0` без запуску CLI;
- версія Kubernetes для `kubeconform` (`-kubernetes-version`) синхронізована з `YANNH_PIN` із `rules/k8s/fix.mjs` / `k8s.mdc`.

Канонічно публічна форма `runLintK8s` обгорнута в `runStandardLint` (із `scripts/lib/run-standard-lint.mjs`), який забезпечує:

- **серіалізацію** через `withLock('lint-k8s')` — щоб уникнути паралельних запусків важких CLI на одній машині (див. `scripts.mdc`, секція «Серіалізація важких CLI-команд»);
- **дедуплікацію** за станом git-дерева (повторний запуск без змін — no-op).

Модуль одночасно є і бібліотекою (експортує допоміжні функції для тестів та реюзу), і CLI-точкою входу (через `isRunAsCli(import.meta.url)`).

## Експорти / API

| Експорт                              | Тип            | Призначення                                                                      |
| ------------------------------------ | -------------- | -------------------------------------------------------------------------------- |
| `pathHasK8sSegment(filePath, root?)` | function       | Перевіряє, чи має шлях сегмент каталогу `k8s` (відносно `root`, якщо переданий). |
| `k8sRootFromFile(absFile)`           | function       | Підіймається вгору від файлу до найближчого предка з назвою `k8s`.               |
| `findK8sRoots(root, ignorePaths?)`   | async function | Повертає унікальні сортовані `…/k8s`-корені під `root`, що містять `*.yaml`.     |
| `buildKubescapeExceptionsArgs(root)` | function       | Формує `['--exceptions', <abs>]` якщо в корені є `.kubescape-exceptions.json`.   |
| `findKustomizationDirs(dir)`         | async function | Знаходить «точки входу» Kustomize (`kustomization.yaml` з `kind` ≠ `Component`). |
| `runLintK8s`                         | async function | Публічна CLI-форма: `runStandardLint(import.meta.dirname, runLintK8sSteps)`.     |

CLI-режим: при прямому виконанні скрипта (`bun npm/rules/k8s/lint/lint.mjs`) встановлюється `process.exitCode = await runLintK8s()`.

### Внутрішні (без `export`) функції

| Функція                                                                   | Роль                                                                        |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `runKubeconform(dirs)`                                                    | Запуск `kubeconform` для переданого списку каталогів.                       |
| `runKustomizeBuild(kubectlPath, dir)`                                     | `kubectl kustomize <dir>` → `{ status, stdout: Buffer }`.                   |
| `runKubescapeManifest(kubescapePath, manifest, exceptionsArgs)`           | Скан зібраного маніфесту через тимчасовий файл.                             |
| `scanRawK8sDir(kubescapePath, dir, exceptionsArgs)`                       | Сирий dir-скан kubescape для k8s-кореня без Kustomize.                      |
| `scanKustomizeK8sDirs(kubectlPath, kubescapePath, kdirs, exceptionsArgs)` | Цикл `kustomize build` → `kubescape scan` по всіх `kdirs`.                  |
| `runKubescape(dirs, root)`                                                | Оркестратор фази kubescape: Kustomize-білди або fallback на сирий dir-скан. |
| `runLintK8sSteps()`                                                       | Внутрішня послідовність (без локу): пошук дерев → kubeconform → kubescape.  |

### Константи модуля

| Константа                    | Значення                     | Призначення                                                       |
| ---------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `KUBESCAPE_EXCEPTIONS_FILE`  | `.kubescape-exceptions.json` | Ім'я per-project файлу винятків для kubescape.                    |
| `KUSTOMIZATION_FILE`         | `kustomization.yaml`         | Канонічна назва маніфесту Kustomize (`.yml` заборонено).          |
| `KUBESCAPE_MISSING_HINT`     | рядок з URL                  | Підказка користувачу при відсутності kubescape у PATH.            |
| `PATH_SEPARATOR_RE`          | `/[/\\]/u`                   | Регексп розбиття шляху по `/` або `\`.                            |
| `YAML_EXT_RE`                | `/\.yaml$/iu`                | Регексп фільтра YAML-файлів.                                      |
| `KUBERNETES_VERSION`         | `1.33.9`                     | Версія схем Kubernetes для kubeconform (узгоджена з `YANNH_PIN`). |
| `DATREE_CRD_SCHEMA_LOCATION` | URL-шаблон                   | Додаткова локація схем для CRD-ресурсів (Datree CRDs-catalog).    |

## Функції

### `pathHasK8sSegment(filePath, root)`

**Сигнатура:** `(filePath: string, root?: string) => boolean`

**Параметри:**

- `filePath` — абсолютний або відносний шлях до файлу.
- `root` (необов'язковий) — корінь репо для relativize.

**Повертає:** `true`, якщо серед компонентів шляху (відносно `root`, якщо передано) є сегмент `k8s`.

**Поведінка / нюанси:**

- Без `root` працює напряму з `filePath` — корисно для перевірки відносного шляху.
- З `root` обов'язково релятивізує: інакше, якщо сам корінь репо містить компонент `k8s` (наприклад `/Users/.../abie/k8s/`), функція повернула б `true` для **усіх** файлів проєкту, включно з `.github/workflows/*.yml`.
- Бекслеші нормалізуються в `/` через `replaceAll('\\', '/')`.
- Якщо після relativize рядок порожній — повертає `false`.

**Side effects:** немає (чиста функція).

### `k8sRootFromFile(absFile)`

**Сигнатура:** `(absFile: string) => string | null`

**Параметри:**

- `absFile` — абсолютний шлях до YAML-файлу.

**Повертає:** абсолютний шлях до найближчого предка з ім'ям `k8s` або `null`, якщо такого сегмента в ланцюжку немає.

**Алгоритм:** ітеративно піднімається `dirname → parent` до 64 рівнів вгору; зупиняється, коли `basename(dir) === 'k8s'` або коли `dirname(dir) === dir` (корінь файлової системи).

**Side effects:** немає.

### `findK8sRoots(root, ignorePaths)`

**Сигнатура:** `async (root: string, ignorePaths?: string[]) => Promise<string[]>`

**Параметри:**

- `root` — корінь репозиторію.
- `ignorePaths` (необов'язковий, default `[]`) — абсолютні шляхи каталогів, повністю виключених з обходу (передається у `walkDir`).

**Повертає:** Promise з масивом унікальних, відсортованих за `localeCompare` абсолютних шляхів до `…/k8s`-каталогів, у яких знайдено хоча б один `*.yaml`.

**Алгоритм:**

1. Викликає `walkDir(root, visitor, ignorePaths)`.
2. Для кожного відвіданого `p`:
   - вираховує відносний шлях `rel` (нормалізує бекслеші);
   - **пропускає** все, що під `.github/` (це домен `ga.mdc`);
   - пропускає файли без сегмента `k8s` у шляху;
   - пропускає не-`.yaml` файли;
   - визначає `k8sRoot` через `k8sRootFromFile`; якщо знайдено — додає до `Set`.
3. Конвертує `Set` у масив і сортує `localeCompare`.

**Side effects:** виконує файлову систему через `walkDir` (read-only обхід).

### `buildKubescapeExceptionsArgs(root)`

**Сигнатура:** `(root: string) => string[]`

**Параметри:**

- `root` — корінь репозиторію (де шукається `.kubescape-exceptions.json`).

**Повертає:** `['--exceptions', '<абсолютний шлях>']` якщо файл існує, інакше `[]`.

**Side effects:** один синхронний `existsSync`.

### `findKustomizationDirs(dir)`

**Сигнатура:** `async (dir: string) => Promise<string[]>`

**Параметри:**

- `dir` — абсолютний шлях до `…/k8s` (або іншого) каталогу.

**Повертає:** Promise з відсортованим списком абсолютних шляхів до каталогів, що містять **білдабельний** `kustomization.yaml` (тобто такий, що `kustomize build` буде здатний рендерити локально).

**Семантика «білдабельний»:**

- Файл називається саме `kustomization.yaml` (без `.yml` — заборонено каноном).
- YAML парситься без помилок (інакше — `continue`).
- Перший документ — об'єкт, у якого `kind !== 'Component'`. `kind: Kustomization` або відсутній `kind` (типово Kustomization) — приймаються; `kind: Component` пропускається, бо Components не білдяться окремо й підключаються через `components:` із overlay.

**Алгоритм:**

1. `walkDir(dir, …)` збирає `candidates` — усі шляхи з `basename === 'kustomization.yaml'`.
2. Послідовно по `candidates`:
   - `readFile(p, 'utf8')` (помилка → skip);
   - `parse(text)` через пакет `yaml` (помилка → skip);
   - якщо `kind === 'Component'` → skip;
   - інакше — `result.add(dirname(p))`.
3. Сортування `localeCompare`.

**Side effects:** обхід ФС + читання вмісту YAML; парсинг без винятку назовні.

### `runKubeconform(dirs)` _(внутрішня)_

**Сигнатура:** `(dirs: string[]) => number`

**Параметри:**

- `dirs` — абсолютні шляхи до `…/k8s`-каталогів.

**Повертає:** код виходу процесу `kubeconform` (`r.status ?? 1`); `127` якщо kubeconform відсутній (`ENOENT`).

**Прапори, що передаються `kubeconform`:**

- `-summary` — компактний підсумок наприкінці.
- `-kubernetes-version 1.33.9` — `KUBERNETES_VERSION`.
- `-schema-location default` — офіційні схеми Kubernetes.
- `-schema-location <DATREE_CRD_SCHEMA_LOCATION>` — реєстр CRD-схем Datree.
- `-ignore-missing-schemas` — пропустити CRD, для яких не знайдено схеми.
- `…dirs` — список цільових каталогів.

**Side effects:** `spawnSync` (stdio inherit) — друкує вихід kubeconform у термінал; на `ENOENT` пише інструкцію встановлення в `stderr`.

### `runKustomizeBuild(kubectlPath, dir)` _(внутрішня)_

**Сигнатура:** `(kubectlPath: string, dir: string) => { status: number, stdout: Buffer }`

**Поведінка:** запускає `kubectl kustomize <dir>` з `stdio: ['ignore', 'pipe', 'inherit']` — stdout захоплює як буфер, stderr інхеритимо в термінал (щоб помилки збірки одразу були видимі). Використовується `kubectl kustomize` замість окремого бінарника `kustomize`, бо `kubectl` є штатним інструментом, а підкоманда `kustomize` локальна і не вимагає доступу до кластера.

**Повертає:** `{ status: r.status ?? 1, stdout: r.stdout ?? Buffer.alloc(0) }`.

**Side effects:** дочірній процес з inherit stderr.

### `runKubescapeManifest(kubescapePath, manifest, exceptionsArgs)` _(внутрішня)_

**Сигнатура:** `(kubescapePath: string, manifest: Buffer, exceptionsArgs: string[]) => { status: number, enoent: boolean }`

**Поведінка:**

1. Створює тимчасову директорію `mkdtempSync(join(tmpdir(), 'nitra-cursor-k8s-'))`.
2. Пише `manifest` у файл `manifest.yaml` усередині неї.
3. Запускає `kubescape scan <file> --severity-threshold high <...exceptionsArgs>` зі `stdio: 'inherit'`.
4. У `finally` гарантовано видаляє створену директорію (`rmSync(dir, { recursive: true, force: true })`).

**Чому тимчасовий файл, а не stdin:** `kubescape scan` у v4.x **не читає stdin** — `-` як шлях не розпізнається (`no resources found to scan`), а прапорця `--input`/`--stdin` у CLI немає.

**Повертає:** `{ status, enoent }` — `enoent: true` якщо `r.error.code === 'ENOENT'`.

**Side effects:** створення/видалення тимчасової директорії, запис файлу, дочірній процес.

### `scanRawK8sDir(kubescapePath, dir, exceptionsArgs)` _(внутрішня)_

**Сигнатура:** `(kubescapePath: string, dir: string, exceptionsArgs: string[]) => number`

**Поведінка:** сирий dir-скан kubescape для `…/k8s`-кореня без білдабельного `kustomization.yaml`. Друкує лог `run-k8s: kubescape scan <dir> (без kustomization — сирий dir-скан)` і запускає `kubescape scan <dir> --severity-threshold high <...exceptionsArgs>` зі `stdio: 'inherit'`.

**Повертає:** `0` при успіху, `127` якщо kubescape зник з PATH (`ENOENT`), інакше `r.status ?? 1`.

### `scanKustomizeK8sDirs(kubectlPath, kubescapePath, kdirs, exceptionsArgs)` _(внутрішня)_

**Сигнатура:** `(kubectlPath: string, kubescapePath: string, kdirs: string[], exceptionsArgs: string[]) => number`

**Поведінка:** для кожного `kdir` із `kdirs`:

1. Друкує лог `run-k8s: kubectl kustomize <kdir> | kubescape scan <tmp>`.
2. `runKustomizeBuild(kubectlPath, kdir)` — якщо `status !== 0`, негайно повертає цей `status`.
3. `runKubescapeManifest(kubescapePath, build.stdout, exceptionsArgs)`:
   - якщо `ks.enoent` — пише `KUBESCAPE_MISSING_HINT` у `stderr` і повертає `127`;
   - якщо `ks.status !== 0` — повертає `ks.status`.

**Повертає:** `0` лише якщо всі каталоги пройшли; інакше — код першого невдалого процесу.

### `runKubescape(dirs, root)` _(внутрішня)_

**Сигнатура:** `async (dirs: string[], root: string) => Promise<number>`

**Алгоритм:**

1. `exceptionsArgs = buildKubescapeExceptionsArgs(root)`; якщо непорожній — лог про використання exceptions-файлу.
2. `kubescapePath = ensureTool('kubescape')` — забезпечує наявність бінарника (інсталює, якщо налаштовано).
3. `kubectlPath = null` (lazy resolve).
4. Для кожного `d` з `dirs`:
   - `kdirs = await findKustomizationDirs(d)`.
   - Якщо `kdirs` порожній → fallback: `scanRawK8sDir(kubescapePath, d, exceptionsArgs)`; помилка → return.
   - Інакше (перший раз): `kubectlPath = resolveCmd('kubectl')`. Якщо `null` → лог про відсутність kubectl + return `127`.
   - `scanKustomizeK8sDirs(kubectlPath, kubescapePath, kdirs, exceptionsArgs)`; помилка → return.
5. Поверне `0`, якщо всі `dirs` пройшли.

**Чому через kustomize-білд, а не сирий скан:** збірка нормалізує `namespace` на workload-маніфестах і `base/networkpolicy.yaml` (через `base/kustomization.yaml` `namespace:`), що дає коректний матчинг `podSelector` у control'і C-0260 (`Missing network policy`) і дозволяє kubescape бачити дерево overlays/components зі справжніми ресурсами.

**Fallback:** якщо в `…/k8s` немає білдабельного `kustomization.yaml` — сирий dir-скан (не блокувати YAML-only проєкт без Kustomize).

### `runLintK8sSteps()` _(внутрішня)_

**Сигнатура:** `async () => Promise<number>`

**Поведінка:**

1. `root = process.cwd()`.
2. `ignorePaths = await loadCursorIgnorePaths(root)` — підвантажує патерни з `.cursorignore`.
3. `dirs = await findK8sRoots(root, ignorePaths)`.
4. Якщо `dirs.length === 0` — лог `run-k8s: немає *.yaml під k8s — kubeconform і kubescape пропущено` і `return 0`.
5. Лог `run-k8s: каталоги k8s (<n>):` + перелік кожного `d`.
6. `kc = runKubeconform(dirs)`; якщо `!= 0` — `return kc`.
7. `ks = await runKubescape(dirs, root)`; `return ks`.

**Повертає:** код виходу для `process.exitCode` (`0` — успіх або пропуск).

### `runLintK8s` _(експортована CLI-форма)_

**Сигнатура:** `() => Promise<number>`

**Реалізація:** `runStandardLint(import.meta.dirname, runLintK8sSteps)` — обгортка з канону `scripts.mdc`, що додає:

- серіалізацію через `withLock('lint-k8s')` (блокування паралельних запусків);
- дедуплікацію за станом git-дерева (пропуск повторного запуску без змін).

Експорт використовується з `bin/n-cursor.js` як підкоманда `lint-k8s`.

## Залежності

### Node.js builtin

| Модуль               | Що використовується                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `node:child_process` | `spawnSync` для запуску `kubeconform`, `kubectl`, `kubescape`.                           |
| `node:fs`            | `existsSync` (exceptions-файл), `mkdtempSync`, `rmSync`, `writeFileSync` (tmp-маніфест). |
| `node:fs/promises`   | `readFile` для парсингу `kustomization.yaml`.                                            |
| `node:os`            | `tmpdir()` як база для тимчасової директорії.                                            |
| `node:path`          | `basename`, `dirname`, `join`, `relative`.                                               |

### Зовнішні npm-пакети

| Пакет                         | Використання                                                    |
| ----------------------------- | --------------------------------------------------------------- |
| `yaml` (named import `parse`) | Парсинг `kustomization.yaml` для відсіювання `kind: Component`. |

### Внутрішні модулі репозиторію

| Шлях                                                                    | Використання                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `../../../scripts/cli-entry.mjs` (`isRunAsCli`)                         | Детектор «запущено як CLI» (а не імпортовано).                                                  |
| `../../../scripts/lib/ensure-tool.mjs` (`ensureTool`)                   | Гарантує наявність CLI-інструмента (kubeconform, kubescape) у PATH (інсталює якщо налаштовано). |
| `../../../scripts/lib/load-cursor-config.mjs` (`loadCursorIgnorePaths`) | Зчитує `.cursorignore` і повертає абсолютні шляхи виключень.                                    |
| `../../../scripts/utils/resolve-cmd.mjs` (`resolveCmd`)                 | Знаходить абсолютний шлях до бінарника (для `kubectl`, без installation hook).                  |
| `../../../scripts/utils/walkDir.mjs` (`walkDir`)                        | Рекурсивний обхід ФС із підтримкою ignore-патернів.                                             |
| `../../../scripts/lib/run-standard-lint.mjs` (`runStandardLint`)        | Стандартна обгортка серіалізації + дедупу для lint-команд.                                      |

### Зовнішні CLI-інструменти

- **`kubeconform`** — очікується в `PATH`, ставиться через Homebrew (macOS) або релізами з GitHub (`yannh/kubeconform`); у CI — крок установки з `k8s.mdc`.
- **`kubescape`** — очікується в `PATH`; інструкція встановлення — `https://github.com/kubescape/kubescape#readme`.
- **`kubectl`** — стандартний інструмент; для підкоманди `kubectl kustomize` доступ до кластера **не потрібен** (рендер локальний).

## Потік виконання / Використання

### CLI-режим

```
n-cursor lint k8s            # rule orchestration entrypoint
# або (наприкінці файлу — прямий запуск)
bun npm/rules/k8s/lint/lint.mjs
```

Послідовність:

```
runLintK8s
└── runStandardLint(dirname, runLintK8sSteps)
    ├── withLock('lint-k8s')                # серіалізація
    ├── (дедуп за git-станом)
    └── runLintK8sSteps
        ├── loadCursorIgnorePaths(cwd)
        ├── findK8sRoots(cwd, ignorePaths)
        │   └── walkDir … pathHasK8sSegment … k8sRootFromFile
        ├── [якщо dirs порожні] → return 0
        ├── runKubeconform(dirs)
        │   └── ensureTool('kubeconform') + spawnSync
        └── runKubescape(dirs, root)
            ├── buildKubescapeExceptionsArgs(root)
            ├── ensureTool('kubescape')
            └── for d of dirs:
                ├── findKustomizationDirs(d)
                ├── [empty] scanRawK8sDir
                └── [else]
                    ├── resolveCmd('kubectl') [lazy, один раз]
                    └── scanKustomizeK8sDirs
                        └── for kdir:
                            ├── runKustomizeBuild(kubectl, kdir)
                            └── runKubescapeManifest(kubescape, stdout, exceptionsArgs)
                                ├── mkdtempSync + writeFileSync
                                ├── spawnSync('kubescape scan <tmp> --severity-threshold high …')
                                └── finally: rmSync(tmpdir, recursive, force)
```

### Імпортний режим (бібліотека)

```js
import {
  findK8sRoots,
  findKustomizationDirs,
  buildKubescapeExceptionsArgs,
  k8sRootFromFile,
  pathHasK8sSegment,
  runLintK8s
} from './lint.mjs'

const roots = await findK8sRoots(process.cwd())
```

Чисті помічники (`pathHasK8sSegment`, `k8sRootFromFile`, `buildKubescapeExceptionsArgs`) можна тестувати ізольовано (стек тестів — у сусідньому `tests/`).

### Коди виходу (повертаються через `process.exitCode`)

| Код        | Значення                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `0`        | Успіх або пропуск (немає `*.yaml` під `k8s`).                                                               |
| `127`      | Відсутній зовнішній CLI у PATH: `kubeconform`, `kubescape` або `kubectl`. У stderr — підказка встановлення. |
| ≠ 0 (інше) | Код невдалого процесу (`kubeconform`, `kubectl kustomize` або `kubescape`).                                 |
| `1`        | Дефолт `r.status ?? 1`, якщо процес завершився без статусу.                                                 |

### Файли конфігурації, що впливають на роботу

- **`.cursorignore`** у корені — патерни виключення для обходу ФС (через `loadCursorIgnorePaths`).
- **`.kubescape-exceptions.json`** у корені — точкові винятки control'ів для kubescape (підмішується через `--exceptions <file>`; приклад — виняток C-0012 на ConfigMap з публічним JWT-конфігом; див. `k8s.mdc`).
- **`kustomization.yaml`** у `…/k8s`-піддеревах — визначає, які каталоги білдяться через `kubectl kustomize`. Файл з `kind: Component` пропускається.

### Конвенції каталогів

- Сегмент шляху `k8s/` — маркер дерева Kubernetes-маніфестів.
- Дозволено лише `.yaml` (не `.yml`) — це канон `k8s.mdc`.
- `.github/` повністю виключається з обходу (домен `ga.mdc`).
- Глибина пошуку `k8s`-предка у `k8sRootFromFile` — до 64 рівнів каталогів (захист від нескінченного циклу на дивних ФС).

### Логи у stdout/stderr

- `run-k8s: немає *.yaml під k8s — kubeconform і kubescape пропущено` — рання гілка no-op.
- `run-k8s: каталоги k8s (<n>):` + перелік — стартовий лог із виявленими деревами.
- `run-k8s: kubescape exceptions — .kubescape-exceptions.json` — якщо exceptions-файл присутній.
- `run-k8s: kubectl kustomize <kdir> | kubescape scan <tmp>` — Kustomize-pipeline.
- `run-k8s: kubescape scan <dir> (без kustomization — сирий dir-скан)` — fallback.
- `stderr`: підказки встановлення kubeconform/kubescape/kubectl при `ENOENT`.

### Side effects (підсумок)

- Читання файлової системи (обхід дерев, читання `kustomization.yaml`).
- Створення/видалення тимчасової директорії у `os.tmpdir()` (`nitra-cursor-k8s-*`) — лише на час сканування одного Kustomize-білду.
- Запис тимчасового `manifest.yaml` у цю директорію.
- Запуск дочірніх процесів (`kubeconform`, `kubectl`, `kubescape`) із наслідуванням stdio.
- Встановлення `process.exitCode` лише в CLI-режимі (`isRunAsCli(import.meta.url)`).
