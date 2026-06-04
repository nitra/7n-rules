# active.mjs — Активний Раннер flow-диспетчера

## Огляд

Модуль `active.mjs` реалізує **Активний Раннер** диспетчера потоків (Фасад B, spec §8.1) — повний 5-фазний життєвий цикл автоматизованого виконання задачі в ізольованому git-worktree. Він зшиває чотири підсистеми в одну CLI-команду:

1. `ensureWorktree` — підготовка ізольованого worktree під цільову гілку;
2. `planner.generatePlan` — побудова покрокового плану через LLM-runner;
3. `executor.executePlan` — послідовне виконання кроків з verify/commit;
4. `reviewer.runReview` — gate-перевірки (verify) після кожного кроку.

Усі IO-залежності (`runner`, `verify`, `commit`, `run`, `now`, `log`) **ін'єктуються** через об'єкт `deps`, тож модуль повністю тестується без реальних LLM, git-операцій чи gate-команд. У автономному режимі (`--autonomous`) runner додатково обгортається `withBudget` (§9.4) для жорсткого обмеження API-викликів і вартості.

Експортується чотири CLI-обробники:

- `run` — повний цикл build (ensureWorktree → план → executor);
- `resume` — продовження з чекпойнта зі скиданням часткового доробку (safe-resume, §4.1.7);
- `cancel` — прибирання transient sibling-файлів стану;
- `repair` — діагностика стану або жорстке скидання робочого дерева до HEAD.

Файл стану (`flow.json`), журнал подій (`flow.events.jsonl`) та lock-файли розташовуються поруч із worktree-кореневою текою; шляхи до них формують `flowStatePath` / `flowEventsPath` зі `state-store.mjs` та `events.mjs`.

## Експорти / API

| Експорт | Тип | Призначення |
|---------|-----|-------------|
| `run(rest, deps?)` | `async function` | Команда `flow run` — повний цикл build (планування + виконання). |
| `resume(_rest, deps?)` | `async function` | Команда `flow resume` — продовжити з останнього чекпойнта. |
| `cancel(_rest, deps?)` | `async function` | Команда `flow cancel` — прибрати транзитні sibling-и стану. |
| `repair(rest, deps?)` | `async function` | Команда `flow repair [--discard-step-work]` — fail-closed escape. |

Усі експорти повертають `Promise<number>` — exit code процесу:

- `0` — успіх (`done` або no-op);
- `1` — fail (помилка, нема стану/плану, бюджет вичерпано, стан пошкоджено);
- `2` — `blocked-on-human` (потрібне HITL-втручання).

### Внутрішні (не експортовані) helper-и

| Ім'я | Призначення |
|------|-------------|
| `defaultCommit(cwd, msg)` | Дефолтний commit-стратег: `git add -A && git commit -m <msg>` у worktree. |
| `defaultVerify(cwd)` | Дефолтний verify: проганяє `runReview` з реальним `run` і `fingerprint: () => null`. |
| `readFlowAutonomous(cwd)` | Зчитує секцію `flow.autonomous` з `.n-cursor.json` (бюджет автономки). |

## Функції

### `defaultCommit(cwd, msg)`

**Сигнатура:** `function defaultCommit(cwd: string, msg: string): void`

**Параметри:**
- `cwd` — абсолютний шлях до worktree;
- `msg` — повідомлення коміту.

**Повертає:** `void`.

**Side effects:** виконує два синхронних `spawnSync('git', …)`-виклики у вказаному `cwd`:
1. `git add -A` — індексує всі зміни;
2. `git commit -m <msg>` — створює коміт.

Помилки git **не пробрасуються** — exit code spawnSync ігнорується (виклик «оптимістичний»).

### `defaultVerify(cwd)`

**Сигнатура:** `function defaultVerify(cwd: string): { pass: boolean, failedOutput: string | null }`

**Параметри:**
- `cwd` — корінь worktree, де крутитимуться gate-команди.

**Повертає:** verdict від `runReview` — об'єкт із полями `pass: boolean` та `failedOutput: string | null`.

