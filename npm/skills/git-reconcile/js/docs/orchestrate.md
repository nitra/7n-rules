---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: f0c9ea76
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 70
---

## Огляд

Модуль узгоджує Git branches, worktree і stash зі свіжим `origin/main`.
JS виконує inventory, validation, materialization, gates, PR і cleanup, а LLM
отримує лише bounded semantic triage, conflict resolution та behavioral edits.

## Поведінка

- Збирає refs, aliases, worktree, open PR, patch-equivalent commits і stash.
  Detached worktree захищає за checkout HEAD OID.
- Ізолює вкладені `npx` від `npm_config_package` зовнішнього `npm exec`.
- Приглушує дубльовані ACP events, якщо користувач не ввімкнув explicit verbose.
- Показує inventory elapsed time та окремі progress bars для triage, PR і
  cleanup; довгі deterministic gates отримують окремі stage labels.
- Перевіряє повноту triage, groups та commit OID. `max` запускається лише після
  конкретного провалу validation.
- Створює worktree від `origin/main`; baseline tests кешує за OID бази між
  PR-групами. Для змін без code paths behavioral LLM не викликається.
- Red baseline допускається лише для розпізнаних Vitest failures без нових
  failures після перенесення.
- Для code paths запускає scoped `doc-files`, lint і tests. Перед push запускає
  domain lint для non-code paths, changelog та `git diff --check`.
- Після conflict resolution порожній cherry-pick пропускається лише за
  активного `CHERRY_PICK_HEAD`, відсутніх conflicts і порожнього staged diff.
- Tree-diff guard двічі відсікає semantic no-op. Порожня група отримує
  `patch-equivalent`, worktree прибирається, push і PR не виконуються.
- Cleanup видаляє всі точні local/remote aliases і звітує їх. Failed source
  зберігає branch, worktree і, якщо PR уже створено, його URL.

## Публічний API

- `parseWorktrees` — парсить `git worktree list --porcelain`.
- `dedupeRefs` — зводить local/remote refs одного commit зі збереженням aliases.
- `inventoryRepository` — збирає детермінований Git inventory.
- `callWithValidatedFallback` — виконує min → validation → max fallback.
- `finishCherryPick` — пропускає semantic no-op або продовжує непорожній pick.
- `hasChangesFromBase` — перевіряє реальний tree diff, а не commits ahead.
- `captureCachedBehaviorBaseline` — кешує test baseline за OID `origin/main`.
- `changedNonCodeDirectories` — групує non-code paths у domain directories.
- `validateBehaviorState` — перевіряє scoped code gates і test regression.
- `validateFinalProjectGates` — перевіряє non-code domains та changelog.
- `cleanupSource` — видаляє тільки доказово безпечні точні refs або stash.
- `formatReport` — формує deterministic звіт із cleanup та failure details.
- `runGitReconcileOrchestrator` — координує inventory, triage, PR і cleanup.

## Гарантії поведінки

- Shell interpolation не використовується: executable та arguments
  передаються окремо.
- Live worktree, open PR, `kept`, incomplete triage та failed source не
  видаляються.
- Stash видаляється точково за стабільним commit ID; `git stash clear` не
  використовується.
- Worktree із проваленим перенесенням зберігається для діагностики.
- Порожній tree diff не може створити remote branch або PR.
- Progress не змішує фази з різною вартістю в удаваний global percentage.
