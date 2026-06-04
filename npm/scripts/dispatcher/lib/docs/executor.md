# executor.mjs

## Огляд

Модуль `executor.mjs` — це **Фаза 3 (Ф3) диспетчера** з flow-специфікації: він покроково виконує план, що раніше зібрав `planner`, і просуває стан через журнал подій. Відповідно до спеки (§3 Ф3), кожен крок плану надсилається в субагент через **мікропромпт зі стану** — субагент бачить лише поточний крок, критерії приймання й, опційно, останню помилку (без історії переписки чи історії інших кроків).

Базові інваріанти, які реалізовано в коді:

- **Мікропромпт зі стану** (§3 Ф3): субагент отримує тільки поточний крок + критерії + останню помилку, а не повний контекст ланцюга кроків.
- **Commit лише після зеленого `verify`** (§4.1.7): жоден repair-прохід не комітиться, тому `HEAD` git-репозиторію завжди вказує на останній «зелений» крок плану.
- **Repair обмежений `maxRepairAttempts`** (за замовчуванням 3): коли спроби вичерпано, виконання переходить у режим `blocked-on-human` (HITL, §4.2) і записує питання в `state.hitl`.

Усі побічні дії (запуск субагента, верифікація, commit, годинник) **інжектуються** через об’єкт `deps`. Це робить модуль повністю детермінованим і тестованим: реальний LLM, git і ворота (gates) не викликаються з нього напряму.

## Експорти / API

Модуль експортує три функції (ESM, named exports):

| Експорт         | Тип        | Призначення                                                                                                                                |
|-----------------|------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| `microprompt`   | `function` | Чиста функція побудови тексту мікропромпта для конкретного кроку плану.                                                                    |
| `patchStep`     | `function` | Чиста функція, що повертає новий обʼєкт стану з оновленим кроком за індексом (immutable update).                                            |
| `executePlan`   | `async`    | Головна функція: читає стан, ітерує план, дергає `runner`/`verify`/`commit`, записує транзиції стану та повертає підсумковий статус.       |

Default-експорту немає.

## Функції

### `microprompt(step, state)`

**Сигнатура:**

```js
function microprompt(step, state) → string
```

**Параметри:**

- `step` — обʼєкт поточного кроку плану. Очікувані поля:
  - `step` (`number`) — номер кроку (для людини).
  - `task` (`string`) — формулювання задачі кроку.
  - `acceptance` (`string`, опційно) — критерії приймання.
  - `hint` (`string`, опційно) — підказка від людини (HITL).
  - `last_error` (`string`, опційно) — останній текст помилки `verify` для repair-спроби.
- `state` — поточний стан flow. Використовується лише поле `state.branch` для рядка «Гілка: …» (якщо немає — підставляється `'—'`).

**Повертає:** рядок-промпт, який скріплює кілька рядків через `\n`:

1. Заклик зробити **рівно** один крок плану з нагадуванням про Iron Law of TDD (спершу падаючі тести, тоді код).
2. `Гілка: <state.branch ?? '—'>`.
3. `Крок <step.step>: <step.task>`.
4. (Якщо є `acceptance`) `Критерії приймання: …`.
5. (Якщо є `hint`) `Підказка людини (HITL): …`.
6. (Якщо є `last_error`) `Попередня спроба впала на перевірці:\n<last_error>\nВиправ це.`.

**Side effects:** немає — це чиста функція форматування.

### `patchStep(state, index, patch)`

**Сигнатура:**

```js
function patchStep(state, index, patch) → newState
```

**Параметри:**

- `state` — обʼєкт стану з масивом `state.plan` (`object[]`).
- `index` (`number`) — індекс кроку в `state.plan`, який треба оновити.
- `patch` (`object`) — поля, які треба змерджити в крок (`{ ...step, ...patch }`).

**Повертає:** новий обʼєкт стану `{ ...state, plan: [...] }`, де крок під `index` замінено на `{ ...step, ...patch }`, інші кроки залишаються тими самими посиланнями.

