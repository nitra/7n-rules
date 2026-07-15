---
type: ADR
title: lint-doc delta vs origin та повний CI-набір
description: lint-doc і per-file quick-лінтери працюють по diff від origin, а whole-tree лінтери лишаються повним CI-набором.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

У проєкті впроваджується `lint-doc` — детермінований детектор наявності й актуальності docs-файлів поряд із кодом. Потрібно визначити CI-суворість для `missing` і `crc-mismatch`, дефолтний режим запуску, місце git-diff логіки та межу між per-file і whole-tree лінтерами.

Також поточні quick-лінтери використовували різні бази для визначення changed files: частина рахувала diff проти `HEAD`, тоді як очікувана агентна модель — перевіряти весь diff відносно origin, включно із вже закоміченими змінами в гілці та uncommitted правками.

## Considered Options

- Повний stale-детект у CI: `stale = missing ∪ crc-mismatch`.
- `--missing-only`: CI фейлить лише при відсутній документації.
- Дефолт `lint-doc` = diff vs origin, повний скан = `lint-doc --full`.
- Дефолт `lint-doc` = повний скан, delta = окрема опція.
- `lint-doc --since <ref>` як CLI-режим з git-diff логікою в тестованому CLI.
- Рахувати diff у GitHub Actions YAML і передавати `lint-doc <paths…>`.
- Whole-tree лінтери завжди запускаються у повному режимі.
- Додатковий per-file режим для частини whole-tree лінтерів.
- Уніфікувати всі per-file quick-лінтери на `resolveChangedBase()`.
- Лишити origin-базу лише для standalone `lint-doc`, а агрегатор — на `HEAD`.
- Нове правило у `npm/rules/lint/`.
- Секція в `.cursor/rules/scripts.mdc`.

## Decision Outcome

Chosen option: "повний stale-детект, `lint-doc` delta vs origin за замовчуванням, `--full` для повного скану, `--since <ref>` для явної бази, per-file quick-лінтери на origin, whole-tree лінтери тільки повністю, правило в `npm/rules/lint/`", because `--missing-only` лишає doc drift непоміченим, git-логіка має бути в одному тестованому CLI-місці, агенти мають перевіряти весь diff відносно origin, а whole-tree лінтери на кшталт knip і trufflehog семантично потребують усього дерева.

### Consequences

- Good, because будь-яка зміна джерела без перегенерації документації ловиться CI через `missing` або `crc-mismatch`.
- Good, because локальний агент може запускати голий `lint-doc` і отримувати перевірку лише релевантного diff відносно origin, включно з uncommitted правками.
- Good, because `lint-doc --since <ref>` дає один механізм для локальних агентів, PR CI і push CI без дублювання git-diff логіки в YAML.
- Good, because `quick` per-file лінтери (`doc`, `js-lint`, `style-lint`) отримують спільну модель changed files через `resolveChangedBase()`.
- Good, because `ci` whole-tree лінтери (`knip`/`jscpd`, `trufflehog`, `actionlint`, `conftest`/`regal`, `text`) не отримують некоректної changed-only семантики.
- Bad, because кожна зміна джерела вимагає прогнати `fix-doc` і закомітити оновлену документацію; перед увімкненням CI потрібен зелений baseline через повний `fix-doc`.
- Bad, because аудит можливих per-file оптимізацій для деяких whole-tree механізмів у transcript розпочато, але не завершено.
- Neutral, because автоматичний fallback на `--full` при зміні `docgen-ignore.mjs` явно відхилено; відповідальність за ручний повний аудит після scan-config змін лишається на розробнику.

## More Information

- `lint-doc` без аргументів: delta vs `@{upstream}` або `origin/HEAD`; якщо base не резолвиться — fail-closed fallback на `--full`.
- `lint-doc --full`: повний локальний аудит.
- `lint-doc --since <ref>`: явна база для CI або локального агента; використовує `git diff --name-only --merge-base <base>` проти working tree.
- `lint-doc --git`: stop-gate режим проти `HEAD`.
- PR CI: `lint-doc --since origin/${{ github.base_ref }}`.
- Push CI: `lint-doc --since $LAST_GREEN`, де `$LAST_GREEN` береться через `gh run list --workflow lint-doc.yml --branch "$GITHUB_REF_NAME" --status success --limit 1 --json headSha --jq '.[0].headSha'`.
- Both-direction mapping зберігається: змінене джерело веде до відповідної doc, змінена або видалена doc веде до відповідного source.
- Утиліти: `npm/scripts/lib/changed-files.mjs`, `resolveChangedBase`, `collectChangedFilesSince`.
- Whole-tree CI-набір: `js-lint-ci` (`knip`/`jscpd`), `security` (`trufflehog`), `ga` (`actionlint`), `rego` (`conftest`/`regal`), `text`.
- Per-file quick-набір: `doc` (`lint-doc`), `js-lint` (`oxlint`/`eslint`), `style-lint` (`stylelint`).
- Новий lint-канон має бути оформлений як окреме правило в `npm/rules/lint/`, а не як секція в `scripts.mdc`.
