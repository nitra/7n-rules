---
type: JS Module
title: registry.mjs
resource: llm-lib/lib/internal/registry.mjs
docgen:
  crc: a37ca8f0
---

## Огляд

Substrate-coupled резолвінг моделей — єдине місце, де llm-lib торкається pi ModelRegistry. INTERNAL-модуль: не входить у публічний API пакета, бо `resolveModelSpec` повертає pi Model-обʼєкт (pi-типи не виходять за межі пакета).

## Поведінка

resolveModelSpec — резолвить рядок `"provider/model-id"` у pi Model-обʼєкт через інжектований registry; malformed-специфікатор або незнайдена модель → `null`.
getRegistry — lazy singleton pi `ModelRegistry` (вантажить `~/.pi/agent/models.json` + `auth.json`); dynamic import pi відбувається лише тут, тому top-level import модулів пакета лишається pi-free; кешується на процес.

## Гарантії поведінки

- pi SDK вантажиться виключно через dynamic import у `getRegistry()` — import самого модуля не тягне pi.
- `resolveModelSpec` не кидає на malformed вході — повертає `null`.
