---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:43:00+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Все зафіксовано. Переходимо до реалізації. З чого починаємо — `n-cursor graph` CLI чи `n-cursor watch` демон?

---

The session is a design discussion that produced several durable architecture decisions.

## ADR Видалення `n-cursor flow` і уніфікація під `n-cursor graph`

## Context and Problem Statement
`n-cursor flow` (Пасивний Турнікет + Активний Раннер) та нова автономна система `n-cursor graph` (думка.MD) паралельно вирішували задачі ізоляції, планування та верифікації. Їх одночасне існування створювало дублювання концепцій і конкуруючі підходи до управління worktrees і станом задач.

## Considered Options
* Зберегти `flow` як окремий namespace, інтегрувати з `graph` через зовнішній контракт
* Повністю видалити `flow`, перенести всі функції під `graph`

## Decision Outcome
Chosen option: "Повністю видалити `flow`, перенести всі функції під `graph`", because `flow plan` = `graph plan`, `flow verify` зникає (замінено async аудитом), `flow run/resume/cancel/repair` замінено на `graph run / graph kill`, а `flow init/spec/release` не мають аналогів у новій file-based архітектурі.

### Consequences
* Good, because transcript фіксує очікувану користь: єдиний namespace, єдина точка входу для агентів, відсутність конкуруючих state-моделей (`.flow.json` vs `task.md`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/scripts/dispatcher/index.mjs` та всі `lib/*.mjs` стосуються `flow` і підлягають видаленню або переміщенню. Новий контракт зафіксовано в `docs/думка.MD`. `n-cursor flow` CLI-case у `npm/bin/n-cursor.js` підлягає видаленню.

---

## ADR Поділ `flow plan` на два атрибути: `mode` і `interactive`

## Context and Problem Statement
Потрібно було визначити як `graph plan` поводиться в headless worktree коли задача призначена для людини (`mode: human`). Виникла плутанина між "хто директор задачі" і "чи є інтерактивний діалог під час виконання".

## Considered Options
* `mode: human|agent` як єдиний атрибут визначає і актора, і рівень взаємодії
* Два ортогональних атрибути: `mode` (ХТО директор) і `interactive` (ЯК взаємодіє)

## Decision Outcome
Chosen option: "Два ортогональних атрибути: `mode` і `interactive`", because вони незалежні — людина може задати задачу заздалегідь (`mode: human, interactive: false`) і агент виконає без питань; або людина взаємодіє в реальному часі (`mode: human, interactive: true`).

### Consequences
* Good, because `interactive: false` однозначно визначає що вузол може запускатись автоматично оркестратором без людини; `mode` зберігає семантику "відповідальний директор".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Поля у `task.md` front-matter: `mode: human|agent` (default: `human`), `interactive: true|false` (default: `true`). Пріоритет: CLI-аргумент > `task.md` > `.n-cursor.json`. `n-cursor watch` пропускає вузли з `mode: human, interactive: true` і не spawns їх автоматично.

---

## ADR `n-cursor watch` як єдиний оркестратор замість `graph run --auto`

## Context and Problem Statement
Два незалежних процеси — `graph run --auto` (post-merge hook) і `n-cursor watch` (демон) — обидва сканували граф і могли запускати вузли паралельно, що створювало race condition: один вузол міг виконуватись двічі.

## Considered Options
* Atomic `git worktree add` як implicit lock (якщо fail — пропустити)
* `n-cursor watch` — єдиний оркестратор; post-merge hook тільки будить демон через `touch .n-cursor/wake`
* File lock перед spawn

## Decision Outcome
Chosen option: "`n-cursor watch` — єдиний оркестратор", because єдина точка управління виключає race condition без додаткової координації; post-merge hook стає тривіальним (`touch .n-cursor/wake`), а вся логіка spawn/merge/audit-dispatch централізована.

### Consequences
* Good, because `n-cursor watch` також робить merge після успішного аудиту (`audit-result_NNN.md (result: success)`), dispatch auditor для `pending-audit_NNN.md`, і Telegram-ескалацію — всі side-effects в одному місці.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`n-cursor watch` watches `.n-cursor/wake` + filesystem. Post-merge hook: `touch .n-cursor/wake`. Відповідальності watch: spawn ready вузлів, dispatch auditors, merge після аудиту, Telegram-ескалація при stale/blocked/failed.

---

## ADR `audit-result_NNN.md` як окремий тип файлу для аудиторського вердикту

## Context and Problem Statement
Потрібно було визначити як оркестратор знає що `pending-audit_NNN.md` вже оброблено (щоб не dispatch другого аудитора), і як зберігати вердикт аудитора окремо від execution-history виконавців.

## Considered Options
* Auditor пише у `run_NNN.md` з `actor: auditor`; detection через timestamp (`run_M.created_at > pending-audit.created_at`)
* Auditor пише `audit-result_NNN.md` (NNN = NNN pending-audit); detection через наявність файлу

## Decision Outcome
Chosen option: "`audit-result_NNN.md` як окремий тип файлу", because NNN збігається між `pending-audit_NNN.md` і `audit-result_NNN.md` — ім'я файлу саме є посиланням, без timestamp-порівнянь; `run_NNN.md` залишається виключно для виконавців (`agent|engineer|human`).

### Consequences
* Good, because transcript фіксує очікувану користь: тривіальне detection (`audit-result_NNN.md` існує?), чіткий поділ трекінгу виконавців і аудиторів, нумерація зберігає зв'язок `outputs → pending-audit → audit-result`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Формат `audit-result_NNN.md`: front-matter `created_at`, `actor: auditor`, `result: success|failed`; секція `## Reasoning`. Файл `pending-audit_NNN.md` front-matter: `created_at`, `actor: agent|human`. Lifecycle: `pending-audit_NNN.md` і `audit-result_NNN.md` обидва immutable — не видаляються після обробки.

---

## ADR Composite вузол стає `resolved` через агрегацію дітей, без `outputs_NNN.md`

## Context and Problem Statement
Composite вузол спавнить дочірні задачі і виходить. Він ніколи не пише `outputs_NNN.md`. Але стан `resolved` у file-based моделі означає наявність `outputs_NNN.md`. Без вирішення цього протиріччя composite вузол не міг би досягнути `resolved`.

## Considered Options
* Roll-up агент: після того як всі діти resolved → окремий запуск агрегує виходи у `outputs_NNN.md` батька
* Implicit агрегація: composite resolved = всі діти resolved, без жодного `outputs_NNN.md` у батька
* Останній merge дитини автоматично пише батьківський `outputs_NNN.md`

## Decision Outcome
Chosen option: "Implicit агрегація", because стан composite вузла — агрегація дітей; оркестратор деривує знизу вверх по ієрархії; жодного додаткового run не потрібно.

### Consequences
* Good, because спрощує оркестрацію — немає окремого "roll-up" кроку; батьківський вузол автоматично переходить у resolved коли всі листові вузли завершені.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`docs/думка.MD` — стан composite задається окремою таблицею: всі діти `resolved` → батько `resolved`; є `failed` → батько `failed`; є `running|pending-audit` → батько `running`; є `waiting` без failed/running → батько `waiting`. `plan_001.md` front-matter `decision: composite` визначає тип вузла.
