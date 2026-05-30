---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-29T21:17:59+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

## ADR Вибір власного генератора `n-cursor release` замість `@changesets/cli` або Beachball

## Context and Problem Statement
Паралельні агенти/розробники, що працюють у різних worktree, вручну бампили `version` у `package.json` і дописували секцію до `CHANGELOG.md`. Обидва файли редагуються в одному місці → гарантований git-конфлікт при merge до `main`.

## Considered Options
* `@changesets/cli` — change-файли у `.changeset/<random>.md`, JS-only
* Beachball (Microsoft) — JSON change-файли, `beachball check` + `beachball publish`, JS-only
* Власний генератор у `n-cursor` — power over format, підтримка npm і Python

## Decision Outcome
Chosen option: "Власний генератор у `n-cursor`", because `@changesets/cli` і Beachball підтримують **лише JS/npm**-workspace, тоді як `n-changelog.mdc` v2.6 явно веде і `pyproject.toml`-пакети; крім того, `npm/rules/changelog/lib/package-manifest.mjs` вже детектує обидва типи workspace, а власний рендерер дає рідний Keep-a-Changelog формат із категоріями `### Added/Changed/Fixed/Removed` і україномовними заголовками без кастомного плагіна.

### Consequences
* Good, because transcript фіксує очікувану користь: нуль зміни `CHANGELOG.md`/`version` у feature-гілках → конфлікти при merge worktree зникають в корені.
* Bad, because transcript не містить підтверджених негативних наслідків; очевидний trade-off — обсяг написаного коду більший, ніж при використанні off-the-shelf інструменту.

## More Information
Ключові файли: `npm/rules/changelog/lib/package-manifest.mjs`, `npm/rules/changelog/js/consistency.mjs`, `npm/bin/n-cursor.js` (switch-dispatch `command`). Spec: `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`. План: `docs/superpowers/plans/2026-05-29-n-cursor-release.md`.

---

## ADR Формат і розміщення change-файлів: per-workspace `.changes/<timestamp>-<rand>.md`

## Context and Problem Statement
Потрібна схема, при якій два паралельних агенти у різних worktree можуть зафіксувати зміну одного й того самого workspace без конфлікту файлів, і при цьому зберегти як semver-тип bump, так і Keep-a-Changelog категорію (`### Added/Changed/Fixed/Removed`).

## Considered Options
* Один кореневий `.changes/` з полем `packageName` у файлі (модель changesets/Beachball)
* Per-workspace `.changes/<timestamp>-<rand>.md` без поля `packageName`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Per-workspace `.changes/<timestamp>-<rand>.md`", because локація файлу == таргет-workspace (агент у `packages/foo` кладе файл туди — нуль шансів промахнутись пакетом); timestamp-суфікс із коротким random-рядком гарантує унікальність навіть при паралельних агентах у той самий ms; frontmatter зберігає **два** ортогональних поля — `bump: patch|minor|major` і `section: Added|Changed|Fixed|Removed` — чого off-the-shelf інструменти не дають без кастомного рендерера.

### Consequences
* Good, because transcript фіксує очікувану користь: два агенти = два різні файли → 0 конфліктів by design; детекція workspace перевикористовує наявний `package-manifest.mjs`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Приклад шляху: `packages/foo/.changes/1748518800000-a3f2.md`. `release` читає всі `<ws>/.changes/*.md`, бере `max(bump)` і групує записи за `section`. Python-workspace — та сама схема з `pyproject.toml`.

---

## ADR Реліз виключно в CI на `main` із гібридним авторством change-файлів

## Context and Problem Statement
Worktree-агенти виконують незалежні фічі; потрібно вирішити, де і коли запускати агрегацію change-файлів у version-bump + CHANGELOG, і що робити, якщо change-файл для зміненого workspace не написано.

## Considered Options
* Реліз локально при merge worktree (Pattern B)
* Реліз у CI на `main`, агент пише change-файл явно (Pattern A, варіант 1)
* Реліз у CI на `main`, авто-генерація з git-комітів без ручного файлу (Pattern A, варіант 2)
* Реліз у CI на `main`, гібрид: агент пише файл + CI-fallback із комітів (Pattern A, варіант 3)

## Decision Outcome
Chosen option: "Реліз у CI на `main`, гібрид (варіант 3)", because максимальна автоматизація вимагає єдиної серіалізованої точки релізу (CI), а гібрид зберігає якість CHANGELOG (автор знає намір → описовий `comment`) і одночасно гарантує, що реліз не буде порожнім, якщо change-файл забутий.

### Consequences
* Good, because transcript фіксує очікувану користь: конкурентний запис до `version` і `CHANGELOG.md` зникає повністю; `concurrency: cancel-in-progress: false` серіалізує release-коміти.
* Bad, because `npm-publish.yml` потребує `contents: write` (було `read`) і `persist-credentials: true` — розширення permissions, explicit trade-off зафіксований у спеці.

## More Information
Команда: `npx @nitra/cursor release` в job'і `release-publish` перед `JS-DevTools/npm-publish`. `check changelog` змінює семантику на м'яке попередження (warn, не блокер). Файли: `.github/workflows/npm-publish.yml`, `npm/rules/changelog/js/consistency.mjs`. Template для scope B: `npm/github-actions/release-publish/action.yml`.

---

## ADR Per-package git-теги у форматі `<name>@<version>`

## Context and Problem Statement
Монорепо з незалежним версіонуванням по workspace: один CI-прогін може підняти кілька пакетів одночасно. Потрібна стратегія тегування, яка мапиться на конкретні (пакет, версія) та дає базу для fallback-синтезу записів із git-комітів.

## Considered Options
* Per-package теги `<name>@<version>` (канон changesets/Beachball)
* Один тег на CI-прогін: `release-<timestamp>` або `v<date>`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Per-package теги `<name>@<version>`", because лише per-package теги дають `git describe --match 'foo@*'` → commit-range для fallback-синтезу запису з комітів; єдиний тег на прогін не відображає незалежного версіонування workspace і ускладнює fallback без додаткового механізму.

### Consequences
* Good, because transcript фіксує очікувану користь: тег = (пакет, версія) → пряма відповідність моделі незалежного версіонування; fallback отримує базу безкоштовно.
* Bad, because scoped-ім'я `@nitra/cursor@1.31.0` створює вкладений ref `refs/tags/nitra/cursor@1.31.0`; transcript зазначає, що це працює (changesets робить так само), але є tag noise при одночасному релізі кількох пакетів.

## More Information
Команда в `release`: `git tag <name>@<version> && git push origin <name>@<version>`. Fallback: `git log <name>@<prev>..HEAD -- <ws-path>`.
