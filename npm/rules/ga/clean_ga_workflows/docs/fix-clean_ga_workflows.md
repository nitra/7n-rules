---
type: JS Module
title: fix-clean_ga_workflows.mjs
resource: npm/rules/ga/clean_ga_workflows/fix-clean_ga_workflows.mjs
docgen:
  crc: e09e62cc
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` визначає, які шляхи правило свідомо не розглядає як цільові для перевірки: `.github` і `.git` пропускаються, щоб службові каталоги репозиторію не змішувалися з робочим кодом.

Правило працює read-only: не записує у файлову систему чи бази даних.

## Поведінка

1. `patterns` визначає правило автоматичного виправлення для workflow очищення GitHub Actions.

2. Правило гарантує наявність очікуваного файлу `.github/workflows/clean-ga-workflows.yml` на основі затвердженого шаблону.

3. Виправлення працює як read-only опис дії: саме по собі не записує зміни у файлову систему чи зовнішні сховища.

4. Під час застосування загальних перевірок свідомо не розглядаються службові шляхи `.github` і `.git`, щоб не аналізувати інфраструктурні каталоги як звичайний код.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
