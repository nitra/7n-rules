# commands.mjs

## Огляд

Модуль `commands.mjs` реалізує handler-и підкоманд CLI `n-cursor flow` згідно зі специфікацією §8 (Пасивний Турнікет / Flow). Він є диспетчерською точкою для Фази Ф2 робочого потоку — підкоманд `init`, `verify` та `release`, — а також надає допоміжні утиліти: реальний sync-runner `realRun`, гарантію наявності worktree `ensureWorktree` та інференс воркспейсу за зміненими файлами `matchChangedWorkspaces`.

Усі побічні ефекти (виконання процесів, логування, обчислення fingerprint, час) реалізовані як ін'єктовані залежності в `deps`, тож логіку модуля можна тестувати без реальних `git`, `npx` чи годинника. Це частина архітектури «командна логіка + чистий ядро». Підкоманди `run` / `resume` / `cancel` / `repair` зі специфікації належать Фазі Ф4 і в цьому файлі ще не реалізовані.

Модуль є ESM (`.mjs`), використовує імпорти Node.js (`node:child_process`, `node:path`, `node:process`) і не має станового глобалу — стан тримається у JSON-файлах `.flow.json` (через `state-store.mjs`).

## Експорти / API

| Експорт                                               | Тип              | Призначення                                                                                                                 |
| ----------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `realRun(cmd, args, opts?)`                           | `function`       | Реальний sync-обгортка над `spawnSync` із захопленням stdout/stderr.                                                        |
| `ensureWorktree(rest, deps?)`                         | `function`       | Парсить аргументи `<branch> "<опис>"`, гарантує worktree (детектить існуючу ізоляцію або створює новий), повертає метадані. |
| `init(rest, deps?)`                                   | `async function` | Handler `flow init`: ізоляція + первинна ініціалізація `.flow.json`.                                                        |
| `verify(_rest, deps?)`                                | `async function` | Handler `flow verify`: Quality Gates («Суддя») у поточному worktree з толерантністю до відсутності стану.                   |
| `matchChangedWorkspaces(subWorkspaces, changedFiles)` | `function`       | Чистий хелпер: підмножина воркспейсів, у яких є зміни (з прив'язкою до найглибшого збігу).                                  |
| `release(rest, deps?)`                                | `async function` | Handler `flow release`: генерує `.changes` через `n-cursor change` і пише completion snapshot.                              |

Усі async handler-и повертають Promise<number> — exit code (0 — ок, 1 — помилка). Решта — синхронні.

## Функції

### `realRun(cmd, args, opts = {})`

- Сигнатура: `(cmd: string, args: string[], opts?: object) => { status: number, stdout: string, stderr: string }`.
- Параметри:
  - `cmd` — назва/шлях виконуваного файлу.
  - `args` — масив аргументів.
  - `opts` — додаткові опції для `spawnSync` (наприклад, `cwd`). Завжди примусово `encoding: 'utf8'`.
- Повертає об'єкт із полями `status` (1, якщо `spawnSync` повернув `null` через сигнал/помилку запуску), `stdout`, `stderr`.
- Side effects: синхронно стартує процес ОС.

### `inLinkedWorktree(run, cwd)` (внутрішня)

- Сигнатура: `(run, cwd: string) => boolean`.
- Логіка: викликає `git rev-parse --git-dir`, `--git-common-dir`, `--show-superproject-working-tree`. Worktree вважається «лінкованим», якщо обидва git-dir команди повернули код 0, це **не** submodule, і `git-dir !== git-common-dir`.
- Повертає `true`, якщо процес виконується всередині linked worktree (не основного checkout і не submodule). Це дозволяє `ensureWorktree` не створювати вкладений worktree.
- Side effects: три `git rev-parse` через переданий `run`.

### `ensureWorktree(rest, deps = {})`

- Сигнатура: `(rest: string[], deps?) => { code: number, worktreeDir?: string, branch?: string, desc?: string, baseCommit?: string | null }`.
- Параметри:
  - `rest` — `[branch, ...descWords]`. Опис склеюється пробілом, `trim`-иться.
  - `deps.run` — runner (default `realRun`).
  - `deps.cwd` — стартовий каталог (default `process.cwd()`).
  - `deps.log` — функція логування (default `console.error`).
- Поведінка:
  1. Якщо `branch` або `desc` порожні — логує usage і повертає `{ code: 1 }`.
  2. Якщо вже в linked worktree — використовує поточний `cwd` як `worktreeDir`, логує підказку.
  3. Інакше — викликає `npx @nitra/cursor worktree add <branch> <desc>`; на помилку повертає `{ code: 1 }` із поясненням зі `stderr`.
  4. Дізнається `HEAD` у `worktreeDir`. Якщо `git rev-parse HEAD` успішний — це `baseCommit`, інакше `null`.
- Side effects: можливе створення worktree через зовнішній CLI, git-виклики.

### `init(rest, deps = {})`

- Сигнатура: `(rest: string[], deps?) => Promise<number>`.
- Параметри:
  - `rest` — `[branch, ...descWords]`.
  - `deps.now` — джерело часу (default `Date.now`); решта успадковуються `ensureWorktree`.
- Кроки:
  1. Делегує `ensureWorktree`; ранній exit при `code !== 0`.
  2. Шлях стану: `flowStatePath(worktreeDir)` (з `state-store.mjs`).
  3. Визначає `level` та `risk` через `detectLevel(desc)` / `detectRisk(desc)` (з `level.mjs`).
  4. Через `writeState` записує початковий запис: `branch`, `status: 'in_progress'`, `started_at` (ISO від `now()`), `metadata.base_commit`, `level`, `risk`, порожній `plan: []`.
  5. Логує підсумок і повертає `0`.
- Side effects: створення/перезапис `.flow.json`.

### `verify(_rest, deps = {})`

- Сигнатура: `(_rest: string[], deps?) => Promise<number>`. `_rest` не використовується.
- Параметри `deps`:
  - `run`, `cwd`, `log` (стандартні).
  - `branch` — опціональний явний фільтр для резолва активного flow.
  - `fingerprint` — фабрика fingerprint-функції; default — `worktreeFingerprint` із `cwd`-залежним sync-runner-ом.
- Кроки:
  1. `resolveActiveFlowState({ cwd, branch }, deps)` — cwd-незалежний пошук активного `.flow.json`. Якщо знайшли autoResolved — логує лейбл.
  2. Якщо `branch` явно задано і не резолвиться — це помилка наміру: повертає `1` із поясненням (інакше `flow verify --branch typo` міг би «зеленіти» в CI).
  3. Робочий `cwd` для gate-ів: `resolved.worktreeDir ?? cwd0`.
  4. Читає стан; якщо нема (відсутній/пошкоджений `.flow.json`) — verify лишається толерантним: гейти прогоняються standalone, без запису стану. Логує warn із описом причини.
  5. Якщо стан є, але `plan` порожній — лише warning (м'які ворота).
  6. Викликає `runReview({ run, cwd, fingerprint })` (з `reviewer.mjs`). Отримує `{ pass, gates, fingerprint, failedOutput }`.
  7. Для кожного gate логує `✅`/`❌`. На фейл — `failedOutput`.
  8. Якщо стан був — `recordTransition` записує подію `{ type: 'verify', pass }` і оновлює `gates`, `fingerprint`, `status` (`failed` при провалі, інакше зберігає попередній).
  9. Повертає `0` / `1` залежно від `verdict.pass`.
- Side effects: gate-команди (lint/test/тощо) у `cwd`, лог-вивід, можливі `.flow.json` + події.

### `matchChangedWorkspaces(subWorkspaces, changedFiles)`

- Сигнатура: `(subWorkspaces: string[], changedFiles: string[]) => string[]`.
- Параметри:
  - `subWorkspaces` — теки воркспейсів **без** кореня (`.`).
  - `changedFiles` — змінені шляхи відносно кореня репозиторію у posix-форматі.
- Логіка: сортує воркспейси за довжиною (спадно), для кожного зміненого файла знаходить **найглибший** збіг (`f === w || f.startsWith(w + '/')`). Таке правило усуває хибне `«кілька воркспейсів»` для випадку, коли `apps` і `apps/web` обидва зареєстровані, а файл `apps/web/x` має належати лише найглибшому.
- Повертає підмножину `subWorkspaces` (у вхідному порядку), які отримали хоч один хіт.
- Side effects: немає (чиста функція).

### `resolveChangeWsArgs({ rest, baseCommit, cwd, listWorkspaces, changedFilesSince, log })` (внутрішня)

- Сигнатура: `(input) => Promise<{ args: string[], error?: boolean }>`.
- Призначення: добудовує `--ws <шлях>` до аргументів `change`, якщо користувач не задав явно.
- Кроки:
  1. Якщо `rest` уже містить `--ws` або `--ws=...` — повертає `rest` без змін (поважає явний намір).
  2. `listWorkspaces(cwd)` → масив. Відсіює корінь (`.`); якщо subworkspace-ів нема — `change` дефолтиться на `.`, лишаємо як є.
  3. `hits = matchChangedWorkspaces(subWs, changedFilesSince(baseCommit, cwd))`.
  4. `hits.length > 1` → fail-hard: `{ args: rest, error: true }`, лог із переліком.
  5. `hits.length === 1` → додає `--ws <hits[0]>` і логує інференс.
  6. `hits.length === 0` → лишає `rest`.
  7. У будь-якому виключенні від `listWorkspaces` / `changedFilesSince` — fail-soft: лог warning, повертає `rest`.
- Side effects: `git diff`-подібні виклики через `changedFilesSince`, виклик `listWorkspaces`, логування.

### `release(rest, deps = {})`

- Сигнатура: `(rest: string[], deps?) => Promise<number>`.
- Параметри `deps`:
  - `run`, `cwd`, `log`, `now` — стандартні.
  - `branch` — опціональний фільтр активного flow.
  - `listWorkspaces` — default `getMonorepoProjectRootDirs` (з `rules/changelog/lib/package-manifest.mjs`).
  - `changedFilesSince` — default `collectChangedFilesSince`.
- Кроки:
  1. `resolveActiveFlowState({ cwd, branch }, deps)`. Якщо `statePath` не знайдено — `release` падає (`code 1`) із поясненням (це обов'язкова прив'язка).
  2. `effectiveCwd = resolved.worktreeDir ?? cwd`.
  3. `readState(statePath)`. Якщо стану нема — `release: стану нема — спершу 'flow init'`, `1`.
  4. Якщо `state.gate?.verdict === 'FAIL'` — лише warning (м'які ворота, рішення за людиною).
  5. `resolveChangeWsArgs(...)`. Якщо повернув `error: true` (кілька воркспейсів) — exit `1`.
  6. Викликає `npx @nitra/cursor change <args>` у `effectiveCwd`. Помилка → exit `1` із поясненням зі stderr.
  7. `buildCompletionSnapshot({ ...state, status: 'done' }, now)` — снапшот завершення.
  8. `recordTransition` записує подію `{ type: 'release' }`, оновлює стан: `status: 'done'`, `completion: snapshot`.
  9. Якщо в стані вказано `state.task` (шлях task-record) — пише summary у task через `writeSummaryToTaskRecord` (з абсолютизацією через `join(effectiveCwd, …)`, якщо шлях відносний).
  10. Логує `release: done`, повертає `0`.
- Side effects: `npx … change`, запис у `.flow.json`, можливий запис у task-record, події.

## Залежності

### Імпорти Node-стандарту

- `node:child_process` → `spawnSync` (для `realRun` і дефолтного `fingerprint`).
- `node:path` → `isAbsolute`, `join` (для шляху task-record у `release`).
- `node:process` → `cwd as processCwd` (default `cwd`).

### Внутрішні модулі проєкту

- `../../lib/worktree.mjs` → `worktreePaths` — резолв шляху checkout після `worktree add`.
- `../../lib/changed-files.mjs` → `collectChangedFilesSince` — default для `changedFilesSince` у `release`.
- `../../utils/worktree-fingerprint.mjs` → `worktreeFingerprint` — default для `verify`.
- `../../../rules/changelog/lib/package-manifest.mjs` → `getMonorepoProjectRootDirs` — default для `listWorkspaces`.
- `./events.mjs` → `flowEventsPath` — шлях файла подій flow.
- `./level.mjs` → `detectLevel`, `detectRisk` — класифікація задачі на основі опису.
- `./reviewer.mjs` → `runReview` — Quality Gates («Суддя»).
- `./snapshot.mjs` → `buildCompletionSnapshot`, `writeSummaryToTaskRecord` — completion-снапшот для `release`.
- `./state-store.mjs` → `flowStatePath`, `readState`, `recordTransition`, `writeState` — персистенція `.flow.json` + події.
- `./flow-resolve.mjs` → `resolveActiveFlowState` — cwd-незалежний резолв активного flow.

### Зовнішні CLI (через `run`)

- `npx @nitra/cursor worktree add <branch> <desc>` — створення worktree (`ensureWorktree`).
- `npx @nitra/cursor change <args>` — генерація `.changes` (`release`).
- `git rev-parse --git-dir|--git-common-dir|--show-superproject-working-tree|HEAD` — детекція worktree та base-коміт.

## Потік виконання / Використання

### Типовий happy-path Ф2

1. `n-cursor flow init feature/x "опис задачі"` → `init`:
   - `ensureWorktree` створює (або підхоплює) worktree.
   - `detectLevel` / `detectRisk` класифікують задачу.
   - Створюється `.flow.json` зі `status: 'in_progress'`, фіксується `base_commit`.
2. Робота над кодом всередині worktree.
3. `n-cursor flow verify` → `verify`:
   - Резолвиться активний flow (cwd-незалежно).
   - `runReview` прогоняє gate-и (lint, тести, тощо).
   - Стан оновлюється: `gates`, `fingerprint`. На фейл — `status: 'failed'`.
4. `n-cursor flow release --bump minor --section feat --message "…"` → `release`:
   - Резолв активного flow (обов'язковий).
   - Інференс `--ws` із diff від `base_commit` (якщо не задано явно).
   - `npx @nitra/cursor change …` пише `.changes`.
   - `buildCompletionSnapshot` + `recordTransition` фіксують `status: 'done'`.
   - Якщо є `state.task` — summary йде у task-record.

### Точки розширення (через `deps`)

- Юніт-тести підставляють фейкові `run`, `log`, `now`, `fingerprint`, `listWorkspaces`, `changedFilesSince`, `branch`, `cwd`.
- Це дозволяє покрити edge-кейси: відсутній стан, кілька воркспейсів у diff, помилки `npx`, артефакти `git rev-parse`.

### Контракти CLI

- `init` / `release` потребують `<branch> "<опис>"` (init) та активного flow + опційних `--bump|--section|--message|--ws` (release).
- `verify` — без обов'язкових аргументів; толерантний до відсутності стану (запуск standalone у поточному `cwd`).
- `--branch <name>` як `deps.branch` дозволяє адресувати конкретний flow (CI/довільний `cwd`).

### Інваріанти

- Усі handler-и **не змінюють код** проєкту (`verify` read-only, `release` лише пише `.changes` / `.flow.json` / task-summary).
- Worktree-вкладеність заборонена: `ensureWorktree` детектить, що `cwd` уже linked worktree, і повторно `worktree add` не викликає.
- М'які ворота: і відсутність `plan`, і `gate.verdict === 'FAIL'` дають лише warning, рішення про реліз — за людиною.
- Fail-hard у `release`: відсутність активного flow та неоднозначний воркспейс (multi-hit `matchChangedWorkspaces`).

## Rebuild Test

Маючи цю документацію, інженер може відтворити публічний контракт модуля без читання вихідного коду:

- Знає список і сигнатури експортованих функцій (`realRun`, `ensureWorktree`, `init`, `verify`, `matchChangedWorkspaces`, `release`) та їхні exit code.
- Розуміє роль `deps` як набору ін'єкцій (`run`, `cwd`, `log`, `now`, `fingerprint`, `branch`, `listWorkspaces`, `changedFilesSince`).
- Може повторити доменну поведінку: детекцію linked worktree, інференс `--ws` (single/multi/empty/explicit), толерантність `verify` до відсутнього стану, fail-hard `release`, м'які ворота на `plan`/`gate.verdict`.
- Знає форму `.flow.json` (поля `branch`, `status`, `started_at`, `metadata.base_commit`, `level`, `risk`, `plan`, `gates`, `fingerprint`, `completion`, `task`) і які підкоманди їх записують.
- Бачить зовнішні CLI/git-залежності та внутрішні модулі, від яких залежить логіка.
- Розуміє, які підкоманди (`run`/`resume`/`cancel`/`repair`) ще не реалізовані тут (Ф4).
