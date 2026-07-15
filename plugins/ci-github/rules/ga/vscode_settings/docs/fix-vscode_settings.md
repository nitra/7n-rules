---
type: JS Module
title: fix-vscode_settings.mjs
resource: plugins/ci-github/rules/ga/vscode_settings/fix-vscode_settings.mjs
docgen:
  crc: 712711ff
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` перевіряє та впорядковує `.vscode/settings.json` на відповідність очікуваному проєктному формату, спираючись на `settings.json`. Це потрібно, щоб редакторні налаштування залишалися в передбачуваному стані без ручних правок.

## Поведінка

1. `patterns` визначає набір правил для узгодження `.vscode/settings.json` з очікуваним шаблоном проєкту.
2. `patterns` потрібен, щоб автоматично тримати налаштування редактора в погодженому стані без ручного редагування кожного разу.
3. `patterns` працює лише з конфігурацією `.vscode/settings.json`; інших шляхів або файлів у межах цього модуля не охоплює.
4. `patterns` не виконує записів у файлову систему чи базу даних і не покладається на кешування.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
