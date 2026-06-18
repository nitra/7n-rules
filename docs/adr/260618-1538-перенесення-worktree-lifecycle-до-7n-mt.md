---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-18T15:38:22+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

Let me trace through what happened in this session to produce accurate ADRs.

## ADR Перенесення worktree-lifecycle до @7n/mt

## Context and Problem Statement
Команда виявила, що `@nitra/cursor` містить повну worktree-підсистему (`worktree-cli.mjs`, `lib/worktree.mjs`, `skills/worktree/`), тоді як `@7n/mt` — окремий монорепо-тул — потребує механізмів роботи з git-worktree для свого task-graph. Постало питання, чи є сенс перенести lifecycle-керування worktree (create/remove/list/prune) до `@7n/mt`, щоб cursor спирався на нього як на авторитетне джерело.

## Considered Options
* Перенести worktree-lifecycle до `@7n/mt`, cursor делегує туди напряму
* Лишити worktree-підсистему у cursor без змін
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести worktree-lifecycle до `@7n/mt`, cursor делегує туди напряму", because `@7n/mt` вже має worktree-discovery для task-graph і є опублікованим пакетом без циклічної залежності з cursor.

### Consequences
* Good, because transcript фіксує очікувану користь: `mt worktree` стає єдиним власником lifecycle-керування, cursor-підсистема прибирається (видалено `worktree-cli.mjs`, `lib/worktree.mjs`, тести, `skills/worktree/`).
* Bad, because `@nitra/cursor` — загальний тул — тепер залежить від `@7n/mt`; кожен консумер cursor мусить мати `@7n/mt`. Виявлено неузгодженість: снипет preflight кличе bare `mt` (глобальний резолв), а cursor водночас додав `@7n/mt` до `dependencies` (локальний резолв) — на момент завершення сесії вирішення не підтверджено.

## More Information
Спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`. Комміт у mt: `64997ed` та `f55a556`; комміт у cursor: `a3bd3f72` (27 файлів). Опубліковано `@7n/mt@0.5.0`/`0.5.1` та `@nitra/cursor@12.0.0`. Виявлено: `@7n/mt` відсутній у `bun.lock` cursor — потребує `bun install` поза sandbox та коміту lock.

---

## ADR Вибір JS замість Rust для mt worktree lifecycle

## Context and Problem Statement
При проєктуванні переносу worktree-lifecycle до `@7n/mt` постало питання мови реалізації: Rust (як `mt-scanner`) чи JS (як наявний `commands/worktree.mjs`). Вирішено провести бенчмарк.

## Considered Options
* Реалізація у JS (розширити наявний `npm/lib/commands/worktree.mjs`)
* Реалізація у Rust (новий модуль у крейті `scanner`)

## Decision Outcome
Chosen option: "Реалізація у JS", because бенчмарк показав: `mt` входить через Node-wrapper (`bin/mt.js` → `runMtCli`), що дає підлогу ~50 мс; додавання Rust-subprocess поверх нього збільшило б затримку (~70+ мс), тоді як JS-варіант показав ~63 мс — на ~10% швидше, без зайвого spawn-процесу.

### Consequences
* Good, because transcript фіксує очікувану користь: відсутність зайвого Rust-subprocess-spawn; наявна реалізація `commands/worktree.mjs` вже мала `sanitizeBranch` синхронізований з Rust `sanitize_branch`.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — Rust залишається лише для `mt-scanner` FS-scan, а не lifecycle.

## More Information
Числа бенчмарку з transcript: Rust `mt-scanner` noop ~10 мс, `git worktree list` ~11 мс, повний `mt worktree list` через Node-wrapper ~63 мс. Вимір виконано командою `node -e 'const t=process.hrtime.bigint()…'` у `/Users/vitalii/www/nitra/mt`.

---

## ADR Семантика видалення worktree — ефемерна (гілка видаляється)

## Context and Problem Statement
Наявна `mt worktree remove` видаляла git-гілку (`git branch -D`), тоді як `n-cursor worktree remove` лишала її. При перенесенні треба було вибрати одну семантику.

## Considered Options
* Ефемерна семантика: `remove` видаляє і checkout, і git-гілку (поведінка mt)
* Неефемерна семантика: `remove` видаляє лише checkout, гілку лишає (поведінка cursor)

## Decision Outcome
Chosen option: "Ефемерна семантика: `remove` видаляє і checkout, і git-гілку", because користувач підтвердив, що worktree у цій системі вважається ефемерним.

### Consequences
* Good, because Neutral, because transcript не містить підтвердження наслідку — ефемерна семантика відповідає task-graph-моделі mt, де worktree — тимчасовий контекст задачі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Рішення зафіксовано у спеці `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`. Наявна `commands/worktree.mjs` у mt лишена без змін у частині `git branch -D`.

---

## ADR Іменування команд mt worktree та скасування зворотної сумісності

## Context and Problem Statement
При вирівнюванні `mt worktree` під контракт треба було вирішити: зберегти стару назву `add` (як в оригінальному `mt worktree add`) або перейменувати на `create`, і чи потрібні аліаси для зворотної сумісності.

## Considered Options
* Перейменувати `add` → `create`, без аліасів (breaking)
* Лишити `add`, додати `create` як аліас

## Decision Outcome
Chosen option: "Перейменувати `add` → `create`, без аліасів (breaking)", because користувач явно вказав, що зворотна сумісність не потрібна.

### Consequences
* Good, because Neutral, because transcript не містить підтвердження наслідку — ім'я `create` більш явне і відповідає CRUD-конвенції.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фінальні команди: `mt worktree create <branch> "<опис>"`, `mt worktree remove <branch>`, `mt worktree list`, `mt worktree prune`, `mt worktree inventory`. Хелп у `npm/lib/cli.mjs` (рядок 71) оновлено. Changeset `npm/.changes/260616-1404.md` (minor у 0.x) та `npm/.changes/260618-HHMM.md` (patch).
