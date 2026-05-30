---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-30T07:12:34+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

PR створено: **https://github.com/nitra/cursor/pull/3**

---

**Підсумок того, що реалізовано:**

| Компонент | Статус |
|---|---|
| `change-file.mjs` — parse/serialize, `<timestamp>-<rand>` ім'я, reader | ✅ |
| `aggregate.mjs` — semver-bump, Keep-a-Changelog рендер | ✅ |
| `n-cursor change` — пише `.changes/*.md` | ✅ |
| `fallback.mjs` — синтез запису з git-комітів | ✅ |
| `n-cursor release` — агрегує → bump → CHANGELOG → тег → push (npm + Python) | ✅ |
| `consistency.mjs` — м'яка перевірка (change-файл = ок) | ✅ |
| `n-changelog.mdc` v3.0 — новий STOP-блок | ✅ |
| CI `npm-publish.yml` + composite template | ✅ |
| Self-release `@nitra/cursor@1.31.0` | ✅ |
| **Тести:** 65/65 pass | ✅ |

Worktree лишається живим — ітерації по PR-фідбеку (якщо будуть) проводь там. Паралельний агент з дослідженням повільності git-тестів — це окрема задача, бриф до нього вище по діалогу.

---
<system-reminder>
Called the Read tool with the following input: {"file_path":"/Users/vitaliytv/www/nitra/cursor/.claude/worktrees/feat+n-cursor-release/.cursor/rules/dev-dep.mdc"}
</system-reminder><system-reminder>
Result of calling the Read tool:
1	---
2	description: >-
3	  JS devDependency placement policy — dev-dep.mdc
4	  Prevent production npm dependencies from landing in devDependencies.
5	alwaysApply: true
6	---
7
8	## 2-правило

This is a long transcript of a session in which the user and an AI agent collaborated on a feature — `n-cursor release` — for the `@nitra/cursor` tool. The AI agent explored the codebase, conducted an interactive brainstorm, wrote a design spec, wrote an implementation plan, implemented 10 tasks using test-driven development, and created a PR.

Please analyze this transcript and produce MADR-style decision records for the non-trivial design decisions made during the session.

---

## ADR Архітектура `n-cursor release`: власний скрипт замість `@changesets/cli` чи Beachball

## Context and Problem Statement
У монорепо `@nitra/cursor` агенти, що працюють у паралельних worktree, редагують спільний `CHANGELOG.md` і вручну бампать версії — це призводить до merge-конфліктів. Потрібне рішення для scope B: будь-який споживач `@nitra/cursor` (включаючи Python-проєкти) отримує автоматизований release-флоу.

## Considered Options
* `@changesets/cli` — зрілий npm-changesets, власний формат та JS-only
* Beachball (Microsoft) — `check`/`publish`/JSON change-файли, JS-only, типи = semver-бампи без Keep-a-Changelog категорій
* Власний скрипт у `@nitra/cursor` — рідна Python+npm підтримка, повний контроль над форматом CHANGELOG

## Decision Outcome
Chosen option: "Власний скрипт у `@nitra/cursor`", because `@changesets/cli` і Beachball підтримують лише JS/npm, тоді як споживачі репо включають Python-workspace (`pyproject.toml`); крім того, обидва не підтримують категоризацію `### Added/Changed/Fixed/Removed` у Keep-a-Changelog форматі без кастомного рендерера, а репо вже має власну інфраструктуру (`package-manifest.mjs`) з підтримкою npm і Python.

### Consequences
* Good, because transcript фіксує очікувану користь: нуль зовнішніх залежностей у кожному споживачі, рідна підтримка Python (`pyproject.toml`) і npm (`package.json`), повний контроль над форматом CHANGELOG.
* Bad, because більше коду доводиться писати і підтримувати власноруч порівняно з off-the-shelf рішенням.

## More Information
Реалізовано в `npm/rules/release/` (нова директорія). Python-підтримка базується на наявному `npm/rules/changelog/lib/package-manifest.mjs`. Beachball детально розглядався: його `check`/`publish`/per-package-тег модель схожа на обрану, але `bump`-типи (`patch/minor/major`) не збігаються з Keep-a-Changelog категоріями (`Added/Changed/Fixed/Removed`).

---

## ADR Per-workspace change-файли замість кореневого `.changes/`

## Context and Problem Statement
Change-файли треба прив'язати до конкретного workspace у монорепо, де кожен пакет веде власний `CHANGELOG.md` і незалежну версію. Питання де зберігати файли: в кореневому `.changes/` зі списком пакетів (як у `@changesets`) чи per-workspace.

## Considered Options
* Кореневий `.changes/` зі списком пакетів (як у `@changesets/cli`)
* Per-workspace `.changes/<unique>.md` у директорії кожного workspace

## Decision Outcome
Chosen option: "Per-workspace `.changes/<unique>.md`", because локація файлу = таргет пакета без явного зазначення назви; лягає на наявну детекцію workspace через `package-manifest.mjs`; відповідає філософії «кожен пакет повністю володіє своїм CHANGELOG + version».

### Consequences
* Good, because агент, що працює у `packages/foo`, кладе файл у `packages/foo/.changes/` без ризику промахнутись пакетом; агрегатор `release.mjs` перебирає workspace через `getMonorepoProjectRootDirs` і читає кожний `<ws>/.changes/` незалежно.
* Bad, because зміна, що зачіпає кілька пакетів, вимагає по одному файлу в кожному відповідному workspace — більше ручних кроків у таких сценаріях.

