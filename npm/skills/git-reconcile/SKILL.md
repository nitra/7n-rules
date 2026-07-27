---
name: n-git-reconcile
description: >-
  JS-оркестрований аналіз git-гілок, worktree та stash відносно актуальної
  policy base branch: детерміновано відсіює merged і patch-equivalent refs, передає
  LLM лише semantic triage та conflict resolution, а корисні зміни переносить
  у перевірені PR. Використовуй, коли просять розібрати, консолідувати,
  підготувати PR або безпечно почистити старі Git refs і stash.
---

# n-git-reconcile — узгодження Git-графа

Запускай через JS-оркестратор:

```bash
npx @7n/rules skill pi git-reconcile
```

`cursor` і `codex` підтримуються замість `pi`. Без раннера команда лише друкує
цей skill як промпт і не виконує reconciliation.

## Розподіл відповідальності

JS виконує `fetch`, inventory, patch-equivalence, дедуплікацію refs, збір
worktree/PR/stash, підготовку worktree від `origin/<baseBranch>`, cherry-pick або
застосування stash, gates, commit, push, PR і фінальний звіт. Semantic no-op
після conflict resolution детерміновано пропускає через `cherry-pick --skip`;
порожній tree diff не push-иться і не створює PR.

LLM отримує лише bounded-завдання:

1. semantic triage кандидатів, які JS не може оцінити за Git-фактами;
2. розв'язання змістових конфліктів і перевірку перенесеної поведінки у вже
   підготовленому worktree.

LLM не видаляє refs, не створює worktree, не push-ить і не відкриває PR.
LLM виконує лише narrow tests, потрібні під час правок; full repository tests,
doc generation, lint і changelog gates запускає JS після cognitive кроку.
Doc-files і unified lint отримують лише унікальні директорії зміненого коду,
щоб repository-wide baseline та stale docs поза scope не забруднювали PR.

Оркестратор показує чесний ANSI-free фазовий progress: inventory має elapsed
time без вигаданого total, а `triage`, `PR` і `cleanup` — окремі точні
append-only bar snapshots за вже відомими batches/groups/sources. Поточний
LLM-етап показує tier `min` або `max`; довгі етапи кожні 30 секунд отримують
heartbeat з elapsed time. Формат однаковий у TTY/CI, тому captured output не
містить cursor-control spam. Install, tests, lint і очікування PR checks
виконуються через non-blocking child processes, тому heartbeat не завмирає.

Незалежні PR-групи виконуються з bounded concurrency `3`; override
`N_GIT_RECONCILE_CONCURRENCY=1..4`. Порядок фінального звіту лишається
детермінованим, а cleanup починається лише після завершення всіх PR jobs.

Кожен LLM-крок починається на tier `min`. JS детерміновано перевіряє:

- triage — повноту verdicts, schema, groups і commit OID;
- worktree — відсутність conflict markers та `git diff --check`;
- поведінку — repository test script відносно test baseline чистої
  `origin/<baseBranch>` і changelog gate. Red baseline приймається лише для
  розпізнаних Vitest failures, якщо після перенесення не додалось нових.
- змінений код — scoped `doc-files` у fix-режимі та unified lint у
  `--no-fix`, окремо для кожної code directory.

Після min validation failure JS спершу запускає canonical scoped/changelog
fixers. Якщо вони детерміновано усунули format, CSpell, docs або changeset
дефект, min приймається без `max`. Лише residual behavioral failure запускає
повтор того самого bounded-завдання на `max` із точною причиною. Infrastructure
failure runner завершує крок одразу: повтор іншою моделлю не маскує проблему
transport. Після провалу `max` джерело fail-closed лишається `kept` або
`failed`, не потрапляє в cleanup, а неповний triage завершує команду non-zero.

## Інваріанти

- База — тільки свіжий `origin/<baseBranch>` із repository Git policy.
- Живі worktree, включно з detached HEAD за commit OID, та гілки відкритих
  PR — protected.
- Стара дата або великий divergence не означають, що зміна непотрібна.
- `ours`/`theirs` не застосовуються механічно: конфлікт розв'язується за
  поведінкою й підтверджується тестом.
- Empty cherry-pick пропускається лише за активного `CHERRY_PICK_HEAD`,
  відсутніх conflicts і порожнього staged diff.
- Вкладені `npx` не успадковують package selector зовнішнього
  `npm exec --package`.
- Перед створенням worktree JS додає `.worktrees/` до локального
  `.git/info/exclude`, не змінюючи tracked `.gitignore` consumer-а.
- ACP semantic idle watchdog не подовжується від `usage`, thought,
  config або повторних tool-update events; його скидають лише новий tool-call
  чи agent output.
- За невизначеності джерело лишається `kept`; misleading ready PR не
  створюється.
- Перед push обов'язково проходять фінальний tree-diff guard, domain lint для
  non-code paths, changelog і `git diff --check`; code changes додатково
  проходять scoped docs/lint та tests.
- Canonical fixers охоплюють code і non-code directories; після механічного
  виправлення фінальні gates обов'язково запускаються повторно без fix.
- Behavioral LLM не викликається для змін без code paths; test baseline
  актуальної policy base branch кешується між PR-групами.
- Після `gh pr create` JS чекає terminal CI state і порівнює failed checks із
  base commit. Лише `ready` PR дозволяє cleanup; regression, baseline-red,
  timeout, pending або unreadable checks зберігають branch, URL і worktree та
  завершують команду non-zero.
- Cleanup виконує лише JS і тільки після inventory/PR-фази: видаляє точні refs,
  уже merged/patch-equivalent, явно класифіковані як `drop` або повністю
  перенесені в успішний PR.
- Live worktree, open PR, `kept` і будь-яке джерело з проваленим перенесенням
  не видаляються.
- `git stash clear` заборонено; stash видаляється лише по одному після
  підтвердженого перенесення і явного cleanup-запиту.

## Результат

Оркестратор повертає для кожного джерела один verdict: `merged`,
`patch-equivalent`, `open-pr`, `protected`, `pr-created`, `kept`,
`drop-recommended`, `pr-checks-regressed`, `pr-checks-baseline-red`,
`pr-checks-unverified` або `failed`. `pr-created` означає, що checks завершились
успішно; для непідтвердженого PR звіт зберігає URL, branch, worktree і точну
причину. Summary містить точний count кожного outcome. Для cleanup ref звіт
також містить точний OID і видалені aliases.
