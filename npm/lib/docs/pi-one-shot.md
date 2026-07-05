---
type: JS Module
title: pi-one-shot.mjs
resource: npm/lib/pi-one-shot.mjs
docgen:
  crc: af18dc64
---

## Огляд

Тимчасовий shim Ф1 виносу `@nitra/llm-lib` (спека docs/specs/2026-07-05-llm-lib-extraction-spec.md): re-export `runOneShot` з `@nitra/llm-lib/one-shot`, щоб не ламати наявні import-шляхи consumers до Ф2. Нового коду сюди не додавати.

## Поведінка

Реекспортує `runOneShot` без змін. Власної логіки не містить.

## Гарантії поведінки

- Поведінка ідентична `@nitra/llm-lib/one-shot` — див. доку пакета.
