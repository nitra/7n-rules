---
type: JS Module
title: lint-findings.mjs
resource: npm/rules/js/js/lint-findings.mjs
docgen:
  crc: cb60407d
  score: 100
---

parseOxlint
Парсить текст у вивід oxlint

parseEslint
Парсить текст у вивід eslint

classifyFindings
Розділяє findings на introduced та preExisting

renderFindings
Форматує та рендерить звіт про findings

## Поведінка

parseOxlint
Парсить текст у вивід oxlint

parseEslint
Парсить текст у вивід eslint

classifyFindings
Розділяє findings на introduced та preExisting

renderFindings
Форматує та рендерить звіт про findings

## Публічний API

parseOxlint — перетворює JSON у дані або повертає null при невдалій обробці.
parseEslint — перетворює JSON у дані або повертає null при невдалій обробці.
eslintResultsToFindings — конвертує результати ESLint programmatic API у нормалізовані findings (без JSON-парсингу).
classifyFindings — групує знайдені проблеми на категорії доданих/існуючих.
renderFindings — формує звіт, який включає виправлені проблеми та застарілі проблеми.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Не звертається до мережі.
