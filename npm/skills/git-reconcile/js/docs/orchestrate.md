---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: 77886edb
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Координує Git reconciliation для worktree, stash, branch і PR-фаз: збирає факти про repository, worktrees, stashes, conflicts, changed non-code scopes і pull request diff profile, а також готує triage, verification, cleanup і final PR description. Свідомо пропускає `node_modules` і кешує результати в межах прогону.

## Поведінка

createPhaseProgress тримає живий, append-only прогрес для фаз оркестрації без ANSI-шума, щоб TTY і CI бачили однаковий слід виконання; цей слід далі відображає тривалі LLM-етапи через elapsed time.

nativeExecutableEnvironment відсікає npm/bun shim-оточення з PATH, щоб усі native git/mt виклики ішли на системні binary, а не на локальні підміни з іншого worktree-контракту.

runAsync є основним каналом для довгих зовнішніх команд у фоновому режимі; він зберігає event loop вільним, а його результат потім використовують validation, install, lint і test-етапи.

parseWorktreeInventory і parseWorktrees спільно перетворюють porcelain-вивід Git на керований inventory: перший дає повний набір worktree records для cleanup, другий — лише мапу branch→checkout для швидкого зіставлення.

dedupeRefs, trackingRelation і groupTrackingRefs будують єдине уявлення про sources: local і remote refs зливаються в ефективні кандидати, tracking-стан визначається без зміни refs, а worktree-protection переноситься на той запис, який реально має бути захищений.

conflictFiles постачає подальші recovery-кроки списком конфліктних шляхів із merge-tree, щоб оркестратор працював тільки з уже матеріалізованими проблемами.

inventoryRepository зводить усі Git-факти в один детермінований snapshot, спираючись на package.json як на джерело проєктних правил, і не змінює checkout, окрім оновлення remote refs через fetch --prune; у той самий inventory входять branches, stashes, worktrees, warnings і захищені transient-обмеження, а шлях node_modules свідомо пропускається.

inventoryStashes додає до inventory stash-стани без checkout/apply, розрізняє absorbed payload і exact duplicates та зберігає canonical-версію найновішого дублікату.

buildTriagePrompt, parseDecisionEnvelope, callRunner, callWithValidatedFallback і validateTriageOutcome утворюють bounded LLM-контур: JS уже підготував факти, модель бачить лише обмежений prompt, повертає JSON-рішення, а fallback на max дозволений тільки після конкретної JS-валідації.

collectPullRequestFacts, verificationSummary, pullRequestDiffProfile, releasedChangeEntries, buildPullRequestDescriptionPrompt, validatePullRequestDescription, renderPullRequestBody і describePullRequest формують PR narrative з уже зібраних Git- та behavioral-фактів: diff профілюється без LLM, changelog/release-only зміни відсікаються від implementation narrative, а фінальний body стабільно відокремлює business/architecture зміст від forensic detail.

branchSlug нормалізує довільні title/ref до безпечного branch-представлення, яке далі використовують для створення імен worktree та інших derived refs.

ensureLocalWorktreeExclude додає локальний exclude для `.worktrees/`, щоб керовані або forensic worktree не лишали root checkout dirty.

skipEmptyCherryPick і finishCherryPick керують sequencer-станом лише тоді, коли є підтверджений cherry-pick flow: empty no-op можна безпечно пропустити, а відсутність sequencer не вимагає дії.

hasChangesFromBase перевіряє реальний tree diff від policy base, а не кількість ahead commits, щоб не переплутати пустий перенос із справжньою зміною.

testFailureSignatures і acceptsTestOutcome разом тримають test gate fail-closed: дозволений red baseline не розширюється новими failures, а нерозпізнаний red output не проходить.

sourceDirectories, hasOnlyChangeEntries і discardPatchEquivalentWorktree відокремлюють справжні behavioral зміни від технічних залишків: code paths зводяться до найвужчих директорій, `.changes/` не вважається самостійною поведінковою цінністю, а no-op або change-only worktree прибирається до дорогих gates.

changedNonCodeDirectories і changedNonCodeScopes виділяють non-code поверхню для фінальних domain lint-проходів, не зводячи root-зміни до `.` і не розмиваючи scoped validation на весь monorepo.

