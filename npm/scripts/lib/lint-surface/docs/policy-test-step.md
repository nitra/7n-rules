---
type: JS Module
title: policy-test-step.mjs
resource: npm/scripts/lib/lint-surface/policy-test-step.mjs
docgen:
  crc: dcfe003c
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл запускає unit-тести для policy-concern-ів із `policy.engine: 'rego'` у `concern.json`, щоб `<concern>_test.rego` перевіряв саме source-validation concern перед policy codegen/evaluate. Він read-only знаходить релевантні concern-и, виконує `conftest verify`, перехоплює помилки без винятків назовні, а падіння тестів нормалізує в lint-порушення з причиною `rego-unit-test-failed`.

## Поведінка

1. `runPolicyUnitTests` знаходить у каталозі правил policy-concern-и з `policy.engine: 'rego'` у `concern.json` і наявними unit-тестами для цього concern-а.

2. Для кожного знайденого rego-concern-а запускає policy unit-tests через `conftest verify` по каталогу concern-а.

3. Якщо `conftest` недоступний, завершує перевірку fail-safe як пропущену без створення порушень.

4. Якщо unit-tests проходять успішно, повертає порожній список порушень для відповідного concern-а.

5. Якщо unit-tests падають, перетворює кожен failure на lint-порушення з причиною `rego-unit-test-failed`, прив’язкою до тестового файлу concern-а та severity `error`.

6. Підтримує обмеження перевірки вибраними rule-id, щоб delta-lint запускав unit-tests лише для релевантних змін.

7. Повертає сукупний результат: знайдені порушення, ознаку пропущеного запуску та кількість реально виконаних прогонів.

8. Не змінює файлову систему чи зовнішній стан; працює як read-only етап перед policy codegen/evaluate.

## Публічний API

- runPolicyUnitTests — запускає unit-тести policy для всіх або вибраних rego-concern-ів, спираючись на конфігурацію concern.json.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
