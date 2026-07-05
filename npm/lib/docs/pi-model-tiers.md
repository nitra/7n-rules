---
type: JS Module
title: pi-model-tiers.mjs
resource: npm/lib/pi-model-tiers.mjs
docgen:
  crc: 50fde887
---

## Огляд

Тимчасовий shim Ф1 виносу `@nitra/llm-lib` (спека docs/specs/2026-07-05-llm-lib-extraction-spec.md): re-export тир-конфігу з `@nitra/llm-lib/model-tiers`, щоб не ламати наявні import-шляхи consumers до Ф2 (масового import-rewrite). Нового коду сюди не додавати.

## Поведінка

Реекспортує всі публічні експорти `@nitra/llm-lib/model-tiers`: LOCAL_MIN…CLOUD_MAX, resolveModel, thinkingLevelForTier, parseModelId. Власної логіки не містить.

## Гарантії поведінки

- Поведінка ідентична `@nitra/llm-lib/model-tiers` — див. доку пакета.
