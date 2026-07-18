---
type: JS Module
title: policy-lint-adapter.mjs
resource: npm/scripts/lib/lint-surface/policy-lint-adapter.mjs
docgen:
  crc: 1e527329
  model: openai-codex/gpt-5.5
  score: 80
  issues: internal-name:resolveTargetFiles,internal-name:runConftestBatch,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`evaluatePolicyConcern` перетворює policy-поверхню concern-а — Rego через conftest або `template deep-subset` — на уніфікований `LintResult` зі структурованими violations. Існує як adapter для generated detector-а: generated `main.mjs` policy-concern-а викликає саме цю функцію згідно зі spec `2026-06-29 §Policy Codegen`.

Переоформлює перевірену логіку `run-rule.mjs` у результат detector-а, не дублюючи її: використовує ту саму поведінку вибору файлів через `resolveTargetFiles`, виконання conftest через `runConftestBatch` і template-перевірок через `template-checks`, щоб policy-рушії повертали сумісний `LintResult`.

## Поведінка

1. `evaluatePolicyConcern` приймає опис policy-concern-а й повертає уніфікований результат лінту зі списком порушень для подальшої обробки generated detector-ом.

2. Спочатку визначає цільові файли concern-а відносно робочого каталогу, щоб застосувати policy лише до релевантної поверхні правила.

3. Якщо цільових файлів немає, а concern очікує обовʼязковий single-файл, додає порушення про відсутній policy-файл із повідомленням за замовчуванням або з переданим override-повідомленням.

4. Якщо цільових файлів немає і файл не є обовʼязковим single-target, повертає порожній список порушень, бо перевіряти нічого.

5. Для template-перевірки читає template-очікування concern-а. Якщо очікування не задані, повертає поточний результат без порушень.

6. Для кожного target-файлу в template-режимі порівнює фактичний вміст із declarative template-очікуваннями: обовʼязковими фрагментами, заборонами та вимогами на наявність. Кожну невідповідність оформлює як `policy-template-mismatch`.

7. Для Rego-перевірки запускає policy concern-а через conftest-поверхню (`await runConftestBatch`, async), передаючи доступні template-дані як супровідний контекст і прокидаючи `ctx.signal` — щоб зберегти поведінку існуючої policy-логіки й водночас підтримати скасування у parallel lane `detectAll()`.

8. Кожен deny-результат Rego оформлює як `policy-deny` із повідомленням policy та, якщо доступно, відносним шляхом до файла-порушника.

9. Усі порушення мають однакову структуру з rule, concern, reason, message і severity `error`, щоб різні рушії policy повертали сумісний `LintResult`.

10. Шляхи файлів у порушеннях нормалізуються до відносного POSIX-вигляду, щоб звіти були стабільними між платформами.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).

**Плагіни:** у `runConftestBatch` передається `policyDirAbs: cfg.policyDir` — policy-тека concern-а може жити поза вбудованим rules/ ядра.
