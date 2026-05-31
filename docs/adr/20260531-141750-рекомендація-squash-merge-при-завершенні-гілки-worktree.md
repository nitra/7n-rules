---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T14:17:50+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Рекомендація squash-merge при завершенні гілки worktree

## Context and Problem Statement
При завершенні роботи в ізольованому git-worktree агент мав надто широкий вибір стратегій злиття (fast-forward, merge-коміт, squash), не було єдиної конвенції. Під час сесії користувач явно вказав бажану поведінку: «додай в правило worktree, щоб завжди пропонувався саме цей варіант» (squash).

## Considered Options
* Squash-merge (`git merge --squash`) — фіча як один коміт в `main`
* Fast-forward merge — зберегти всю покрокову TDD-історію
* Merge-коміт (`--no-ff`) — окремий merge-коміт поверх
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Squash-merge за замовчуванням", because логічна фіча = один коміт; CI-реліз агрегує по change-файлу, а не по індивідуальних комітах; рішення закріплено в `npm/rules/worktree/worktree.mdc` розділом «Завершення гілки worktree».

### Consequences
* Good, because transcript фіксує очікувану користь: агент завжди явно запропонує squash при завершенні worktree-гілки, не залишаючи вибір неявним.
* Bad, because transcript не містить підтверджених негативних наслідків. Покрокова TDD-історія гілки при squash втрачається, але transcript підтвердив, що для даного flow це прийнятно.

## More Information
Зміна: `npm/rules/worktree/worktree.mdc` (блок «Завершення гілки worktree»). Коміт: `b2b8e11 feat(worktree-rule): пропонувати squash-merge при завершенні гілки worktree`. Change-файл: `npm/.changes/1780218783124-a30f10.md`. Дзеркало `.cursor/rules/n-worktree.mdc` оновиться після релізу наступної версії `@nitra/cursor` (sync копіює з опублікованого пакета).

---

## ADR Дизайн розділення lint на quick і ci через meta.json (E1)

## Context and Problem Statement
Поточний `bun run lint` — монолітний послідовний ланцюг із 6+ lint-кроків, що запускається однаково і локально (під час розробки), і в CI. Потрібно розділити на швидкий (`lint`, тільки по змінених файлах) та повний (`lint-ci`, по всіх), керований через `meta.json` правила.

## Considered Options
* E1 — одне поле `lint: "quick"|"ci"` у `meta.json` правила; quick ⊆ ci; виконавець `js/lint.mjs`
* E2 — поле-обʼєкт `lint: { phase, scope }` (окремо фаза і scope)
* E3 — булеві прапорці `lintQuick: true`, `lintCi: true`
* 5-польова схема паралельної сесії (`lint`, `lintCmd`, `lintScoped`, `lintAlways`, `lintCiCmd`) — відхилена на користь E1

## Decision Outcome
Chosen option: "E1 (одне поле lint + js/lint.mjs виконавець)", because scope майже завжди корелює з фазою (quick=змінені, ci=всі), окрема вісь — YAGNI; один прапорець достатній і відповідає патерну `auto`-поля; паралельна 5-польова схема відхилена явно на користь простоти.

Додаткові рішення, прийняті в тій само сесії:
- **D3** — `js-lint` розщеплено: oxlint+eslint → `quick`; jscpd+knip → `ci` (окремий крок `js-lint-ci`)
- **F1** — CLI-оркестратор у пакеті (`npm/scripts/lint-cli.mjs`); кореневі скрипти делегують `n-cursor lint` / `n-cursor lint-ci`; хардкод-ланцюг прибирається
- **H1** — обидва набори роблять `--fix` і падають на залишку (симетрична поведінка)
- **База quick** — working-tree зміни проти HEAD + untracked файли
- **Класифікація** — `ga`, `rego`, `text`, `security` → `ci` (не приймають список файлів); `js-lint` (quick), `style-lint` (quick), `js-lint-ci` (ci), `oxfmt` (quick)

### Consequences
* Good, because transcript фіксує очікувану користь: data-driven конфігурація (meta.json керує набором, не хардкод); quick-lint миттєво пропускає незмінені файли (порожній набір = скіп); узгоджено з наявним патерном auto-rules (data-driven, CLI-виконавець).
* Bad, because transcript не містить підтверджених негативних наслідків. `ga`/`rego`/`text` не мають quick-режиму (їх CLI не приймає файли), тому в `lint` (quick) вони не виконуються взагалі — це явне спрощення, зафіксоване в spec.

## More Information
Spec: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md` (коміт `ac2b165`). Plan: `docs/superpowers/plans/2026-05-31-lint-quick-ci-e1.md` (8 задач, коміт `a434653`). Реалізація не почата на момент завершення transcript. Наявний `n-cursor lint` (case 1466 у `npm/bin/n-cursor.js`) — замінюється новим оркестратором. `run-lint-cli.mjs` — поточний timing-оркестратор, що ганяє скрипти з `package.json`; буде замінений `lint-cli.mjs`.
