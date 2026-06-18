---
type: ADR
title: "Видалення legacy `js/` fallback з `discover-checkable-rules` та `run-rule` (фаза 3)"
---

# Видалення legacy `js/` fallback з `discover-checkable-rules` та `run-rule` (фаза 3)

**Status:** Accepted
**Date:** 2026-05-16

## Context and Problem Statement

Після фази 2 (перейменування `rules/<id>/js/` → `rules/<id>/fix/`) шар `discover-checkable-rules.mjs` і `run-rule.mjs` все ще підтримував dual-mode: сканував обидві директорії через поле `rootDir` у типі `JsConcern`. Це залишало мертвий шлях у коді.

## Considered Options

- Вилучити `mergeJsConcerns`, поле `rootDir` і fallback-сканування `js/`; захардкодити `'fix'` у `resolveJsCheckPath`
- Зберегти dual-mode ще один цикл

## Decision Outcome

Chosen option: "Вилучити legacy js/ fallback", because тест-суїт підтверджував чистоту після фази 2 і всі 26 правил уже знаходилися у `fix/` (або `lint/` для 6 правил).

### Consequences

- Good, because `discover-checkable-rules.mjs` і `run-rule.mjs` спрощено: видалено `mergeJsConcerns`, `rootDir`, fallback-гілку.
- Good, because тести скорочені з 19 до 13: прибрано 6 dual-mode сценаріїв, додано 2 single-mode.
- Neutral, because bump `1.11.11 → 1.11.12`.
- Bad, because transcript не містить підтвердження негативних наслідків.

## More Information

Файли: `npm/scripts/utils/discover-checkable-rules.mjs`, `npm/scripts/utils/discover-checkable-rules.test.mjs`, `npm/scripts/utils/run-rule.mjs`, `npm/scripts/utils/run-rule.test.mjs`, `npm/bin/n-cursor.js:1011-1015`.
