---
type: ADR
title: Введення типу агента flow у nitra-cursor
description: Додаємо `flow` як першокласний тип агента для оркестрації інших агентів через API `n-cursor flow`.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Пакет `@nitra/cursor` мав фіксований набір агентів: `adr`, `coverage`, `docgen`, `fix`, `lint`, `taze`. Потрібно додати новий тип агента `flow`, який ходить по інших агентах через API та описується в типах і сутностях агентів.

У transcript зафіксовано наявність CLI API:
- `n-cursor flow plan`, що повертає `StructuredOutput` з `plan`;
- `n-cursor flow verify`, що повертає `StructuredOutput` з `verify`;
- `n-cursor flow run <name> <input>`, де `<name>` — назва flow, а `<input>` — JSON-рядок.

## Considered Options

- Додати `flow` як повноцінний агент: розширити `AgentId`, додати `FlowAgent`, зареєструвати його в `AGENTS`, описати `FlowPlan`/`FlowVerify`/`FlowStep`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `flow` як повноцінний агент", because користувач явно описав новий тип агента `flow`, який має використовувати API `n-cursor flow plan`, `n-cursor flow verify` і `n-cursor flow run <name> <input>` та бути описаним у типах і сутностях агентів.

### Consequences

- Good, because `flow` стає першокласним значенням у реєстрі агентів і може використовувати той самий контракт `Agent`, що й інші агенти.
- Good, because планування та перевірка flow отримують структурований контракт через `StructuredOutput`.
- Bad, because transcript фіксує, що `npm/src/cli/flow/plan.ts`, `npm/src/cli/flow/verify.ts` і `npm/src/cli/flow/run.ts` на момент аналізу містили TODO-заглушки, тому повна поведінка CLI ще потребує реалізації.
- Neutral, because transcript не містить підтвердження додаткових runtime-наслідків для існуючих агентів.

## More Information

Файли, визначені в transcript як релевантні для реалізації:
- `npm/src/types.ts` — розширити `AgentId` значенням `'flow'`; додати або підключити типи `FlowPlan`, `FlowVerify`, `FlowStep`.
- `npm/src/agents/flow.ts` — новий клас `FlowAgent implements Agent`.
- `npm/src/agents.ts` — додати `export { FlowAgent }` і запис `flow` у `AGENTS`.
- `npm/src/cli/flow/plan.ts` — команда `n-cursor flow plan`.
- `npm/src/cli/flow/verify.ts` — команда `n-cursor flow verify`.
- `npm/src/cli/flow/run.ts` — команда `n-cursor flow run <name> <input>`.
- `npm/src/common.ts` — існуючий helper `runCli()` викликає `spawnSync('n-cursor', ...)`.

Пов'язаний release-факт з transcript: major bump для breaking change зафіксовано changeset-файлом `.changesets/1749296099946-npm.md`, а не прямим редагуванням `package.json`.
