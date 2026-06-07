---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:46:55+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Всі п'ять gap-рішень зафіксовані в `docs/думка.MD` і memory. Документ консистентний.

Рухаємось до реалізації? Перший блок — `npm/scripts/graph/` (всі модулі з нуля, за фінальним дизайном).
[user]
рухаємось

---
END OF TRANSCRIPT
---

## ADR Рефакторинг `n-cursor flow` в уніфікований `n-cursor graph`

## Context and Problem Statement
Система `n-cursor flow` містила два незалежних фасади (`Пасивний Турнікет` для IDE-агентів та `Активний Раннер`), які дублювали частину функцій автономного DAG-оркестратора з `docs/думка.MD`. Потрібно було об'єднати обидві системи, усунути дублювання і побудувати єдину архітектуру для виконання задач у ізольованих git worktree-ах.

## Considered Options
* Зберегти `n-cursor flow` як окремий namespace і інтегрувати з graph ззовні
* Повністю видалити `n-cursor flow`; `flow plan` перейменувати в `graph plan`; всі команди об'єднати під `n-cursor graph`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Повністю видалити `n-cursor flow`; всі команди об'єднати під `n-cursor graph`", because якщо залишити `flow plan` як єдину команду namespace `flow`, то namespace стає надлишковим — user підтвердив що `flow plan` → `graph plan` і весь `n-cursor flow` зникає.

### Consequences
* Good, because transcript фіксує очікувану користь: єдиний CLI entry point, відсутність дублювання між `flow` і `graph`, спрощена mental model для агентів і людей.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені команди: `flow init`, `flow spec`, `flow plan`, `flow verify`, `flow gate`, `flow review`, `flow run`, `flow resume`, `flow cancel`, `flow repair`, `flow release`. Файли що зникають: `.flow.json`, `docs/specs/`, `docs/plans/`. Рішення зафіксовано в `docs/думка.MD` (секція «Протокол виконання вузла») і `/memory/project_graph_flow_design.md`.

---

## ADR Двоетапне виконання вузла: `graph plan` (Stage 1) і Stage 2

## Context and Problem Statement
Попередній `flow` мав spec/plan/verify як окремі кроки. При переході до файлово-орієнтованого DAG виникло питання: як агент в ізольованому worktree знає чи треба атомарно виконати задачу, чи розбити її на дочірній граф.

## Considered Options
* `flow plan` (decompose) і `flow spec` (design) — два окремі кроки
* Один крок `graph plan` поєднує spec + decompose
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Один крок `graph plan` поєднує spec + decompose", because user підтвердив «спільний крок поєднуємо їх».

### Consequences
* Good, because transcript фіксує очікувану користь: агент ухвалює одне рішення і одразу пише `plan_001.md` (atomic) або дочірні `task.md` (composite); менше кроків — менше точок відмови.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Артефакт Stage 1: `plan_001.md` (numbered, immutable; front-matter: `decision: atomic | composite`). Stage 2: агент пише код → `outputs_NNN.md` → `graph done | graph audit | graph failed`. `flow verify` і `flow gate` — видалено (замінено async аудитом).

---

## ADR Атрибут `mode` в `task.md` та поведінка watch з human-режимом

## Context and Problem Statement
Деякі задачі потребують живого діалогу з людиною на етапі планування; headless `n-cursor watch` не може вести інтерактивний діалог. Потрібен механізм, щоб задати цей намір у spec задачі.

## Considered Options
* `mode: human` (default) — `watch` пропускає вузол, людина запускає `graph plan` вручну (Варіант A)
* `mode: human` — `watch` надсилає Telegram і чекає (Варіант B)
* `mode` зникає з `task.md`; хто перший запустить `graph plan` — той і планує (Варіант C)

## Decision Outcome
Chosen option: "`mode: human` — watch пропускає, людина запускає `graph plan` вручну (Варіант A)", because user вибрав «А».

### Consequences
* Good, because transcript фіксує очікувану користь: `watch` ніколи не блокується на human-взаємодії; `graph status` показує стан `human-pending` з підказкою.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`graph status` виводить іконку `⏳` для `human-pending` вузлів з підказкою `run: graph plan tasks/<node>/`. Watch надсилає Telegram-ескалацію якщо вузол стоїть понад `stale_worktree_sec`. `mode: agent` — watch запускає автономно.

