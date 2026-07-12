---
type: ADR
title: "крок Release у `npm-publish.yml` викликає бінарник `n-cursor` з PATH"
---

# ADR: крок Release у `npm-publish.yml` викликає бінарник `n-cursor` з PATH

**Дата:** 2026-06-09
**Статус:** Прийнято

## Context and Problem Statement

Канонічний сніпет `npm-publish.yml` (`npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml`) задавав крок `Release (bump + CHANGELOG + tag)` як `run: node npm/bin/n-cursor.js release`. Цей шлях існує лише в репозиторії самого `@nitra/cursor`, де `npm/bin/n-cursor.js` — джерело бінарника. У downstream-споживачів, які лише встановлюють `@nitra/cursor` як залежність, файлу `npm/bin/n-cursor.js` немає — є тільки бінарник `n-cursor` у `node_modules/.bin`. Тому enforce канону через `npm_module.npm_publish_yml` тягнув цей рядок у чужі workflow, і їхня публікація падала з `Cannot find module .../npm/bin/n-cursor.js` (зафіксовано на `@7n/n`).

## Considered Options

* Викликати бінарник `n-cursor release` з PATH (резолвиться через `node_modules/.bin` у будь-якому споживачі).
* Лишити `node npm/bin/n-cursor.js release` — працює лише у власному репо, ламає downstream.

## Decision Outcome

Chosen option: "`n-cursor release` з PATH", because бінарник `n-cursor` є у `node_modules/.bin` кожного, хто має `@nitra/cursor` у залежностях (включно з самим репо `@nitra/cursor` як workspace), а абсолютний шлях `npm/bin/n-cursor.js` — лише у джерельному репо. Портабельний виклик робить канонічний сніпет придатним для enforce у будь-якому downstream-модулі.

Сніпет — єдине джерело істини: правка `npm-publish.yml.snippet.yml` одразу змінює enforce (`npm_module.npm_publish_yml`, generic deep-subset), без правок rego. Синхронно оновлено власний workflow `.github/workflows/npm-publish.yml`, прозу правила `npm-module.mdc` (рядок про роль кроку Release) і перегенеровано inline-снапшот `.cursor/rules/n-npm-module.mdc` через `inlineTemplateLinks`.

### Consequences

* Good, because downstream-публікація (`@7n/n` та ін.) більше не падає на неіснуючому `npm/bin/n-cursor.js`; крок Release працює однаково у джерельному репо й у споживачів.
* Bad, because виклик тепер залежить від наявності `n-cursor` у PATH (`node_modules/.bin`) — але це інваріант для будь-якого, хто має `@nitra/cursor` у залежностях, тож практичного ризику немає.

## More Information

- Канон: `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml`, крок `Release (bump + CHANGELOG + tag)`.
- Enforce: `npm_module.npm_publish_yml` (`target.json:"check":"template"`, deep-subset) — перевірено: `.github/workflows/npm-publish.yml` відповідає канону (template subset, exit 0).
- Inline-снапшот `.cursor/rules/n-npm-module.mdc` перегенеровано через `npm/scripts/lib/inline-template-links.mjs` (підхопив і прозу, і inline-сніпет).
- Узгоджено з `n-changelog`: `version`/`CHANGELOG.md` змінює лише `n-cursor release` у CI на `main`; нова версія `@nitra/cursor` публікується через change-файл `npm/.changes/260609-0925.md` (`bump: patch`, `section: Fixed`).

## Update 2026-06-09

Додаткові transcript-факти щодо portable release step:

- Канонічне джерело workflow snippet: `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml`.
- Власний workflow репозиторію: `.github/workflows/npm-publish.yml`.
- Правило: `npm/rules/npm-module/npm-module.mdc`; inline snapshot: `.cursor/rules/n-npm-module.mdc`.
- Усі релевантні місця змінено з `node npm/bin/n-cursor.js release` на `n-cursor release`.
- Conformance-перевірка `npm_module.npm_publish_yml` через `runTemplateSubsetConcern` після правок повернула exit code 0.
- Change-файл: `npm/.changes/260609-0925.md` з bump `patch` і section `Fixed`.

Окреме операційне уточнення з тієї ж сесії: для точкового оновлення inline snapshot `.cursor/rules/n-npm-module.mdc` дефолтний `n-cursor` sync був небажаний, бо self-upgrade, ADR-нормалізація, оновлення skills і `CLAUDE.md` створювали побічні зміни. Було використано одноразовий скрипт `/tmp/regen-npm-module.mjs`, який викликав `inlineTemplateLinks` з `npm/scripts/lib/inline-template-links.mjs` для одного правила. Transcript фіксує негативний наслідок цього підходу: скрипт залежить від внутрішнього API і не є офіційним інтерфейсом.
