---
type: JS Module
title: chunk-planner.mjs
resource: npm/rules/doc-files/package_knowledge/chunk-planner.mjs
docgen:
  crc: 9b831fa2
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Планує bounded semantic chunks і dependency waves для package knowledge.

Planner працює лише з already-normalized graph і точними UTF-8 source spans.
Він не виконує LLM calls і не публікує документацію: результат є
детермінованим execution plan для map/reduce orchestration.

## Поведінка

Функція планування може бути викликана з будь-якої точки, якщо надані граф, джерела текстів та політика, і поверне детермінований план або діагностику. Для коректної роботи необхідний повний набір вхідних даних, що включає нормалізований граф та специфічні джерела.

Якщо вхідні дані не відповідають очікуванням, планування не відбудеться, і система поверне діагностики.

Планування генерує множину логічних блоків, оптимізованих для подальшого багаторівневого оброблення, з урахуванням обмежень на обсяг токенів та вхідні дані для зменшення.

## Публічний API

- planSemanticChunks — Планує normalized semantic units і edges у bounded map chunks та dependency waves.

Default required nodes — усі `code-unit` nodes; opaque cross-domain targets
не є AST units, але їхні incoming edges лишаються required і покриваються
source evidence slice свого local caller. Explicit `requiredNodeIds` дозволяє
higher-level graph layer планувати інші node kinds тільки за наявності spans.

## Сценарії використання

- `npm/rules/doc-files/package_knowledge/tests/chunk-planner.test.mjs` (planSemanticChunks) — uses exact UTF-8 byte slices and rejects a span through a unicode code point; keeps cycles in one SCC chunk and schedules dependencies before callers; is byte-stable across input order and fingerprints all cache policy inputs; covers every required node and edge instead of truncating a tail for the budget; plans only code-unit-originated edges by default while retaining structured graph relations; ще 1

## Гарантії поведінки

- Кешує результати в межах одного прогону.
