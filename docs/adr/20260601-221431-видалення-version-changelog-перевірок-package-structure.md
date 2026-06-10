# Видалення суперечливих перевірок version/CHANGELOG з `package_structure.mjs`

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement
`npm/rules/npm-module/js/package_structure.mjs` містив функції `checkDirtyNpmRequiresVersionBump` і `checkChangelogTopMatchesPackageVersion`, що реалізовували модель «ручний bump `version` + ручне додавання секції CHANGELOG». Ця модель суперечить `changelog.mdc` (v3.1+), яка забороняє ручне редагування `version` і `CHANGELOG.md`; єдиний артефакт змін — change-файл, bump виконує `n-cursor release` у CI. Додатково `checkDirtyNpmRequiresVersionBump` фейлила саме у **правильному** стані (зміни є, `version` не зрушено) — логіка була прямо інвертована.

## Considered Options
- Видалити обидві функції повністю — делегувати валідацію до `changelog/js/consistency.mjs`
- Залишити функції, лише переписати тексти повідомлень
- Інвертувати логіку: фейлити при ручному bump, а не при його відсутності

## Decision Outcome
Chosen option: "Видалити обидві функції повністю", because `consistency.mjs` уже повністю покриває обидва сценарії (drift від ручного bump vs registry і vs git-база, missing change-file), тому будь-яка форма цих функцій у `package_structure.mjs` — дублювання або суперечність.

У тій самій сесії відхилено два суміжних розширення:

- **backfill-механізм** (`backfill: <version>` у форматі change-файлу) — не вводимо: механізм відсутній у codebase (`grep` по `npm/`); `consistency.mjs` вже ловить будь-який drift `version`; формат change-файлу залишається з ключами `bump`, `section`, опис.
- **meta-перевірка** (regex по `npm/rules/**/*.mdc` на присутність інструкцій ручного bump) — відхилено (YAGNI): причину рецидиву видалено фізично (інструкції в `npm-module.mdc` прибрано); крихкий regex по вільному тексту дає хибні спрацювання на легітимні згадки слова «version».

### Consequences
- Good, because `package_structure.mjs` більше не торкається теми version/CHANGELOG; єдине місце валідації — `changelog/js/consistency.mjs`.
- Good, because обсяг задачі лишається в межах «узгодити правила» без нового функціоналу; формат change-файлу стабільний.
- Bad, because edge case «опублікована версія без CHANGELOG-секції» не отримує спеціального повідомлення — transcript фіксує це як свідомий вибір.
- Bad, because майбутній рецидив (повторне додавання bump-інструкцій) можливий без автоматичного детектора — прийнятий свідомо.

## More Information
- Видалені функції: `checkDirtyNpmRequiresVersionBump` (~рядки 319–346) і `checkChangelogTopMatchesPackageVersion` (~рядки 288–310) у `npm/rules/npm-module/js/package_structure.mjs`.
- Осиротілий код, що видалено разом: `gitInsideWorkTree`, `gitDiffNameOnlyNpm`, `gitShowNpmPackageVersionAt`, `firstChangelogSectionVersion`, `CHANGELOG_FIRST_VERSION_RE`, `PACKAGE_JSON_VERSION_RE`, `execFileAsync`, `promisify`.
- Еталон валідації: `npm/rules/changelog/js/consistency.mjs` (рядки 462, 488 — drift; 414/421/426/497 — missing change-file).
- Формат change-файлу: `npm/rules/release/lib/change-file.mjs` (ключі `bump`, `section`, опис — без backfill).
- `changelog.mdc` v3.2 — новий розділ «Post-release інваріант» і текстова межа «інструкції bump живуть лише тут».
- Гілка: `changelog-npm-module-align`, коміти `fe08579` + `38828ad`.
