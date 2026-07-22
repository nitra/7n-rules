---
type: JS Module
title: tier-sampling-experiment.mjs
resource: npm/scripts/lib/lint-surface/tier-sampling-experiment.mjs
docgen:
  crc: 959712b3
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Експериментальний harness моделює isolated sampling для окремого tier-а lint fix ladder: будує experiment-only rung-и, проганяє sampling-кандидатів із відкотом до S1 і лишає лише candidate, що пройшов canonical detect. Файл існує, щоб перевіряти sampling/consensus поза production `runFixPipeline`, залишаючи judge/consensus тільки джерелом feedback, а не рішенням про patch.

Публічні точки входу: `EXPERIMENT_TIER_ORDER`, `buildExperimentLadder`, `samplingProfilesForTier`, `chooseCleanCandidate`, `runTierSamplingExperiment`.

Модуль працює fail-safe: перехоплює помилки й не кидає винятків назовні.

## Поведінка

`EXPERIMENT_TIER_ORDER` задає порядок експериментальних tier-ів, за яким формується ladder для isolated sampling поверх lint fix pipeline.

`buildExperimentLadder` створює окремий experiment-only ladder із підтримкою `cloud-max`, не змінюючи production-послідовність `runFixPipeline`. Дані про моделі й timeouts перетворюються на набір rung-ів, які далі використовуються як сценарії окремих випробувань.

`samplingProfilesForTier` визначає набір sampling-кандидатів для конкретного tier-а. Якщо для tier-а передані перевизначення, вони стають джерелом профілів; інакше використовується стандартний набір для цього рівня.

`runTierSamplingExperiment` бере violations, базовий контекст, rung і sampling-кандидатів, після чого послідовно тестує кожного кандидата в ізольованому стані S1. Для кожної спроби робоче дерево відкочується до початкового snapshot, запускається worker, фіксуються змінені файли, виконується canonical detect і записується результат спроби разом із telemetry та latency.

Після всіх спроб `chooseCleanCandidate` обирає лише чистий candidate: пріоритет має менша кількість змінених файлів, менший patch і коротша latency. Якщо чистого кандидата немає, експеримент завершується без застосування patch до робочого дерева.

Якщо чистий candidate знайдено, `runTierSamplingExperiment` застосовує саме його зміни як фінальний результат tier sampling. Judge/consensus не приймає рішення про застосування patch: його відповідь повертається тільки як feedback поруч із attempts, selected candidate, фінальними violations і clean-статусом.

Модуль працює fail-safe: помилки окремих кандидатів або допоміжних етапів перетворюються на результати спроб і не викидаються назовні. Кешування між запусками або кандидатами не використовується.

## Публічний API

- EXPERIMENT_TIER_ORDER — Порядок tier-ів експериментального ladder — від локальної моделі до найсильнішої хмарної.
- buildExperimentLadder — Будує experiment-only ladder із `cloud-max`. Production ladder це не змінює.
- samplingProfilesForTier — Повертає можливі sampling profiles для заданого tier-а.
- chooseCleanCandidate — Дефолтний вибір найкращого (clean) кандидата серед усіх спроб.
Вибір відбувається за критеріями: менша кількість змінених файлів, менший розмір patch, менша латентність.
- runTierSamplingExperiment — Виконує послідовність випробувань (sampling) для одного tier.
Для кожного кандидата виконується rollback до S1, запускається worker,
оцінюється чистота, і якщо кандидат обраний, застосовується його patch.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
