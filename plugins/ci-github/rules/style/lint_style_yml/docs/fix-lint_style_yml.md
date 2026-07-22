---
type: JS Module
title: fix-lint_style_yml.mjs
resource: plugins/ci-github/rules/style/lint_style_yml/fix-lint_style_yml.mjs
docgen:
  crc: 1230aa27
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`style/lint_style_yml` описує автозастосування канонічного workflow `.github/workflows/lint-style.yml` саме для правила `lint-style.yml`. `patterns` потрібна, щоб через `template-deep-merge` створювати відсутній workflow з еталонного шаблону або доповнювати наявний лише обов’язковими канонічними полями без втрати локальних налаштувань.

## Поведінка

1. `patterns` задає автозастосування канонічного виправлення для workflow перевірки стилю.

2. Якщо `.github/workflows/lint-style.yml` відсутній, правило має створити його з еталонного шаблону.

3. Якщо workflow уже існує, правило має доповнити його лише обов’язковими канонічними полями, не перезаписуючи локальні налаштування.

## Публічний API

- patterns — Фікс-патерни концерну: один template-deep-merge запис для `.github/workflows/lint-style.yml`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
