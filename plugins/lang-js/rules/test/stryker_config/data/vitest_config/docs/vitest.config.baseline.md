---
type: JS Module
title: vitest.config.baseline.js
resource: plugins/lang-js/rules/test/stryker_config/data/vitest_config/vitest.config.baseline.js
docgen:
  crc: fa3e134e
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл задає канонічний Vitest-конфіг пакета для запуску тестів у Node environment, із pool forks та v8 coverage. Він існує, щоб перевірки пакета виконувалися однаково, а coverage формувався через v8; шлях node_modules свідомо виключено з обробки.

## Поведінка

1. Визначає єдиний канон запуску Vitest для пакета в середовищі Node.
2. Охоплює тести поруч із кодом і окремі верхньорівневі test suites, щоб однаково перевіряти unit та integration сценарії.
3. Свідомо пропускає `node_modules`, зібрані артефакти та тимчасові sandbox-копії Stryker, щоб не запускати зовнішні або нерелевантні тести.
4. Ізолює виконання test-файлів в окремих процесах, щоб зміна робочої директорії в одній фікстурі не впливала на сусідні перевірки; це підтримує канон безпечних тимчасових директорій із (test.mdc).
5. Формує coverage через v8 у форматах для машинного збору та короткого людського підсумку.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `node_modules`.
