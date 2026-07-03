---
type: JS Module
title: violation-reporter.mjs
resource: npm/scripts/lib/lint-surface/violation-reporter.mjs
docgen:
  crc: b8010de2
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей модуль є drop-in заміною для `createCheckReporter`, призначеною для міграції check-concern'ів у detector-и. Він ініціалізує спеціалізований репортер, який замість виведення статусу (pass/fail) накопичує об'єкти `LintViolation[]`. Після процесу перевірки, для визначення загального результату, повинен викликатися метод `reporter.result`, який повертає повний список зібраних порушень, на відміну від попередньої реалізації, що повертала `exit code`.

## Поведінка

1. Викликати функцію createViolationReporter, передаючи їй контекст concern-а.
2. Функція створює об'єкт репортера, що накопичує об'єкти LintViolation.
3. У разі успіху, викликаний метод pass не виконує жодних дій.
4. У разі виявлення порушення, викликаний метод fail з повідомленням та необов'язковими опціями (string або object) додає об'єкт LintViolation до внутрішнього списку, використовуючи ID concern-а як причину за замовчуванням.
5. Для отримання результату виконання, викликаний метод result повертає об'єкт, що містить список зібраних порушень.

## Публічний API

* createViolationReporter — інструмент для фіксації знайдених у коді помилок (порушень) та повернення загального результату перевірки.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
