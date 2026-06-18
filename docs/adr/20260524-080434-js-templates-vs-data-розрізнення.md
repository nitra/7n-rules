---
type: ADR
title: "Розрізнення `js/templates/` та `js/data/` у правилах `@nitra/cursor`"
---

# Розрізнення `js/templates/` та `js/data/` у правилах `@nitra/cursor`

**Status:** Accepted
**Date:** 2026-05-24

## Context and Problem Statement

У правилах `@nitra/cursor` статичні файли всередині `js/<concern>/` поділяються на два типи: шаблони, що `fix`-оркестратор копіює у проєкт користувача, та reference data, яку `check`-концерни читають для валідації. Виникло питання — де зберігати кожен тип, щоб призначення файлу було зрозумілим із шляху.

## Considered Options

* `js/templates/<concern>/` — для будь-яких статичних JSON/TSV/snippet-файлів усередині правила
* `js/data/<concern>/` — окрема папка для reference data (canonical)

## Decision Outcome

Chosen option: "Розділити за призначенням: `js/templates/` — boilerplate-стартери, `js/data/` — reference data для валідації", because критерій розрізнення — хто читає файл і навіщо: якщо `fix`-оркестратор копіює файл у проєкт і користувач потім вільно редагує його (check не валідує зміст) → `js/templates/<concern>/`; якщо `check`-концерн читає файл для валідації/трансформації стану проєкту → `js/data/<concern>/`.

### Consequences

* Good, because чітке семантичне розрізнення дозволяє одразу зрозуміти роль файлу — boilerplate vs. еталон.
* Good, because `js/data/tooling/` (oxlint-canonical, knip-canonical, oxlint-rules.tsv) коректно кваліфікується як reference data, яку `tooling.mjs` читає для порівняння з `.oxlintrc.json` користувача.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Приклади `templates/`:
- `npm/rules/adr/js/templates/hooks/.gitignore.snippet`
- `npm/rules/k8s/js/templates/kubescape_exceptions/.kubescape-exceptions.json.snippet.json`
- `npm/rules/security/js/templates/trufflehog/.trufflehog-exclude.snippet.txt`

Приклади `data/`:
- `npm/rules/js-lint/js/data/tooling/oxlint-canonical.json`
- `npm/rules/js-lint/js/data/tooling/oxlint-canonical-skeleton.json`
- `npm/rules/js-lint/js/data/tooling/oxlint-rules.tsv`
- `npm/rules/js-lint/js/data/tooling/knip-canonical.json`

Загальна схема flat-concern layout закріплена у ADR `docs/adr/20260524-063447-flat-js-концерн-лейаут.md`.
