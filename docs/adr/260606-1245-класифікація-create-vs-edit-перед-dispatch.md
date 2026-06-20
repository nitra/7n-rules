---
type: ADR
title: "Класифікація типу задачі (CREATE vs EDIT) перед вибором тиру dispatch"
description: Dispatch до тиру виконання має базуватись на типі задачі (CREATE/EDIT/cascade), а не на ідентифікаторі правила.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

Під час прогону D-run виявлена асиметрія: правило `ga` стабільно таймаутилось на local-тирі (CREATE файлу `.vscode/extensions.json` з нуля → 5+ кроків LLM → >220 с → ETIMEDOUT), тоді як `js-lint` та `rego` завершувались успішно на тому ж тирі (EDIT вже наявного файлу → ~2 кроки → <220 с). Поточна логіка dispatch призначає тир за ідентифікатором правила без урахування характеру конкретної задачі — це призводить до гарантованих таймаутів на local для CREATE-задач і до надлишкових ескалацій для легких EDIT-задач.

## Considered Options

* Dispatch на основі ідентифікатора правила (поточний підхід)
* Dispatch на основі типу задачі: CREATE / EDIT / cascade

## Decision Outcome

Chosen option: "Dispatch на основі типу задачі", because `EDIT known file, add 1–2 lines` вкладається в таймаут local-тиру (~2 кроки LLM, <220 с), тоді як `CREATE file from scratch` вимагає 5+ кроків і стабільно таймаутиться на local — перша корисна ескалація йде одразу на haiku.

### Consequences

* Good, because `EDIT known file` (1–2 рядки) → local tier; local-тир застосовується лише там, де реально справляється.
* Good, because `CREATE from template` → T0 якщо шаблон відомий, інакше одразу haiku; виключає гарантовані таймаути на local.
* Good, because `cascade / multi-file` → haiku або sonnet; зменшується кількість марних спроб нижчих тирів.
* Bad, because transcript не містить підтвердження конкретної реалізації класифікатора — "перший крок до `md→orchestrator-codegen`" зафіксовано як намір, не завершена реалізація.
* Neutral, because правила `text` і `vue` не вклались у local-тир навіть для EDIT-задач — причина (thermal throttling M2 після 30+ хв роботи ollama або conflicting edit без збереження наявних extensions) у transcript не встановлена остаточно.

## More Information

Леджер D-прогону: `bun → T0 (rm lockfiles, 0 LLM)`; `ga → local#1 FAIL → haiku#1 ✅`; `js-lint → local#1 ✅`; `rego → local#1 FAIL → local#2 ✅`; `text → local×? FAIL → haiku#2 ✅`; `vue → local×? FAIL → haiku#2 ✅`; `ci4 → local×2 + haiku×2 FAIL → sonnet#1 ✅`; `style-lint → haiku#1 ✅`.
Всі 5 правил (`ga`, `js-lint`, `rego`, `text`, `vue`) перевіряли `.vscode/extensions.json`; у worktree-baseline цей файл не існував → `ga` виконувало CREATE, наступні правила — EDIT вже наявного файлу.
Механізм одночасного ETIMEDOUT і успіху: `spawnSync` з `timeout: 220_000` вбиває процес після таймауту, але файл може бути вже записаний на диск; процес вбивався під час фази верифікації після запису.
`--no-session` прибрано з `run-d.mjs` для ізоляції між запусками → pi не зберігав conversation history → трейс LLM-запитів відсутній.
