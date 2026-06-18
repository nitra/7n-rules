---
type: ADR
title: "Відмова від генераційного пайплайну oxlint-canonical.json — пряме редагування"
---

# Відмова від генераційного пайплайну oxlint-canonical.json — пряме редагування

**Status:** Accepted
**Date:** 2026-05-31

## Context and Problem Statement

`oxlint-canonical.json` формувався автоматично зі скелета (`oxlint-canonical-skeleton.json`) та списку правил (`oxlint-rules.tsv`) через скрипт `rebuild-oxlint-canonical.mjs`. Питання видалення `oxlint-rules.tsv` виявило, що TSV є джерелом генерації, а не дублікатом. Постало питання: чи виправданий трирівневий пайплайн (TSV + skeleton → rebuild → JSON), якщо рантайм читає лише JSON, а JSON вже містить усі дані з обох джерел.

## Considered Options

- Зберегти генераційний пайплайн: TSV + skeleton → `rebuild-oxlint-canonical.mjs` → JSON
- Зробити `oxlint-canonical.json` єдиним source-of-truth: редагувати напряму, прибрати TSV, skeleton і rebuild-скрипт

## Decision Outcome

Chosen option: "Зробити `oxlint-canonical.json` єдиним source-of-truth", because пайплайн не давав додаткової цінності: JSON вже містить усі дані зі skeleton (поля `plugins`, `jsPlugins`, `categories`, `settings`) і TSV (поле `rules`) в одному файлі, а рантайм (`js/tooling.mjs`) завжди читав лише JSON.

### Consequences

- Good, because знято трирівневу залежність (TSV + skeleton → rebuild → JSON), зменшено кількість файлів у пакеті, усунуто entry `rules/js-lint/lib/rebuild-oxlint-canonical.mjs` з `knip.json`.
- Bad, because правила більше не зберігаються в табличному форматі; дифи `oxlint-canonical.json` стали єдиним способом відстежити зміни набору правил. Transcript не містить підтвердження, що це сприймається як значна проблема.

## More Information

Видалені файли: `npm/rules/js-lint/js/data/tooling/oxlint-rules.tsv`, `npm/rules/js-lint/js/data/tooling/oxlint-canonical-skeleton.json`, `npm/rules/js-lint/lib/rebuild-oxlint-canonical.mjs`.

Оновлені файли: `knip.json` (прибрано entry rebuild-скрипта), `.v8rignore` (прибрано рядок skeleton), `npm/rules/js-lint/js-lint.mdc` та `.cursor/rules/n-js-lint.mdc` (опис генерації замінено на «канон редагується напряму»; виправлено застарілий шлях `js/tooling/` → `js/data/tooling/`).

Верифікація: `bun test rules/js-lint/js/tests/tooling.test.mjs` → 12 pass, 0 fail.

Change-файл: `npm/.changes/1780241234497-9b8327.md` (patch / Changed).
