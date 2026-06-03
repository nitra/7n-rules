---
session: af57cc42-83b5-48b4-aa90-2e6dcfada6b4
captured: 2026-06-03T10:43:42+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/af57cc42-83b5-48b4-aa90-2e6dcfada6b4.jsonl
---

## ADR Autofix npm-publish workflow: повна заміна за шаблоном

## Context and Problem Statement
Команда `fix npm-module` тихо проходила (`exit 0`) на репозиторіях із застарілою формою `.github/workflows/npm-publish.yml` (job `publish`), бо rego-перевірка `npm_publish_yml` використовує семантику `subset-of` і enforc-ить лише `on.push.paths`, `branches`, `id-token: write` та наявність publish-кроку. Коміт `c5acbe5` підняв канонічну форму до `release-publish`-job із `contents: write`, `persist-credentials: true`, `fetch-depth: 0`, `setup-bun-deps` та `Configure git identity`, але JS-concern для матеріалізації цього шаблону не був доданий.

## Considered Options
* JS-concern `npm_publish_yml.mjs`: детектує legacy-форму (відсутній `jobs.release-publish` або `permissions.contents: write`) і повністю замінює файл вмістом `policy/npm_publish_yml/template/npm-publish.yml.snippet.yml`
* Rego-deny для legacy-форми без autofix (тихий pass стає видимою помилкою, але файл не виправляється)
* Залишити `subset-of`, задокументувати що канон — лише еталон для нових проєктів

## Decision Outcome
Chosen option: "JS-concern `npm_publish_yml.mjs`: повна заміна файлу за шаблоном", because користувач явно визначив: fix має видалити старий файл і записати новий в точності за шаблоном; шаблон IS the canonical form.

### Consequences
* Good, because `fix` більше не пропускає мовчки legacy-форму — після прогону файл завжди відповідає канону.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Canonical template: `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml`
- Новий concern: `npm/rules/npm-module/js/npm_publish_yml.mjs` (auto-discovered `discoverOneRule` з `js/*.mjs`)
- Новий тест: `npm/rules/npm-module/js/tests/npm_publish_yml.test.mjs` — сценарії: legacy→canonical (файл замінено), already-canonical (без змін), файл відсутній (skip)
- Concern реалізує `export async function check(cwd = process.cwd())` відповідно до контракту `run-rule.mjs`
- Детектор legacy: `jobs.release-publish` відсутній АБО `permissions.contents !== 'write'`
- Rego-перевірка `npm_publish_yml` (subset-of) залишається без змін
- Виявлений commit-root розриву: `c5acbe5` ("release-publish") — підняв шаблон без JS-автофіксу
