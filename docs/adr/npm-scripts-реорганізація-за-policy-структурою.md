---
type: ADR
title: "Реорганізація `npm/scripts/` за принципом `npm/policy/`"
---

# Реорганізація `npm/scripts/` за принципом `npm/policy/`

**Status:** Accepted
**Date:** 2026-05-14

## Контекст

`npm/scripts/` містив ~45 файлів у пласкій структурі: `check-{rule}.mjs`, `run-{rule}.mjs`, `lint-{rule}.mjs` та крос-правильна інфраструктура. `npm/policy/` вже організована за принципом «одна директорія = одне правило». Пласка структура ускладнювала навігацію та асоціацію скриптів із конкретним правилом.

## Рішення

Кожне правило отримує власну директорію в `npm/scripts/` з kebab-case іменем (за зразком назв файлів: `docker/`, `nginx-default-tpl/`, `image-avif/` тощо). Усередині директорії суфікс правила прибирається з імені файлу: `check-docker.mjs` → `docker/check.mjs`, `run-docker.mjs` → `docker/run.mjs`, `lint-ga.mjs` → `ga/lint.mjs`. Для `k8s` з кількома чек-скриптами: `k8s/check.mjs`, `k8s/check-images.mjs`, `k8s/check-scripts.mjs`, `k8s/run.mjs`. Для `text`: `text/check.mjs`, `text/run-shellcheck.mjs`, `text/run-v8r.mjs`. Крос-правильна інфраструктура (`auto-rules.mjs`, `lint-conftest.mjs`, `sync-claude-config.mjs`, `cli-entry.mjs`, `build-agents-commands.mjs`) лишається в корені `scripts/`. `utils/` залишається без змін; дублікат `scripts/ast-scan-utils.mjs` (є також у `utils/`) прибирається.

## Обґрунтування

Принцип «директорія = домен правила» вже діє в `npm/policy/`. Послідовне застосування цього принципу в `scripts/` одразу показує всі артефакти правила в одному місці та спрощує додавання нових правил за відомим патерном. Збереження повного імені файлу всередині директорії (`docker/check-docker.mjs`) відхилено як надлишковість — директорія вже несе namespace.

## Розглянуті альтернативи

- Зберегти пласку структуру — відхилено: не масштабується при 45+ файлах.
- Перенести лише `check-*` у каталоги, решту лишити в корені — відхилено: розмиває межі домену.
- snake_case для директорій (як у `policy/`) — відхилено на користь kebab-case для послідовності з іменами файлів.

## Зачіпає

`npm/scripts/` (всі `check-*.mjs`, `run-*.mjs`, `lint-ga.mjs`, `lint-rego.mjs`), `npm/bin/n-cursor.js` (статичні імпорти та динамічне `readdir` по `check-*.mjs` потребують оновлення — або рекурсивний пошук, або фіксовані шляхи), тести що імпортують `../scripts/check-*.mjs` напряму.

## Update 2026-05-14

Попередній brainstorming зафіксував початкову класифікацію файлів: `check-ga + lint-ga` → `ga/`, `check-docker + run-docker` → `docker/`, `check-k8s + run-k8s` → `k8s/`, `check-text + run-shellcheck-text + run-v8r` → `text/`, `check-rego + lint-rego` → `rego/`, `check-php + run-php` → `php/`. Конвенція іменування директорій (snake_case vs kebab-case) була відкритим питанням на момент цієї сесії — остаточне рішення (kebab-case) зафіксовано в основному записі.
