---
session: 9c553e2d-a475-4c48-a22f-60d259211c57
captured: 2026-05-24T08:04:34+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9c553e2d-a475-4c48-a22f-60d259211c57.jsonl
---

Проаналізую сесію та підготую ADR.

## ADR: Розрізнення `js/templates/` vs `js/data/` у правилах `@nitra/cursor`

## Context and Problem Statement

Під час обговорення коректності структури `npm/rules/js-lint/js/data/tooling/` виникло питання, чому canonical-файли (`oxlint-canonical.json`, `oxlint-rules.tsv` тощо) розміщені в `js/data/`, а не в `js/templates/`. Потрібно було окреслити принцип, що відрізняє ці дві підпапки.

## Considered Options

* `js/templates/<concern>/` — для будь-яких статичних JSON/TSV/snippet файлів усередині правила
* `js/data/<concern>/` — окрема папка для reference data (canonical)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Розділити за призначенням: `js/templates/` — boilerplate-стартери, `js/data/` — reference data для валідації", because критерій розрізнення — хто читає файл і навіщо: якщо `fix`-оркестратор копіює файл у проєкт і юзер потім вільно редагує його (check не валідує зміст) → `js/templates/<concern>/`; якщо `check`-концерн читає файл для валідації/трансформації стану юзерського проєкту → `js/data/<concern>/`.

### Consequences

* Good, because transcript фіксує очікувану користь: чітке семантичне розрізнення дозволяє одразу зрозуміти роль файлу — boilerplate vs. еталон.
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

Загальна схема flat-concern layout закріплена у плані `docs/superpowers/plans/2026-05-23-flat-concern-layout.md` і ADR `docs/adr/20260524-063447-flat-концерн-js-лейаут-у-nitra-cursor.md`.