remediateBehaviorState, captureBehaviorBaseline, captureCachedBehaviorBaseline, validateBehaviorState, validateFinalProjectGates, validateChangedLockfiles, classifyPullRequestChecks, pruneForensicDependencies, verifyPullRequestReadiness, passFinalProjectGates і commitPendingChanges формують late-stage gate pipeline: спочатку фіксується baseline на чистій policy base гілці, потім застосовуються canonical fixers і повторні validations, після чого перевіряються lockfiles, GitHub checks і readiness до коміту лише того, що лишилось в index.

cleanupObsoleteWorktrees і cleanupSource прибирають лише доведено зайве: stale або inactive transient worktree, merged/patch-equivalent sources чи точні sources, які вже не потрібні; dirty, current, locked, protected, open-PR і унікальні worktree залишаються недоторканими.

formatOutcomeCounts, summarizeRemaining і formatReport збирають стабільний підсумок матеріалізації та cleanup: окремо рахуються створені PR, retained sources, worktrees і причини їх збереження, щоб репорт не змішував технічне очищення з реально завершеними змінами.

runWithConcurrency і normalizePrConcurrency задають bounded паралельність PR-фази, зберігаючи порядок результатів і не даючи workspace-операціям розбігтися понад дозволений ліміт.

runGitReconcileOrchestrator зшиває весь потік: спершу будує inventory, потім запускає bounded triage через LLM, далі materialize/cleanup, а на виході повертає deterministic report і зведений результат.

## Публічний API

