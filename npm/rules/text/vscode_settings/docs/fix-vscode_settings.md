---
type: JS Module
title: fix-vscode_settings.mjs
resource: npm/rules/text/vscode_settings/fix-vscode_settings.mjs
docgen:
  crc: aa3c10a6
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.93
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл визначає, за якими правилами `patterns` перевіряє відповідність `.vscode/settings.json` конфігурації з `settings.json`. Це потрібно, щоб підтримувати узгоджений стан редакторських налаштувань у проєкті.

## Поведінка

1. `patterns` формує набір правил для приведення `.vscode/settings.json` до узгодженого стану з шаблоном.
2. `patterns` орієнтується на конфігурацію `settings.json` як на джерело очікуваного вигляду налаштувань.
3. `patterns` потрібен, щоб автоматично підтримувати єдину структуру редакторських налаштувань у проєкті.
4. `patterns` працює лише як опис правил і не виконує запис у файлову систему чи базу даних.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
