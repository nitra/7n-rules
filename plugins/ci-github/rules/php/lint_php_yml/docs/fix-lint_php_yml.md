---
type: JS Module
title: fix-lint_php_yml.mjs
resource: plugins/ci-github/rules/php/lint_php_yml/fix-lint_php_yml.mjs
docgen:
  crc: 8b0d8995
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` описує правила для робочих шляхів у межах репозиторію та свідомо пропускає `.github` і `.git`. Функція працює read-only і не пише у ФС чи БД.

## Поведінка

1. `patterns` визначає набір правил для узгодженого виправлення шаблону `lint-php.yml` у межах репозиторію.
2. `patterns` орієнтований на підтримку одного цільового workflow-файлу в `.github/workflows/lint-php.yml`, свідомо обходячи службові шляхи `.github` і `.git`.
3. `patterns` працює в режимі read-only: він формує опис змін, але не виконує запис у файлову систему чи базу даних.
4. `patterns` потрібен для стандартизації та відновлення очікуваного стану workflow-конфігурації без втручання в інші частини проєкту.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
