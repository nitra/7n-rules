---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-18T16:01:03+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR Перенесення worktree-lifecycle з `@nitra/cursor` у `@7n/mt`

## Context and Problem Statement

Логіка керування git-worktree (`worktree-cli.mjs`, `lib/worktree.mjs`) жила у пакеті `@nitra/cursor`. Паралельно існує окремий CLI-пакет `@7n/mt` (`mono`-тул) з task-graph і Rust-сканером, що вже **читав** активні worktree через `discover_worktrees`. Виникло питання: чи має `mt` стати власником worktree-lifecycle, щоб усі консумери спирались на один механізм, а cursor делегував у нього.

## Considered Options

* Перенести повний lifecycle (`create/list/remove/prune/inventory`) у `@7n/mt`, cursor видаляє власну реалізацію й залежить від `@7n/mt`
* Лишити lifecycle у `@nitra/cursor` без змін
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Перенести повний lifecycle у `@7n/mt`, cursor залежить від нього", because `@7n/mt` — опублікований CLI-пакет із платформними бінарниками; `mt` уже мав частковий worktree-observer для task-graph (`discover_worktrees`); cursor як загальний тул може залежати від `@7n/mt` без циклу (mt залежить від cursor лише як dev-синк правил, не runtime).

### Consequences

* Good, because transcript фіксує очікувану користь: єдина точка відповідальності за worktree-lifecycle в екосистемі; консумери cursor дістають worktree через `npx @7n/mt worktree create` без окремого `n-cursor worktree`; `mt` (task-graph) і cursor-скіли використовують одну й ту саму команду.
* Bad, because `@nitra/cursor` тепер прив'язаний до `@7n/mt` — кожен консумер cursor мусить мати `@7n/mt` транзитивно; transcript фіксує це як свідомо прийнятий coupling («приймаємо coupling загального тулу до mt-бінарника — так»).

## More Information

Спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`. Реалізовано: `@7n/mt@0.5.0` (команди `create|remove|list|prune|inventory`); cursor `@nitra/cursor@12.0.0` видаляє `scripts/worktree-cli.mjs`, `lib/worktree.mjs`, `skills/worktree/`; додає `@7n/mt: ^0.5.0` у deps; снипет `worktree-notice.mjs` та правило `worktree.mdc` перемкнені на `npx @7n/mt worktree create`. Commit у cursor: `a3bd3f72`; npx-фікс: `698c8889`.

---

## ADR JS-реалізація `mt worktree` замість Rust (benchmark)

## Context and Problem Statement

При проєктуванні переносу worktree-lifecycle у `@7n/mt` постало питання: реалізувати нові команди у Rust (крейт `mt-scanner`) чи лишити в JS. `@7n/mt` входить через Node-wrapper `bin/mt.js` → `runMtCli`; Rust-крейт `mt-scanner` використовується як окремий шим для FS-сканування.

## Considered Options

* Реалізувати worktree-lifecycle у Rust (через `mt-scanner`)
* Лишити/розширити наявний JS-код у `lib/commands/worktree.mjs`

## Decision Outcome

Chosen option: "JS-реалізація", because benchmark показав: Node-wrapper дає ~35 мс підлогу для будь-якого варіанта; JS-lifecycle (`mt worktree list` end-to-end) = ~63 мс; Rust-lifecycle через wrapper = ~70+ мс (додатковий subprocess); Rust був би вигідний лише за повної native-міграції всього `mt` CLI у Rust — окрема ініціатива.

### Consequences

* Good, because transcript фіксує очікувану користь: JS-варіант швидший на ~10 мс у поточній архітектурі з Node-wrapper; реалізація вже частково існувала (`lib/commands/worktree.mjs` з `add|remove|list`), вирівнювання дешевше за порт.
* Bad, because Neutral, because transcript не містить підтвердження негативного наслідку від вибору JS; повна native-міграція (`mt` у Rust end-to-end) залишається відкритою для майбутнього.

## More Information

Заміри (`/Users/vitalii/www/nitra/mt`): Rust `mt-scanner` старт ~10 мс; `git worktree list` ~11 мс; повний `mt worktree list` (Node-wrapper + JS) ~63 мс (медіана, 5 ітерацій). Тест-команда: `node --eval 'process.hrtime.bigint()…'`. Наявний `lib/commands/worktree.mjs` у mt вирівняний під контракт (`create/remove/list/prune/inventory`), 17/17 тестів (`npm/lib/commands/worktree.test.mjs`).

---

## ADR Ефемерна модель worktree: `remove` видаляє git-гілку

## Context and Problem Statement

cursor-реалізація `worktree remove` **лишала** git-гілку (worktree-checkout видалявся, але гілка залишалась для подальшого push/merge). `mt worktree remove` у наявній реалізації **видаляла** гілку разом з checkout. При переносі lifecycle у `mt` треба було зафіксувати одну семантику.

## Considered Options

* Лишати гілку (cursor-семантика; видалення — опт-ін `--delete-branch`)
* Ефемерна модель: `remove` видаляє і checkout, і гілку (наявна mt-семантика)

## Decision Outcome

Chosen option: "Ефемерна модель (видаляє гілку)", because user підтвердив: «worktree ефемерним» — тобто worktree в `mt` розглядаються як тимчасові ізоляції (task-graph-модель), не як довгоживучі feature-гілки.

### Consequences

* Good, because transcript фіксує очікувану користь: спрощена команда `remove` (без прапорів); узгоджено з task-graph-семантикою mt (worktree = тимчасовий робочий контекст).
* Bad, because Neutral, because transcript не містить підтвердження негативного наслідку; cursor-скіли, що комітять/пушать роботу в гілці до виклику `remove`, мусять це робити явно до `remove` — правило `worktree.mdc` не підкреслює цього явно.

## More Information

Команда `mt worktree remove <branch>` у `@7n/mt@0.5.0`: видаляє `git worktree remove .worktrees/<sanit>` + `git branch -D <branch>` + інвентарний `.worktrees/.meta/<sanit>.md`. Файл: `npm/lib/commands/worktree.mjs` у репо `nitra/mt`.
