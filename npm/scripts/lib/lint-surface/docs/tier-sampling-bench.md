---
type: JS Module
title: tier-sampling-bench.mjs
resource: npm/scripts/lib/lint-surface/tier-sampling-bench.mjs
docgen:
  crc: 965e195a
  model: manual
---

## Огляд

Модуль запускає реальний bench для experiment-only tier sampling поверх lint fix ladder. Він створює тимчасові git-fixtures, викликає `runAgentFix` через `runTierSamplingExperiment`, перевіряє результат deterministic detector-ом і записує JSON із підсумками clean/rescue/latency.

## Поведінка

Runner будує experiment ladder із `local-min`, `cloud-min`, `cloud-avg`, `cloud-max` за поточними env-моделями. Для кожної fixture/tier пари створюється окремий тимчасовий git repo, щоб write-guard `runAgentFix` мав git-root і щоб результати різних tier-ів не впливали один на одного.

Для `cloud-min` і `cloud-avg` запускаються два sampling profiles: `conservative` і `exploratory`. Для `local-min` і `cloud-max` запускається один conservative candidate. Профіль потрапляє у rule text як інструкція до агента; success все одно визначає тільки injected detector.

Після кожного tier-а runner пише progress JSONL у stdout. Наприкінці він записує повний JSON-result у `docs/specs/2026-06-30-lint-tier-sampling-consensus-results.json` або шлях із `--out`.
CLI-запуск завершується після summary, щоб відкриті агентські handle-и не тримали процес живим після запису результату.

## Публічний API

- `runTierSamplingBench` — запускає bench, повертає об'єкт результату і пише JSON-файл.

CLI-параметри:

- `--out <path>` — шлях до JSON-result.
- `--tier <a,b>` — звузити список tier-ів.
- `--fixture <a,b>` — звузити список fixtures.

## Гарантії поведінки

- Не змінює production `runFixPipeline`.
- Не пише у consumer repo: усі LLM edits відбуваються у temporary git-fixtures.
- Judge/consensus не є oracle: detector є єдиним джерелом success.
- Результат містить raw attempts, selected candidate і агреговану summary по tier-ах.
