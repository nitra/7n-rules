---
session: c4c724d5-1ad9-445e-b62e-c45636474f2b
captured: 2026-06-03T08:55:25+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/c4c724d5-1ad9-445e-b62e-c45636474f2b/c4c724d5-1ad9-445e-b62e-c45636474f2b.jsonl
---

## ADR npm-publish.yml канон: release+publish в одному job

## Context and Problem Statement
Реальний workflow `.github/workflows/npm-publish.yml` містив кроки `Configure git identity` та `Release (bump + CHANGELOG + tag)` перед публікацією, тоді як канонічний template у правилі `npm-module` описував лише publish-only workflow без release-кроку. Через це документація й template не відповідали тому, що насправді виконується в CI.

## Considered Options
* Оновити template, rego-референси та прозу `.mdc` під реальний workflow
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити template, rego-референси та прозу `.mdc` під реальний workflow", because реальний файл є валідним розширенням канону, узгодженим з вимогою `n-changelog`/`n-npm-module` виконувати bump+CHANGELOG+tag через `n-cursor release` у CI на `main`; невідповідність документації спричиняла плутанину.

### Consequences
* Good, because transcript фіксує очікувану користь: `lint-rego` — 559 тестів, 0 failures; `fix npm-module` — `npm_publish_yml: 1 файл OK`; канон у `.cursor/rules/n-npm-module.mdc` відображає реальну структуру після синку.
* Bad, because job отримав дефіс у назві (`release-publish`), що вимагає bracket-нотації в Rego замість dot-нотації; це нетривіальна зміна rego-тестів і референсів.

## More Information
Змінені файли:
- `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml` — job `release-publish`, `contents: write`, `persist-credentials: true`, `fetch-depth: 0`, composite `./.github/actions/setup-bun-deps`, кроки `Configure git identity` та `Release (bump + CHANGELOG + tag)` перед `JS-DevTools/npm-publish@v4.1.5`
- `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego` — `jobs.publish` → `jobs["release-publish"]` (bracket-нотація через дефіс)
- `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml_test.rego` — `template_data` і json-patch шляхи оновлено; індекс publish-кроку `2` → `5`
- `npm/rules/npm-module/npm-module.mdc` — проза розділу «## npm publish» оновлена; синк підставив новий inlined блок у `.cursor/rules/n-npm-module.mdc`
- `npm/.changes/1780466073890-276f52.md` — changelog entry (Changed, patch) за STOP-протоколом `n-changelog`

---

## ADR Rego-політика npm_publish_yml залишається subset-of

## Context and Problem Statement
При оновленні template до реального workflow постало питання: чи варто розширити deny-правила в `npm_publish_yml.rego`, щоб примусово перевіряти наявність нових кроків (`Configure git identity`, `n-cursor release`) у кожному проєкті?

## Considered Options
* Залишити policy як subset-of (enforce лише мінімальний набір: `on.push.paths`, `on.push.branches`, `id-token: write`, `JS-DevTools/npm-publish` з `with.package`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Залишити policy як subset-of", because policy перевіряє лише необхідний мінімум; release-крок є розширенням канону, а не обов'язковою вимогою для всіх проєктів — enforce додаткових кроків виходив би за межі наявного scope перевірки.

### Consequences
* Good, because transcript фіксує очікувану користь: `fix npm-module` пройшов на реальному файлі (`1/1 правил без зауважень`); додаткові кроки в довільних проєктах не спричинять помилкових deny.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Чотири deny-умови, що перевіряються: `on.push.paths` ⊇ `npm/**`; `on.push.branches` ⊇ `main`; хоч один job має `id-token: write`; є крок `uses: JS-DevTools/npm-publish` з `with.package: npm/package.json`. Перевірка реалізована в `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego`.
