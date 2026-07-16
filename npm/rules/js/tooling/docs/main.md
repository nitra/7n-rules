---
type: JS Module
title: main.mjs
resource: npm/rules/js/tooling/main.mjs
docgen:
  crc: da55182a
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Властивості, що визначають шляхи до канонічних JSON-конфігурацій для `oxlint` та `knip` доступні через `OXLINT_CANONICAL_JSON_PATH` та `KNIP_CANONICAL_JSON_PATH`. Модуль надає можливість перевірити, чи відповідають конфігурації, визначені у `.oxlintrc.json`, офіційним стандартам, описаним у `oxlint-canonical.json`, за допомогою функції `verifyOxlintRcAgainstCanonical`. Також може бути здійснена валідація згідно з конфігурацією `knip-canonical.json`.

## Поведінка

OXLINT_CANONICAL_JSON_PATH — надає шлях до канонічного конфігураційного файлу oxlint.
KNIP_CANONICAL_JSON_PATH — надає шлях до канонічного конфігураційного файлу knip.
verifyOxlintRcAgainstCanonical — перевіряє, чи відповідає конфігураційний файл .oxlintrc.json канонічним стандартам, порівнюючи його з конфігураціями oxlint-canonical.json.

## Публічний API

- OXLINT_CANONICAL_JSON_PATH — Вказує на основний конфіг `oxlint` для підтвердження коректності в цьому пакеті.
- KNIP_CANONICAL_JSON_PATH — Вказує на основний конфіг `knip`, який автоматично додається до кореня проєкту-споживача, якщо його там немає.
- verifyOxlintRcAgainstCanonical — Порівнює конфігураційний файл `.oxlintrc.json` із канонічною версією, переконавшись, що всі правила з канону присутні, а інші поля відповідають.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
