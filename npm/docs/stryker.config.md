---
type: JS Module
title: stryker.config.mjs
resource: npm/stryker.config.mjs
docgen:
  crc: cb7d2219
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл описує конфігурацію Stryker для `@7n/rules`, щоб запускати `vitest-runner` з `perTest`-покриттям на production-коді в `scripts/`, `rules/` і `bin/`, не зачіпаючи фікстури та baseline-шаблони.

## Поведінка

1. Запускає мутаційне тестування коду `@7n/rules` через `vitest-runner`, щоб оцінити, як добре тести виявляють зміни в production-логіці.
2. Перевіряє лише лінії, які реально зачіпаються тестами, щоб зосередити аналіз на корисному сигналі, а не на повному повторному прогоні всього набору.
3. Зберігає службові артефакти звіту в `reports/stryker/`, зокрема `mutation.json`, щоб результат можна було переглядати й обробляти далі.
4. Підтримує інкрементальний режим через `incremental.json`, щоб повторні запуски відновлювали попередній стан мутаційної оцінки.
5. Мутує основний production-код у `scripts/`, `rules/` і `bin/`, а каталоги `**/data/**` і `**/template/**` та `**/templates/**` не включає.
6. Окремо включає `rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs`.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
