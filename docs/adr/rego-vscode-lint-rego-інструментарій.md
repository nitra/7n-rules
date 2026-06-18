---
type: ADR
title: "Інструментарій Rego у VS Code та оновлення lint-rego"
---

# Інструментарій Rego у VS Code та оновлення lint-rego

**Status:** Accepted
**Date:** 2026-05-08

## Контекст

Проєкт використовує OPA/Rego для policy-файлів, але `rego.mdc` (v1.0) містив лише посилання на `npx @nitra/cursor check rego` без опису VS Code-інтеграції та без документації лінтингового ланцюжка `opa check` + `regal lint`.

## Рішення/Процедура/Факт

- `npm/mdc/rego.mdc` оновлено до v1.1: додано секцію VS Code з рекомендацією розширення `tsandall.opa` (від автора OPA), конфігурацію `format-on-save` через `opa fmt` у `.vscode/settings.json` та пояснення автоматичної діагностики через `opa.checkOnSave`.
- `npm/scripts/lint-rego.mjs` перероблено: preflight перевіряє наявність **і `opa`, і `regal`** у `PATH` (з підказкою `brew install opa regal` при відсутності), далі послідовно запускає `opa check --strict <targets>` та `regal lint <targets>`.
- Таргет лінтингу — `npm/policy/`; розширення через `LINT_TARGETS` у скрипті.
- `npm/package.json` bumped до 1.8.206, `npm/CHANGELOG.md` оновлено.

## Обґрунтування

`opa check --strict` ловить компіляційні помилки, мертвий код та незадекларовані змінні; `regal` ловить semantic-порушення Rego v1, неявні set-rules та style-відхилення — два інструменти доповнюють один одного. Розширення `tsandall.opa` забезпечує LSP-досвід (hover, go-to-definition, live diagnostics) без запуску CLI вручну. Встановлення `opa` і `regal` лише через `PATH` (не в `dependencies`) — за аналогією з підходом до `shellcheck` у `text.mdc`.

## Розглянуті альтернативи

Підхід з preflight + двома послідовними інструментами обрано за аналогією з `lint-ga.mjs`; інші варіанти не розглядалися.

## Зачіпає

`npm/mdc/rego.mdc`, `npm/scripts/lint-rego.mjs`, `npm/package.json`, `npm/CHANGELOG.md`, `.vscode/extensions.json`, `.vscode/settings.json`
