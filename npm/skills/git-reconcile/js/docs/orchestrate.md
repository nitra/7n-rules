---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: 073c4942
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 0
---

## Поведінка

`runGitReconcileOrchestrator` ініціює процес через `elapsedLabel` та `createPhaseProgress` для відстеження часу. Спочатку викликається `inventoryRepository`, який використовує `policyBaseRef`, `git`, `parseWorktreeState`, `groupTrackingRefs`, `trackingRelation`, `openPullRequests`, `branchName`, `branchState`, `commitMetadata`, `conflictFiles`, `inventoryStashes`, `isManagedTransientWorktree` для збору детермінованого Git inventory. Далі, `inventoryStashes` збирає stash-інвентар, що також викликає `git` та `stashPathsAbsorbed`.

Сформований інвентар передається у `triageCandidates`, який використовує `buildTriagePrompt` для створення промпта, а потім багаторазово викликає `callWithValidatedFallback` з `buildTriagePrompt` для отримання рішень. Результати валідуються через `validateTriageOutcome`, що залежить від `validateDecision`, `validatePrDecision` та `validateBranchGroups`, збираючи `failedTriageDecisions` для кейсів, де вибір не відбувся.

Після вибору рішень, `materializeDecisions` застосовує їх за допомогою `runWithConcurrency` через `materializePrGroup`, який створює кожен PR-груповий результат, використовуючи `callRunner` для виконання LLM-кроків.

Для кожного PR-групи, `materializePrGroup` збирає деталі: `collectPullRequestFacts` використовує `git` та `pullRequestDiffProfile` для опису PR, а `releasedChangeEntries` визначає, які зміни вже були опубліковані. Потім, `buildPullRequestDescriptionPrompt` формує промпт, і `describePullRequest` ініціює LLM-генерацію опису за допомогою `callWithValidatedFallback`, валідуючи результат через `validatePullRequestDescription`, і фіналізуючи його через `renderPullRequestBody`.

Для керування змінами, `discardPatchEquivalentWorktree` визначає, чи достатньо змін для PR. Якщо так, `applySource` застосовує зміни, викликаючи `skipEmptyCherryPick`, `finishCherryPick`, `resolveConflict` та `validateGitState` для підтвердження стабільності.

Якщо PR-групи успішно матеріалізовані, `passFinalProjectGates` запускає остаточну валідацію, включаючи `validateFinalProjectGates` та `validateChangedLockfiles` для перевірки не-код змін та файлів блокування, які не обробляються в `node_modules`. Для забезпечення якості, `captureBehaviorBaseline` або `captureCachedBehaviorBaseline` фіксує тестовий стан бази. Якщо тести пройшли, `validateBehaviorState` збирає докази з тестових скриптів. Успішне завершення веде до `commitPendingChanges` для фіксації індексу.

Фінальна генерація використовує `commitPendingChanges` та `createPullRequest`, який збирає всі попередні етапи, а потім викликає `passFinalProjectGates`.

Якщо PR-група не утворюється або завершується невдачею, відбувається очищення через `cleanupInactiveSources` та `cleanupMaterializedSources`. Також, `cleanupObsoleteWorktrees` прибирає неактивні записи, а `cleanupSource` видаляє джерела, що більше не потрібні.

Наприкінці, `summarizeRemaining` аналізує результати через `appendMaterializedWorktrees` та `appendMaterializedBranches` для підрахунку та формування `formatReport`, який містить підсумки через `formatOutcomeCounts`.

## Сценарії використання

- `npm/skills/git-reconcile/js/tests/orchestrate.test.mjs` (commitPendingChanges; forensic worktree hygiene) — native executable PATH відкидає project-local npm і npx shims; приймає чистий index, коли корисні commits уже є в branch; комітить staged remediation після final gates; видаляє лише відновлюваний node_modules; повторно чекає checks після порожнього initial rollup; ще 84

## Гарантії поведінки

- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `node_modules`.
