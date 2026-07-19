---
type: JS Module
title: ensure-tool.mjs
resource: npm/scripts/lib/ensure-tool.mjs
docgen:
  crc: c77b4b65
---

Модуль `ensure-tool.mjs` — єдина точка резолву зовнішніх CLI-залежностей пакета `@7n/rules`. Він гарантує, що потрібний бінарник (`hk`, `conftest`, `shellcheck`, `actionlint`, `dotenv-linter`, `opa`, `regal`, `hadolint`, `kubeconform`, `kubescape`) доступний у системі, виконуючи послідовний пошук:

1. У системному `PATH` (через `resolveCmd`).
2. У керованому кеші бінарників (`~/.cache/@7n/rules/bin/` на Linux/macOS або `%LOCALAPPDATA%\@nitra\cursor\bin\` на Windows).
3. Авто-встановлення відповідно до OS (`brew` для macOS, `scoop` для Windows із fallback на GitHub Release, прямий завантажувач GitHub Release для Linux).
4. Hard-fail з персоналізованою підказкою, якщо авто-встановлення вимкнено змінною середовища `N_CURSOR_NO_AUTO_INSTALL`.

Така архітектура усуває дублювання install-логіки в кожному `lint.mjs` / `fix.mjs`: щоб додати нову зовнішню утиліту, достатньо одного запису в реєстрі `TOOLS`. Додатково модуль експортує `ensureHkInstall`, який реєструє git pre-commit hook через `hk install` (пропускається в CI).

Версії для GitHub Release install-шляху (Linux, і Windows-fallback коли `scoop` недоступний) — **закріплені** у `scripts/lib/tool-pins.json`, а не резолвляться як `latest` на кожен install. Причина: CI-runner-и ефемерні, локальний кеш бінарників порожній щоразу, і `latest`-lookup через GitHub API на кожен job означає постійний трафік зі спільних CI-IP — і впирається у rate-limit (60 запитів/год без токена). `fetchLatestVersion` (двоступеневий lookup: GitHub API з `GITHUB_TOKEN`/`GH_TOKEN` за наявності → redirect-fallback повз API) лишається в модулі, але викликається лише вручну — окремим скриптом `scripts/tool-pins-refresh.mjs`, не на звичайному install-шляху. `checkToolPinsFreshness()` рахує вік поточного піна (`tool-pins.json.pinnedAt`) у днях і сигналить `stale: true` після `TOOL_PINS_MAX_AGE_DAYS` (30) — на цьому побудований тест `tool-pins-freshness.test.mjs`, що навмисно червоніє, коли піни застаріли, і нагадує запустити рефреш.

Поруч із синхронною `ensureTool` (публічний API пакета, сигнатура не змінюється) модуль експортує async-варіант `ensureToolAsync(toolId)` для parallel lane `detectAll()` (ADR 260716-1354-внутрішній-паралелізм-lint-оркестратора): конкурентні виклики того самого `toolId` в одному Node-процесі колапсують в один install (in-process single-flight), а auto-install крок додатково серіалізується між процесами через `withLock` (ключ `ensure-tool/<toolId>`) — паралельні Node-процеси (різні CI-shard-и, кілька агентів) не тягнуть той самий бінарник конкурентно. Завантажений архів завжди пишеться в унікальний per-call temp-каталог і публікується атомарним `renameSync` під фіксованим flat-іменем `<toolId>` — цей hardened install-крок спільний для sync і async шляхів.

Файл написаний для Node.js (ESM), використовує лише стандартну бібліотеку, локальний хелпер `resolveCmd` і `withLock` (`../utils/with-lock.mjs`) для міжпроцесної серіалізації async-install-кроку.

## Експорти / API

| Експорт                    | Тип        | Призначення                                                                                                                                       |
| --------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ensureTool(toolId)`        | `function` | Резолвить і за потреби встановлює зовнішній CLI (sync). Повертає абсолютний шлях до бінарника або кидає `Error`.                                     |
| `ensureToolAsync(toolId)`   | `function` | Async-варіант для parallel lane `detectAll()`: single-flight (in-process) + `withLock` (cross-process) навколо auto-install кроку. Повертає `Promise<string>`. |
| `ensureHkInstall(hkBin)`    | `function` | Виконує `hk install` для реєстрації git pre-commit hook. Жодного return value; на помилку лише `console.warn`.                                       |
| `ToolProvisionError`        | `class`    | Транзієнтний збій авто-встановлення (мережа, обірваний download). Споживачі розпізнають за `name` і можуть спрацювати fail-open (див. `lint-surface/detect.mjs`). |
| `fetchLatestVersion(repo, curlBin)` | `function` | Резолвить останній тег релізу: GitHub API (з токеном за наявності) → redirect-fallback повз API. На звичайному install-шляху не викликається — лише зі `scripts/tool-pins-refresh.mjs` і юніт-тестів. |
| `TOOLS`                     | `object`   | Реєстр `Record<string, ToolEntry>` із описом install-стратегії для кожного тула. Read-only; читається `tool-pins-refresh.mjs`. |
| `TOOL_PINS_MAX_AGE_DAYS`    | `number`   | Поріг «застарілості» піна версій у днях (30). |
| `checkToolPinsFreshness(now?)` | `function` | Вік поточного `tool-pins.json.pinnedAt` у днях відносно `now` (за замовчуванням `Date.now()`). Повертає `{ pinnedAt, ageDays, stale }`. |

Внутрішні (не експортуються, але формують контракт модуля):

- `ToolEntry` — JSDoc-тип, що описує поля одного запису реєстру.
- Допоміжні функції: `getCacheDir`, `mapArch`, `githubAuthArgs`, `fetchLatestVersionViaApi`, `fetchLatestVersionViaRedirect`, `readToolPins`, `resolvePinnedVersion`, `installFromGithub`, `installViaBrew`, `installViaScoop`, `autoInstall`, `buildHint`.

## Функції

### `getCacheDir()`

- **Сигнатура:** `getCacheDir(): string`
- **Параметри:** немає.
- **Повертає:** абсолютний шлях до каталогу кешу бінарників.
- **Логіка:**
  - На `win32` бере `process.env.LOCALAPPDATA` (fallback `homedir()/AppData/Local`) і додає `@7n/rules/bin`.
  - На інших платформах повертає `homedir()/.cache/@7n/rules/bin`.
- **Side effects:** немає (тільки читає env / `os.homedir`).

### `mapArch(nodeArch, style)`

- **Сигнатура:** `mapArch(nodeArch: 'x64'|'arm64'|string, style: 'hk'|'conftest'|'actionlint'): string`
- **Параметри:**
  - `nodeArch` — значення `process.arch`.
  - `style` — стиль іменування платформи для release-asset:
    - `'actionlint'` → `amd64` / `arm64`.
    - `'conftest'` → `x86_64` / `arm64`.
    - `'hk'` (та інші release-asset стилі: shellcheck, dotenv-linter) → `x86_64` / `aarch64`.
- **Повертає:** рядок архітектури, очікуваний у назві release-asset.
- **Side effects:** немає.

### `fetchLatestVersion(repo, curlBin)`

- **Сигнатура:** `fetchLatestVersion(repo: string, curlBin: string): string`
- **Параметри:**
  - `repo` — репозиторій у форматі `owner/repo`.
  - `curlBin` — абсолютний шлях до бінарника `curl`.
- **Повертає:** версію останнього релізу без префікса `v` (наприклад `0.4.1`).
- **Поведінка:** двоступеневий lookup.
  1. GitHub API: `curl -sSL https://api.github.com/repos/<repo>/releases/latest` з `Accept: application/vnd.github+json`; якщо в env є `GITHUB_TOKEN` (або `GH_TOKEN`) — додається `Authorization: Bearer <token>`, що піднімає rate-limit із 60/год (per-IP, вичерпується на shared CI-runner-ах) до 5000/год. Парсить JSON, бере `tag_name`, прибирає префікс `v`.
  2. Redirect-fallback (при будь-якому збої API): `https://github.com/<repo>/releases/latest` переадресовує на `…/releases/tag/<tag>`; тег читається з фінального URL (`curl -sIL -w '%{url_effective}'`). Веб-endpoint не підпадає під API rate-limit.
- **Помилки:** кидає `ToolProvisionError` лише коли не вдались обидва шляхи; повідомлення містить обидві причини (для API-відповіді без `tag_name` — і її `message`, напр. «API rate limit exceeded»).
- **Side effects:** мережеві HTTP-запити до GitHub.

### `readToolPins()`

- **Сигнатура:** `readToolPins(): { pinnedAt: string, versions: Record<string, string> }`
- **Повертає:** розпарсений `tool-pins.json`. Читається синхронно на кожен виклик (без module-level кешу) — довгоживучий процес одразу бачить щойно застосований рефреш.
- **Side effects:** синхронне читання файлу `scripts/lib/tool-pins.json`.

### `resolvePinnedVersion(toolId)`

- **Сигнатура:** `resolvePinnedVersion(toolId: string): string`
- **Повертає:** закріплену версію тула з `tool-pins.json.versions[toolId]` (без префікса `v`).
- **Помилки:** якщо для `toolId` немає запису у `versions` — кидає звичайний (не `ToolProvisionError`) `Error`: це конфігураційна помилка (тул зареєстрували в `TOOLS`, але забули додати пін), а не транзієнтний збій.
- **Side effects:** делегує в `readToolPins()`.

### `installFromGithub(toolId, entry, cacheDir)`

- **Сигнатура:** `installFromGithub(toolId: string, entry: ToolEntry, cacheDir: string): string`
- **Параметри:**
  - `toolId` — ключ у `TOOLS`.
  - `entry` — `ToolEntry` для цього тула.
  - `cacheDir` — абсолютний шлях до каталогу кешу.
- **Повертає:** абсолютний шлях до встановленого бінарника.
- **Послідовність дій:**
  1. Резолвить `curl` та `tar` у PATH; за відсутності — кидає `Error`.
  2. Через `resolvePinnedVersion(toolId)` бере закріплену версію з `tool-pins.json` — жодного мережевого `latest`-lookup на цьому кроці.
  3. Формує назву asset через `entry.asset(ver)` і URL `https://github.com/<github>/releases/download/v<ver>/<asset>`.
  4. Створює `cacheDir` (`mkdirSync` з `recursive: true`) і унікальний per-call temp-каталог усередині нього (`mkdtempSync(join(cacheDir, '.tmp-<toolId>-'))`) — той самий filesystem гарантує, що фінальний `renameSync` не впаде з `EXDEV`.
  5. Завантажує asset у temp-каталог через `curl -sSL -o <tmpDir>/<asset> <downloadUrl>`.
  6. Якщо `entry.archive === false` — `chmodSync` завантаженого файлу (`0o755`) і атомарний `renameSync` у `<cacheDir>/<toolId>`.
  7. Інакше викликає `tar` із прапорцем `-xJf` (для `.tar.xz`) або `-xzf` (для `.tar.gz`) для розпакування в temp-каталог, знаходить реальний шлях бінарника через `entry.binFinder(ver)` або просто `toolId`, перевіряє його існування — і так само атомарним `renameSync` публікує його у `<cacheDir>/<toolId>` (flat-ім'я, незалежно від вкладеної структури архіву).
  8. У `finally` прибирає весь temp-каталог (`rmSync(tmpDir, { recursive: true, force: true })`) — і архів, і проміжні файли розпакування зникають одним викликом.
- **Помилки:**
  - `curl не знайдено в PATH — потрібен для завантаження <toolId>` (`Error` — конфігурація середовища).
  - `tar не знайдено в PATH — потрібен для встановлення <toolId>` (`Error`).
  - `ensureTool: немає закріпленої версії для '<toolId>' у tool-pins.json — ...` (`Error` — конфігурація, з `resolvePinnedVersion`).
  - `Завантаження <toolId> не вдалось: ...` / `curl exit <status> при завантаженні <toolId>: ...` (`ToolProvisionError` — транзієнтний мережевий збій).
  - `tar failed for <toolId>: ...` / `tar exit <status> для <toolId>: ...` (`Error`).
  - `Бінарник <toolId> не знайдено після розпакування: <extractedBin>` (`Error`).
- **Side effects:** мережа (лише download, без `latest`-lookup), файлова система (унікальний temp-каталог, атомарна публікація, chmod, очищення temp).

### `checkToolPinsFreshness(now?)` _(export)_

- **Сигнатура:** `checkToolPinsFreshness(now?: number): { pinnedAt: string, ageDays: number, stale: boolean }`
- **Параметри:** `now` — час порівняння в ms epoch; за замовчуванням `Date.now()`.
- **Повертає:** `pinnedAt` з `tool-pins.json`, обчислений `ageDays` (`Math.floor`) і `stale` — `true`, якщо `ageDays > TOOL_PINS_MAX_AGE_DAYS` (30).
- **Side effects:** делегує в `readToolPins()`.

### `installViaBrew(toolId, entry)`

- **Сигнатура:** `installViaBrew(toolId: string, entry: ToolEntry): string`
- **Параметри:** `toolId` і `entry` як у попередній функції.
- **Повертає:** абсолютний шлях до бінарника після встановлення (через повторний `resolveCmd(toolId)`).
- **Послідовність дій:**
  1. Резолвить `brew` у PATH; на відсутність кидає `brew не знайдено в PATH. Встанови Homebrew: https://brew.sh`.
  2. Виконує `brew install <entry.brew>` із `stdio: 'inherit'` (інтерактивний прогрес).
  3. Перевіряє exit-код і `error` об’єкт.
  4. Після успіху повторно резолвить `toolId` у PATH; якщо й тоді нема — кидає `... не знайдено в PATH після brew install`.
- **Side effects:** виклик зовнішнього `brew install` (мережа, мутація системного стану на macOS).

### `installViaScoop(toolId, entry)`

- **Сигнатура:** `installViaScoop(toolId: string, entry: ToolEntry): string`
- **Параметри:** як вище.
- **Повертає:** абсолютний шлях до бінарника після встановлення.
- **Поведінка:** дзеркало `installViaBrew`, але для `scoop install`.
  - Якщо `entry.scoop === null` — кидає `... недоступний у Scoop. Встанови вручну: https://github.com/<repo>/releases`.
  - Якщо `scoop` не у PATH — кидає `scoop не знайдено в PATH. Встанови Scoop: https://scoop.sh`.
- **Side effects:** виклик зовнішнього `scoop install`.

### `autoInstall(toolId, entry, cacheDir)`

- **Сигнатура:** `autoInstall(toolId: string, entry: ToolEntry, cacheDir: string): string`
- **Поведінка диспетчера за платформою:**
  - `darwin` → `installViaBrew`.
  - `win32` → пробує `installViaScoop`, на будь-який throw — fallback на `installFromGithub` (наприклад, для `dotenv-linter` чи `regal`, де `scoop: null`).
  - Інше (Linux) → `installFromGithub`.
- **Повертає:** абсолютний шлях до бінарника.
- **Side effects:** делегує своїм внутрішнім installer-ам.

### `buildHint(toolId, entry)`

- **Сигнатура:** `buildHint(toolId: string, entry: ToolEntry): string`
- **Параметри:** як вище.
- **Повертає:** багаторядкове повідомлення для error message при заблокованому авто-installі.
- **Формат:**
  - Перший рядок — `❌ <toolId> не знайдено в PATH і авто-встановлення відключено (N_CURSOR_NO_AUTO_INSTALL).`.
  - Другий рядок — `   Встанови:`.
  - Далі — OS-specific підказка:
    - macOS: `     macOS: brew install <entry.brew>`.
    - Windows: `     Windows: scoop install <entry.scoop>` (якщо доступний) та `     або: https://github.com/<repo>/releases`.
    - Linux: `     Linux: https://github.com/<repo>/releases`.
- **Side effects:** немає.

### `ensureTool(toolId)` _(export)_

- **Сигнатура:** `ensureTool(toolId: string): string`
- **Параметри:** `toolId` — ключ у реєстрі `TOOLS` (`'hk'`, `'conftest'`, `'shellcheck'`, `'actionlint'`, `'dotenv-linter'`, `'opa'`, `'regal'`, `'hadolint'`, `'kubeconform'`, `'kubescape'`).
- **Повертає:** абсолютний шлях до бінарника.
- **Послідовність резолву:**
  1. **Валідація** — якщо `TOOLS[toolId]` відсутній, кидає `ensureTool: невідомий тул '<toolId>'`.
  2. **PATH** — `resolveCmd(toolId)`; якщо знайдено — повертає одразу.
  3. **Кеш** — `join(getCacheDir(), toolId)`; якщо файл існує — повертає його шлях. Install завжди публікує бінарник під цим самим flat-іменем (атомарний `renameSync`, незалежно від вкладеної структури архіву — напр. `shellcheck` розпаковується у `shellcheck-v<ver>/shellcheck`), тож ця перевірка коректно бачить кеш і після `entry.binFinder`-архівів.
  4. **Авто-install** — якщо змінна середовища `N_CURSOR_NO_AUTO_INSTALL` не виставлена, викликає `autoInstall(toolId, entry, cacheDir)`.
  5. **Hard-fail** — кидає `Error(buildHint(toolId, entry))`.
- **Помилки:** будь-яка з помилок `autoInstall` / `installFrom*` піднімається вгору; додатково — `невідомий тул` та `❌ ... не знайдено в PATH`.
- **Side effects:** мережа, файлова система, виклик зовнішніх install-команд (`brew`, `scoop`, `curl`, `tar`, `rm`).

### `ensureHkInstall(hkBin)` _(export)_

- **Сигнатура:** `ensureHkInstall(hkBin: string): void`
- **Параметри:**
  - `hkBin` — абсолютний шлях до бінарника `hk` (зазвичай отриманий через `ensureTool('hk')`).
- **Повертає:** `void`.
- **Логіка:**
  - Якщо `process.env.CI` truthy — функція виходить без дії (не реєструємо hook у CI).
  - Інакше виконує `spawnSync(hkBin, ['install'], { stdio: 'inherit' })`.
  - На `r.error` або ненульовий `r.status` виводить попередження через `console.warn` (не кидає!).
- **Side effects:** запис git pre-commit hook у `.git/hooks/pre-commit` (через `hk`), вивід у stdout/stderr.

## Залежності

### Стандартна бібліотека Node.js

- `node:child_process` — `spawnSync` для синхронного запуску `curl`, `tar`, `brew`, `scoop`, `rm`, `hk`.
- `node:fs` — `chmodSync`, `existsSync`, `mkdirSync`, `mkdtempSync`, `readFileSync` (читання `tool-pins.json`), `renameSync`, `rmSync`.
- `node:os` — `homedir` для побудови шляху кешу.
- `node:path` — `dirname`, `join` для конструювання шляхів.
- `node:process` — `arch`, `env`, `platform`.
- `node:url` — `fileURLToPath` для резолву абсолютного шляху `tool-pins.json` поряд із модулем.

### Внутрішні

- `../utils/resolve-cmd.mjs` → `resolveCmd(cmd)` — кросплатформне резолвлення абсолютного шляху до бінарника в PATH (Linux/macOS — like `which`, Windows — like `where`).

### Зовнішні CLI (виконуються через `spawnSync`)

- `curl` — завантаження GitHub API і release-asset.
- `tar` — розпакування `.tar.gz` / `.tar.xz`.
- `rm` — м’яке видалення завантаженого архіву (необов’язково).
- `brew` — install на macOS.
- `scoop` — install на Windows.
- `hk` — реєстрація git pre-commit hook у `ensureHkInstall`.

### Змінні середовища

- `N_CURSOR_NO_AUTO_INSTALL` — якщо встановлена, блокує авто-install і змушує `ensureTool` кидати помилку з install-hint.
- `CI` — якщо truthy, `ensureHkInstall` нічого не робить.
- `LOCALAPPDATA` (Windows) — використовується для побудови шляху кешу.

## Потік виконання / Використання

### Типовий сценарій `ensureTool('shellcheck')` на Linux x64

1. Викликається `ensureTool('shellcheck')`.
2. `resolveCmd('shellcheck')` — не знайдено в `PATH`.
3. `getCacheDir()` повертає `/home/<user>/.cache/@7n/rules/bin`.
4. Перевірка `/home/<user>/.cache/@7n/rules/bin/shellcheck` — не існує.
5. `N_CURSOR_NO_AUTO_INSTALL` не виставлено → `autoInstall(...)`.
6. На Linux диспетчер викликає `installFromGithub('shellcheck', entry, cacheDir)`:
   - `resolvePinnedVersion('shellcheck')` читає `tool-pins.json.versions.shellcheck` → наприклад `0.11.0` (мережевого запиту немає).
   - asset name = `shellcheck-v0.11.0.linux.x86_64.tar.xz`.
   - URL = `https://github.com/koalaman/shellcheck/releases/download/v0.11.0/<asset>`.
   - `mkdirSync(cacheDir, { recursive: true })` і унікальний `tmpDir = mkdtempSync(join(cacheDir, '.tmp-shellcheck-'))`.
   - `curl -sSL -o <tmpDir>/<asset> <url>`.
   - `tar -xJf <asset> -C <tmpDir>` (бо `.tar.xz`).
   - `binFinder('0.11.0')` → `<tmpDir>/shellcheck-v0.11.0/shellcheck`; перевірка `existsSync`.
   - Атомарний `renameSync(<tmpDir>/shellcheck-v0.11.0/shellcheck, <cacheDir>/shellcheck)` — публікація під flat-іменем.
   - `rmSync(tmpDir, { recursive: true, force: true })` у `finally`.
   - Повертає `<cacheDir>/shellcheck`.
7. Викликач отримує абсолютний шлях і запускає `spawnSync(bin, [...args])`.

### Сценарій блокування авто-installу

```js
process.env.N_CURSOR_NO_AUTO_INSTALL = '1'
ensureTool('hk')
// throws Error із багаторядковим hint, наприклад на macOS:
// ❌ hk не знайдено в PATH і авто-встановлення відключено (N_CURSOR_NO_AUTO_INSTALL).
//    Встанови:
//      macOS: brew install hk
```

### Сценарій реєстрації git hook

```js
import { ensureTool, ensureHkInstall } from './lib/ensure-tool.mjs'

const hkBin = ensureTool('hk') // PATH → кеш → brew/scoop/github
ensureHkInstall(hkBin) // git hook у .git/hooks/pre-commit
```

У CI (`process.env.CI=true`) другий виклик стає no-op, що зручно для pipeline-ів, де hooks не потрібні.

### Розширення реєстру

Щоб додати новий тул `foo`:

1. Підбрати `brew`-формулу та `scoop`-пакет (або `null`, якщо відсутній).
2. Знайти GitHub-репо релізів і визначити `archStyle` (`hk` / `conftest` / `actionlint`).
3. Описати `asset(ver)` та, якщо потрібно, `binFinder(ver)` (коли бінарник лежить не в корені архіву).
4. Виставити `archive: false` для прямого бінарника без архіву.
5. Додати запис у `TOOLS`.
6. Додати закріплену версію в `tool-pins.json.versions.foo` (напр. запустивши `bun npm/scripts/tool-pins-refresh.mjs` — підхопить новий тул автоматично) — без цього кроку `installFromGithub('foo', …)` на Linux/Windows-fallback впаде з конфігураційною помилкою `немає закріпленої версії для 'foo'`.

Жодних змін у викликачах не потрібно — `ensureTool('foo')` запрацює одразу.

### Рефреш закріплених версій (`tool-pins-refresh.mjs`)

`scripts/lib/tool-pins.json` не оновлюється сам собою — це навмисно (інакше повернулася б проблема з постійними `latest`-lookup-ами). Рефреш — окрема ручна дія:

```sh
bun npm/scripts/tool-pins-refresh.mjs
```

Скрипт іде по `TOOLS`, для кожного тула резолвить `fetchLatestVersion(entry.github, curl)` (GitHub API з токеном за наявності → redirect-fallback), переписує `tool-pins.json` свіжими версіями і сьогоднішньою `pinnedAt`, друкує diff версій. Коли запускати:

- тест `tool-pins-freshness.test.mjs` червоніє (`checkToolPinsFreshness().stale === true`, пінам > `TOOL_PINS_MAX_AGE_DAYS` днів);
- відома вразливість/баг у закріпленому тулі — рефреш раніше терміну;
- просто хочеться підняти версії тулів на актуальні.

### Гарантії та інваріанти

- **Ідемпотентність:** повторний виклик `ensureTool` повертає шлях за O(1) після першого install — спочатку PATH, потім кеш.
- **Hard-fail:** на будь-яку нерозв’язну помилку install кидається `Error` із описовим повідомленням; немає silent fallback на «обірваний» бінарник.
- **Кросплатформність:** єдиний публічний API для трьох ОС; OS-specific деталі інкапсульовані всередині модуля.
- **Безпека для CI:** `ensureHkInstall` ніколи не змінює git-репозиторій під CI, навіть якщо `hk` доступний.
- **Без `latest`-lookup на звичайному install-шляху:** `installFromGithub` бере версію з закріпленого `tool-pins.json`; `fetchLatestVersion` викликається лише з `tool-pins-refresh.mjs` (ручний рефреш) і тестів — CI-job на порожньому кеші не робить запиту до GitHub API для резолву версії.
