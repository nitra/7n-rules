---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T15:45:07+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

Всі рівні 1–3 зафіксовані в `думка.MD`. Архітектура повністю специфікована і готова до реалізації.

Зведено що маємо:
- Схеми всіх файлів (`task.md`, `run_NNN.md`, `outputs_NNN.md`, `ops/kill-*`, `patches/*`)
- CLI контракт (`graph setup`, `init`, `run`, `kill`, `invalidate`, `scan`)
- Wrapper специфікація (timeout, kill, run_NNN.md)
- Конфіг + bootstrap протокол
- Observability контракт (стан з файлів, json/людиночитабельний)
- Recovery протокол (`graph scan --fix`)
- Протокол агента-інженера

---
<br>

## ADR Динамічний Граф Задач: злиття `inputs.md` в `task.md`

## Context and Problem Statement
При проектуванні файлової структури вузла системи динамічного графу задач розглядалося питання: зберігати опис місії та вхідні посилання в одному чи в двох окремих файлах.

## Considered Options
* Окремі файли `task.md` (місія) та `inputs.md` (посилання на вхідні дані)
* Єдиний `task.md` з секцією `## Inputs` всередині

## Decision Outcome
Chosen option: "Єдиний `task.md` з секцією `## Inputs`", because агент читає один файл замість двох, менше файлів при spawn, task і дані завжди разом — контекст цілісний. Редагування до старту (до ворктрі) вільне; після старту — потрібно kill ворктрі, потім редагувати freely і перезапустити.

### Consequences
* Good, because transcript фіксує очікувану користь: агент отримує повний контекст з одного файлу, зменшується церемоніал при spawn.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `tasks/<node-id>/task.md`. Секції: `## Task`, `## Done when`, `## Inputs` (підсекції з `ref:` або inline-текстом). Інваріант: append-only після `git worktree add`; до ворктрі — вільне редагування.

---

## ADR Уніфікований `run_NNN.md` для всіх акторів

## Context and Problem Statement
Система мала окремі файли для різних типів виконань: `error.md` (технічні збої), `repair/NNN.md` (спроби інженера), а також передбачала append-only `outputs.md`. Постало питання уніфікації.

## Considered Options
* Окремі файли: `error.md`, `repair/NNN.md`, `outputs.md` (append-only)
* Єдиний `run_NNN.md` — один immutable файл на кожну спробу будь-якого актора

## Decision Outcome
Chosen option: "Єдиний `run_NNN.md`", because система не повинна мати жодних append-only файлів — кожна спроба є окремим immutable артефактом; різні актори (`agent`, `engineer`, `human`, `auditor`) уніфіковані через поле `actor:`.

### Consequences
* Good, because transcript фіксує очікувану користь: жодних mutable файлів під час роботи, повний audit trail через пронумеровані файли.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`run_NNN.md` містить: `created_at`, `actor`, `result: success|failed`, опційно `worktree:` (тільки при failed). Секції: `## Script` (wrapper пише після завершення), `## Ref` (посилання на `outputs_NNN.md`). `## Reasoning` видалений — wrapper пише весь файл після виходу агента. Файл: `tasks/<node-id>/run_NNN.md`.

---

## ADR `ops/spawn-plan` видалено — spawn атомарний через ворктрі

## Context and Problem Statement
Архітектура передбачала `ops/spawn-plan-<ts>.md` / `spawn-fact-<ts>.md` для відновлення при обриві під час створення дочірніх вузлів.

## Considered Options
* Зберігати `ops/spawn-plan/fact` для crash recovery при spawn
* Видалити — spawn відбувається у ворктрі, атомарність гарантована git

## Decision Outcome
Chosen option: "Видалити spawn-plan/fact", because spawn виконується всередині ворктрі агента: всі дочірні `task.md` пишуться у ворктрі і потрапляють в main тільки після merge — часткового стану не буває.

### Consequences
* Good, because transcript фіксує очікувану користь: менше файлів, простіша схема.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`ops/kill-plan/fact` залишено — kill виконується поза ворктрі (людина або скрипт), тому план/факт потрібні для recovery. Файли: `tasks/<node-id>/ops/kill-plan-<epoch>.md`, `kill-fact-<epoch>.md`.

---

## ADR Топологія графу в `deps:` кожного дочірнього вузла

## Context and Problem Statement
При визначенні де зберігати топологію підграфу розглядалися варіанти центрального файлу або розподіленого підходу.

## Considered Options
* Центральний `граф.md` у батьківському вузлі
* `deps:` поле в `task.md` кожного дочірнього вузла

## Decision Outcome
Chosen option: "`deps:` в кожному `task.md` дочірнього", because мета — універсальність: кожен вузол самодостатній, оркестратор відновлює повний граф скануванням без центрального файлу. Динамічний spawn — просто новий дочірній з `deps:` що посилається на вже існуючі вузли.

### Consequences
* Good, because transcript фіксує очікувану користь: не потрібно оновлювати центральний файл при динамічному spawn.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`deps:` містить лише id сусідніх вузлів (siblings) — шлях резолвиться як `../<dep-id>/`. Поле `port:` видалено; конкретне посилання на дані — в `## Inputs` через `ref:`. Файл: `tasks/<node-id>/task.md`, поле `deps: [collect-data, fetch-sources]`.
