---
type: JS Module
title: applies.mjs
resource: npm/rules/python/js/applies.mjs
docgen:
  crc: baca4b70
  score: 100
---

Файл перевіряє наявність файлу pyproject.toml у корені репозиторію.

## Поведінка

applies
Перевіряє наявність pyproject.toml в корені репозиторію

check
Друкує повідомлення про знахідку pyproject.toml для застосування python.mdc

## Публічний API

applies — формує намір файлу
check — виводить короткий контекст-прохід

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