## More Information
`npm/rules/release/lib/change-file.mjs` — readChangeFiles приймає `wsDir`. Формат файлу: YAML frontmatter `bump: patch|minor|major` + `section: Added|Changed|Fixed|Removed` + тіло-опис.

---

## ADR Схема імені change-файлу: `<timestamp>-<short-rand>.md`

## Context and Problem Statement
Change-файли мають мати унікальні імена, щоб два паралельних агенти у різних worktree не колізували при merge — це головна проблема, яку вирішує весь флоу.

## Considered Options
* Хеш контенту
* `<branch>-<n>` (id worktree-гілки + лічильник)
* `<timestamp>-<short-rand>.md` — timestamp для читабельного порядку, короткий суфікс проти колізій у той самий мілісекунд

## Decision Outcome
Chosen option: "`<timestamp>-<short-rand>.md`", because timestamp дає читабельний хронологічний порядок файлів; короткий рандомний суфікс усуває колізії між двома агентами, що пишуть одночасно.

### Consequences
* Good, because transcript фіксує очікувану користь: нуль merge-конфліктів між паралельними worktree-агентами; файли природно відсортовані за часом створення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано у `npm/rules/release/lib/change-file.mjs` (`newChangeFileName`). Альтернатива «хеш контенту» відкидалась неявно (детерміністична, але два ідентичні описи дали б однакові хеші → колізія).

---

## ADR Авторство change-файлів: гібрид (агент + CI-fallback)

## Context and Problem Statement
Потрібно вирішити, хто відповідає за написання change-файлу: агент/людина явно (1), CI-автоматика з git-diff (2), чи обидва (3).

## Considered Options
* Агент/людина пише явно (`n-cursor change`)
* Авто-генерація з git-комітів у CI
* Гібрид: агент пише change-файл, CI має fallback якщо файлу нема

## Decision Outcome
Chosen option: "Гібрид (агент пише + CI-fallback)", because «максимально автоматизовано» не має означати «втратити сенс CHANGELOG»; агент і так знає свій намір, а CI-fallback гарантує, що навіть забутий change-файл не зламає реліз.

### Consequences
* Good, because transcript фіксує очікувану користь: висока якість описів у CHANGELOG (агент задає намір), але реліз ніколи не переривається через відсутній файл.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Fallback реалізований у `npm/rules/release/lib/fallback.mjs` (`synthesizeChangeFromCommits`): синтезує `{ bump: 'patch', section: 'Changed', description }` з commit-меседжів і логує warning. `release.mjs` викликає fallback якщо `readChangeFiles` повертає порожній масив при наявних релевантних комітах.

---

## ADR Тегування per-package `<name>@<version>` замість єдиного тегу на реліз

## Context and Problem Statement
У монорепо з незалежним версіонуванням один CI-прогін `release` може підняти кілька пакетів. Потрібна схема git-тегування, яка однозначно прив'язує тег до пакета і версії та служить базою для CI-fallback (визначення commit-range «з останнього релізу пакета X»).

## Considered Options
* Тег на пакет: `<name>@<version>` (канон changesets, Beachball, Lerna independent)
* Один тег на реліз: `release-<timestamp>` або `v2026.05.29`

## Decision Outcome
Chosen option: "`<name>@<version>` per-package", because він єдиний узгоджений із незалежним версіонуванням; безкоштовно дає базу для CI-fallback через `git describe --match '<name>@*'`; варіант «один тег» ламає fallback і вимагає окремого механізму визначення commit-range.

### Consequences
* Good, because точність: видно з якого коміту вийшла конкретна версія конкретного пакета; `git describe --match 'foo@*'` дає commit-range для fallback без додаткового механізму.
* Bad, because при великій кількості одночасно бампнутих пакетів може бути багато тегів за один CI-прогін (tag noise).

## More Information
Реалізовано в `npm/rules/release/release.mjs`. Для scoped-імен (`@nitra/cursor`) тег виходить `@nitra/cursor@1.31.0`, що в git-refs створює `refs/tags/nitra/cursor@1.31.0` — відомий, валідний паттерн (так само робить `@changesets/cli`). Перший self-release: `@nitra/cursor@1.31.0`.

---

## ADR Реліз у CI на `main` (не локально)

## Context and Problem Statement
Крок агрегації change-файлів, bump версій, оновлення CHANGELOG, тегування і коміту назад у репо може виконуватись локально (в worktree агента) або в CI після merge у `main`.

## Considered Options
* Реліз у CI на `main` (aggregate → bump → tag → commit-back → publish в одному job)
* Реліз локально (в worktree перед push)
* Гібрид: commit-back локально + publish у CI

## Decision Outcome
Chosen option: "Реліз у CI на `main`", because максимальна автоматизація; повна серіалізація: worktree-агенти лишають лише `.changes/*.md`, а CI розрулює все в єдиній точці без ручного кроку.

### Consequences
* Good, because transcript фіксує очікувану користь: конфлікт версій/CHANGELOG зникає в корені — ніхто локально не бампає і не редагує CHANGELOG; `concurrency` CI серіалізує release-run'и.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано у `.github/workflows/npm-publish.yml`: `n-cursor release` запускається перед кроком `JS-DevTools/npm-publish`. `permissions.contents: write` додано для commit-back і тегування. Для scope B додано composite-action template `npm/github-actions/release/action.yml`.
