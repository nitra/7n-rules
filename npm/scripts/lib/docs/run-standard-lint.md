---
type: JS Module
title: run-standard-lint.mjs
resource: npm/scripts/lib/run-standard-lint.mjs
docgen:
  crc: 2b275963
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 90
---

## Огляд

Спільна точка входу для канонічних `lint-<rule>` підкоманд `@nitra/cursor`. Файл серіалізує та дедуплікує запуски лінту через `withLock`. `ruleId` визначається зі шляху незалежно від глибини виклику (наприклад, `rules/<id>`). Це дозволяє уніфікувати крос-cutting концерни. Інтеграція з боку правила виглядає так:
* import { runStandardLint } from '../../scripts/lib/run-standard-lint.mjs'
 *
 * async function runLintFooSteps { ... }
 *
 * export function lint { return runStandardLint }

## Поведінка

lint: Викликає стандартизований лінт, використовуючи шлях каталогу правила для визначення його ідентифікатора.
runStandardLint: Серіалізує та дедуплікує запуск лінту для заданого правила, використовуючи ідентифікатор, виведений зі шляху каталогу правила.

## Публічний API

lint — є спільною точкою входу для канонічних `lint-<rule>` підкоманд `@nitra/cursor`. Він ініціює серіалізацію та дедуплікацію запусків лінтингу для вказаних файлів, забезпечуючи централізоване управління крос-cutting концернами.

runStandardLint — виконує стандартний лінтинг у директорії, приймаючи контекст директорії та функцію, що описує кроки лінтингу.

Приклад інтеграції:
```js
import { runStandardLint } from '../../scripts/lib/run-standard-lint.mjs'

async function runLintFooSteps { ... }

export function lint { return runStandardLint }
```

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Кешує результати в межах одного прогону.
