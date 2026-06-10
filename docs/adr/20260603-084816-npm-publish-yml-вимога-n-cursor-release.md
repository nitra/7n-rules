# Вимога наявності кроку `n-cursor release` у `npm-publish.yml`

**Status:** Accepted
**Date:** 2026-06-03

## Context and Problem Statement

Workflow `.github/workflows/npm-publish.yml` реально виконує `n-cursor release` (bump, CHANGELOG, git-тег) перед публікацією. Проте `npm_publish_yml.rego` і `n-npm-module.mdc` не перевіряли наявність цього кроку — можна було опублікувати пакет без release-кроку без жодного deny.

## Considered Options

- (a) Будь-який крок де `run:` містить `n-cursor` і `release` (в будь-якому job файлу)
- (b) Release-крок у тому ж job і до кроку `JS-DevTools/npm-publish` (order-check)
- (c) Обидва кроки: `Configure git identity` + `n-cursor release`

## Decision Outcome

Chosen option: "(a) будь-який крок із `n-cursor … release` у файлі", because мінімально необхідний і надійний: не диктує структуру job-ів, охоплює різні форми виклику (`node npm/bin/n-cursor.js release`, `npx n-cursor release`).

### Consequences

- Good, because `npm-publish.yml` без release-кроку отримає deny із повідомленням про відсутній `n-cursor release`.
- Bad, because перевірка не гарантує порядок — release теоретично може стояти після `JS-DevTools/npm-publish`. Transcript не містить підтверджених негативних наслідків від цього.

## More Information

Змінені файли: `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego` (deny `has_release_step`), `npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.mjs` (`checkReleaseStep`), `npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.test.mjs` (4 нові тест-кейси), `.cursor/rules/n-npm-module.mdc` (пункт про `n-cursor release` у вимогах workflow).

## Update 2026-06-03

Template `npm-publish.yml.snippet.yml` оновлено до реального workflow: job перейменовано на `release-publish`, додано `contents: write`, `persist-credentials: true`, `fetch-depth: 0`, composite `setup-bun-deps`, кроки `Configure git identity` та `Release` перед публікацією. Rego переведено на bracket-нотацію `jobs["release-publish"]`. Тести `npm_publish_yml_test.rego`: json-patch шляхи під новий job, індекс publish-кроку `5`; 559 тестів, 0 failures. Валідація: `node npm/bin/n-cursor.js fix npm-module` → `npm_publish_yml: 1 файл OK`. Change-файл: `npm/.changes/1780466073890-276f52.md` (patch, Changed).
