---
type: Rust Module
title: gaps_parity.rs
resource: crates/rules-docs/tests/gaps_parity.rs
docgen:
  crc: e91908df
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Диференційна звірка шару expected і вердиктів із ЖИВИМ JS: фікстура `fixtures/js-gaps.json` — дослівний вихід `applyExpectedOverlay` і `evaluateGaps` на тих самих входах, знятий із Node.  Порівнюється весь злитий граф і всі шість вердиктів разом із їхніми `evidenceIds` та `implementedClaimIds` — тобто не лише «який статус», а й «з чого він зроблений».

## Поведінка

Файл працює лише як диференційний oracle між живим JS і Rust-результатом, тому його контракт — фіксувати точну відповідність злитого графа та вердиктів до даних у js-gaps.json і base-graph.json.

Будь-яка розбіжність у merged graph, статусі gap або в складі evidenceIds чи implementedClaimIds вважається регресією й має проявитися як падіння тесту; окремого user-facing fallback тут немає.

Для сценаріїв missing, diverged, ambiguous, lowConfidence і explicitUnresolved очікується стабільна відповідь, що збігається з еталоном із JS, навіть якщо змінюється лише один атрибут у вхідному графі або зв’язках.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
