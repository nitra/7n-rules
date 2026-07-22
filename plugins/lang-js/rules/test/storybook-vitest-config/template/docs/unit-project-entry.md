---
type: JS Module
title: unit-project-entry.js
resource: plugins/lang-js/rules/test/storybook-vitest-config/template/unit-project-entry.js
docgen:
  crc: c1c437de
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Канонічний зразок запису `unit` у `test.projects` для `storybook.mdc` і `vitest-config`, щоб обидва джерела спиралися на один формат. Файл потрібен як валідний JavaScript-модуль лише для репозиторного lint, а `fix-vitest-config.mjs` читає з нього тільки вміст `export default {...}` і вставляє цей об’єкт як елемент `projects`.

## Поведінка

1. Дає канонічний зразок запису `unit` у списку `test.projects`, щоб інструменти конфігурації мали єдиний орієнтир для вставки.
2. Працює як валідний JavaScript-модуль лише для проходження репозиторного lint, а не як робоча бізнес-логіка.
3. Забезпечує джерело, з якого `fix-vitest-config.mjs` бере тільки експортований об’єкт і перетворює його на елемент масиву `projects`.
4. Не описує і не керує жодними записами у ФС або БД; шлях обробки обмежений читанням вмісту модуля та його подальшим вставленням у конфігурацію.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
