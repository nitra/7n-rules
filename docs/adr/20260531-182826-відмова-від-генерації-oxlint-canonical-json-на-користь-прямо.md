---
session: 27bcf8ad-3d79-4564-975c-e30f0be45f1d
captured: 2026-05-31T18:28:26+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/27bcf8ad-3d79-4564-975c-e30f0be45f1d.jsonl
---

## ADR Відмова від генерації `oxlint-canonical.json` на користь прямого редагування

## Context and Problem Statement
`oxlint-canonical.json` формувався автоматично зі скелета (`oxlint-canonical-skeleton.json`) та списку правил (`oxlint-rules.tsv`) через скрипт `rebuild-oxlint-canonical.mjs`. Питання видалення `oxlint-rules.tsv` виявило, що TSV — джерело генерації, а не дублікат; однак обслуговування трирівневого пайплайну (TSV + skeleton → rebuild → JSON) ускладнює структуру без реальної необхідності.

## Considered Options
* Зберегти генераційний пайплайн (TSV + skeleton → `rebuild-oxlint-canonical.mjs` → JSON)
* Зробити `oxlint-canonical.json` єдиним source-of-truth, редагувати напряму; прибрати TSV, skeleton і rebuild-скрипт

## Decision Outcome
Chosen option: "Зробити `oxlint-canonical.json` єдиним source-of-truth", because пайплайн не давав додаткової цінності: JSON вже містить усі дані зі skeleton (поля `plugins`, `jsPlugins`, `categories`, `settings`) і TSV (поле `rules`) в одному файлі, а рантайм (`js/tooling.mjs`) завжди читав лише JSON.

### Consequences
* Good, because transcript фіксує очікувану користь: знято трирівневу залежність (TSV + skeleton → rebuild → JSON), зменшено кількість файлів у пакеті, усунуто entry `rules/js-lint/lib/rebuild-oxlint-canonical.mjs` з `knip.json`.
* Bad, because transcript не містить підтверджених негативних наслідків; неявний мінус — правила більше не зберігаються в табличному форматі, дифи `oxlint-canonical.json` стали єдиним способом відстежити зміни правил.

## More Information
Видалені файли: `npm/rules/js-lint/js/data/tooling/oxlint-rules.tsv`, `npm/rules/js-lint/js/data/tooling/oxlint-canonical-skeleton.json`, `npm/rules/js-lint/lib/rebuild-oxlint-canonical.mjs`.
Оновлені файли: `knip.json` (прибрано entry rebuild-скрипта), `.v8rignore` (прибрано рядок skeleton), `npm/rules/js-lint/js-lint.mdc`, `.cursor/rules/n-js-lint.mdc` (замінено опис генерації на «канон редагується напряму»; виправлено застарілий шлях `js/tooling/` → `js/data/tooling/`).
Change-файл: `npm/.changes/1780241234497-9b8327.md` (patch / Changed).
Верифікація: `bun test rules/js-lint/js/tests/tooling.test.mjs` → 12 pass, 0 fail.
