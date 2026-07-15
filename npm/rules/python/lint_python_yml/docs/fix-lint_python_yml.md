---
type: JS Module
title: fix-lint_python_yml.mjs
resource: npm/rules/python/lint_python_yml/fix-lint_python_yml.mjs
docgen:
  crc: 9ad8fb17
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` описує стандартні правила для роботи з workflow-файлами у репозиторії, щоб узгоджувати очікувану поведінку перевірок. Модуль свідомо пропускає `.github` і `.git`, залишається read-only та не змінює файлову систему чи базу даних.

## Поведінка

1. `patterns` формує перелік стандартних правил виправлення для `lint-python.yml`, щоб уніфікувати структуру цього workflow-файла.
2. Під час роботи орієнтується на цільовий шлях `.github/workflows/lint-python.yml` і свідомо не зачіпає `.github` та `.git`.
3. Працює в read-only режимі: сам не змінює файлову систему чи базу даних, а лише описує, що треба виправити.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
