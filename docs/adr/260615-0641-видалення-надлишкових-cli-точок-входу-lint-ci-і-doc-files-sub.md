---
type: ADR
title: "Видалення надлишкових CLI точок входу: lint-ci і doc-files <sub>"
description: CLI @nitra/cursor видаляє alias-команди lint-ci і deprecated doc-files <sub>, бо вони не мають живих caller-ів і дублюють наявні команди.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

CLI `@nitra/cursor` (`npm/bin/n-cursor.js`) накопичив дублюючі точки входу. `lint-ci` був чистим аліасом `lint --read-only --full`, а `doc-files <sub>` — deprecated-делегатом до `lint-doc-files`/`fix-doc-files`. Grep по `.github`, root `package.json`, `.mjs`/`.js` і MDC-файлах показав нуль живих викликів.

## Considered Options

- Залишити `lint-ci` і `doc-files <sub>` для зворотної сумісності.
- Видалити `lint-ci` і `doc-files <sub>` як надлишкові alias-команди без власної поведінки.

## Decision Outcome

Chosen option: "видалити `lint-ci` і `doc-files <sub>`", because transcript фіксує нуль живих caller-ів і відсутність унікальної поведінки в обох command entrypoints.

### Consequences

- Good, because зменшується поверхня CLI і кількість підтримуваних entrypoints.
- Good, because `lint --read-only --full` покриває CI-сценарій без окремої команди.
- Good, because `lint-doc-files` і `fix-doc-files` покривають doc-files сценарії без deprecated-шару.
- Bad, because видалення публічних команд є breaking change і зафіксоване як `bump: major`.
- Neutral, because transcript також фіксує супутнє виправлення schema enum `lint` з `quick`/`ci` на `per-file`/`full`.

## More Information

Файли й факти з transcript:

- `npm/bin/n-cursor.js` — видалено `case 'lint-ci'`, `case 'doc-files'`, рядки в шапці, перелік у `default`-помилці та коментар у root-guard.
- `npm/schemas/rule-meta.json` — enum `['quick', 'ci']` замінено на `['per-file', 'full']` відповідно до `parseRuleLintSpec`.
- `npm/rules/js-lint-ci/js-lint-ci.mdc` — `lint-ci` замінено на `lint --full` / `lint --read-only --full`.
- `npm/.changes/260615-0638.md` — changeset `bump: major`, `section: Removed`.
- Перевірки: `node --check bin/n-cursor.js` — OK; `vitest run` — 6/6 passed.

## Update 2026-06-15

Ранній крок тієї самої зміни окремо зафіксував видалення `lint-ci` як чистого аліаса `runLint({ full: true, readOnly: true })` і виправлення enum `lint` у `npm/schemas/rule-meta.json`.

Додаткові факти з transcript:

- `lint-ci` був ідентичний `lint --read-only --full`.
- Живих caller-ів у workflow, CI-конфігах або root `package.json` не було; лишалися документаційні рядки.
- `npm/schemas/rule-meta.json` мав застарілий enum `['quick', 'ci']`, тоді як runtime-код використовував `['per-file', 'full']`.
- Перевірки: `node --check npm/bin/n-cursor.js` — OK; vitest для lint orchestrator — 6/6 passed; `JSON.parse` schema-файлу — OK.

## Update 2026-06-15

Окремий transcript підтвердив частину рішення про `lint-ci` і зафіксував супутнє виправлення schema-контракту.

Додаткові факти з transcript:

- `n-cursor lint-ci` не мав живих caller-ів у workflow, root `package.json` або skills; лишалися doc-рядки, `CHANGELOG.md` і `default`-помилка.
- Альтернатива `lint-ci` для CI: `lint --read-only --full`.
- `npm/schemas/rule-meta.json` описував мертвий контракт `quick`/`ci`, тоді як `parseRuleLintSpec` і реальні `meta.json` використовували `per-file`/`full`.
- `npm/rules/doc-files/js/lint.mjs` на момент цього transcript описувався як detect-only; пізніші драфти уточнили фактичний fix-mode через `runDocFilesGenCli`.