- createPhaseProgress — Створює ANSI-free snapshot progress для однієї фази. Однаковий append-only
формат у TTY/CI не засмічує captured output cursor-control кодами, а
heartbeat показує elapsed time довгих LLM-етапів.
- nativeExecutableEnvironment — Відкидає npm/bun shim-каталоги з PATH для виклику системного native binary.
Інакше `npx \@7n/rules` може непомітно підмінити Rust CLI застарілим
`node_modules/.bin/mt` з іншим worktree contract.
- runAsync — Виконує довгу команду без блокування event loop, щоб progress heartbeat
продовжував працювати під час install/test/lint/PR checks. Інжектований
sync runner у unit tests також підтримується.
- parseWorktreeInventory — Повертає повні worktree records для deterministic cleanup policy.
- parseWorktrees — Парсить `git worktree list --porcelain` у branch→path.
- dedupeRefs — Дедуплікує local/remote refs одного commit: remote має пріоритет, але
worktree-protection локального ref переноситься у запис.
- trackingRelation — Визначає ancestry-відношення local branch до tracking upstream без зміни refs.
- groupTrackingRefs — Групує tracking-пару за effective tip без фізичного fast-forward.
Behind/synced аналізуються за remote tip, ahead — за local tip, diverged
лишаються двома незалежними sources. Worktree protection local ref
переноситься на effective candidate.
- conflictFiles — Витягає конфліктні файли з `git merge-tree`.
- inventoryRepository — Збирає детермінований Git inventory. Нічого не видаляє і не змінює у
checkout, крім оновлення remote refs через fetch --prune.
- inventoryStashes — Збирає tracked/untracked stash payload, absorbed-state та exact duplicate
signature без checkout/apply. Найновіший exact duplicate лишається
canonical, старіші стають patch-equivalent.
- buildTriagePrompt — Формує bounded semantic-triage prompt. Git-факти вже пораховані JS; модель
не виконує shell-команди й повертає лише JSON-рішення.
- parseDecisionEnvelope — Витягає JSON object із чистої або fenced відповіді.
- callRunner — Викликає вибраний LLM runner для одного bounded-завдання.
- callWithValidatedFallback — Виконує bounded LLM-крок через min, валідовує результат JS-функцією і
викликає max лише після конкретного провалу.
- validateTriageOutcome — Структурно перевіряє triage-рішення: рівно один verdict на candidate,
валідні actions/groups і лише відомі commit OID.
- collectPullRequestFacts — Збирає bounded факти з фінального diff для grounded бізнесового й
архітектурного опису PR без повторного repository exploration моделлю.
- verificationSummary — Перетворює довільний agent transcript на bounded deterministic verdict.
- pullRequestDiffProfile — Класифікує фінальний diff без LLM, щоб release metadata + lockfile
залишались валідним PR, але narrative не приписував їм runtime-зміни.
- releasedChangeEntries — Знаходить release entries, exact narrative яких уже присутній у base
CHANGELOG відповідного workspace.
- buildPullRequestDescriptionPrompt — Формує bounded prompt, який забороняє implementation-changelog і вимагає
business/architecture narrative лише з підготовлених JS-фактів.
- validatePullRequestDescription — Перевіряє структуру, factual anchors і перевагу business/architecture
змісту перед дрібними деталями реалізації.
- renderPullRequestBody — Рендерить стабільний PR body: business та architecture секції видимі
першими, а source/evidence залишаються у forensic details.
- describePullRequest — Генерує validated PR narrative через min→validation→max над фінальним diff.
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
- hasOnlyChangeEntries — Визначає технічний залишок, який містить лише release entries. Такі файли
не доводять окремої корисної поведінки й не мають породжувати PR.
- discardPatchEquivalentWorktree — Прибирає no-op або change-only worktree до дорогих behavioral/CI gates.
- changedNonCodeDirectories — Повертає директорії non-code змін для фінального domain lint.
- changedNonCodeScopes — Повертає найвужчі scopes для non-code змін. Файл у корені лишається
файлом, а не перетворюється на `.`: root lint може торкнутися всього
monorepo і забруднити reconciliation unrelated autofix-ами.
- remediateBehaviorState — Запускає canonical fixers у worktree до ескалації min→max. Це прибирає
formatting/CSpell/doc/changelog дефекти без повторного behavioral LLM.
- captureBehaviorBaseline — Фіксує test baseline на чистій policy base гілці до перенесення source.
- captureCachedBehaviorBaseline — Повторно використовує test baseline однієї policy base гілки між PR-групами.
Залежності все одно встановлюються в кожному окремому worktree.
- validateBehaviorState — Додає до Git-state validation test script із репозиторію і changelog gate.
Саме ці докази вирішують, чи приймати min-результат або ескалювати на max.
- validateFinalProjectGates — Фінальний domain gate охоплює non-code зміни, зокрема workflows, dependency
manifests і правила. Code directories уже пройшли scoped lint і tests.
- validateChangedLockfiles — Перевіряє final Bun lock state навіть коли node_modules уже існує.
Baseline install не є доказом валідності lockfile після apply/remediation.
- classifyPullRequestChecks — Класифікує PR checks відносно checks base commit. Будь-який pending/unknown
стан fail-closed зберігає worktree; baseline-red дозволений лише коли кожен
failed check уже падає на base.
- pruneForensicDependencies — Видаляє лише відновлювані dependencies зі збереженого forensic worktree.
Git metadata, commits і tracked/untracked зміни не зачіпаються.
- verifyPullRequestReadiness — Чекає terminal CI state й порівнює failed checks з base commit.
- passFinalProjectGates — Запускає final gates і один canonical remediation pass.
- commitPendingChanges — Комітить лише зміни, які лишилися в index після final gates. Branch sources
можуть уже мати готові commits після cherry-pick, тому чистий index є
валідним станом і не потребує порожнього commit.
- cleanupObsoleteWorktrees — Прибирає лише stale records або clean inactive worktree у transient
namespaces. Dirty/current/locked/protected/open-PR і унікальні worktree
залишаються недоторканими.
- cleanupSource — Видаляє точний source після Git-доказу неактуальності або успішного
перенесення. Protected/open-PR refs не потрапляють у цей крок.
- formatOutcomeCounts — Рахує точні outcomes без змішування створеного PR з CI-ready PR.
- summarizeRemaining — Рахує sources/worktrees, які реально лишилися після cleanup, і пояснює
retention окремо для Git sources та checkout-ів.
- formatReport — Формує deterministic report.
- runWithConcurrency — Виконує async jobs із bounded concurrency та стабільним порядком output.
- normalizePrConcurrency — Нормалізує bounded concurrency PR-фази.
- runGitReconcileOrchestrator — JS-оркестратор: inventory → bounded LLM triage → deterministic PR pipeline.

## Сценарії використання

- `npm/skills/git-reconcile/js/tests/orchestrate.test.mjs` (commitPendingChanges; forensic worktree hygiene) — native executable PATH відкидає project-local npm і npx shims; приймає чистий index, коли корисні commits уже є в branch; комітить staged remediation після final gates; видаляє лише відновлюваний node_modules; повторно чекає checks після порожнього initial rollup; ще 77

## Гарантії поведінки

- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `node_modules`.
