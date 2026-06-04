# spec.mjs

## Огляд

Модуль реалізує CLI-підкоманду `flow spec [--panel] [<spec.md>]` — фазу дизайну в lifecycle Пасивного Турнікета (§3 правила `flow.mdc`). Її призначення — зафіксувати у файлі стану воркфлоу (`flow-state`) шлях до spec-документа (`docs/specs/<date>-<slug>.md`), отриманого внаслідок brainstorm-сесії, та виконати read-only верифікацію ланцюга трасування (`trace`) між артефактами ADR → spec → plan.

Ключові властивості:

- **Код не пишеться:** модуль лише оновлює state-store та логує події, лінки front-matter (`adr/spec/plan`) у самому документі формує агент за контрактом `flow.mdc`.
- **Brainstorm two-track:** human↔agent відбувається у звичайному IDE-діалозі; agent↔agent — через прапор `--panel`, який запускає синтез персон та суддю через `runPanel`.
- **Risk-driven review:** значення `risk` із front-matter spec-документа (`low | med | high`) перетікає у стан, керуючи глибиною подальшої фази `flow review`.
- **Worktree-aware:** якщо `cwd` поза worktree, активний flow автоматично резолвиться через `resolveActiveFlowState`.

Модуль є чистою функцією верхнього рівня з контрольованими ін'єкціями залежностей (`deps`), що робить його придатним для unit-тестування без файлової системи реального проєкту.

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `spec(rest, deps?)` | `async function` | Точка входу CLI-підкоманди `flow spec`. Повертає exit code (`0` — успіх, `1` — помилка). |

Внутрішні (не експортуються):

| Ідентифікатор | Тип | Призначення |
| --- | --- | --- |
| `RISKS` | `Set<string>` | Допустимі рівні ризику: `low`, `med`, `high`. |
| `riskFromSpec(doc, current)` | `function` | Зчитує валідний `risk` зі spec-frontmatter або повертає поточний у стані. |

## Функції

### `RISKS`

```text
const RISKS = new Set(['low', 'med', 'high'])
```

Замкнений перелік допустимих значень поля `risk` у front-matter spec-документа. Будь-яке інше значення (включно з `undefined`, опискою, або відсутністю фронт-матеру) ігнорується — у такому разі ризик у стані не змінюється.

### `riskFromSpec(doc, current)`

**Сигнатура:**

```js
function riskFromSpec(doc: string, current: string | undefined): string | undefined
```

**Параметри:**

- `doc` (`string`) — абсолютний або відносний шлях до spec-документа (`*.md`).
- `current` (`string | undefined`) — поточне значення `risk` із state-store; використовується як fallback, коли в документі не вказано валідного ризику.

**Повертає:** `string | undefined` — рівень ризику (`low`, `med`, `high`) або поточне значення.

**Семантика:**

1. Зчитує вміст файлу `doc` як UTF-8 рядок.
2. Парсить front-matter через `parseFrontMatter`.
3. Якщо у фронт-матері є поле `risk` і воно є членом `RISKS` — повертає його.
4. Інакше повертає `current` (без модифікації).

**Side effects:**

- Виконує синхронний read файлової системи (`readFileSync`).
- Будь-який виняток (відсутній файл, помилка парсингу, прав доступу) поглинається `try/catch` і функція повертає `current` — це гарантує, що відсутність front-matter не блокує транзицію стану.

### `spec(rest, deps)`

**Сигнатура:**

```js
async function spec(
  rest: string[],
  deps?: {
    cwd?: string,
    branch?: string,
    log?: (m: string) => void,
    runner?: object,
    trace?: (cwd: string) => number,
    now?: () => number
  }
): Promise<number>
```

**Параметри:**

- `rest` (`string[]`) — позиційні аргументи CLI після підкоманди `spec`. Розпізнаються:
  - `--panel` — флаг увімкнення agent-panel brainstorm.
  - Будь-який аргумент, що закінчується на `.md` — явний шлях до spec-документа (інакше використовується `resolveArtifact`).
- `deps` (`object`, опційно) — ін'єкції для тестування та advanced use cases:
  - `cwd` — стартовий робочий каталог (default: `process.cwd()`).
  - `branch` — гілка для резолву активного flow (передається у `resolveActiveFlowState`).
  - `log` — функція логування (default: `console.error`).
  - `runner` — попередньо створений subagent runner (інакше викликається `createRunner(deps)`).
  - `trace` — функція трасування для `verifyTrace`.
  - `now` — джерело часу для `recordTransition` (default: `Date.now`).

**Повертає:** `Promise<number>` — exit code:

- `0` — транзиція стану успішно записана.
- `1` — помилка резолву стану / відсутній state / помилка створення runner / відсутній spec-документ.

**Потік виконання:**

1. **Резолв активного flow.** Викликає `resolveActiveFlowState({ cwd, branch }, deps)`. Якщо `statePath` не визначено — логує помилку й повертає `1`. Якщо flow авторезолвлено (cwd поза worktree) — логує інформаційне повідомлення з міткою.
2. **Читання стану.** `readState(statePath)` повертає об'єкт стану або `null`. У разі `null` — логує підказку `flow init` і повертає `1`.
3. **Опційний panel-brainstorm.** Якщо `rest` містить `--panel`:
   - Створює runner через `createRunner(deps)` (якщо не передано в `deps.runner`); виняток → лог + `1`.
   - Викликає `runPanel({ task: state.branch, cwd, runner, log, mode: 'spec' })`.
   - Якщо повернувся синтез — логує його (з підказкою зберегти в `docs/specs/` і повторити `flow spec`). Об'єктний синтез серіалізується через `JSON.stringify`.
   - **Важливо:** після `--panel` функція не виходить — продовжує спробу резолву документа (наступний крок). Це дозволяє за один виклик і синтезувати, і зафіксувати.
