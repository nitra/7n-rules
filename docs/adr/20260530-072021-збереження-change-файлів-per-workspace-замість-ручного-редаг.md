# n-cursor release: change-файли per-workspace замість ручного bump/CHANGELOG

**Status:** Accepted
**Date:** 2026-05-30

## ADR Автоматизований реліз через per-workspace change-файли

## Context and Problem Statement

Воркспейс-агенти в ізольованих git worktree незалежно бамплять `version` і редагують `CHANGELOG.md` у своїх PR. Коли два PR із паралельними фічами мерджаться в `main`, `npm/package.json` і `npm/CHANGELOG.md` конфліктують — кожен PR зайняв одну й ту саму нову версію. Це системна проблема, яка відтворювалася регулярно за монорепо-worktree-флоу (зафіксовано безпосередньо під час сесії: `main` самостійно пішов до `1.32.0`, поки фіча очікувала на `1.31.0`).

## Considered Options

* Change-файли (`<ws>/.changes/<unique>.md`) — агенти кладуть декларативні файли з `bump`+`section`+описом; CI-крок `n-cursor release` агрегує їх і самостійно бампить + пише CHANGELOG
* Ручний bump (попередній підхід) — агент у worktree підіймає `version` і редагує CHANGELOG вручну при фінішуванні фічі
* changesets / Beachball — зовнішній інструмент зі схожою механікою change-файлів

## Decision Outcome

