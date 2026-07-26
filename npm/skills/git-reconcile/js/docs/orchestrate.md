---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: 6e9cb156
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
---

## Огляд

Файл координує Git reconcile-орchestrator: інвентаризує repository refs і worktrees, прибирає дублікати refs, визначає conflict files, формує triage prompt, перевіряє decision envelope та застосовує рішення через runner. Він існує, щоб переносити cleanup у перевірюваний процес із behavior baseline, cached baseline у межах прогону, validation gates, контрольованим concurrency і детермінованим Markdown-звітом.

## Поведінка

`runGitReconcileOrchestrator` керує всім потоком: збирає Git-стан через `inventoryRepository`, веде фазовий progress через `createPhaseProgress`, запускає bounded triage, матеріалізує рішення у PR-пайплайн, виконує cleanup і повертає звіт через `formatReport`. Паралельність PR-фази обмежується `normalizePrConcurrency`, а незалежні задачі виконуються через `runWithConcurrency` зі стабільним порядком результатів.

`inventoryRepository` отримує факти з локального checkout і remote refs, оновлює remote refs через fetch --prune, але не змінює робочі файли. `parseWorktrees` і `dedupeRefs` зводять worktree-захист, branch refs, aliases і commit identity в один детермінований inventory, щоб protected або відкриті джерела не потрапили в небезпечний cleanup. `conflictFiles` додає до inventory ранню оцінку потенційних merge-conflicts.

Для review-кандидатів `buildTriagePrompt` формує обмежене завдання для LLM: модель отримує вже пораховані Git-факти й має повернути лише JSON-рішення. `callRunner` викликає обраний runner, `parseDecisionEnvelope` дістає структуровану відповідь, а `validateTriageOutcome` приймає тільки повний і узгоджений набір рішень для поточного batch. `callWithValidatedFallback` спершу пробує дешевший рівень, а дорожчий використовує лише після конкретного validation failure.

Під час матеріалізації рішення source переноситься у керований worktree. `branchSlug` забезпечує передбачувані rescue-гілки без крайового дефіса після скорочення, а `ensureLocalWorktreeExclude` не дає службовим worktree забруднювати root `git status`. Після `@7n/mt` actual checkout визначається через `git worktree list --porcelain`, тому collision sanitized-каталогу не веде до реконструйованого cwd. Setup failure повертається як `failed` лише для цієї PR-групи з branch, фактичним worktree та `spawnSync`-діагностикою; source і forensic checkout не очищуються. Якщо cherry-pick стає порожнім, `skipEmptyCherryPick` дозволяє skip лише для доведеного semantic no-op, а `finishCherryPick` завершує активний перенос без прийняття неперевіреного Git-стану. `hasChangesFromBase` відсікає PR без реального tree diff.

Behavior-gates будуються навколо baseline: `captureBehaviorBaseline` фіксує стан чистої `origin/<baseBranch>` із repository Git policy, а `captureCachedBehaviorBaseline` перевикористовує цей результат у межах одного прогону для однакової бази. `validateBehaviorState` перевіряє Git-консистентність, scoped lint/docs і test outcome; правила запуску тестів і скриптів беруться з `package.json`. `testFailureSignatures` нормалізує failures, а `acceptsTestOutcome` дозволяє red baseline тільки без нових failures. Якщо валідація падає через типовий formatting, CSpell, docs або changelog-дефект, `remediateBehaviorState` запускає canonical fixers перед ескалацією LLM.

Для scoped gates `sourceDirectories` звужує code-зміни до мінімальних директорій, а `changedNonCodeDirectories` окремо готує non-code області для фінальної перевірки. `validateFinalProjectGates` добирає domain lint для workflows, dependency manifests, rules та інших non-code змін після того, як code-директорії вже пройшли свої перевірки.

Після успішного перенесення або доведеної неактуальності `cleanupSource` видаляє тільки точний source, який не є protected і не має відкритого PR. Усі accepted, kept, dropped, failed і cleaned результати зводяться в детермінований Markdown через `formatReport`, щоб наступний крок бачив і створені PR, і причини fail-closed рішень.

## Публічний API

- createPhaseProgress — Створює ANSI-free snapshot progress для однієї фази.
- parseWorktrees — Парсить `git worktree list --porcelain` у branch→path.
- dedupeRefs — Дедуплікує local/remote refs одного commit.
- conflictFiles — Витягає конфліктні файли з `git merge-tree`.
- inventoryRepository — Збирає детермінований Git inventory.
- buildTriagePrompt — Формує bounded semantic-triage prompt.
- parseDecisionEnvelope — Витягає JSON object із чистої або fenced відповіді.
- callRunner — Викликає вибраний LLM runner для одного bounded-завдання.
- callWithValidatedFallback — Виконує min, валідує результат і викликає max лише після validation failure.
- validateTriageOutcome — Структурно перевіряє triage-рішення.
- branchSlug — Перетворює title/ref на валідний короткий branch slug.
- ensureLocalWorktreeExclude — Додає `.worktrees/` до локального Git exclude без tracked-змін.
- skipEmptyCherryPick — Пропускає лише підтверджений empty cherry-pick.
- finishCherryPick — Завершує активний cherry-pick.
- hasChangesFromBase — Перевіряє реальний tree diff, а не commits ahead.
- testFailureSignatures — Витягає стабільні Vitest failure identifiers.
- acceptsTestOutcome — Дозволяє red baseline лише без нових failures.
- sourceDirectories — Зводить code paths до найвужчих директорій для scoped gates.
- changedNonCodeDirectories — Повертає директорії non-code змін для domain lint.
- remediateBehaviorState — Запускає canonical fixers перед behavioral max fallback.
- captureBehaviorBaseline — Фіксує test baseline на чистій policy base branch.
- captureCachedBehaviorBaseline — Кешує test baseline між PR-групами.
- validateBehaviorState — Додає Git-state validation, tests і changelog gate.
- validateFinalProjectGates — Перевіряє фінальні non-code domain gates.
- cleanupSource — Видаляє тільки доказово безпечний точний source.
- formatReport — Формує deterministic report.
- runWithConcurrency — Виконує async jobs із bounded concurrency та стабільним output.
- normalizePrConcurrency — Нормалізує bounded concurrency PR-фази.
- runGitReconcileOrchestrator — Координує inventory, triage, PR і cleanup.

## Гарантії поведінки

- Progress є append-only та не містить ANSI cursor-control sequences.
- Не більше чотирьох PR-груп виконуються одночасно; типовий ліміт — три.
- Canonical fixers мають пріоритет перед behavioral `max` fallback.
- Cleanup починається лише після завершення всіх PR jobs і не видаляє protected/open-PR/failed sources.
- `spawnSync.error`, зокрема `ENOENT`, не губиться в command diagnostics.
- Setup failure зберігає forensic worktree і не зупиняє незалежні PR-групи.
- Test baseline кешується за OID policy base branch у межах одного прогону.
