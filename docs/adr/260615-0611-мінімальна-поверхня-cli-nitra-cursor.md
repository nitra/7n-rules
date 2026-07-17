---
type: ADR
title: "Мінімальна поверхня CLI @nitra/cursor"
description: CLI має зберігати окремі ролі lint, lint-doc-files і fix-doc-files та не додавати зайвий doc-files-флаг.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

CLI `n-cursor` мав кілька близьких точок входу для lint і doc-files. Потрібно було відрізнити реальні ролі від дублювання: `lint` у fix-mode латає doc-files лише для delta-змін, тоді як `fix-doc-files` потрібен для bulk/overwrite/retry-degraded сценаріїв.

## Considered Options

- Залишити `lint` як локальну delta-латку для змінених файлів.
- Залишити `lint-doc-files` як hook-протокол.
- Залишити `fix-doc-files` як bulk/overwrite/retry-degraded команду.
- Злити doc-files-виклики у флаг `--doc-files` до `lint`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "залишити окремі ролі `lint`, `lint-doc-files` і `fix-doc-files`", because transcript фіксує, що `fix-doc-files` не дублює `lint`: `lint` у fix-mode працює по delta vs origin, а `fix-doc-files` покриває first-run, `--overwrite` і `--retry-degraded`.

### Consequences

- Good, because CLI зберігає різні сценарії: delta-fix, hook-протокол і bulk-регенерацію.
- Good, because не потрібен спеціальний `--doc-files` flag: doc-files уже є lint-правилом із `meta.json: lint: per-file`.
- Bad, because transcript не містить підтвердження негативних наслідків від збереження трьох основних doc-files/lint точок входу.
- Neutral, because deprecated `doc-files <sub>` у transcript позначений як мертвий аліас, який можна видаляти окремо.

## More Information

Фактична матриця з transcript:

- `n-cursor lint` у fix-mode: тільки змінені файли, delta vs origin, CRC-mismatch only.
- `n-cursor fix-doc-files`: весь repo або `--limit`/`--from`, підтримує `--overwrite`, `--retry-degraded`, `--stamp`.
- `lint-doc-files`: hook-протокол.
- `npm/rules/doc-files/js/lint.mjs:17-32`: підтверджено, що `lint({ readOnly: false })` викликає `runDocFilesGenCli` у fix-mode delta.
