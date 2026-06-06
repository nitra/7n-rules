---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T20:27:22+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR Уніфікований `run_NNN.md` — єдиний immutable файл на спробу

## Context and Problem Statement
Система динамічного графу задач потребувала зберігати результати роботи вузлів (успішні та неуспішні), журнал ремонтних спроб інженера і технічні деталі збоїв. Попередній дизайн мав окремі файли: `outputs.md` (append-only), `error.md` (append-only), `repair_history.md` (append-only). Їх наявність суперечила загальному принципу системи: під час роботи файли лише створюються і є immutable.

## Considered Options
* Три окремих append-only файли: `outputs.md`, `error.md`, `repair_history.md`
* Єдиний immutable numbered файл `run_NNN.md` на кожну спробу будь-якого актора

## Decision Outcome
Chosen option: "Єдиний immutable numbered файл `run_NNN.md`", because будь-яка спроба (агент, інженер, людина, аудитор) є семантично однаковою — "спробою розв'язати вузол" — і описується одним набором полів: `actor`, `result`, `## Reasoning`, `## Script`, `## Ref`.

### Consequences
* Good, because transcript фіксує очікувану користь: відпадає append-only виняток — всі файли в системі однаково immutable; менше типів файлів для парсингу скриптами.
* Bad, because `## Reasoning` для інженера змішує "чому такий підхід" і "що саме змінив у графі" в одній секції без жорсткої структури.

## More Information
Схема `run_NNN.md` (фронтматер + секції):
```
created_at, actor: agent|engineer|human|auditor, result: success|failed
## Reasoning   (обов'язково)
## Script      (необов'язково, wrapper; exit_code, stderr)
## Ref         (необов'язково; ref: outputs_NNN.md або шлях файлу)
```
NNN = `count(run_*.md) + 1`, zero-padded до 3 цифр — рахує wrapper перед стартом. Файл `/Users/vitaliytv/www/nitra/cursor/docs/думка.MD`, секція `run_NNN.md`.

---

## ADR Inputs об'єднані у `task.md`

## Context and Problem Statement
Перший дизайн передбачав два окремих файли на вхід вузла: `task.md` (місія) і `inputs.md` (посилання на дані від батька). Агент мав читати обидва файли перед роботою.

## Considered Options
* `task.md` + окремий `inputs.md`
* `task.md` з вбудованою секцією `## Inputs`

## Decision Outcome
Chosen option: "`task.md` з `## Inputs`", because агент читає один файл замість двох; task і дані завжди разом — контекст цілісний. Занепокоєння щодо неможливості патчити inputs незалежно від місії відкинуто: інженер зупиняє ворктрі і редагує `task.md` вільно — жодного `task-v2.md` не потрібно.

### Consequences
* Good, because transcript фіксує очікувану користь: спрощення spawn (один файл замість двох), агент завжди бачить повний контекст одним читанням.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Поле `budget_sec` також розміщено у фронтматері `task.md` (замість окремого `repair_context.md`). Синтаксис секції `## Inputs` → підсекції `### <name>` з `ref: <path>` або inline-текстом. Файл `docs/думка.MD`, секція `task.md`.

---

## ADR Автоматичний тригер наступника через git `post-merge` hook

## Context and Problem Statement
Після завершення роботи вузла в ізольованому git-worktree система потребує механізму для автоматичного запуску наступних розблокованих вузлів. Розглядались варіанти з різним ступенем автоматизації та різним місцем знаходження логіки оркестрації.

## Considered Options
* A: людина вручну запускає кожен вузол після merge
* B: `graph run` є демоном, сам чекає merge і запускає наступників
* C: wrapper авто-мержить після успіху → git `post-merge` hook → `graph run --auto`

## Decision Outcome
Chosen option: "C — git `post-merge` hook", because кожен компонент виконує одне завдання: `graph run` залишається one-shot командою, merge — відповідальність wrapper-скрипта, оркестрація продовження — відповідальність git-інфраструктури.

### Consequences
* Good, because transcript фіксує очікувану користь: людина лише запускає кореневий вузол — далі система автоматично до кінця або до `failed`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Ланцюг: агент завершує → wrapper пише `run_NNN.md` → wrapper виконує `git merge` → git `post-merge` hook → `graph run --auto` (сканує граф, знаходить `deps=resolved`, запускає паралельно з лімітом `max_worktrees`). Файл `docs/думка.MD`, секції "Wrapper-скрипт" і "CLI контракт".

---

## ADR Видалення `ops/` та `patches/` директорій

## Context and Problem Statement
Дизайн передбачав директорії `ops/` (файли `spawn-plan-<ts>.md`, `spawn-fact-<ts>.md`, `kill-plan-<ts>.md`, `kill-fact-<ts>.md`) і `patches/` (`NNN-plan.md`, `NNN-fact.md`) для WAL-відновлення після збою mid-operation. Ці файли реалізовували патерн plan→action→fact для crash recovery.

## Considered Options
* Зберегти `ops/` і `patches/` для crash recovery
* Прибрати обидві директорії, ігнорувати сценарій crash-in-progress

## Decision Outcome
Chosen option: "Прибрати `ops/` і `patches/`", because якщо spawn відбувається всередині ізольованого worktree і мержиться атомарно — неповний spawn просто не потрапить у main; worktree відкидається цілком. Сценарій часткового запису вважається малоймовірним у поточному контексті.

### Consequences
* Good, because transcript фіксує очікувану користь: файлова структура вузла зведена до мінімуму (`task.md`, `invalidated`, `run_*.md`, `outputs_*.md`); менше файлів для парсингу.
* Bad, because якщо spawn відбуватиметься поза worktree (наприклад, у `main` безпосередньо) — crash recovery механізм відсутній.

## More Information
Інформація про зміни інженера переміщена в `## Reasoning` секцію `run_NNN.md`. Деталі патчів (що саме змінено у графі) інженер описує вільним текстом у `## Reasoning`. Файл `docs/думка.MD`, секція "Файлова структура вузла".

---

## ADR `graph kill` як єдина команда каскадної інвалідації

## Context and Problem Statement
При патчуванні вузла, що вже виконується, необхідно: зупинити процес у worktree, видалити worktree, і позначити всіх наступників як застарілих (`invalidated`). Постало питання чи ці відповідальності має нести одна команда або кілька окремих.

## Considered Options
* `graph kill` = тільки kill + delete; окрема `graph invalidate --cascade` для позначення
* `graph kill` = kill + delete + cascade `invalidated` в одній транзакції

## Decision Outcome
Chosen option: "`graph kill` об'єднує всі три кроки", because атомарність важливіша за розподіл відповідальностей — часткове виконання (kill без cascade) лишає граф у невизначеному стані де наступники не знають що їх predecessor змінився.

### Consequences
* Good, because transcript фіксує очікувану користь: неможливо "забути" cascade після kill — операція або повністю виконана або не починалась.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`graph kill` виявляє процеси для знищення за `cwd` ворктрі (не через lock-файл з PID). Топологічний порядок знищення: листи першими. `invalidated` — порожній sentinel-файл у директорії кожного наступника. Файл `docs/думка.MD`, секції "Каскад інвалідації" і "CLI контракт".
