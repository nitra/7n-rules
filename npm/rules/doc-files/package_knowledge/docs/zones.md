---
type: JS Module
title: zones.mjs
resource: npm/rules/doc-files/package_knowledge/zones.mjs
docgen:
  crc: 69458cc9
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Парсить і захищає AUTOGEN, MANUAL та EXPECTED zones у generated Markdown.

Strict markers, stable IDs і content hashes не дозволяють генератору
мовчки перезаписати authored context або explicit expectations.

## Поведінка

`zoneHash` використовують як стабільний маркер для порівняння вмісту zone: однаковий вхід дає той самий результат, тож значення придатне для контролю цілісності та виявлення змін.

`parseKnowledgeZones` повертає або розібраний набір zones з implicit MANUAL текстом, або diagnostics, якщо структура маркерів, pairing чи stable ID не відповідають вимогам. Текст поза явною zone зберігається окремо, щоб його можна було відтворити без втрат.

`applyAutogenUpdates` змінює лише явно оголошені AUTOGEN-частини; protected zones і implicit MANUAL-контент не стають ціллю запису. Якщо оновлення не можна застосувати без порушення зон, повертаються diagnostics замість часткового результату.

`assertProtectedZonesPreserved` порівнює попередній і кандидатний Markdown на збереження вже існуючих protected та implicit manual байтів; будь-яка невідповідність блокує прийняття кандидата через diagnostics.

## Публічний API

- zoneHash — Обчислює stable hash вмісту zone.
- parseKnowledgeZones — Parses strict protected/generated zone markers and validates pairing, global stable IDs and
AUTOGEN hashes. Text outside an explicit zone is returned as implicit MANUAL content so a
publisher can preserve it byte-for-byte.
- applyAutogenUpdates — Applies only declared AUTOGEN replacements and recalculates their hashes. Protected and
implicit MANUAL content is never selected as a writable target.
- assertProtectedZonesPreserved — Verifies that a generated candidate keeps every existing protected/implicit manual byte.

## Сценарії використання

- `npm/rules/doc-files/package_knowledge/tests/zones.test.mjs` (package knowledge zones) — parses paired stable markers and validates AUTOGEN hash; rejects unpaired markers and duplicate stable IDs; fails closed for malformed or unsupported marker declarations; writes only AUTOGEN content and preserves protected zones; detects manual and implicit-manual modifications

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
