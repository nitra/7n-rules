# js-lint quick-режим: класифікація lint-findings на introduced vs pre-existing

**Status:** Accepted
**Date:** 2026-06-04

## Context and Problem Statement

`flow verify` запускав lint на змінених файлах, але перевіряв весь файл цілком — тому lint-борг, внесений попередніми авторами (pre-existing), блокував verify навіть якщо поточна зміна його не вносила. Розробник не міг відрізнити власні порушення від передіснуючих без ручного аналізу diff.

## Considered Options

- **A. Label-only** — класифікувати й позначати findings у виводі (`🆕 introduced` / `🗄 pre-existing`); правило блокування без змін (фейл на будь-якому finding, як раніше).
- **B. Label + relax** — класифікувати й блокувати лише на introduced; pre-existing → warning (не блокує).

## Decision Outcome

Chosen option: "A. Label-only", because користувач обрав варіант A — перш за все забезпечити видимість того, хто вніс знайдений баг, не послаблюючи самого блокування. Варіант B відкладено як потенційне послаблення гейту.

### Consequences

- Good, because `flow verify` ✅ на новому коді; вивід розбито на `🆕 introduced (N)` / `🗄 pre-existing (M)` з окремим ліком — розробник одразу бачить, що саме він вніс, без ручного зіставлення з diff.
- Good, because краш oxlint/eslint (config error, parse panic) більше не дає silent pass — детектується через `null`-семантику `parseOxlint`/`parseEslint`.
- Bad, because pre-existing findings все ще блокують verify — варіант A свідомо не знімає обмеження «чужий борг блокує verify».

## More Information

- Файли: `npm/rules/js-lint/js/lint.mjs` (рефакторинг `lintChangedClassified`, `runJson`), `npm/rules/js-lint/js/lint-findings.mjs` (`parseOxlint`, `parseEslint`, `classifyFindings`, `renderClassifiedFindings`), `npm/scripts/lib/diff-added-lines.mjs` (`parseDiffAddedLines`, `addedLinesMap`).
- Pipeline: fix-пас (`stdio: inherit`, `--fix`) → json-репорт-пас (`--format=json`, після фіксу) → classify (порівняння рядку finding з доданими діапазонами diff) → render.
- Лінтери: `bunx oxlint --format=json` → `{diagnostics:[{filename, labels:[{span:{line}}]}]}`, `bunx eslint --format=json` → `[{filePath, messages:[{line}]}]`.
- `ALL_LINES` sentinel у `diff-added-lines.mjs`: для untracked файлів весь файл вважається introduced.
- Review-фікс (🔴): `runJson` при крашу інструмента повертав `stdout=''` → `JSON.parse('')` → `[]` → тихий pass; виправлено на `null`-семантику + перевірку `status !== 0 && stdout === null` → явний fail.
- Тести: 18 (3 файли). Гілка: `flow-lint-introduced-classify`, коміт `8af1ae0e`, змерджено в `main` (`809599e2..61021f67`). `flow verify` ✅.
