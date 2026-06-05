# Git Worktree Lifecycle: критерії keep vs discard та виявлення shared drift

**Status:** Accepted
**Date:** 2026-05-31

## Context and Problem Statement

Після завершення фічі в репозиторії накопичилося 6 git-worktree різного ступеня актуальності (від поточної та паралельних сесій). Потрібно визначити критерії: які worktree безпечно видаляти, а які зберегти, щоб не втратити незбережену чи незмерджену роботу. Особлива складність: uncommitted-зміни не завжди є живою роботою — вони можуть бути застарілим станом (shared drift), переписаним main ще раніше.

## Considered Options

- Видалити всі worktree (крім main-checkout) без аналізу
- Лишити всі worktree без змін
- Ітеративно аналізувати кожен worktree: порівняння з main, uncommitted-статус, merged-прапор — і приймати рішення окремо

## Decision Outcome

Chosen option: "Ітеративний аналіз кожного worktree із конкретними критеріями keep/discard", because лише поточний аналіз дозволяє розрізнити stale uncommitted від живої незбереженої роботи і не видалити незворотньо унікальний контент.

Критерії **DISCARD**: (1) гілка merged або вміст вже в main І (2) uncommitted-зміни = shared drift (ідентичні між кількома worktree, старіші за main) → merge призвів би до регресу.

Критерії **KEEP**: worktree містить унікальну незбережену роботу (uncommitted або non-merged коміти), якої немає ні в main, ні на origin. Окремий випадок: регресивний код але унікальний design-документ → cherry-pick лише документа в main перед дискардом.

### Consequences

- Good, because ітеративний аналіз дозволив видалити `cursor-ci-bump` і `feat-skill-meta` без втрат (committed-робота вже в main); унікальний spec з `keen-swanson-f7dff6` збережено.
- Bad, because ітеративний аналіз масштабується погано при великій кількості worktree — кожен потребує серії git-команд.
- Neutral, because три worktree (`coverage-fix`, `n-coverage-fix`, `stryker-incremental`) мали по 21–38 uncommitted-файлів, які виявились shared drift: ідентичні між worktree, mtime від 26.05.2026 (4+ дні до дати сесії) — це freeze старого base-стану, переписаного main.

## More Information

Команди для аналізу кожного worktree:

`git rev-list --left-right --count origin/main...<branch>` — ahead/behind.

`git log --format='%h %s' origin/main..<branch> | grep -viE 'release:|^adr$'` — унікальні коміти.

`git diff --name-only --diff-filter=A main <worktree-HEAD>` — нові файли в гілці.

`git -C <worktree> status --porcelain | grep -v 'docs/adr/'` — uncommitted без adr-шуму.

Виявлення shared drift: `diff -q <wt1>/<file> <wt2>/<file>` (ідентичний між worktree?); порівняти mtime з датою останнього коміту main на цьому файлі.

Перевірка наявності файлу в main: `git cat-file -e main:<path>` → ненульовий exit = відсутній.

Приклади: `cursor-ci-bump` — 18 унікальних non-release комітів, але `npm/scripts/coverage-classify/` (10 файлів) вже в main → discard. `feat-skill-meta` — 1 коміт (worktree-конвенція), `npm/rules/worktree/worktree.mdc` вже в main → discard. `keen-swanson-f7dff6` — унікальний `docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md` (356 рядків, v2.4) відсутній в main/origin → cherry-pick або keep.

## Update 2026-05-31

**Ізольований worktree для реалізації при активній фермі агентів:** при ~8 паралельних агентських сесіях, що одночасно комітять у `main`, реалізація через окремий worktree запобігає race conditions за спільні файли. Субагенти в ізольованому worktree виконуються послідовно (один на задачу), що виключає внутрішню конкуренцію. Worktree створено: `node npm/bin/n-cursor.js worktree add feat/lint-quick-ci "Spec C: lint split quick/ci (E1)"`. Перед стартом зупинено конкуруючі сесії (PIDs 87165 та 68615) через `kill -KILL`. Субагенти T1–T8 запускались моделями `sonnet` (T1–T5) та `opus` (T6–T8). Фінально — squash-merge у `main` (`ebe76db`), worktree і гілку видалено.

**Вибірковий cherry-pick docs при дискарді застарілих гілок:** якщо гілка містить регресивний код, але унікальний design-документ, що відсутній в main/origin, — зберегти документ через `git show <sha>:<path> > <dest>` і лише тоді виконати `git worktree remove` + `git branch -D`. Приклад: `docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md` (356 рядків, v2.4) з `claude/keen-swanson-f7dff6` — код регресивний (відсутній lint-split), але spec унікальний.

## Update 2026-06-01

**Конфліктний rebase при синхронізації worktree → main:**

При спробі `git rebase main` у гілці `main-fix` виник конфлікт у `npm/scripts/lib/worktree-notice.mjs`: `main` містив коміт `bfdde36 worktree2`, якого не було в `main-fix` (worktree створювався від `a288edc`). Rebase скасовано (`git rebase --abort`).

Обраний workaround — ручне копіювання цільових файлів (`cp .worktrees/main-fix/.oxlintrc.json .oxlintrc.json`), потім `git stash push -u` → `git pull --ff-only origin main` → `git stash pop` в основному worktree. Після stash pop зміни лишаються незакоміченими — user вирішує, що комітити.

Відкрите питання (залишилось без рішення в сесії): автоматизована команда для «забрати свіжі зміни з поточної гілки і перенести файли з worktree в основне дерево».