**Side effects:** немає — immutable update через `Array.prototype.map`.

### `executePlan(paths, deps)`

**Сигнатура:**

```js
async function executePlan(paths, deps) → Promise<{ status: 'done' | 'blocked-on-human', step?: number }>
```

**Параметри:**

- `paths` — обʼєкт зі шляхами до файлів стану й журналу подій:
  - `paths.statePath` — шлях до файлу стану, що читається `readState`.
  - `paths.eventsPath` — шлях до журналу подій (передається далі в `recordTransition`).
- `deps` — обʼєкт ін’єкцій:
  - `runner` (обовʼязково) — обʼєкт із методом `runStep(prompt, opts?)`. Викликається з мікропромптом і `{ cwd }`.
  - `verify` (обовʼязково) — `(cwd) → { pass: boolean, failedOutput?: string }` або проміс такого ж обʼєкта. Поле `pass` визначає, чи крок зелений; `failedOutput` йде у `last_error`.
  - `commit` (обовʼязково) — `(cwd, msg) → void`. Викликається **лише** після зеленого `verify`, з повідомленням `flow: step <N> — <task>`.
  - `cwd` (опційно) — робочий каталог, який передається `runner` і `verify`/`commit`.
  - `maxRepairAttempts` (`number`, за замовчуванням `3`) — максимальна кількість repair-спроб на крок (перша спроба теж рахується в `retry_count`).
  - `log` (`(msg) => void`, за замовчуванням `() => {}`) — лоґер прогресу.
  - `now` (`() => number`, за замовчуванням `Date.now`) — джерело часу для `recordTransition`.

**Повертає:**

- `{ status: 'done' }` — якщо всі кроки плану позначено `done`, фінальна транзиція `plan_done` піднімає `state.status = 'built'`.
- `{ status: 'blocked-on-human', step: <N> }` — якщо на якомусь кроці вичерпано `maxRepairAttempts`. Тоді у стан додано HITL-питання й виставлено `state.status = 'blocked-on-human'`.

**Кидає:** `Error('executor: у стані немає плану — спершу planner')` — якщо `readState` повертає порожній обʼєкт або `plan` відсутній/порожній.

**Side effects:**

- Читає файл стану через `readState(paths.statePath)`.
- Записує транзиції в журнал/стан через `recordTransition(paths, event, reducer, now)` для подій: `step_done`, `step_retry`, `blocked`, `plan_done`.
- Викликає `runner.runStep(...)` — потенційний LLM/субагент-виклик.
- Викликає `verify(cwd)` — потенційний запуск тестів/гейтів.
- Викликає `commit(cwd, msg)` — git-commit; **тільки** при зеленому `verify`.
- Записує повідомлення через `log(...)`.

## Залежності

### Внутрішні модулі (імпорти)

- `./state-store.mjs`:
  - `readState(statePath)` — синхронне читання обʼєкта стану з диска.
  - `recordTransition(paths, event, reducer, now)` — атомарне оновлення стану й запис події в `events`-журнал; повертає новий стан.

### Інжектовані залежності (через `deps`)

- `runner.runStep` — реалізація запуску субагента (наприклад, `subagent-runner.mjs`).
- `verify` — функція верифікації (наприклад, обгортка над тест-командою/ворітьми).
- `commit` — функція git-комміту.
- `log`, `now` — необовʼязкові утиліти.

### Зовнішні залежності

Стандартних модулів Node.js немає у файлі напряму — увесь I/O делеговано в `state-store.mjs` та інжектовані залежності.

## Потік виконання / Використання

### Алгоритм `executePlan`

