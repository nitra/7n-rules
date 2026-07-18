---
type: ADR
title: Контракт checkpoint-результату runFixCheck
description: runFixCheck повертає зведені лічильники, стабільні ruleId та актуальний output кожного правила для diff-ів і LLM-fix контексту.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

`runFixCheck` викликається як checkpoint в lint/fix оркестрації: initial → after T0 → after LLM. Результат має одночасно підтримувати швидкий early-exit, user-facing звіт і передачу діагностики в LLM-worker.

## Considered Options

- Повертати структуру `{ total, failed, rules }`, де `rules` містить `ruleId`, `ok` і `output`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Повертати структуру `{ total, failed, rules }`", because transcript фіксує споживачів кожного поля: `total` і `failed` потрібні для прогресу та hot-path early-exit, `ruleId` — для identity і diff між checkpoint-ами, `ok` — для фільтрації failed-правил, `output` — як діагностика для LLM і stderr-звіт для людини або CI.

### Consequences

- Good, because оркестратор може порівнювати failed-списки між checkpoint-ами без зовнішнього стану.
- Good, because LLM-worker отримує актуальний `output` саме після попереднього fix-кроку.
- Neutral, because transcript не містить підтвердження негативних наслідків такого контракту.

## More Information

Структура результату:

```js
{
  total: number,
  failed: number,
  rules: Array<{
    ruleId: string,
    ok: boolean,
    output: string
  }>
}
```

Зафіксовані споживачі: `orchestrator.mjs`, `post-tool-use-fix.mjs`, `orchestrate.mjs`. `output` є злитим stdout+stderr запущеного `fix.mjs`.
