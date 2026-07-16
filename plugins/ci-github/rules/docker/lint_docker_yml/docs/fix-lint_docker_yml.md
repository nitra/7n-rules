---
type: JS Module
title: fix-lint_docker_yml.mjs
resource: plugins/ci-github/rules/docker/lint_docker_yml/fix-lint_docker_yml.mjs
docgen:
  crc: cbc93b9d
  model: openai-codex/gpt-5.5
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` визначає поведінку правила для обходу проєкту без змін у файловій системі чи зовнішніх сховищах. Службові директорії `.github` і `.git` свідомо не входять до перевірюваних шляхів, щоб правило працювало лише з релевантним кодом проєкту.

## Поведінка

1. `patterns` визначає правило автоматичного виправлення для workflow перевірки Docker.

2. `patterns` забезпечує наявність стандартного файлу `.github/workflows/lint-docker.yml`, щоб проєкт мав єдиний CI-контроль Docker-конфігурації.

3. `patterns` працює як read-only опис виправлення: сам модуль не змінює файлову систему чи зовнішні сховища.

4. Під час супровідного обходу шляхів свідомо не аналізуються `.github` і `.git`, щоб не змішувати службові директорії з основним кодом проєкту.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
