---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-18T14:37:35+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR Перенесення worktree-lifecycle із @nitra/cursor у @7n/mt

## Context and Problem Statement
`@nitra/cursor` містив повну реалізацію worktree-lifecycle (`scripts/worktree-cli.mjs`, `lib/worktree.mjs`). `@7n/mt` (пакет `mono`) потребує worktree як вхідний сигнал для task-graph (Rust-scanner `discover_worktrees`/`worktree_matches`), але сам не керував lifecycle. Зберігати дублюючу реалізацію в cursor і будувати `mt` на scanner-discovery без lifecycle-команди вважалося неефективним.

## Considered Options
* Перенести worktree-lifecycle у `@7n/mt`, cursor спирається на `mt worktree`
* Залишити lifecycle у `@nitra/cursor`, `mt` лише читає worktree через git

## Decision Outcome
Chosen option: "Перенести worktree-lifecycle у `@7n/mt`, cursor спирається на `mt worktree`", because користувач підтвердив, що `@nitra/cursor` може залежати від `@7n/mt`, а `mt` вже мав `lib/commands/worktree.mjs` (add/remove/list, JS) і потребував lifecycle як примітиву екосистеми. cursor-скіли викликають `mt worktree` напряму без проміжного шиму.

### Consequences
* Good, because transcript фіксує очікувану користь: worktree-lifecycle consolidовано в `@7n/mt`, cursor позбувся `worktree-cli.mjs`/`lib/worktree.mjs`/тестів/скіла, `mt worktree create|remove|list|prune|inventory` — єдина точка правди.
* Bad, because `@nitra/cursor` — загальний тул, тепер кожен його споживач матиме транзитивну залежність від `@7n/mt`; бінарні `@7n/mt-{darwin-arm64,linux-x64}` — optional-deps, кросс-платформність залежить від їхньої публікації.

## More Information
Спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`. Sequencing: спершу публікується `@7n/mt@0.5.0` із новим контрактом, потім cursor-міграція. Видалено: `scripts/worktree-cli.mjs`, `scripts/lib/worktree.mjs`, `skills/worktree/`, `case 'worktree'` з `bin/n-cursor.js`. Додано: `"@7n/mt": "^0.5.0"` у `npm/package.json` deps. Changeset cursor: `npm/.changes/260618-1431.md` (major, Removed).

---

## ADR JS замість Rust для worktree-lifecycle у @7n/mt

## Context and Problem Statement
Спека спочатку передбачала портування worktree-lifecycle у Rust-крейт `mt-scanner`. У `@7n/mt` вже існував JS-варіант (`lib/commands/worktree.mjs`), а `mt-scanner` — окремий Rust-крейт для швидкого FS-скану task-graph. Потрібно було визначити, де реалізувати новий worktree-lifecycle — JS чи Rust.

## Considered Options
* Залишити/розширити JS-команду `lib/commands/worktree.mjs`
* Портувати lifecycle у Rust-крейт `mt-scanner`

## Decision Outcome
Chosen option: "Залишити/розширити JS-команду", because проведений бенчмарк показав: `@7n/mt` входить через Node-wrapper `bin/mt.js` (~35 мс), який присутній в обох варіантах. Rust-бінарник через wrapper (~10 мс startup) додає зайвий subprocess поверх неминучого Node-старту → JS-via-wrapper (~63 мс) швидше за Rust-via-wrapper (~70+ мс). Rust мав би сенс лише за повної native-міграції всього `mt` CLI.

### Consequences
* Good, because transcript фіксує очікувану користь: JS-варіант — і швидший (без зайвого spawn), і вже реалізований; git-оркестрація I/O-bound, Rust не дає виграшу за наявного Node-wrapper.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — швидкість worktree create/remove вимірювалась непрямо (через wrapper); нативна CLI-міграція mt залишається відкритим напрямом.

## More Information
Заміри (darwin-arm64, warm): Rust `mt-scanner` startup ~10 мс; `git worktree list` ~11 мс; повний `mt worktree list` (Node-wrapper + JS) ~63 мс. Бенчмарк проведено локально через `node -e 'const t=process.hrtime.bigint(); execSync(...); console.error(...)'`. Rust-крейт `scanner/src/lib.rs` містить `sanitize_branch` і `discover_worktrees` — використовуються task-graph scanner'ом, не lifecycle CLI.

---

## ADR Ефемерна семантика mt worktree remove

## Context and Problem Statement
`@nitra/cursor worktree remove` за конвенцією **лишав** git-гілку після видалення checkout'у (worktree — ізольований workspace, але гілка залишалась для коміту/пушу). `@7n/mt` вже мав `worktree remove`, яке **видаляє** гілку (`git branch -D`). Потрібно визначити, яку семантику прийняти при вирівнюванні.

## Considered Options
* Worktree ефемерний — `mt worktree remove` видаляє гілку (наявна mt-поведінка)
* Worktree неефемерний — `remove` лишає гілку, видалення через опт-ін `--delete-branch`

## Decision Outcome
Chosen option: "Worktree ефемерний — `mt worktree remove` видаляє гілку", because користувач явно підтвердив: «worktree ефемерним» — наявна mt-поведінка коректна. cursor-конвенція переходить під mt-модель task-graph, де worktree — тимчасовий ізольований контекст роботи.

### Consequences
* Good, because Neutral, because transcript не містить підтвердження наслідку — користувач прийняв модель без деталізації workflow.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано у `npm/lib/commands/worktree.mjs` у репо `mono`. Тести: `npm/lib/commands/worktree.test.mjs`, 17/17. Інвентар: `.worktrees/.meta/<sanit>.md` (видаляється разом із checkout при `remove`).
