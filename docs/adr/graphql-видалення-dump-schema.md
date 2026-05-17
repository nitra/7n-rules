# GraphQL: видалення вимоги `scripts.dump-schema` з правила `graphql.mdc`

**Status:** Accepted
**Date:** 2026-05-11

## Контекст

Правило `graphql.mdc` вимагало, щоб у кореневому `package.json` проєкту існував скрипт `dump-schema` з фіксованою командою `bunx graphqurl … --introspect`. Ця вимога була специфічною для проєктів з Hasura і ускладнювала onboarding нових GraphQL-проєктів без такої залежності.

## Рішення/Процедура/Факт

- Видалено блок про `scripts.dump-schema` з `npm/mdc/graphql.mdc`.
- Видалено каталог `npm/policy/graphql/package_json/` з файлом `package_json.rego` (Rego-перевірка наявності скрипту).
- Видалено запис `{ namespace: 'graphql.package_json', … }` з `npm/scripts/lint-conftest.mjs`.
- Видалено перевірку `dump-schema` з JSDoc та логіки `npm/scripts/check-graphql.mjs`.
- Видалено скрипт `dump-schema` з кореневого `cursor/package.json`.
- Версію `npm/package.json` підвищено до `1.9.4`; у `npm/CHANGELOG.md` додано запис `[1.9.4] - 2026-05-11` з секцією `### Removed`.

## Обґрунтування

Скрипт `dump-schema` є деталлю реалізації конкретного проєкту з Hasura, а не загальним GraphQL-стандартом. Залишення перевірки у правилі змушувало всі проєкти з `gql`-тегами дотримуватись специфічного скрипту, не пов'язаного безпосередньо з якістю GraphQL-коду.

## Розглянуті альтернативи

Не обговорювалися — рішення задано прямим формулюванням у запиті.

## Зачіпає

- `npm/mdc/graphql.mdc`
- `npm/policy/graphql/` (видалено повністю)
- `npm/scripts/lint-conftest.mjs`
- `npm/scripts/check-graphql.mjs`
- `cursor/package.json`
- `npm/package.json`
- `npm/CHANGELOG.md`
