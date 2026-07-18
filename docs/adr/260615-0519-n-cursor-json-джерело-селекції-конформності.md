---
type: ADR
title: .n-cursor.json як джерело селекції конформності
description: Конформність-фаза lint має обирати правила з .n-cursor.json, а .cursor/rules/*.mdc використовувати лише як fallback без конфіга.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

У `npx @nitra/cursor lint --full` конформність-фаза визначала правила через discovery `.cursor/rules/*.mdc` на диску. Через це правило, увімкнене в `.n-cursor.json`, але без відповідного `.mdc` після sync, тихо пропускалося. Джерело правди залежало від стану файлової системи.

## Considered Options

- Config-first: `resolveCheckRuleIds` бере `available ∩ isRuleEnabled(cfg)`, а `.cursor/rules/*.mdc` є fallback за відсутнього конфіга.
- Дволанцюговий гейт: discovery по `.mdc` на селекції та `isRuleEnabled` всередині per-rule `runRuleCli`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Config-first", because `.n-cursor.json` уже є авторитетом через `readNCursorConfigLite` і `isRuleEnabled`, а дволанцюговий гейт створював silent-failure: enabled-правило без `.mdc` зникало з конформності.

### Consequences

- Good, because `resolveCheckRuleIds` повертає `available ∩ enabled(cfg)` незалежно від наявності `.mdc` на диску.
- Good, because `isRuleEnabled`-гейт у `runRuleCli` більше не дублює селекцію.
- Bad, because за відсутнього конфіга fallback лишається на `.mdc` discovery, і поведінка режимів розходиться.

## More Information

Змінені файли з transcript: `npm/scripts/lib/fix/run-fix-check.mjs`, `npm/scripts/lib/run-rule-cli.mjs`, `npm/scripts/lib/tests/run-rule-cli.test.mjs`, `npm/scripts/lib/fix/tests/resolve-check-rule-ids.test.mjs`. Fallback без конфіга: `listProjectRulesMdcFiles` + `discoverCheckRulesFromCursorRules`. Функцію `resolveCheckRuleIds` експортовано для тестування. Changeset: `npm/.changes/260614-2151.md`.
