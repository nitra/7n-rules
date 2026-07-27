---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: 71c57408
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

## Огляд

Модуль координує Git reconcile: інвентаризує branches, worktrees і stash, передає LLM лише semantic triage та conflict/behavioral рішення, а механічне перенесення, перевірки, PR readiness і cleanup виконує детерміновано. Довгі install/test/lint/checks-команди працюють асинхронно, щоб progress heartbeat не блокувався.

## Поведінка

`runGitReconcileOrchestrator` виконує чотири однозначно підписані фази: inventory, triage, PR і cleanup. `createPhaseProgress` формує append-only snapshots та heartbeat, `runWithConcurrency` обмежує паралельність PR-груп, а `formatOutcomeCounts` і `formatReport` повертають точні counts та деталі кожного outcome.

`inventoryRepository`, `parseWorktrees` і `dedupeRefs` зводять Git refs, commit identity, open PR та фактичні worktree paths в один inventory. Protected або вже відкриті джерела не матеріалізуються й не потрапляють у небезпечний cleanup. `buildTriagePrompt`, `parseDecisionEnvelope` і `validateTriageOutcome` обмежують LLM повним JSON-рішенням над уже зібраними фактами; `callWithValidatedFallback` приймає `min` після validation або викликає `max` лише для residual cognitive failure.

Для корисної групи JS створює ізольований worktree від policy base, застосовує commits або stash і відсікає порожній tree diff. `captureCachedBehaviorBaseline` кешує Promise baseline за base OID, щоб concurrent PR-групи не дублювали test run. `validateBehaviorState` перевіряє Git state, scoped docs/lint, tests відносно baseline і changelog. `remediateBehaviorState` запускає canonical fixers для code та non-code directories; після remediation final gates повторюються у read-only режимі.

`runAsync` запускає install, tests, lint і PR checks без блокування event loop. Після push та `gh pr create` функція `verifyPullRequestReadiness` очікує terminal checks і передає PR/base rollups у `classifyPullRequestChecks`. Успішний outcome `pr-created` повертається лише для `ready`; regression, baseline-red, pending, timeout або unreadable checks зберігають branch, URL і worktree та блокують cleanup.

`cleanupSource` видаляє лише точний доказово безпечний branch/stash. Cleanup review-source дозволений після `drop` або коли всі його групи завершились `pr-created` чи `patch-equivalent`; `failed` і всі `pr-checks-*` outcomes лишають source та forensic worktree.

## Публічний API

- `runAsync` — виконує довгу команду без блокування progress heartbeat.
- `createPhaseProgress` — формує ANSI-free progress snapshots і heartbeat.
- `parseWorktrees`, `dedupeRefs`, `conflictFiles`, `inventoryRepository` — збирають і нормалізують Git inventory.
- `buildTriagePrompt`, `parseDecisionEnvelope`, `validateTriageOutcome` — задають і перевіряють bounded triage contract.
- `callRunner`, `callWithValidatedFallback` — викликають runner за схемою `min → validation → max`.
- `captureBehaviorBaseline`, `captureCachedBehaviorBaseline` — фіксують і кешують test baseline.
- `validateBehaviorState`, `validateFinalProjectGates`, `remediateBehaviorState` — виконують behavioral та canonical gates.
- `classifyPullRequestChecks`, `verifyPullRequestReadiness` — класифікують CI відносно base commit.
- `formatOutcomeCounts`, `formatReport` — формують точний deterministic summary.
- `cleanupSource`, `runGitReconcileOrchestrator` — виконують безпечний cleanup і координують повний flow.

## Гарантії поведінки

- Довгі child processes не блокують event loop і progress heartbeat.
- Baseline test Promise дедуплікується між concurrent PR-групами одного base OID.
- Canonical fixers охоплюють code/non-code scope, після чого gates повторюються без fix.
- PR вважається створеним успішно лише після terminal green checks.
- CI regression, baseline-red або непідтверджений стан завершують orchestration non-zero і зберігають forensic refs/worktree.
- Cleanup не видаляє protected, open-PR, kept, failed або `pr-checks-*` sources.
- `spawnSync.error`, зокрема `ENOENT`, зберігається в command diagnostics.
