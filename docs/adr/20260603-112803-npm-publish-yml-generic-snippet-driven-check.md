---
type: ADR
title: "Видалення bespoke rego npm_publish_yml та перехід на generic snippet-driven check"
---

# Видалення bespoke rego npm_publish_yml та перехід на generic snippet-driven check

**Status:** Accepted
**Date:** 2026-06-03

## Context and Problem Statement

Канонічний сніпет `npm-publish.yml.snippet.yml` описував повну форму `release-publish`-job, але `npm_publish_yml.rego` перевіряв лише 4 поля (`on.push.paths`, `on.push.branches`, `id-token: write`, наявність кроку `npm-publish`). Legacy-workflow (`jobs.publish`), що задовольняв усі 4 умови, проходив `fix npm-module` без помилок, хоча реально не відповідав канонічному сніпету. Будь-яка зміна сніпета без супутнього оновлення rego повторювала цей gap.

## Considered Options

- Generic snippet-driven check: `target.json "check":"template"`, structural-subset перевірка проти повного сніпета, видалення `npm_publish_yml.rego`
- Gated enforcement: strict check вмикається лише коли репо на release-flow (сигнал: `npm/.changes/`, `npm/bin/n-cursor.js`)
- Детермінований JS-мігратор: концерн переписує `jobs.publish` → `release-publish` за зразком `nginx-default-tpl`

## Decision Outcome

Chosen option: "Generic snippet-driven check (canonical для всіх)", because сніпет стає єдиним джерелом enforce: будь-яка зміна `npm-publish.yml.snippet.yml` автоматично стає вимогою без правок rego або JS-мігратора; це пряма відповідь на вимогу «fix завжди порівнює з актуальним сніпетом».

### Consequences

- Good, because редагування сніпета одразу змінює enforce без правок rego.
- Good, because legacy-форма `jobs.publish` тепер дає `❌ concurrency має бути об'єктом` + `❌ jobs."release-publish" має бути об'єктом`, тоді як канонічний workflow проходить чисто (`✅ відповідає канону (template subset)`).
- Good, because механізм перевикористовний: інші концерни з `template/*.snippet.*` можна перевести на `"check":"template"` без нового rego.
- Bad, because усі consumer-репо без `release-publish`-job тепер отримають `❌` — breaking-зміна для тих, хто не мігрував.

## More Information

- Canonical template: `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml`
- `npm/scripts/lib/template.mjs`: гілка `checkSnippet` переписана з `JSON.stringify`-рівності на structural-subset presence (рекурсивний пошук кожного елемента сніпета в масиві джерела).
- `npm/scripts/lib/run-rule.mjs`: доданий `export async function runTemplateSubsetConcern(...)` — executor для концернів із `"check":"template"` у `target.json`.
- `npm/schemas/target.json`: додано поле `check` (enum `"template"`).
- `npm/rules/npm-module/policy/npm_publish_yml/target.json`: `"check":"template"` замість bespoke rego.
- `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego` + `*_test.rego`: видалені через `git rm`.
- Commit що підняв канон без оновлення gate: `c5acbe5` ("release-publish").
- Структурна властивість: всі whole-file концерни з `subset-of` семантикою (`npm_package_json`, `root_package_json`, `docker/lint_docker_yml` та ін.) латентно вразливі до того самого gap при зміні сніпета.
- Change-файл: `npm/.changes/1780474216612-d0dd34.md` (bump: minor).
- Тести: +4 кейси в `template.test.mjs`, +7 кейсів `runTemplateSubsetConcern` у `run-rule.test.mjs`.

## Update 2026-06-03

Початково розглядався явний JS-мігратор `npm_publish_yml.mjs`: детектує legacy-форму (відсутній `jobs.release-publish` або `permissions.contents: write`) і повністю замінює файл вмістом template-сніпета — за зразком `nginx-default-tpl`. Підхід відхилено на користь generic snippet-driven check (`"check":"template"` у `target.json`), який усуває необхідність окремого мігратора при кожній зміні сніпета.
- Детектор legacy: `jobs.release-publish` відсутній АБО `permissions.contents !== 'write'`
- Commit що підняв канон без оновлення gate: `c5acbe5` ("release-publish")

## Update 2026-06-03

Ключовий design-принцип: сніпет (`template/npm-publish.yml.snippet.yml`) є єдиним джерелом enforce. «Fix завжди порівнювати з актуальним сніпетом — міграції не потрібні при змінах сніпетів». Structural властивість системи: всі whole-file концерни з `subset-of` семантикою (`npm_package_json`, `root_package_json`, `docker/lint_docker_yml` та ін.) латентно вразливі до gap при зміні сніпета без оновлення gate. Generic механізм для реалізації вже є: `checkSnippet`/`checkTextSubset` у `npm/scripts/lib/template.mjs`; прецедент — `npm/rules/security/js/trufflehog.mjs`.
