---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-01T21:32:04+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

Я зупинив дизайн-дискусію (spec) і зафіксую для тебе ADR на основі прийнятих рішень. Verify ще виконується у фоні (coverage-gate) — сповіщу результат, коли він завершиться.

---

## ADR Видалення суперечливих перевірок version/CHANGELOG у npm-module

## Context and Problem Statement
У пакеті `@nitra/cursor` функції `checkChangelogTopMatchesPackageVersion` і `checkDirtyNpmRequiresVersionBump` у `npm/rules/npm-module/js/package_structure.mjs` штовхали агента до ручного редагування `version` у `npm/package.json` і `CHANGELOG.md`, що прямо суперечить `changelog.mdc` (v3.1, `alwaysApply: true`): єдиний дозволений артефакт зміни — change-файл, а `version`/`CHANGELOG` формує виключно `n-cursor release` у CI. Крім цього, `checkDirtyNpmRequiresVersionBump` фейлила саме у правильному стані (зміни є, `version` не зрушено), а `consistency.mjs` (changelog) уже коректно покривав обидва кейси.

## Considered Options
* Видалити обидві функції повністю — `consistency.mjs` покриває ті самі кейси без суперечностей.
* Залишити, але переписати тексти повідомлень — не усуває інвертовану логіку `checkDirtyNpmRequiresVersionBump`.
* Ввести механізм `backfill: <version>` у формат change-файлу для обробки historical debt — розширює scope поза межі завдання.

## Decision Outcome
Chosen option: "Видалити обидві функції повністю", because `checkDirtyNpmRequiresVersionBump` мала інвертовану логіку (фейлила у правильному стані флоу), а `checkChangelogTopMatchesPackageVersion` тримала post-release-інваріант («top секція CHANGELOG == `version`») як активну перевірку, хоча локально він нічого валідного не означає; обидва кейси вже коректно покриває `npm/rules/changelog/js/consistency.mjs`.

### Consequences
* Good, because `npm/rules/npm-module/js/package_structure.mjs` більше не дублює й не інвертує логіку `consistency.mjs`; підказки фіксера перестали направляти агента до ручного bump.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені символи: `checkChangelogTopMatchesPackageVersion`, `checkDirtyNpmRequiresVersionBump`, `firstChangelogSectionVersion`, `CHANGELOG_FIRST_VERSION_RE`, `PACKAGE_JSON_VERSION_RE`, `execFileAsync`, `gitInsideWorkTree`, `gitDiffNameOnlyNpm`, `gitShowNpmPackageVersionAt` — усі ставали orphaned після видалення функцій. Post-release-інваріант перенесено текстовим твердженням у `npm/rules/changelog/changelog.mdc` (v3.2). Секцію «Build версія» / «CHANGELOG» в `npm/rules/npm-module/npm-module.mdc` (v1.14) переписано на посилання до `n-changelog.mdc` без жодних інструкцій `version +1` / «додай секцію».

---

## ADR Відмова від meta-перевірки проти повторного ручного bump у `.mdc`-файлах

## Context and Problem Statement
У scope задачі розглядалася meta-перевірка (regex по `npm/rules/**/*.mdc`), яка б гарантувала, що жодне правило поза `changelog.mdc` не містить інструкцій ручного bump `version`. Мета — запобігти повторному розходженню правил у майбутньому.

## Considered Options
* Не вводити meta-перевірку — структурний видаляє причину рецидиву; regex по вільному тексту `.mdc` ненадійний.
* Окремий чек у `npm/rules/changelog/js/mdc-no-manual-bump.mjs`.
* Rego-поліс у `npm/policy/` — погано лягає на вільний текст `.mdc`.

## Decision Outcome
Chosen option: "Не вводити meta-перевірку", because суперечливі секції фізично видалено з `npm-module.mdc`, тобто причину рецидиву усунуто структурно; regex по вільному тексту `.mdc` є джерелом хибних спрацювань і окремого тягаря підтримки; YAGNI.

### Consequences
* Good, because transcript фіксує очікувану користь: зменшення поверхні підтримки; відсутність крихких regex-чеків по вільному тексту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Додаткової інформації в transcript не зафіксовано.

---

## ADR Відмова від механізму backfill у форматі change-файлу

## Context and Problem Statement
Бриф містив edge case: якщо `version` уже опублікована в реєстрі без CHANGELOG-секції (historical debt), очікувалося повідомлення про `backfill change-файл` з міткою `backfill: <version>`. Механізм `backfill` у CLI (`npm/rules/release/lib/change-file.mjs`) відсутній — формат підтримує лише `bump` + `section` + опис.

## Considered Options
* Не вводити backfill — historical drift від ручного bump вже ловить `consistency.mjs`; розширення формату виходить за межі задачі.
* Додати підтримку `backfill: <version>` у `change-file.mjs` і агрегатор `release`.

## Decision Outcome
Chosen option: "Не вводити backfill", because механізм відсутній у кодовій базі, його реалізація виходить за обговорений scope («узгодити правила і виправити підказки фіксера»), а drift від ручного bump уже коректно покривається `consistency.mjs`.

### Consequences
* Good, because transcript фіксує очікувану користь: scope задачі не розширюється; рішення залишається мінімальним.
* Bad, because edge case «`version` опублікована без CHANGELOG-секції» не обробляється спеціальним повідомленням — `consistency.mjs` покаже загальний drift-фейл без backfill-наративу.

## More Information
Формат change-файлу: `npm/rules/release/lib/change-file.mjs`. Перевірка дрейфу: `npm/rules/changelog/js/consistency.mjs`.
