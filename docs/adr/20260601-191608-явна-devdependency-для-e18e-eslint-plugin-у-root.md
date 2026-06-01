---
session: 56d4469f-942b-45f9-a176-cf4acad17841
captured: 2026-06-01T19:16:08+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/56d4469f-942b-45f9-a176-cf4acad17841.jsonl
---

Очікую дозволу на запис. Поки що — ось ADR за цією сесією:

---

## ADR Явна devDependency для `@e18e/eslint-plugin` у root

## Context and Problem Statement

`@nitra/eslint-config@3.10.0` не містить `@e18e/eslint-plugin` у своїх `dependencies`, хоча CHANGELOG зафіксував його додавання у 3.8.0. Правило `n-js-lint-ci` стверджувало, що плагін надходить транзитивно з `@nitra/eslint-config` і не потребує явного оголошення. Ця передумова виявилась хибною: upstream-пакет виконав регресію.

## Considered Options

* Залишити транзитивний provide — покластись на те, що `@nitra/eslint-config` відновить `@e18e/eslint-plugin` у своїх `dependencies` (patch upstream)
* Явно оголосити `@e18e/eslint-plugin` у root `devDependencies` монорепо

## Decision Outcome

Chosen option: "Явно оголосити `@e18e/eslint-plugin` у root `devDependencies`", because інспекція `bun.lock` показала, що плагін вже присутній у root `devDependencies` (`"@e18e/eslint-plugin": "^0.5.0"`) і забезпечує чистий `bun install` незалежно від поведінки upstream-пакету.

### Consequences

* Good, because монорепо не залежить від транзитивної поведінки `@nitra/eslint-config` — явна декларація є стабільним контрактом при будь-якому upstream-релізі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Root `package.json` → `devDependencies`: `"@e18e/eslint-plugin": "^0.5.0"` (рядок 8 `bun.lock`, workspace `""`)
- Встановлена версія: `@e18e/eslint-plugin@0.5.0` (`node_modules/@e18e/eslint-plugin/package.json`)
- `.oxlintrc.json` оголошує `jsPlugins: ["@e18e/eslint-plugin"]` і ~14 правил `e18e/*`
- Правило `npm/rules/js-lint-ci/js-lint-ci.mdc` рядок 19 — оновлено: видалено твердження про транзитивний provide, додано пояснення що `@nitra/eslint-config@3.10.0` прибрав цей запис
