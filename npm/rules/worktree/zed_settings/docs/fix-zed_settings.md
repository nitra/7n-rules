---
type: JS Module
title: fix-zed_settings.mjs
resource: npm/rules/worktree/zed_settings/fix-zed_settings.mjs
docgen:
  crc: 3cff4486
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 0
  issues: refusal-filler,best-of-2:retry-lost
---

## Огляд

Будь ласка, надайте чорнетку, яку потрібно перевірити.

## Поведінка

1. Застосувати шаблонний deep-merge до файлу settings.json
2. Ігнорувати локальні налаштування користувача
3. Використовувати шаблонний патерн worktree-zed_settings-template для корекції
4. Змінювати лише визначений шлях: .zed/settings.json

## Публічний API

- patterns — Fix-патерни концерну: один шаблонний deep-merge у `.zed/settings.json`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