**Side effects:** делегує `runReview` зі `./reviewer.mjs`, передаючи реальний `run = realRun` (синхронний spawn зі `./commands.mjs`) та `fingerprint: () => null` (порівняння за хешем артефактів вимкнено).

### `readFlowAutonomous(cwd)`

**Сигнатура:** `function readFlowAutonomous(cwd: string): { maxApiCalls?: number, maxCostUsd?: number, onBudgetExceeded?: string }`

**Параметри:**
- `cwd` — корінь проєкту, де лежить `.n-cursor.json`.

**Повертає:** об'єкт із секції `flow.autonomous` конфігу або порожній `{}`, якщо файл відсутній/невалідний.

**Side effects:** **синхронно** читає `<cwd>/.n-cursor.json` через `readFileSync`. Будь-яка помилка (відсутній файл, невалідний JSON) глушиться `try/catch` → повертається `{}`.

### `run(rest, deps?)`

**Сигнатура:**
```
async function run(
  rest: string[],
  deps?: {
    runner?: object,
    verify?: (cwd: string) => { pass: boolean, failedOutput: string | null },
    commit?: (cwd: string, msg: string) => void,
    run?: (cmd: string, args: string[], opts: object) => object,
    autonomous?: boolean,
    budget?: { maxApiCalls?: number, maxCostUsd?: number, onBudgetExceeded?: string },
    cwd?: string,
    log?: (m: string) => void,
    now?: () => number
  }
): Promise<number>
```

**Параметри:**
- `rest` — позиційні аргументи CLI, можуть містити прапор `--autonomous` плюс `<branch> <task...>`;
- `deps` — об'єкт ін'єкцій:
  - `runner` — готовий subagent-runner (інакше створюється через `createRunner(deps)`);
  - `verify` — кастомний verify-callback (дефолт: `defaultVerify`);
  - `commit` — кастомний commit-callback (дефолт: `defaultCommit`);
  - `run` — низькорівневий spawn-аналог (пробрасується далі в `ensureWorktree` / `createRunner`);
  - `autonomous` — примусово вмикає budget guard незалежно від `rest`;
  - `budget` — явний конфіг бюджету (інакше читається з `.n-cursor.json`);
  - `cwd` — корінь проєкту для читання конфігу (дефолт: `process.cwd()`);
  - `log` — логер (дефолт: `console.error`);
  - `now` — постачальник часу (дефолт: `Date.now`).

**Повертає:** `Promise<number>` — exit code:
- `0` — `result.status === 'done'`;
- `1` — `ensureWorktree` повернув ненульовий код, runner не створився, або executor дав помилку / `BudgetExceeded` / інший fail-стан;
- `2` — `result.status === 'blocked-on-human'`.

**Потік:**
1. Підготовка: `log`, `now`, прапор `autonomous` (з `deps.autonomous` або `rest.includes('--autonomous')`), позиційні аргументи (фільтр без `--`-флагів).
2. `ensureWorktree(positional, deps)` → якщо `code !== 0`, повертає цей же код. Інакше отримуємо `{ worktreeDir, branch, desc, baseCommit }`.
3. `writeState(statePath, …)` — ініціальний стан із `status: 'in_progress'`, `started_at` у ISO, `metadata.base_commit`, порожнім `plan`.
4. Створення runner-а: `deps.runner ?? await createRunner(deps)`. Якщо `createRunner` кинув — лог `run: <msg>` і `return 1`.
5. Якщо `autonomous`: `runner = withBudget(runner, { maxApiCalls: budget.maxApiCalls, log })`.
6. **try-блок:**
   - `plan = await generatePlan({ runner, task: desc, cwd: worktreeDir })`;
   - `updateState(statePath, s => ({ ...s, plan }))`;
   - `result = await executePlan({ statePath, eventsPath: flowEventsPath(worktreeDir) }, { runner, verify, commit, cwd: worktreeDir, log, now })`;
   - якщо `result.status === 'done'` — лог `'run: build done — далі \`flow release\`'`, `return 0`;
   - якщо `result.status === 'blocked-on-human'` — лог `run: blocked-on-human на кроці <step>`, `return 2`;
   - інакше `return 1`.
