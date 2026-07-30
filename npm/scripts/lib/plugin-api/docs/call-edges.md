---
type: JS Module
title: call-edges.mjs
resource: npm/scripts/lib/plugin-api/call-edges.mjs
docgen:
  crc: 55f411dc
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Збирає parser-provided call facts у deterministic normalized graph edges.

## Поведінка

Вихідна функція `collectCallEdges` не передбачає обробки помилок під час аналізу логічних зв'язків; у разі неможливості визначити напрямок виклику, зв'язок буде відсутнім або віднесений до нерозв'язаного специфікатора. Результатом завжди є відсортований масив об'єктів, що описують зв'язки, що виникають між семантичними одиницями. При відсутності розкритих залежностей у наданому вхідному об'єкті, вихідний масив зв'язків буде порожнім.

## Публічний API

- collectCallEdges — Додає invoke або integrate edge для parser-derived call facts кожного semantic unit.

## Сценарії використання

- `npm/scripts/lib/tests/call-edges.test.mjs` (collectCallEdges) — нормалізує local та imported calls, відкидаючи self і unknown targets

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
