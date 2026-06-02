---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-01T22:14:31+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

Аналізую сесію — виявляю 3 окремих дизайн-рішення, що заслуговують на ADR.

---

## ADR Видалення суперечливих перевірок version/CHANGELOG з `package_structure.mjs`

## Context and Problem Statement
`npm/rules/npm-module/js/package_structure.mjs` містив дві функції — `checkDirtyNpmRequiresVersionBump` і `checkChangelogTopMatchesPackageVersion`, — що реалізовували модель «ручний bump `version` + ручне додавання секції CHANGELOG». Ця модель суперечить `changelog.mdc` (v3.1), яка забороняє будь-яке ручне редагування `version` і `CHANGELOG.md`; єдиний артефакт змін — change-файл, а bump виконує `n-cursor release` у CI.

## Considered Options
* Видалити обидві функції повністю — делегувати всю валідацію version/CHANGELOG до `changelog/js/consistency.mjs`
* Залишити функції, лише переписати тексти повідомлень
* Інвертувати логіку: фейлити при ручному bump (а не при відсутності bump)

## Decision Outcome
Chosen option: "Видалити обидві функції повністю", because `checkDirtyNpmRequiresVersionBump` фейлила саме у **правильному** стані (зміни є, `version` не зрушено), тобто логіка була інвертована — переписати текст не виправило б поведінку; а `consistency.mjs` уже повністю покриває обидва сценарії (drift від ручного bump vs registry і vs git-база, missing change-file), тому будь-яка форма цих функцій у `package_structure.mjs` — дублювання або суперечність.

### Consequences
* Good, because `package_structure.mjs` більше не торкається теми version/CHANGELOG; єдине місце валідації — `changelog/js/consistency.mjs`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Видалені функції: `checkDirtyNpmRequiresVersionBump` (рядки ~319–346), `checkChangelogTopMatchesPackageVersion` (рядки ~288–310) у `npm/rules/npm-module/js/package_structure.mjs`.
- Осиротілий код, що також видалено: `gitInsideWorkTree`, `gitDiffNameOnlyNpm`, `gitShowNpmPackageVersionAt`, `firstChangelogSectionVersion`, `CHANGELOG_FIRST_VERSION_RE`, `PACKAGE_JSON_VERSION_RE`, `execFileAsync`, `promisify`.
- Файл еталону: `npm/rules/changelog/js/consistency.mjs` — покриває рядки 462, 488 (drift) і 414/421/426/497 (missing change-file).
- Гілка: `changelog-npm-module-align`, коміти `fe08579` + `38828ad`.

---

## ADR Відмова від backfill-механізму та розширення формату change-файлу

## Context and Problem Statement
Технічне завдання пропонувало обробити edge case «`version` X.Y.Z опубліковано в реєстрі без відповідної CHANGELOG-секції (історичний борг)» через нову мітку `backfill: <version>` у форматі change-файлу та окремий агрегатор у `release`. Перш ніж реалізовувати, потрібно було з'ясувати, чи механізм `backfill` взагалі існує в codebase.

## Considered Options
* Повний backfill-механізм: додати підтримку `backfill: <version>` у формат change-файлу + агрегатор у `release`
* Зберегти перевірку `checkChangelogTopMatchesPackageVersion` зі звуженням до post-release контексту і backfill-наративом у повідомленні (без розширення формату)
* Не вводити поняття backfill і не розширювати формат change-файлу

## Decision Outcome
Chosen option: "Не вводити поняття backfill і не розширювати формат change-файлу", because механізму `backfill` не існує в codebase (`grep` по `npm/` — лише в `ci4.mdc`); формат change-файлу (`npm/rules/release/lib/change-file.mjs`) підтримує лише `bump` + `section` + опис; будь-який drift `version` уже ловить `consistency.mjs` і вказує на відкат `version` — цього достатньо для правильного workflow.

### Consequences
* Good, because обсяг задачі лишається в межах «узгодити правила» без нового функціоналу; формат change-файлу стабільний.
* Bad, because edge case «опублікована версія без CHANGELOG-секції» не отримує спеціального повідомлення — transcript фіксує це як свідомий вибір.

## More Information
- Формат change-файлу: `npm/rules/release/lib/change-file.mjs` (лише ключі `bump`, `section`, текст опису).
- Рішення прийнято у фазі Spec (Q2, варіант A) після підтвердження відсутності `backfill` у codebase.

---

## ADR Відмова від meta-перевірки «жоден `.mdc` не містить інструкцій ручного bump»

## Context and Problem Statement
Технічне завдання пропонувало додати regex-перевірку по `npm/rules/**/*.mdc`, що унеможливлює повторне розходження правил (жоден файл крім `n-changelog.mdc` не містить `підвищ.*version.*+1` тощо). Треба було оцінити доцільність такої meta-перевірки.

## Considered Options
* Окремий чек `npm/rules/changelog/js/mdc-no-manual-bump.mjs`, під'єднаний у `meta.json` changelog-правила
* Rego-поліс у `npm/policy/...`
* Не додавати meta-перевірку

## Decision Outcome
Chosen option: "Не додавати meta-перевірку", because фікс є **структурним**: інструкцій ручного bump у `npm-module.mdc` просто не лишилося — не існує чого захищати regex; крихкий текстовий regex по `.mdc` дає хибні спрацювання на легітимні згадки слова «version» і сам стає джерелом підтримки. Захист від рецидиву — документована межа в `changelog.mdc` (текст, а не код).

### Consequences
* Good, because уникнуто крихкого regex-чеку по вільному тексту і зайвого обсягу.
* Bad, because transcript не містить підтверджених негативних наслідків; майбутній рецидив можливий без автоматичного детектора — прийнятий свідомо.

## More Information
- `changelog.mdc` v3.2 містить новий розділ «Post-release інваріант (гарантує CI)» і межу «інструкції bump живуть лише тут» як текстову документацію.
- Рішення прийнято у фазі Spec (Q3) після аргументу YAGNI: причину рецидиву видалено фізично.