7. **catch:** якщо `error instanceof BudgetExceeded` — лог `run: <msg> — abort`, оновлення стану на `status: 'failed'`, `return 1`. Будь-яка інша помилка — лог і `return 1`.

**Side effects:** створення worktree, запис/оновлення `flow.json`, запис подій у `flow.events.jsonl`, виклики LLM-runner, commit-и в worktree, виконання verify-gate-ів.

### `resume(_rest, deps?)`

**Сигнатура:**
```
async function resume(
  _rest: string[],
  deps?: {
    runner?: object,
    verify?: (cwd: string) => object,
    commit?: (cwd: string, msg: string) => void,
    run?: (cmd: string, args: string[], opts: object) => object,
    cwd?: string,
    log?: (m: string) => void,
    now?: () => number
  }
): Promise<number>
```

**Параметри:** `_rest` ігнорується; `deps` — як у `run`, мінус `autonomous`/`budget`.

**Повертає:** `0` / `1` / `2` — як у `run`.

**Потік (Safe-resume, §4.1.7):**
1. `cwd = deps.cwd ?? process.cwd()`, `log`, `now`, `run_ = deps.run ?? realRun`.
2. `state = readState(flowStatePath(cwd))`. Якщо `state` falsy — лог `'resume: стану нема'`, `return 1`.
3. `openHitl = (state.hitl ?? []).filter(q => !q.answer)`. Якщо `status === 'blocked-on-human'` і `openHitl.length > 0` — лог `resume: ще blocked — N відкритих HITL-питань (заповни answer і повтори)`, `return 2`.
4. Якщо `!state.plan?.length` — лог `'resume: нема плану'`, `return 1`.
5. **Скидання часткового доробку:** `run_('git', ['reset', '--hard', 'HEAD'], { cwd })`.
6. **HITL-злиття:** із відповідей будується `Map<step, answer>`; план переписується так, що **завершені** кроки (`status === 'done'`) не зачіпаються, а **інші** дістають `retry_count: 0` і — якщо є відповідь на цей крок — поле `hint: <answer>`. HITL-питання з відповіддю переводяться у `status: 'answered'`.
7. Створення runner-а: `deps.runner ?? await createRunner(deps)` (на помилку — `return 1`).
8. `executePlan(...)` з тими ж дефолтами verify/commit, що й у `run`.
9. Розбір `result.status`: `done → 0`, `blocked-on-human → 2`, інше → `1`.

**Side effects:** `git reset --hard HEAD` (потенційно деструктивно для незакомічених змін!), мутація `flow.json`, виклики LLM, commit-и, verify.

### `cancel(_rest, deps?)`

**Сигнатура:**
```
async function cancel(
  _rest: string[],
  deps?: { cwd?: string, log?: (m: string) => void }
): Promise<number>
```

**Параметри:** `_rest` ігнорується; `deps.cwd` (дефолт: `process.cwd()`), `deps.log` (дефолт: `console.error`).

**Повертає:** завжди `0`.

**Потік:** виклик `cleanupFlowSiblings(cwd)` (зі `./state-store.mjs`) → лог `'cancel: стан і sibling-и прибрано'` → `return 0`.

**Side effects:** видалення `flow.json`, `flow.events.jsonl`, lock-файлів навколо worktree.

### `repair(rest, deps?)`

**Сигнатура:**
```
async function repair(
  rest: string[],
  deps?: {
    run?: (cmd: string, args: string[], opts: object) => object,
    cwd?: string,
    log?: (m: string) => void
  }
): Promise<number>
```

**Параметри:**
- `rest` — аргументи CLI; перевіряється наявність `--discard-step-work`;
- `deps.run` — низькорівневий spawn (дефолт: `realRun`);
- `deps.cwd` — корінь worktree (дефолт: `process.cwd()`);
- `deps.log` — логер (дефолт: `console.error`).

**Повертає:** `0` — у двох випадках: успішне жорстке скидання або валідне читання стану (включно з «стану нема»); `1` — стан пошкоджено (виняток при `readState`).

