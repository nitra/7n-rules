# n-cursor release: bootstrap no-op fallback та CI local runner

**Status:** Accepted
**Date:** 2026-05-30

## Context and Problem Statement

Після першої реалізації `n-cursor release` виявлено два дефекти: (1) fallback-синтез без baseline-тегу брав усю git-історію і генерував зайвий bump поверх вже виставленої вручну версії; (2) CI-job запускав `npx @nitra/cursor release`, що давало помилку `n-cursor: not found` — chicken-and-egg для self-publishing репо, де нова версія пакета ще не опублікована в реєстрі.

## Considered Options

**Fallback при відсутності baseline-тегу:**
* Bootstrap no-op: `synthesizeChangeFromCommits` повертає `null` якщо немає попереднього тегу `<name>@*`
* Синтез з повної git-історії (`range = 'HEAD'`) — попередня реалізація

**CI runner:**
* `node npm/bin/n-cursor.js release` після `setup-bun-deps` — локальний runner
* `npx @nitra/cursor release` — тягне з npm-реєстру

## Decision Outcome

Chosen option (fallback): "Bootstrap no-op", because без попереднього тегу немає надійної бази для delta-синтезу; синтез від початку репо генерував подвійний bump у перехідний період (ручна версія + згенерована зверху).

Chosen option (CI runner): "`node npm/bin/n-cursor.js release` після `setup-bun-deps`", because self-publishing репо не може надійно використовувати власний пакет із реєстру при релізі нової версії; локальний runner завжди бере актуальний код із HEAD, а `bun install` забезпечує доступність залежностей (`smol-toml` тощо).

### Consequences

* Good, because перший CI-запуск після ручного `@nitra/cursor@1.33.0` — no-op, не створює `1.33.1` без change-файлів.
* Good, because помилку `n-cursor: not found` усунено; git identity задана явно для `release-commit`.
* Bad, because на абсолютно новому репо без жодного тегу `n-cursor release` нічого не зробить до першого ручного релізу — це очікувана bootstrap-поведінка.

## More Information

- `npm/rules/release/lib/fallback.mjs` (~рядки 37–39): `if (!lastTag) return null`.
- Тест оновлено: `npm/rules/release/js/tests/fallback.test.mjs` — "без тегу пакета (bootstrap) → null".
- `.github/workflows/npm-publish.yml`: кроки `- uses: ./.github/actions/setup-bun-deps` → git config identity → `node npm/bin/n-cursor.js release`.
- Видалено: `npx @nitra/cursor release`.
- lint-ga exit=0, actionlint+zizmor чисто; 33/33 тести зелені.
- Коміт: `8b74ea1 fix(release): bootstrap no-op fallback + CI workflow deps/identity`.

## Update 2026-05-30

**CI-workflow:** обрано один об'єднаний job `release-publish` замість двох окремих — спрощує передачу стану (bumped version, tag) між кроками та уникає race condition між jobs.

**Scoped-пакети та git-refs:** для `@nitra/cursor` тег стає `@nitra/cursor@1.33.0`, що в git-refs створює `refs/tags/nitra/cursor@1.33.0` — валідний паттерн (аналогічно до `@changesets/cli`), але може дивувати деякі git-клієнти.

**Тригер `**/.changes/**`:** прибрано тимчасово — `check-ga` відхиляє glob без tracked-файлів у репо; варто повернути після появи перших `.changes/`-файлів.

- Rego-policy `ga.workflow_common` примусово встановлює `cancel-in-progress: true`.
- `npm/github-actions/release/action.yml`: composite-template для споживачів scope B.
