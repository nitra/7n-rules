---
name: n-git-reconcile
description: >-
  JS-оркестрований аналіз git-гілок, worktree та stash відносно актуального
  origin/main: детерміновано відсіює merged і patch-equivalent refs, передає
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
worktree/PR/stash, підготовку worktree від `origin/main`, cherry-pick або
застосування stash, gates, commit, push, PR і фінальний звіт.

LLM отримує лише bounded-завдання:

1. semantic triage кандидатів, які JS не може оцінити за Git-фактами;
2. розв'язання змістових конфліктів і перевірку перенесеної поведінки у вже
   підготовленому worktree.

LLM не видаляє refs, не створює worktree, не push-ить і не відкриває PR.
LLM виконує лише narrow tests, потрібні під час правок; full repository tests,
doc generation, lint і changelog gates запускає JS після cognitive кроку.
Doc-files і unified lint отримують лише унікальні директорії зміненого коду,
щоб repository-wide baseline та stale docs поза scope не забруднювали PR.

Оркестратор показує чесний фазовий progress: inventory має elapsed time без
вигаданого total, а `triage`, `PR` і `cleanup` — окремі точні bars за вже
відомими batches/groups/sources. Поточний LLM-етап показує tier `min` або
`max`. У non-TTY/CI замість перемальовування виводяться append-only рядки.

Кожен LLM-крок починається на tier `min`. JS детерміновано перевіряє:

- triage — повноту verdicts, schema, groups і commit OID;
- worktree — відсутність conflict markers та `git diff --check`;
- поведінку — repository test script відносно test baseline чистого
  `origin/main` і changelog gate. Red baseline приймається лише для
  розпізнаних Vitest failures, якщо після перенесення не додалось нових.
- змінений код — scoped `doc-files` у fix-режимі та unified lint у
  `--no-fix`, окремо для кожної code directory.

Лише валідна відповідь runner, яка провалила validation, запускає повтор того
самого bounded-завдання на `max` із точною причиною провалу. Infrastructure
failure runner завершує крок одразу: повтор іншою моделлю не маскує проблему
transport. Після провалу `max` джерело fail-closed лишається `kept` або
`failed`, не потрапляє в cleanup, а неповний triage завершує команду non-zero.

## Інваріанти

- База — тільки свіжий `origin/main`.
- Живі worktree, включно з detached HEAD за commit OID, та гілки відкритих
  PR — protected.
- Стара дата або великий divergence не означають, що зміна непотрібна.
- `ours`/`theirs` не застосовуються механічно: конфлікт розв'язується за
  поведінкою й підтверджується тестом.
- Empty cherry-pick пропускається лише за активного `CHERRY_PICK_HEAD`,
  відсутніх conflicts і порожнього staged diff.
- Вкладені `npx` не успадковують package selector зовнішнього
  `npm exec --package`.
- За невизначеності джерело лишається `kept`; misleading ready PR не
  створюється.
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
`drop-recommended` або `failed`. Для `pr-created` додає URL, перенесені коміти,
конфлікти та виконані перевірки. Для cleanup ref звіт також містить точний OID,
щоб видалення можна було аудіювати після завершення.
