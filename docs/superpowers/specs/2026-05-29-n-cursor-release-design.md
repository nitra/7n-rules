# Дизайн: `n-cursor release` — change-файли замість ручного bump/CHANGELOG

- **Дата:** 2026-05-29
- **Статус:** draft (узгоджено через brainstorming, очікує рев'ю спеки)
- **Пакет:** `@nitra/cursor`

## Проблема

Правило `n-changelog.mdc` (v2.6) вимагає в **кожному** feature-флоу вручну:

1. підняти `version` у `<ws>/package.json` (або `pyproject.toml`) на `patch +1`;
2. додати нову секцію `## [version] - YYYY-MM-DD` **зверху** `<ws>/CHANGELOG.md`.

Це гарантує merge-конфлікти за паралельної роботи: і поле `version`, і верхній рядок CHANGELOG — спільні рядки, які всі редагують одночасно. Загострюється в основному робочому патерні — **субагенти в окремих git-worktree**: кожен агент за правилом бампить ту саму версію й дописує той самий CHANGELOG, а на merge worktree назад → конфлікт.

Корінь проблеми: ручний bump від спільної бази + редагування спільного файлу.

## Рішення (узгоджені рішення)

Перенести модель «один файл на зміну» (як у changesets/Beachball), але **власну** й вбудовану в `n-cursor`:

- **Scope:** B — фіча для **будь-якого** споживача `@nitra/cursor`, не лише для цього монорепо.
- **Реалізація:** свій скрипт, **не** `@changesets/cli` і **не** Beachball. Причина: обидва — npm/JS-only, а правило `n-changelog.mdc` веде **і Python** (`pyproject.toml`); крім того, їхня модель типів — semver-bump, що **не** покриває Keep-a-Changelog категорії `### Added/Changed/Fixed/Removed`. Власний генератор переюзає наявну детекцію workspace (`npm/rules/changelog/lib/package-manifest.mjs`) і дає рідний формат CHANGELOG.
- **Точка агрегації:** A — `release` запускається **тільки в CI на `main`** (максимальна автоматизація, hands-off).
- **Авторство change-файлів:** 3 (гібрид) — агент/людина кладе change-файл; CI має fallback (синтез із commit-меседжів), якщо файлу нема; `check` — м'яке попередження, не блокер.

### Чому конфлікт зникає

Кожна зміна = окремий `.changes/<unique>.md` з унікальним іменем. Два агенти (чи worktree) фізично не торкаються одного рядка → merge worktree зводить разом два різні файли. Версію в feature-флоу **ніхто не бампить** — це робить єдина серіалізована точка (CI на `main`).

## Архітектура

### Нові підкоманди `n-cursor`

| Команда                    | Де працює           | Призначення                                                                                                                                                              |
| -------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `n-cursor change`          | локально / агент    | Інтерактивно або з прапорців пише **один** `<ws>/.changes/<unique>.md`. Замінює ручне редагування CHANGELOG.                                                             |
| `n-cursor release`         | **CI на `main`**    | Агрегує `<ws>/.changes/*.md` по кожному workspace → bump `version` + нова секція CHANGELOG → `git commit` + `tag` → видаляє оброблені change-файли. **Не публікує сам.** |
| `n-cursor check changelog` | PR-гейт (вже існує) | Семантика → м'яка: warn, якщо для зміненого workspace нема ні change-файлу, ні піднятого `version`.                                                                      |

Новий rule-каталог `npm/rules/release/` поряд із наявним `npm/rules/changelog/`.

### Потік (worktree-агенти)

```
агент у worktree → пише <ws>/.changes/abc123.md (нуль спільних рядків)
   ↓ merge worktree → merge у PR → merge у main
CI на main: n-cursor release → bump + CHANGELOG + tag + commit-back
   ↓ (наявний крок) JS-DevTools/npm-publish публікує пакети зі зміненою version
```

Локально релізного кроку **немає** — worktree лише накопичують change-файли; їхній merge ніколи не чіпає CHANGELOG/version.

### Fallback (рішення 3)

Якщо `release` бачить релевантні зміни в workspace, але **жодного** change-файлу — синтезує generic-запис із commit-меседжів відповідного діапазону (щоб реліз не був порожнім) і логує warning.

## Формат change-файлів

### Розташування — пер-workspace (не кореневий `.changes/`)

```
npm/.changes/k3n9x2.md          → @nitra/cursor (npm/)
packages/foo/.changes/a7b1c0.md → packages/foo
services/api/.changes/qz88.md   → Python-пакет (pyproject.toml)
```

Обґрунтування:

1. **Локація = таргет** — не треба називати пакет у файлі; промахнутись пакетом неможливо.
2. **Переюз детекції** — `release` через `package-manifest.mjs` для кожного знайденого workspace (npm **і** Python, ігноруючи `node_modules`/`.venv`) дивиться його `./.changes/`. Корінь монорепо (`.`) не чіпається — `.changes/` там нема.
3. Відповідає філософії «кожен пакет веде свій CHANGELOG/version» — тепер ще й свої change-файли.

**Зміна, що зачіпає кілька пакетів** → по одному файлу в кожен відповідний `<ws>/.changes/`.

### Структура файлу

```md title="<ws>/.changes/<unique>.md"
---
bump: minor # patch | minor | major — впливає на version
section: Added # Added | Changed | Fixed | Removed — заголовок ### у CHANGELOG
---

Додав підтримку X у конекторі Y
```

- Ім'я файлу — **`<timestamp>-<short-rand>.md`** (timestamp для читабельного порядку + короткий випадковий суфікс проти колізій, коли два паралельні агенти в різних worktree пишуть у ту саму мілісекунду) → нуль колізій.
- `bump` і `section` — **ортогональні** поля: `bump` дає semver, `section` — Keep-a-Changelog категорію. changesets/Beachball мають лише semver-тип і втратили б категоризацію.

### Алгоритм `release` (на кожен workspace)

1. Зчитати всі `<ws>/.changes/*.md`.
2. `version` ← поточна + `max(bump)` по всіх файлах (major > minor > patch).
3. Нова секція `## [version] - YYYY-MM-DD` зверху CHANGELOG; bullet-и згруповані під `### {section}`.
4. Поставити git-тег `<name>@<version>` на цей реліз пакета (scoped-імена — канонічно `@scope/name@version`, як у changesets).
5. Видалити оброблені `.changes/*.md`.
6. Python — те саме, маніфест `pyproject.toml`.

### Тегування (монорепо)

**Тег на пакет: `<name>@<version>`** (`@nitra/cursor@1.31.0`, `foo@1.2.3`) — як у changesets/Beachball/Lerna-independent. Узгоджено з незалежним per-workspace версіонуванням і **безкоштовно дає базу для fallback**: `git describe --match '<name>@*'` повертає останній реліз конкретного пакета → `release` бере commit-range від цього тегу. Єдиний спільний тег на реліз відкинуто — він не мапиться на версії пакетів і ускладнив би визначення бази commit-range.

Формат CHANGELOG — як у `n-changelog.mdc`: [Keep a Changelog 1.1.0](https://keepachangelog.com/uk/1.1.0/), українська, новіше зверху.

## Правки CI (`npm-publish.yml`)

`release` і `publish` — в **одному** job'і (commit-back через `GITHUB_TOKEN` навмисно не ретригерить workflow, тому розділяти не можна).

```yaml
on:
  push:
    paths:
      - 'npm/**'
      - '**/.changes/**'
    branches: [main]

concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: false # для release не вбивати на льоту (було true)

jobs:
  release-publish:
    permissions:
      contents: write # було read — для commit-back + tag
      id-token: write # лишається для OIDC publish
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: true # було false — щоб GITHUB_TOKEN запушив bump
          fetch-depth: 0 # release читає commit-range для fallback
      - uses: actions/setup-node@v6
        with: { node-version: '24', registry-url: 'https://registry.npmjs.org' }
      - name: Release (bump + CHANGELOG + tag)
        run: npx @nitra/cursor release
      - name: Publish
        uses: JS-DevTools/npm-publish@v4.1.5
        with: { package: npm/package.json }
```

Зміни відносно поточного:

- `permissions.contents`: `read` → `write`.
- `persist-credentials`: `false` → `true`.
- `+ fetch-depth: 0`.
- `+ paths: '**/.changes/**'`.
- `concurrency.cancel-in-progress`: `true` → `false`.
- новий крок `Release` перед `Publish`.

## Правки правила (`n-changelog.mdc` v2.6 → v3.0)

Semantics change → major-версія правила.

- STOP-блок крок 1 (ручний `version +1`) — **прибрати** з feature-флоу.
- STOP-блок крок 2 (нова секція CHANGELOG руками) — **замінити** на: «поклади `<ws>/.changes/<unique>.md` з `bump` + `section` + описом».
- крок 3 `check changelog` → **м'який**: warn, якщо для зміненого workspace нема ні change-файлу, ні піднятого `version` (не блокує — CI-fallback підстрахує).
- «Інверсія / релізний крок»: коміт, що **споживає** `.changes/*` і править `version`+CHANGELOG, — це і є release-крок (bump не вимагається).
- Ручний bump лишається дозволеним (legacy/hotfix): `check` приймає **або** change-файл, **або** піднятий `version`.

## Дистрибуція (scope B)

`n-cursor` sync уже копіює composite-action і правила в споживчі репо. Додається:

- rule `release` (+ оновлена `check`-семантика) — автоматично через sync;
- **template release-workflow** у `npm/github-actions/` пакета (поряд із `setup-bun-deps`), щоб споживач отримав готовий CI-крок.

> Явний пункт реалізації: поточний `.github/workflows/npm-publish.yml` живе в **цьому** репо, а не в пакеті. Для scope B його треба винести як template у `npm/github-actions/`, інакше споживачі release-крок не отримають.

## Компоненти й межі

| Компонент                               | Що робить                                                                   | Залежить від                                            |
| --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| `npm/rules/release/lib/change-file.mjs` | парс/запис/валідація `.changes/*.md` (frontmatter `bump`/`section`)         | —                                                       |
| `npm/rules/release/lib/aggregate.mjs`   | по workspace: зчитати change-файли → обчислити `version` + секцію CHANGELOG | `change-file.mjs`, `changelog/lib/package-manifest.mjs` |
| `npm/rules/release/lib/fallback.mjs`    | синтез generic-запису з commit-range, коли change-файлів нема               | git                                                     |
| `n-cursor change` (bin)                 | інтерактив/прапорці → `change-file.mjs` запис                               | `change-file.mjs`, детекція workspace                   |
| `n-cursor release` (bin)                | оркестрація: aggregate → write → commit → tag → cleanup                     | `aggregate.mjs`, `fallback.mjs`, git                    |
| `check changelog` (існує)               | м'яка перевірка наявності change-файлу/bump                                 | `change-file.mjs`                                       |

## Тестування

- `change-file.mjs`: парс валідного/невалідного frontmatter, генерація унікального імені, round-trip.
- `aggregate.mjs`: `max(bump)`; групування по `section`; коректна вставка секції зверху; видалення оброблених файлів; npm **і** Python маніфести; кілька change-файлів в один workspace; нуль change-файлів (no-op).
- `fallback.mjs`: синтез запису з commit-range; warning коли change-файлів нема.
- `check`: warn (не fail) коли нема ні файлу, ні bump; pass коли є будь-що з двох.
- Сумісність із наявними тестами `changelog/js/tests/*`.

## Поза скоупом (YAGNI)

- Dependent-bump graph (авто-bump залежних пакетів при зміні залежності) — не робимо в першій ітерації.
- Prerelease/canary-канали.
- Інтерактивний `change` із fuzzy-вибором пакета (поки що: workspace визначається за CWD/прапорцем).
- Міграція історичних CHANGELOG.

## Узгоджені рішення (раніше відкриті)

- **Ім'я change-файлу:** `<timestamp>-<short-rand>.md`.
- **Тегування:** per-package `<name>@<version>` (Варіант 1).
- **`npm-publish.yml` як template:** виносимо в `npm/github-actions/` **у цій же ітерації** (частина scope).

## Відкриті питання

Немає — усі рішення зафіксовано.
