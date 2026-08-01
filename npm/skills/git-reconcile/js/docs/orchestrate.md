---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: a1b594a1
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Поведінка

runGitReconcileOrchestrator ініціює процес, використовуючи elapsedLabel та createPhaseProgress для відстеження прогресу, а потім викликає triageCandidates для початку LLM-оркестрації. triageCandidates використовує buildTriagePrompt для генерації промпта, після чого викликає callWithValidatedFallback для виконання LLM-кроку, який повинен повернути результат, що перевіряється validateTriageOutcome. Якщо triage успішний, отримані рішення трансформуються у materializedDecisions, які виконуються паралельно з bounded concurrency за допомогою runWithConcurrency, де materializePrGroup матеріалізує кожну PR-групу. Після завершення матеріалізації, cleanupInactiveSources та cleanupMaterializedSources проводяться для очищення. Якщо PR генерується, collectPullRequestFacts збирає дані для PR, a pullRequestDiffProfile класифікує зміни. Потім buildPullRequestDescriptionPrompt формує промпт, а validatePullRequestDescription перевіряє його структуру, після чого describePullRequest генерує фінальний Markdown за допомогою renderPullRequestBody. На етапі очищення cleanupObsoleteWorktrees виконує pruneStaleWorktrees, які використовують parseWorktreeInventory, щоб визначити, що можна видалити. Коли потрібно застосувати зміни, applySource використовує skipEmptyCherryPick та finishCherryPick для управління cherry-pick. Якщо зміни важливі, hasChangesFromBase перевіряє їх, а remediateBehaviorState намагається виправити дефекти перед ескалацією. Для забезпечення чистоти бізнес-логіки, validateBehaviorState вимагає проведення test-валідації, де acceptsTestOutcome порівнює результати. validateFinalProjectGates завершує перевірку, використовуючи validateChangedLockfiles для стану lockfile, а pruneForensicDependencies видаляє тимчасові залежності. Якщо всі перевірки пройдені, commitPendingChanges фіксує зміни, а createPullRequest збирає всі артефакти і створює PR. У випадку необхідності створювати нові робочі середовища, createReconcileWorktree використовує policyBaseRef та nativeExecutableEnvironment, а потім runAsync виконує команди. Якщо потрібне видалення, removeReconcileWorktree використовує nativeMt. Для управління неактивними середовищами cleanupSource викликається для видалення точного джерела. runGitReconcileOrchestrator фінально викликає formatReport, щоб створити детермінований звіт, який відображає результати formatOutcomeCounts та summarizeRemaining.

## Сценарії використання

- `npm/skills/git-reconcile/js/tests/orchestrate.test.mjs` (commitPendingChanges; forensic worktree hygiene) — native executable PATH відкидає project-local npm і npx shims; приймає чистий index, коли корисні commits уже є в branch; комітить staged remediation після final gates; видаляє лише відновлюваний node_modules; повторно чекає checks після порожнього initial rollup; ще 84

## Гарантії поведінки

- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `node_modules`.
