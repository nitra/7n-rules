---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-01T21:04:11+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

## ADR Видалення `checkDirtyNpmRequiresVersionBump` із `package_structure.mjs`

## Context and Problem Statement
У `npm/rules/npm-module/js/package_structure.mjs` функція `checkDirtyNpmRequiresVersionBump` фейлить саме тоді, коли `version` у `package.json` не зрушено, а зміни під `npm/` є — тобто у точно правильному стані за change-file-флоу. Паралельно `npm/rules/changelog/js/consistency.mjs` вже реалізує ту саму перевірку, але коректно: вимагає change-файл, а не ручний bump `version`.

## Considered Options
* A — Видалити `checkDirtyNpmRequiresVersionBump` повністю (функція надлишкова й суперечлива; `consistency.mjs` покриває кейс правильно)
* B — Залишити функцію, переписати текст повідомлення
* C — Інверсувати логіку (фейлити при ручному bump)

## Decision Outcome
Chosen option: "A — Видалити `checkDirtyNpmRequiresVersionBump` повністю", because функція дублює логіку `consistency.mjs` та має інвертовану семантику — фейлить у бажаному стані флоу; будь-яке виправлення через B або C лишало б дублювання.

### Consequences
* Good, because прибирає джерело хибно-позитивного фейлу у правильно оформлених репо-споживачах.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/npm-module/js/package_structure.mjs` (функція `checkDirtyNpmRequiresVersionBump`, рядки ~319–346), `npm/rules/changelog/js/consistency.mjs` (альтернативне покриття).

---

## ADR `n-changelog.mdc` — єдине джерело істини для bump/CHANGELOG; інструкції ручного bump прибираються з `n-npm-module.mdc`

## Context and Problem Statement
`npm/rules/changelog/changelog.mdc` (v3.1, `alwaysApply: true`) забороняє ручне редагування `version` і `CHANGELOG.md`, вимагаючи change-файл як єдиний артефакт. `npm/rules/npm-module/npm-module.mdc` (v1.13) у секціях «Build версія» і «CHANGELOG» містить чеклист «`version` → +1; зверху нова секція…», що прямо суперечить `changelog.mdc`. Фіксер `fix npm-module` передавав ці суперечливі підказки агентам-споживачам.

## Considered Options
* Переписати `n-npm-module.mdc` так, щоб єдиним способом оформлення змін був `npx @nitra/cursor change …`; інваріант «top CHANGELOG == `package.json.version`» — лише post-release твердження, описане в `n-changelog.mdc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Переписати `n-npm-module.mdc`, прибрати інструкції ручного bump/CHANGELOG", because `n-changelog.mdc` є джерелом істини (`alwaysApply: true`); усі інші правила підпорядковуються; бриф явно вказує, що секції про bump/CHANGELOG в `*.mdc` крім `n-changelog.mdc` неприпустимі.

### Consequences
* Good, because transcript фіксує очікувану користь: `grep -nE 'підвищ.*version|version.*\+1|додай секцію' npm/rules/n-*.mdc` повертатиме порожній результат для всіх файлів окрім `n-changelog.mdc`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/npm-module/npm-module.mdc`, `npm/rules/changelog/changelog.mdc`. Перевірка: `npx @nitra/cursor fix changelog npm-module` на репо лише з change-файлом — обидва ✅.

---

## ADR Відсутність `backfill`-мітки у форматі change-файлу — обмеження реалізації

## Context and Problem Statement
Бриф вимагав повідомлення фіксера, що вказує на «окремий backfill change-файл з міткою `backfill: <version>`». Під час аналізу `npm/rules/release/lib/change-file.mjs` виявлено, що формат change-файлу підтримує лише два ключі (`bump`, `section`) + текст опису. Поля `backfill` у специфікації формату не існує.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Визнати `backfill`-мітку відсутньою в поточному форматі", because аналіз `change-file.mjs` підтвердив: парсер мінімальний і не містить обробки поля `backfill`; реалізувати повідомлення фіксера з посиланням на неіснуючий механізм неможливо без розширення формату change-файлу.

### Consequences
* Good, because Neutral, because transcript не містить підтвердження наслідку — рішення про те, чи додавати поле `backfill` у формат, у transcript не прийнято (сесія завершилась до Q2).
* Bad, because бриф містить очікувану поведінку («виправляється окремим backfill change-файлом з міткою `backfill: <version>`»), яку неможливо реалізувати без додаткового розширення `change-file.mjs`.

## More Information
Файл: `npm/rules/release/lib/change-file.mjs`. Transcript: «Механізму `backfill` не існує… Формат change-файлу підтримує лише `bump` + `section` + опис». Сесія завершилась на Q1; подальші рішення (Q2, Q3) не зафіксовані.
