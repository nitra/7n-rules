# Правило js-bun-redis — двошарова перевірка та автодетект

**Status:** Accepted
**Date:** 2026-05-09

## Контекст

Потрібно заборонити використання `ioredis`, `node-redis`, `redis` та `@redis/*` у Bun-проєктах і автоматично вмикати правило при виявленні цих залежностей — аналогічно до наявного правила `js-bun-db`.

## Рішення/Факт

Реалізовано двошаровий підхід з автодетектом:

1. `npm/mdc/js-bun-redis.mdc` — людинозрозуміле правило (створено заздалегідь).
2. `npm/scripts/utils/redis-imports.mjs` — AST-сканер на `oxc-parser`: перехоплює `import`, `require` та динамічний `import()` пакетів `ioredis`, `node-redis`, `redis` (включно з підшляхами `ioredis/...`, `redis/...`) та підпакетами `@redis/*`; явно не зачіпає `redis-mock` та інші `redis-*`.
3. `npm/scripts/check-js-bun-redis.mjs` — check-скрипт з обходом дерева та підтримкою `.n-cursor.json#ignore`; доступний через `npx @nitra/cursor check js-bun-redis`.
4. `npm/policy/js_bun_redis/package_json/package_json.rego` — Rego v1-полісі для `conftest`: забороняє заборонені пакети у `dependencies` будь-якого `package.json`; зареєстрована таргетом у `npm/scripts/lint-conftest.mjs`.
5. `npm/scripts/auto-rules.mjs` — до `AUTO_RULE_ORDER` додано `js-bun-redis`; до `collectDependencyKeysPresentInPackageJsonTree` — ключі `ioredis` та `node-redis`; правило вмикається автоматично при виявленні цих залежностей.
6. `npm/tests/redis-imports.test.mjs` — нові юніт-тести AST-сканера; `npm/tests/auto-rules.test.mjs` — доповнено тестом автодетекту.
7. `npm/package.json` збумпано `1.8.212 → 1.8.213`, `npm/CHANGELOG.md` — запис за шаблоном Keep a Changelog.

## Обґрунтування

Симетрія з `js-bun-db`: двошаровий підхід (AST-сканер + Rego-полісі) забезпечує покриття як на рівні коду (`check-*`), так і на рівні `package.json` (`lint-conftest`). AST через `oxc-parser` усуває хибні спрацьовування від regex-пошуку (практика підтверджена для `bunyan-imports.mjs`). Автодетект за залежностями в `package.json` дозволяє не вмикати правило в репозиторіях, де `redis` взагалі відсутній.

## Розглянуті альтернативи

Regex-скан замість AST — відхилено через ризик хибних збігів у коментарях та рядкових літералах.

## Зачіпає

`npm/scripts/utils/redis-imports.mjs`, `npm/scripts/check-js-bun-redis.mjs`, `npm/policy/js_bun_redis/package_json/package_json.rego`, `npm/scripts/lint-conftest.mjs`, `npm/scripts/auto-rules.mjs`, `npm/tests/redis-imports.test.mjs`, `npm/tests/auto-rules.test.mjs`, `npm/package.json`, `npm/CHANGELOG.md`.

## Update 2026-05-16

Підтверджено завершення реалізації. Пакет збумпено до версії `1.8.213`. Додано юніт-тести для AST-сканера (`npm/tests/redis-imports.test.mjs`) та перевірку автодетекту ключів `ioredis`/`node-redis` у `npm/tests/auto-rules.test.mjs`. До `npm/scripts/auto-rules.mjs` явно додано ключі `ioredis` та `node-redis` для автоматичної активації правила при виявленні цих залежностей у `package.json` проєкту.
