---
type: JS Module
title: fix-npm_publish_yml.mjs
resource: npm/rules/npm-module/npm_publish_yml/fix-npm_publish_yml.mjs
docgen:
  crc: 6db6decf
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` визначає правила зіставлення вмісту для `/.github/workflows/npm-publish.yml` у межах репозиторію. Файл потрібен, щоб узгоджувати цей workflow із очікуваною структурою та вмістом.

## Поведінка

1. `patterns` формує набір правил для підтримання узгодженого стану шаблонного workflow-файла `/.github/workflows/npm-publish.yml`.
2. `patterns` працює у режимі read-only: він не змінює ФС або БД.
3. `patterns` свідомо не охоплює шляхи `.github` і `.git`, щоб не зачіпати службові каталоги репозиторію.
4. `patterns` повертає готову конфігурацію для застосування до цільового файла, щоб стандартизувати його вміст у межах репозиторію.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
