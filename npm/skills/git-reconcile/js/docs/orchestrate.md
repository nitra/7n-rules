---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: 92b11a32
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 0
---

## Поведінка

`runGitReconcileOrchestrator` ініціює процес через `elapsedLabel` та `createPhaseProgress` для відстеження часу. Спочатку викликається `inventoryRepository`, який використовує `policyBaseRef`, `git`, `parseWorktreeState`, `groupTrackingRefs`, `trackingRelation`, `openPullRequests`, `branchName`, `branchState`, `commitMetadata`, `conflictFiles`, `inventoryStashes`, `isManagedTransientWorktree` для збору детермінованого Git inventory. Далі, `inventoryStashes` збирає stash-інвентар, що також викликає `git` та `stashPathsAbsorbed`.

Сформований інвентар передається у `triageCandidates`, який використовує `buildTriagePrompt` для створення промпта, а потім багаторазово викликає `callWithValidatedFallback` з `callRunner`, використовуючи `validateTriageOutcome` для валідації результатів. Детерміновані рішення трансформуються у конкретні дії за допомогою `materializeDecisions`, яке паралельно виконує `materializePrGroup` з `runWithConcurrency`.

Якщо рішення полягає в створенні PR, для кожного групування застосовується `collectPullRequestFacts` для збору контексту, а потім `pullRequestDiffProfile` класифікує фінальний diff. Далі, `buildPullRequestDescriptionPrompt` формує промпт, який обробляється через `describePullRequest`, що сам використовує `callWithValidatedFallback`, `buildPullRequestDescriptionPrompt`, `validatePullRequestDescription`, та `renderPullRequestBody`.

Процес трансформації PR або його відхилення завершується `discardPatchEquivalentWorktree`. Якщо PR успішно генерується, викликається `commitPendingChanges` для збереження стану, а потім `passFinalProjectGates` для виконання фінальних перевірок, що включають `validateFinalProjectGates` та `validateChangedLockfiles`. Фінальний вивід формується через `formatReport`, який агрегує дані через `summarizeRemaining`, `formatOutcomeCounts`, `formatBranchReport`, `formatStashReport` та `formatRetainedWorktrees`.

Якщо процес потребує початкової підготовки, `createReconcileWorktree` створює керований worktree, починаючи з `policyBaseRef` і використовуючи `chooseBranch`, `parseWorktrees`, `validateNativeMtContract`, `nativeMt`. Після створення, `ensureLocalWorktreeExclude` додає exclude для ізоляції.

Для управління ресурсами, `cleanupObsoleteWorktrees` викликає `pruneStaleWorktrees`, `removableWorktreeShape`, `branchesForWorktree`, `isInactiveWorktree`, та `removeTransientWorktree` для прибирання старих записів. Для очищення знайдених джерел використовуються `cleanupInactiveSources` та `cleanupMaterializedSources`, які залучають `cleanupSource`.

У випадках помилок або для ізоляції, `nativeExecutableEnvironment` забезпечує коректне середовище для системних бінарників, а `runAsync` виконує команди без блокування, використовуючи `formatProcessError` для форматування помилок.

Для спеціалізованих сценаріїв, `testFailureSignatures` витягує ідентифікатори з виводу, а `acceptsTestOutcome` визначає проходження тестового шлюзу, враховуючи еталони бази (`baseline`). `sourceDirectories` та `changedNonCodeScopes` звужують область для застосування `validateScopedProjectGates`, який використовує `runAsync` та `changedSourceDirectories`. У випадках відхилення, `remediateBehaviorState` запускає виправлення, а `captureBehaviorBaseline` або `captureCachedBehaviorBaseline` фіксують базовий стан тестів.

Для відстеження існуючих конфліктів використовується `conflictFiles` для витягування шляхів з `git merge-tree`, а `resolveConflict` делегує розв'язання LLM.

Слід зазначити, що поточна реалізація не перевіряє зміна шляхів, що не є у `package.json`.

## Сценарії використання

- `npm/skills/git-reconcile/js/tests/orchestrate.test.mjs` (commitPendingChanges; forensic worktree hygiene) — native executable PATH відкидає project-local npm і npx shims; приймає чистий index, коли корисні commits уже є в branch; комітить staged remediation після final gates; видаляє лише відновлюваний node_modules; повторно чекає checks після порожнього initial rollup; ще 83

## Гарантії поведінки

- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `node_modules`.
