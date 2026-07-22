---
type: JS Module
title: fix-npm_package_json.mjs
resource: plugins/lang-js/rules/npm-module/npm_package_json/fix-npm_package_json.mjs
docgen:
  crc: 628ec1e2
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.95
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

T0-autofix для `npm-module/npm_package_json` описує `template-deep-merge`, який підтримує канонічний `npm/package.json` у npm-модулі. Він потрібен, щоб `patterns` забезпечував scaffold відсутнього файлу з шаблону правила або безпечне доповнення наявного файлу канонічними полями без втрати локальних налаштувань.

## Поведінка

1. `patterns` оголошує єдиний autofix для правила `npm-module/npm_package_json`, який забезпечує наявність канонічного `npm/package.json`.

2. Якщо `npm/package.json` відсутній, `patterns` ініціює створення файлу з шаблону, потрібного для узгодженої структури npm-модуля.

3. Якщо `npm/package.json` уже існує, `patterns` доповнює його канонічними полями з package.json, не замінюючи локальні значення та не видаляючи проєктні налаштування.

## Публічний API

- patterns — Фікс-патерни концерну: один template-deep-merge запис для `npm/package.json`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