Chosen option: "Change-файли (`<ws>/.changes/<unique>.md`)", because ручний bump у worktree є джерелом регулярних merge-конфліктів; change-файли є zero-conflict (унікальне ім'я, нуль спільних рядків між агентами), а CI-крок `n-cursor release` — єдине місце, де реально відбувається bump. changesets/Beachball відхилені: вони не підтримують двопольний формат (semver bump + Keep-a-Changelog категорія), потрібний поточному CHANGELOG-правилу, і є зовнішньою залежністю без нативної інтеграції з `@nitra/cursor`.

### Consequences

* Good, because merge worktree-гілок більше не породжує конфліктів у `package.json`/`CHANGELOG.md` — worktree-агенти пишуть лише новий файл у `<ws>/.changes/`, не чіпаючи спільних файлів.
* Bad, because реліз тепер відбувається виключно в CI (або явним `n-cursor release`); проміжний стан репо між feature-комітом і CI-запуском не відображає майбутньої версії.

## More Information

- Файли: `npm/rules/release/release.mjs`, `npm/rules/release/change.mjs`, `npm/rules/release/lib/`
- CLI: `npx @nitra/cursor release`, `npx @nitra/cursor change`
- Spec: `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`
- Впроваджено в `@nitra/cursor@1.33.0` (коміт `35dd705`)

---

## ADR Формат change-файлів: два окремих поля `bump` + `section` і per-workspace розташування

## Context and Problem Statement

Необхідно визначити формат change-файлу — він має кодувати і semver-bump-тип (для визначення нової версії), і Keep-a-Changelog-категорію (для рубрики у `CHANGELOG.md`). Також треба вирішити розташування файлів у монорепо та схему іменування — так, щоб паралельні worktree-агенти не конфліктували.

## Considered Options

* Два окремих поля `bump: patch|minor|major` + `section: Added|Changed|Fixed|Removed` у YAML frontmatter
* Один тип-поле (як у changesets) — лише semver-тип, категорія виводиться автоматично
* Per-workspace `<ws>/.changes/` — розташування файлу визначає таргет-пакет
* Кореневий `.changes/` зі списком пакетів — потребує явного `package:`-поля у файлі
* Ім'я `<timestamp>-<short-rand>.md` — timestamp для читабельного порядку, суфікс проти колізій у той самий ms
* Ім'я: лише timestamp — простіше, але є ризик колізії при паралельних агентах

## Decision Outcome

Chosen option: "два окремих поля `bump` + `section`" + "per-workspace `<ws>/.changes/`" + "`<timestamp>-<short-rand>.md`", because: (1) changesets має лише semver-тип і втратив би рубрикацію `### Added/Changed/Fixed`, обов'язкову для поточного CHANGELOG-формату; (2) розташування файлу дорівнює таргет-пакету — агент у `packages/foo` кладе файл туди без ризику помилки з ім'ям пакета; (3) timestamp зручний для сортування, а суфікс необхідний, бо паралельні worktree-агенти можуть записувати файли в той самий мілісекунд.

### Consequences

* Good, because унікальне ім'я фізично виключає конфлікт між паралельними агентами у різних worktree.
* Good, because `release` переюзовує `package-manifest.mjs` для обходу workspace — нова реєстрація пакетів не потрібна.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Формат: YAML frontmatter `bump:` + `section:` + тіло-опис, наприклад `npm/.changes/1748546123456-a3f.md`
- `npm/rules/release/lib/change-file.mjs` — `parseChangeFile`, `serializeChangeFile`, `changeFileName`, `newChangeFileName`, `readChangeFiles`
- Fallback: якщо в workspace є зміни, але жодного change-файлу — `fallback.mjs` синтезує generic-запис із commit-меседжів

---

## ADR Git-тегування в монорепо: per-package тег `<name>@<version>`

## Context and Problem Statement

Після `n-cursor release` один прогін CI може підняти кілька workspace незалежно. Треба вирішити, як тегувати ці релізи у git — ставити один загальний тег на прогін, чи окремий тег на кожен пакет.

## Considered Options

* Per-package тег `<name>@<version>` — `@nitra/cursor@1.33.0`, `foo@1.2.3` тощо (канон changesets/Beachball/Lerna independent mode)
* Один тег на CI-прогін — `release-<timestamp>` або `v2026.05.30`

## Decision Outcome

Chosen option: "Per-package тег `<name>@<version>`", because цей варіант семантично узгоджений з незалежним per-workspace версіонуванням, і він безкоштовно дає базу для fallback-синтезу: `git describe --match 'foo@*'` повертає «останній реліз пакета foo», від якого `release` бере commit-range. Один тег на прогін ламає цей fallback і потребує окремого механізму визначення бази.

### Consequences

* Good, because `git describe --match '<name>@*'` дає точну базу commit-range для `fallback.mjs`.
* Good, because тег прямо відповідає парі (пакет, версія) — семантично чесно для незалежного монорепо.
* Bad, because scoped-імена (`@scope/name`) у ref'і дають вкладений шлях `refs/tags/scope/name@version` (слеш). Transcript зафіксував це як відомий trade-off; рішення — залишати canonical form як у changesets, не замінювати `/` на `-`.

## More Information

- `npm/rules/release/release.mjs` — виставляє тег через `git tag <name>@<version>` після commit-back
- Реальний приклад із сесії: тег `@nitra/cursor@1.33.0` після squash-коміту `35dd705`

---

## ADR CI-реліз: крок `release` і `publish` в одному job'і

## Context and Problem Statement

Крок `n-cursor release` (bump+CHANGELOG+commit-back+tag) має відбуватись до публікації npm-пакета. Треба вирішити, де саме в CI-пайплайні виконувати bump — в окремому job чи в тому самому, що і `publish`.

## Considered Options

* Один job `release-publish` — `n-cursor release` перед `JS-DevTools/npm-publish`
* Два окремих job — `release` в одному, `publish` в іншому

## Decision Outcome

Chosen option: "Один job `release-publish`", because commit-back через `GITHUB_TOKEN` навмисно не ретригерить workflow (захист від циклу), тому `publish`-крок мусить бачити вже піднятий `version` у тій самій виконаній job'і. Два окремих job ускладнюють передачу нової версії і потребують artifact-sharing між job'ами.

### Consequences

* Good, because `JS-DevTools/npm-publish` бачить вже бамплений `version` (`1.33.0`) без додаткових передач між job.
* Bad, because `cancel-in-progress` мусить лишатись `true` (примусово rego-правилом `ga.workflow_common`). Відмінений release-job лишає `main` без bump/тегу до наступного push — але стан відновлюваний (change-файли лишаються у worktree).
* Bad, because тригер `**/.changes/**` довелося прибрати при впровадженні — `check-ga` відхиляє glob без tracked-файлів на момент lint-ga. Варто повернути, коли `.changes/`-файли з'являться в репо.

## More Information

- `.github/workflows/npm-publish.yml` — permissions `contents: write`, `persist-credentials: true`, `fetch-depth: 0`
- Composite-action template: `npm/github-actions/release/action.yml` (scope B — для споживачів через sync)
- Команда: `npx @nitra/cursor release`
