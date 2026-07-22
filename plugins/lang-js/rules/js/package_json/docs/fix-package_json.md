---
type: JS Module
title: fix-package_json.mjs
resource: plugins/lang-js/rules/js/package_json/fix-package_json.mjs
docgen:
  crc: ce145bc0
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`js/package_json` задає канонічний шаблон для `package.json`, щоб T0-autofix міг створити відсутній файл або доповнити наявний лише канонічними полями, не зачіпаючи локальні значення. Це потрібно, щоб у різних пакетах зберігати однаковий базовий склад `package.json` і автоматизувати стартову синхронізацію з правилом.

## Поведінка

1. `patterns` надає набір правил для `js/package_json`, щоб узгодити `package.json` з канонічним шаблоном.
2. Якщо `package.json` відсутній, поведінка орієнтована на створення початкового scaffold із шаблону правила.
3. Якщо `package.json` уже існує, оновлюються лише канонічні поля, а локальні відмінності зберігаються.
4. Результат слугує джерелом для T0-autofix у межах `package.json` і не виконує власних записів у ФС чи БД.

## Публічний API

- patterns — Фікс-патерни концерну: один template-deep-merge запис для `package.json`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