**Потік:**
1. Якщо `rest.includes('--discard-step-work')`:
   - `run_('git', ['reset', '--hard', 'HEAD'], { cwd })`;
   - лог `'repair: робоче дерево скинуто до HEAD (--discard-step-work)'`;
   - `return 0`.
2. Інакше try-блок: `state = readState(flowStatePath(cwd))`. Лог `repair: стан валідний (status: <s.status>)` (якщо state truthy) або `'repair: стану нема'` (якщо falsy). `return 0`.
3. На помилку читання — лог `repair: стан пошкоджено — <msg>. Спробуй \`flow repair --discard-step-work\` або \`flow cancel\`.`, `return 1`.

**Side effects:** опціональний `git reset --hard HEAD` (деструктивно), синхронне читання файлу стану.

## Залежності

### Стандартна бібліотека Node.js

- `node:child_process` → `spawnSync` — синхронні git-команди в `defaultCommit`.
- `node:fs` → `readFileSync` — читання `.n-cursor.json` у `readFlowAutonomous`.
- `node:path` → `join` — побудова шляху до конфігу.
- `node:process` → `cwd as processCwd` — дефолтний робочий каталог.

### Внутрішні модулі (relative imports)

- `./budget.mjs` → `BudgetExceeded`, `withBudget` — клас винятка для перевищення бюджету та обгортка runner-а з guard-ом (§9.4).
- `./commands.mjs` → `ensureWorktree`, `realRun` — підготовка worktree та реальний spawn-runner.
- `./events.mjs` → `flowEventsPath` — шлях до журналу подій (`flow.events.jsonl`).
- `./executor.mjs` → `executePlan` — послідовне виконання плану з verify/commit/HITL.
- `./planner.mjs` → `generatePlan` — побудова плану через LLM-runner на основі опису задачі.
- `./reviewer.mjs` → `runReview` — запуск gate-перевірок (verify-callback за замовчуванням).
- `./state-store.mjs` → `cleanupFlowSiblings`, `flowStatePath`, `readState`, `updateState`, `writeState` — IO навколо `flow.json` та sibling-файлів.
- `./subagent-runner.mjs` → `createRunner` — фабрика LLM-runner-а (Claude/інший subagent) з ін'єкцій.

## Потік виконання / Використання

### CLI-команди (диспатчиться зовнішнім роутером)

```
flow run [--autonomous] <branch> "<task...>"
flow resume
flow cancel
flow repair [--discard-step-work]
```

### Сценарій `flow run --autonomous feat/x "Add tests"`

1. **ensureWorktree** створює (або підхоплює) worktree під гілку `feat/x`, повертає `worktreeDir`, базовий комміт, текстовий опис задачі (`desc`).
2. У worktree пишеться початковий `flow.json` зі `status: 'in_progress'`, `started_at`, `metadata.base_commit`, порожнім планом.
3. Створюється `runner` (Claude-subagent). У `--autonomous` режимі він обгортається `withBudget` з `maxApiCalls` з `.n-cursor.json` → `flow.autonomous`.
4. `generatePlan` через LLM-runner будує покроковий план; план зберігається в стані.
5. `executePlan` ітерує план: для кожного кроку викликає runner-а → verify-gate → commit (через `defaultCommit`); події логуються у `flow.events.jsonl`; стан оновлюється.
6. Якщо verify падає, executor може відкрити HITL-питання → стан переходить у `blocked-on-human`, `run` повертає `2`.
7. Якщо `withBudget` вистрелив `BudgetExceeded` — стан стає `failed`, exit `1`.

### Сценарій `flow resume`

Користувач заповнив `answer` у HITL-питаннях `flow.json` і запускає `flow resume`:
1. Зчитується стан, відкриті (без `answer`) HITL → блокує `resume` з кодом `2`.
2. `git reset --hard HEAD` повертає робоче дерево до останнього коміту (відкочуємо частковий доробок невдалого кроку).
3. HITL-відповіді стають полями `hint` для відповідних кроків, `retry_count` обнуляється для незавершених кроків.
4. `executePlan` стартує з того ж списку, але вже з підказками.

