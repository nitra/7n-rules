---
type: JS Module
title: zones.mjs
resource: npm/rules/ci4/package_knowledge/zones.mjs
docgen:
  crc: 3b05865b
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Парсить і захищає AUTOGEN, MANUAL та EXPECTED zones у generated Markdown.

Strict markers, stable IDs і content hashes не дозволяють генератору
мовчки перезаписати authored context або explicit expectations.

## Поведінка

zoneHash створює стабільний маркер SHA-256 на основі змісту зони.

parseKnowledgeZones аналізує документ, виділяючи захищені та згенеровані зони, а також визначаючи неструктурований ручний контент, що залишається незмінним.

applyAutogenUpdates оновлює документ, застосовуючи лише визначені заміни для згенерованих зони та переобчислюючи їхні хеші, при цьому захищений та ручний контент не підлягає зміні.

assertProtectedZonesPreserved перевіряє, чи збережено кожен існуючий захищений або ручний байт у кандидатному варіанті документа відносно попередньо зафіксованого стану.

## Публічний API

- zoneHash — Обчислює stable hash вмісту zone.
- parseKnowledgeZones — Parses strict protected/generated zone markers and validates pairing, global stable IDs and
AUTOGEN hashes. Text outside an explicit zone is returned as implicit MANUAL content so a
publisher can preserve it byte-for-byte.
- applyAutogenUpdates — Applies only declared AUTOGEN replacements and recalculates their hashes. Protected and
implicit MANUAL content is never selected as a writable target.
- assertProtectedZonesPreserved — Verifies that a generated candidate keeps every existing protected/implicit manual byte.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/zones.test.mjs` (package knowledge zones) — parses paired stable markers and validates AUTOGEN hash; rejects unpaired markers and duplicate stable IDs; fails closed for malformed or unsupported marker declarations; writes only AUTOGEN content and preserves protected zones; detects manual and implicit-manual modifications

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
