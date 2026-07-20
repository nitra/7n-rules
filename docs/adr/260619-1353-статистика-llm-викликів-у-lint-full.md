---
type: ADR
title: Статистика LLM-викликів у stdout lint --full
description: Наприкінці fix-конформності lint --full виводить агреговану кількість local, cloud-min і cloud-avg викликів.
---

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

Наприкінці `npx @nitra/cursor lint --full` користувач не мав агрегованого summary по LLM-витратах fix-конформності: скільки разів викликалась локальна модель, cloud-min і cloud-avg. Без цього важко оцінювати вартість прогону та помічати правила, що постійно ескалюють у хмару.

## Considered Options

- Вивести статистику у stdout наприкінці фази конформності через `summarizeCalls` і `reportRunStats`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Вивести статистику у stdout наприкінці фази конформності", because користувач прямо попросив загальну статистику кількості викликів локальної моделі та хмарних викликів у розрізі min і avg у резюме `--full`.

### Consequences

- Good, because transcript фіксує успішний рядок на реальному escalation-лозі: `📊 LLM-виклики fix-конформності (цей прогін): локальна 2 · cloud-min 1 · cloud-avg 1`.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because статистика читається з записів escalation-логу поточного прогону.

## More Information

- `npm/scripts/lib/fix/analyze-escalation.mjs` — нові функції `summarizeCalls(records)` і `reportRunStats(records, log)`.
- `npm/rules/lint/js/orchestrate.mjs` — `reportRunStats` викликається з `runFullConformancePhase` після конформності й перед аналітичним хуком.
- `npm/scripts/lib/fix/tests/analyze-escalation.test.mjs` — тести для `summarizeCalls`.
- Коміт у transcript: `d911daf4`, запушено як `71ddcebd`.
