---
type: JS Module
title: docgen-gen.mjs
resource: npm/rules/doc-files/js/docgen-gen.mjs
docgen:
  crc: 2d3245b9
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Огляд
Цей модуль містить логіку для структурної обробки та генерації документів. Він керує вилученням ключових метаданих (захищеної секції) з документа, встановленням параметрів генерації та визначенням якості створеного контенту.

Поведінка
splitProtected відокремлює захищену секцію "Призначення" від основного тексту документа.
insertProtected вставляє захищену секцію "Призначення" у фіксовану позицію після основного заголовка.
scoreDoc оцінює якість згенерованого документа.
DEFAULT_LOCAL_MODEL встановлює модель за замовчуванням для генерації документа.
generateDoc виконує повний процес генерації документа з вихідного файлу, включаючи оцінку та можливі повторні спроби.
(abie.mdc)
Кешування відбувається у межах одного прогону.

## Поведінка

splitProtected відокремлює захищену секцію "Призначення" від основного тексту документа.
insertProtected вставляє захищену секцію "Призначення" у фіксовану позицію після основного заголовка.
scoreDoc обчислює якість згенерованого документа, оцінюючи його за набором критеріїв.
DEFAULT_LOCAL_MODEL визначає модель за замовчуванням для генерації документа.
generateDoc виконує повний процес генерації документа з вихідного файлу, включаючи оцінку та можливі повторні спроби.

## Публічний API

I need a specific file to write the behavioral documentation for. Please provide the code file, and I will convert the provided list into concise, Ukrainian behavioral documentation following all your strict rules.

## Гарантії поведінки

- Кешує результати в межах одного прогону.
