---
type: ADR
title: "Правило adr переведено з opt-in у always-on"
---

# Правило adr переведено з opt-in у always-on

**Status:** Accepted
**Date:** 2026-05-16

## Контекст

Правило `adr` (автоматичний збір ADR/Runbook/Knowledge-чернеток через Stop-хук) до цього вмикалось виключно вручну — додаванням `"adr"` у масив `rules` файлу `.n-cursor.json`. Це вимагало від кожної команди ручного підключення, хоча правило є корисним у будь-якому проєкті з Claude Code.

## Рішення/Процедура/Факт

До `npm/scripts/auto-rules.mjs` додано `addRule('adr')` без умови поряд з `addRule('text')`, а `'adr'` вставлено в `AUTO_RULE_ORDER` на алфавітне місце. Створено `npm/rules/adr/auto.md` з вмістом `завжди` — конвенційний маркер для завжди-увімкнених правил (аналогічно `rules/text/auto.md`). Текст у `npm/rules/adr/adr.mdc` оновлено: «вмикається вручну» змінено на «увімкнене за замовчуванням; вимикається через `disable-rules: ["adr"]`». Коментар у `sync-claude-config.mjs` приведено у відповідність. Тести у `auto-rules.test.mjs` оновлено: `'adr'` додано до `ALL_RULES` і до очікуваного масиву результату. Версія пакету піднята з `1.11.15` до `1.11.16`.

## Обґрунтування

ADR-хук є корисним у будь-якому проєкті з Claude Code — немає сенсу вимагати від кожної команди ручного підключення. Патерн `auto.md` з вмістом `завжди` вже реалізований для правила `text` і є стандартним механізмом у цьому пакеті. Явний `"adr"` у `.n-cursor.json` залишається валідним завдяки дедуплікації при merge, тому зворотна сумісність не порушується.

## Розглянуті альтернативи

Альтернативи не розглядалися. Використання вже існуючого механізму `auto.md: завжди`, аналогічного правилу `text`, є єдиним органічним підходом у межах наявної архітектури пакету.

## Зачіпає

`npm/scripts/auto-rules.mjs`, `npm/scripts/auto-rules.test.mjs`, `npm/rules/adr/auto.md` (новий файл), `npm/rules/adr/adr.mdc`, `npm/scripts/sync-claude-config.mjs`, `npm/package.json` (version bump 1.11.15 → 1.11.16), `npm/CHANGELOG.md`.

## Update 2026-05-16

### Деталі переходу `adr` на auto-detected (v1.11.16)

- `npm/scripts/auto-rules.mjs` — додано `'adr'` у `AUTO_RULE_ORDER` і безумовний виклик `addRule('adr')` поряд з `addRule('text')`.
- `npm/rules/adr/auto.md` — створено з вмістом `завжди` (маркер auto-detect, аналог `text/auto.md`).
- `npm/rules/adr/adr.mdc` — текст «вмикається вручну» замінено на «увімкнене за замовчуванням; вимикається через `disable-rules: ["adr"]`».
- `npm/scripts/auto-rules.test.mjs` — `'adr'` додано у `ALL_RULES` і у expected-масив тесту «правила за ознаками».
- `npm/scripts/sync-claude-config.mjs` — JSDoc-коментар оновлено.

### Runbook: виправлення регресій після переходу (v1.11.17)

Після переключення виявлено три pre-existing падіння тестів:

1. **`check-js-run` — фікстури**: файли `pg.js` та `lib/connections/pg.js` не відповідали канону — назва має бути `pg-write.js`, експорт `pgWrite` у camelCase від basename. Перейменовано у тестах.
2. **`integration-repo-checks`**: stop-хук повернув раніше видалений self-reference `devDependencies: { "@nitra/cursor": "^1.11.16" }` у `npm/package.json`. Видалено повторно.
3. Версія бампнута `1.11.16` → `1.11.17`, запис у `CHANGELOG.md` (`### Fixed` + `### Removed`).

**Зачіпає:** `npm/scripts/auto-rules.mjs`, `npm/scripts/auto-rules.test.mjs`, `npm/rules/adr/auto.md`, `npm/rules/adr/adr.mdc`, `npm/rules/js-run/fix/runtime/check-fixture.test.mjs`, `npm/package.json`, `npm/CHANGELOG.md`.
