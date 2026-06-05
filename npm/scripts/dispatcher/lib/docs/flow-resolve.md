# flow-resolve.mjs

## Огляд

Модуль `flow-resolve.mjs` реалізує **cwd-незалежний резолвер активного flow** для команд `spec`, `plan`, `verify`, `review`, `gate`, `release` (беклог адаптації #1).

Призначення: знайти файл стану `*.flow.json` поточної задачі навіть тоді, коли команду запущено **не** з кореня worktree (наприклад, з кореня головного дерева репозиторію або з вкладеної підтеки worktree). Інакше функція `flowStatePath(cwd)` обчислила б хибний шлях і команда повідомила б «стану нема», хоча flow реально активний.

Порядок резолвингу (відповідно до spec `2026-06-01-flow-cwd-state-resolution`):

1. Якщо передано явний `branch` — формуємо шлях `<repoRoot>/.worktrees/<sanitizeBranch(branch)>.flow.json` і перевіряємо існування теки worktree.
2. Швидкий шлях: якщо `cwd` сам уже є текою worktree і поряд лежить файл стану — беремо його (без виклику git).
3. Toplevel-резолвинг: `git rev-parse --show-toplevel` від `cwd`; якщо toplevel розташований **безпосередньо** під `<repoRoot>/.worktrees/` і для нього існує стан — повертаємо його. Якщо стану нема — це проблема саме цього worktree, чужий активний flow **не** підтягуємо.
4. Скан: якщо `cwd` поза будь-яким worktree (наприклад, головне дерево) — перебираємо `<repoRoot>/.worktrees/*.flow.json`, шукаючи статуси `in_progress`. Якщо рівно один — авторезолв; якщо кілька — помилка зі списком; якщо нуль — «стану нема».

Резолвер **не пише** на диск і **не модифікує** стан. Усі залежності (`git`, FS-операції, `readState`) ін'єктуються через параметр `deps`, тож логіку можна тестувати без реального git-репозиторію.

## Експорти / API

| Експорт                                  | Тип             | Призначення                                               |
| ---------------------------------------- | --------------- | --------------------------------------------------------- |
| `resolveActiveFlowState(params?, deps?)` | named function  | Основна функція-резолвер; повертає об'єкт `ResolvedFlow`. |
| `ResolvedFlow`                           | JSDoc-`typedef` | Тип-опис форми результату резолвингу.                     |

Внутрішні (не експортуються) допоміжні функції: `realGit`, `mainRepoRoot`, `currentToplevel`, `notFound`.

### Тип `ResolvedFlow`

JSDoc-`typedef`, що описує форму результату:

| Поле           | Тип              | Семантика                                                                                                     |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `statePath`    | `string \| null` | Абсолютний шлях до `.flow.json` або `null`, якщо стан не знайдено.                                            |
| `worktreeDir`  | `string \| null` | Тека worktree (ефективний `cwd` для гейтів) або `null`.                                                       |
| `label`        | `string \| null` | Мітка flow (sanitized branch) або `null`.                                                                     |
| `autoResolved` | `boolean`        | `true`, якщо стан знайдено скануванням (тобто `cwd` був поза worktree, а активний flow знайшовся однозначно). |
| `error`        | `string \| null` | Повідомлення для логу, якщо `statePath === null`; інакше `null`.                                              |

### Константа `FLOW_STATE_SUFFIX`

Внутрішня (не експортована) константа: `'.flow.json'`. Використовується для фільтрації імен файлів у теці `.worktrees/` під час скану та для обрізання суфікса при формуванні `label`.

## Функції

### `realGit(args, cwd)`

Сигнатура: `function realGit(args: string[], cwd: string): { status: number, stdout: string }`

Параметри:

- `args` — масив аргументів для бінарника `git` (наприклад, `['worktree', 'list', '--porcelain']`);
- `cwd` — робочий каталог, у якому запустити `git`.

Повертає об'єкт `{ status, stdout }`:

- `status` — exit-код процесу `git`; якщо `spawnSync` повернув `null` — підставляється `1`;
- `stdout` — захоплений stdout у кодуванні `utf8`; якщо `null` — порожній рядок.

Side effects: синхронний запуск дочірнього процесу `git` через `spawnSync`. Це **єдина** функція в модулі, що звертається до зовнішнього процесу; усе інше — чистий FS/обчислення. Використовується як **дефолтний** git-runner: при кожному виклику резолвера для конкретного `cwd` створюється стрілкова замикальна функція `args => realGit(args, cwd)`, якщо `deps.git` не передано.

### `mainRepoRoot(git)`

Сигнатура: `function mainRepoRoot(git: (args: string[]) => { status: number, stdout: string }): string | null`

Параметри:

- `git` — git-runner (для тестів — мок; у проді — обгортка над `realGit`).

Повертає абсолютний шлях кореня **головного** worktree репозиторію або `null`, якщо неможливо встановити (git недоступний, не репо тощо).

Алгоритм:

1. Виконати `git worktree list --porcelain`.
2. Якщо `status !== 0` — повернути `null`.
3. У stdout знайти **перший** рядок, що починається з `worktree ` (це і є головне дерево за конвенцією porcelain-формату).
4. Зрізати префікс `worktree ` і пробіли; якщо рядок непорожній — повернути; інакше `null`.

Side effects: один git-виклик через переданий runner.

### `currentToplevel(git)`

Сигнатура: `function currentToplevel(git: (args: string[]) => { status: number, stdout: string }): string | null`

Параметри:

- `git` — git-runner.

Повертає абсолютний шлях `toplevel`-теки для **поточного** worktree (`git rev-parse --show-toplevel`) або `null`, якщо команда впала або stdout порожній.

Side effects: один git-виклик через переданий runner.

### `resolveActiveFlowState(params?, deps?)`

Сигнатура:

```
export function resolveActiveFlowState(
  params?: { cwd?: string, branch?: string },
  deps?: {
    git?: (args: string[]) => { status: number, stdout: string },
    exists?: (p: string) => boolean,
    readState?: (p: string) => object | null,
    readdir?: (d: string) => string[],
    repoRoot?: string,
  },
): ResolvedFlow
```

Параметри:

- `params.cwd` — робочий каталог, від якого вести резолвинг. За замовчуванням — результат `process.cwd()` (через `cwd as processCwd` з `node:process`).
- `params.branch` — явна гілка, для якої треба знайти стан. Якщо задана, активний flow в інших worktree **ігнорується** — використовується «фіксований» режим.
- `deps.git` — кастомний git-runner; за замовчуванням — `args => realGit(args, cwd)` (замикає `cwd` із `params`).
- `deps.exists` — кастомна реалізація `existsSync`; за замовчуванням — `existsSync` з `node:fs`.
- `deps.readState` — кастомний читач стану; за замовчуванням — `readState`, реекспортований із `./state-store.mjs` як `defaultReadState`.
- `deps.readdir` — кастомне читання каталогу; за замовчуванням — функція, що повертає `readdirSync(d)` якщо тека існує, інакше `[]` (захист від ENOENT, коли `.worktrees/` ще не створено).
- `deps.repoRoot` — наперед обчислений корінь репозиторію; якщо передано — обхід git для пошуку кореня пропускається.

Повертає об'єкт `ResolvedFlow` (див. вище).

Алгоритм (по гілках):

1. **Локальний `resolveRoot()`** — стрілкова функція, що повертає `deps.repoRoot` або викликає `mainRepoRoot(git)`. Викликається лазиво — лише там, де потрібен корінь.

2. **Гілка 1: явний `branch`.**
   - Отримати `repoRoot` через `resolveRoot()`. Якщо `null` — повернути `notFound('стану нема — спершу `flow init`')`.
   - `label = sanitizeBranch(branch)` (нормалізація імені гілки для імені файлу стану).
   - `worktreeDir = worktreePaths(repoRoot, branch).checkout` — фізична тека worktree.
   - Якщо `worktreeDir` **не** існує (`!exists(worktreeDir)`) — повернути `notFound` із повідомленням, що worktree для цієї гілки не знайдено (з підказкою перевірити назву або виконати `flow init`). Це захищає від ENOENT при подальших гейтах.
   - Інакше повернути `{ statePath: flowStatePath(worktreeDir), worktreeDir, label, autoResolved: false, error: null }`.

3. **Гілка 2: швидкий шлях без git.**
   - Обчислити `direct = flowStatePath(cwd)`.
   - Якщо файл існує — повернути `{ statePath: direct, worktreeDir: cwd, label: basename(cwd), autoResolved: false, error: null }`. Це типовий випадок: користувач у корені свого worktree.

4. **Потрібен `repoRoot` через git** (`resolveRoot()`). Якщо `null` — повернути `notFound('стану нема — спершу `flow init`')`. Це безпечна деградація: якщо git недоступний, не лазимо далі.

5. Обчислити `worktreesDir = join(repoRoot, '.worktrees')`.

6. **Гілка 3: toplevel-резолвинг.**
   - `top = currentToplevel(git)`.
   - Якщо `top` визначено **і** `dirname(top) === worktreesDir` (тобто toplevel лежить безпосередньо під `<repoRoot>/.worktrees/`) — ми всередині worktree (можливо, з вкладеної підтеки):
     - `statePath = flowStatePath(top)`.
     - Якщо `exists(statePath)` — повернути `{ statePath, worktreeDir: top, label: basename(top), autoResolved: false, error: null }`.
     - Інакше — `notFound('стану нема — спершу `flow init`')`. **Чужий** активний flow тут **не** підтягуємо: це проблема саме цього worktree.

7. **Гілка 4: скан активних flow** (виконується, якщо `top` неможливо отримати або `dirname(top) !== worktreesDir`, тобто `cwd` поза будь-яким worktree — наприклад, у головному дереві).
   - `active = []`.
   - Для кожного `name` із `readdir(worktreesDir)`:
     - Якщо ім'я не закінчується на `FLOW_STATE_SUFFIX` (`.flow.json`) — пропустити.
     - Сформувати `statePath = join(worktreesDir, name)`.
     - Спробувати `state = readState(statePath)`; будь-яка помилка (`catch`) — пропустити елемент (пошкоджений стан не валить скан).
     - Якщо `state?.status === 'in_progress'`:
       - `label = name.slice(0, -FLOW_STATE_SUFFIX.length)` — обрізати суфікс `.flow.json`.
       - `worktreeDir = join(worktreesDir, label)`.
       - Додати `{ statePath, worktreeDir, label }` у `active`.
   - Якщо `active.length === 1` — повернути `{ ...active[0], autoResolved: true, error: null }`.
   - Якщо `active.length > 1` — повернути `notFound` із форматованим списком: «кілька активних flow — уточни `--branch <гілка>` або `cd` у потрібний worktree:\n - <label1>\n - <label2>...».
   - Інакше — `notFound('стану нема — спершу `flow init`')`.

Side effects: тільки **читання** — `git`, `existsSync`, `readdirSync`, `readState`. Жодних записів на диск.

### `notFound(error)`

Сигнатура: `function notFound(error: string): ResolvedFlow`

Параметри:

- `error` — текст повідомлення для логу.

Повертає об'єкт-«заглушку» з усіма полями стану, виставленими в `null`/`false`, і заданим `error`:

```
{ statePath: null, worktreeDir: null, label: null, autoResolved: false, error }
```

Side effects: немає (чиста функція).

## Залежності

### Стандартна бібліотека Node.js

- `node:fs` — `existsSync`, `readdirSync` (дефолтні реалізації `exists`/`readdir`).
- `node:child_process` — `spawnSync` (запуск `git`).
- `node:path` — `basename`, `dirname`, `join` (формування та аналіз шляхів).
- `node:process` — `cwd as processCwd` (дефолт для `params.cwd`).

### Внутрішні модулі

- `../../lib/worktree.mjs` — імпортуються:
  - `sanitizeBranch(branch)` — нормалізація імені гілки → ім'я-мітка файлу стану;
  - `worktreePaths(repoRoot, branch)` — повертає об'єкт із полем `checkout` (фізична тека worktree).
- `./state-store.mjs` — імпортуються:
  - `flowStatePath(worktreeDir)` — формує шлях файлу стану для заданої теки worktree;
  - `readState as defaultReadState` — функція читання + парсингу JSON-стану; під час скану викликається у `try/catch`, тож може кидати помилку.

### Зовнішні процеси

- `git` (через `spawnSync`):
  - `git worktree list --porcelain` — для знаходження кореня головного worktree;
  - `git rev-parse --show-toplevel` — для визначення поточного worktree.

## Потік виконання / Використання

### Сценарій 1 — запуск із кореня worktree

```
cwd = /repo/.worktrees/feat-foo
```

1. `branch` не передано → Гілка 1 пропускається.
2. `direct = flowStatePath('/repo/.worktrees/feat-foo')` існує → **повертається одразу** без виклику git. Це найшвидший і найчастіший випадок.

### Сценарій 2 — запуск із підтеки worktree

```
cwd = /repo/.worktrees/feat-foo/src/lib
```

1. Гілка 1 — ні.
2. Гілка 2 — `direct` не існує (бо `cwd` не корінь worktree).
3. Через `mainRepoRoot(git)` отримуємо `/repo`; `worktreesDir = /repo/.worktrees`.
4. `currentToplevel(git)` → `/repo/.worktrees/feat-foo`; `dirname === /repo/.worktrees` ✓ → повертаємо стан саме цього worktree.

### Сценарій 3 — запуск із головного дерева (поза worktree)

```
cwd = /repo
```

1. Гілка 1 — ні.
2. Гілка 2 — `flowStatePath('/repo')` не існує.
3. `mainRepoRoot` → `/repo`; `worktreesDir = /repo/.worktrees`.
4. `currentToplevel` → `/repo`; `dirname('/repo') !== '/repo/.worktrees'` → переходимо до скану.
5. Скан `.worktrees/*.flow.json`:
   - 1 із `status: in_progress` → `autoResolved: true`, повертається.
   - 2+ → помилка зі списком кандидатів та пропозицією `--branch` або `cd`.
   - 0 → `notFound('стану нема — спершу `flow init`')`.

### Сценарій 4 — явний `--branch`

```
params = { branch: 'feat-foo' }
```

1. `repoRoot` отриманий → перевіряється існування фізичної теки worktree `feat-foo`.
2. Якщо тека існує — повертається стан (навіть якщо файлу стану ще нема — це **очікуваний** шлях, користувач обере цю гілку).
3. Якщо теки нема — `notFound` з підказкою перевірити назву / зробити `flow init`.

### Сценарій 5 — git недоступний

- Якщо `mainRepoRoot` повертає `null` (наприклад, бінарника git нема або це не репо) і прямий шлях через `cwd` теж не спрацював — повертаємо `notFound('стану нема — спершу `flow init`')`. Жодних падінь.

### Контракт виклику з боку команд

Команди `spec/plan/verify/review/gate/release` мають викликати `resolveActiveFlowState(...)` **на самому старті**, потім:

- Якщо `result.statePath === null` — вивести `result.error` і завершитися ненульовим кодом.
- Інакше використовувати:
  - `result.statePath` — для читання/запису файлу стану через `state-store.mjs`;
  - `result.worktreeDir` — як **ефективний** `cwd` для виконання гейтів (linter, tests, scripts) у потрібному worktree;
  - `result.label` — для логів/повідомлень;
  - `result.autoResolved` — щоб показати користувачу, що flow знайдено скануванням (корисно для UX: «авторезолв на гілку X»).

### Тестування

Усі зовнішні залежності (`git`, `exists`, `readState`, `readdir`, `repoRoot`) ін'єктуються через параметр `deps`. Це дає змогу повністю покрити функцію unit-тестами без реального git-репозиторію та без створення файлів на диску — достатньо передати моки, що повертають фіктивні `status`/`stdout`/булеві значення.
