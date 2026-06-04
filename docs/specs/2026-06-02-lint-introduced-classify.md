---
kind: nitra-spec
status: draft
adr: null
plan: ../plans/2026-06-02-lint-introduced-classify.md
risk: low
---

# js-lint: класифікація findings introduced vs pre-existing (#6/A)

Дата: 2026-06-02
Беклог: #6 (варіант A — label-only; блокування без змін)

## Проблема

`flow verify` лінтить лише змінені файли, але перевіряє ВЕСЬ файл → дотик до файлу
піднімає його старий лінт-борг (дрімав, бо changed-files-only). verify падає на
помилках, яких автор НЕ вносив; незрозуміло «моє чи старе» → роздування scope.
(У цій сесії ловив багаторазово: sonarjs/no-empty-test-file, prefer-static-regex,
require-await — усе передіснуюче в дотягнутих файлах.)

## Рішення (A: label-only)

У quick-режимі `js-lint` (лише змінені файли) кожен finding позначається:
- **introduced** — рядок ∈ доданих рядків diff від HEAD;
- **pre-existing** — поза ними.
Вивід групується (🆕 introduced / 🗄 pre-existing). **Блокування без змін** —
exit ≠ 0 на будь-якому finding (introduced чи pre-existing). Лише видимість.

## Ключове технічне: порядок проти зсуву рядків від --fix

`--fix` переписує файл → номери рядків зсуваються. Тому:
1. **Фікс-пас:** `oxlint --fix` + `eslint --fix` (як зараз) — авто-фікс. Якщо обидва 0 → findings нема → return 0.
2. **Репорт-пас:** `oxlint --format=json` + `eslint --format=json` (БЕЗ --fix) на ФІНАЛЬНОМУ файлі → findings із актуальними рядками.
3. **diff:** `git diff --unified=0 HEAD -- <files>` на тому ж фінальному файлі → added-lines. Untracked-файл → усі рядки introduced.
Так finding-рядки й added-lines обидва відносно пост-фікс файлу — консистентно.

Лише quick-режим (`files` задано). Full-проєкт (`files === undefined`, ci) — без класифікації (стрімінг як є).

## Зміни секціями

### A. `npm/scripts/lib/diff-added-lines.mjs` (новий)
`addedLinesByFile(files, cwd)` → `Map<relFile, Set<number>>`. Парс `git diff --unified=0 HEAD -- files`
hunks `@@ -a,b +c,d @@` → рядки c..c+d-1. Untracked (поза HEAD) → маркер «усі рядки». Без regex-slow.

### B. `npm/rules/js-lint/js/lint-findings.mjs` (новий)
- `parseOxlint(json)` / `parseEslint(json)` → нормалізовані `{file, line, rule, message, tool}`.
- `classifyFindings(findings, addedLines)` → `{ introduced[], preExisting[] }`.
- `renderFindings(classified)` → згрупований текст.

### C. `npm/rules/js-lint/js/lint.mjs`
Quick-шлях: фікс-пас → якщо findings лишились, репорт-пас (json) → addedLines → classify → render → exit≠0.
Full-шлях незмінний.

## Тести
- diff-added-lines: hunk-парс (`@@ -1,0 +2,3 @@` → {2,3,4}); кілька hunks; untracked → всі.
- parseOxlint/parseEslint: з реальних json-семплів → нормалізовані.
- classifyFindings: finding на доданому рядку → introduced; поза → pre-existing.
- renderFindings: групи 🆕/🗄, лік.

## Не-цілі
- НЕ міняємо блокування (A, не B); full-lint без класифікації; інші правила без змін.

## Ризики
Low-med. Найбільший пункт: 2 json-формати + diff-парс + зайвий репорт-пас (повільніше на змінених). Блокування незмінне → консервативно.
