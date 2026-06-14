# worktree add — нагадування про незакомічені зміни

**Status:** Accepted
**Date:** 2026-06-04

## Context and Problem Statement

Команда `npx @nitra/cursor worktree add` створює worktree через `git worktree add … -b <branch>` від HEAD — незакомічені зміни з основного дерева в новий checkout не потрапляють. Це несподівано: користувач редагує файл, запускає worktree-скіл, а скіл перевіряє старіший committed-стан і не бачить нових правок. Також виявилась технічна проблема: якщо `git status --porcelain` знімати після `git worktree add`, щойно створений `.worktrees/<name>/` сам потрапляє у вивід статусу і викликає хибнопозитивне нагадування.

## Considered Options

* Opt-in флаг `--carry-dirty` — перенесення uncommitted-змін у новий worktree через `git diff HEAD --binary` + `git apply` + ручне копіювання untracked-файлів
* Змінити дефолтну поведінку `worktree add` — завжди переносити незакомічені зміни
* Показувати нагадування на екрані — повідомити про файли без мутації стану worktree
* Знімати `git status` до виклику `git worktree add`
* Знімати `git status` після виклику `git worktree add`

## Decision Outcome

Chosen option: "Показувати нагадування на екрані + знімати `git status` до `git worktree add`", because перенесення стану ламає семантику ізоляції worktree-only-скілів (`n-fix`, `flow init`), які навмисно валідують committed-стан; знімок після `worktree add` дає хибнопозитивне нагадування навіть для чистого дерева, якщо `.worktrees/` не в `.gitignore` тестового temp-dir.

### Consequences

* Good, because користувач одразу бачить список файлів (або їх кількість), які лишилися поза worktree, і може свідомо вирішити — закомітити чи відкинути.
* Good, because скіли, яким потрібна ізоляція, продовжують валідувати committed-стан без змін.
* Good, because тест «чисте основне дерево → без нагадування» проходить зелено після переміщення знімку до `worktree add`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Нова функція `buildDirtyNotice(porcelain, limit=10)` у `npm/scripts/lib/worktree.mjs`: ≤10 файлів — повний перелік, >10 — лише кількість (константа `DIRTY_LIST_LIMIT = 10`).
- `cmdAdd` у `npm/scripts/worktree-cli.mjs`: порядок виконання `status → worktree add → notice`.
- Повідомлення: `⚠️  Основне дерево має N незакомічених змін — вони НЕ потрапили в цей worktree (створено від HEAD).`
- Тести: `+5` юніт на `buildDirtyNotice` у `npm/scripts/lib/tests/worktree.test.mjs`, `+2` інтеграційних у `npm/scripts/tests/worktree-cli.test.mjs` (разом 29 зелених).
- Оновлено `.cursor/rules/n-worktree.mdc` — додано рядок про поведінку нагадування.
- Change-файл: `.changes/260604-1950.md` (bump `minor`, секція `Added`).
- Продакшн-репо захищений `.gitignore` (рядки 10–11 виключають `.worktrees/`); тестовий fresh temp-dir цього запису не має — звідси й регресія.
