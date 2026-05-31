---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T17:56:29+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Одне поле `lint` (E1) у `meta.json` замість 5-польової data-as-config схеми

## Context and Problem Statement
Паралельна агентська сесія переписала канон-spec `2026-05-31-lint-quick-ci-split-design.md` під 5-польову `data-as-config` схему (`lint`, `lintCmd`, `lintScoped`, `lintAlways`, `lintCiCmd`), яка розійшлась з раніше узгодженим E1-дизайном (одне поле `lint: "quick" | "ci"`, виконавець — `js/lint.mjs`). Треба було обрати єдиний канонічний дизайн перед початком реалізації.

## Considered Options
* **E1** — одне поле `lint: "quick" | "ci"` у `meta.json`, виконавець-логіка в `js/lint.mjs` кожного правила
* **5-польова схема** — `lintCmd`, `lintScoped`, `lintAlways`, `lintCiCmd` у `meta.json` (команда й параметри ціликом у даних)

## Decision Outcome
Chosen option: "E1", because це дизайн, узгоджений у brainstorming до початку сесії; 5-польова схема з'явилась без погодження з боку паралельної сесії, і користувач явно підтвердив: «**наш E1**».

### Consequences
* Good, because transcript фіксує очікувану користь: мінімальна схема meta.json, виконавча логіка залишається в `js/lint.mjs` правил, а не в рядках команд у JSON; реалізація завершена з 1987 тестами без порушень.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Канон-spec переписано: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md` (коміт `ac2b165`). Новий план: `docs/superpowers/plans/2026-05-31-lint-quick-ci-e1.md` (коміт `a434653`). Squash-коміт реалізації: `ebe76db`, реліз `@nitra/cursor@1.40.0`. Класифікація правил: `js-lint`, `style-lint` → `lint: "quick"`; `js-lint-ci`, `ga`, `rego`, `text`, `security` → `lint: "ci"` (підтверджено аналізом CLI-сигнатур).

---

## ADR Послідовні субагенти в ізольованому `worktree` для реалізації spec

## Context and Problem Statement
Під час реалізації Spec C (lint split) на машині одночасно активно працювали ~8 Zed-агентів та інші CLI-сесії, що спричиняло гонку за `meta.json`, `lint-cli.mjs`, `run-lint-cli.mjs` у головному checkout. Потрібен спосіб виконати всі 8 задач плану без конфліктів з фоновою активністю.

## Considered Options
* Ізольований `worktree` (через `n-cursor worktree add`) + послідовні субагенти (один на задачу)
* Зупинити всі паралельні агентські сесії й виконати в головному checkout
* Зупинитись і чекати, поки «ферма агентів» довершить одну версію самостійно

## Decision Outcome
Chosen option: "Ізольований `worktree` + послідовні субагенти", because дозволяє виконувати роботу, не втручаючись у живу активність інших сесій; користувач явно підтвердив: «підтверджую ізольований worktree через наш `n-cursor worktree add` + послідовних субагентів».

### Consequences
* Good, because transcript фіксує очікувану користь: 8 задач виконано без конфліктів, фінальний review APPROVED (7/7 інтеграційних перевірок PASS), 1987/0 тестів, дерево чисте.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Worktree створено командою `node npm/bin/n-cursor.js worktree add feat/lint-quick-ci "Spec C: lint split quick/ci (E1)"`, шлях `.worktrees/feat-lint-quick-ci`. Фінально злито squash-мерджем у `main` (`ebe76db`), worktree і гілку видалено. Субагенти T1–T8 запускались моделлю `sonnet` (T1–T5) і `opus` (T6–T8).

---

## ADR Вибірковий cherry-pick docs при дискарді застарілих feature-гілок

## Context and Problem Statement
При очищенні worktree виявились застарілі feature-гілки (відгалужились до поточних фіч і містять регресивний код), проте деякі з них мають унікальні design-документи, яких немає ні в `main`, ні на `origin`. Повний discard видаляє і код, і документи; merge вносить регрес.

## Considered Options
* Cherry-pick лише цінних docs-файлів у `main`, решту відкинути
* Повний discard (втрата і коду, і документів)
* Залишити гілку без змін

## Decision Outcome
Chosen option: "Cherry-pick лише цінних docs-файлів у `main`, решту відкинути", because дозволяє зберегти унікальну концептуальну роботу (`lifecycle-composition-design.md`, 356 рядків, v2.4) без втягування регресивного коду; користувач обрав варіант «A» після аналізу вмісту файлу.

### Consequences
* Good, because transcript фіксує очікувану користь: `docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md` збережено в `main` (коміт `f27cc40`), регресивний код worktree `claude/keen-swanson-f7dff6` відкинуто.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл витягнуто: `git show e43382b:docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md > docs/specs/…`. Worktree `.claude/worktrees/keen-swanson-f7dff6` і гілка `claude/keen-swanson-f7dff6` видалені. ADR-файли з тієї ж гілки ігноровані за явним рішенням користувача («ігноруй adr»).
