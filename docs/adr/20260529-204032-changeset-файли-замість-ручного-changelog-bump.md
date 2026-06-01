# Changeset-файли замість ручного bump версії: власний генератор у `n-cursor`

**Status:** Accepted
**Date:** 2026-05-29

## Context and Problem Statement

У bun-монорепо `@nitra/cursor` кожен PR зобов'язаний вручну підняти `version` у `package.json` і дописати секцію в `CHANGELOG.md`. Якщо два розробники (або субагенти у різних worktree) виконують цей крок одночасно від однієї бази `main` — гарантований git-конфлікт у цих двох файлах, оскільки обидва редагують ті самі рядки.

## Considered Options

- Власний мінімальний флоу «всередині n-cursor» — нові subcommands `n-cursor change` / `n-cursor release`, файли `<workspace>/.changes/*.md`
- `@changesets/cli` з коробки
- Conventional Commits + `release-please`

## Decision Outcome

Chosen option: "Власний мінімальний флоу «всередині n-cursor»", because він не тягне нових npm-залежностей, узгоджується з поточним стилем CLI (`n-cursor fix`, `n-cursor check`), і при переході до споживачів пакету — команда вже «всередині інструменту». `@changesets/cli` вимагає конфігурації і дублює наявний publish-крок; `release-please` вимагає зміни workflow команди (Conventional Commits) і найбільшого setup.

### Consequences

- Good, because конфлікт у `package.json` і `CHANGELOG.md` зникає by design — два розробники пишуть різні файли у `<workspace>/.changes/`.
- Good, because нові команди `n-cursor change` та `n-cursor release` природньо вписуються в наявний CLI (`n-cursor fix`, `n-cursor check`).
- Bad, because `parseChangelog.mjs` потребує розширення для режиму запису (зараз лише читає); перехідний період вимагає одночасної міграції всієї команди.

## More Information

**Формат change-файлу** (`<workspace>/.changes/<timestamp>-<branch-slug>.md`): рядок 1 — `patch` | `minor` | `major` | `none`; рядки 2+ — рядки опису (кожен непорожній рядок — окремий пункт у CHANGELOG). Правило злиття рівнів: `major` > `minor` > `patch` — береться максимум при кількох файлах. Ім'я файлу `<timestamp>-<branch-slug>.md` гарантує унікальність між worktree-агентами.

**CI-патерн (Патерн A — у наявному `npm-publish.yml`)**: мінімальна зміна — `permissions.contents: write` і два нових кроки перед publish: `npx @nitra/cursor release` та `git add npm/package.json npm/CHANGELOG.md .changes/ && git commit -m "chore: release [skip ci]" && git push`. `GITHUB_TOKEN`-коміти не тригерять workflow повторно. Коли `.changes/<ws>/` порожній — `git diff --cached --quiet` = true → коміт і publish не відбуваються.

Специфікація: `docs/superpowers/specs/2026-05-29-changesets-migration.md`. Нові файли: `npm/scripts/release.mjs`, `.changes/npm/`, `.changes/rego/`. Зміни: `npm/rules/changelog/js/consistency.mjs`, `.cursor/rules/n-changelog.mdc`, `.github/workflows/npm-publish.yml`.

## Update 2026-05-29

Під час дизайн-сесії розглядалися три рівні рішень перед вибором changeset-підходу:

- **Рівень 1 — `merge=union` у `.gitattributes`**: git автоматично склеює нові секції CHANGELOG, але не вирішує конфлікт `version` у `package.json`. Відхилено як недостатній.
- **Рівень 2 — заборонити bump у feature-гілках**: усуває конфлікт `package.json`, але `CHANGELOG.md` лишається спільним файлом і вузьким місцем. Відхилено як частковий.
- **Рівень 3 — changeset-файли (обраний)**: два розробники пишуть різні файли у `<workspace>/.changes/` → конфліктів немає by design.

## Update 2026-05-29

### Гібридне авторство change-файлів і backward-compat у `check changelog`

Агент явно пише `.changes/<unique>.md`; CI має fallback-синтез із комітів якщо файлу нема.

`check changelog` (soft-warning, exit code 0): приймає **або** наявний `.changes/*.md` із відповідним `workspace:`, **або** підняту версію у маніфесті (backward-compat для legacy/hotfix). Відсутність обох — warn, не блокер.

Fallback-логіка в `n-cursor release`: `git log <fromRef>..<toRef> -- <wsDir> --oneline`, евристика `feat:` → `Added`, `fix:` → `Fixed`, решта → `Changed`; тип bump завжди `patch`.
Файл fallback: `npm/lib/fallback-generator.mjs`.

Ручний bump лишається дозволеним (legacy/hotfix): `check` приймає підняту версію як достатню умову.

## Update 2026-05-29

**CI composite action `release-publish`:** `npm/github-actions/release-publish/action.yml` розповсюджується через sync. Споживач підключає `uses: ./npm/github-actions/release-publish` і отримує bump + CHANGELOG + tag + publish. `npm-publish.yml` потребує `permissions.contents: write`, `fetch-depth: 0`, `cancel-in-progress: false`, тригер `**/.changes/**`. Реліз комітить bump у `main` через `GITHUB_TOKEN` — не ретригерить workflow.

**CI-only реліз:** `n-cursor release` лише в CI на `main`; серіалізація через `concurrency`. Bad: bump і publish в одному job — окремими workflow не розбити без PAT/Deploy Key.

**Гібридне авторство:** агент/людина пише change-файл явно (`n-cursor change`); CI має fallback-синтез з комітів (`npm/rules/release/lib/fallback.mjs`). `check changelog` — м'яке попередження, не блокер.

**Формат імені:** `<13-digit-timestamp>-<6-char-rand>.md`. Neutral: тести мають мокати час або порівнювати за вмістом, а не іменем.

Файли: `lib/change-file.mjs`, `lib/aggregate.mjs`, `lib/fallback.mjs`, `release/change.mjs`, `release/release.mjs`. Spec: `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`.

## Update 2026-05-29

**Per-workspace placement (Bad):** зміна, що зачіпає кілька workspace, вимагає кілька окремих change-файлів. Корінь монорепо change-файлів не має. Реалізація: `lib/workspace-reader.mjs` + `lib/change-file.mjs`.

**Scoped-name git tags:** для `@scope/name` тег містить слеш → `refs/tags/scope/name@version`; стандартна поведінка changesets, але деякі CI-інструменти потребують налаштування.

## Update 2026-05-30

Перший реальний перехід `npm/`-workspace на change-file workflow:

Автоматичний коміт зробив ручний bump `npm/package.json#version` (`1.33.0 → 1.33.1`) і додав секцію в `CHANGELOG.md` за legacy-підходом. Правило `n-changelog.mdc v3.0` встановлює change-files канонічним механізмом; legacy-формат допускається лише як hotfix-виняток.

Виконано: `npx @nitra/cursor change --bump patch --section Added --message "..." --ws npm` → `npm/.changes/1780116534790-9f47f9.md`; revert ручного bump (`1.33.1 → 1.33.0`).

Валідація: `npx @nitra/cursor fix changelog` → `✅ npm: @nitra/cursor — нова локальна версія (1.32.0 → 1.33.1)`. Коміт: `5c77b23 refactor(npm): перенесення на change-file workflow`.
