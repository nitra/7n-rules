---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:15:25+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Розглянемо реалізацію на двох рівнях — що робить скрипт і хто є реальним "мозком".

---

## `mode: human` — де справжній інтелект?

Ключове питання: **хто генерує план в human mode?**

Варіант A — **IDE-агент є плануючим** (мінімальний скрипт):
```
n-cursor flow plan
→ preflight (worktree? → else STOP)
→ читає task.md
→ форматує і виводить контекст для IDE-агента
→ IDE-агент (Claude Code) сам аналізує, пропонує, діалог з людиною
→ IDE-агент пише plan_001.md або дочірні task.md
→ n-cursor flow plan --finalize → валідує що plan_001.md існує і коректний
```
`flow plan` = тонкий helper, вся логіка у IDE-агента.

Варіант B — **інтерактивний CLI-діалог** (як поточний `flow spec`):
```
n-cursor flow plan
→ preflight
→ запускає structured dialogue (multiple-choice, питання до людини)
→ агент вбудований у скрипт, ставить питання через stdin/stdout
→ пише plan_001.md на основі відповідей
```
`flow plan` = self-contained інтерактивний процес.

---

## `mode: agent` — subagent spawning

Тут чіткіше:
```
n-cursor flow plan
→ preflight
→ читає task.md (type, budget_sec, Done when)
→ spawns claude CLI subprocess (як поточний subagent-runner)
→ системний промпт: "analyze task.md, decide atomic/composite, write plan_001.md"
→ timeout = budget_sec * 0.3 (перша фаза)
→ перевіряє що plan_001.md або дочірні task.md з'явились
```

---

Моя рекомендація — **A для human + subagent для agent**. Варіант B дублює те що IDE-агент вміє краще.

Але є нюанс з Варіантом A: якщо `flow plan` тільки "форматує контекст", то по суті він не потрібен — агент може сам прочитати task.md. Яку цінність він додає?

Як ти бачиш цю цінність?

---
END OF TRANSCRIPT

## ADR Рефакторинг `n-cursor flow` під архітектуру task-orchestration DAG

## Context and Problem Statement

У проєкті існувала система `n-cursor flow` (Пасивний Турнікет / Активний Раннер), побудована навколо `.flow.json` і команд `init/spec/plan/verify/release/run/resume/cancel/repair`. Паралельно розроблялась нова автономна orchestration-архітектура на файловій системі (`tasks/<node>/task.md`, `run_NNN.md`, `outputs_NNN.md`) описана в `docs/думка.MD`. Постала задача узгодити дві системи в єдину архітектуру де `graph` — зовнішній DAG-оркестратор, а `flow` — протокол всередині окремого вузла.

## Considered Options

* Варіант A — `flow plan` як тонкий helper: IDE-агент є мозком, скрипт лише preflight + форматування контексту + `--finalize` валідація
* Варіант B — `flow plan` як self-contained CLI-діалог (як поточний `flow spec` з multiple-choice)
* Варіант B для `graph spawn` — `flow plan` автоматично викликає `graph spawn` після створення дочірніх `task.md`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Варіант A (human mode) + subagent spawning (agent mode)", because IDE-агент вміє планувати краще за CLI-діалог, а варіант B дублює його можливості; для `mode: agent` найчистіше рішення — spawn claude CLI subprocess через наявний `subagent-runner`.

Для `graph spawn` обрано **Варіант B (explicit)**: `flow plan` тільки створює дочірні `task.md`, агент потім явно викликає `graph spawn` вручну.

### Consequences

* Good, because transcript фіксує очікувану користь: усунення дублювання між `flow spec` / `flow plan` / `flow gate` / `flow review` та зниклих Фасад-B команд; стан тепер у файлах без `.flow.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Зниклі команди: `flow init`, `flow spec`, `flow review`, `flow gate`, `flow run`, `flow resume`, `flow cancel`, `flow repair`.

Зниклі артефакти: `.flow.json`, `docs/specs/`, `docs/plans/`.

Нові файли вузла: `task.md` (атрибути `type: atomic|composite|auto`, `mode: human|agent`, `budget_sec`, `deps`), `plan_001.md` (front-matter `created_at`, `type`; секції `## Rationale`, `## Plan`, `## Decomposition`), `outputs_NNN.md`, `pending-audit_NNN.md` (NNN = NNN відповідного `outputs`), `run_NNN.md` (actor: `agent|engineer|auditor|human`), sentinel `invalidated`.

Таблиця станів: `waiting` / `running` / `pending-audit` / `resolved` / `failed` / `invalidated`.

`flow verify` — гібрид: скрипт перевіряє наявність/непорожність `outputs_NNN.md`, LLM перевіряє `## Done when`; нічого не пише на диск; `exit 0` = PASS, `exit 1` = FAIL.

Аудит-черга: `graph audit` → `pending-audit_NNN.md`; `n-cursor watch` сканує і spawns auditor; auditor пише `run_NNN.md (actor: auditor)`; `result: success` → merge; `result: failed` → агент продовжує.

Оркестратор: post-merge hook → `graph run --auto` (one-shot) + `n-cursor watch` (демон + черга).

Зафіксовано в `docs/думка.MD` (розділ "Інтеграція з n-cursor flow", рядки 241–395 після реорганізації).

---

## ADR Введення типу агента `flow` у `n-cursor` cursor

## Context and Problem Statement

Існуючий `n-cursor flow` діяв як «Пасивний Турнікет» — агент пише код самостійно в IDE, а `flow` лише ізолює (worktree), оцінює якість і релізить. З переходом до DAG-оркестрації через `graph` виникла необхідність визначити роль `flow` всередині окремого вузла графу: як саме агент отримує, планує і виконує атомарну задачу.

## Considered Options

* Stage 1 (`flow plan`) і Stage 2 (`flow verify`) як окремі підкоманди одного `flow` протоколу
* Повне злиття `flow` і `graph` в один інструмент
* `flow` як незалежна система поряд з `graph` (без інтеграції)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Stage 1 + Stage 2 як підкоманди `flow`", because поділ на planning і execution дає чіткий контракт: кожна підкоманда відповідає за один артефакт (`plan_001.md` або `outputs_NNN.md` + exit code), і агент знає де він знаходиться у lifecycle вузла.

### Consequences

* Good, because transcript фіксує очікувану користь: `flow plan` поглинає `flow spec` (усунення дублювання), `flow verify` отримує чіткий hybrid-контракт (скрипт + LLM), аудит виноситься в окрему чергу через `pending-audit_NNN.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

`flow plan` — preflight (перевірка `.worktrees/`) + читання `task.md` + режим `mode: human|agent` + визначення `type: atomic|composite|auto` + запис `plan_001.md` або дочірніх `task.md`.

`flow verify` — збирає контекст `task.md` + `plan_001.md` (останній) + `outputs_NNN.md` (останній); скрипт-частина перевіряє наявність; LLM-частина перевіряє `## Done when`; exit 0/1.

`flow plan --finalize` (Варіант A для human mode) — валідує що `plan_001.md` існує і коректний після того як IDE-агент його написав.

Файли: `npm/scripts/dispatcher/index.mjs`, `npm/scripts/dispatcher/lib/commands.mjs`, `npm/scripts/dispatcher/lib/plan.mjs`, `npm/scripts/dispatcher/lib/spec.mjs`, `npm/scripts/dispatcher/lib/subagent-runner/`, `docs/думка.MD`.
