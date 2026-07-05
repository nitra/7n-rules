---
type: JS Module
title: ladder.mjs
resource: npm/scripts/lib/lint-surface/ladder.mjs
docgen:
  crc: 44fcfbee
  model: openai-codex/gpt-5.5
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл визначає чисті правила tier-ladder для central fix-pipeline: `DEFAULT_MAX_AVG`, `buildLadder`, `classifyFixError` і `decideAfterFailure` будують доступний ланцюжок рівнів виправлення від локального до cloud-avg, класифікують причину невдачі та вирішують подальшу ескалацію. Він потрібен, щоб central fix-pipeline мав єдину поведінку ескалації за `2026-06-19-fix-escalation-cascade` і `2026-06-29-unified-lint-surface §Tier Ladder`, без залежності від старого `orchestrator.mjs`, який видаляється на cutover.

## Поведінка

- `DEFAULT_MAX_AVG` задає типовий ліміт звернень до середнього cloud-рівня за один прогін, щоб ескалація не витрачала надмірно дорогий ресурс.
- `buildLadder` формує послідовність рівнів виправлення від локального мінімального до cloud-avg і відкидає недоступні рівні без моделі.
- Кожен rung несе `timeoutMs` — per-tier таймаут виклику (ADR 260620-0556): локальні рівні 45s, хмарні 120s; override без зміни коду — env `N_LOCAL_FIX_TIMEOUT_MS` / `N_CLOUD_FIX_TIMEOUT_MS`. Runner прокидає його worker-у через `FixContext`, щоб зависла LLM-сесія переривалась, а ladder рухався далі.
- `classifyFixError` визначає характер помилки виправлення: системна причина, транспортний збій або якісна невдача агента.
- `decideAfterFailure` вирішує, чи продовжувати ескалацію після невдалого рівня, чи пропустити локальну модель, чи зупинити процес.

## Публічний API

- DEFAULT_MAX_AVG — задає стандартну межу звернень до cloud-avg за один прогін, щоб кілька concerns не витратили avg-бюджет.
- buildLadder — формує ladder з доступних тирів і прибирає rung-и без заданої моделі.
- classifyFixError — відносить збій worker-а до systemic, transport або quality; агентний backstop-timeout трактує як quality, щоб ladder перейшов до сильнішого rung-а.
- decideAfterFailure — визначає, що робити після невдалого rung-а: зупинити ladder або пропустити поточну модель.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
