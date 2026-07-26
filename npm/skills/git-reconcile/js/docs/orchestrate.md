---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: c3233b69
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

Під час матеріалізації рішення source переноситься у керований worktree. `branchSlug` забезпечує передбачувані rescue-гілки, а `ensureLocalWorktreeExclude` не дає службовим worktree забруднювати root `git status`. Якщо cherry-pick стає порожнім, `skipEmptyCherryPick` дозволяє skip лише для доведеного semantic no-op, а `finishCherryPick` завершує активний перенос без прийняття неперевіреного Git-стану. `hasChangesFromBase` відсікає PR без реального tree diff.

Behavior-gates будуються навколо baseline: `captureBehaviorBaseline` фіксує стан чистої `origin/<baseBranch>` із repository Git policy, а `captureCachedBehaviorBaseline` перевикористовує цей результат у межах одного прогону для однакової бази. `validateBehaviorState` перевіряє Git-консистентність, scoped lint/docs і test outcome; правила запуску тестів і скриптів беруться з `package.json`. `testFailureSignatures` нормалізує failures, а `acceptsTestOutcome` дозволяє red baseline тільки без нових failures. Якщо валідація падає через типовий formatting, CSpell, docs або changelog-дефект, `remediateBehaviorState` запускає canonical fixers перед ескалацією LLM.

Для scoped gates `sourceDirectories` звужує code-зміни до мінімальних директорій, а `changedNonCodeDirectories` окремо готує non-code області для фінальної перевірки. `validateFinalProjectGates` добирає domain lint для workflows, dependency manifests, rules та інших non-code змін після того, як code-директорії вже пройшли свої перевірки.

Після успішного перенесення або доведеної неактуальності `cleanupSource` видаляє тільки точний source, який не є protected і не має відкритого PR. Усі accepted, kept, dropped, failed і cleaned результати зводяться в детермінований Markdown через `formatReport`, щоб наступний крок бачив і створені PR, і причини fail-closed рішень.

## Публічний API

- createPhaseProgress — Створює ANSI-free snapshot progress для однієї фази. Однаковий append-only
формат у TTY/CI не засмічує captured output cursor-control кодами, а
heartbeat показує elapsed time довгих LLM-етапів.
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
- ensureLocalWorktreeExclude — Додає `.worktrees/` до локального Git exclude без tracked-змін у consumer.
Це не замінює repository Vitest excludes, але не лишає root checkout dirty
через керовані або forensic worktree.
- skipEmptyCherryPick — Пропускає лише підтверджений empty cherry-pick: sequencer активний,
конфліктів немає, staged diff порожній.
- finishCherryPick — Завершує активний cherry-pick: semantic no-op пропускає, непорожній
продовжує. Відсутній sequencer не потребує дії.
- hasChangesFromBase — Перевіряє реальний tree diff, а не лише кількість commits ahead.
- testFailureSignatures — Витягає стабільні Vitest failure identifiers без summary/timing.
- acceptsTestOutcome — Дозволяє red baseline лише якщо після перенесення не з'явилось нових
Vitest failures. Нерозпізнаний red output завжди fail-closed.
- sourceDirectories — Зводить змінені code paths до найвужчих директорій для scoped gates.
- changedNonCodeDirectories — Повертає директорії non-code змін для фінального domain lint.
- remediateBehaviorState — Запускає canonical fixers у worktree до ескалації min→max. Це прибирає
formatting/CSpell/doc/changelog дефекти без повторного behavioral LLM.
- captureBehaviorBaseline — Фіксує test baseline на чистій policy base branch до перенесення source.
- captureCachedBehaviorBaseline — Повторно використовує test baseline однієї policy base branch між PR-групами.
Залежності все одно встановлюються в кожному окремому worktree.
- validateBehaviorState — Додає до Git-state validation test script із репозиторію і changelog gate.
Саме ці докази вирішують, чи приймати min-результат або ескалювати на max.
- validateFinalProjectGates — Фінальний domain gate охоплює non-code зміни, зокрема workflows, dependency
manifests і правила. Code directories уже пройшли scoped lint і tests.
- cleanupSource — Видаляє точний source після Git-доказу неактуальності або успішного
перенесення. Protected/open-PR refs не потрапляють у цей крок.
- formatReport — Формує deterministic report.
- runWithConcurrency — Виконує async jobs із bounded concurrency та стабільним порядком output.
- normalizePrConcurrency — Нормалізує bounded concurrency PR-фази.
- runGitReconcileOrchestrator — JS-оркестратор: inventory → bounded LLM triage → deterministic PR pipeline.

## Гарантії поведінки

- Progress є append-only та не містить ANSI cursor-control sequences.
- Не більше чотирьох PR-груп виконуються одночасно; типовий ліміт — три.
- Canonical fixers мають пріоритет перед behavioral `max` fallback.
- Cleanup починається лише після завершення всіх PR jobs і не видаляє
  protected/open-PR/failed sources.
- Test baseline кешується за OID policy base branch у межах одного прогону.
