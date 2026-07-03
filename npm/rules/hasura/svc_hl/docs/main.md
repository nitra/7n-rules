---
type: JS Module
title: main.mjs
resource: npm/rules/hasura/svc_hl/main.mjs
docgen:
  crc: 241fb066
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Надайте мені чорнетку секції «overview», яку ви хочете, щоб я перевірив.

## Поведінка

1. Викликається функція `lint`.
2. Система перевіряє файли `hasura/k8s/base/svc.yaml` та `hasura/k8s/base/svc-hl.yaml` на відповідність політиці.
3. Перевірка не охоплює файли з префіксом `base/`.
4. Повертається уніфікований результат перевірки, який містить список знайдених порушень.

## Публічний API

- lint: Виявляє порушення, пов'язані з політикою (генера

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `base/`.
