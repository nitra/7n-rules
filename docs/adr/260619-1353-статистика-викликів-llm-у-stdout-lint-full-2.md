---
type: ADR
title: Статистика викликів LLM у stdout lint --full
description: Наприкінці fix-конформності `lint --full` виводить кількість local, cloud-min і cloud-avg викликів LLM за поточний прогін.
---

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

Після прогону `npx @nitra/cursor lint --full` користувач не бачив агрегованого summary по LLM-викликах fix-конформності. Без цього було важко оцінити вартість прогону й помітити правила, що стабільно ескалюють у хмару.

## Considered Options

- Вивести статистику у stdout наприкінці фази конформності через `summarizeCalls` і `reportRunStats`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Вивести статистику у stdout наприкінці фази конформності", because користувач прямо попросив загальну статистику кількості викликів локальної моделі й хмарних моделей у розрізі min та avg у резюме `--full`.

### Consequences

- Good, because transcript фіксує успішний smoke-result: рядок `📊 LLM-виклики fix-конформності (цей прогін): локальна 2 · cloud-min 1 · cloud-avg 1` виведено на реальному escalation-лозі.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because статистика читається з escalation-записів поточного прогону, а не вигадує окрему систему обліку.

## More Information

- `npm/scripts/lib/fix/analyze-escalation.mjs` — нові функції `summarizeCalls(records)` і `reportRunStats(records, log)`.
- `npm/rules/lint/js/orchestrate.mjs` — `reportRunStats` викликається з `runFullConformancePhase` після конформності й перед аналітичним хуком.
- `npm/scripts/lib/fix/tests/analyze-escalation.test.mjs` — тести `summarizeCalls`.
- Commit: `d911daf4`, запушено в `main` як `71ddcebd`.
