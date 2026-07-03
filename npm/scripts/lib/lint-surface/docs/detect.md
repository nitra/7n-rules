---
type: JS Module
title: detect.mjs
resource: npm/scripts/lib/lint-surface/detect.mjs
docgen:
  crc: 6080123e
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 90
  issues: internal-name:evaluatePolicyConcern,judge:inaccurate:0.92
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл виконує detect-крок unified lint surface для одного concern-detector-а: запускає detector read-only, спирається на `concern.json` і повертає нормалізований `LintResult`. `runConcernDetector` є публічним entrypoint для цього запуску, а `DetectorError` уніфікує технічні збої detector-а й невалідні результати як інфраструктурний failure лінту. Тут немає LLM, autofix чи мутацій дерева.

## Поведінка

- `DetectorError` позначає збій detector-а або невалідний результат як помилку інфраструктури лінту, щоб unified lint surface міг завершитись із технічним failure.
- `runConcernDetector` запускає один concern-detector у read-only режимі, обирає policy-оцінювання за `concern.json` або ручний detector, нормалізує результат до єдиного формату й перетворює аномалії на `DetectorError`.

## Публічний API

- DetectorError — позначає збій detector-а або непридатний результат; такий стан завершує виконання з exit 2.
- runConcernDetector — запускає detector для одного concern-а, приводить відповідь до очікуваного формату й перетворює будь-яку аномалію на `DetectorError`.

Код спирається на конфіг `concern.json`.

Чисті policy-concern-и на основі rego/template виконуються напряму через `evaluatePolicyConcern` з даних `concern.json`; генерований `main.mjs` для них не потрібен.

Ручний не-`@generated` `main.mjs` є escape-hatch і завжди має пріоритет над policy-оцінкою.

Concern-и без policy і без `main.mjs` вважаються помилкою конфігурації.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
