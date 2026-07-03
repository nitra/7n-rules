---
type: JS Module
title: main.mjs
resource: npm/rules/bun/bunfig/main.mjs
docgen:
  crc: 630711f7
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Контролює відповідність коду визначеним стандартам якості. Виконує перевірку кодової бази на предмет дотримання стилю кодування, виявлення потенційних помилок та відповідність політиці, заданій у файлі `bunfig.toml`.

## Поведінка

1. Викликає функцію `lint` для оцінки політичних зобов'язань, використовуючи конфігураційний файл `bunfig.toml`.

## Публічний API

lint — знаходить виявлені policy-концерни (згенеровано обгорткою codegen).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
