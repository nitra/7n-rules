---
type: ADR
title: Контракт результату runFixCheck
description: Результат runFixCheck зберігає лічильники, стабільні ruleId та актуальний output для checkpoint-diff і LLM-fix контексту.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

`runFixCheck` викликається як checkpoint у fix-orchestrator циклі: initial → after T0 → after LLM. Його результат треба порівнювати між ітераціями та передавати діагностику далі до LLM worker і user-facing звітів.

## Considered Options

- Повернути структурований результат з `total`, `failed` і масивом `rules` із `ruleId`, `ok`, `output`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "структурований результат з `total`, `failed` і `rules`", because transcript фіксує потребу швидкого early-exit за лічильниками, diff між checkpoint-ами за стабільним `ruleId` і передачі свіжого `output` як LLM context.

### Consequences

- Good, because `total` і `failed` дають швидкий progress/early-exit без повторної фільтрації масиву.
- Good, because `ruleId` є стабільним ключем identity для diff між checkpoint-ами.
- Good, because `output` передає актуальну діагностику `fix.mjs` у `runLlmWorker` і stderr-звіти.
- Bad, because transcript не містить підтвердження негативних наслідків цього контракту.
- Neutral, because transcript описує контракт зручності для fast-check, але не фіксує альтернативну форму API.

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

Факти з transcript:

- `orchestrator.mjs` використовує `total`/`failed` для progress-рядка та early-exit.
- `post-tool-use-fix.mjs` використовує `failed === 0` як hot-path.
- `orchestrator.mjs` передає `rule.output` у `runLlmWorker(rule.ruleId, rule.output, cwd, { model })`.
- `ok` потрібен для `initial.rules.filter(r => !r.ok)`.
- `ruleId` потрібен для порівнянь на кшталт `failedAfterT0.some(f => f.ruleId === r.ruleId)`.
