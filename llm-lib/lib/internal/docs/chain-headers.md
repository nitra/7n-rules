---
type: JS Module
title: chain-headers.mjs
resource: llm-lib/lib/internal/chain-headers.mjs
docgen:
  crc: b9a48b25
---

## Огляд

INTERNAL streamFn-mixin (дзеркало max-tokens): домішує X-Chain-* заголовки chain-у в options кожного LLM-виклику pi-сесії — pi StreamOptions.headers мерджаться останніми поверх дефолтів провайдера, тож заголовки долітають до локального проксі (myllm). Раннери передають chain сюди лише для локальних моделей (isLocalModel).

## Поведінка

applyChainHeaders — обгортає session.agent.streamFn; chain.headers() читається на момент кожного виклику (свіжий X-Chain-Step); зберігає наявні options.headers; no-op без chain або для сесій без agent (фейки в тестах).

## Гарантії поведінки

- Чужі options.headers не губляться (мердж, chain-заголовки останні).
- Безпечний no-op: без chain/agent session повертається незмінною.
