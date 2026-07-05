---
type: JS Module
title: rule-meta.mjs
resource: npm/scripts/lib/rule-meta.mjs
docgen:
  crc: 361cc286
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Парсер метаданих правила з `npm/rules/<id>/main.json` (data-driven автодетект). Нормалізує поле `auto`, яке може бути константою `RULE_ALWAYS="завжди"`, списком правил-залежностей, обʼєктом із шаблоном `glob` або іменованим предикатом. Поля `lint` у rule-level `main.json` немає — lint-scope декларується per-concern у `concern.json`.

## Поведінка

RULE_ALWAYS — константа безумовної активації правила (`"завжди"`).
parseRuleAutoSpec — нормалізує значення поля `auto` з `main.json` у дискриміновану специфікацію активації правила.
readRuleMetaRaw — зчитує та парсить `main.json` з каталогу правила, повертаючи обʼєкт або `null`.

## Публічний API

RULE_ALWAYS — літерал безумовної активації.
parseRuleAutoSpec — перетворює `auto` у одну з форм: `{ always }`, `{ rules }`, `{ glob }`, `{ predicate, arg }`; нерозпізнаний формат → `null` (= opt-in).
readRuleMetaRaw — зчитує метадані одного правила; відсутній файл, невалідний JSON чи не-обʼєкт → `null`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки парсингу і не пропускає винятків назовні (fail-safe).
- За помилок повертає `null` замість винятку.
