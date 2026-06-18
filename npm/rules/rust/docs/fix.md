---
type: JS Module
title: fix.mjs
resource: npm/rules/rust/fix.mjs
docgen:
  crc: 38cf876b
  score: 100
---

Огляд
Файл надає механізм для виконання стандартних правил. Використовується для запуску правил через функцію runStandardRule та для запуску правил у режимі командного рядка через runRuleCli.

## Поведінка

1. Запуск правила.
    *   Виклик runStandardRule з контекстом.
    *   Повернення результату.

2. Запуск у режимі CLI.
    *   Виклик runRuleCli з директорією.
    *   Вихід з процесом залежно від результату.

## Публічний API

run — запускає правило: applies → JS-concerns → policy → mdc-refs (через runStandardRule).
Library mode — викликається CLI orchestration через `import + run`.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Кешує результати в межах одного прогону.
- Не звертається до мережі.
