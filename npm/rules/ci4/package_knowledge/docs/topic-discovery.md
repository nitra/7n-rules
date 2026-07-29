---
type: JS Module
title: topic-discovery.mjs
resource: npm/rules/ci4/package_knowledge/topic-discovery.mjs
docgen:
  crc: 87634590
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
---

## Огляд

Відкриває детерміновані package-knowledge topics із normalized graph.

Public entry points є первинними seeds. Outcome та external integration
стають окремими seeds лише коли їх не охоплює public flow. Це зберігає
компактні process topics, не залежить від LLM title і не вимагає показувати
private implementation у наступних projections.

## Публічний API

- collectReachableNodeIds — Знаходить directed reachable closure. Cyclic SCC потрапляє цілком, бо обхід
продовжується до fixed point тільки за підтвердженими edges.
- discoverTopics — Відкриває stable process/contract topics із graph seeds.

Integration та outcome не дублюють topic public entry point, якщо він уже
evidence-backed досягає відповідної boundary. Інакше вони лишаються
standalone seed, що важливо для event-driven або contract-only domain.
- resolveTopic — Шукає canonical topic за його current ID або historical alias.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/topic-discovery.test.mjs` (discoverTopics) — uses public flow anchors and title-independent stable identity; keeps explicit aliases and resolves them to the canonical topic

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
