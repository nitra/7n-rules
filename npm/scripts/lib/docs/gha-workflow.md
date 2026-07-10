---
type: JS Module
title: gha-workflow.mjs
resource: npm/scripts/lib/gha-workflow.mjs
docgen:
  crc: a992da4a
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Надає функції для структурного аналізу конфігурацій GitHub Actions workflow (`.yml`). Дозволяє парсити YAML, витягувати значення з кроків, зокрема `uses:` та `run:`, а також перевіряти відповідність структури workflow певним вимогам. Це забезпечує цілеспрямований аналіз конфігурацій, замінюючи пошук підрядків у сирому тексті.

## Поведінка

parseWorkflowYaml парсить вміст workflow YAML у об'єкт, повертаючи `null` у разі синтаксичної помилки.
flattenWorkflowSteps збирає плоский список усіх кроків з усіх job'ів workflow, додаючи метадані про job та індекс кроку.
getStepUses отримує значення `uses` для заданого кроку.
getStepRun отримує текст команди з поля `run` заданого кроку, об'єднуючи багаторядкові значення.
eventPathsIncludeExact перевіряє, чи містить `on.push.paths` або `on.pull_request.paths` точне значення шляху.
verifyLintJsWorkflowStructure перевіряє структуру workflow для відповідності вимогам, зокрема наявність `actions/checkout@v6` з `persist-credentials: false`, використання `setup-bun-deps` та наявність команд `bunx oxlint`, `bunx eslint .`, `bunx jscpd .` у кроках `run`.
anyRunStepIncludes перевіряє, чи містить хоча б один `run` будь-якого кроку підрядок, який вказує на певний інструмент.

## Публічний API

parseWorkflowYaml — перетворює YAML-файл робочого процесу у структурований об'єкт; повертає `null` при помилці синтаксису.
flattenWorkflowSteps — об'єднує всі кроки, визначені у всіх завданнях.
getStepUses — отримує значення, вказане у полі `uses:` для кроку.
getStepRun — отримує команду, яку виконує крок (може бути одним або багатьма рядками).
eventPathsIncludeExact — визначає, чи містить список шляхів події (push або pull_request) точне збігання.
verifyLintJsWorkflowStructure — перевіряє наявність необхідних компонентів у файлі `lint-js.yml` (наприклад, `checkout@v6`, `persist-credentials`, `setup-bun-deps`, виконання команд).
anyRunStepIncludes — виявляє, чи містить будь-який рядок виконання (`run`) певний підрядок.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
- Свідомо пропускає шляхи: `.github`, `.git`.
