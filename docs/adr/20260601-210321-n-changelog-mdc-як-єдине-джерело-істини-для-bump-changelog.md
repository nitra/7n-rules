---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-01T21:03:21+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

## ADR `n-changelog.mdc` як єдине джерело істини для bump/CHANGELOG

## Context and Problem Statement
У пакеті `@nitra/cursor` правило `n-npm-module.mdc` (v1.13) у секціях «Build версія» і «CHANGELOG» прямо наказує агенту вручну підвищувати `version` (+1) і додавати нову секцію зверху `CHANGELOG.md`. Це пряма суперечність із `n-changelog.mdc` (v3.1, `alwaysApply: true`), яке забороняє будь-яке ручне редагування `version` і `CHANGELOG.md`, оголошуючи change-файл єдиним дозволеним артефактом змін.

## Considered Options
* Лишити обидва правила паралельно і розрулювати пріоритет коментарем у кожному
* Оголосити `n-changelog.mdc` єдиним джерелом істини; `n-npm-module.mdc` підпорядковується і не містить інструкцій про bump чи CHANGELOG

## Decision Outcome
Chosen option: "Оголосити `n-changelog.mdc` єдиним джерелом істини", because `n-changelog.mdc` має `alwaysApply: true` і явно задекларований як «джерело істини»; усі інші правила підпорядковуються йому.

### Consequences
* Good, because transcript фіксує очікувану користь: агент у репо-споживачі більше не отримує взаємо-суперечливих підказок — два ❌ із протилежними рекомендаціями зникають.
* Bad, because будь-які mirror-копії `n-npm-module.mdc` у `.cursor/rules/` репо-споживачів треба оновити; зворотна сумісність повідомлень фіксера не критична (CLI-output, не API) — це зазначено в обмеженнях задачі.

## More Information
Файли правки: `npm/rules/npm-module/npm-module.mdc` (секції «Build версія», «CHANGELOG»), `npm/rules/changelog/changelog.mdc`. Інваріант «top-секція CHANGELOG == `package.json.version`» переноситься до `n-changelog.mdc` виключно як **post-release** твердження — його дотримання гарантує `n-cursor release` у CI, а не ручний агент. Перевірка `checkDirtyNpmRequiresVersionBump` у `npm/rules/npm-module/js/package_structure.mjs` визначена як така, що містить **інвертовану логіку** (фейлить у коректному стані, де зміни є, але `version` не зрушено) і дублює `npm/rules/changelog/js/consistency.mjs`.

---

## ADR Повідомлення фіксера для drift `version ≠ CHANGELOG-top` — backfill замість ручного bump

## Context and Problem Statement
Коли `version` у `npm/package.json` (наприклад, `1.3.3`) випереджає верхню секцію `CHANGELOG.md` (наприклад, `[1.3.2]`), фіксер `fix npm-module` видає повідомлення, яке пропонує підвищити `version` (+1) і додати нову секцію — чим поглиблює drift замість виправлення. Потрібен окремий шлях для кейсу «`version` опубліковано в реєстрі без CHANGELOG-секції» (historical drift).

## Considered Options
* Зберегти поточне повідомлення із вказівкою «підвищ version +1; додай секцію зверху»
* Переписати повідомлення: drift від ручного bump — відкоти `version` до значення top-секції CHANGELOG; для historical debt — `backfill` change-файл із міткою `backfill: <version>`

## Decision Outcome
Chosen option: "Переписати повідомлення з backfill-інструкцією", because поточне повідомлення прямо суперечить `n-changelog.mdc` і провокує агента виконати заборонену дію; backfill change-файл — єдиний дозволений спосіб закрити historical debt без локального bump.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor fix npm-module` на drift-репо (version=1.3.3 / CHANGELOG-top=[1.3.2]) показуватиме ❌ із повідомленням про backfill, без згадок «додай секцію» чи «підвищ version».
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл правки: `npm/rules/npm-module/js/package_structure.mjs` — функція, що генерує повідомлення при drift. Очікуваний текст помилки: «`version` X.Y.Z опубліковано в реєстрі без CHANGELOG-секції; це historical debt, виправляється окремим backfill change-файлом із міткою `backfill: <version>` — не bump-ом локальної `version`». Перевірка: `npm/rules/changelog/js/consistency.mjs` вже містить коректне повідомлення (каже «відкоти version до значення top-секції / поклади change-файл») і залишається reference-реалізацією.

---

## ADR Meta-перевірка проти повторного розходження правил у `npm/rules/*.mdc`

## Context and Problem Statement
Після узгодження `n-npm-module.mdc` із `n-changelog.mdc` немає автоматичного запобіжника, який не дасть майбутньому редактору знову додати в будь-який `.mdc` під `npm/rules/` інструкції типу «підвищ version +1» або «додай секцію».

## Considered Options
* Лишити тільки ревʼю-процес (PR review)
* Додати автоматичну meta-перевірку (rego або скрипт у `check-changelog`), що жоден `.mdc` під `npm/rules/` поза `n-changelog.mdc` не містить regex-патернів `підвищ.*version.*\+1` / `version.*→.*\+1` / `додай секцію`

## Decision Outcome
Chosen option: "Автоматична meta-перевірка", because без неї правила можуть знову розійтися між собою мовчки, що і є першопричиною описаного симптому; meta-check закриває цей вектор структурно, а не лише через конвенцію.

### Consequences
* Good, because transcript фіксує очікувану користь: `grep -nE 'підвищ.*version|version.*\+1|додай секцію' npm/rules/n-*.mdc` — порожньо в усіх крім `n-changelog.mdc`; CI ловить порушення автоматично.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо складності підтримки meta-перевірки.

## More Information
Точка розміщення: rego у `npm/rules/npm-module/policy/` або новий check у `npm/rules/changelog/fix.mjs`. Патерни для заборони: `підвищ.*version.*\+1`, `version.*→.*\+1`, `додай секцію` у `*.mdc`-файлах поза `npm/rules/changelog/changelog.mdc`. Перевірка повинна бути частиною `bun test` у `npm/`.
