---
type: JS Module
title: detect.mjs
resource: npm/scripts/lib/lint-surface/detect.mjs
docgen:
  crc: 423fe127
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 90
---

## Огляд

Detect-крок unified lint surface: запуск одного concern-detector-а і нормалізація
його `LintResult`. Detector — read-only; тут немає LLM, autofix чи мутацій дерева.

## Поведінка

DetectorError виникає, коли будь-яка аномалія виникає під час роботи детектора, що призводить до виходу з процесом з кодом 2.

runConcernDetector повертає нормалізований результат детектор-а, якщо успішно завершено роботу. При будь-якій аномалії він також кидає DetectorError.

## Публічний API

- DetectorError — Сигнал, що detector кинув виняток / повернув невалідний результат → exit 2.
- runConcernDetector — Запускає detector одного concern-а і нормалізує результат. Кидає `DetectorError`
при будь-якій аномалії (→ exit 2).

Native-портовані concern-и (`NATIVE_CONCERNS` registry аддона, E1/E2 фази 5)
мають абсолютний пріоритет — перевіряються ДО резолву `main.mjs`/policy: якщо
`ruleId/concernId` у registry, виклик іде в `runNativeConcern` замість
`import(main.mjs)` (перехідне співіснування двох реалізацій під час міграції
закінчується видаленням JS-гілки — тут вона вже видалена для пілотів).

Інакше — чисті policy-concern-и (rego/template, без ручного `main.mjs`)
оцінюються напряму через `evaluatePolicyConcern` з даних `concern.json` —
генерований `main.mjs` для них не потрібен. Ручний (не-`@generated`)
`main.mjs` — escape-hatch, він завжди має пріоритет. Concern-и без native,
без policy й без main.mjs — помилка конфігурації.

## Сценарії використання

- `npm/scripts/lib/lint-surface/tests/detect.test.mjs` (runConcernDetector — policy-concern без main.mjs; runConcernDetector — fail-open на ToolProvisionError) — required:single відсутній → policy-file-missing, без main.mjs на диску; policy без резолвних files і без main.mjs → DetectorError; lint() кидає ToolProvisionError → порожні violations + warn-діагностика, без DetectorError; звичайна помилка lint() далі кидає DetectorError (fail-open лише для ToolProvisionError); ручний (не-@generated) main.mjs перекриває policy-adapter; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
