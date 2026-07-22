---
type: JS Module
title: fix-lint_security_yml.mjs
resource: plugins/ci-github/rules/security/lint_security_yml/fix-lint_security_yml.mjs
docgen:
  crc: 7063b373
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Декларативний template-deep-merge для `security/lint_security_yml`, який або створює відсутній `.github/workflows/lint-security.yml` з канонічного шаблону правила, або доповнює наявний workflow лише канонічними полями. Пошук працює через `patterns` і свідомо пропускає `.github` та `.git`, тож правило не зачіпає ці шляхи під час автолікування. Це потрібно, щоб у репозиторії був узгоджений security-lint workflow.

## Поведінка

1. `patterns` задає єдине правило автолікування для `security/lint_security_yml`: воно готує канонічний шаблон для `.github/workflows/lint-security.yml`.
2. Якщо цільового workflow-файлу немає, `patterns` ініціює його створення зі стандартною структурою правила.
3. Якщо файл уже існує, `patterns` доповнює лише канонічні поля, не перетираючи локальні зміни.
4. `patterns` свідомо не працює з шляхами `.github` і `.git`, щоб не зачіпати службові області репозиторію.

## Публічний API

- patterns — Фікс-патерни концерну: один template-deep-merge запис для `.github/workflows/lint-security.yml`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `.github`, `.git`.
