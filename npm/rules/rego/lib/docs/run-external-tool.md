---
type: JS Module
title: run-external-tool.mjs
resource: npm/rules/rego/lib/run-external-tool.mjs
docgen:
  crc: 0f1da640
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл потрібен як спільна логіка для `opa_check` і `regal`: він вирівнює вибір цілей для обох read-only rego-детекторів — або конкретні `.rego` з `ctx.files`, або весь policy-корінь `npm/rules`, коли явних файлів немає. `FULL_TARGET="npm/rules"` — константа для спільного кореня policy-дерева. Також тут зосереджені `resolveTargets` і `runStep`, щоб обидва `main.mjs` мали однаковий контракт поведінки під час запуску зовнішнього кроку та обробки його завершення.

## Поведінка

- `FULL_TARGET` — рядок `"npm/rules"`, що задає корінь policy-дерева для full-режиму, коли немає `ctx.files`.
- `REGO_EXT_RE` — фільтр для вибору лише `.rego`-файлів із delta-списку.
- `resolveTargets` — повертає цілі для запуску: або конкретні `.rego`-файли з `ctx.files`, або `FULL_TARGET`, якщо корінь існує; інакше повертає порожній список.
- `runStep` — запускає один зовнішній крок і повертає код завершення разом із обрізаним об’єднаним виводом stdout/stderr; якщо запуск не вдався, повертає помилку як output.

## Публічний API

- FULL_TARGET — рядок `npm/rules`, який позначає корінь policy-дерева для full-режиму, якщо він є.
- REGO_EXT_RE — фільтр для вибору лише `.rego`-файлів із delta-списку під час `lint`.
- resolveTargets — визначає, що саме запускати: змінені `.rego`-файли або корінь policy-дерева в full-режимі, якщо він присутній.
- runStep — виконує один крок зовнішнього tool і повертає його `status` та `output`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).

**Сусідній policy-файл для тестів.** У delta-режимі `resolveTargets` для кожного `X_test.rego` додає наявний сусідній `X.rego`: тест-файл імпортує свій policy-пакет, і без нього regal хибно флагує `unresolved-import`.
