---
type: JS Module
title: fix-lint_python_yml.mjs
resource: plugins/ci-github/rules/python/lint_python_yml/fix-lint_python_yml.mjs
docgen:
  crc: 525f6959
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл декларує автофікс для `python/lint_python_yml`: scaffold відсутнього `.github/workflows/lint-python.yml` з канонічного шаблону правила та `template-deep-merge` для наявного workflow. Він потрібен, щоб дописувати лише канонічні поля для Python lint у GitHub Actions і зберігати локальні налаштування проєкту.

Публічна точка входу: `patterns`. Свідомо пропущені шляхи: `.github`, `.git`. Власних операцій запису у файлі немає.

## Поведінка

1. `patterns` оголошує автофікс для правила `python/lint_python_yml`, щоб репозиторій отримував канонічний GitHub Actions workflow для Python lint.

2. Якщо `.github/workflows/lint-python.yml` відсутній, автофікс має створити його з шаблону правила.

3. Якщо workflow уже існує, автофікс має доповнити його лише канонічними полями правила, не прибираючи локальні налаштування проєкту.

4. Правило свідомо не обходить службові шляхи `.github` і `.git`, але працює з цільовим workflow-файлом як із винятком для підтримки потрібної CI-конфігурації.

5. Файл лише декларує поведінку автофікса через `patterns`; власних операцій запису не виконує.

## Публічний API

- patterns — Фікс-патерни концерну: один template-deep-merge запис для `.github/workflows/lint-python.yml`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `.github`, `.git`.