### Сценарій `flow cancel`

Прибирання залишків:
- Видаляється `flow.json`, `flow.events.jsonl`, lock-файли — через `cleanupFlowSiblings(cwd)`.
- Worktree як такий **не видаляється** — це окрема відповідальність команд worktree-менеджмента.

### Сценарій `flow repair`

- Без аргументів — діагностика: чи стан читається валідно;
- `--discard-step-work` — жорсткий `git reset --hard HEAD` (свідома втрата незакомічених змін).

### Тестування

Усе IO ін'єктується через `deps`:

```js
import { run } from './active.mjs'

const fakeRunner = { /* mock */ }
const code = await run(['feat/x', 'task'], {
  runner: fakeRunner,
  verify: () => ({ pass: true, failedOutput: null }),
  commit: () => {},
  run: () => ({ status: 0, stdout: '', stderr: '' }),
  cwd: '/tmp/proj',
  log: () => {},
  now: () => 0
})
```

Це дозволяє тестам не торкатись реальних `git`, LLM чи gate-команд — лише перевіряти контракт переходів стану, exit-коди й послідовність викликів.

## Rebuild Test

Цей розділ верифікує, що документація відтворює поведінку файлу без звертання до самого `active.mjs`:

1. Чотири експорти модуля: `run`, `resume`, `cancel`, `repair` — усі `async`, усі повертають exit code (`0`/`1`/`2`).
2. У `run` спочатку викликається `ensureWorktree(positional, deps)`; якщо його `code !== 0`, цей самий код повертається без подальших дій.
3. Прапор `--autonomous` визначається як `deps.autonomous ?? rest.includes('--autonomous')`; у позиційні аргументи `--`-флаги **не** потрапляють (фільтруються).
4. Конфіг бюджету в `--autonomous` режимі береться з `deps.budget` або з `.n-cursor.json` → `flow.autonomous` (порожній `{}` при будь-якій помилці читання).
5. Початковий стан у `run` має поля `branch`, `status: 'in_progress'`, `started_at` (ISO від `now()`), `metadata.base_commit`, `plan: []`.
6. Помилка створення runner-а в `run`/`resume` → лог із префіксом `run:` / `resume:` і `return 1`.
7. У try-блоці `run` спочатку `generatePlan`, потім `updateState` з планом, потім `executePlan`; усі три отримують `runner` та `worktreeDir`.
8. Розбір `result.status` у `run` і `resume`: `done → 0`, `blocked-on-human → 2`, інше → `1`.
9. `BudgetExceeded` у `run`: лог `<msg> — abort`, `updateState(... status: 'failed')`, `return 1`.
10. `resume` блокує (exit `2`), якщо стан `blocked-on-human` і є HITL без `answer`.
11. `resume` робить `git reset --hard HEAD` **перед** запуском runner-а — для скидання часткового доробку.
12. У `resume` HITL-відповіді перетворюються на `hint` тільки для **незавершених** кроків; завершені (`status === 'done'`) не чіпаються.
13. HITL-питання з `answer` отримують `status: 'answered'` у новому стані.
14. `cancel` завжди повертає `0`; викликає `cleanupFlowSiblings(cwd)` і логує `'cancel: стан і sibling-и прибрано'`.
15. `repair --discard-step-work` робить `git reset --hard HEAD` і повертає `0`.
16. `repair` без аргументів: успішно зчитує стан (або `null`) → `0`; помилка читання → лог із префіксом `repair: стан пошкоджено —` та посиланням на `flow repair --discard-step-work` / `flow cancel`, `return 1`.
17. `defaultCommit` робить два `spawnSync('git', …)` у `cwd`: `add -A`, потім `commit -m <msg>`.
18. `defaultVerify` делегує `runReview({ run: realRun, cwd, fingerprint: () => null })`.
19. Усі логери дефолтяться на `console.error`; усі джерела часу — на `Date.now`; усі `cwd` — на `process.cwd()`.
20. Лог-повідомлення мають детерміновані префікси: `run:`, `resume:`, `cancel:`, `repair:` — це публічний контракт CLI-виводу для тестів і користувача.
