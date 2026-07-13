---
type: ADR
title: "Розділення монолітного скіла docgen на doc-files і doc-aggregate"
description: Монолітний `docgen` розділяється на обовʼязковий `doc-files` для файлової документації та worktree-only `doc-aggregate` для агрегатів.
---

**Status:** Accepted

**Date:** 2026-06-10

## Context and Problem Statement

Скіл `docgen` поєднував два різні режими: Tier 1 — генерацію файлової документації для окремих кодових файлів, і Tier 2+3 — агреговану документацію на рівні модулів та доменів. Tier 1 має бути обовʼязковим кроком кожної задачі, подібно до lint, а агрегатна документація має запускатись лише за потреби. Також потрібно визначити механізм freshness, спосіб оркестрації масового прогону і hook-гейт перед завершенням задачі.

## Considered Options

- Лишити `docgen` монолітним і додати флаг `--tier`.
- Розділити на окремі скіли `doc-files` (Tier 1) і `doc-aggregate` (Tier 2+3).
- CRC32 байтів джерела у YAML frontmatter документації.
- `git diff --name-only HEAD` як джерело змінених файлів для Stop-hook.
- Модель диспатчить субагентів на файли.
- JS-оркестратор керує чергою, батчингом, роутингом і CRC-штампом.
- Лише PostToolUse hook.
- Лише Stop-hook.
- Двошаровий гейт: PostToolUse сигналить, Stop-hook блокує.
- Блокувати Stop-hook за будь-якої кількості stale-файлів.
- Не блокувати, якщо stale > 50.

## Decision Outcome

Chosen option: "розділити `docgen` на `doc-files` і `doc-aggregate`, використовувати CRC32 у frontmatter, JS-оркестрацію та двошаровий hook-гейт з порогом 50", because transcript фіксує різні lifecycle-и Tier 1 і Tier 2+3, потребу зробити файлову документацію обовʼязковою без важкого агрегатора, бажання не покладатись на LLM-субагентів для масового прогону і компромісний швидкий Stop-hook через `git diff --name-only HEAD`.

### Consequences

- Good, because `doc-files` запускається у поточному робочому дереві задачі як обовʼязковий крок, а `doc-aggregate` лишається worktree-only операцією за запитом.
- Good, because CRC32 у frontmatter дає детерміновану перевірку freshness без LLM і без залежності від base branch або rebase.
- Good, because JS-оркестратор дозволяє масовий перший прогін на сотні файлів без виснаження контексту моделі.
- Good, because PostToolUse дає ранній сигнал після правки, а Stop-hook блокує завершення задачі за звичайних умов.
- Bad, because `git diff --name-only HEAD` може пропустити файли, закомічені всередині задачі; transcript фіксує цей компроміс як свідомо прийнятий заради швидкості.
- Bad, because видалення старого `npm/skills/docgen` без fallback і alias є breaking change для зовнішніх посилань на старий CLI namespace.
- Neutral, because дублювання `docgen-gen.mjs`, `docgen-prompts.mjs` і `docgen-extract.mjs` між новими скілами зменшує coupling, але потребує окремого супроводу кожної копії.

## More Information

- Новий скіл: `npm/skills/doc-files/`, `meta.json`: `{ "auto": "завжди", "worktree": false, "requireRoot": true }`.
- Новий скіл: `npm/skills/doc-aggregate/`, `meta.json`: `{ "worktree": true }`.
- Старий `npm/skills/docgen` і CLI namespace `docgen` видаляються без fallback і без redirect-alias.
- CLI: `npx @nitra/cursor doc-files scan|check|gen|stamp`.
- CLI: `npx @nitra/cursor doc-aggregate modules`.
- CRC32 обчислює `node:zlib` (`zlib.crc32`), доступний з Node 22.2+; версія в репо за transcript — v26.3.0.
- Frontmatter-схема: `docgen: { source: "src/lib/foo.js", crc: "<hex>" }`.
- Реалізація CRC: `npm/skills/doc-files/js/docgen-crc.mjs` — `sourceCrc(filePath)`, `readDocMeta(docPath)`, `writeDocMeta(docPath, meta, body)`.
- Оркестратор: `npm/skills/doc-files/js/docgen-files-batch.mjs`, нащадок `docgen-batch.mjs`.
- Модельний routing у transcript: `sym < 4 → gemma3:4b`, `sym ≥ 4 → Claude Sonnet`.
- PostToolUse matcher: `Edit|Write|MultiEdit`; команда `npx @nitra/cursor doc-files check --hook`.
- Stop-hook: `npx @nitra/cursor doc-files check --stop`; блокує (`exit 1`) лише якщо `stale ≤ 50`.
- Джерело changed-only у Stop-hook: `execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root })`.
- Поріг гейта: `50`, конфігурується через `N_CURSOR_DOC_FILES_GATE_MAX`.
- Налаштування hook: `npm/.claude-template/settings.template.json`.
- Спека: `docs/specs/2026-06-10-docgen-split-doc-files-doc-aggregate-design.md`.
