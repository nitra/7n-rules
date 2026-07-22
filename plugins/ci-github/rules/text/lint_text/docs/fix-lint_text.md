---
type: JS Module
title: fix-lint_text.mjs
resource: plugins/ci-github/rules/text/lint_text/fix-lint_text.mjs
docgen:
  crc: 78ee3182
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` підтримує `.github/workflows/lint-text.yml` у канонічному стані: створює відсутній workflow з канонічного шаблону правила або доповнює наявний файл декларативним template-deep-merge, зберігаючи локальні поля.

## Поведінка

1. `patterns` визначає набір правил для T0-autofix у концерні `text/lint_text` і запускає декларативне злиття шаблону для `.github/workflows/lint-text.yml`.
2. Якщо цільовий workflow-файл відсутній, `patterns` ініціює його scaffold із канонічного шаблону правила.
3. Якщо workflow-файл уже існує, `patterns` доповнює лише канонічні поля, не перезаписуючи локальні зміни.
4. `patterns` працює в межах дозволених шляхів і свідомо пропускає `.github` та `.git`, щоб не зачіпати службові та службово-репозиторні області поза цим сценарієм.

## Публічний API

- patterns — Фікс-патерни концерну: один template-deep-merge запис для `.github/workflows/lint-text.yml`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `.github`, `.git`.
