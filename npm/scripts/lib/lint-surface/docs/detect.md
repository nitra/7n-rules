---
type: JS Module
title: detect.mjs
resource: npm/scripts/lib/lint-surface/detect.mjs
docgen:
  crc: cf3febf6
  model: openai-codex/gpt-5.5
  score: 90
  issues: internal-name:evaluatePolicyConcern,judge:inaccurate:0.92
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл виконує detect-крок unified lint surface для одного concern-detector-а: запускає detector read-only, спирається на `concern.json` і повертає нормалізований `LintResult`. `runConcernDetector` є публічним entrypoint для цього запуску, а `DetectorError` уніфікує технічні збої detector-а й невалідні результати як інфраструктурний failure лінту. Тут немає LLM, autofix чи мутацій дерева.

## Поведінка

- `DetectorError` позначає збій detector-а або невалідний результат як помилку інфраструктури лінту, щоб unified lint surface міг завершитись із технічним failure.
- `runConcernDetector` запускає один concern-detector у read-only режимі, обирає policy-оцінювання за `concern.json` або ручний detector, нормалізує результат до єдиного формату й перетворює аномалії на `DetectorError`.
- Виняток із fail-fast: помилка з `name === 'ToolProvisionError'` (транзієнтний збій авто-встановлення зовнішнього тула з `ensure-tool.mjs` — GitHub API rate-limit, мережа, обірваний download) не кидається як `DetectorError`. Concern пропускається fail-open: повертаються порожні `violations` + warn-діагностика, а попередження дублюється у stderr (`console.warn`), щоб пропуск було видно в CI-логах і без verbose. Розпізнавання за `name` — помилка може приходити з іншого інстансу модуля `ensure-tool.mjs`.

## Публічний API

- DetectorError — позначає збій detector-а або непридатний результат; такий стан завершує виконання з exit 2.
- runConcernDetector — запускає detector для одного concern-а, приводить відповідь до очікуваного формату й перетворює будь-яку аномалію на `DetectorError`; транзієнтні `ToolProvisionError` натомість дають fail-open пропуск concern-а з warn-діагностикою.

Код спирається на конфіг `concern.json`.

Чисті policy-concern-и на основі rego/template виконуються напряму через `evaluatePolicyConcern` з даних `concern.json`; генерований `main.mjs` для них не потрібен.

Ручний не-`@generated` `main.mjs` є escape-hatch і завжди має пріоритет над policy-оцінкою.

Concern-и без policy і без `main.mjs` вважаються помилкою конфігурації.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД); єдиний side effect — `console.warn` при fail-open пропуску concern-а через `ToolProvisionError`.
