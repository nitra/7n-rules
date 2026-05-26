---
session: b8895738-4fcd-44ff-891e-24ef7cfe8874
captured: 2026-05-25T22:47:59+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b8895738-4fcd-44ff-891e-24ef7cfe8874.jsonl
---

## ADR Агрегований лінт-оркестратор `n-cursor lint` із per-rule таймінгом

## Context and Problem Statement

Скіли `/n-fix` і `/n-lint` не показували, скільки часу займало кожне окреме правило (напр. `fix-ga`, `lint-ga`, `lint-js`). Кореневий ланцюжок `bun run lint` реалізовувався як `&& `-рядок у `package.json`, без можливості зібрати тайминги на рівні платформи.

## Considered Options

* **A.** Скіл запускає кожне правило окремо (вимір через `date +%s` або `time`); основний прогін розбивається на N процесів.
* **B.** Інструментувати самі інструменти (`@nitra/cursor`) — одна нова CLI-команда + спільна lib-функція; кореневий `package.json` делегує до неї.
* **C.** Гібрид: основний прогін одним викликом, окремі виклики з таймами лише для рядків із `❌`.

## Decision Outcome

Chosen option: **B**, because користувач явно обрав цей варіант; він зберігає один агрегований прогін, не додає overhead N окремих запусків процесів і дає точні тайминги через ін'єкцію залежностей (`spawnSyncFn`, `now`) безпосередньо всередині оркестратора.

### Consequences

* Good, because `npx @nitra/cursor lint` є єдиною точкою входу; кореневий `package.json` зводиться до `"lint": "n-cursor lint"`, а тайминги з'являються автоматично без змін у скілах.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Нові файли:
- `npm/scripts/lib/timing-summary.mjs` — `formatDurationMs`, `formatTimingSummary`
- `npm/scripts/lib/run-lint-cli.mjs` — `runLintCli`, `LINT_SCRIPTS` (фіксований порядок, fail-fast)
- `npm/scripts/lib/tests/timing-summary.test.mjs`, `npm/scripts/lib/tests/run-lint-cli.test.mjs` — 17 тестів

Змінені файли:
- `npm/bin/n-cursor.js` — `runFixCommand` тепер акумулює `timings[]`; новий `case 'lint'` делегує до `runLintCli`
- `package.json` (root) — `"lint": "n-cursor lint"`, новий скрипт `"oxfmt": "oxfmt ."`
- `.cursor/skills/n-fix/SKILL.md`, `.cursor/skills/n-lint/SKILL.md` — вказівка копіювати таблицю `⏱` у фінальне резюме
- `npm/package.json` — bump `1.21.0 → 1.22.0`

Поведінка: fail-fast (зупинка на першій `❌`); фіксований порядок скриптів (`lint-ga`, `lint-js`, `lint-rego`, `lint-style`, `lint-text`, `lint-security`, `oxfmt`); споживацький enforcement-rego свідомо не додано.
