---
type: ADR
title: "Вимога наявності кроку `n-cursor release` у `npm-publish.yml`"
---

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

## Update 2026-06-03

### Канонічний template: release+publish в одному job

Реальний `.github/workflows/npm-publish.yml` містив кроки `Configure git identity` та `Release (bump + CHANGELOG + tag)` перед публікацією, тоді як канонічний template описував лише publish-only workflow. Template, rego-референси та проза `.mdc` оновлено під реальний workflow.

- `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml` — job `release-publish`, `contents: write`, `persist-credentials: true`, `fetch-depth: 0`, composite `./.github/actions/setup-bun-deps`, кроки `Configure git identity` та `Release (bump + CHANGELOG + tag)` перед `JS-DevTools/npm-publish@v4.1.5`.
- `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego` — `jobs.publish` → `jobs["release-publish"]` (bracket-нотація через дефіс у назві job).
- `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml_test.rego` — оновлено `template_data` і json-patch шляхи; індекс publish-кроку `2` → `5`.
- `npm/rules/npm-module/npm-module.mdc` — проза розділу «## npm publish» оновлена; синк підставив новий inlined блок у `.cursor/rules/n-npm-module.mdc`.
- `npm/.changes/1780466073890-276f52.md` — changelog entry (Changed, patch).

### Rego-політика залишається subset-of

При оновленні template вирішено не розширювати deny-правила: policy перевіряє лише необхідний мінімум (4 умови: `on.push.paths` ⊇ `npm/**`; `on.push.branches` ⊇ `main`; хоч один job має `id-token: write`; є крок `uses: JS-DevTools/npm-publish` з `with.package: npm/package.json`). Release-крок є розширенням канону, а не обов'язковою вимогою для всіх проєктів — enforce додаткових кроків виходив би за межі наявного scope перевірки.
