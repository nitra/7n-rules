---
docgen:
  source: npm/scripts/auto-rules.mjs
  crc: 972b56fc
  score: 90
---

# auto-rules.mjs

## Огляд

Файл читає метадані з `npm/rules/<id>/meta.json` для автоматичного визначення порядку та залежностей правил. Він обчислює spec активації для кожного правила, використовуючи дані з `RULE_PREDICATES` з `lib/rule-predicates.mjs`, визначає активні правила, обчислює залежності та об'єднує конфігурацію з виявленими правилами та поправками на legacy-id. Код спирається на конфіги `.n-cursor.json`, `meta.json` та `package.json`.

## Поведінка

discoverRuleAutoActivation
Читає meta-дані з файлів npm/rules/<id>/meta.json для визначення автоактивації правил.

AUTO_RULE_ORDER
Повертає алфавітний порядок для правил.

AUTO_RULE_DEPENDENCIES
Повертає граф залежностей між правилами.

collectAutoRuleFacts
Збирає контент-факти для предикатів, включаючи сканування GQL, Bun SQL та налаштувань Hasura.

detectAutoRules
Визначає активні правила на основі spec, перевіряючи їх проти згенерованих фактів.

mergeConfigWithAutoDetected
Доповнює конфігурацію, додаючи визначені автоправила та налаштування, з урахуванням legacy-ID.

## Публічний API

discoverRuleAutoActivation — Скан `npm/rules/<id>/meta.json` → мапа id → RuleAutoSpec (лише правила з розпізнаним auto).
AUTO_RULE_ORDER — Стабільний алфавітний порядок (замість хардкод-масиву).
AUTO_RULE_DEPENDENCIES — Граф залежностей із meta (Type C) — замість хардкод-константи.
collectAutoRuleFacts — Обходить дерево проєкту, збираючи content-факти для предикатів автоувімкнення.
hasRegoFile — Флаг наявності файлу Rego.
hasTempoDir — Флаг наявності директорії Tempo.
hasBunSqlImport — Булеве значення про імпорт BunSQL.
hasGqlTaggedTemplates — Булеве значення про наявність GQL-тегів.
hasHasuraConfig — Булеве значення про конфігурацію Hasura.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
- Не звертається до мережі.
