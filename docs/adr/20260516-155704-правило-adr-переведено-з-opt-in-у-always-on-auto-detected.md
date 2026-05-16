---
session: 0850a6f9-4567-482d-8da2-2fe965458fbc
captured: 2026-05-16T15:57:04+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/0850a6f9-4567-482d-8da2-2fe965458fbc.jsonl
---

## ADR правило `adr` переведено з opt-in у always-on (auto-detected)

**Контекст:** Правило `adr` (автозбір ADR/Runbook/Knowledge-чернеток через Stop-хук) вмикалося вручну через `"adr"` у `.n-cursor.json`. Це означало, що нові репозиторії мали явно додавати запис, щоб отримати ADR-збір, — що суперечило меті «будь-яке репо з `@nitra/cursor` автоматично веде архів рішень».

**Рішення/Процедура/Факт:**
- `npm/scripts/auto-rules.mjs` — додано `'adr'` у `AUTO_RULE_ORDER` і безумовний виклик `addRule('adr')` поряд з `addRule('text')` (обидва завжди увімкнені).
- `npm/rules/adr/auto.md` — створено з вмістом `завжди` (маркер auto-detect, аналог `text/auto.md`).
- `npm/rules/adr/adr.mdc` — текст «вмикається вручну» замінено на «увімкнене за замовчуванням; вимикається через `disable-rules: ["adr"]`».
- `npm/scripts/auto-rules.test.mjs` — `'adr'` додано у `ALL_RULES` і у expected-масив тесту «правила за ознаками».
- `npm/scripts/sync-claude-config.mjs` — JSDoc-коментар оновлено (прибрано посилання на «вручну»).
- Версія `1.11.15` → `1.11.16`, запис у `CHANGELOG.md`.

**Обґрунтування:** Користувач вирішив, що ADR-збір має бути стандартним для всіх проєктів на `@nitra/cursor`, а не опціональним. Модель `text` (теж «завжди») слугує прецедентом — `auto.md: завжди` + безумовний `addRule()`.

**Розглянуті альтернативи:** Не обговорювалися — рішення прийнято одразу як зміна `alwaysApply: true` у самому `.mdc` (який вже мав цей прапор) плюс відповідний `auto.md`.

**Зачіпає:** `npm/scripts/auto-rules.mjs`, `npm/scripts/auto-rules.test.mjs`, `npm/rules/adr/auto.md` (новий), `npm/rules/adr/adr.mdc`, `npm/scripts/sync-claude-config.mjs`, `npm/package.json`, `npm/CHANGELOG.md`.

---

## Runbook виправлення регресій у `check-js-run` та `integration-repo-checks`

**Контекст:** Після переключення `adr` на auto-detected було виявлено три pre-existing падіння тестів: два в `rules/js-run/fix/runtime/check-fixture.test.mjs` і одне в `tests/integration-repo-checks.test.mjs`. Причини — застарілі фікстури та self-reference `devDependencies`, яке stop-хук повертав у `npm/package.json`.

**Рішення/Процедура/Факт:**
1. **`check-js-run` — фікстури**: фікстурні файли `pg.js` + `export const db` і `lib/connections/pg.js` + `export const db` не відповідали канону `js-run` (назва `pg-write.js`, експорт `pgWrite` у camelCase від basename). Перейменовано в тесті на канонічні варіанти.
2. **`integration-repo-checks`**: commit `8ae6e9e auto adr` (stop-хук) повернув раніше видалений self-reference `devDependencies: { "@nitra/cursor": "^1.11.16" }` у `npm/package.json`. Видалено повторно.
3. Bump `1.11.16` → `1.11.17`, окремий запис у `CHANGELOG.md` (`### Fixed` + `### Removed`).

**Обґрунтування:** Фікстури тестів не оновлювались при посиленні канону `js-run` (іменування за схемою `pg-write` і camelCase-export). Self-reference в `devDependencies` — відомий рецидив від stop-хука, що додає залежність від поточної версії пакета.

**Розглянуті альтернативи:** Не обговорювалися.

**Зачіпає:** `npm/rules/js-run/fix/runtime/check-fixture.test.mjs`, `npm/package.json`, `npm/CHANGELOG.md`.
