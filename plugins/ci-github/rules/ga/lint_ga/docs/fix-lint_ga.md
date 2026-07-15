---
type: JS Module
title: fix-lint_ga.mjs
resource: plugins/ci-github/rules/ga/lint_ga/fix-lint_ga.mjs
docgen:
  crc: 7f4ab512
  model: openai-codex/gpt-5.5
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` описує перевірку очікуваного вмісту для `.github/workflows/lint-ga.yml`, щоб lint workflow для Google Analytics залишався узгодженим із шаблоном.

Секція має read-only призначення: вона фіксує очікувану поведінку без запису у файлову систему чи базу даних. Під час загального обходу свідомо не враховуються службові шляхи `.github` і `.git`.

## Поведінка

1. `patterns` оголошує правило автоматичного виправлення для workflow lint-перевірки Google Analytics.

2. `patterns` забезпечує приведення `.github/workflows/lint-ga.yml` до очікуваного шаблонного стану, щоб CI мав стабільну перевірку GA-правил.

3. `patterns` не виконує запис самостійно: воно лише описує доступне виправлення для зовнішнього механізму застосування.

4. `patterns` свідомо не охоплює службові шляхи `.github` і `.git` як вхідні області для загального обходу, окрім цільового workflow-файлу, який має бути синхронізований із шаблоном.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
