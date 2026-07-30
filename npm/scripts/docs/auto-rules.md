---
type: JS Module
title: auto-rules.mjs
resource: npm/scripts/auto-rules.mjs
docgen:
  crc: a3bece15
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 25
---

## Огляд

Автовизначення правил для `.n-rules.json` за meta-даними з `npm/rules/<id>/main.json`.

Основна роль: `discoverRuleAutoActivation` читає `npm/rules/<id>/main.json`, виводить
`AUTO_RULE_ORDER` (алфавітно) і `AUTO_RULE_DEPENDENCIES` з meta, а потім для кожного правила
обчислює spec активації через `specMatches`: `always` — безумовно; `glob` — перевірка
файлів через `globToRegex`; `predicate` — незводимий предикат із реєстру `RULE_PREDICATES`
(у `lib/rule-predicates.mjs`). Транзитивне розгортання залежностей — `resolveRuleDependencies`.

`collectAutoRuleFacts` зберігається для content-фактів (GQL, bun-sql, hasura) і власних тестів.

Враховує винятки `disable-rules`: елементи зі списку не додаються автоматично.

Автодетект скілів — у `./auto-skills.mjs` (умови — у `npm/skills/<skill>/main.json`).
`mergeConfigWithAutoDetected` нижче приймає вже виявлені rules і skills і вливає
їх у конфіг із поправкою на legacy-id (`migrateRuleIds`).

## Публічний API

- discoverRuleAutoActivation — Скан `npm/rules/<id>/main.json` → мапа id → RuleAutoSpec (лише правила з розпізнаним auto).
- getRuleAutoActivation — Агрегована мапа активації по кількох rules-каталогах (ядро + плагіни): правила
зливаються за id, перший власник виграє (порядок каталогів = пріоритет).
Без `rulesDirs` — вбудовані module-level константи (шлях без плагінів).
- AUTO_RULE_ORDER — Стабільний алфавітний порядок (замість хардкод-масиву).
- AUTO_RULE_DEPENDENCIES — Граф залежностей із meta (Type C) — замість хардкод-константи.
- collectAutoRuleFacts — Обходить дерево проєкту, збираючи content-факти для предикатів автоувімкнення.

`hasRegoFile` і `hasTempoDir` лишаються для зворотної сумісності з прямими читачами
фактів (тести, зовнішній код); саме автоувімкнення тепер data-driven через main.json.
- detectAutoRules — Визначає авто-правила згідно з `rules/<rule>/main.json`.
- mergeConfigWithAutoDetected — Доповнює конфіг автодетектом (лише додає; існуючі вручну задані елементи не прибирає),
а за наявності `availableRules`/`availableSkills` ще й прибирає з `rules`/`skills`
неактуальні id, яких уже немає у пакеті (наприклад, правило чи скіл видалено з нової
версії \@7n/rules) — інакше sync щоразу падав би на завантаженні відсутнього
`rules/<id>.mdc` чи `skills/<id>/`. Прибрані id повертаються у полі `pruned` (для логу).

## Сценарії використання

- `npm/scripts/tests/auto-rules.test.mjs` (detectAutoRules; mergeConfigWithAutoDetected) — додає правила за ознаками проєкту; додає js-bun-db при pg у dependencies; додає js-bun-db при pg-format у dependencies; додає js-bun-db при імпорті sql з bun; додає js-bun-redis при ioredis у dependencies; ще 48

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Кешує результати в межах одного прогону.
