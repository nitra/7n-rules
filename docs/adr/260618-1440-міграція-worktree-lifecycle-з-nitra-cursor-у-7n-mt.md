---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-18T14:40:40+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR Міграція worktree-lifecycle з @nitra/cursor у @7n/mt

## Context and Problem Statement
Підсистема керування git-worktree (`worktree-cli.mjs`, `lib/worktree.mjs`, `skills/worktree/`) жила в `@nitra/cursor`, а `@7n/mt` (task-graph тул) вже spoживав worktree як вхідний сигнал (`mt-scanner discover_worktrees`). Цей поділ ставав нелогічним: mt потребує worktree-lifecycle, а cursor — загальний тул, що тягне вузькоспеціалізовану підсистему.

## Considered Options
* Перенести повний worktree-lifecycle у Rust-крейт `mt-scanner` у `@7n/mt`
* Вирівняти наявний JS `mt worktree` у `@7n/mt` під новий контракт (відкрито під час розвідки: команда вже існувала)
* Залишити підсистему у `@nitra/cursor`

## Decision Outcome
Chosen option: "Вирівняти наявний JS `mt worktree` під контракт і перенести lifecycle у `@7n/mt`", because бенчмарк (2026-06-18) довів, що Rust-варіант через Node-wrapper `bin/mt.js` дав ~70+ мс (Node-старт ~35 мс + spawn Rust ~10 мс + git ~11 мс) — повільніше за JS (`mt worktree list` ~63 мс); Rust має сенс лише при повній native-міграції CLI mt, а `@7n/mt` уже мав JS-команду `add|remove|list`, яку достатньо вирівняти.

### Consequences
* Good, because transcript фіксує очікувану користь: `@nitra/cursor` звільняється від worktree-implementation-details; `@7n/mt` стає canonical власником lifecycle, а scanner-discovery та dev-команда використовують спільну конвенцію `.worktrees/`.
* Bad, because `@nitra/cursor` тепер має runtime-залежність від `@7n/mt` (platform binaries `@7n/mt-{darwin-arm64,linux-x64}`), що прив'язує загальний тул до конкретного бінарника екосистеми.

## More Information
- Спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`
- `@7n/mt` pub: 0.5.0 (`mt worktree create|remove|list|prune|inventory`); лінт-чистий 0.5.1
- Видалено з cursor: `npm/scripts/worktree-cli.mjs`, `npm/scripts/lib/worktree.mjs`, тести, `npm/skills/worktree/`, `case 'worktree'` у `bin/n-cursor.js`, `'worktree'` з `npm/types/n-cursor.d.ts`
- Перемкнено: `worktree-notice.mjs` (preflight-снипет worktree-only скілів) → `mt worktree create`; ETARGET-retry-обгортка `n_cursor_npx` прибрана; bootstrap = `bun install`
- Контракт: `create` (не `add`), без зворотної сумісності; інвентар `.worktrees/.meta/<sanit>.md`; `remove` ефемерний (видаляє гілку); `firstFreeBranch` для колізій; dirty-notice ≤10 файлів
- Коміт cursor: `a3bd3f72`; коміт mt: `64997ed`, `f55a556`

---

## ADR JS замість Rust для worktree-lifecycle у @7n/mt (бенчмарк)

## Context and Problem Statement
Спека спочатку передбачала портування `worktree-cli.mjs` у Rust-крейт `mt-scanner`. Перед реалізацією потрібно було перевірити, чи Rust дійсно дасть виграш на `mt`-архітектурі з Node-wrapper entry-point.

## Considered Options
* Rust-реалізація через `std::process::Command` у крейті `mt-scanner`
* JS-реалізація у `npm/lib/commands/worktree.mjs` (наявна, під вирівнювання)

## Decision Outcome
Chosen option: "JS-реалізація", because бенчмарк довів: `mt` входить через `bin/mt.js` → `runMtCli` (Node-wrapper), що додає незнімну підлогу ~50 мс; Rust-subprocess поверх цього додає ще ~10 мс замість економити. JS-варіант швидший (~63 мс vs ~70+ мс) і вже реалізований.

### Consequences
* Good, because transcript фіксує очікувану користь: відсутність зайвого spawn-процесу; Rust-порт = робота без виграшу при поточній архітектурі.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо майбутньої нативної Rust-міграції CLI mt.

## More Information
- Бенчмарк (2026-06-18): Rust `mt-scanner` noop ~10 мс, `git worktree list` ~11 мс, повний `mt worktree list` (JS) ~63 мс
- Node cold start ~35 мс — домінує в обох варіантах
- Повна native-міграція CLI mt (без Node-wrapper) дала б ~21 мс, але це окрема ініціатива поза scope
- Команда `worktree` у `npm/lib/commands/worktree.mjs` (JS); `mt-scanner` Rust — лише task-graph scanner
