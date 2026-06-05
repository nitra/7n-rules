# `gate.mjs` — реалізація команди `flow gate`

## Огляд

Модуль реалізує підкоманду `flow gate` диспатчера — структурований вердикт релізної готовності у стилі BMAD `qa-gate`, адаптованого до внутрішнього флоу проєкту. Скрипт **синтезує** два джерела сигналів, що накопичуються у файлі стану флоу (`.flow.json`):

1. Механічні гейти, які заповнює крок `verify` (`state.gates` — масив `{ name, ok }`).
2. Adversarial-зауваження, які залишає крок `review` (`state.review.findings` — масив об'єктів із полем `severity`).

На виході формується єдиний вердикт `PASS | CONCERNS | FAIL`, числовий `score` у діапазоні `0..100` та список людиночитаних причин. Командa `gate` **не приймає рішень** за `verify` чи `review`, а лише агрегує їх — це забезпечує traceability «чому готово / не готово».

Архітектурно модуль складається з двох частин:

- `computeGate(state)` — **чиста** функція, повністю детермінована від вхідного стану, не торкається диска й часу. Призначена для unit-тестів без I/O-моків.
- `gate(_rest, deps)` — async-обгортка, що читає стан з диска, викликає `computeGate`, фіксує результат як подію в `events.jsonl` і повертає exit-код для CLI. Усі залежності IO (`cwd`, `log`, `now`) ін'єктуються через `deps`, що робить функцію тестопридатною.

## Експорти / API

| Експорт       | Тип              | Призначення                             |
| ------------- | ---------------- | --------------------------------------- |
| `computeGate` | `function`       | Чистий синтез вердикту з об'єкта стану. |
| `gate`        | `async function` | CLI-handler підкоманди `flow gate`.     |

Модуль не має default-експорту. Внутрішня константа `PENALTY` (штрафи score) **не експортується** і є приватною деталлю реалізації.

### `computeGate(state)`

Сигнатура (JSDoc):

```
@param  {{ gates?: { name: string, ok: boolean }[],
            review?: { findings?: { severity?: string }[] } }} state
@returns {{ verdict: 'PASS' | 'CONCERNS' | 'FAIL',
             score: number,
             reasons: string[] }}
```

### `gate(_rest, deps)`

Сигнатура (JSDoc):

```
@param  {string[]} _rest             аргументи CLI (не використовуються)
@param  {{ cwd?: string,
            log?: (m: string) => void,
            now?: () => number,
            branch?: string }}  [deps]  ін'єкції
@returns {Promise<number>}            exit-код (FAIL → 1; PASS/CONCERNS → 0)
```

Параметр `_rest` зберігається в сигнатурі для уніфікації з рештою CLI-handlers диспатчера; підкреслення на початку позначає навмисне ігнорування. Крім задокументованих у JSDoc полів `deps`, реалізація читає також `deps.branch` — він передається в `resolveActiveFlowState`.

## Функції

### `computeGate(state)`

- **Сигнатура:** `computeGate(state) → { verdict, score, reasons }`.
- **Параметри:**
  - `state.gates` (необов'язково) — масив об'єктів `{ name: string, ok: boolean }`. Якщо відсутній, береться `[]`.
  - `state.review.findings` (необов'язково) — масив об'єктів із полем `severity` зі значенням `'high'` або `'med'` (інші значення ігноруються при підрахунку штрафів). Якщо відсутній — `[]`.
- **Повертає:** об'єкт `{ verdict, score, reasons }`.
  - `verdict` — рядок `'PASS'`, `'CONCERNS'` або `'FAIL'`.
  - `score` — ціле число `0..100`, обмежене через `Math.max(0, Math.min(100, …))`.
  - `reasons` — масив рядкових пояснень (можливо порожній при `PASS`).
- **Side effects:** немає. Функція чиста, детермінована, без I/O і без використання глобального часу.

**Алгоритм синтезу:**

1. Розбиває `gates` на `failedGates = gates.filter(g => !g.ok)`.
2. Розбиває `findings` на дві групи за `severity`: `high` і `med`.
3. Прапор `noVerify = gates.length === 0` — стан, коли `verify` ще не запускався.
4. Формує `reasons`:
   - для кожного провального гейта: `gate «<name>» провалено`;
   - якщо `high.length > 0`: `<N> high-severity review finding(s)`;
   - якщо `med.length > 0`: `<N> med-severity review finding(s)`;
   - якщо `noVerify`: `verify ще не запускався`.
5. Визначає `verdict` за пріоритетом:
   - `FAIL` — якщо є хоча б один провальний гейт **або** хоча б один `high`-finding;
   - інакше `CONCERNS` — якщо є `med`-findings **або** `noVerify`;
   - інакше `PASS`.
6. Обраховує `penalty` як суму штрафів `PENALTY`:
   - `failedGate = 40` за кожен провальний гейт;
   - `high = 25` за кожен `high`-finding;
   - `med = 8` за кожен `med`-finding;
   - `noVerify = 15` (одноразово, якщо `gates` порожній).
7. `score = max(0, min(100, 100 - penalty))`.

**Інваріанти:**

- `FAIL` ⇒ `score < 100` (`penalty ≥ 25` гарантовано через high або failedGate ≥ 40).
- `PASS` ⇒ `penalty = 0` ⇒ `score = 100`.
- `CONCERNS` досяжний при `penalty > 0` без `failedGates` і без `high`.
- `score` ніколи не виходить за `[0, 100]`.

### `gate(_rest, deps = {})`

- **Сигнатура:** `async gate(_rest, deps) → Promise<number>`.
- **Параметри:**
  - `_rest` — масив рядків (CLI-аргументи), ігнорується.
  - `deps.cwd` — поточна робоча директорія; default — `process.cwd()`.
  - `deps.log` — функція логування; default — `console.error`.
  - `deps.now` — провайдер часу `() => number`; default — `Date.now`.
  - `deps.branch` — додаткова підказка для `resolveActiveFlowState` (необов'язково).
- **Повертає:** `Promise<number>` — exit-код процесу:
  - `1` — якщо стан недоступний (немає активного флоу або `flow init` ще не виконувався) або вердикт `FAIL`;
  - `0` — для `PASS` і `CONCERNS`.
- **Side effects:**
  - Викликає `resolveActiveFlowState` (може читати worktree/гілку).
  - Викликає `readState(statePath)` — синхронне читання `.flow.json`.
  - Викликає `recordTransition(...)` — мутація `.flow.json` і дописування в `events.jsonl` (через `flowEventsPath(cwd)`).
  - Логування в `deps.log` (за замовчуванням stderr).

**Покроковий потік:**

1. Розв'язує дефолтні залежності: `cwd0`, `log`, `now`.
2. `resolveActiveFlowState({ cwd: cwd0, branch })` визначає активний флоу:
   - якщо `resolved.statePath` пустий — логує `gate: <error>` і повертає `1`;
   - якщо `resolved.autoResolved` — логує повідомлення `flow: авторезолвлено активний flow «<label>» (cwd поза worktree)`.
3. Підставляє `cwd = resolved.worktreeDir ?? cwd0` і `statePath = resolved.statePath`.
4. Читає стан `readState(statePath)`; якщо `null/undefined` — логує `gate: стану нема — спершу `flow init``і повертає`1`.
5. Викликає `computeGate(state)` → `result`.
6. Викликає `recordTransition` з:
   - шляхами `{ statePath, eventsPath: flowEventsPath(cwd) }`,
   - подією `{ type: 'gate', verdict: result.verdict }`,
   - редьюсером `s => ({ ...s, gate: { ...result, at: new Date(now()).toISOString() } })` — додає до стану секцію `gate` з `verdict`/`score`/`reasons`/`at` (ISO-таймстемп);
   - провайдером часу `now`.
7. Логує рядок `gate: <VERDICT> (score <N>)`, потім по `  · <reason>` для кожної причини.
8. Повертає `1`, якщо `result.verdict === 'FAIL'`, інакше `0`.

## Залежності

### Зовнішні (Node.js core)

- `node:process` — імпорт `cwd as processCwd` для дефолтного значення `deps.cwd`.

### Внутрішні модулі диспатчера

- `./events.mjs` — функція `flowEventsPath(cwd)` будує шлях до файлу подій `events.jsonl` поточного флоу.
- `./state-store.mjs`:
  - `readState(statePath)` — синхронне читання `.flow.json` (повертає `null`, якщо нема);
  - `recordTransition({ statePath, eventsPath }, event, reducer, now)` — атомарна мутація стану + лог подій.
- `./flow-resolve.mjs` — `resolveActiveFlowState({ cwd, branch }, deps)` визначає активний worktree/гілку/`statePath`; повертає поля `statePath`, `worktreeDir`, `autoResolved`, `label`, `error`.

### Глобальні

- `console.error` — дефолтний логер (замінюється через `deps.log` у тестах).
- `Date.now`, `new Date(...).toISOString()` — джерело таймстемпів (час ін'єктується через `deps.now`, але `new Date(...).toISOString()` працює з результатом).

## Потік виконання / Використання

### Інтеграція в CLI

`gate` реєструється в основному диспатчері `flow` як handler підкоманди `gate`. Виклик відбувається у форматі:

```
flow gate
```

Додаткові позиційні аргументи не зчитуються (`_rest` ігнорується).

### Типовий ланцюжок флоу

```
flow init      → створює .flow.json
flow verify    → заповнює state.gates
flow review    → заповнює state.review.findings
flow gate      → агрегує → state.gate = { verdict, score, reasons, at }
```

### Сценарії exit-коду

| Сценарій                  | Лог                                     | Exit |
| ------------------------- | --------------------------------------- | ---- |
| Активний флоу не знайдено | `gate: <error>`                         | `1`  |
| `.flow.json` відсутній    | `gate: стану нема — спершу `flow init`` | `1`  |
| `verdict = FAIL`          | `gate: FAIL (score …)` + причини        | `1`  |
| `verdict = CONCERNS`      | `gate: CONCERNS (score …)` + причини    | `0`  |
| `verdict = PASS`          | `gate: PASS (score 100)`                | `0`  |

### Приклад чистого використання `computeGate`

```js
import { computeGate } from './gate.mjs'

const state = {
  gates: [
    { name: 'lint', ok: true },
    { name: 'test', ok: false }
  ],
  review: { findings: [{ severity: 'med' }] }
}

computeGate(state)
// → { verdict: 'FAIL', score: 52, reasons: [
//     'gate «test» провалено',
//     '1 med-severity review finding(s)'
//   ] }
```

### Приклад тестування `gate` через ін'єкції

```js
import { gate } from './gate.mjs'

const logs = []
const code = await gate([], {
  cwd: '/tmp/fixture',
  log: m => logs.push(m),
  now: () => 1_700_000_000_000
})

// code === 0 | 1
// logs містить рядки виду 'gate: PASS (score 100)' / '  · …'
```

### Записи в `.flow.json`

Після успішного виконання у стані з'являється секція:

```json
{
  "gate": {
    "verdict": "CONCERNS",
    "score": 92,
    "reasons": ["1 med-severity review finding(s)"],
    "at": "2024-01-01T00:00:00.000Z"
  }
}
```

Подія `{ type: 'gate', verdict }` дописується в `events.jsonl` через `recordTransition`.
