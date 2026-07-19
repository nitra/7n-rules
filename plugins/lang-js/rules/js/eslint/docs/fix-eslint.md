---
type: JS Module
title: fix-eslint.mjs
resource: plugins/lang-js/rules/js/eslint/fix-eslint.mjs
docgen:
  crc: 38b4978d
  model: manual
---

## Огляд

T0-autofix для `js/eslint`, два патерни в порядку застосування. `js-eslint-autofix`:
детермінований прогін лінтерів у fix-режимі (`oxlint --fix` + `eslint --fix`) по файлах, де
детектор знайшов порушення — виправляє лише авто-fixable правила. `js-eslint-mechanical-text-fix`:
для правил, які `--fix` НЕ покриває (suggestion-only у власній реалізації інструментів, перевірено
емпірично на реальних lint-прогонах), але заміна на позначеному `data.line` текстуально однозначна
й безпечна без AST-парсингу. Усе, що лишається непокритим — детектору на повторну перевірку, а
далі LLM-ладдеру. Запис незворотний (поза rollback).

## Поведінка

`js-eslint-autofix`:
- Збирає унікальні файли з порушень концерну, лишає лише js-сімейство (`.mjs/.cjs/.js/.jsx/.ts/.tsx/.vue`).
- Послідовно застосовує `oxlint --fix` (CLI) і `eslint --fix` (через API з `outputFixes`).
- До списку змінених потрапляють лише файли, чий вміст фактично змінився (порівняння до/після).

`js-eslint-mechanical-text-fix`:
- `MECHANICAL_TEXT_FIXES` — реєстр `{ reasons, replace }`: `reasons` покриває обидва формати
  `violation.reason` (eslint `"plugin/rule"`, oxlint `"plugin(rule)"` — той самий rule різні тули
  віддають по-різному); `replace(line)` — чиста функція рядка, `null` якщо шаблон не знайдено.
- Групує порушення за файлом, для кожного цільового `data.line` (1-indexed) застосовує
  відповідну `replace`; рядок без очікуваного шаблону (файл змінився з моменту detect-у) —
  пропускається без гадання.
- Наразі покриває `unicorn/prefer-number-is-safe-integer` (`Number.isInteger` → `Number.isSafeInteger`).

## Публічний API

- `patterns` — масив T0-патернів (`id` / `test` / `apply`), що його споживає центральний fix-pipeline:
  `js-eslint-autofix` (лінтери в fix-режимі), `js-eslint-mechanical-text-fix` (текстові заміни для
  suggestion-only правил).

## Гарантії поведінки

- `js-eslint-autofix`: якщо серед порушень немає js-файлів — лінтери не запускаються, змін немає.
- `js-eslint-mechanical-text-fix`: пише лише файли з реальною зміною рядка (шаблон збігся); не
  чіпає рядки поза `MECHANICAL_TEXT_FIXES`-реєстром.
- Обидва патерни повертають лише фактично змінені файли; перед записом кожен реєструється через
  `recordWrite`.
- Межа CI: модуль належить fix-фазі; у `--no-fix` (CI) не запускається — узгоджено із
  забороною `oxlint --fix`/`eslint --fix` у CI.
