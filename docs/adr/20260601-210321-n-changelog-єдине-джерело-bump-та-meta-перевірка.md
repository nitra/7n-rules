# `n-changelog.mdc` — єдине джерело істини для bump/CHANGELOG; meta-перевірка проти розходження правил

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

`npm/rules/changelog/changelog.mdc` (v3.1, `alwaysApply: true`) забороняє ручне редагування `version` і `CHANGELOG.md`, вимагаючи change-файл як єдиний артефакт змін. `npm/rules/npm-module/npm-module.mdc` (v1.13) у секціях «Build версія» і «CHANGELOG» містив чеклист «`version` → +1; зверху нова секція…», що прямо суперечило `changelog.mdc`. Фіксер `fix npm-module` передавав ці суперечливі підказки агентам-споживачам. Окрім того, функція `checkDirtyNpmRequiresVersionBump` у `package_structure.mjs` фейлила у правильному стані change-file-флоу і дублювала логіку `consistency.mjs`.

## Considered Options

* Лишити обидва правила паралельно і розрулювати пріоритет коментарем у кожному
* Оголосити `n-changelog.mdc` єдиним джерелом істини; `n-npm-module.mdc` підпорядковується і не містить інструкцій про bump чи CHANGELOG
* Лише PR-ревʼю як запобіжник від майбутнього розходження правил (без автоматики)
* Автоматична meta-перевірка (rego або скрипт), що жоден `.mdc` під `npm/rules/` поза `n-changelog.mdc` не містить заборонених патернів bump/CHANGELOG

## Decision Outcome

Chosen option: "Оголосити `n-changelog.mdc` єдиним джерелом істини + додати автоматичну meta-перевірку", because `n-changelog.mdc` має `alwaysApply: true` і явно задекларований як «джерело істини»; без автоматичного запобіжника правила можуть знову розійтися мовчки — що і є першопричиною описаного симптому; лише PR-ревʼю цей вектор не закриває.

### Consequences

* Good, because агент у репо-споживачі більше не отримує взаємо-суперечливих підказок — ❌ з протилежними рекомендаціями зникають.
* Good, because CI ловить порушення автоматично: `grep -nE 'підвищ.*version|version.*\+1|додай секцію' npm/rules/n-*.mdc` — порожньо в усіх крім `n-changelog.mdc`.
* Bad, because будь-які mirror-копії `n-npm-module.mdc` у `.cursor/rules/` репо-споживачів треба оновити; зворотна сумісність повідомлень фіксера не критична (CLI-output, не API).
* Neutral, because обмеження реалізації: поле `backfill` у форматі change-файлу відсутнє — парсер підтримує лише `bump` + `section` + опис; повідомлення фіксера з посиланням на `backfill: <version>` неможливе без розширення формату.

## More Information

- Файли правки: `npm/rules/npm-module/npm-module.mdc` (секції «Build версія», «CHANGELOG»), `npm/rules/changelog/changelog.mdc`
- Інваріант «top-секція CHANGELOG == `package.json.version`» переноситься до `n-changelog.mdc` виключно як post-release твердження — гарантує `n-cursor release` у CI, не ручний агент
- `checkDirtyNpmRequiresVersionBump` у `npm/rules/npm-module/js/package_structure.mjs` (~рядки 319–346) видалена: дублювала `npm/rules/changelog/js/consistency.mjs` та мала інвертовану семантику (фейлила у бажаному стані флоу)
- Повідомлення фіксера при drift `version ≠ CHANGELOG-top`: переписано — вказує на backfill change-файл, а не ручний bump; референс-реалізація — `npm/rules/changelog/js/consistency.mjs`
- Meta-перевірка: rego у `npm/rules/npm-module/policy/` або check у `npm/rules/changelog/fix.mjs`; патерни для заборони: `підвищ.*version.*\+1`, `version.*→.*\+1`, `додай секцію` у `*.mdc` поза `npm/rules/changelog/changelog.mdc`; входить до `bun test` у `npm/`
- Transcript не містить підтвердження рішення про розширення формату `backfill` (сесія завершилась до Q2)

## Update 2026-06-01

Деталі вибору між варіантами для `checkDirtyNpmRequiresVersionBump`:
- **A — Видалити повністю** (обрано): функція дублює `consistency.mjs` та фейлить у бажаному стані флоу; будь-яке виправлення через B або C лишало б дублювання
- **B — Переписати текст повідомлення**: усуває оманливий текст, але залишає дублювання між двома модулями
- **C — Інверсувати логіку** (фейлити при ручному bump): аналогічно залишає дублювання

Вибір A прибирає джерело хибно-позитивного фейлу без залишкового дублювання. Transcript підтверджує: «Механізму `backfill` не існує… Формат change-файлу підтримує лише `bump` + `section` + опис». Q2 і Q3 сесії не зафіксовані.
