---
session: db62d6e3-6580-4414-b6f5-eda139a32052
captured: 2026-06-01T11:53:32+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/db62d6e3-6580-4414-b6f5-eda139a32052.jsonl
---

## ADR Preflight worktree-only skill — перевірка вільної назви до створення

## Context and Problem Statement
При запуску скіла `/n-fix` (worktree-only) агент одразу викликав `npx @nitra/cursor worktree add "main-fix"`, не перевіривши, чи гілка вже існує. Команда завершилась з `fatal: a branch named 'main-fix' already exists`, оскільки залишився stale worktree з попереднього запуску.

## Considered Options
* Спробувати створити worktree одразу і обробити помилку постфактум
* Перед пропозицією/створенням явно перевірити список гілок і worktree — і лише тоді обрати гарантовано вільне ім'я

## Decision Outcome
Chosen option: "Перевірити вільну назву до створення", because користувач прямо вказав: «потрібно зпочатку перевіряти, а потім уже агенту пропонувати назву яка спрацює».

### Consequences
* Good, because `git branch --list 'main-fix*'` та `git worktree list` виконуються до будь-якого `worktree add`, що унеможливлює фатальну помилку на старті скіла.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Префлайт-послідовність яку застосував агент: `git branch --list 'main-fix*' && git worktree list` → побачив `main-fix EXISTS` → обрав `main-fix2` → `npx @nitra/cursor worktree add "main-fix2"`. Збережено у пам'яті `worktree-name-check-first.md`.

---

## ADR Ліквідація stale worktree замість авторства change-file

## Context and Problem Statement
Щойно створений worktree `main-fix2` розходився з `origin/main` через те, що локальний `main` не був синхронізований у момент відгалуження. Перевірка `fix-changelog` поскаржилась на розбіжність між `npm/package.json` (3.2.2) і опублікованою версією (3.2.3 → потім 3.3.0), бо CI продовжував релізити паралельно.

## Considered Options
* Авторувати change-file у stale worktree щоб заглушити перевірку
* Видалити stale worktree і перестворити від актуального `main`

## Decision Outcome
Chosen option: "Видалити stale worktree і перестворити від актуального `main`", because git diff підтвердив, що вихідний код ідентичний `origin/main`; розбіжність стосується виключно release-артефактів (версія, CHANGELOG, спожитий change-file), а не структурного дефекту.

### Consequences
* Good, because transcript фіксує очікувану користь: не додаються зайві change-file для вже релізнутих змін; worktree відображає реальний стан проєкту.
* Bad, because CI, що активно релізить паралельно, може знов випередити новий worktree — перевірка потребує повторення з `git fetch` перед запуском.

## More Information
Команди діагностики: `git rev-list --left-right --count main...main-fix2`, `git show origin/main:npm/package.json | grep '"version"'`, `git diff d8c6a1a origin/main -- npm/scripts npm/rules docs/plans demo`. Видалення: `git worktree remove .worktrees/main-fix2 --force && git branch -D main-fix2`.

---

## ADR Хибно-позитивні changelog-помилки для local-only пакета при застарілому `origin/dev`

## Context and Problem Statement
Після перестворення worktree від синхронізованого `main` `fix-changelog` продовжував позначати пакет `demo` як такий, що містить "uncommitted relevant changes", хоча `demo/.changes/` пустий і реліз `demo@0.0.2` вже відбувся. Виявилось, що для feature-гілки базою порівняння обирається `merge-base` з `origin/dev`, а `origin/dev` відставав на 589 комітів від `main`.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Діагностувати корінь причини (stale `origin/dev`) і не авторувати хибний change-file", because `git diff --stat "$(git merge-base HEAD origin/dev)"...HEAD -- demo/` показав увесь пакет `demo/` як "нові зміни" — тобто перевірка порівнює з точкою давно до релізу, а не з реальним станом.

### Consequences
* Good, because transcript фіксує очікувану користь: не додаються зайві change-file для `demo`; ідентифіковано системну причину false-positive у `fix-changelog` при значно відсталому `origin/dev`.
* Bad, because `fix-changelog` залишається ненадійним для `demo` доки `origin/dev` не синхронізовано з `main` — це зовнішня залежність поза сесією.

## More Information
Діагностичні команди: `git merge-base HEAD origin/dev`, `git log "$(git merge-base HEAD origin/dev)"..HEAD --oneline | wc -l` (589 комітів), `git diff --stat "merge-base"...HEAD -- demo/`. Перевірка: `git show-ref --verify --quiet refs/remotes/origin/dev`.
