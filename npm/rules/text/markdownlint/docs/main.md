---
type: JS Module
title: main.mjs
resource: npm/rules/text/markdownlint/main.mjs
docgen:
  crc: 08324688
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 95
  issues: anchor-miss:(text.mdc),judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл забезпечує markdown-концерн для двох поверхонь: `policy` перевіряє наявність `.markdownlint-cli2.jsonc`, а `lint` запускає markdownlint-cli2 для Markdown/MDC-файлів. Він потрібен, щоб delta- та full-режими однаково застосовували правила markdownlint до релевантних файлів і повертали повідомлення з маркером ``.

## Поведінка

1. `lint` перевіряє markdown-концерн у двох площинах: наявність конфігурації markdownlint і фактичну якість Markdown-документів.

2. `lint` спочатку додає до результату порушення політики, якщо в проєкті немає `.markdownlint-cli2.jsonc`.

3. `lint` у delta-режимі перевіряє лише передані Markdown-файли, а у full-режимі — всі файли Markdown і MDC у робочій директорії.

4. `lint` не запускає markdownlint, якщо серед цільових файлів немає Markdown-документів, і повертає лише вже зібрані порушення політики.

5. `lint` приглушує прямий вивід markdownlint, щоб detector повертав уніфікований результат lint-перевірки без шуму в консолі.

6. `lint` додає порушення з маркером ``, якщо markdownlint знаходить проблеми у Markdown або MDC-файлах.

7. `lint` повертає спільний список порушень для policy- та lint-поверхонь, щоб markdown-концерн поводився як один цілісний detector.

## Публічний API

- lint — знаходить для `text.mdc` маркери повідомлень, контролює наявність policy-конфігурації та запускає markdownlint; результати обох етапів збирає в один звіт lint.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
