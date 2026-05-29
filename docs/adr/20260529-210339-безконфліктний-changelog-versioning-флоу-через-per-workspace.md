---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-29T21:03:39+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

## ADR Безконфліктний changelog/versioning флоу через per-workspace change-файли

## Context and Problem Statement
При паралельній роботі агентів у окремих git worktree кожен учасник вручну бампить `version` у `package.json`/`pyproject.toml` та дописує секцію у `CHANGELOG.md` відповідно до правила `n-changelog.mdc` v2.6. Оскільки обидва редагують ті самі рядки у спільних файлах від спільної бази, git-конфлікт гарантований при merge.

## Considered Options
* Per-workspace change-файли `.changes/<unique>.md` + агрегація в CI
* `merge=union` в `.gitattributes` для `CHANGELOG.md`
* Без змін — ручний bump залишається в feature-флоу

## Decision Outcome
Chosen option: "Per-workspace change-файли `.changes/<unique>.md` + агрегація в CI", because агент або розробник кладе окремий файл у `<ws>/.changes/` з унікальним іменем — два паралельні учасники фізично не торкаються одного рядка, тому конфлікт зникає в корені, а не маскується.

### Consequences
* Good, because transcript фіксує очікувану користь: нуль git-конфліктів у `CHANGELOG.md` і `package.json` при паралельній роботі worktree-агентів.
* Bad, because `merge=union` було відхилено як рішення, що прибирає симптом, а не причину, і не лікує конфлікти `version` у `package.json`.

## More Information
Файли: `npm/rules/changelog/js/consistency.mjs`, `npm/lib/workspace-helper.mjs`, `npm/lib/package-manifest.mjs`. Формат change-файлу: YAML-frontmatter із полями `bump: patch|minor|major` і `section: Added|Changed|Fixed|Removed`, тіло — текст bullet-а. Ім'я файлу — унікальний хеш контенту або id worktree-гілки. Спека: `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`.

---

## ADR Власна реалізація `n-cursor change`/`release` замість @changesets/cli або Beachball

## Context and Problem Statement
Потрібен інструмент для управління change-файлами та генерації версій/CHANGELOG у bun-монорепо `@nitra/cursor`, яке охоплює як npm, так і Python workspace, і веде CHANGELOG у специфічному форматі Keep-a-Changelog (українська, категорії `### Added/Changed/Fixed/Removed`).

## Considered Options
* Власна реалізація у `@nitra/cursor` (`n-cursor change` + `n-cursor release`)
* `@changesets/cli`
* Beachball (Microsoft)

## Decision Outcome
Chosen option: "Власна реалізація у `@nitra/cursor`", because `@changesets/cli` і Beachball підтримують лише JS/npm (Python workspace випадають), а їхня модель типів (`patch/minor/major` без Keep-a-Changelog категорій) несумісна з наявним форматом CHANGELOG. Код детекції workspace і маніфестів (`workspace-helper.mjs`, `package-manifest.mjs`) вже існує в пакеті і переюзається безпосередньо.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина реалізація для npm і Python, рідний формат CHANGELOG без кастомного renderer-плагіна, нуль зовнішніх залежностей у споживача.
* Bad, because transcript фіксує: більше коду писати самостійно порівняно з готовим інструментом.

## More Information
Beachball розглядався окремо: підтримує `beachball check` і `beachball publish`, але JS-only і тип зміни = semver-bump без Keep-a-Changelog категорій. `@changesets/cli` аналогічно JS-only. Файли для реалізації: `npm/lib/change-parser.mjs`, `npm/lib/changelog-writer.mjs`, `npm/lib/version-bumper.mjs`, `npm/lib/fallback-generator.mjs`, `npm/lib/run-change.mjs`, `npm/lib/run-release.mjs`. План: `docs/superpowers/plans/2026-05-29-n-cursor-release-plan.md`.

---

## ADR Реліз виключно через CI на `main` (Pattern A)

## Context and Problem Statement
Після переходу на change-файли потрібно визначити єдину точку агрегації `.changes/*.md` і виконання bump+CHANGELOG+publish. Альтернативи — локальний крок при мерджі worktree або окремий «Release PR» бот.

## Considered Options
* CI на `main` — `n-cursor release` як крок у `npm-publish.yml` (Pattern A)
* Release PR (бот накопичує change-файли, людина мерджить release-PR)
* Локальний крок при злитті worktree (Pattern B)

## Decision Outcome
Chosen option: "CI на `main` (Pattern A)", because це максимальна автоматизація: worktree-агенти лише накопичують `.changes/*.md` без будь-якого локального релізного кроку; CI серіалізує bump + CHANGELOG + commit-back + tag + publish в одному job, і commit через `GITHUB_TOKEN` не ретригерить workflow (loop-guard).

### Consequences
* Good, because transcript фіксує очікувану користь: повністю hands-off флоу для агентів; `release` і `publish` в одному job — bump і публікація не розходяться при race condition.
* Bad, because `permissions: contents` потрібно змінити з `read` на `write`, `persist-credentials: true` і `cancel-in-progress: false` у `concurrency` block (реліз не можна переривати на льоту).

## More Information
Файл: `.github/workflows/npm-publish.yml`. Ключові зміни: `on.push.paths` додати `'**/.changes/**'`; `permissions.contents: write`; `checkout` з `persist-credentials: true, fetch-depth: 0`; крок `npx @nitra/cursor release` перед `JS-DevTools/npm-publish@v4.1.5`. Template для scope B: `npm/github-actions/release-publish/action.yml`.

---

## ADR Гібридне авторство change-файлів (варіант 3)

## Context and Problem Statement
При CI-only релізі потрібно визначити, хто створює `.changes/*.md`: агент/розробник явно, CI автоматично з git-комітів, або гібрид — щоб не втрачати осмислену категоризацію CHANGELOG і водночас гарантувати, що реліз не буде порожнім через забутий change-файл.

## Considered Options
* Варіант 1: агент/розробник завжди пише change-файл явно (блокуючий `check`)
* Варіант 2: CI повністю автогенерує з Conventional Commits (агент нічого не пише)
* Варіант 3: агент пише change-файл, CI має fallback-синтез із комітів якщо файлу нема

## Decision Outcome
Chosen option: "Варіант 3 — гібрид", because «максимально автоматизовано» не має означати «втратити сенс CHANGELOG»: агент і так знає свій намір і пише один маленький файл (нуль конфліктів), а CI-fallback гарантує, що навіть забутий change-файл не зламає реліз.

### Consequences
* Good, because transcript фіксує очікувану користь: `check changelog` стає м'яким (warn, не блокер), ручний bump лишається дозволеним (legacy/hotfix), реліз ніколи не пропускає workspace мовчки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`n-cursor check changelog` v3.0: приймає **або** наявний `.changes/*.md`, **або** піднятий `version` у маніфесті; відсутність обох — warn, exit code 0. Fallback-реалізація: `npm/lib/fallback-generator.mjs` — `git log <fromRef>..<toRef> -- <wsDir>`, евристика `feat:` → `Added`, `fix:` → `Fixed`, решта → `Changed`, `bump` завжди `patch`. Файл: `npm/rules/changelog/js/consistency.mjs` (оновлення логіки check).
