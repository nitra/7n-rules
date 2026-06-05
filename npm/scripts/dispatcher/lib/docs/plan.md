# plan.mjs — фаза `plan` команди `flow`

## Огляд

Модуль `plan.mjs` реалізує фазу **плану** lifecycle-команди `flow` (модель «Пасивний Турнікет», §4 правила `n-flow`). Це чистий «turnstile»-крок: він **не пише кодові артефакти** — лише фіксує план роботи у persistent-стані `.flow.json` поточного worktree та супутньому event-log.

Команда CLI:

```
flow plan [--panel] [<plan.md>]
```

Високорівнева семантика:

1. Резолвить активний `flow`-state (`.flow.json`) у поточному `cwd` або за параметром `branch`.
2. Перевіряє, що state існує (`flow init` був запущений раніше). Якщо ще не зафіксована spec — попереджає, але не блокує.
3. Бере **кроки плану** одним із двох способів (brainstorm-моделей з `flow.mdc`):
   - **human↔agent** — читає `docs/plans/<date>-<slug>.md` (передано аргументом або резолвиться по бренчу) і витягує `## Кроки` як список steps.
   - **agent↔agent (`--panel`)** — викликає `runPanel` (панель персон + суддя) через subagent-runner і отримує синтезовані кроки.
4. Нормалізує steps через `parsePlan` (валідація формату/структури → масив об'єктів кроків).
5. Read-only `verifyTrace` перевіряє цілісність ланцюга `spec → plan → flow` (front-matter лінки). При розриві лише попереджає у лог (не падає).
6. Записує transition у state-store: `plan` ← `normalized`, `plan_doc` ← шлях до md (або `null` для panel-режиму), `status` ← `'planned'`. Тип події — `plan`, payload — `{ steps: <кількість> }`.
7. Логує підсумок і повертає `0`.

Будь-яка помилка (відсутність state, відсутність плану-доку, невалідний формат, неможливість підняти runner) логується через `log` і повертає `1`.

## Експорти / API

| Експорт             | Тип              | Призначення                                                |
| ------------------- | ---------------- | ---------------------------------------------------------- |
| `plan(rest, deps?)` | `async function` | Виконати фазу `plan` поточного `flow`. Іменований експорт. |

Інших експортів немає (немає `default`).

### Сигнатура

```js
export async function plan(rest, deps = {}) → Promise<number>
```

### Параметри

- `rest: string[]` — позиційні аргументи CLI (після `plan`). Розпізнаються:
  - `--panel` — увімкнути agent↔agent режим (панель персон).
  - перший елемент із суфіксом `.md` — явний шлях до plan-доку (інакше резолвиться через `resolveArtifact(cwd, 'plans', state.branch)`).
- `deps?: object` — bag залежностей для ін'єкції в тестах:
  - `cwd?: string` — стартовий `cwd` (default: `process.cwd()`).
  - `branch?: string` — підказка про активний flow для авторезолву поза worktree.
  - `log?: (msg: string) => void` — sink для повідомлень (default: `console.error`).
  - `runner?: object` — готовий subagent-runner (для `--panel`). Якщо немає — створюється через `createRunner(deps)`.
  - `trace?: (cwd: string) => number` — кастомна імплементація trace-перевірки для `verifyTrace`.
  - `now?: () => number` — джерело часу для transition-таймстампу (default: `Date.now`).

### Повертає

`Promise<number>` — exit code:

- `0` — план зафіксовано, state переведено у `planned`.
- `1` — будь-яка помилка: нема state-файлу/active flow, нема plan-доку у режимі без `--panel`, runner не піднявся, `parsePlan` упав на валідації, panel повернув пустий результат.

### Side effects

- Читає файлову систему: `.flow.json` (через `readState`), доки плану через `readFileSync`, `existsSync`.
- Пише через `recordTransition`: оновлює `.flow.json` та аппендить запис у `flowEventsPath(cwd)`.
- Викликає `log(...)` (за замовчуванням — `console.error`).
- У режимі `--panel` запускає підпроцес/subagent-runner через `createRunner` (мережа/LLM-виклики залежно від реалізації runner).

## Функції

У файлі **одна** експортована функція `plan` — описана вище. Внутрішніх допоміжних функцій немає.

### `plan(rest, deps)` — деталі потоку

**Сигнатура:** `(rest: string[], deps?: PlanDeps) → Promise<number>`

**Послідовність:**

1. **Резолв cwd і логера** — `cwd0 = deps.cwd ?? processCwd()`, `log = deps.log ?? console.error`.
2. **Резолв активного flow** — `resolveActiveFlowState({ cwd: cwd0, branch: deps.branch }, deps)`.
   - Якщо `resolved.statePath` пустий — log `plan: <error>` і `return 1`.
   - Якщо `resolved.autoResolved === true` — log повідомлення про авторезолв (cwd поза worktree).
   - `cwd` для подальших операцій = `resolved.worktreeDir ?? cwd0`.
3. **Читання state** — `readState(statePath)`; якщо `null` → `'plan: стану нема — спершу `flow init`'` і `return 1`.
4. **Soft-гейт по spec** — якщо `state.status !== 'spec'` і `!state.spec_doc` — лише попередження (`'plan: дизайн ще не зафіксовано — рекомендовано спершу `flow spec` (не блокує)'`), виконання продовжується.
5. **Резолв plan-доку** — `doc = rest.find(a => a.endsWith('.md')) ?? resolveArtifact(cwd, 'plans', state.branch)`.
6. **Збір steps**:
   - **Гілка `--panel`:**
     - Якщо `deps.runner` не передано — пробує `createRunner(deps)`, на throw → log і `return 1`.
     - `steps = await runPanel({ task: state.branch, cwd, runner, log, mode: 'plan' })`.
     - Якщо `steps` falsy → `return 1` (panel вирішив не комітити).
   - **Гілка з документом:**
     - Якщо `!doc || !existsSync(doc)` → log `'plan: нема docs/plans/<date>-<slug>.md — спершу пройди brainstorm (див. flow.mdc)'` і `return 1`.
     - `steps = extractSteps(readFileSync(doc, 'utf8'))`.
7. **Нормалізація** — `parsePlan(JSON.stringify(steps))` у try/catch; помилка → log і `return 1`. Результат — `normalized` (масив крокових об'єктів).
8. **Trace-перевірка** — `verifyTrace(cwd, deps.trace)`; якщо `false` — лише warning з пр **U+26A0**: `'⚠️ plan: trace виявив розрив ланцюга — перевір лінки spec/plan/flow'`.
9. **Transition** — `recordTransition`:
   - target: `{ statePath, eventsPath: flowEventsPath(cwd) }`.
   - event: `{ type: 'plan', steps: normalized.length }`.
   - reducer: `s => ({ ...s, plan: normalized, plan_doc: doc ?? null, status: 'planned' })`.
   - clock: `deps.now ?? Date.now`.
10. **Лог підсумку** — `'plan: зафіксовано <N> кроків → status: planned'`, **return 0**.

**Інваріанти:**

- Функція не модифікує state у разі будь-якого `return 1` до кроку 9.
- `plan_doc` свідомо може бути `null` (panel-режим без файлу).
- Trace-розрив **не блокує** запис — це м'який сигнал розробнику.

## Залежності

### Зовнішні (node:)

- `node:fs` — `existsSync`, `readFileSync` (читання plan-доку).
- `node:process` — `cwd as processCwd` (default-резолв робочої директорії).

### Внутрішні модулі lib/

- `./artifact.mjs` — `extractSteps` (парс `## Кроки` з md), `resolveArtifact` (резолв `docs/<kind>/<date>-<slug>.md` за бренчем), `verifyTrace` (read-only валідація ланцюга front-matter).
- `./events.mjs` — `flowEventsPath` (шлях до event-log поточного flow).
- `./planner.mjs` — `parsePlan` (нормалізація+валідація steps).
- `./plan-panel.mjs` — `runPanel` (agent↔agent режим, mode: `'plan'`).
- `./subagent-runner.mjs` — `createRunner` (фабрика runner-а для LLM-викликів у panel).
- `./state-store.mjs` — `readState` (читання `.flow.json`), `recordTransition` (атомарне оновлення стану + event).
- `./flow-resolve.mjs` — `resolveActiveFlowState` (резолв активного flow зі `cwd`/`branch`, авторезолв за межами worktree).

Жодних transitive npm-пакетів напряму звідси не використовується.

## Потік виконання / Використання

### Як цей модуль використовується

Файл є **обробником субкоманди** dispatcher-а команди `flow`. Очікувано викликається з вищого рівня (CLI-entry, наприклад `npm/scripts/dispatcher/cli.mjs` чи аналогічного), куди передаються розпарсені аргументи. Виклик можна представити так:

```js
import { plan } from './lib/plan.mjs'

const code = await plan(process.argv.slice(3))
process.exit(code)
```

### Сценарії використання

1. **Human↔agent (типовий ручний flow)**

   ```
   flow init my-feature        # створив .flow.json
   flow spec                   # зафіксував docs/specs/<...>.md
   # brainstorm у Cursor/Claude → з'явився docs/plans/<date>-my-feature.md з '## Кроки'
   flow plan                   # резолвить plan-doc за branch, фіксує steps, status → planned
   ```

2. **Agent↔agent (panel)**

   ```
   flow plan --panel
   ```

   Без plan-доку: панель персон через `runPanel({ mode: 'plan' })` синтезує `steps`. Записує `plan_doc: null`.

3. **Явний шлях**
   ```
   flow plan docs/plans/2026-06-03-my-feature.md
   ```
   Перший `*.md`-аргумент у `rest` має пріоритет над `resolveArtifact`.

### Стан до/після

| Поле `.flow.json` | До `plan`                         | Після `plan`                             |
| ----------------- | --------------------------------- | ---------------------------------------- |
| `status`          | `'spec'` (рекомендовано) або інше | `'planned'`                              |
| `plan`            | відсутнє/попереднє                | `normalized` (масив steps)               |
| `plan_doc`        | відсутнє                          | абсолютний шлях до md або `null` (panel) |

В event-log дописується `{ type: 'plan', steps: <N>, ts: <now> }` (фактичний формат — в `recordTransition`).

### Exit code контракт

- `0` — успіх, можна переходити до наступної фази (`flow code`/`flow review` за конвенцією `n-flow`).
- `1` — будь-яка помилка; стан **не модифікується**, кроки не записані.

### Обробка помилок

Жодних винятків назовні: усі try/catch перетворені у `log + return 1`. Виключення — баги нижчих рівнів (`recordTransition`, `readState`) — на цьому шарі не загорнуті, тож можуть пропагуватися як unhandled rejection у CLI.

## Rebuild Test

Цього модуля **достатньо** для відтворення з нуля за цією специфікацією за умови наявності таких контрактів-сусідів:

- `resolveActiveFlowState({ cwd, branch }, deps) → { statePath, worktreeDir?, autoResolved?, label?, error? }`.
- `readState(statePath) → object | null` з принаймні полями `{ branch, status, spec_doc? }`.
- `resolveArtifact(cwd, kind, branch) → string | undefined` (абсолютний шлях до `docs/<kind>/<date>-<slug>.md`).
- `extractSteps(mdString) → Array` (парсить `## Кроки`).
- `parsePlan(jsonString) → Array` (валідація; кидає `Error` з полем `.message`).
- `runPanel({ task, cwd, runner, log, mode }) → Promise<Array | undefined>`.
- `createRunner(deps) → Promise<runner>` (може кидати `Error`).
- `verifyTrace(cwd, traceFn?) → boolean`.
- `flowEventsPath(cwd) → string`.
- `recordTransition({ statePath, eventsPath }, event, reducer, now) → void`.

Маючи їх — модуль повністю відновлюється з опису вище: 10 кроків функції `plan`, дві гілки збору `steps`, exit-code-контракт, side-effects через `recordTransition`.
