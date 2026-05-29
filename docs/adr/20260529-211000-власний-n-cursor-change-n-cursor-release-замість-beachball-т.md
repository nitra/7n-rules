---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-29T21:10:00+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

## ADR Власний `n-cursor change`/`n-cursor release` замість Beachball та changesets

## Context and Problem Statement
При паралельній роботі субагентів у окремих git worktree (і людей-колег) кожен вручну бампив `version` у `package.json` і дописував секцію до спільного `CHANGELOG.md` зверху — гарантований git-конфлікт на merge. Потрібне рішення для bun-монорепо зі споживачами `@nitra/cursor`, де присутні як npm/JS, так і Python (`pyproject.toml`) workspace.

## Considered Options
* Beachball (`@microsoft/beachball`) — Microsoft-grade CI-флоу, JSON change-файли, `check` + `publish`
* `@changesets/cli` — стандарт JS-монорепо, markdown change-файли, незалежне версіонування
* Власний скрипт (`n-cursor change` + `n-cursor release`) з `.changes/*.md` per-workspace

## Decision Outcome
Chosen option: "Власний скрипт (`n-cursor change` + `n-cursor release`)", because Beachball і changesets підтримують лише npm/JS-граф і не вміють бампити Python workspace (`pyproject.toml`); власна реалізація переюзає наявну детекцію workspace із `npm/rules/changelog/js/consistency.mjs` та `package-manifest.mjs`, дає повний контроль над форматом CHANGELOG (Keep a Changelog, `### Added/Changed/Fixed/Removed`) і не додає зовнішніх залежностей у кожний споживчий проєкт (scope B).

### Consequences
* Good, because change-файли `.changes/<timestamp>-<short-rand>.md` per-workspace мають унікальні імена → нульова ймовірність git-конфлікту при паралельній роботі агентів у різних worktree.
* Good, because transcript фіксує очікувану користь: однакова логіка для JS і Python workspace; будь-який споживач `@nitra/cursor` може ввімкнути флоу без зовнішніх залежностей.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/changelog/js/consistency.mjs`, `npm/rules/changelog/fix.mjs`, `npm/rules/changelog/lib/package-manifest.mjs`, `.cursor/rules/n-changelog.mdc` (v2.6). Специфікація: `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`. Команди: `n-cursor change`, `n-cursor release`.

---

## ADR Модель автоматизації релізу: CI-only, гібридне авторство change-файлів, тег per-package

## Context and Problem Statement
Після вибору власного скрипту треба зафіксувати де виконується агрегація `.changes/*.md` (локально чи в CI), хто і коли пише change-файл, та як тегувати git у монорепо з незалежним версіонуванням пакетів — зокрема щоб fallback-синтез записів CHANGELOG мав надійну базу commit-range.

## Considered Options
* Агент пише change-файл явно; реліз тільки в CI на `main` (варіант A)
* Реліз на merge worktree локально (варіант B)
* Гібрид: агент пише change-файл + CI-fallback синтезує запис із комітів якщо файлу нема (варіант 3)
* Один тег на реліз (`release-<timestamp>`)
* Тег per-package (`<name>@<version>`)

## Decision Outcome
Chosen option: "Гібрид (агент пише `.changes/*.md` + CI fallback) + реліз тільки в CI на `main` + тег per-package (`<name>@<version>`)", because гібридна модель зберігає точність CHANGELOG (намір відомий агенту) і гарантує ненульовий реліз (CI fallback); CI-only агрегація серіалізує bump через наявний `concurrency` у `npm-publish.yml` і усуває гонку версій; per-package тег відповідає незалежному версіонуванню і безкоштовно дає `git describe --match '<name>@*'` як базу commit-range для fallback.

### Consequences
* Good, because bump переїжджає в єдину серіалізовану точку — CI job — тому конфлікт `version` зникає в корені.
* Good, because transcript фіксує очікувану користь: тег `<name>@<version>` дає commit-range для fallback без додаткової інфраструктури; `n-cursor release` не публікує сам — публікацію лишає наявному кроку `JS-DevTools/npm-publish`.
* Bad, because `npm-publish.yml` потребує розширення permissions (`contents: write` замість `read`, `persist-credentials: true`) і зміни `cancel-in-progress: true` → `false` — transcript фіксує ці зміни як необхідні.

## More Information
Файл CI: `.github/workflows/npm-publish.yml` (додати paths-тригер `**/.changes/**`; `permissions: contents: write`; крок `npx @nitra/cursor release` перед publish; `fetch-depth: 0`). Шаблон workflow виноситься до `npm/github-actions/` у тій самій ітерації для scope B. Специфікація: `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`.
