---
session: 27bcf8ad-3d79-4564-975c-e30f0be45f1d
captured: 2026-05-31T20:17:59+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/27bcf8ad-3d79-4564-975c-e30f0be45f1d.jsonl
---

## ADR Перехід до `oxlint-canonical.json` як єдиного source-of-truth

## Context and Problem Statement
У пакеті `npm/rules/js-lint` налаштування oxlint зберігалися у двох формах: TSV-файл (`oxlint-rules.tsv`) + скелет (`oxlint-canonical-skeleton.json`) як джерела генерації, та `oxlint-canonical.json` як згенерований артефакт, що перебудовувався через `rebuild-oxlint-canonical.mjs`. Виникло питання, чи можна видалити TSV, оскільки JSON вже містить ідентичні дані.

## Considered Options
* Залишити TSV + skeleton як source-of-truth, JSON — артефакт генерації (попередній підхід)
* Зробити `oxlint-canonical.json` єдиним source-of-truth, видалити генераційний пайплайн

## Decision Outcome
Chosen option: "Зробити `oxlint-canonical.json` єдиним source-of-truth, видалити генераційний пайплайн", because дані в TSV і JSON були ідентичні 1:1 (JSON будувався з TSV), тому підтримка двох форматів не давала переваг, а редагування `oxlint-canonical.json` напряму є достатнім.

### Consequences
* Good, because transcript фіксує очікувану користь: усунуто зайву ланку генерації; кількість файлів та точок редагування скоротилась; тест `tooling.test.mjs` лишився зеленим (12 pass, 0 fail) — поведінка для споживачів незмінна.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені файли (через `git rm`):
- `npm/rules/js-lint/js/data/tooling/oxlint-rules.tsv`
- `npm/rules/js-lint/js/data/tooling/oxlint-canonical-skeleton.json`
- `npm/rules/js-lint/lib/rebuild-oxlint-canonical.mjs`

Оновлені файли:
- `knip.json` — прибрано entry `rules/js-lint/lib/rebuild-oxlint-canonical.mjs`
- `.v8rignore` — прибрано рядки зі skeleton та мертві `npm/scripts/utils/{knip,oxlint}-*.json` і `npm/scripts/utils/__fixtures__/**`
- `npm/rules/js-lint/js-lint.mdc` і `.cursor/rules/n-js-lint.mdc` — замінено опис «оновлення через `rebuild-oxlint-canonical.mjs` (джерело — TSV + skeleton)» на «`oxlint-canonical.json` редагується напряму»; виправлено застарілий шлях `js/tooling/` → `js/data/tooling/`

Change-файл: `npm/.changes/1780241234497-9b8327.md` (patch / Changed).
Видалено дві ADR-чернетки цієї ж сесії (`20260531-180226-…`, `20260531-180233-…`), що фіксували протилежне рішення.