---

## ADR Async аудит через `pending-audit_NNN.md` і `audit-result_NNN.md`

## Context and Problem Statement
Попередній `flow review` і `flow gate` були синхронними якісними гейтами всередині виконання. Нова архітектура потребує асинхронного, незалежного перегляду результатів вузла зовнішнім аудитором.

## Considered Options
* `flow verify` залишається як самоперевірка агента (гібрид: скрипт + LLM)
* Достатньо лише async аудиту з черги; `flow verify` зникає
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Достатньо лише async аудиту з черги; `flow verify` зникає", because user підтвердив «достатньо тільки аудиту з черги».

### Consequences
* Good, because transcript фіксує очікувану користь: аудит ізольований від виконавця — незалежний вердикт.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Протокол: агент → `graph audit <path>` → `pending-audit_NNN.md` (NNN = NNN відповідного `outputs_NNN.md`). `n-cursor watch` бачить `pending-audit` без `audit-result` → dispatch auditor subprocess → auditor пише `audit-result_NNN.md` (NNN збігається). `result: success` → watch робить merge + cleanup worktree. `result: failed` → worktree залишається; до 3 failed-циклів, потім ескалація. Auditor пише лише `audit-result_NNN.md` — окремий трек від `run_NNN.md` виконавців.

---

## ADR `n-cursor watch` як єдиний оркестратор; post-merge hook → trigger file

## Context and Problem Statement
Система мала два потенційних оркестратори: one-shot `graph run --auto` (з post-merge hook) і persistent `n-cursor watch` (daemon). Одночасний запуск обох міг спричинити race condition — два процеси намагаються запустити один вузол.

## Considered Options
* Advisory lock-файл `.n-cursor/orchestrator.lock` (Варіант A)
* Тільки `n-cursor watch` оркеструє; post-merge hook пише trigger file (Варіант B)
* Worktree як mutex через атомарний `mkdir` (Варіант C)

## Decision Outcome
Chosen option: "Тільки `n-cursor watch` оркеструє; post-merge hook пише trigger file (Варіант B)", because user вибрав «B».

### Consequences
* Good, because transcript фіксує очікувану користь: zero race condition — один процес spawns worktrees і робить merges.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`.git/hooks/post-merge`: `touch .n-cursor/wake`. `n-cursor watch` при старті і при появі `.n-cursor/wake` → сканує граф → spawns розблокованих. Watch також detects `audit-result_NNN.md (result: success)` → merge. `graph run --auto` прибирається з hook — hook більше нічого не виконує, лише будить daemon.

---

## ADR Composite вузол: стан — агрегація дочірніх, без `outputs_NNN.md`

## Context and Problem Statement
Вузли можуть бути або атомарними (виконують роботу самостійно) або composite (розкладаються на дочірній граф). Атомарні пишуть `outputs_NNN.md`. Composite не роблять власної роботи — але їх стан треба деривувати.

## Considered Options
* Implicit: стан composite = агрегація дітей; `outputs_NNN.md` у батька не потрібен (Варіант A)
* Roll-up агент: після завершення всіх дітей — запустити батька знову для агрегації (Варіант B)
* Останній merge тригерить автоматичний запис `outputs_NNN.md` батька (Варіант C)

## Decision Outcome
Chosen option: "Implicit: стан composite = агрегація дітей (Варіант A)", because user вибрав «A — фіксуємо що у нас або атомарний вузол, або має дочірній граф, стан такого вузла це агрегація цього графу».

### Consequences
* Good, because transcript фіксує очікувану користь: сканер деривує стан знизу вверх по ієрархії без додаткових артефактів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Таблиця станів composite: всі діти `resolved` → батько `resolved`; є `running`/`pending-audit` → `running`; є `failed` без `running` → `failed`; є `waiting` → `waiting`; sentinel `invalidated` у батьківській директорії → `invalidated`. Оркестратор (`n-cursor scan`) деривує стани листових вузлів першими, потім bottom-up по ієрархії.
