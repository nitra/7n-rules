---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-18T15:50:16+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR Перенесення worktree-lifecycle із @nitra/cursor у @7n/mt

## Context and Problem Statement

`@nitra/cursor` містив повноцінну worktree-підсистему (`worktree-cli.mjs`, `lib/worktree.mjs`, скіл `skills/worktree/`), яка відповідала за lifecycle git-worktree (create/list/remove/prune). Репо `mt` (`@7n/mt`) — новий монорепо-тул, який у своїй task-graph-підсистемі використовує worktree як вхідний сигнал (discovery). Виникла ініціатива перенести worktree-lifecycle у `@7n/mt` і зробити cursor залежним від нього.

## Considered Options

* Портувати lifecycle у Rust (новий `mt-scanner`-субкоманд)
* Вирівняти наявний JS `mt worktree` (розширити `commands/worktree.mjs`, який уже існував у mt)
* Зберегти lifecycle у cursor без змін

## Decision Outcome

Chosen option: "Вирівняти наявний JS `mt worktree`", because:
- mt **уже мав** `mt worktree add|remove|list` у `npm/lib/commands/worktree.mjs` — не greenfield;
- бенчмарк JS vs Rust показав: Node-wrapper (~35 мс) є підлогою в обох варіантах; Rust-via-wrapper додає spawn (~10 мс) і стає **повільнішим** (JS: ~63 мс, Rust-via-wrapper: ~70+ мс);
- `@nitra/cursor` → `@7n/mt` залежність не утворює циклу (`mt` залежить від cursor лише як dev-sync правил, не рантайм).

Прийнятий контракт: `create|remove|list|prune|inventory`; ефемерний remove (видаляє гілку); інвентар у `.worktrees/.meta/<sanit>.md`; `firstFreeBranch` для колізій; `npx @7n/mt worktree create` як точка виклику.

### Consequences

* Good, because transcript фіксує очікувану користь: worktree-lifecycle консолідовано в `@7n/mt`; cursor-скіли (`n-adr-normalize`, `n-coverage-fix`, `n-taze`, `n-lint`, `n-docgen`) тепер спираються на опублікований CLI-пакет замість внутрішньої команди; cursor-код звільнено від `worktree-cli.mjs`/`lib/worktree.mjs` (~2 модулі + тести).
* Bad, because `@nitra/cursor` відтепер залежить від `@7n/mt` — кожен консумер cursor транзитивно тягне `@7n/mt` і платформні бінарники `@7n/mt-{darwin-arm64,linux-x64}`.

## More Information

- Дизайн-спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`
- mt реалізація: `npm/lib/commands/worktree.mjs`, `npm/lib/commands/worktree.test.mjs` (17/17)
- cursor міграція: видалено `npm/scripts/worktree-cli.mjs`, `npm/scripts/lib/worktree.mjs`, `npm/skills/worktree/`; знято `case 'worktree'` з `npm/bin/n-cursor.js`; правило `npm/rules/worktree/worktree.mdc` перемкнуто на `npx @7n/mt worktree create`; `@7n/mt: ^0.5.0` додано у deps
- cursor changeset: `major` (Removed), реліз `@nitra/cursor@12.0.0`; npx-фікс → `12.0.1`
- mt: `@7n/mt@0.5.0` (breaking-rename `add`→`create`), `0.5.1` (lint-fix) — обидва опубліковані
- Бенчмарк: Rust noop ~10 мс, `git worktree list` ~11 мс, повний `mt worktree list` (Node-wrapper) ~63 мс; Rust-via-wrapper повільніший через зайвий spawn
- `mt` у консумерів резолвиться через `npx @7n/mt` (локальний, через node_modules), не bare `mt`
