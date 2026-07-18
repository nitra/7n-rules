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
