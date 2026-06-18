---
type: JS Module
title: verdict-schema.mjs
resource: npm/scripts/coverage-classify/verdict-schema.mjs
docgen:
  crc: ecf5dfe1
  score: 100
---

Файл надає схему `VerdictSchema` для валідації вердиктів LLM-класифікатора. Функція `parseVerdict` витягує JSON-об'єкт з сирої текстової відповіді моделі та перевіряє його відповідність визначеній схемі.

## Поведінка

VerdictSchema
Визначає схему для валідації вердикту LLM-класифікатора

parseVerdict
Витягує JSON-об'єкт з текстової відповіді LLM і валідує його за схемою

## Публічний API

VerdictSchema — Схема для структури вердикту.
parseVerdict — Витягує JSON з тексту LLM і перевіряє його за схемою VerdictSchema.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
