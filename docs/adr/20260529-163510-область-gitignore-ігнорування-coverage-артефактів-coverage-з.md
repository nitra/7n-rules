---
session: 693f6687-c783-4802-b2ad-784924283c10
captured: 2026-05-29T16:35:10+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/693f6687-c783-4802-b2ad-784924283c10.jsonl
---

Потрібен дозвіл на запис `.gitignore`. Спробуй ще раз — або надай permission і я прибираю рядки 12-15 (два дублі + зайвий header), залишивши один `**/reports/stryker/` і `**/coverage/` під єдиним коментарем.

---

## ADR Область `.gitignore`-ігнорування coverage-артефактів: `**/coverage/` замість `**/coverage/lcov-report/`

## Context and Problem Statement
Концерн `stryker_config` (файл `npm/rules/test/js/stryker_config.mjs`) ідемпотентно дописує патерни до кореневого `.gitignore`. Виникло питання: ігнорувати лише HTML-підкаталог `coverage/lcov-report/` (де `lcov.info` залишався трекованим для агрегації) чи весь `coverage/` цілком.

## Considered Options
* Ігнорувати лише `**/coverage/lcov-report/` (HTML-артефакт, `lcov.info` — трекований)
* Ігнорувати весь `**/coverage/` (усі coverage-артефакти, включно з `lcov.info`)

## Decision Outcome
Chosen option: "Ігнорувати весь `**/coverage/`", because весь каталог `coverage/` є ефемерним build-артефактом — він повністю перегенеровується кожним прогоном. Фінальні метрики зберігаються у `COVERAGE.md`, а `n-cursor coverage` читає `lcov.info` під час того ж прогону, тому `.gitignore` не заважає цьому процесу.

### Consequences
* Good, because спрощується патерн (один `**/coverage/` замість двох) і виключаються всі проміжні артефакти coverage без потреби їх уточнювати.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінено: `npm/rules/test/js/stryker_config.mjs` — константа `TEST_GITIGNORE_ENTRIES = ['**/reports/stryker/', '**/coverage/']`
- Оновлено: `npm/rules/test/test.mdc`, `.cursor/rules/n-test.mdc`
- Функція: `ensureGitignoreEntries` (`npm/scripts/utils/ensure-gitignore-entries.mjs`) — ідемпотентний append-only запис у `.gitignore`
- Тести: `npm/rules/test/js/tests/stryker_config.test.mjs` — 16/16 passed
