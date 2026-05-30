---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-29T22:03:16+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

## ADR Стратегія вирішення конфліктів CHANGELOG/version у паралельній розробці

## Context and Problem Statement

При паралельній розробці (субагенти у окремих git worktree або кілька розробників одночасно) кожен workspace бампить `version` у `package.json` і дописує секцію зверху `CHANGELOG.md` відносно однієї бази — гарантований конфлікт при злитті. Правило `n-changelog.mdc` вимагало ручного bump + ручного запису CHANGELOG у кожному PR, що й було першопричиною конфліктів.

## Considered Options

* `@changesets/cli` — окремі файли чейнджсетів, агрегація на релізі (JS-only, власний формат CHANGELOG)
* Beachball (Microsoft) — JSON change-файли per-PR, `beachball publish` у CI (JS-only, semver-типи без Keep-a-Changelog категорій)
* `.gitattributes merge=union` для CHANGELOG — тактичний фікс без зміни архітектури
* Власний `n-cursor change`/`n-cursor release` — формат сумісний з Keep-a-Changelog, підтримка JS і Python workspace

## Decision Outcome

Chosen option: "Власний `n-cursor change`/`n-cursor release`", because `@changesets/cli` і Beachball підтримують лише npm/JS, тоді як `n-changelog.mdc` охоплює й Python (`pyproject.toml`) workspace; власна реалізація перевикористовує наявний `package-manifest.mjs` і повністю контролює формат CHANGELOG.

### Consequences

* Good, because transcript фіксує очікувану користь: агенти у worktree пишуть лише `<ws>/.changes/<timestamp>-<6rand>.md` — два паралельні агенти фізично не торкаються одного рядка, конфлікт зникає в корені.
* Good, because реліз серіалізований в єдиній точці — CI на `main` (`npm-publish.yml`) — що унеможливлює дублювання version-bump від спільної бази.
* Bad, because transcript не містить підтверджених негативних наслідків, крім додаткового обсягу коду порівняно з готовими інструментами.

## More Information

Реалізовані файли: `npm/rules/release/lib/change-file.mjs`, `npm/rules/release/lib/aggregate.mjs`, `npm/rules/release/lib/fallback.mjs`, `npm/rules/release/change.mjs`, `npm/rules/release/release.mjs`. Зміни: `npm/rules/changelog/js/consistency.mjs` (severity `error` → `warn` при відсутності change-файлу і bump), `npm/bin/n-cursor.js` (`case 'change':`, `case 'release':`). Spec: `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`. Plan: `docs/superpowers/plans/2026-05-29-n-cursor-release.md`.

---

## ADR Формат change-файлів: YAML frontmatter з окремими полями `bump` і `section`

## Context and Problem Statement

Change-файли повинні нести два ортогональні атрибути: semver-рівень підняття версії (`bump`) і Keep-a-Changelog категорію (`### Added/Changed/Fixed/Removed`). Beachball і `@changesets/cli` зберігають лише semver-тип, втрачаючи категоризацію, яка вимагається форматом CHANGELOG у `n-changelog.mdc`.

## Considered Options

* Лише semver-тип (як у Beachball/changesets) — категорія виводиться евристично
* YAML frontmatter з окремими `bump` і `section` — обидва поля явні

## Decision Outcome

Chosen option: "YAML frontmatter з окремими `bump` і `section`", because transcript фіксує: «ваша категоризація `### Added/Changed/Fixed/Removed` втратилась би, якщо не зашивати її в `comment` + кастомний рендерер» — окремі поля усувають двозначність без додаткового рендерера.

### Consequences

* Good, because `renderChangelogSection` безпосередньо групує bullet-и за `section`, зберігаючи порядок `Added → Changed → Fixed → Removed`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Формат файлу: `---\nbump: minor\nsection: Added\n---\nОпис зміни\n`. Ім'я файлу: `<13-digit-timestamp>-<6-char-rand>.md` (6 символів обрано для зниження ймовірності колізій при паралельних агентах). Файли зберігаються per-workspace: `<ws>/.changes/`. Парсер: `npm/rules/release/lib/change-file.mjs`.

---

