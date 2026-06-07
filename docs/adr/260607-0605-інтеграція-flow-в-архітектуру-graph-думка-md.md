---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:05:46+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Memory оновлено. Всі рішення зафіксовані.

---

Готові до реалізації **B — рефакторинг `flow`**. Порядок дій:

1. Видалити `flow init`, `flow spec`, `flow release`, `flow gate`, `flow review`, `flow run`, `flow cancel`, `flow repair`
2. Переписати `flow plan` (Stage 1: spec + decompose, `plan_001.md`)
3. Переписати `flow verify` (LLM-аудитор, читає `## Done when` з task.md)
4. Оновити `npm/scripts/dispatcher/index.mjs` (новий dispatch)
5. Оновити `.cursor/rules/n-flow.mdc` (мінімальний IDE-контракт)

Починаємо?

---

## ADR Інтеграція `flow` в архітектуру `graph` (думка.MD)

## Context and Problem Statement
Існуючий `n-cursor flow` (Dual-Mode Dispatcher) побудований навколо `.flow.json` і 5-фазного циклу `init→spec→plan→verify→release`. Нова архітектура `думка.MD` вводить автономний DAG-оркестратор (`n-cursor graph`) з файловим сховищем стану (`tasks/<node>/task.md`). Потрібно визначити, як два протоколи інтегруються без дублювання і де проходить межа відповідальності.

## Considered Options
* A — Flow як execution engine всередині graph-вузла (переосмислення, не заміна)
* B — Повне злиття: `flow init` = `graph init`, `flow verify` = умова resolved
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "A — Flow як execution engine всередині graph-вузла", because `graph` оркеструє worktrees і deps ззовні, `flow` залишається протоколом всередині одного вузла; межа — чітка, без дублювання.

### Consequences
* Good, because transcript фіксує очікувану користь: чітке розмежування `graph` (DAG, merge, worktrees) і `flow` (plan, verify, agent signals) дозволяє розвивати їх незалежно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `docs/думка.MD` — living spec, джерело правди; промпти і правила деривуються з нього
- `.n-cursor/system-prompt.md`, `.n-cursor/engineer-prompt.md`, `.n-cursor/actors.md` — нові файли проекту
- Команди `flow run/resume/cancel/repair/spec/init/gate/review/release` — видаляються
- `graph resume <path>` — нова команда (continuation vs fresh `graph run`)
- `pending-audit_NNN.md` — новий тип файлу; NNN = NNN відповідного `outputs_NNN.md`

---

## ADR Розподіл знань між system-prompt, engineer-prompt, rules і думка.MD

## Context and Problem Statement
Проект має кілька сховищ знань: `.cursor/rules/` для IDE, майбутні `.n-cursor/system-prompt.md` і `.n-cursor/engineer-prompt.md` для агентів, `memory/` для Claude Code, та `docs/думка.MD` як архітектурний документ. Потрібно визначити чіткий розподіл — що живе де, щоб не дублювати і не конфліктувати.

## Considered Options
* думка.MD → living spec (джерело правди, промпти деривуються з нього)
* думка.MD → перетворюється на ADR-и і зникає
* думка.MD → переходить у `.cursor/rules/` як developers-spec
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "думка.MD → living spec", because розробники читають думка.MD щоб розуміти архітектуру; агенти читають промпти (деривовані з думки); IDE використовує `rules/`; Claude Code зберігає рішення в `memory/`.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка оновлення архітектури — `думка.MD`; зміна архітектури → оновити думка.MD → оновити промпти.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `.cursor/rules/*.mdc` — для розробників (IDE-конвенції, Cursor)
- `.n-cursor/system-prompt.md` — протокол autonomous agent (runtime)
- `.n-cursor/engineer-prompt.md` — протокол engineer actor (runtime)
- `.n-cursor/actors.md` — capability manifest: набір інструментів per actor type
- `memory/project_graph_flow_design.md` — Claude Code зберігає рішення між сесіями

---

## ADR Аудит через файлову чергу (`pending-audit_NNN.md`)

## Context and Problem Statement
Після завершення роботи над вузлом потрібен механізм аудиту якості — перевірка критеріїв `## Done when` з `task.md`. Старий `flow gate` і `flow review` виконували це синхронно всередині `flow`. Нова архітектура потребує асинхронного аудиту, який вписується в DAG-оркестрацію і дозволяє аудиторам-агентам обробляти чергу незалежно.

## Considered Options
* `graph audit` = негайний spawn аудитора (синхронний)
* Файлова черга через `pending-audit_NNN.md` (асинхронний, через `n-cursor watch`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Файлова черга через `pending-audit_NNN.md`", because `n-cursor watch` сканує вузли зі станом `pending-audit` і spawns `flow verify` — аудит стає станом вузла, а не окремим sync-викликом; нумерація `pending-audit_NNN.md` = NNN з `outputs_NNN.md` (ім'я файлу = посилання, без `ref:` поля).

### Consequences
* Good, because transcript фіксує очікувану користь: аудит в черзі дозволяє `n-cursor watch` batch-обробляти аудити без блокування основного виконання.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `pending-audit_001.md` → `outputs_001.md` — numbered (Варіант B), не overwrite
- `run_NNN.md (actor: auditor, result: success|failed)` — результат аудиту
- `flow verify` = LLM-аудитор; виклик через чергу або явно (self-check агентом)
- Новий стан вузла `pending-audit` додається до таблиці: `waiting | plan-pending | running | pending-audit | resolved | failed | invalidated`

---

## ADR Актори, capability manifest і дозволені актори в `task.md`

## Context and Problem Statement
Різні типи акторів (autonomous agent, auditor, engineer, human) мають різний набір дозволених інструментів і команд. Потрібно місце де це зафіксовано (не дублюючи у кожному промпті) і механізм обмеження: конкретний `task.md` може дозволяти лише певних акторів.

## Considered Options
* Набір інструментів — inline в кожному промпті (без окремого файлу)
* `.n-cursor/actors.md` — окремий capability manifest + `actors:` поле в `task.md`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`.n-cursor/actors.md` + `actors:` в `task.md`", because єдиний manifest дозволяє змінювати набір інструментів в одному місці; `graph run --actor X` перевіряє список з `task.md` перед стартом.

### Consequences
* Good, because transcript фіксує очікувану користь: task-level access control — кожна задача задає які актори можуть її виконувати.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `task.md` front-matter: `actors: [human, agent]` (default якщо не вказано)
- `graph run tasks/my-node --actor human` — помилка якщо `human` не в списку
- `.n-cursor/actors.md` — capability manifest рядом з `system-prompt.md` і `engineer-prompt.md`
- Всі graph команди → `npm/scripts/graph/` (n-cursor npm); ніяких shell скриптів
