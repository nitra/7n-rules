## ADR Рекомендувати squash-merge при завершенні worktree-гілки

## Context and Problem Statement
Після завершення роботи в git worktree щоразу поставало питання способу merge: squash чи fast-forward. Без явної рекомендації у правилі агенти та розробники могли обирати різні підходи непослідовно.

## Considered Options
* Додати рекомендацію squash-merge до правила `worktree.mdc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати рекомендацію squash-merge до правила `worktree.mdc`", because користувач явно попросив додати таку настанову, і вона реалізована через зміну файлу `npm/rules/worktree/worktree.mdc` з change-файлом через `npx @nitra/cursor change`.

### Consequences
* Good, because transcript фіксує очікувану користь: агенти отримують однозначну інструкцію щодо способу фінішу worktree-гілки, що зменшує непослідовність.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміна зафіксована комітом `b2b8e11` (пізніше rebase → `41cc767`), повідомлення: `feat(worktree-rule): пропонувати squash-merge при завершенні гілки worktree`. Change-файл створено через `npx @nitra/cursor change`. Файл правила: `npm/rules/worktree/worktree.mdc`. Нова секція у правилі: `## Завершення гілки worktree`.