## ADR Розташування change-файлів: per-workspace, а не кореневий `.changes/`

## Context and Problem Statement

Change-файли можна зберігати або в єдиному кореневому `.changes/` зі списком пакетів (як у `@changesets/cli`), або безпосередньо в директорії відповідного workspace. У монорепо кожен пакет веде незалежний CHANGELOG/version; агент, що працює в `packages/foo`, повинен документувати зміну саме цього пакета.

## Considered Options

* Кореневий `.changes/` зі списком пакетів у frontmatter
* Per-workspace `.changes/` — локація = таргет

## Decision Outcome

Chosen option: "Per-workspace `.changes/`", because transcript фіксує: «агент, що працює в `packages/foo`, просто кладе файл туди. Нуль шансів промахнутись пакетом»; відповідає філософії «кожен пакет повністю володіє своїм CHANGELOG + version».

### Consequences

* Good, because `releaseWorkspace(wsDir)` перевикористовує `findPackageManifests` і для кожного workspace читає лише свій `<ws>/.changes/` — ізоляція гарантована.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

`readWorkspaceChangeFiles(wsDir)` у `npm/rules/release/lib/change-file.mjs` читає `<wsDir>/.changes/*.md`. Python-workspace підтримується тим самим механізмом.

---

## ADR Git-теги per-package: `<name>@<version>`

## Context and Problem Statement

Монорепо з незалежним версіонуванням кожного workspace потребує git-тегів, що однозначно ідентифікують версію конкретного пакета. Тег також є базою для CI-fallback: `release` визначає commit-range для синтезу записів з комітів через `git describe --match '<name>@*'`.

## Considered Options

* Per-package теги `<name>@<version>` (канон changesets/Beachball для independent mode)
* Один тег на CI-прогін `release-<timestamp>` / `v2026.05.29`

## Decision Outcome

Chosen option: "`<name>@<version>`", because transcript фіксує: «Variant 2 ламає fallback — `git describe` більше не дає "останній реліз пакета X"»; per-package тег є єдиним семантично узгодженим підходом для незалежного версіонування.

### Consequences

* Good, because per-package тег безкоштовно дає базу commit-range для CI-fallback (рішення 3).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Scoped-імена (`@nitra/cursor`) дають теги виду `@nitra/cursor@1.31.0` у `refs/tags/nitra/...` — це канонічна поведінка `@changesets/cli`. `releaseWorkspace` виконує `git tag <name>@<version>` після запису файлів. Додаткової інформації в transcript не зафіксовано щодо конкретної команди тегування.

---

## ADR CI-шаблон `release-publish` як composite action для scope B

## Context and Problem Statement

`n-cursor` розповсюджується серед споживачів через sync правил і composite actions. Щоб будь-який споживчий проєкт міг отримати release-флоу без ручного написання CI-кроків, workflow `npm-publish.yml` треба перетворити на шаблон у пакеті.

## Considered Options

* Inline-кроки у кожному споживчому `.github/workflows/npm-publish.yml` вручну
* Composite action у `npm/github-actions/release-publish/action.yml`, що поширюється через sync

## Decision Outcome

Chosen option: "Composite action `npm/github-actions/release-publish/action.yml`", because transcript фіксує вимогу scope B («будь-який споживач отримає готовий CI-крок як зараз `setup-bun-deps`») і явне рішення «виносити `npm-publish.yml` як template у цій же ітерації».

### Consequences

* Good, because споживач підключає один `uses: ./npm/github-actions/release-publish` і отримує bump + CHANGELOG + tag + publish без дублювання логіки.
* Bad, because `.github/workflows/npm-publish.yml` потребує `permissions: contents: write` і `persist-credentials: true` — це ширші permissions, ніж попередній `contents: read`.

## More Information

Файли: `npm/github-actions/release-publish/action.yml`, `.github/workflows/npm-publish.yml`. Ключові зміни у workflow: `permissions.contents: write`, `fetch-depth: 0`, `cancel-in-progress: false` (не вбивати live реліз), тригер `**/.changes/**`. `release` комітить bump назад у `main` через `GITHUB_TOKEN` — за замовчуванням не ретригерить інші workflow (loop-guard).
