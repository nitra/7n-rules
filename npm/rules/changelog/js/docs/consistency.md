# consistency.mjs

## Огляд

Модуль `consistency.mjs` реалізує перевірку правила `n-changelog` для монорепозиторіїв із кількома воркспейсами (npm та Python). Його завдання — гарантувати, що **будь-яка реліз-релевантна зміна у воркспейсі супроводжується change-файлом** (`<ws>/.changes/*.md`), а поле `version` у маніфесті воркспейсу не зміщене ручним bump-ом поза CI.

Ключові інваріанти, що їх стверджує перевірка:

- `version` не повинен дрейфувати відносно бази (опублікованої у реєстрі версії або версії в git-базі гілки). Будь-який ручний bump — **fail**, навіть якщо присутній change-файл.
- Bump `version` і генерацію `CHANGELOG.md` виконує **виключно** `n-cursor release` у CI на гілці `main`.
- Релевантні зміни без change-файлу — **fail**; зміни лише в інверсних шляхах (`docs/`, `doc/`, `.cursor/`, `.claude/`) — змінами не вважаються.
- npm-пакети, що публікують `CHANGELOG.md` разом із пакетом, повинні мати рядок `"CHANGELOG.md"` у масиві `files` маніфесту, але це перевіряється лише за наявності pending change-файлів.

Передбачено дві моделі визначення бази на рівні воркспейсу:

1. **registry-published** — npm-пакети з `name` і `files`, не `private`; Python-проєкти зі статичною `project.version` і `project.name`. База — версія, опублікована в npm-реєстрі або PyPI.
2. **local-only** — приватні npm без `files`, Python без імені/версії для реєстру. База визначається через git:
   - feature-гілка → `merge-base` з `dev`, інакше з `main`;
   - гілка `main` → diff від `origin/main` (або `HEAD~1` без remote);
   - гілка `dev` → перевірка пропускається (крім незакомічених registry-published).

Усі виклики `git` і зовнішні HTTP/CLI — через `execFile` / `fetch`, без shell-інтерполяції (безпека, виключає command injection).

## Експорти / API

| Експорт | Тип | Призначення |
|---------|-----|-------------|
| `check(opts?)` | `async function` | Єдина публічна точка входу. Запускає весь цикл перевірок для всіх воркспейсів монорепо і повертає exit-код. |

Сигнатура `check`:

```js
export async function check(opts = {}): Promise<number>
```

`opts`:

- `opts.getPublishedVersion?: (name: string, kind?: 'npm' | 'python') => Promise<string | null>` — перевизначення стандартного резолвера опублікованої версії (для юніт-тестів, оффлайн-режимів).
- `opts.cwd?: string` — корінь репозиторію; за замовчуванням `process.cwd()`.

Повертає **exit-код** (0 — pass, ≠ 0 — fail), отриманий від `createCheckReporter()`.

## Функції

### `gitOrNull(args, cwd)`

- **Сигнатура:** `async (args: string[], cwd: string) => Promise<string | null>`
- **Параметри:** `args` — аргументи `git`; `cwd` — робочий каталог процесу.
- **Повертає:** `stdout` команди або `null` при будь-якій помилці.
- **Side effects:** виконує дочірній процес `git` через `execFile`.

Тиха обгортка над `git`, що ковтає виключення — використовується скрізь, де відсутність гілки/ref/маніфесту є штатним кейсом.

### `isInsideGitRepo(cwd)`

- **Сигнатура:** `async (cwd: string) => Promise<boolean>`
- **Повертає:** `true`, якщо `cwd` всередині git working tree.
- **Side effects:** запит `git rev-parse --is-inside-work-tree`.

### `currentBranchName(cwd)`

- **Сигнатура:** `async (cwd: string) => Promise<string | null>`
- **Повертає:** ім'я поточної гілки (`git rev-parse --abbrev-ref HEAD`) або `null`.

### `baseRefLabel(ref)`

- **Сигнатура:** `(ref: string) => string`
- **Параметри:** `ref` — git-ref.
- **Повертає:** човничок без префіксу `origin/` (наприклад, `origin/main` → `main`); інакше повертає `ref` без змін.
- **Side effects:** немає.

### `isGitAncestor(ancestor, descendant, cwd)`

