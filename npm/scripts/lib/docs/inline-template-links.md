---
type: JS Module
title: inline-template-links.mjs
resource: npm/scripts/lib/inline-template-links.mjs
docgen:
  crc: e1bed533
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Модуль інтегрує зовнішній контент у текстовий вивід, використовуючи конфігурації з `package.json.snippet.json` та `package.json`. Він замінює посилання на шаблони в тексті на їхній вміст за допомогою `inlineTemplateLinks` та доповнює текст вмістом усіх знайдених файлів `.mdc` з директорій `js/` та `policy/<concern>/` за допомогою `appendDiscoveredMdcFiles`.

## Поведінка

inlineTemplateLinks замінює посилання на шаблони в тексті на вбудовані блоки з вмістом відповідних файлів.
appendDiscoveredMdcFiles додає вміст усіх знайдених файлів \*.mdc з директорій js/ та policy/<concern>/ до наданого тексту.

## Публічний API

inlineTemplateLinks — Замінює посилання у Markdown, що містять `/template/`, на вбудовані блоки, зчитуючи вміст з вказаного файлу. Викидає помилку, якщо цільове посилання не знайдено.
appendDiscoveredMdcFiles — Додає всі знайдені файли з розширенням `.mdc` з підкаталогів `js/` та `policy/<concern>/`. Спочатку додаються файли з `js/` (у алфавітному порядку), а потім файли з підкаталогів `policy/` (у алфавітному порядку за назвою `concern`, а потім за назвою файлу).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
