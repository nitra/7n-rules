---
session: c4c724d5-1ad9-445e-b62e-c45636474f2b
captured: 2026-06-03T08:55:09+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/c4c724d5-1ad9-445e-b62e-c45636474f2b/c4c724d5-1ad9-445e-b62e-c45636474f2b.jsonl
---

## ADR npm-publish.yml канон: release+publish в одному job

## Context and Problem Statement
Реальний workflow `.github/workflows/npm-publish.yml` містив job `release-publish` з кроками `Configure git identity` та `Release (bump + CHANGELOG + tag)` (`n-cursor release`) перед публікацією. Канонічний template у `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml` описував лише publish-only job без release-кроку, що створювало розбіжність між документацією і реальністю. Rego-перевірка при цьому enforce-ила лише subset умов і не блокувала реальний файл.

## Considered Options
* Оновити template/канон і rego-референси, щоб вони відображали реальний workflow (release+publish одним job)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити template/канон і rego-референси", because користувач прямо доручив «оновити template/канон», а реальний workflow вже реалізує правильну семантику (release через `n-cursor release` у CI на `main`, що вимагають правила `n-changelog`/`n-npm-module`).

### Consequences
* Good, because template тепер відображає реальний workflow: job `release-publish`, `contents: write`, `persist-credentials: true`, `fetch-depth: 0`, composite `setup-bun-deps`, кроки `Configure git identity` та `Release` перед публікацією.
* Good, because rego-перевірка `npm_publish_yml` залишилася subset-of — додаткові кроки дозволені, 559 тестів проходять без змін у deny-логіці.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml` — новий template із job `release-publish`
- `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego` — bracket-нотація `jobs["release-publish"]` замість `jobs.publish`
- `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml_test.rego` — `template_data`/`canonical_input` під новий job; json-patch шляхи `/jobs/release-publish/...`, індекс publish-кроку `5` замість `2`
- `npm/rules/npm-module/npm-module.mdc` + `.cursor/rules/n-npm-module.mdc` — проза і inlined template оновлені через `node npm/bin/n-cursor.js` sync
- `npm/.changes/1780466073890-276f52.md` — change-файл (Changed, patch) за STOP-протоколом `n-changelog`

Команди перевірки: `bun run lint-rego` (559 тестів, 0 failures), `node npm/bin/n-cursor.js fix npm-module` (`npm_publish_yml: 1 файл OK`), `node npm/bin/n-cursor.js fix changelog` (1/1 без зауважень).
