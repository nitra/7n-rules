---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: 09f8b69d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль узгоджує Git branches, worktree і stash зі свіжим `origin/main`.
JS виконує inventory, validation, materialization, gates, PR і cleanup, а LLM
отримує лише bounded semantic triage, conflict resolution та behavioral edits.

## Поведінка

- Збирає refs, worktree, open PR, patch-equivalent commits і stash. Detached
  worktree захищає за checkout HEAD OID.
- Ізолює вкладені `npx` від `npm_config_package` зовнішнього `npm exec`.
- Показує inventory elapsed time та окремі progress bars для triage, PR і
  cleanup; у non-TTY виводить append-only progress.
- Перевіряє повноту triage, groups та commit OID. Infrastructure failure
  runner завершує крок одразу; `max` запускається лише після валідної
  відповіді, що не пройшла validation.
- Створює worktree від `origin/main`, за потреби ставить frozen Bun
  dependencies і фіксує test baseline до перенесення source.
- Red baseline допускається лише для розпізнаних Vitest failures, якщо
  post-change набір не містить нових failures. Нерозпізнаний output
  fail-closed.
- Зводить tracked+untracked code paths до унікальних директорій. Для кожної
  запускає scoped `doc-files` fix та unified lint `--no-fix`, не скануючи
  repository-wide baseline.
- Empty cherry-pick пропускається лише за активного `CHERRY_PICK_HEAD`,
  відсутніх conflicts і порожнього staged diff.
- Після LLM edits JS сам виконує Git checks, repository tests і changelog
  gate. LLM prompt дозволяє лише narrow tests.
- Створює PR і лише після успіху точково прибирає перенесені або доведено
  неактуальні refs/stash; cleanup refs у звіті мають точний OID.

## Публічний API

- parseWorktrees — Парсить `git worktree list --porcelain` у branch→path.
- dedupeRefs — Дедуплікує local/remote refs одного commit: remote має пріоритет, але
worktree-protection локального ref переноситься у запис.
- conflictFiles — Витягає конфліктні файли з `git merge-tree`.
- inventoryRepository — Збирає детермінований Git inventory. Нічого не видаляє і не змінює у
checkout, крім оновлення remote refs через fetch --prune.
- buildTriagePrompt — Формує bounded semantic-triage prompt. Git-факти вже пораховані JS; модель
не виконує shell-команди й повертає лише JSON-рішення.
- parseDecisionEnvelope — Витягає JSON object із чистої або fenced відповіді.
- callRunner — Викликає вибраний LLM runner для одного bounded-завдання.
- callWithValidatedFallback — Виконує bounded LLM-крок через min, валідовує результат JS-функцією і
викликає max лише після конкретного провалу.
- validateTriageOutcome — Структурно перевіряє triage-рішення: рівно один verdict на candidate,
валідні actions/groups і лише відомі commit OID.
- branchSlug — Перетворює довільний title/ref на branch slug.
- skipEmptyCherryPick — Пропускає лише підтверджений empty cherry-pick: sequencer активний,
конфліктів немає, staged diff порожній.
- testFailureSignatures — Витягає стабільні Vitest failure identifiers без summary/timing.
- acceptsTestOutcome — Дозволяє red baseline лише якщо після перенесення не з'явилось нових
Vitest failures. Нерозпізнаний red output завжди fail-closed.
- sourceDirectories — Зводить змінені code paths до найвужчих директорій для scoped gates.
- captureBehaviorBaseline — Фіксує test baseline на чистому origin/main до перенесення source.
- validateBehaviorState — Додає до Git-state validation test script із репозиторію і changelog gate.
Саме ці докази вирішують, чи приймати min-результат або ескалювати на max.
- cleanupSource — Видаляє точний source після Git-доказу неактуальності або успішного
перенесення. Protected/open-PR refs не потрапляють у цей крок.
- formatReport — Формує deterministic report.
- runGitReconcileOrchestrator — JS-оркестратор: inventory → bounded LLM triage → deterministic PR pipeline.

## Гарантії поведінки

- Shell interpolation не використовується: executable та arguments
  передаються окремо.
- Live worktree, open PR, `kept`, incomplete triage та failed source не
  видаляються.
- Stash видаляється точково за стабільним commit ID; `git stash clear` не
  використовується.
- Worktree із проваленим перенесенням зберігається для діагностики.
- Progress не змішує фази з різною вартістю в удаваний global percentage.
