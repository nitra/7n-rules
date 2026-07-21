---
type: JS Module
title: unit-project-entry.js
resource: plugins/lang-js/rules/storybook/vitest-config/template/unit-project-entry.js
docgen:
  crc: 84a0a5f8
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:inaccurate:0.94
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл містить еталонний запис для `unit`-проєкту. Він потрібен, щоб мати узгоджений фрагмент базового тестового середовища. Запис read-only: не пише у ФС/БД.

## Поведінка

1. Визначає канонічний запис `unit`-проєкту для списку `test.projects` у Vitest-конфігурації Storybook.

2. Позначає, що `unit`-проєкт наслідує базові налаштування тестового середовища.

3. Фіксує стабільну назву проєкту як `unit`, щоб конфігурація мала передбачуваний і уніфікований вигляд.

4. Надає еталонний фрагмент для автоматичного вставлення в конфігурацію, не виконуючи змін у файловій системі чи зовнішніх сховищах.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
