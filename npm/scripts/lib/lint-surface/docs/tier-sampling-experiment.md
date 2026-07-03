---
type: JS Module
title: tier-sampling-experiment.mjs
resource: npm/scripts/lib/lint-surface/tier-sampling-experiment.mjs
docgen:
  crc: 1723486a
  model: manual
  score: 100
---

## Огляд

Модуль описує experiment-only harness для перевірки sampling/consensus поверх lint fix ladder. Він не підключається до production `runFixPipeline`, а дає окрему програмну точку для bench/smoke: побудувати експериментальні тири, підібрати sampling profiles і прогнати кілька isolated candidates для одного tier-а.

## Поведінка

`buildExperimentLadder` будує список `local-min`, `cloud-min`, `cloud-avg`, `cloud-max` тільки з моделей, які задані. Усі rungs позначені як `experimentOnly`, а `cloud-max` має окремий маркер `isMax`, щоб не змішувати його з production `cloud-avg` budget.

`samplingProfilesForTier` повертає дефолтні профілі для tier-а або приймає override. Для `cloud-min` і `cloud-avg` дефолт — `conservative` + `exploratory`; для `local-min` і `cloud-max` — один `conservative` профіль.

`runTierSamplingExperiment` запускає candidates послідовно. Перед кожним candidate-ом робоче дерево відкочується до `S1`; worker отримує `samplingProfile`, `candidateId` і `recordWrite`; після worker-а викликається injected canonical `detect`. Clean candidate-и порівнюються за кількістю touched files, розміром patch і latency. Вибраний patch застосовується повторно і ще раз перевіряється final detect.

Якщо clean candidate-а немає, optional `judge` може повернути тільки feedback. Judge не може override-ити detector і не може зробити failed candidate успішним.

## Публічний API

- `buildExperimentLadder` — будує experiment-only ladder із `cloud-max`.
- `samplingProfilesForTier` — повертає sampling profiles для tier-а.
- `chooseCleanCandidate` — вибирає найменший clean candidate.
- `runTierSamplingExperiment` — виконує ізольовані candidates і повертає selected attempt, attempts telemetry, final violations та judge feedback.

## Гарантії поведінки

- Не змінює production ladder і не імпортується production `run-fix`.
- Не використовує LLM напряму; worker/detect/judge інжектуються.
- Success визначає тільки canonical detect.
- Кожен candidate стартує з однакового `S1`, тому degraded patch одного профілю не тече в інший.
