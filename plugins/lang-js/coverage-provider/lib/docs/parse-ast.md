---
type: JS Module
title: parse-ast.mjs
resource: plugins/lang-js/coverage-provider/lib/parse-ast.mjs
docgen:
  crc: f37a8643
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`oxc-parser` замінює `rollup/parseAst` у `parseAst` після влиття `@7n/test` і дає той самий ESTree-shape, на який розраховані споживачі: `type`, числові `start`/`end`, `Literal.raw` і `UnaryExpression.prefix`. Для mutation-валідації адаптер бере `errors[]` від `oxc-parser` і відновлює throw-контракт, щоб синтаксичні помилки поводилися так, як очікують існуючі перевірки.

## Поведінка

1. `parseAst` перетворює ESM-джерело на ESTree-дерево для подальших перевірок і трансформацій.
2. На виході зберігає форму вузлів, потрібну споживачам: `type`, числові межі `start`/`end`, `Literal.raw`, `UnaryExpression.prefix`.
3. Якщо джерело містить синтаксичну помилку, `parseAst` не повертає частковий результат, а перетворює помилку парсера на throw-контракт.
4. Імʼя файла впливає на вибір діалекту, тому `parseAst` використовують для модулів із різними JS/TS-варіантами.
5. `parseAst` свідомо не покриває поведінку rollup-парсера на синтаксичних збоях: замість мовчазної відмінності він піднімає помилку, щоб не ламати валідацію споживачів.

## Публічний API

- parseAst — Парсить ESM-джерело в ESTree-програму.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
