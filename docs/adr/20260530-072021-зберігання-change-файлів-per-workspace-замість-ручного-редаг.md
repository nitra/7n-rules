---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-30T07:20:21+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

Ось транскрипт у вигляді MADR-документу:

## ADR Зберігання change-файлів per-workspace замість ручного редагування CHANGELOG

## Context and Problem Statement
У монорепо з незалежним версіонуванням кожного workspace агенти в ізольованих git-worktrees конкурентно редагували CHANGELOG і `package.json` безпосередньо, що породжувало merge-конфлікти при злитті feature-гілок у `main`. Потрібен підхід, де кожна гілка залишає тільки «свій» artifact без перетину з іншими гілками.

## Considered Options
* **Явний change-файл (агент/людина):** кожен PR кладе `.changes/<unique>.md` з `bump` і `section`.
* **Авто-генерація з Conventional Commits у CI:** ніякого ручного artifact; `release` виводить bump/опис із комітів.
* **Гібрид:** агент пише change-файл, CI-fallback синтезує generic-запис із комітів для workspace без change-файлу.

## Decision Outcome
Chosen option: "Гібрид (варіант 3)", because агент і так знає свій намір і дешево кладе маленький файл (нуль конфліктів завдяки унікальному імені), а CI-fallback гарантує, що реліз ніколи не буде порожнім навіть якщо файл забуто; «максимальна автоматизація» не має означати «втрату сенсу CHANGELOG».

### Consequences
* Good, because change-файли per-workspace (`<ws>/.changes/<timestamp>-<rand>.md`) фізично не перетинаються між worktree, тому merge-конфлікти в CHANGELOG/`package.json` зникають у корені.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Формат change-файлу — YAML frontmatter з двома полями `bump: patch|minor|major` та `section: Added|Changed|Fixed|Removed`; тіло — опис зміни.
Ключові файли реалізації: `npm/rules/release/lib/change-file.mjs`, `npm/rules/release/lib/aggregate.mjs`, `npm/rules/release/lib/fallback.mjs`, `npm/rules/release/change.mjs`, `npm/rules/release/release.mjs`.
Підкоманди CLI: `n-cursor change` (записує файл), `n-cursor release` (агрегує, бампить, комітить, тегує).

---

## ADR Per-package git-теги `<name>@<version>` для монорепо

## Context and Problem Statement
`n-cursor release` за один CI-прогін може бампити кілька незалежних workspace. Необхідно визначити схему git-тегів, яка відображає версії конкретних пакетів і служить базою для fallback-синтезу CHANGELOG із commit-range.

## Considered Options
* **Per-package тег `<name>@<version>`** (наприклад `@nitra/cursor@1.33.0`).
* **Один тег на CI-прогін** (`release-<timestamp>` або `v2026.05.29`).

## Decision Outcome
Chosen option: "Per-package тег `<name>@<version>`", because це канон незалежного версіонування (changesets, Beachball, Lerna independent mode); тег `<name>@<version>` дає надійну базу для `git describe --match '<name>@*'` при fallback-синтезі — без нього визначити commit-range для конкретного пакета стає окремою складною задачею. Один тег на прогін семантично слабкий у репо без спільної версії.

### Consequences
* Good, because `git describe` дає точну базу commit-range на пакет — fallback може синтезувати CHANGELOG-запис із комітів між двома тегами без зайвої евристики.
* Bad, because у монорепо з багатьма пакетами може накопичуватися багато тегів (tag noise); scoped-імена (`@scope/name@version`) утворюють `refs/tags/scope/...` — це валідно, але нестандартно для деяких git-клієнтів.

## More Information
Реалізовано в `npm/rules/release/release.mjs` (`runGit(['tag', ...])`). Аналог — changesets, Beachball. Ухвалено в секції «Відкриті питання» дизайн-спеки `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`.

---

## ADR Унікальне ім'я change-файлу: `<timestamp>-<short-rand>.md`

## Context and Problem Statement
Кілька агентів у паралельних git-worktrees можуть писати change-файли одночасно (це типовий сценарій). Потрібна схема іменування, яка унеможливлює колізії навіть при записі в ту саму мілісекунду.

## Considered Options
* **Лише timestamp** (наприклад `1748521234567.md`).
* **`<timestamp>-<short-rand>.md`** (timestamp для читабельного сортування + короткий random-суфікс проти колізій).
* **Хеш контенту або id worktree-гілки.**

## Decision Outcome
Chosen option: "`<timestamp>-<short-rand>.md`", because два паралельні агенти можуть записувати файл в одну мілісекунду, тому чистий timestamp не гарантує унікальність; суфікс усуває цю edge-case без додаткових залежностей і зберігає хронологічне сортування.

### Consequences
* Good, because файли сортуються природно за часом і фізично не колізять при паралельній роботі агентів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано у `npm/rules/release/lib/change-file.mjs` (функція `newChangeFileName`). Рішення ухвалено явно під час brainstorming-сесії після відхилення варіанта «лише timestamp».

---

## ADR Release-крок у CI на `main` (а не локально)

## Context and Problem Statement
Потрібно визначити, де виконується `n-cursor release` — локально перед merge або автоматично в CI після merge у `main`. Локальний реліз у feature-гілках вимагає bump CHANGELOG/version у самій гілці, що стає джерелом merge-конфліктів між паралельними worktrees.

## Considered Options
* **Release у CI після merge у `main`** (варіант A): worktrees накопичують тільки `.changes/*.md`, без торкання CHANGELOG/version.
* **Release локально** у feature-гілці перед merge.

## Decision Outcome
Chosen option: "Release у CI після merge у `main` (варіант A)", because тільки так worktrees повністю уникають змін у CHANGELOG/version — це усуває конфлікти в корені; CI-запуск серіалізовано через `concurrency.group`, тому паралельних release-прогонів нема.

### Consequences
* Good, because feature-гілки містять виключно `.changes/*.md` — merge без конфліктів у CHANGELOG/`package.json` навіть у монорепо з десятками паралельних PR.
* Bad, because між merge у `main` і фактичним bump/publish є затримка (один CI-прогін); якщо CI скасує release-job, треба ретригер або ручне втручання.

## More Information
Реалізовано в `.github/workflows/npm-publish.yml` — крок `npx @nitra/cursor release` перед кроком `JS-DevTools/npm-publish`. Composite-template для споживачів scope B: `npm/github-actions/release/action.yml`. CI-девіації зафіксовано в транскрипті: `cancel-in-progress` залишився `true` (rego `ga.workflow_common` вимагає); тригер `**/.changes/**` прибрано (chicken-and-egg із `check-ga` до появи перших `.changes/`-файлів у репо).
