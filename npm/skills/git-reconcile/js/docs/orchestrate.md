---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: 9b659040
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл об’єднує inventory робочих дерев, triage, формування опису pull request, перевірки readiness, виконання reconcile-процесу та підсумкову звітність для роботи між worktree-ами. Він описує повний шлях: зібрати стан репозиторію, згрупувати tracking refs, оцінити конфлікти й зміни, сформувати результат triage, перевірити gates, застосувати виправлення, а потім зафіксувати підсумок і прибрати застарілі worktree-об’єкти та source-артефакти.

## Поведінка

createPhaseProgress тримає прогрес виконання у append-only вигляді, щоб той самий потік підходив і для TTY, і для CI без зайвого noise. Він працює як спільний каркас для довгих фаз, а elapsed time використовується лише як короткий сигнал живості виконання.

nativeExecutableEnvironment відтинає project-local shim-и з PATH, щоб подальші git і native CLI виклики йшли до системних бінарників, а не до підмін із worktree. Це критично для стабільності репозиторних контрактів між різними checkout-ами.

runAsync є базовим механізмом для тривалих зовнішніх команд у фоні, щоб progress heartbeat не завмирав під час install, test, lint і подібних кроків. Саме через нього проходять довгі gate-кроки, але результат завжди нормалізується в той самий shape, що й синхронний запуск.

parseWorktreeInventory і parseWorktrees зводять porcelain-вивід Git до стабільної внутрішньої моделі worktree-ів і зв’язків branch→checkout. Далі ці дані живлять дедуплікацію, cleanup і захист активних checkout-ів; свідомо пропущені node_modules не входять у цей інвентарний контур.

dedupeRefs, trackingRelation і groupTrackingRefs разом перетворюють сирі refs на ефективні sources для подальшої обробки. Вони узгоджують local і remote представлення одного tip, зберігають worktree-protection для локальних ref-ів і окремо враховують ancestry стан upstream.

conflictFiles і inventoryRepository працюють на рівні deterministic Git inventory: перший витягає список конфліктів, другий збирає повну картину гілок, stash-ів і worktree-ів без мутації checkout, окрім оновлення remote refs через fetch --prune. Цей inventory стає входом для triage, cleanup і PR-матеріалізації.

inventoryStashes додає до інвентарю tracked, untracked, absorbed і exact duplicate stash-кандидати без apply або checkout. Саме тут вирішується, що лишається canonical, а що стає patch-equivalent і може бути прибране пізніше без втрати змісту.

buildTriagePrompt і parseDecisionEnvelope утворюють межу між вже порахованими Git-фактами та JSON-відповіддю моделі. Промпт не дає моделі досліджувати репозиторій самостійно, а parseDecisionEnvelope приймає лише чистий JSON або fenced-варіант.

callRunner і callWithValidatedFallback керують bounded LLM-кроками: спочатку мінімальний tier, далі JS-валідатор, і лише після конкретного провалу — ескалація на max. Такий контур зберігає детермінізм, а помилки не перетворюються на довільні зміни поведінки.

validateTriageOutcome відсікає невалідні triage-рішення до того, як вони потраплять у materialization. Вона тримає рівно один verdict на candidate, перевіряє відомі commit OID і не дозволяє model output розширювати межі batch.

collectPullRequestFacts, verificationSummary і pullRequestDiffProfile формують grounded basis для PR-наративу. Перший збирає фінальні Git і behavioral факти, другий стискає поведінкові транскрипти до безпечного summary, третій відділяє загальний diff від release-lock-only сценаріїв, щоб narrative не приписував runtime-змін тим файлам, що їх не мають.

releasedChangeEntries, buildPullRequestDescriptionPrompt, validatePullRequestDescription, renderPullRequestBody і describePullRequest працюють як один ланцюг для PR body. Спершу відсікаються вже опубліковані change entries, потім збирається bounded prompt, після цього валідатор тримає фокус на business/architecture змісті, а renderPullRequestBody робить стабільний Markdown із видимими основними секціями першими. Уся ця гілка спирається на package.json як джерело репозиторних правил і сценаріїв, але не переписує їх у narrative.

branchSlug, ensureLocalWorktreeExclude, skipEmptyCherryPick, finishCherryPick, hasChangesFromBase, testFailureSignatures і acceptsTestOutcome підтримують безпечну Git-поведінку під час переносів. Branch slug нормалізує назви для worktree-ів, local exclude прибирає noise від керованих checkout-ів, cherry-pick логіка пропускає лише справжні semantic no-op, а test gate дозволяє red baseline тільки якщо не з’явилися нові Vitest failures.

sourceDirectories, hasOnlyChangeEntries, discardPatchEquivalentWorktree, changedNonCodeDirectories і changedNonCodeScopes ділять зміни на поведінкові та технічні. Це дає змогу рано відкидати no-op або release-entry-only worktree, а для non-code змін зберігати точні scopes без перетворення root-файлу на `.`.

remediateBehaviorState, captureBehaviorBaseline, captureCachedBehaviorBaseline, validateBehaviorState, validateFinalProjectGates, validateChangedLockfiles і classifyPullRequestChecks утворюють gate-ланцюг перед фіналізацією. Спочатку фіксується baseline, далі застосовуються scoped gates і changelog/test перевірки, а після цього окремо оцінюються final non-code зміни, lockfile-стан і GitHub checks; pending або unknown стани лишають worktree заблокованим, якщо немає доказів baseline-red.

pruneForensicDependencies, verifyPullRequestReadiness, passFinalProjectGates і commitPendingChanges завершують прийомку worktree. Спочатку очищаються лише відновлювані залежності forensic checkout-а, далі очікується terminal CI state, потім запускаються final gates з одним canonical remediation pass, і лише після цього комітиться те, що справді лишилося в index.

cleanupObsoleteWorktrees і cleanupSource прибирають лише доведено зайві або безпечні для видалення checkout-и та source-ref-и. Перший працює по inventory й не чіпає dirty, protected, open-PR чи унікальні worktree, другий видаляє source тільки після Git-доказу неактуальності або успішного перенесення.

formatOutcomeCounts, summarizeRemaining і formatReport збирають фінальну звітність про те, що було створено, що лишилося і чому. Вони розділяють sources, worktrees і stashes, рахують причини retention окремо та формують deterministic Markdown без змішування створеного PR із CI-ready PR.

runWithConcurrency і normalizePrConcurrency керують паралельністю PR-фаз. Перша виконує jobs у стабільному порядку output, друга обмежує override до безпечного діапазону, щоб bounded concurrency не ламала відтворюваність.

runGitReconcileOrchestrator з’єднує все в один потік: inventory → triage → materialize → validate → cleanup → report. Вона бере дані з Git, проганяє їх через bounded LLM decisioning і детерміновані gates, а на виході повертає підсумковий inventory, results і репорт без прихованих мутацій за межами керованого worktree.

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

- `npm/skills/git-reconcile/js/tests/orchestrate.test.mjs` (commitPendingChanges; forensic worktree hygiene) — native executable PATH відкидає project-local npm і npx shims; приймає чистий index, коли корисні commits уже є в branch; комітить staged remediation після final gates; видаляє лише відновлюваний node_modules; повторно чекає checks після порожнього initial rollup; ще 80

## Гарантії поведінки

- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `node_modules`.
