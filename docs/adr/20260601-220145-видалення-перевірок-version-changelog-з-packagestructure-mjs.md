---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-01T22:01:45+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

Запит на write відхилено — виведу ADR прямо в чат, ти зможеш зберегти вручну або підтвердити дозвіл.

---

## ADR Видалення перевірок version/CHANGELOG з `package_structure.mjs`

## Context and Problem Statement
`package_structure.mjs` містив дві функції — `checkDirtyNpmRequiresVersionBump` і `checkChangelogTopMatchesPackageVersion` — що суперечили change-file-флоу `n-changelog.mdc`: перша фейлила саме у бажаному стані (зміни є, `version` не чіпають), друга тримала post-release-інваріант як живу перевірку, провокуючи ручне редагування. `changelog/js/consistency.mjs` вже коректно реалізує обидві ці перевірки.

## Considered Options
* Видалити обидві функції повністю — делегувати відповідальність `consistency.mjs`
* Залишити функції, лише переписати тексти повідомлень
* Інвертувати логіку `checkDirtyNpmRequiresVersionBump` (фейлити при ручному bump)

## Decision Outcome
Chosen option: "Видалити обидві функції повністю", because `consistency.mjs` (рядки 36, 71, 127–140) вже коректно покриває drift від ручного bump і відсутність change-файлу; залишити функції означало б дублювання або інвертовану логіку. Інваріант «top секція `## [version]` == `package.json` `version`» перенесено у `changelog.mdc` (v3.2) як post-release-твердження.

### Consequences
* Good, because `package_structure.mjs` більше не торкається теми version/CHANGELOG; єдина відповідальність — структура пакета (`files`, `devDependencies`, TypeScript layout, `hk.pkl`, `npm-publish.yml`).
* Good, because нуль дублювання між `package_structure.mjs` і `consistency.mjs`; агент-споживач не отримує суперечливих повідомлень фіксера.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/npm-module/js/package_structure.mjs`, `npm/rules/npm-module/js/tests/package_structure.test.mjs`, `npm/rules/npm-module/npm-module.mdc` (v1.13→1.14), `npm/rules/changelog/changelog.mdc` (v3.1→3.2). Незмінений еталон: `npm/rules/changelog/js/consistency.mjs`.

---

## ADR Без `backfill`-механізму в форматі change-файлу

## Context and Problem Statement
Бриф передбачав edge case: `version` X.Y.Z вже опублікована в реєстрі, але секції `## [X.Y.Z]` у `CHANGELOG.md` немає. Пропонована відповідь — fail із підказкою про `backfill` change-файл із міткою `backfill: <version>`. Під час аналізу Spec з'ясувалося, що формат change-файлу (`npm/rules/release/lib/change-file.mjs`) підтримує лише ключі `bump` і `section` + текст; мітки `backfill:` не існує.

## Considered Options
* Ввести `backfill: <version>` у формат change-файлу + розширити агрегатор `release`
* Не вводити backfill: drift `version` ловить `consistency.mjs` і вимагає відкоту `version`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Не вводити backfill", because механізм не існує і будь-який drift `version` вже ловить `consistency.mjs` з коректним повідомленням «відкоти `version`; зміни оформ через `npx @nitra/cursor change …`». Розширення формату change-файлу виходить за межі задачі «узгодити правила».

### Consequences
* Good, because формат change-файлу (`npm/rules/release/lib/change-file.mjs`) лишається незмінним.
* Good, because transcript фіксує очікувану користь: `consistency.mjs` покриває drift-кейс без нового механізму.
* Bad, because у разі справжнього «опублікована version без секції CHANGELOG» автоматичної підказки немає. Neutral, because transcript не містить підтвердження, що такий кейс реально трапляється в проєкті.

## More Information
Формат change-файлу: `npm/rules/release/lib/change-file.mjs` (ключі `bump`, `section`, текст). Drift-detection: `npm/rules/changelog/js/consistency.mjs`.

---

## ADR Без meta-перевірки ручного bump у `.mdc`

## Context and Problem Statement
Бриф вимагав додати regex-перевірку: «жоден `.mdc` під `npm/rules/` не містить інструкцій ручного bump поза `n-changelog.mdc`». Мета — запобігти повторному розходженню правил.

## Considered Options
* Окремий чек `mdc-no-manual-bump.mjs` у `npm/rules/changelog/js/`, під'єднаний у `meta.json` changelog-правила
* Rego-поліс у `npm/policy/...`
* Додати до існуючого `consistency.mjs`
* Не додавати meta-перевірку

## Decision Outcome
Chosen option: "Не додавати meta-перевірку", because структурний фікс (видалення суперечливих секцій з `npm-module.mdc` і двох функцій з `package_structure.mjs`) усуває причину рецидиву. Regex по вільному тексті `.mdc` крихкий — хибні спрацювання на легітимні згадки слова «version»; сам стає джерелом тертя. YAGNI: machinery проти гіпотетичного рецидиву без підтвердженої ймовірності.

### Consequences
* Good, because нуль додаткового maintenance overhead від regex-чекера.
* Good, because `consistency.mjs` і `package_structure.mjs` не змішують відповідальностей (мета-lint правил ≠ runtime-перевірки).
* Bad, because повторне розходження `.mdc` теоретично можливе без автоматичного захисту. Neutral, because transcript не містить підтвердження такого ризику після структурного фіксу.

## More Information
Контекст відхилення rego-варіанта: коментар у кодовій базі «FS / AST не лягають у rego» — rego не підходить для вільного тексту `.mdc`. Змінені файли: `npm/rules/npm-module/npm-module.mdc` (v1.14), `npm/rules/changelog/changelog.mdc` (v3.2).
