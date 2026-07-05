---
type: JS Module
title: default-worker.mjs
resource: npm/scripts/lib/lint-surface/default-worker.mjs
docgen:
  crc: 2a2fde4b
  model: openai-codex/gpt-5.5
---

## Огляд

Файл надає дефолтний LLM fix-worker для unified lint surface: `fixWorker` є адаптером до `runAgentFix` під контракт `fixWorker → { touchedFiles, telemetry? }`. Він існує як запасний обробник для concern-ів без власного `fix-worker.mjs`, повертає central pipeline-у змінені файли й опційну telemetry та не пише самостійно у ФС/БД. Записи LLM-процесу проходять через central write-guard як `onCapture = ctx.recordWrite`, щоб `pre-image` потрапляв у central snapshot до запису, а rollback міг відкочувати ці правки. Worker виконує один attempt, а успіх визначає повторний canonical re-detect runner-а.

## Поведінка

1. `fixWorker` приймає набір lint-порушень і контекст виправлення як дефолтний LLM-обробник для unified lint surface.

2. Перетворює знайдені порушення на текстове завдання для LLM, щоб агент отримав зрозумілий опис проблем, які треба виправити.

3. Запускає Pi-агента для внесення правок за правилом, concern-ом, робочою текою, вибраною моделлю, tier-ом і доступним feedback.

4. Передає механізм фіксації записів у central pipeline, щоб write-guard зберігав pre-image до зміни файлів і rollback rung-а міг відкочувати також LLM-правки.

5. Трактує один запуск агента як один attempt: сам `fixWorker` не визначає остаточний успіх виправлення, бо це робить canonical re-detect runner після повторної перевірки.

6. Якщо агент повертає помилку, `fixWorker` зупиняє виконання помилкою, щоб pipeline не вважав attempt успішним.

7. Повертає список змінених файлів і, за наявності, telemetry для подальшої обробки central pipeline-ом.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