1. **Деструктуризація `deps`** з дефолтами: `maxRepairAttempts = 3`, `log = noop`, `now = Date.now`.
2. **Зчитування стану**: `state = readState(paths.statePath)`. Якщо `state?.plan` відсутній або порожній — кидається помилка `executor: у стані немає плану — спершу planner`.
3. **Ітерація плану** циклом `for (let i = 0; i < state.plan.length; i++)`:
   - Якщо крок уже `status === 'done'` — пропустити (resume-friendly).
   - Інакше зайти у внутрішній `while`-цикл, поки `retry_count < maxRepairAttempts` і `done === false`:
     1. Зчитати свіжий `step = state.plan[i]`.
     2. Залогувати: `executor: крок N (спроба M)`, де `M = retry_count + 1`.
     3. `await runner.runStep(microprompt(step, state), { cwd })` — виконати крок субагентом з мікропромптом.
     4. `verdict = await verify(cwd)` — перевірити результат.
     5. **Якщо `verdict.pass === true`:**
        - `commit(cwd, "flow: step <step.step> — <step.task>")`.
        - `recordTransition(paths, { type: 'step_done', step }, s => patchStep(s, i, { status: 'done' }), now)`.
        - `done = true`, вихід з `while`.
     6. **Інакше (red):**
        - `recordTransition` із подією `step_retry`, що інкрементує `retry_count` і кладе `last_error: verdict.failedOutput ?? null`.
        - `while` повторює спробу (наступна ітерація прочитає вже оновлений `state.plan[i]`).
4. **Якщо `while` вийшов з `done === false`** (тобто всі спроби спалено):
   - Будується HITL-питання `{ id: 'q-<i>', step, question: '…не проходить verify після N спроб…', status: 'open', answer: '' }`.
   - `recordTransition` із подією `blocked`, що ставить `state.status = 'blocked-on-human'` і додає питання в `state.hitl`.
   - Повертається `{ status: 'blocked-on-human', step: failed.step }` — подальші кроки не запускаються.
5. **Після успішного проходу всіх кроків** записується фінальна транзиція `plan_done`, що піднімає `state.status = 'built'`, і функція повертає `{ status: 'done' }`.

### Інваріанти, які тримає алгоритм

- **HEAD git завжди зелений**: `commit` викликається тільки в гілці `verdict.pass === true`. Жодна repair-спроба не записується в git.
- **Стан eventsourcing-friendly**: усі зміни плану й верхнього статусу йдуть через `recordTransition`, тож у журналі подій лежить повна історія `step_done` / `step_retry` / `blocked` / `plan_done`.
- **Resume-семантика**: при повторному виклику `executePlan` уже виконані кроки (`status === 'done'`) пропускаються; кроки з частковим `retry_count` продовжаться з того ж лічильника, але вже без обнулення (поки лічильник менший за `maxRepairAttempts`).
- **Мінімальний контекст субагента**: усе, що знає субагент про задачу — це повернений `microprompt(step, state)`; жодного «склейного» історичного контексту в нього не передається.

### Приклад використання

```js
import { executePlan } from './executor.mjs'

const result = await executePlan(
  { statePath: '.flow/state.json', eventsPath: '.flow/events.jsonl' },
  {
    runner: subagentRunner,                // { runStep(prompt, { cwd }) }
    verify: async (cwd) => runGates(cwd),  // { pass, failedOutput }
    commit: (cwd, msg) => gitCommit(cwd, msg),
    cwd: process.cwd(),
    maxRepairAttempts: 3,
    log: (m) => console.error(m)
  }
)

if (result.status === 'blocked-on-human') {
  // потрібна відповідь людини у state.hitl[] для кроку result.step
}
```

### Інтеграція в диспетчер

`executor.mjs` — третя фаза (Ф3) flow-диспетчера, що йде після `planner.mjs` (який наповнює `state.plan`) і працює зі сховищем стану `state-store.mjs`. Цей файл не знає про конкретні CLI-команди диспетчера — він викликається з `commands.mjs`/`active.mjs` або тестів, де користувач підставляє реальні реалізації `runner`, `verify`, `commit`.