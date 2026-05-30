# Дизайн: bump `version` лише в CI — заборона ручного/агентського bump

- **Дата:** 2026-05-30
- **Статус:** draft (узгоджено через brainstorming, очікує рев'ю спеки)
- **Пакет:** `@nitra/cursor`
- **Пов'язане:** [2026-05-29-n-cursor-release-design.md](2026-05-29-n-cursor-release-design.md), ADR `docs/adr/20260530-093029-прибирання-ручного-та-локального-бампу-версії-тільки-ci.md`

## Проблема

Перехід на change-file workflow (`n-cursor release`, попередня спека) уже зробив CI фактичним місцем bump. Але правило `n-changelog.mdc` (v3.0) лишило **legacy-лазівку**:

> «Legacy / hotfix: ручний bump `version` + новий запис у `CHANGELOG.md` усе ще приймається перевіркою як альтернатива change-файлу.»

А перевірка `npm/rules/changelog/js/consistency.mjs` цю лазівку **зеленить** — на піднятому вручну `version` повертає `pass` («version підвищено», «version змінено»).

Наслідок: **субагент** (під час `n-fix`, `n-coverage-fix` тощо), читаючи правило, час від часу **сам бампить `version`** у `package.json` замість того, щоб покласти change-файл. Оскільки перевірка це схвалює, бамп тихо потрапляє в коміт. Паралельні гілки/worktree знову конфліктують на спільному рядку `version` — тобто саме той клас merge-конфліктів, який change-file workflow мав усунути.

Корінь: правило **дозволяє** ручний bump, а перевірка його **винагороджує**.

## Рішення

Зробити change-файл **єдиним** дозволеним способом зафіксувати зміну. `version` (і `CHANGELOG.md`) — власність виключно `n-cursor release` у CI. Будь-яка зміна `version` поза CI — **порушення**, яке перевірка **завалює** (`fail`), на **будь-якій** гілці (включно з `main`).

### Чому без винятку для `main`

`check changelog` запускається лише локально (pre-commit `hk` + ручний виклик) — **жоден** GitHub-workflow його не гонить (перевірено: `npm-publish.yml` робить тільки `release`, lint-workflow'и — eslint/stylelint/text/ga). Тому release-коміт від CI ніколи не проходить крізь цю перевірку.

А локально на `main` після релізу `HEAD === origin/main`, тож база порівняння рухається разом із бампом → діфу `version` немає → нічого не червониться. Діф `version` відносно бази виникає лише коли **людина/агент** локально змінили `version` і ще не запушили — і це саме той випадок, який треба заборонити. Отже однорідне правило «version == база, лише `.changes/*.md`» безпечне для всіх гілок і не потребує спецкейсу `main`.

## Зміни

### 1. `npm/rules/changelog/js/consistency.mjs` (ядро)

Інваріант перевірки для workspace з релевантними змінами:

- **Є change-файл(и) у `.changes/`** → `pass` («намір зафіксовано — bump зробить CI»).
- **`version` змінено відносно бази / опублікованої** (Vbase ≠ Vcurrent **або** Vpublished ≠ Vcurrent) → **`fail`**: _«version змінено поза CI (X → Y) — заборонено. Відкоти `version` і поклади change-файл: `npx @nitra/cursor change --bump … --section … --message "…"`. Bump зробить CI на main.»_
- **`version` не змінено, change-файлу нема, але є релевантні зміни** → `fail` («поклади change-файл»).

Конкретні правки функцій:

- **`checkLocalOnlyChangedWorkspace`** — гілку `Vbase !== Vcurrent → pass («version підвищено»)` замінити на `fail` (ручний bump). Прибрати `verifyChangelogEntry` з dev-шляху (CHANGELOG генерує CI). Кейс нового workspace (`Vbase === null`) → вимагати change-файл, без перевірки CHANGELOG.
- **`checkPublishedWorkspace`** — гілку `Vpublished !== Vcurrent → verifyChangelogEntry (pass)` замінити на `fail` (локальна `version` випереджає опубліковану = ручний bump), **без** винятку для `main`.
- **`checkPublishedWorkspacePendingGitChanges`** — прибрати порівняння `Vbase` та `verifyChangelogEntry`; лишити лише: є change-файл → pass, інакше за наявності релевантних змін → fail «поклади change-файл». Будь-який діф `version` обробляє гілка вище (`Vpublished !== Vcurrent`).
- **`checkNpmFilesArrayContainsChangelog`** (files має містити `"CHANGELOG.md"`) — **лишити**: це пакувальна вимога, не пов'язана з bump.
- Dev-сторона **більше не звіряє записи у `CHANGELOG.md`** — його єдине джерело тепер `release.mjs` у CI. Хелпери `verifyChangelogEntry`/`changelogHasVersionEntry` лишаються лише якщо їх використовує published-шлях для нового workspace; інакше видалити як мертвий код.

### 2. Документація правила

- `npm/rules/changelog/changelog.mdc` (джерело) **і** `.cursor/rules/n-changelog.mdc` (синхронізоване дзеркало):
  - **Видалити** рядок «Legacy / hotfix: ручний bump … приймається як альтернатива».
  - В інверсії прибрати пункт «правки **лише** `CHANGELOG.md` або поля `version` … як сам релізний крок» — у feature-флоу цього шляху більше немає (релізний крок існує тільки в CI).
  - STOP-блок зробити категоричним: «`version` і `CHANGELOG.md` **не редагуй ніколи** — навіть для hotfix; єдиний артефакт зміни — change-файл `.changes/*.md`».
  - Підняти `version: '3.0' → '3.1'`.

### 3. Тести

- `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs` — оновити кейси, що очікували `pass` на піднятому `version`, на нову поведінку `fail`; додати явний кейс «ручний bump на feature-гілці → fail» і «ручний bump на main → fail»; лишити «є change-файл → pass».

### 4. Супутній аудит agent-facing текстів

Зняти будь-які заклики бампити `version` вручну в:
- `AGENTS.md`, `cursor/CLAUDE.md` (кореневі) — якщо згадують ручний bump;
- скіли (`.cursor/skills/*/SKILL.md`), що проходять changelog-флоу;
- memory `feedback_changelog.md` (зараз «version bump перед фінішем») — переформулювати на «change-файл перед фінішем».

### 5. Реліз самого пакета

- Покласти change-файл `npm/.changes/*.md` (`bump: minor`, `section: Changed`) про цю зміну поведінки правила. **Не** редагувати `npm/package.json#version` вручну.
- `npx @nitra/cursor fix changelog` → exit `0`.

## Не входить (YAGNI)

- Окремий write-time hook/guard — надлишково: наявний pre-commit `npm-changelog` уже гонить `check changelog`, тож посилена перевірка автоматично блокує коміт із ручним bump.
- Зміни в `release.mjs`, форматі change-файлів, CI-workflow — вони вже відповідають цільовій моделі.

## Критерії приймання

1. `consistency.mjs`: ручний bump `version` (Vbase ≠ Vcurrent або Vpublished ≠ Vcurrent) → `fail` на будь-якій гілці; наявність change-файлу → `pass`.
2. Жоден agent-facing документ не пропонує бампити `version` вручну.
3. `n-changelog.mdc` (джерело + дзеркало) синхронні, без legacy-лазівки, `version: '3.1'`.
4. Усі тести `check.test.mjs` зелені; додано кейси на заборону ручного bump.
5. Покладено `npm/.changes/*.md`; `fix changelog` → `0`.
