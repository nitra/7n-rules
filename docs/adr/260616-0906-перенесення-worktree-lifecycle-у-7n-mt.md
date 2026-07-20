---
type: ADR
title: Перенесення worktree-lifecycle у @7n/mt
description: Git-worktree lifecycle стає відповідальністю `@7n/mt`, а `@nitra/cursor` має перейти на `mt worktree` замість власної реалізації.
---

**Status:** Accepted

**Date:** 2026-06-16

## Context and Problem Statement

`n-cursor worktree` у `@nitra/cursor` реалізовував lifecycle git-worktree: create/list/remove/prune, інвентарні `.md`-файли, dirty-notice і обробку колізій імен. Паралельно `@7n/mt` уже мав worktree-discovery для task-graph і часткову JS-реалізацію `mt worktree add|remove|list`. Тримати lifecycle у cursor та discovery у mt означало дублювання відповідальності й некогерентний контракт для task-graph.

## Considered Options

- Перенести повний lifecycle у `@7n/mt` і зробити cursor тонкою обгорткою або споживачем `mt worktree`.
- Залишити lifecycle у `@nitra/cursor`.
- Перенести реалізацію в Rust-крейт `scanner` у `mt`.
- Вирівняти наявний JS `mt worktree` під узгоджений контракт.

## Decision Outcome

Chosen option: "Вирівняти наявний JS `mt worktree` під узгоджений контракт", because transcript зафіксував, що `mt` входить через Node-wrapper із незмінною підлогою близько 35 ms, тому Rust-spawn додав би зайвий процес і складність без суттєвої користі. JS-шлях достатній для lifecycle-команд, а `@7n/mt` є природним власником worktree lifecycle поруч із discovery.

### Consequences

- Good, because lifecycle і discovery worktree концентруються в одному інструменті `@7n/mt`.
- Good, because `@nitra/cursor` зможе прибрати власні `worktree-cli.mjs`, `lib/worktree.mjs`, bin-команду і worktree-skill, перейшовши на `mt worktree`.
- Good, because узгоджений контракт включає `create|remove|list|prune|inventory`, layout `.worktrees/.meta/<sanit>.md`, `firstFreeBranch` і dirty-notice з переліком файлів.
- Bad, because `@nitra/cursor` набуває залежності від `@7n/mt`, і цей зовнішній бінарник стає вимогою для консумерів cursor.
- Neutral, because worktree лишається ефемерним: `remove` видаляє гілку, що відповідає наявній mt-семантиці.

## More Information

Спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`.

Цільовий layout: `.worktrees/<sanit>/` для checkout і `.worktrees/.meta/<sanit>.md` для інвентарю. Цільові команди: `mt worktree create <branch> "<desc>"`, `list`, `remove <branch> [--force]`, `prune`, `inventory`.

Sequencing: спершу release `@7n/mt` з worktree-lifecycle, потім міграція `@nitra/cursor` на опубліковану версію. Файли mt з transcript: `npm/lib/commands/worktree.mjs`, `npm/lib/commands/worktree.test.mjs`, `npm/lib/cli.mjs`. Changeset mt: `npm/.changes/260616-1404.md`.

## Update 2026-06-15

Ранній аналіз зафіксував несумісність контрактів: `cursor worktree add` приймав user-provided branch і створював `.worktrees/<sanit>/` плюс `.md`-опис, тоді як `mt createWorktree` був task-oriented і тяжів до `mt/<taskName>`. Обраний напрям — зробити `mt worktree` canonical для cursor-контракту, а cursor лишити тонкою обгорткою або fallback. Transcript також зафіксував питання, які потребували рішення: user-named branch проти `mt/<name>`, перенесення `.md`-опису в mt, і послідовність реалізації через mt перед cursor-міграцією.

## Update 2026-06-16

Draft додав повніше формулювання рішення про перенесення worktree-lifecycle: `@7n/mt` має стати власником create/list/remove/prune/inventory, а cursor-скіли мають кликати `mt worktree` напряму. Зафіксовано цільовий layout: checkout лишається в `.worktrees/<sanit>/`, інвентар переноситься в `.worktrees/.meta/<sanit>.md`. Також зафіксовано sequencing: спершу publish `@7n/mt` з worktree-lifecycle, потім міграція cursor.

## Update 2026-06-16

Уточнено реалізаційний вердикт: Rust для `mt worktree` не потрібен, бо Node-wrapper уже дає приблизно 35 ms старту, а Rust-spawn додає процес і складність. Дельта до контракту mt: `add` перейменувати на `create`, інвентар перенести з `.worktrees/<sanit>.md` у `.worktrees/.meta/<sanit>.md`, додати `firstFreeBranch`, покращити dirty-notice, додати `prune` та `inventory`. Worktree лишається ефемерним: `remove` видаляє гілку.

## Update 2026-06-16

Step 1 вирівнювання `mt worktree` завершено: `add` перейменовано на `create` без compatibility alias, `remove` лишився ефемерним і видаляє гілку, додано `prune` та `inventory`, інвентар перенесено в `.worktrees/.meta/<sanit>.md`, додано `firstFreeBranch` з auto `base2/base3` при колізії та dirty-notice з переліком файлів. Transcript фіксує результат: 17/17 тестів у mt, ESLint без errors, changeset `260616-1404.md`. Наступний крок — cursor-міграція на `mt worktree`.

## Update 2026-06-18

- Cursor-скіли мають викликати `mt worktree` напряму без проміжного shim у `@nitra/cursor`.
- Для реалізації lifecycle у `@7n/mt` обрано JS-шар, а не Rust-крейт `mt-scanner`: transcript фіксує benchmark, де `mt worktree list` через JS приблизно 63 мс, а Rust через Node-wrapper очікувано 70+ мс через додатковий subprocess.
- Семантика `mt worktree remove` лишається ефемерною: checkout і git-гілка видаляються разом.
- Додатково transcript зафіксував окреме уточнення для LLM-fix: `meta.json: llmFix true` має бути реальним opt-in, а не неявною поведінкою для всіх правил у non-read-only режимі.

## Update 2026-06-18

- Міграція прибирає з cursor `scripts/worktree-cli.mjs`, `scripts/lib/worktree.mjs`, `skills/worktree/`, `case 'worktree'` у `bin/n-cursor.js` і переносить canonical lifecycle у `@7n/mt`.
- `@nitra/cursor` отримує runtime-залежність від `@7n/mt`; transcript фіксує ризик для consumers через optional platform binaries `@7n/mt-darwin-arm64` і `@7n/mt-linux-x64`.
- Контракт `mt worktree` включає `create|remove|list|prune|inventory`; sequencing: спершу публікація `@7n/mt@0.5.0`, потім cursor-міграція.
- Для Rust vs JS рішення зафіксовано benchmark: Rust startup приблизно 10 мс, `git worktree list` приблизно 11 мс, повний JS-wrapper шлях приблизно 63 мс; Rust через wrapper не дає виграшу.

## Update 2026-06-18

- Під час розвідки виявлено, що `@7n/mt` уже мав JS-команду `npm/lib/commands/worktree.mjs`; тому рішення змінилось із портування в Rust на вирівнювання наявної JS-команди під контракт.
- `create` є канонічною командою замість `add`; зворотну сумісність transcript не фіксує як потрібну.
- Інвентар worktree зберігається в `.worktrees/.meta/<sanit>.md`; `remove` має ефемерну семантику й видаляє гілку.
- Додаткові факти transcript: `@7n/mt` pub 0.5.0 з `mt worktree create|remove|list|prune|inventory`, lint-чистий 0.5.1; cursor-коміт `a3bd3f72`, mt-коміти `64997ed`, `f55a556`.

## Update 2026-06-18

- Фінальний контракт `mt worktree`: `create|remove|list|prune|inventory`.
- Реалізацію lifecycle залишено в JS (`npm/lib/commands/worktree.mjs`), а не перенесено в Rust, бо benchmark із transcript показав: Rust noop ~10 ms, `git worktree list` ~11 ms, повний `mt worktree list` через Node-wrapper ~63 ms, а Rust-via-wrapper оцінено як ~70+ ms через додатковий subprocess.
- `remove` зафіксовано як ефемерну операцію: видаляє checkout, git-гілку та інвентарний `.worktrees/.meta/<sanit>.md`.
- `@nitra/cursor` видалив власні `npm/scripts/worktree-cli.mjs`, `npm/scripts/lib/worktree.mjs`, `npm/skills/worktree/` і делегує створення worktree через `npx @7n/mt worktree create`.
- `@nitra/cursor` отримав runtime dependency `@7n/mt: ^0.5.0`; transcript фіксує прийнятий coupling до `@7n/mt` без runtime-циклу.
- Опубліковано `@7n/mt@0.5.0` / `0.5.1` і `@nitra/cursor@12.0.0`; npx-fix вийшов як `12.0.1`.
- Дизайн-спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`.
