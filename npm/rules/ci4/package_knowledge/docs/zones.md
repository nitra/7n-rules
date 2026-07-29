---
type: JS Module
title: zones.mjs
resource: npm/rules/ci4/package_knowledge/zones.mjs
docgen:
  crc: f94e429d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`zoneHash` допомагає відрізняти вміст зон за їхнім текстом, `parseKnowledgeZones` розбирає документ на захищені та згенеровані ділянки, `applyAutogenUpdates` оновлює згенеровані фрагменти, а `assertProtectedZonesPreserved` перевіряє, що захищені ділянки не змінено. Файл задає спільну поведінку для роботи з документами, де ручний і згенерований вміст мають оброблятися окремо.

## Поведінка

zoneHash формує стабільний маркер для вмісту зони, щоб наступні перевірки могли однозначно зіставляти оголошений AUTOGEN-вміст із фактичним текстом.

parseKnowledgeZones є точкою входу для розбору документа: вона відокремлює явні захищені та згенеровані зони, перевіряє узгодженість меж і зв’язок між оголошенням та хешем, а весь текст поза явними зонами трактує як неявний MANUAL-вміст, який має зберігатися без змін. Результат цього розбору стає спільною основою для подальшого оновлення та валідації.

applyAutogenUpdates спирається на результат parseKnowledgeZones і застосовує лише ті заміни, які явно вказані як AUTOGEN. Воно не торкається захищеного або неявного MANUAL-вмісту, а після заміни звіряє й оновлює хеші, щоб вихідний документ залишався узгодженим із новим згенерованим змістом.

assertProtectedZonesPreserved використовує той самий розбір, щоб порівняти попередній і кандидатний документ та переконатися, що весь уже наявний захищений і неявний manual-вміст збережено байт-у-байт. Це слугує фінальним бар’єром перед прийняттям змін: дозволяються лише такі оновлення, які не порушують незмінні ділянки документа.

## Публічний API

- parseKnowledgeZones — Parses strict protected/generated zone markers and validates pairing, global stable IDs and
AUTOGEN hashes. Text outside an explicit zone is returned as implicit MANUAL content so a
publisher can preserve it byte-for-byte.
- applyAutogenUpdates — Applies only declared AUTOGEN replacements and recalculates their hashes. Protected and
implicit MANUAL content is never selected as a writable target.
- assertProtectedZonesPreserved — Verifies that a generated candidate keeps every existing protected/implicit manual byte.
- zoneHash — обчислює стабільний хеш для зони, щоб отримати короткий детермінований ідентифікатор з однакового входу

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/zones.test.mjs` (package knowledge zones) — parses paired stable markers and validates AUTOGEN hash; rejects unpaired markers and duplicate stable IDs; fails closed for malformed or unsupported marker declarations; writes only AUTOGEN content and preserves protected zones; detects manual and implicit-manual modifications

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
