---
type: JS Module
title: apply-compression.mjs
resource: llm-lib/lib/internal/apply-compression.mjs
docgen:
  crc: 90de77ca
---

## Огляд

Streamfn-mixin (дзеркало max-tokens/chain-headers): домішує compressContext у кожен LLM-виклик pi-сесії — safety-net проти prefill_memory_exceeded/context-window overflow, тепер на клієнті замість колишнього myllm-проксі (compress.rs), тож працює й напряму до omlx без залежності від запущеного myllm.

## Поведінка

applyCompression — обгортає session.agent.streamFn, стискаючи context перед викликом оригінального streamFn; no-op без agent або коли N_LLM_COMPRESS=0 (дефолт увімкнено — це safety-net, не оптимізація).

## Публічний API

applyCompression(session) — та сама сесія (для чейнінгу).

## Гарантії поведінки

- Дефолт увімкнено; вимикається лише явним N_LLM_COMPRESS=0 (для дебагу різниці до/після).
- Безпечний no-op для сесій без agent.streamFn (інжектовані фейки в тестах).
