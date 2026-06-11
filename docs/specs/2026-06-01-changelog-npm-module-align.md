---
kind: nitra-spec
status: draft
adr: null
plan: ../plans/2026-06-01-changelog-npm-module-align.md
risk: low
---

# Узгодження n-changelog.mdc ↔ n-npm-module.mdc — дизайн

Дата: 2026-06-01
Власник: @vitaliytv
Статус: Draft (очікує апруву)

## Мета

Усунути суперечність між `n-changelog.mdc` (v3.1, `alwaysApply`, джерело істини) і
`n-npm-module.mdc` (v1.13). `npm-module.mdc` у секціях **Build версія** і **CHANGELOG**
наказує **ручний** bump `version` і додавання секції зверху `CHANGELOG.md` — рівно те,
що `changelog.mdc` забороняє («Ніколи не редагуй `version`/`CHANGELOG.md` вручну; єдиний
артефакт зміни — change-файл; bump робить `n-cursor release` у CI»).

Та сама суперечність продубльована в коді: `npm-module/js/package_structure.mjs` має дві
перевірки, що штовхають агента до ручного bump. Прибираємо суперечність у правилах і в
коді; джерелом істини лишається `changelog.mdc`.

## Знахідки (поточний стан)

- `changelog/js/consistency.mjs` **уже** реалізує правильну модель повністю: drift `version`
  (vs реєстр / vs git-база) = fail навіть із change-файлом; pass лише коли є change-файл і
  `version` не зрушено. Жодних інструкцій ручного bump. Лишається як reference, без змін.
- `npm-module/js/package_structure.mjs` містить дві перевірки, що суперечать цій моделі:
  - `checkDirtyNpmRequiresVersionBump` (319–346) — **фейлить саме у бажаному стані**
    (зміни під `npm/` є, `version` == HEAD). Логіка інвертована; кейс уже коректно покриває
    `consistency.mjs`.
  - `checkChangelogTopMatchesPackageVersion` (288–310) — тримає інваріант «top секція
    CHANGELOG == `package.json.version`» як **живий**, хоча він істинний лише **post-release**
    (його гарантує CI). У feature-флоу провокує ручні правки `version`/CHANGELOG.
- Механізму **`backfill`** не існує: формат change-файлу (`release/lib/change-file.mjs`) —
  лише `bump` + `section` + опис. Поняття backfill із початкового брифу **не вводимо** і
  формат change-файлу **не розширюємо**.

## Рішення (узгоджені розвилки)

1. **`checkDirtyNpmRequiresVersionBump` — видалити.** Надлишкова й інвертована; кейс «зміни
   без change-файлу» і «drift version» уже коректно ловить `consistency.mjs`. _(Q1=A)_
2. **`checkChangelogTopMatchesPackageVersion` — видалити.** Інваріант «top==version»
   істинний лише post-release; у feature-флоу він шкідливий. Drift від ручного bump ловить
   `consistency.mjs`. Поняття backfill і розширення формату change-файлу — **поза scope**.
   _(Q2=A)_
3. **Meta-перевірка проти повторного розходження — НЕ додаємо.** Реальний фікс структурний
   (видаляємо суперечливі секції+перевірки, єдине джерело істини). Regex по вільному тексту
   `.mdc` крихкий і сам стає джерелом тертя; YAGNI. _(Q3=skip)_
4. **`package_structure.mjs` повністю виходить із теми version/CHANGELOG** — узгодженість
   віддаємо `consistency.mjs`; FS-existence перевірок CHANGELOG у package*structure не
   лишаємо. *(Q4)\_

## Зміни секціями

### A. `npm/rules/npm-module/npm-module.mdc`

- Переписати секцію **Build версія** (59–68): прибрати чеклист «`version` → +1; зверху нова
  секція `## [нова версія]`» і антипатерн про дописування bullet-ів. Єдиний спосіб оформлення
  змін — change-файл (`npx @nitra/cursor change …`); bump/CHANGELOG робить CI. Послатися на
  `n-changelog.mdc`.
- Секцію **CHANGELOG** (70–72): прибрати твердження «top секція має збігатися з `version`» як
  локальну вимогу; делегувати в `n-changelog.mdc` (post-release-гарантія CI). Формат CHANGELOG
  уже описаний у `changelog.mdc` — тут лишити максимум посилання.
- Жодних інструкцій «підвищ version» / «додай секцію» поза `n-changelog.mdc`.

### B. `npm/rules/changelog/changelog.mdc`

- Додати коротке post-release твердження: «перша (верхня) секція `CHANGELOG.md` дорівнює
  `package.json.version` **після релізу** — це гарантує `n-cursor release` у CI, агрегуючи
  change-файли. Локально вручну цю рівність не підтримують (version/CHANGELOG не чіпають)».
- Зафіксувати межу: інструкції bump/CHANGELOG живуть **лише** тут; інші правила підпорядковані.

### C. `npm/rules/npm-module/js/package_structure.mjs`

- Видалити `checkDirtyNpmRequiresVersionBump` і `checkChangelogTopMatchesPackageVersion` разом
  із їхніми викликами в orchestrator-функції перевірки.
- Видалити осиротілі хелпери/regex/імпорти (напр. `firstChangelogSectionVersion`,
  `CHANGELOG_FIRST_VERSION_RE`, `gitDiffNameOnlyNpm`, `gitShowNpmPackageVersionAt`,
  `gitInsideWorkTree` — якщо ніде більше не використовуються; перевірити перед видаленням).

### D. Тести `npm/rules/npm-module/js/tests/package_structure.test.mjs`

- Прибрати кейси, що покривали видалені функції (зокрема `CHANGELOG version не збігається →
fail`, dirty-npm-requires-bump). Решта `package_structure` перевірок — лишити зеленими.

## Не-цілі

- Не змінюємо `consistency.mjs` (reference; вже коректний).
- Не вводимо `backfill` і не розширюємо формат change-файлу.
- Не додаємо meta-lint правил.

## Як перевірити

- `bun test` у `npm/` — зелений.
- У тест-репо з drift `version`=1.3.3 / CHANGELOG-top=[1.3.2]: `npx @nitra/cursor fix npm-module`
  **не** містить «додай секцію» / «підвищ version»; drift ловиться через `consistency.mjs`
  (відкоти version + change-файл).
- `grep -nE 'підвищ.*version|version.*\+1|додай секцію' npm/rules/**/*.mdc` — порожньо скрізь
  крім `changelog.mdc` (де лише описує заборону).
- `npx @nitra/cursor fix changelog npm-module` на feature-репо з лише change-файлом і без правок
  `version`/`CHANGELOG` — обидва ✅.

## Ризики

Low. Зміни — видалення суперечливого коду + узгодження тексту правил. `consistency.mjs`
вже несе коректну поведінку, тож регресій поведінки фіксера не очікується; зворотна сумісність
повідомлень CLI не критична (це output, не API).
