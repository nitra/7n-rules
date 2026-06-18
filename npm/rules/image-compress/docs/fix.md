---
type: JS Module
title: fix.mjs
resource: npm/rules/image-compress/fix.mjs
docgen:
  crc: 38cf876b
  score: 100
---

Файл виконує запуск правила. Він приймає контекст прогону і повертає отриманий результат.

## Поведінка

1. Запуск правила.
    *   Приймає контекст прогону.
    *   Повертає результат прогону.

## Публічний API

run — запускає правило: applies → JS-concerns → policy → mdc-refs (через runStandardRule).
Library mode — викликається CLI orchestration через `import + run`.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Кешує результати в межах одного прогону.
- Не звертається до мережі.
