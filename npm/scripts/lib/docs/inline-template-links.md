---
type: JS Module
title: inline-template-links.mjs
resource: npm/scripts/lib/inline-template-links.mjs
docgen:
  crc: 252fb1e1
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

## Огляд

Модуль збагачує текстовий контент, використовуючи конфігурації з package.json.snippet.json та package.json. Функція inlineTemplateLinks замінює текстові посилання на шаблони вбудованими блоками, якщо відповідні файли знаходяться у директорії правил. Функція appendDiscoveredMdcFiles доповнює текст вмістом усіх знайдених файлів `.mdc` з піддиректорій `js/` та `policy/` у директорії правил.

## Поведінка

inlineTemplateLinks замінює посилання на шаблони в тексті на вбудовані блоки з вмістом файлу, якщо ці файли існують у вказаній директорії правил.
appendDiscoveredMdcFiles додає до кінця тексту вміст усіх знайдених файлів `.mdc` з піддиректорій `js/` та `policy/` у директорії правил.

## Публічний API

inlineTemplateLinks — Замінює посилання на шаблони в Markdown на вбудовані блоки, якщо шлях містить `/template/`. Помилка виникає, якщо цільовий файл посилання відсутній.
appendDiscoveredMdcFiles — Додає всі знайдені файли `.mdc` з папок `js/` та `policy/<concern>/`. Файли з `js/` йдуть першими, а потім файли з підпапок `policy/<concern>/` (у алфавітному порядку за `concern`, а потім за назвою файлу).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
