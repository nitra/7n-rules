---
type: ADR
title: Розділення docgen на doc-files і doc-aggregate
description: Монолітний docgen розділяється на обовʼязкову файлову документацію та on-demand агрегатор із CRC freshness і двошаровим gate.
---

**Status:** Accepted
**Date:** 2026-06-10

## Context and Problem Statement

Скіл `docgen` поєднував два різні режими: Tier 1 — генерацію документації для кожного окремого файлу, і Tier 2+3 — агреговану документацію на рівні модулів та доменів. Файлова документація має бути обовʼязковим супутником кожної задачі, як lint, тоді як агрегатний прогін потрібен лише за запитом. Потрібно також детерміновано визначати застарілість файлової документації, не покладаючись на LLM або нестабільний git-контекст.

## Considered Options

- Лишити `docgen` монолітним і додати прапор `--tier`.
- Розділити на окремі скіли `doc-files` (Tier 1) і `doc-aggregate` (Tier 2+3).
- `git diff --name-only HEAD` для визначення застарілості документації.
- CRC32 байтів джерела у YAML frontmatter doc-файлу.
- Модель диспатчить субагентів для генерації документації.
- JS-оркестратор керує чергою, батчингом, роутингом і CRC-штампом.
- Лише PostToolUse hook.
- Лише Stop-hook.
- Двошаровий gate: PostToolUse сигналить, Stop-hook блокує.
- Блокувати завжди за будь-якої кількості stale-файлів.
- Не блокувати, якщо stale-файлів більше за поріг.

## Decision Outcome

Chosen option: "Розділити на `doc-files` і `doc-aggregate`, використовувати CRC32 у frontmatter, JS-оркестрацію та двошаровий gate з порогом", because transcript фіксує різні lifecycle-и Tier 1 і Tier 2+3, потребу обовʼязкового per-file кроку без worktree-only семантики, вимогу не заморювати модель масовим прогоном і необхідність сильного gate перед завершенням задачі.

### Consequences

- Good, because `doc-files` запускається у поточному робочому дереві задачі й може стати обовʼязковим кроком без запуску важкого агрегатора.
- Good, because `doc-aggregate` залишається worktree-only і виконується лише за запитом.
- Good, because CRC32 у frontmatter дає O(1) freshness-перевірку без LLM і без залежності від base branch, rebase або незакомічених змін.
- Good, because JS-оркестратор дозволяє масово генерувати документацію порціями (`--from`, `--limit`) без утримання сотень файлів у контексті моделі.
- Good, because PostToolUse дає ранній сигнал після правки, а Stop-hook блокує завершення задачі за звичайних умов.
- Bad, because старий `npm/skills/docgen` і CLI namespace `docgen` видаляються без fallback або redirect-alias; зовнішні посилання на старі команди припиняють працювати.
- Bad, because `git diff --name-only HEAD` у Stop-hook є свідомим компромісом: файли, закомічені всередині задачі, можуть випасти з перевірки.
- Neutral, because поріг `stale > 50` не блокує перший масовий прогін, але transcript не містить підтвердження наслідків для довгострокового режиму після первинної генерації.

## More Information

- Нові скіли: `npm/skills/doc-files/` і `npm/skills/doc-aggregate/`.
- `doc-files` meta: `{ "auto": "завжди", "worktree": false, "requireRoot": true }`.
- `doc-aggregate` meta: `{ "worktree": true }`.
- CLI: `npx @nitra/cursor doc-files scan|check|gen|stamp` і `npx @nitra/cursor doc-aggregate modules`.
- Старий `npm/skills/docgen/` та CLI namespace `docgen` видаляються повністю, без fallback і alias.
- Спільні модулі (`docgen-gen.mjs`, `docgen-prompts.mjs`, `docgen-extract.mjs`, `docgen-ignore.mjs`, `docgen-scan.mjs`) дублюються в обидва скіли без `_shared`, бо transcript фіксує незалежну еволюцію скілів.
- CRC32 обчислює `node:zlib` (`zlib.crc32`); repo-версія Node у transcript — v26.3.0.
- Frontmatter-схема: `docgen: { source: "src/lib/foo.js", crc: "<hex>" }`.
- Stale = документації немає або `crc(джерело) ≠ crc у frontmatter`.
- Реалізаційний модуль CRC: `npm/skills/doc-files/js/docgen-crc.mjs` — `sourceCrc(filePath)`, `readDocMeta(docPath)`, `writeDocMeta(docPath, meta, body)`.
- Оркестратор: `npm/skills/doc-files/js/docgen-files-batch.mjs`, нащадок `docgen-batch.mjs`; генерація використовує `docgen-gen.mjs`, `callOmlx`/`resolveModel`, routing `sym < 4 → gemma3:4b` і `sym ≥ 4 → Claude Sonnet`, як зафіксовано в transcript.
- PostToolUse matcher: `Edit|Write|MultiEdit`; команда `npx @nitra/cursor doc-files check --hook`.
- Stop-hook: `npx @nitra/cursor doc-files check --stop`; блокує (`exit 1`), якщо stale-файлів `≤ 50`.
- Джерело changed-only у Stop-hook: `git diff --name-only HEAD`.
- Поріг gate: дефолт `50`, конфігурується через `N_CURSOR_DOC_FILES_GATE_MAX`; якщо stale-файлів більше, команда не блокує, але попереджає і пропонує `npx @nitra/cursor doc-files gen`.
- Налаштування hook-ів: `npm/.claude-template/settings.template.json`.
- Спека: `docs/specs/2026-06-10-docgen-split-doc-files-doc-aggregate-design.md`.
