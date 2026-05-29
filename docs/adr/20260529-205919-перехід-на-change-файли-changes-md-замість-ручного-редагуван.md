---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-29T20:59:19+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

## ADR Перехід на change-файли `.changes/*.md` замість ручного редагування CHANGELOG і version

## Context and Problem Statement
При роботі з worktree-агентами та паралельними гілками кожна feature-гілка за правилом `n-changelog.mdc` вручну піднімала `version` у `package.json`/`pyproject.toml` і вставляла запис зверху `CHANGELOG.md`. Обидва кроки редагували спільні рядки від однієї бази, що гарантовано давало git-конфлікт на merge.

## Considered Options
* Залишити ручний bump версії + `merge=union` для `CHANGELOG.md` як короткострокове пом'якшення
* Перейти на change-файли (`.changes/<workspace-slug>-<timestamp>-<8-random>.md`) — кожен агент/розробник кладе окремий файл, агрегація відбувається в CI

## Decision Outcome
Chosen option: "change-файли `.changes/*.md`", because кожен агент або гілка генерує файл із унікальним ім'ям — конфлікту не виникає by design, оскільки два виробники ніколи не редагують один рядок. `merge=union` усуває симптом, але не причину (конфлікт `version` у `package.json` він не лікує).

### Consequences
* Good, because transcript фіксує очікувану користь: нуль git-конфліктів при злитті worktree-гілок; крок ручного version bump прибирається з feature-гілок повністю.
* Bad, because transcript не містить підтверджених негативних наслідків; відзначено лише, що розробник/агент зобов'язаний покласти change-файл або отримає fallback-запис з commit-меседжів нижчої якості.

## More Information
Формат файлу: YAML frontmatter (`workspace`, `type: patch|minor|major|none`, `category: Added|Changed|Fixed|Removed|Security`) + тіло-абзац. Реалізація: `npm/rules/release/lib/change-file.mjs`. Правило `n-changelog.mdc` оновлюється: старий крок ручного bump замінюється на виклик `npx @nitra/cursor change --flags`.

---

## ADR Власний скрипт замість @changesets/cli або Beachball

## Context and Problem Statement
Для агрегації change-файлів у bump версії та секцію CHANGELOG розглядалися три варіанти: `@changesets/cli`, Microsoft Beachball і власний генератор у `n-cursor`. Проєкт підтримує JS і Python workspace та має специфічний формат CHANGELOG (українська Keep-a-Changelog з категоріями `### Added/Changed/Fixed`).

## Considered Options
* `@changesets/cli` — зрілий стандарт для JS-монорепо
* Microsoft Beachball — підтримує `check`/`publish`, JSON change-файли, зрілий CI-флоу
* Власний скрипт у `n-cursor` — повний контроль, нуль зовнішніх залежностей

## Decision Outcome
Chosen option: "Власний скрипт у `n-cursor`", because обидва сторонні інструменти не підтримують Python (`pyproject.toml`), а наявний `npm/rules/changelog/lib/package-manifest.mjs` уже вміє читати/писати версії для обох екосистем. Кастомний формат CHANGELOG (Ukrainian Keep-a-Changelog) однаково потребував би окремого рендерер-плагіна для `@changesets/cli` або Beachball.

### Consequences
* Good, because transcript фіксує очікувану користь: однакова підтримка JS і Python без сторонніх залежностей у кожному споживачеві; реліз-логіка версіонується разом із `@nitra/cursor`.
* Bad, because transcript не містить підтверджених негативних наслідків; відзначено, що власний скрипт потребує більше коду для написання.

## More Information
Команди: `n-cursor change` (пише `.changes/*.md`) і `n-cursor release` (агрегує). Логіка агрегації: `npm/rules/release/lib/aggregate.mjs`; CHANGELOG-рендерер: `npm/rules/release/lib/changelog-writer.mjs`; Git-хелпери: `npm/rules/release/lib/git.mjs`. Beachball і `@changesets/cli` навмисно виключені зі scope (зазначено в `docs/superpowers/specs/2026-05-29-changesets-migration.md` у секції «Не в scope»).

---

## ADR n-cursor release запускається тільки в CI на main

## Context and Problem Statement
Потрібно було визначити, де виконується агрегація change-файлів у bump версії + секцію CHANGELOG + git-tag + npm-publish: локально (хук при злитті worktree), у CI на `main`, або в окремому GitHub Actions артефакті (reusable workflow / action).

## Considered Options
* `n-cursor release` локально (при злитті worktree або руками перед push)
* `n-cursor release` як крок у CI на `main` у наявному `npm-publish.yml` (патерн B)
* Окремий GitHub Action `nitra/cursor-release-action` (патерн A)

## Decision Outcome
Chosen option: "`n-cursor release` як крок у CI на `main`", because це максимально автоматизований варіант — розробник/агент не виконує жодного локального релізного кроку; логіка живе в пакеті `@nitra/cursor`, а не в окремому артефакті, тому одна точка публікації та версіонування. Окремий GitHub Action потребував би двох синхронізованих точок випуску.

### Consequences
* Good, because transcript фіксує очікувану користь: серіалізація через наявний `concurrency` у `npm-publish.yml`; `GITHUB_TOKEN`-push не тригерить повторно workflow, тому нема циклу.
* Bad, because `permissions.contents` у `npm-publish.yml` треба підняти з `read` до `write` — ширша поверхня атаки в CI.

## More Information
Зміни в `.github/workflows/npm-publish.yml`: `permissions.contents: write`, `fetch-depth: 0` у `actions/checkout@v4`, новий крок `run: npx @nitra/cursor release` після setup-bun-deps і до `JS-DevTools/npm-publish`. Крок `Release` і `Publish` мають бути в одному job, інакше commit-back не тригерить publish.

---

## ADR Агент викликає n-cursor change, а не пише change-файл напряму

## Context and Problem Statement
Визначено, що агент повинен залишати `.changes/*.md` замість редагування `CHANGELOG.md`. Відкритим лишалося: чи агент пише файл самостійно (довільний інструмент Write), чи через виклик `n-cursor change --flags`.

## Considered Options
* Агент пише файл напряму через Write-інструмент
* Агент викликає `n-cursor change --workspace <w> --type <t> --category <c> --message <m>` (неінтерактивний CLI, патерн C)

## Decision Outcome
Chosen option: "Агент викликає `n-cursor change --flags`", because CLI виконує валідацію полів у точці запису — агент отримує явну помилку при невалідному `type` або `category`. При зміні внутрішнього формату `.changes/*.md` достатньо оновити тільки `n-cursor`, а не кожну інструкцію в правилах; правило `n-changelog.mdc` посилається на команду, а не на формат файлу.

### Consequences
* Good, because transcript фіксує очікувану користь: single source of truth для формату; `n-cursor change` є спільним entry-point для агентів і людей.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізація: `npm/rules/release/change.mjs`, прапорці `--workspace`, `--type`, `--category`, `--message`. Правило `n-changelog.mdc` оновлюється: STOP-блок містить точний виклик `npx @nitra/cursor change --flags` замість опису формату файлу. Spec: `docs/superpowers/specs/2026-05-29-changesets-migration.md`, план: `docs/superpowers/plans/2026-05-29-changesets-migration.md`.
