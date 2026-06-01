---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-01T22:07:50+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

Гілка `changelog-npm-module-align` чиста. Два коміти vs `main`:

1. `fe08579` — авто-хук: видалено перевірки + `.mdc` переписано (v3.2/v1.14)
2. `38828ad` — jsdoc-фікс, sonarjs-фікс, change-файл, docs (spec/plan/беклог)

Гілка готова до PR. Поруч — `docs/plans/2026-06-01-flow-adaptation-backlog.md` з 10 пунктами адаптації flow, повернемось до нього коли скажеш.

---

Now I'll produce the ADR documentation from this session transcript.

## ADR Видалення суперечливих перевірок version/CHANGELOG з `package_structure.mjs`

## Context and Problem Statement
`npm/rules/npm-module/js/package_structure.mjs` містив дві перевірки — `checkChangelogTopMatchesPackageVersion` та `checkDirtyNpmRequiresVersionBump`, — що спонукали агента вручну редагувати `version` і `CHANGELOG.md`. Це прямо суперечило `n-changelog.mdc` (v3.1, `alwaysApply: true`), де `n-cursor release` у CI є єдиним дозволеним механізмом bump/CHANGELOG. Інваріант «top секція CHANGELOG == `package.json`.version» описувався у `n-npm-module.mdc` як живий локальний інваріант, хоча він є істинним лише після CI-релізу.

## Considered Options
* Видалити обидві суперечливі перевірки повністю — валідацію drift та відсутнього change-файлу делегувати `changelog/js/consistency.mjs`, що вже реалізує правильну модель.
* Залишити перевірки, лише переписати тексти повідомлень.
* Додати `backfill`-механізм (мітка `backfill: <version>` у форматі change-файлу) для edge-case «version опублікована без CHANGELOG-секції».

## Decision Outcome
Chosen option: "Видалити обидві перевірки повністю", because механізм `backfill` не існує в `change-file.mjs` (підтримуються лише `bump` + `section`), `consistency.mjs` вже коректно покриває drift і відсутній change-файл, а перевірки мали інвертовану логіку (фейлили у бажаному стані: зміни є, `version` не зрушено) і були структурним дублем.

### Consequences
* Good, because `npx @nitra/cursor fix npm-module` більше не штовхає агента до ручного bump `version` чи додавання секції в `CHANGELOG.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалено з `npm/rules/npm-module/js/package_structure.mjs`: функції `checkChangelogTopMatchesPackageVersion`, `checkDirtyNpmRequiresVersionBump`, `firstChangelogSectionVersion`, git-хелпери `gitInsideWorkTree`, `gitDiffNameOnlyNpm`, `gitShowNpmPackageVersionAt`, імпорти `execFile`/`promisify`, регекси `CHANGELOG_FIRST_VERSION_RE`/`PACKAGE_JSON_VERSION_RE`. Коректне покриття — `npm/rules/changelog/js/consistency.mjs`.

---

## ADR Делегування bump-інструкцій в `n-changelog.mdc` як єдине джерело істини

## Context and Problem Statement
`n-npm-module.mdc` (v1.13) містив секції «Build версія» і «CHANGELOG» з прямими інструкціями «підвищ `version` у `npm/package.json` (+1)» та «додай секцію `## [нова версія]` зверху CHANGELOG». `n-changelog.mdc` (v3.1, `alwaysApply: true`) категорично забороняє обидві ці дії — єдиний артефакт зміни — change-файл `npx @nitra/cursor change …`. Два правила давали агентові суперечливі інструкції, породжуючи drift у споживачах.

## Considered Options
* Переписати `n-npm-module.mdc`: єдиний спосіб оформлення змін — change-файл; інваріант «top==version» — лише post-release-твердження CI; делегувати деталі в `n-changelog.mdc`.
* Залишити `n-npm-module.mdc` без змін, лише додати disclaimer.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Переписати `n-npm-module.mdc`", because `n-changelog.mdc` (`alwaysApply: true`) є оголошеним джерелом істини; усі інші правила мають йому підпорядковуватись, а не дублювати чи суперечити його інструкціям.

### Consequences
* Good, because `grep -nE 'підвищ.*version|version.*\+1|додай секцію' npm/rules/n-*.mdc` повертає порожній результат у всіх файлах, крім `changelog.mdc` (де лише описана заборона).
* Good, because transcript фіксує очікувану користь: споживачі-репо, що мають drift `version` vs CHANGELOG-top, отримають повідомлення про `consistency.mjs`, а не інструкцію ручного bump.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/rules/npm-module/npm-module.mdc` оновлено з v1.13 до v1.14 — секції «Build версія» та «CHANGELOG» замінено на «Єдиний артефакт зміни — change-файл (`npx @nitra/cursor change …`)». `n-changelog.mdc` оновлено з v3.1 до v3.2 — додано розділ «Post-release інваріант (гарантує CI)» з твердженням, що перша секція `## [version]` в `CHANGELOG.md` дорівнює `package.json`.version лише після `n-cursor release` у CI, та межею авторитетності «інструкції bump живуть лише тут».

---

## ADR Відмова від meta-перевірки та механізму backfill

## Context and Problem Statement
Бриф вимагав: (1) додати meta-перевірку (regex по `.mdc`-файлах), що жоден `npm/rules/*.mdc` поза `n-changelog.mdc` не містить інструкцій ручного bump; (2) підтримку мітки `backfill: <version>` у форматі change-файлу для edge-case «version опублікована без CHANGELOG-секції».

## Considered Options
* Реалізувати обидва механізми.
* Відмовитись від обох: структурно видалити причину рецидиву (секції в `npm-module.mdc`) замість захисту regex; механізм `backfill` відсутній у `change-file.mjs` і виходить за межі задачі.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Відмовитись від обох", because формат change-файлу підтримує лише `bump` і `section` (`npm/rules/release/lib/change-file.mjs`) — `backfill`-мітки не існує і її введення виходить за scope. Meta-перевірка на вільний текст `.mdc` крихка (хибні спрацювання на легітимні згадки «version») і стає власним джерелом тертя; YAGNI — після структурного видалення інструкцій з `npm-module.mdc` причина рецидиву зникає фізично.

### Consequences
* Good, because обсяг задачі залишився мінімально необхідним без нового tooling.
* Bad, because відсутня автоматична страховка від повторного drift правил у майбутньому — це зафіксовано у `docs/plans/2026-06-01-flow-adaptation-backlog.md` як потенційний follow-up.

## More Information
`npm/rules/release/lib/change-file.mjs` — парсер формату change-файлу (лише `bump` + `section` + опис). Усі обговорення знаходяться в `docs/specs/2026-06-01-changelog-npm-module-align.md`.
