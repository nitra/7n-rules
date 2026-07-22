---
type: JS Module
title: fix-lint_rust_yml.mjs
resource: plugins/ci-github/rules/rust/lint_rust_yml/fix-lint_rust_yml.mjs
docgen:
  crc: 4312b7ec
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл описує T0-autofix для `rust/lint_rust_yml`: scaffold відсутнього `.github/workflows/lint-rust.yml` з канонічного шаблону правила або `template-deep-merge` канонічних полів у наявний workflow зі збереженням локальних налаштувань.

Публічна функція `patterns` декларує цю поведінку для правила. Обхід свідомо пропускає шляхи `.github` і `.git`, щоб не аналізувати службові директорії як джерела проєктного Rust-коду.

## Поведінка

1. `patterns` оголошує єдиний сценарій autofix для Rust lint workflow.

2. Сценарій створює відсутній `.github/workflows/lint-rust.yml` за канонічним шаблоном правила, щоб проєкт мав стандартну GitHub Actions перевірку Rust lint.

3. Якщо workflow уже існує, сценарій доповнює його лише канонічними полями, зберігаючи локальні налаштування проєкту.

4. Autofix свідомо не обходить службові шляхи `.github` і `.git` як звичайні цілі аналізу; `.github/workflows/lint-rust.yml` використовується лише як визначений цільовий workflow-файл.

## Публічний API

- patterns — Фікс-патерни концерну: один template-deep-merge запис для `.github/workflows/lint-rust.yml`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `.github`, `.git`.
