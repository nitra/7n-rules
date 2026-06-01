---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-01T21:47:36+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

## ADR Видалення суперечливих перевірок version/CHANGELOG із package_structure.mjs

## Context and Problem Statement
`npm/rules/npm-module/js/package_structure.mjs` містив дві перевірки (`checkDirtyNpmRequiresVersionBump` і `checkChangelogTopMatchesPackageVersion`), які штовхали агента до ручного bump `version` і додавання секцій у `CHANGELOG.md` — що `n-changelog.mdc` (v3.1, `alwaysApply: true`) прямо забороняє. При цьому `npm/rules/changelog/js/consistency.mjs` уже коректно реалізував правильну модель (єдиний артефакт — change-файл; version-drift = fail з відкотом).

## Considered Options
* Видалити обидві функції повністю — `consistency.mjs` покриває ці кейси коректно
* Залишити, лише переписати текст повідомлень (не розглядалось як достатнє — логіка `checkDirtyNpmRequiresVersionBump` інвертована: фейлить у правильному стані)
* Інверсувати логіку `checkDirtyNpmRequiresVersionBump` (дублювало б `consistency.mjs`)

## Decision Outcome
Chosen option: "Видалити обидві функції повністю", because вони або дублюють `consistency.mjs`, або реалізують логіку, протилежну бажаному стану; `package_structure.mjs` повністю виходить із теми version/CHANGELOG, делегуючи її `consistency.mjs`.

### Consequences
* Good, because transcript фіксує очікувану користь: усувається єдина точка суперечності між правилами; `package_structure.mjs` стає вузькоспеціалізованим (структура пакету, TS-layout, hk, publish-workflow).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалено із `npm/rules/npm-module/js/package_structure.mjs`: `checkDirtyNpmRequiresVersionBump`, `checkChangelogTopMatchesPackageVersion`, хелпери `gitInsideWorkTree`, `gitDiffNameOnlyNpm`, `gitShowNpmPackageVersionAt`, `firstChangelogSectionVersion`, константи `CHANGELOG_FIRST_VERSION_RE`, `PACKAGE_JSON_VERSION_RE`, імпорти `execFile`, `promisify`. Відповідні тест-кейси прибрано з `npm/rules/npm-module/js/tests/package_structure.test.mjs`.

---

## ADR Відмова від механізму backfill у change-файлах

## Context and Problem Statement
В бриф містився edge case: коли `version` вже опублікована в npm-реєстрі без відповідної секції в `CHANGELOG.md` («історичний борг від manual bump»). Бриф пропонував підтримку спеціальної мітки `backfill: <version>` у форматі change-файлу і окреме повідомлення фіксера, яке вказує на неї. На момент дискусії формат change-файлу (у `npm/rules/release/lib/change-file.mjs`) підтримував лише `bump` + `section` + опис.

## Considered Options
* Не вводити backfill і не розширювати формат change-файлу
* Залишити звужену перевірку (лише post-release контекст) із backfill-наративом у повідомленні, без нової мітки
* Повний backfill-механізм: нова мітка у форматі change-файлу + підтримка в агрегаторі `release`

## Decision Outcome
Chosen option: "Не вводити backfill і не розширювати формат change-файлу", because будь-який drift `version` уже ловить `consistency.mjs` (відкоти version); historical-debt edge case виходить за межі задачі «узгодити правила».

### Consequences
* Good, because transcript фіксує очікувану користь: scope залишається вузьким; формат change-файлу стабільним; `consistency.mjs` покриває drift-detection без додаткової інфраструктури.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Формат change-файлу: `npm/rules/release/lib/change-file.mjs`. Перевірка drift: `npm/rules/changelog/js/consistency.mjs` (не змінювалась у цій задачі).

---

## ADR Відмова від meta-перевірки «жоден .mdc не містить інструкцій ручного bump»

## Context and Problem Statement
Бриф вимагав додати перевірку (rego або окремий `.mjs` чек), яка б забезпечила, що жоден `.mdc` під `npm/rules/` не містить regex-патернів типу `підвищ.*version.*\+1` поза `n-changelog.mdc`. Мета — не дати правилам повторно розійтися.

## Considered Options
* Окремий чек у `npm/rules/changelog/js/` (наприклад, `mdc-no-manual-bump.mjs`)
* Rego-поліс (відхилено як технічно невідповідний: rego не підходить для free-text `.mdc`)
* Додати до існуючого `consistency.mjs`
* Не додавати meta-перевірку зовсім

## Decision Outcome
Chosen option: "Не додавати meta-перевірку зовсім", because фікс структурний — інструкцій ручного bump у `npm-module.mdc` фізично не існуватиме після правки, тому повторне розходження не матиме джерела; regex по вільному тексту `.mdc` крихкий і генерує хибні спрацювання.

### Consequences
* Good, because transcript фіксує очікувану користь: уникнуто крихкого regex-чеку та зайвої точки підтримки; YAGNI — machinery проти гіпотетичного рецидиву, коли його причину видалено фізично.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Як альтернативний захист від рецидиву в transcript запропоновано документаційний рядок-межу в `changelog.mdc`: «жодне інше правило не дублює інструкцій bump». Реалізовано у `npm/rules/changelog/changelog.mdc` v3.2 у новій секції «Post-release інваріант (гарантує CI)».

---

## ADR Перенесення post-release інваріанту «top section == version» у changelog.mdc

## Context and Problem Statement
Інваріант «перша секція `## [version]` у `CHANGELOG.md` дорівнює `version` у `package.json`» раніше тримався лише перевіркою в `npm-module.mdc` / `package_structure.mjs`. Він є істинним тільки **після релізу** (його гарантує `n-cursor release` у CI), а у feature-флоу ця рівність не виконується і не має виконуватися.

## Considered Options
* Перенести твердження в `changelog.mdc` як post-release-гарантію CI; прибрати з `npm-module.mdc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести твердження в `changelog.mdc` як post-release-гарантію CI", because `changelog.mdc` (`alwaysApply: true`) є оголошеним джерелом істини для всього, що стосується версіонування і CHANGELOG; усі інші правила підпорядковуються йому.

### Consequences
* Good, because transcript фіксує очікувану користь: єдине місце для семантики bump/CHANGELOG; `npm-module.mdc` більше не містить інструкцій, що суперечать `changelog.mdc`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Додано секцію «Post-release інваріант (гарантує CI)» до `npm/rules/changelog/changelog.mdc`, версія 3.2. `npm/rules/npm-module/npm-module.mdc` версія 1.14 — секції «Build версія» і «CHANGELOG» переписані: єдиний артефакт змін — `npx @nitra/cursor change …`; bump і генерація CHANGELOG делеговані `n-cursor release` у CI.