- **Сигнатура:** `async (ancestor: string, descendant: string, cwd: string) => Promise<boolean>`
- **Повертає:** `true`, якщо `ancestor` є предком `descendant` (через `git merge-base --is-ancestor`).
- **Зауваження:** `git merge-base --is-ancestor` повертає exit-код, тому всередині використовується `gitOrNull`, який ловить ненульовий exit і повертає `null` — у такому випадку результат функції `false`.

### `resolveBranchRef(branchName, cwd)`

- **Сигнатура:** `async (branchName: string, cwd: string) => Promise<string | null>`
- **Поведінка:** для `branchName` пробує спочатку локальний ref, потім `origin/<branchName>`; повертає перший, що верифікується через `git rev-parse --verify --quiet`.

### `isChangelogIgnoredPath(relPath)`

- **Сигнатура:** `(relPath: string) => boolean`
- **Поведінка:** нормалізує шлях до posix (заміна `\` на `/`, обрізання провідного `./`), повертає `true`, якщо починається з одного з префіксів `CHANGELOG_IGNORE_PATH_PREFIXES`.

### `isPathGitIgnored(relPath, cwd)`

- **Сигнатура:** `async (relPath: string, cwd: string) => Promise<boolean>`
- **Поведінка:** виконує `git check-ignore -q -- <relPath>`. Exit-код 0 → ignored (повертає `true`); будь-яка помилка → `false`.
- **Side effects:** дочірній процес `git`.

### `resolveMergeBase(baseRef, cwd)`

- **Сигнатура:** `async (baseRef: string, cwd: string) => Promise<string | null>`
- **Повертає:** SHA `git merge-base baseRef HEAD` або `null`.

### `resolveChangelogComparisonPoint(branch, cwd)`

- **Сигнатура:** `async (branch: string | null, cwd: string) => Promise<{ ref: string, label: string } | null>`
- **Логіка:**
  - якщо `branch === 'dev'` → `null` (local-only пропускається);
  - якщо `branch === 'main'`:
    - якщо `origin/main` верифіковано і `origin/main === HEAD` або `origin/main` — предок `HEAD` → `{ ref: 'origin/main', label: 'main' }`;
    - інакше `HEAD~1` → `{ ref: <sha>, label: 'main~1' }`;
    - якщо ні те, ні те — `null`.
  - feature-гілки: ітерує по `FEATURE_BASE_BRANCH_CANDIDATES` (`['dev', 'main']`); перший, для якого вдається резолвити ref **і** обчислити merge-base, дає `{ ref: <merge-base SHA>, label: baseRefLabel(...) }`.
- **Повертає:** опис точки порівняння (`ref` для `git diff`/`git show`, `label` для повідомлень) або `null`.

### `pathspecForWorkspace(ws, subWorkspaces)`

- **Сигнатура:** `(ws: string, subWorkspaces: string[]) => string[]`
- **Поведінка:**
  - для `ws !== '.'` → `[\`${ws}/\`]`;
  - для `ws === '.'` (корінь монорепо) → `['.', ':(exclude)<sub>/' для кожного підворкспейсу]`, щоб залишити лише файли кореня без вкладених воркспейсів.
- **Повертає:** масив pathspec-ів для передачі в `git diff -- <pathspec>`.

### `splitNulPaths(nulSeparated)`

- **Сигнатура:** `(nulSeparated: string | null) => string[]`
- **Поведінка:** ділить вхідний рядок по `\0`, відкидає порожні елементи.
- **Чому `-z`:** без прапорця git застосовує `core.quotePath` і повертає не-ASCII імена (наприклад, кирилицю) у C-quoted формі (`"docs/\320\262..."`), що ламає префіксне порівняння для `CHANGELOG_IGNORE_PATH_PREFIXES`.

### `listChangedPathsAgainstBase(baseRef, pathspec, cwd)`

- **Сигнатура:** `async (baseRef: string, pathspec: string[], cwd: string) => Promise<string[]>`
- **Поведінка:** об'єднує два джерела через `Set`:
  - `git diff --name-only -z <baseRef> -- <pathspec>` — закомічені/staged зміни;
  - `git ls-files --others --exclude-standard -z -- <pathspec>` — нові untracked-файли.
- **Повертає:** дедуплікований масив відносних шляхів.

### `workspaceHasRelevantChangesAgainstBase(baseRef, ws, subWorkspaces, cwd)`

- **Сигнатура:** `async (baseRef: string, ws: string, subWorkspaces: string[], cwd: string) => Promise<boolean>`
- **Поведінка:** обчислює pathspec для `ws`, отримує всі змінені шляхи, ітерує по них:
  - інверсія (`docs/`, `.cursor/`, ...) → пропустити;
  - `git check-ignore` → пропустити;
  - інакше — повернути `true`.
- **Повертає:** `true`, якщо є хоч один шлях, що вважається релевантною змінною.

### `readBaseVersion(baseRef, manifest, cwd)`

- **Сигнатура:** `async (baseRef: string, manifest: PackageManifest, cwd: string) => Promise<string | null>`
- **Поведінка:** виконує `git show <baseRef>:<wsPath>`, де `wsPath` — шлях до маніфесту відносно репозиторію; парсить:
  - `npm` → `JSON.parse(...).version` (`null` при помилці парсу);
  - `python` → `parsePyprojectFields(out).version`.
- **Повертає:** версію з маніфесту на `baseRef` або `null`.

### `defaultGetPublishedNpmVersion(name)`

- **Сигнатура:** `async (name: string) => Promise<string | null>`
- **Поведінка:** `npm view <name> version` із таймаутом `REGISTRY_TIMEOUT_MS` (10 с). Trim і повернення; пуста відповідь / помилка → `null`.
- **Side effects:** дочірній процес `npm`, мережа.

### `defaultGetPublishedPyPiVersion(name)`

- **Сигнатура:** `async (name: string) => Promise<string | null>`
- **Поведінка:** `fetch('https://pypi.org/pypi/<encodedName>/json', { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) })`; читає `data.info.version`. Будь-яка помилка / `!res.ok` → `null`.
- **Side effects:** мережа.

### `resolvePublishedVersion(manifest, getPublishedVersion)`

- **Сигнатура:** `(manifest: PackageManifest, getPublishedVersion) => Promise<string | null>`
- **Поведінка:** якщо в маніфесті немає `name` → `Promise.resolve(null)`; інакше делегує до `getPublishedVersion(name, kind)`.

### `defaultGetPublishedVersion(name, kind = 'npm')`

- **Сигнатура:** `(name: string, kind?: 'npm' | 'python') => Promise<string | null>`
- **Поведінка:** диспетчер за `kind` (Python → PyPI, інакше — npm).

### `createDefaultGetPublishedVersion()`

- **Сигнатура:** `() => (name, kind?) => Promise<string | null>`
- **Поведінка:** фабрика, що повертає `defaultGetPublishedVersion`. Використовується як дефолт у `check` для зручної підміни в тестах.

### `checkNpmFilesArrayContainsChangelog(manifest, pass, fail)`

- **Сигнатура:** `(manifest: PackageManifest, pass: (msg)=>void, fail: (msg)=>void) => void`
- **Поведінка:**
  - якщо `kind !== 'npm'` або `npmFiles` відсутній — рання терміновка;
  - `pass`, якщо `npmFiles` містить `'CHANGELOG.md'`;
  - інакше `fail` з рекомендацією додати рядок.

### `workspaceLabel(manifest)`

- **Сигнатура:** `(manifest: PackageManifest) => string`
- **Повертає:** `'<root>'` для `ws === '.'`, інакше `manifest.ws`.

### `missingChangeFileMessage(label, mf)`

- **Сигнатура:** `(label: string, mf: string) => string`
- **Повертає:** уніфікований текст для `fail` про відсутній change-файл, включно з інструкцією для `npx @nitra/cursor change`.

### `hasPendingChangeFiles(ws, cwd)`

- **Сигнатура:** `async (ws: string, cwd: string) => Promise<boolean>`
- **Поведінка:** `(await readChangeFiles(ws, cwd)).length > 0`.

### `checkPublishedWorkspacePendingGitChanges(manifest, _Vcurrent, subWorkspaces, pass, fail, cwd)`

- **Сигнатура:** `async (...) => Promise<void>`
- **Параметр `_Vcurrent`:** ігнорується (залишений для сумісності сигнатури; bump робить CI).
- **Поведінка:**
  1. Якщо `hasPendingChangeFiles` → `pass` про change-файл(и) + перевірка `CHANGELOG.md` у `files` npm-маніфесту. Вихід.
  2. Якщо не в git-репі — вихід без перевірок.
  3. Беремо `currentBranchName`:
     - `branch === 'dev'`: лише перевірка наявності релевантних змін відносно `HEAD` (staged/working tree). Є — `fail` `missingChangeFileMessage`; нема — мовчазний вихід.
     - інакше: резолвимо `comparison`; якщо `comparison` + є зміни відносно `comparison.ref` → `fail`.
     - на `main` додатково перевіряємо ще й `HEAD` (working/staged) — `fail`, якщо є зміни.

### `checkPublishedWorkspace(manifest, subWorkspaces, getPublishedVersion, pass, fail, cwd)`

- **Сигнатура:** `async (...) => Promise<void>`
- **Поведінка:**
  1. `manifest.version` відсутній → `fail` («у маніфесті відсутнє поле version»). Вихід.
  2. `manifest.name` відсутній → `fail` («відсутнє ім'я пакета»). Вихід.
  3. `Vpublished = resolvePublishedVersion(...)`; якщо `null` → `pass` («опублікована версія недоступна, перевірку пропущено»). Вихід.
  4. Якщо `Vpublished !== Vcurrent` → `fail` про drift (ручний bump заборонено — навіть із change-файлом). Вихід.
  5. Інакше `pass` про збіг із реєстром і виклик `checkPublishedWorkspacePendingGitChanges`.

### `checkLocalOnlyChangedWorkspace(comparisonRef, manifest, baseLabel, pass, fail, cwd)`

- **Сигнатура:** `async (...) => Promise<void>`
- **Поведінка** (виконується для воркспейсів, де `workspaceHasRelevantChangesAgainstBase` дала `true`):
  1. `Vbase = readBaseVersion(comparisonRef, manifest, cwd)`.
  2. Якщо `Vbase && Vcurrent && Vbase !== Vcurrent` → `fail` про drift (`Vbase → Vcurrent`). Вихід.
  3. Якщо `hasPendingChangeFiles` → `pass`. Вихід.
  4. Інакше `fail` `missingChangeFileMessage`.
- Drift-перевірка йде **перед** перевіркою наявності change-файлу: симетрія з registry-published-шляхом (ручний bump заборонено навіть із change-файлом).

### `runLocalOnlyChecks(localOnly, subWorkspaces, pass, fail, cwd)`

- **Сигнатура:** `async (localOnly: PackageManifest[], subWorkspaces: string[], pass, fail, cwd) => Promise<void>`
- **Поведінка:**
  1. Якщо `localOnly` пустий → ранній вихід.
  2. Не git-репозиторій → `pass` про пропуск.
  3. `branch === 'dev'` → `pass` про пропуск.
  4. `comparison` не знайдено (немає `dev`/`main`/`origin/*`) → `pass` про пропуск.
  5. Для кожного `manifest` із `localOnly`: пропустити, якщо немає релевантних змін відносно `comparison.ref`; інакше виставити `checkedAny = true` і викликати `checkLocalOnlyChangedWorkspace`.
  6. Якщо жоден воркспейс не змінено — `pass` («local-only воркспейси без змін відносно `<label>`»).

### `check(opts)`

- **Сигнатура:** `async (opts?: { getPublishedVersion?, cwd? }) => Promise<number>`
- **Покрокове виконання:**
  1. Створюється `reporter = createCheckReporter()`; беруться його `pass` і `fail`.
  2. `getPublishedVersion` — з `opts` або `createDefaultGetPublishedVersion()`.
  3. `cwd` — з `opts` або `process.cwd()`.
  4. `workspaces = await getMonorepoProjectRootDirs(cwd)`; `subWorkspaces = workspaces.filter(w => w !== '.')`.
  5. `isMonorepoRoot = subWorkspaces.length > 0` — корінь монорепо вважається glue/конфіг/tooling.
  6. Розділяємо воркспейси на `published` та `localOnly`:
     - корінь `.` за наявності підпакетів → одразу `pass` про пропуск, не читаємо маніфест;
     - `readPackageManifest(ws, cwd)` → якщо `null`, ws пропускається;
     - `manifest.registryPublishable === true` → у `published`, інакше — у `localOnly`.
  7. Послідовно перевіряємо всі `published` через `checkPublishedWorkspace`.
  8. `runLocalOnlyChecks(localOnly, ...)`.
  9. Повертаємо `reporter.getExitCode()`.

## Залежності

### Стандартна бібліотека Node.js

- `node:child_process` → `execFile` — запуск `git`, `npm` без shell-інтерполяції.
- `node:util` → `promisify` — обгортка `execFileAsync = promisify(execFile)`.
- Глобальні: `fetch`, `AbortSignal.timeout` — для PyPI (Node ≥ 18).

### Внутрішні модулі

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — створює пару `{ pass, fail }` і обчислює `getExitCode()`.
- `../lib/package-manifest.mjs`:
  - `getMonorepoProjectRootDirs(cwd)` — список воркспейсів (включно з `.`);
  - `manifestFilePath(ws, manifest)` — шлях до маніфесту в повідомленнях;
  - `parsePyprojectFields(text)` — отримання `{ name, version }` із `pyproject.toml`;
  - `readPackageManifest(ws, cwd)` — нормалізований опис воркспейсу (тип `PackageManifest`).
- `../../release/lib/change-file.mjs` → `readChangeFiles(ws, cwd)` — список pending change-файлів у `<ws>/.changes/`.

### Зовнішні системи / процеси

- `git` (CLI) — `rev-parse`, `merge-base`, `diff`, `ls-files`, `show`, `check-ignore`.
- `npm` (CLI) — `npm view <name> version` для registry-published npm-пакетів.
- PyPI HTTP API — `https://pypi.org/pypi/<name>/json` для Python-пакетів.

### Константи модуля

- `FEATURE_BASE_BRANCH_CANDIDATES = Object.freeze(['dev', 'main'])` — порядок пошуку бази для feature-гілок.
- `LOCAL_ONLY_SKIP_BRANCH = 'dev'` — гілка, де local-only перевірка не активна.
- `CHANGELOG_IGNORE_PATH_PREFIXES = Object.freeze(['docs/', 'doc/', '.cursor/', '.claude/'])` — інверсні префікси (зміни в них не релевантні).
- `REGISTRY_TIMEOUT_MS = 10_000` — таймаут для `npm view` / PyPI fetch.
- `LEADING_DOTSLASH_RE = /^\.\//` — для нормалізації шляхів у `isChangelogIgnoredPath`.

## Потік виконання / Використання

Типовий виклик (із CLI/скрипту):

```js
import { check } from './consistency.mjs'

const exitCode = await check()
process.exit(exitCode)
```

Із кастомним резолвером опублікованої версії (наприклад, у тестах):

```js
import { check } from './consistency.mjs'

const exitCode = await check({
  cwd: '/tmp/sandbox-repo',
  async getPublishedVersion(name, kind) {
    if (name === '@scope/pkg-a') return '1.0.0'
    return null
  }
})
```

### Високорівневий потік `check`

```
check(opts)
 ├─ createCheckReporter() → { pass, fail, getExitCode }
 ├─ getMonorepoProjectRootDirs(cwd) → workspaces
 ├─ subWorkspaces = workspaces \ ['.']
 ├─ isMonorepoRoot = subWorkspaces.length > 0
 ├─ For each ws:
 │    ├─ ws === '.' && isMonorepoRoot → pass (root skipped) ; continue
 │    ├─ manifest = readPackageManifest(ws, cwd)
 │    ├─ !manifest → continue
 │    └─ manifest.registryPublishable ? published.push : localOnly.push
 ├─ For each published manifest:
 │    └─ checkPublishedWorkspace(...)
 │         ├─ no version → fail
 │         ├─ no name → fail
 │         ├─ Vpublished == null → pass (skipped)
 │         ├─ drift → fail
 │         └─ checkPublishedWorkspacePendingGitChanges(...)
 │              ├─ hasPendingChangeFiles → pass + checkNpmFilesArrayContainsChangelog
 │              ├─ branch dev → fail iff relevant changes vs HEAD
 │              ├─ comparison ref + relevant changes → fail
 │              └─ main + relevant changes vs HEAD → fail
 ├─ runLocalOnlyChecks(localOnly, ...)
 │    ├─ not git → pass (skipped)
 │    ├─ branch dev → pass (skipped)
 │    ├─ no comparison → pass (skipped)
 │    └─ for each localOnly with relevant changes:
 │         └─ checkLocalOnlyChangedWorkspace(...)
 │              ├─ Vbase != Vcurrent → fail (drift)
 │              ├─ hasPendingChangeFiles → pass
 │              └─ else fail (missing change file)
 └─ return reporter.getExitCode()
```

### Контракти / гарантії

- **Безпека:** жодних викликів `exec` / `spawn` із інтерполяцією рядків — лише `execFile` із масивом аргументів.
- **Idempotency:** функція виконує лише читання (git/fs/network); не змінює нічого на диску.
- **Деградація:** мережеві / репо-помилки — м'які (повертають `null`); їх результат — `pass` про пропуск, а не `fail`. Виняток: реальні відмінності, які можна спостерігати локально (drift, відсутність change-файлу), завжди дають `fail`.
- **Симетрія шляхів:** registry-published і local-only обидва ставлять drift-перевірку **перед** перевіркою change-файлу, тому ручний bump поза CI стабільно falsies перевірку незалежно від моделі.

### Точки розширення

- `opts.getPublishedVersion` — підміна джерела опублікованих версій (стаб для офлайн-тестів або проксі-реєстру).
- `opts.cwd` — переключення активного репозиторію без `process.chdir`.

## Rebuild Test

Контрольний перелік для відтворення/верифікації поведінки:

1. **Експорт API** — модуль експортує єдину `async function check(opts?)`, що повертає `Promise<number>`.
2. **Дефолти** — `opts.cwd` за замовчуванням `process.cwd()`; `opts.getPublishedVersion` за замовчуванням `defaultGetPublishedVersion` (npm-view для `kind === 'npm'`, PyPI fetch для `kind === 'python'`).
3. **Корінь монорепо** — для `ws === '.'` за наявності підворкспейсів виставляється `pass` про пропуск без читання маніфесту.
4. **Класифікація** — `manifest.registryPublishable === true` → `published`; інакше → `localOnly`. Воркспейси без читабельного маніфесту мовчки пропускаються.
5. **Drift > change-файл** — для обох моделей перевірка drift `version` спрацьовує **раніше** за перевірку наявності change-файлу і `fail` має пріоритет.
6. **Гілка `dev`** — `runLocalOnlyChecks` повністю пропускає local-only (`pass`); registry-published у `checkPublishedWorkspacePendingGitChanges` на `dev` перевіряє лише робоче дерево/staged відносно `HEAD`.
7. **Гілка `main`** — точка порівняння: `origin/main`, якщо це предок `HEAD` або збігається; інакше `HEAD~1`; також додаткова перевірка `HEAD` (working/staged), щоб виявити незакомічені зміни.
8. **Feature-гілка** — точка порівняння визначається ітерацією по `['dev', 'main']`, береться merge-base першої доступної бази; `label` приводиться до короткої форми (`origin/main` → `main`).
9. **Інверсні шляхи** — `docs/`, `doc/`, `.cursor/`, `.claude/` (із normalize `\` → `/` і обрізанням `./`) не вважаються релевантними змінами.
10. **`git -z`** — у `git diff --name-only` та `git ls-files --others` обов'язково використовується `-z`, інакше не-ASCII імена потраплять у C-quoted формі й ламатимуть префіксне порівняння.
11. **Untracked + tracked** — `listChangedPathsAgainstBase` об'єднує `git diff` (відносно `baseRef`) і `git ls-files --others --exclude-standard`, дедуплікація через `Set`.
12. **gitignored** — кожен кандидат додатково перевіряється через `git check-ignore -q --`; ігноровані пропускаються.
13. **`checkNpmFilesArrayContainsChangelog`** — викликається лише в гілці «pending change-файли є» для registry-published; для не-npm або відсутнього `npmFiles` — раннє return без `pass`/`fail`.
14. **Мовчазний skip** — недоступність опублікованої версії (мережа/реєстр) даює `pass` про пропуск, а не `fail`.
15. **`workspaceLabel`** — `'<root>'` для `.`, інакше шлях ws.
16. **`missingChangeFileMessage`** — текст fail містить шлях до маніфесту, інструкцію `npx @nitra/cursor change --bump … --section … --message …` і нагадування «bump зробить CI на main (n-changelog.mdc)».
17. **Послідовність публічних перевірок** — спершу всі `published` (у порядку, повернутому з `getMonorepoProjectRootDirs`), потім `runLocalOnlyChecks`.
18. **Exit-код** — повертається з `reporter.getExitCode()` (агрегує всі `pass`/`fail`).
