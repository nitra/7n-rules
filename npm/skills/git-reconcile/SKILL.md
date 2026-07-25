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

LLM отримує лише два bounded-завдання:

1. semantic triage кандидатів, які JS не може оцінити за Git-фактами;
2. розв'язання змістових конфліктів і перевірку перенесеної поведінки у вже
   підготовленому worktree.

LLM не видаляє refs, не створює worktree, не push-ить і не відкриває PR.

## Інваріанти

- База — тільки свіжий `origin/main`.
- Живі worktree та гілки відкритих PR — protected.
- Стара дата або великий divergence не означають, що зміна непотрібна.
- `ours`/`theirs` не застосовуються всліпу: конфлікт розв'язується за
  поведінкою й підтверджується тестом.
- За невизначеності джерело лишається `kept`; misleading ready PR не
  створюється.
- Cleanup не виконується за замовчуванням. Окреме явне прохання дозволяє
  видалити лише точні refs, уже merged/patch-equivalent або повністю перенесені.
- `git stash clear` заборонено; stash видаляється лише по одному після
  підтвердженого перенесення і явного cleanup-запиту.

## Результат

Оркестратор повертає для кожного джерела один verdict: `merged`,
`patch-equivalent`, `open-pr`, `protected`, `pr-created`, `kept`,
`drop-recommended` або `failed`. Для `pr-created` додає URL, перенесені коміти,
конфлікти та виконані перевірки.
