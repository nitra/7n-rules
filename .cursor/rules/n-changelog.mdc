---
description: CHANGELOG.md в кожному workspace, з двома моделями бази порівняння (npm і Python)
version: '3.4'
alwaysApply: true
---

У кожному **пакетному** workspace (каталог із `package.json` або `pyproject.toml`) має бути власний **`CHANGELOG.md`**. Спільного на репозиторій змісту змін **не існує** — кожен пакет веде свій. Маніфест версії: **JS/Bun/npm** — `package.json` (`version`); **Python** — `pyproject.toml` (`[project].version` або `[tool.poetry].version`).

## Дві моделі бази порівняння

Режим визначається автоматично з маніфесту.

### registry-published (npm / PyPI)

**npm:** непорожнє `name`, не `private: true`, масив `files`.

**Python:** статичні `project.name` і `project.version` у `pyproject.toml` (або Poetry-секція).

1. **Локальна `version` ≠ опублікованій** (npm / PyPI): drift поза CI → **fail** (ручний bump заборонено; навіть із change-файлом). Відкоти `version`.
2. **Версії збігаються**, але в git є **релевантні** зміни без change-файлу → fail. Для npm `"CHANGELOG.md"` має бути в `files` (публікується разом із пакетом).
3. **Реєстр недосяжний** — fail-safe pass.
4. **Немає релевантних змін** — pass.

### local-only

**npm:** `private: true` або без `files`. **Python:** без пари name+version для реєстру. База залежить від гілки:

1. На **`dev`** local-only не активний (крім незакомічених registry-published).
2. На **`main`** — diff від **`origin/main`** (попередній опублікований `main`); без remote — від `HEAD~1`. **`dev` не використовується** як база на `main`.
3. На **feature-гілці** — merge-base з **`dev`**, якщо є; інакше з **`main`** (репо без `dev`). За наявності `origin/*` беремо новішу з двох баз (локальна гілка-кандидат vs `origin/`-версія) — застарілий локальний `main`/`dev` не має перекривати вже інтегровану в origin історію, і навпаки.
4. Drift `version` від бази → **fail** (ручний bump заборонено). Зміни фіксуй change-файлом; bump зробить CI.

Якщо немає git або немає `dev`/`main`/`origin/main` — local-only пропускається.

Merge-коміт (готовий, з другим предком, або `MERGE_HEAD` під час незавершеного `git commit`) пропускається цілком — changeset документують feature-коміти, а не інтеграційний merge.

## Чеклист агента (деталі)

Основний робочий алгоритм — «перед фінальною відповіддю виконай `npx @7n/rules lint changelog`, познач результат рядком `Changelog: …`» (AGENTS.md/AGENTS.template.md); тут лише уточнення, що саме перевіряється.

**Інверсія (за замовчуванням не вимагають change-файлу):**

- зміни **лише** під `docs/` або `doc/`;
- синхронізований із `@7n/rules` інструментарій під `.cursor/` (канонічні правила й скіли) і `.claude/` (ADR-хуки) — це дзеркало tooling-пакета, а не логіка воркспейсу;
- будь-які зміни в **корені монорепо** (воркспейс `.` за наявності підпакетів) — корінь веде glue/конфіг/tooling, власного CHANGELOG не має; помітні зміни документують підпакети. Сюди потрапляють і кореневі `AGENTS.md` / `CLAUDE.md`, і bump `@7n/rules` у `devDependencies`;
- файли під **`.gitignore`**.

**Вимагають change-файл** — усі інші зміни в каталозі workspace (код, rego, правила, скіли, конфіги, тести тощо). Виняток `.cursor/` / `.claude/` **не** поширюється на джерело правил у репо `@7n/rules` — воно лежить під `npm/`, тож зміни в ньому далі вимагають change-файлу.

Ніколи не редагуй `version` і `CHANGELOG.md` вручну — навіть для hotfix; єдиний артефакт зміни — change-файл (`npx @7n/n ch [--bump <major|minor|patch>] [--section <Added|Changed|Fixed|Removed>] [--message "<…>"]`), bump/секцію CHANGELOG формує `n-rules release` у CI на `main`.

Канонічне pre-commit wiring (крок `npm-changelog` у `hk.pkl`, autofix через `N_RULES_CHANGELOG_AUTOFIX=1`) — деталь `npm-module.mdc`, тут не дублюється.

Перевірка програмна (`changelog/consistency/main.mjs`, delta-гейт присутності — `changelog/presence/main.mjs`).

## Формат CHANGELOG.md

[Keep a Changelog 1.1.0](https://keepachangelog.com/uk/1.1.0/), мова — українська, новіші версії зверху.

```md title="<ws>/CHANGELOG.md"
# Changelog

Усі помітні зміни цього пакета документуються тут.

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), нумерація — [SemVer](https://semver.org/lang/uk/).

## [1.2.3] - 2026-05-05

### Added

- ...

### Changed

- ...

### Fixed

- ...
```

Секції — підмножина `### Added`, `### Changed`, `### Fixed`, `### Removed` (одна або кілька).

Механічно `main.mjs` (`checkChangelogFormat`) перевіряє лише наявність рядка `# Changelog` (H1). Точна лексика секцій і порядок версій (новіші зверху) — конвенція, яку check **не** валідує: наявні `CHANGELOG.md` у цьому репо містять і нестандартні секції (`### BREAKING`, `### Notes`, `### TODO` тощо) з історичних причин, тож строга валідація словника секцій зробила б check несумісним із власною практикою репо. Дотримання — на розсуд автора change-файлу.

## Post-release інваріант (гарантує CI)

Перша (верхня) секція `## [version]` у `CHANGELOG.md` дорівнює полю `version` у маніфесті — але це **post-release** твердження, яке забезпечує `n-rules release` у CI, агрегуючи change-файли (bump `version` + генерація секції + git-тег `<name>@<version>`). **Локально цю рівність руками не підтримують**: у feature-флоу `version`/`CHANGELOG.md` не чіпають, тож верхня секція може відставати від майбутньої версії — це нормально. Drift `version` поза CI (vs реєстр / vs git-база) ловить цей concern (`consistency`) як заборонений ручний bump.

Інструкції щодо bump `version` і редагування `CHANGELOG.md` живуть **лише** в правилі `changelog` (деталізація моделі порівняння — `comparison-models.mdc` поряд) — джерелі істини. Інші правила (зокрема `npm-module`) їй підпорядковані щодо формату/моделі й власних інструкцій bump/CHANGELOG не дублюють; команду створення change-файлу (`npx @7n/n ch`) й заборону ручного bump вони лише повторюють як нагадування.
