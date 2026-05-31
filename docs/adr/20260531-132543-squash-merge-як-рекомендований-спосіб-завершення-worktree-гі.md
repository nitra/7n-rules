---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T13:25:43+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Squash-merge як рекомендований спосіб завершення worktree-гілки

## Context and Problem Statement
Після завершення feature-гілки в `.worktrees/` правило `worktree` не задавало конкретний спосіб злиття. Під час сесії Spec B (9 TDD-комітів) виникло питання: merge дасть один коміт чи дев'ять? Це спричинило явне порівняння fast-forward vs squash і рішення зафіксувати конвенцію.

## Considered Options
* Fast-forward merge (default) — зберігає всі 9 granular-комітів у `main`
* Squash merge — колапсує гілку в один семантичний коміт
* Merge-коміт (`--no-ff`) — всі коміти плюс окремий merge-запис

## Decision Outcome
Chosen option: "Squash merge", because фіча = одна логічна одиниця змін; granular TDD-коміти корисні лише в гілці й не потрібні в `main`; CI-реліз агрегує по change-файлу, не по окремих комітах. Guidance додано до `npm/rules/worktree/worktree.mdc` (коміт `b2b8e11` → `41cc767` на origin).

### Consequences
* Good, because `main` залишається чистим: один семантичний коміт на фічу замість 9+ granular TDD-записів.
* Bad, because granular TDD-прогрес (окремі commits «парсер», «тести», «видалити auto.md») зникає з `main`-логу; якщо потрібна деталізація — лише в гілці до злиття.

## More Information
Зміна у `npm/rules/worktree/worktree.mdc` — секція «Завершення гілки worktree». Change-файл `npm/.changes/1780218783124-a30f10.md` (буде включений у реліз після pub). Конкретна ситуація: Spec B (`feat/rule-meta-json`), 9 комітів, fast-forward злиття відбулось фоновою сесією до виконання squash → обрано варіант B (лишити 9 комітів) через те, що `main` вже не можна було переписати безпечно.

---

## ADR Архітектура lint-split quick/ci через meta.json

## Context and Problem Statement
Монолітний кореневий `bun run lint` виконує 6 кроків + `oxfmt` по всьому репо — занадто важкий для локального запуску під час редагування. Виникла потреба у швидкому варіанті для поточних змін і повному для CI, з можливістю data-driven конфігурації через `meta.json` правил (узгоджено з підходом Spec B).

## Considered Options
* F1: CLI-оркестратор у пакеті (`n-cursor lint`/`lint-ci`), `meta.json.lint` керує набором кроків, кореневі скрипти делегують
* F2: генерація ланцюга скриптів у `package.json` через sync
* F3: мінімальна зміна — фільтр «по змінених» для наявного ланцюга без data-driven конфігу
* D1: атрибут `lint` на рівні правила (грубо, без split `js-lint`)
* D2: атрибут на lint-кроці/інструменті (максимальна гнучкість)
* D3: атрибут на правилі + split `js-lint` як єдиний виняток
* H1: обидва режими роблять `--fix`, падають на залишку
* H2: quick фіксить, ci лише перевіряє

## Decision Outcome
Chosen option: "F1 + E1 + D3 + H1", because F1 дзеркалить наявний `lint-ga`/`lint-text` патерн (CLI-виконавець + тонкий делегат) і дозволяє data-driven набір; E1 (`meta.json.lint: "quick"|"ci"`) проста та однозначна (quick ⊆ ci семантика); D3 вирішує реальну неоднорідність `js-lint` (oxlint/eslint → quick, jscpd/knip → ci) без загального ускладнення конфігу; H1 зберігає наявну fix-поведінку без змін у CI-семантиці.

### Consequences
* Good, because `lint` (quick, по змінених файлах) миттєво скіпається при порожньому diff; набір кроків задається даними, не хардкодом; `js-lint-ci` (jscpd+knip) не смітить у локальному циклі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
База «змінених» для quick: working-tree vs HEAD + untracked (не staged-only, не vs main). Scope: лише пакет `@nitra/cursor`; кореневий `package.json` репо-споживача мігрує через sync. Spec: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md` (Approved). Plan: `docs/superpowers/plans/2026-05-31-lint-quick-all-meta-json.md` (ready-to-implement, worktree `feat/lint-meta-split`). Файли реалізації: `npm/scripts/lint-cli.mjs`, `npm/scripts/lib/changed-files.mjs`, `rule-meta.mjs` (додати `lint`-поле), case-и в `n-cursor.js`, правило `js-lint` (split + canon).
