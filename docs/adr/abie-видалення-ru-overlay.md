# Видалення ru-overlay з правила abie

**Status:** Accepted
**Date:** 2026-05-14

## Контекст

Проєкт `@nitra/cursor` містив повну підтримку `ru`-середовища (k8s overlay, nginx-sidecar, HealthCheckPolicy delete-patch, окремі env-файли) у правилі `abie.mdc`, скриптах `check-abie.mjs`, `check-k8s.mjs` та Rego-політиках. Це середовище більше не використовується в проєктах AbInBev Efes.

## Рішення/Процедура/Факт

- `npm/mdc/abie.mdc` (1.19 → 1.20): видалено секції overlay `ru` (NodePort/Service, HealthCheckPolicy `$patch: delete`, nginx-sidecar WebSocket); `ignore_branches` скорочено до `main,dev,ua`.
- `npm/scripts/check-abie.mjs` (2013 → ~880 рядків): видалено всі `*Ru*` функції, константи та режим `ru`; залишено тільки `ua`-режим.
- `npm/tests/check-abie.test.mjs` (1210 → ~480 рядків): видалено тест-кейси для ru-overlay.
- `npm/scripts/check-k8s.mjs`: видалено функцію `ruKustomizationHasHealthCheckDeletePatch`.
- `npm/policy/abie/clean_merged_ignore_branches`: `required_branches := {"dev", "ua"}` (прибрано `"ru"`).
- `npm/policy/abie/base_deployment_preem`: видалено згадку `ru` з коментаря.
- `.cursor/rules/n-k8s.mdc`, `npm/mdc/k8s.mdc`: в прикладах overlay `ru/` замінено на `ua/`.
- `npm/skills/abie-kustomize/SKILL.md`: overlay лише `ua`.
- `npm/mdc/hasura.mdc`, `npm/tests/check-hasura.test.mjs`: тестовий домен `napitkivmeste.tech` замінено на `vybeerai.com.ua`.
- `.cspell.json` та `npm/mdc/text.mdc`: мовний код `ru-ru` для spell-check **залишено** — він не пов'язаний з k8s-overlay і потрібен для перевірки правопису в документації.
- Версія пакету `1.9.18 → 1.9.19`; CHANGELOG-запис додано.

## Обґрунтування

`ru`-overlay (Yandex Cloud / RU-кластер) більше не входить до інфраструктури проєктів AbInBev Efes. Підтримка мертвого коду ускладнює правила й тести. Підтримка `ru-ru` у spell-check — незалежна функція, збережена окремо.

## Розглянуті альтернативи

Залишити `ru`-overlay як опціональний режим — відхилено, бо немає живих споживачів.

## Зачіпає

`npm/mdc/abie.mdc`, `npm/mdc/k8s.mdc`, `npm/mdc/text.mdc`, `npm/mdc/hasura.mdc`, `.cursor/rules/n-k8s.mdc`, `.cursor/rules/n-text.mdc`, `npm/scripts/check-abie.mjs`, `npm/scripts/check-k8s.mjs`, `npm/tests/check-abie.test.mjs`, `npm/tests/check-hasura.test.mjs`, `npm/policy/abie/clean_merged_ignore_branches/`, `npm/policy/abie/base_deployment_preem/`, `npm/skills/abie-kustomize/SKILL.md`, `.cspell.json`, `npm/package.json`, `npm/CHANGELOG.md`.
