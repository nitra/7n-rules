---
session: 9c553e2d-a475-4c48-a22f-60d259211c57
captured: 2026-05-24T08:04:10+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9c553e2d-a475-4c48-a22f-60d259211c57.jsonl
---

## ADR: Шлях до артефактів тулінгу в `js-lint` — `js/tooling/` vs `js/data/tooling/`

## Context and Problem Statement
Під час перевірки відповідності `npm/rules/rust/fix.mjs` конвенції fix/lint/policy (ADR 2026-05-16) асистент виявив розбіжність: обидва `.mdc`-специфікаційні файли (`cursor/.cursor/rules/n-js-lint.mdc` рядок 43 і `npm/rules/js-lint/js-lint.mdc` рядок 28) посилаються на шлях `npm/rules/js-lint/js/tooling/oxlint-canonical.json`, тоді як реальна директорія знаходиться за шляхом `npm/rules/js-lint/js/data/tooling/`.

## Considered Options
* Зберегти поточне розташування `js/data/tooling/` і оновити документацію в `.mdc`-файлах
* Перемістити артефакти з `js/data/tooling/` → `js/tooling/` відповідно до задокументованого flat-концерн-лейауту (`CHANGELOG` v1.15.0: «кожен JS-концерн правила тепер один файл `npm/rules/<rule>/js/<concern>.mjs`»)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розбіжність зафіксована, але рішення в transcript не прийнято", because сесія завершилась на етапі дослідження: `grep`-команди підтвердили наявність stale-посилань у `.mdc`, однак жодних змін до файлів внесено не було.

### Consequences
* Good, because transcript фіксує очікувану користь: ідентифіковано конкретні рядки з помилковими шляхами — `n-js-lint.mdc:43` і `js-lint.mdc:28` — що дозволяє точково виправити документацію.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Виявлено розбіжність: `.mdc` посилається на `npm/rules/js-lint/js/tooling/oxlint-canonical.json`, а реальний шлях — `npm/rules/js-lint/js/data/tooling/`
- Суміжний ADR: `docs/adr/20260516-rules-fix-lint-policy-structure.md`
- Відповідний CHANGELOG-запис (v1.15.0): «Flat концерн-лейаут: `npm/rules/<rule>/js/<concern>.mjs`»
- Файли, що містять stale-посилання: `.cursor/rules/n-js-lint.mdc` рядок 43, `npm/rules/js-lint/js-lint.mdc` рядок 28
