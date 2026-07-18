---
type: ADR
title: "Видалення надлишкових CLI точок входу: `lint-ci` і `doc-files <sub>`"
description: CLI `@nitra/cursor` прибирає alias-команди `lint-ci` і `doc-files <sub>`, залишаючи канонічні входи `lint`, `lint-doc-files` і `fix-doc-files`.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

CLI `@nitra/cursor` накопичив дублюючі точки входу. `lint-ci` був чистим alias для `lint --read-only --full`, а `doc-files <sub>` був deprecated-делегатом до `lint-doc-files` і `fix-doc-files` без окремої поведінки.

Transcript фіксує, що grep по `.github`, root `package.json`, `.mjs`/`.js` і MDC-файлах не знайшов живих caller-ів цих команд. Тому CLI підтримував публічні входи, які не додавали функціональності.

## Considered Options

- Залишити `lint-ci` і `doc-files <sub>` для зворотної сумісності.
- Видалити `lint-ci` і `doc-files <sub>` як alias-команди без живих caller-ів.

## Decision Outcome

Chosen option: "Видалити `lint-ci` і `doc-files <sub>`", because обидві команди були alias-ами без власної логіки, а grep у transcript не знайшов живих викликів у workflow, package scripts або коді.

### Consequences

- Good, because поверхня CLI стає меншою, а CI-сценарій покривається канонічним `lint --read-only --full` без окремої підкоманди.
- Good, because doc-files сценарії лишаються розділеними між `lint-doc-files` для hook-протоколу і `fix-doc-files` для bulk/overwrite/retry-degraded генерації.
- Bad, because видалення публічних команд є breaking change; transcript фіксує changeset `npm/.changes/260615-0638.md` з `bump: major` і `section: Removed`.
- Neutral, because transcript не містить підтверджених негативних наслідків для реальних інтеграцій.

## More Information

- `npm/bin/n-cursor.js`: видалено `case 'lint-ci'`, `case 'doc-files'`, рядки у шапці, перелік у `default`-помилці та коментар у root-guard.
- `npm/schemas/rule-meta.json`: enum `['quick', 'ci']` замінено на `['per-file', 'full']`, щоб узгодити schema з `parseRuleLintSpec`.
- `npm/rules/js-lint-ci/js-lint-ci.mdc`: згадки `lint-ci` замінено на `lint --full` / `lint --read-only --full`.
- `npm/.changes/260615-0638.md`: changeset із `bump: major`, `section: Removed`.
- Перевірки з transcript: `node --check bin/n-cursor.js` — OK; `vitest run` — 6/6 passed.
- У тому самому transcript окремо обговорено Opportunistic LLM-fix tier для lint-правил; це пов'язана, але самостійна майбутня спека `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`, не частина видалення alias-команд.

## Update 2026-06-15

Перед фінальною консолідацією окремо зафіксовано два уточнення:

- `lint-ci` був чистим аліасом для `runLint({ full: true, readOnly: true })`, тобто для `lint --read-only --full`, і не мав живих caller-ів у workflow, CI-конфігах або root `package.json`.
- `npm/schemas/rule-meta.json` містив застарілий enum `['quick', 'ci']`, тоді як runtime-код `parseRuleLintSpec` і оркестратор працювали зі значеннями `per-file` і `full`.

Good, because оновлення enum робить JSON Schema машинозчитуваним контрактом, що відповідає фактичному runtime.

Neutral, because transcript не містить підтверджених негативних наслідків для виправлення schema enum.

## Update 2026-06-15

Уточнено межу між `lint` і `fix-doc-files`:

- `n-cursor lint` у fix-mode працює по delta vs origin і може латати лише локальні зміни.
- `n-cursor fix-doc-files` потрібен для bulk/first-run сценаріїв, `--overwrite`, `--retry-degraded` і окремого `--stamp`.
- `lint-doc-files` лишається hook-протоколом.
- Deprecated `doc-files <sub>` не має окремої ролі після міграції на `lint-doc-files` і `fix-doc-files`.

Neutral, because transcript фіксує, що `fix-doc-files` не є повним дублем `lint`, а покриває bulk/overwrite/retry-degraded сценарії.

## Update 2026-06-15

Додатково зафіксовано, що `lint-ci` згадувався лише в документаційних рядках, `CHANGELOG.md` і default-помилці CLI. Живих caller-ів у workflow, root `package.json` або скілах transcript не підтвердив.

Також зафіксовано проміжне обговорення doc-files: `lint-doc-files`/lint-крок має дешевий detect-only сценарій через `reportStale`, тоді як генерація через `runDocFilesGenCli` потребує `isModelAvailable()` і локальної LLM.

Neutral, because питання про `lint --fix` як проміжний варіант у цьому transcript лишалося відкритим до пізнішого рішення.
