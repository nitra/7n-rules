---
type: ADR
title: "Gitignore-сніпет правила `test`: ігнорувати `**/coverage/` повністю"
---

# Gitignore-сніпет правила `test`: ігнорувати `**/coverage/` повністю

**Status:** Accepted
**Date:** 2026-05-29

## Context and Problem Statement

Концерн `stryker_config` у `npm/rules/test/js/stryker_config.mjs` ідемпотентно дописує патерни до кореневого `.gitignore`. Спочатку до сніпета входив лише `**/reports/stryker/`. Постало питання: чи слід ігнорувати лише HTML-підкаталог vitest — `coverage/lcov-report/`, залишивши `lcov.info` трекованим, або весь `coverage/` цілком.

## Considered Options

- Ігнорувати лише `**/coverage/lcov-report/` (HTML-артефакт, `lcov.info` — трекований)
- Ігнорувати весь `**/coverage/` (усі coverage-артефакти, включно з `lcov.info`)

## Decision Outcome

Chosen option: "Ігнорувати весь `**/coverage/`", because весь каталог `coverage/` є ефемерним build-артефактом — він повністю перегенеровується кожним прогоном. Фінальні метрики зберігаються у `COVERAGE.md`, а `n-cursor coverage` читає `lcov.info` під час того ж прогону, тому `.gitignore` не заважає цьому процесу.

### Consequences

- Good, because спрощується патерн (один `**/coverage/` замість двох) і виключаються всі проміжні артефакти coverage без необхідності їх уточнювати.
- Good, because жоден coverage-файл (`lcov.info` чи HTML) не потрапить у commit — відповідає принципу «build artifacts не трекуємо».
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінено: `npm/rules/test/js/stryker_config.mjs` — константа `TEST_GITIGNORE_ENTRIES = ['**/reports/stryker/', '**/coverage/']`; секція `.gitignore` — `# Test artifacts: Stryker + coverage`.
- Оновлено: `npm/rules/test/test.mdc`, `.cursor/rules/n-test.mdc`.
- Механізм запису: `npm/scripts/utils/ensure-gitignore-entries.mjs` (ідемпотентний append-only).
- Тести: `npm/rules/test/js/tests/stryker_config.test.mjs` — 16/16 passed.
- Версія пакету після змін: `1.29.3`.

## Update 2026-05-29

Під час застосування змін виявлено дублікати у кореневому `.gitignore` (рядки 12–15): два записи `**/reports/stryker/` і два header-коментарі, що виникли через повторний ідемпотентний append. Після виправлення залишено один коментар `# Test artifacts: Stryker + coverage` і по одному записи `**/reports/stryker/` та `**/coverage/`.