4. **Резолв документа.** Шукає в `rest` перший аргумент, що закінчується на `.md`; інакше — `resolveArtifact(cwd, 'specs', state.branch)`. Якщо документ не знайдено або файл не існує — логує підказку про brainstorm і повертає `1`.
5. **Trace-верифікація.** `verifyTrace(cwd, deps.trace)` — read-only перевірка ланцюга front-matter (adr/spec/plan). Якщо ланцюг розірвано — лише warning у лог (не фатально).
6. **Обчислення risk.** `risk = riskFromSpec(doc, state.risk)` — front-matter spec має пріоритет над поточним.
7. **Запис транзиції.** `recordTransition` із параметрами:
   - `paths`: `{ statePath, eventsPath: flowEventsPath(cwd) }`.
   - `event`: `{ type: 'spec' }`.
   - `mutator`: `s => ({ ...s, spec_doc: doc, risk, status: 'spec' })`.
   - `clock`: `deps.now ?? Date.now`.
8. **Завершення.** Лог `spec: зафіксовано <doc> → status: spec (risk <risk|—>)` і повернення `0`.

**Side effects:**

- Логування у stderr (`console.error` або кастомний `log`).
- Read-only доступ до файлової системи (`existsSync`, `readFileSync` у `riskFromSpec`).
- Запис у state-store та events-log через `recordTransition`.
- Можливий запуск subagent-runner (panel mode), який сам має побічні ефекти (мережа/IPC).

## Залежності

### Стандартна бібліотека Node.js

| Імпорт | Звідки | Використання |
| --- | --- | --- |
| `existsSync` | `node:fs` | Перевірка існування spec-документа перед записом транзиції. |
| `readFileSync` | `node:fs` | Зчитування spec-документа для парсингу front-matter у `riskFromSpec`. |
| `cwd as processCwd` | `node:process` | Default-значення для `deps.cwd`. |

### Внутрішні модулі

| Імпорт | Шлях | Призначення |
| --- | --- | --- |
| `resolveArtifact`, `verifyTrace` | `./artifact.mjs` | Резолв шляху артефакту за конвенцією `docs/<kind>/<date>-<slug>.md` та верифікація trace-ланцюга front-matter. |
| `flowEventsPath` | `./events.mjs` | Шлях до файлу подій воркфлоу (для аудиту транзицій). |
| `runPanel` | `./plan-panel.mjs` | Запуск agent-panel brainstorm у режимі `mode: 'spec'`. |
| `createRunner` | `./subagent-runner.mjs` | Фабрика subagent runner для panel mode. |
| `readState`, `recordTransition` | `./state-store.mjs` | Читання поточного стану та атомарний запис транзиції з мутатором. |
| `resolveActiveFlowState` | `./flow-resolve.mjs` | Авторезолв активного flow (worktree-awareness, branch fallback). |
| `parseFrontMatter` | `../trace.mjs` | Парсинг YAML-подібного front-matter Markdown-документа. |

## Потік виконання / Використання

### CLI-сценарій

```bash
# 1. Простий запис: spec-документ резолвиться за конвенцією branch → docs/specs/
flow spec

# 2. Явний шлях до документа
flow spec docs/specs/2026-01-15-new-feature.md

# 3. З agent-panel brainstorm (синтез персон, потім збереження документа вручну)
flow spec --panel

# 4. Комбіноване: panel + явний документ
flow spec --panel docs/specs/2026-01-15-new-feature.md
```

### Граф станів

```
flow init → status: init
   ↓
(brainstorm в IDE або через --panel)
   ↓
flow spec → status: spec, spec_doc=<path>, risk=<low|med|high>
   ↓
flow plan / flow review / ...
```

### Інваріанти

- Перед `flow spec` обов'язково має бути виконано `flow init` (інакше — exit 1).
- Spec-документ має існувати на ФС (`existsSync`).
- Trace-розрив **не** блокує транзицію — лише warning (бо лінки пише агент і може не встигнути на момент запуску).
- Panel-mode не перериває основний flow: навіть якщо синтез повернувся, функція продовжує спробу резолвити документ. Якщо документу ще нема — exit 1 з підказкою зберегти результат.

### Контракт із `flow.mdc`

- Контракт front-matter (поля `adr`, `spec`, `plan`, `risk`) — відповідальність агента, що генерує/редагує Markdown-документ.
- `risk` із spec має пріоритет над попереднім `state.risk` — це механізм downstream-керування глибиною review.
- Подія `{ type: 'spec' }` фіксується у `events.jsonl` для подальшого аудиту lifecycle.

### Тестованість

Усі зовнішні точки контакту проброшено через `deps`:

- `cwd`, `branch` — детермінований резолв flow.
- `log` — capture логів у тестах.
- `runner` — мок subagent без реальних викликів LLM.
- `trace` — мок trace-перевірки.
- `now` — детерміновані timestamps у events.

Це дозволяє покрити модуль unit-тестами без файлової системи (тільки `readFileSync`/`existsSync` потребують фейкових файлів або моків `node:fs`).
