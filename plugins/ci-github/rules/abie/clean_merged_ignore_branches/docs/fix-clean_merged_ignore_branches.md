---
type: JS Module
title: fix-clean_merged_ignore_branches.mjs
resource: plugins/ci-github/rules/abie/clean_merged_ignore_branches/fix-clean_merged_ignore_branches.mjs
docgen:
  crc: f3646572
  model: openai-codex/gpt-5.5
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` визначає набір шляхів репозиторію, які правило має враховувати під час перевірки. Воно свідомо не охоплює `.git` і `.github`, щоб не аналізувати службові дані Git та конфігурацію GitHub. Правило працює read-only: лише повідомляє про невідповідність очікуваній структурі, не змінюючи файли чи зовнішні сховища.

## Поведінка

1. `patterns` визначає правило виправлення, яке забезпечує наявність workflow для очищення merged branches.

2. Правило орієнтується на шаблонний стан файлу `.github/workflows/clean-merged-branch.yml`, щоб уніфікувати поведінку репозиторіїв щодо прибирання вже злитих гілок.

3. Під час перевірки свідомо не обходить службові шляхи `.github` і `.git`, окрім цільового workflow-файлу, який є предметом виправлення.

4. `patterns` лише описує очікуване виправлення й не виконує самостійного запису у файлову систему чи інші сховища.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
