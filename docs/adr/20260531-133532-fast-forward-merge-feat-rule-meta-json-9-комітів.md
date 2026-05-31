## ADR Залишити 9 комітів при fast-forward merge гілки feat/rule-meta-json

## Context and Problem Statement
Гілку `feat/rule-meta-json` з реалізацією data-driven `meta.json` для авто-детекції правил було змержено в `main` через fast-forward паралельною сесією. Перед очищенням worktree постало питання: зберегти 9 комітів як є чи зробити squash в 1 коміт.

## Considered Options
* B — залишити 9 комітів без squash (fast-forward)
* A — squash в 1 коміт

## Decision Outcome
Chosen option: "B — залишити 9 комітів без squash", because користувач явно обрав варіант B, і merge вже відбувся через fast-forward.

### Consequences
* Good, because transcript фіксує очікувану користь: повна git-історія гілки зберігається в `main`, кожен коміт залишається атомарним і простежуваним.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Worktree і гілка `feat/rule-meta-json` очищені паралельною сесією після merge. Рішення зачіпає лише цю конкретну гілку; окремо в правило `npm/rules/worktree/worktree.mdc` додано рекомендацію завжди пропонувати squash-merge при завершенні worktree-гілки (коміт `b2b8e11`, rebased `41cc767`).
