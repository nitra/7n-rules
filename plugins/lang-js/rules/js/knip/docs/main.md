---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/js/knip/main.mjs
docgen:
  crc: e46cd90b
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Lint-поверхня `js/knip`: read-only detector невикористаних залежностей, експортів і файлів через programmatic API knip. Кожен knip-issue стає одним порушенням (`reason` = тип issue, `file`/`line` де доступні); звіт рендерить runner, сам детектор нічого не друкує і не мутує (без `--fix`).

## Поведінка

- `lint(ctx)` будує опції knip (`createOptions` з dist-каталогу пакета — внутрішній util не експортується через `exports`), глушить TTY-прогрес поза `ctx.verbose` і жене `knipMain`.
- Кожен issue з `results.issues` нормалізується у violation: `message` = `knip: <тип> \`<символ>\` — <файл:рядок>`, `severity` warn/error за knip.
- Вбудований ігнор пакетів екосистеми n-rules: unused dependency/devDependency-issue на `@7n/rules` та `@7n/rules-*` (lang-/ci-плагіни) відкидається — їх ставить і веде сам `npx @7n/rules`, код споживача їх не імпортує, тож у кожному consumer-репо це було б хибне спрацювання. Інші типи issue (files, exports) на ці пакети НЕ ігноруються.

## Публічний API

- lint — детектор js/knip: повертає `{ violations }` з нормалізованими knip-issue.
- isNRulesPackageIssue — чи є issue хибним спрацюванням на пакет екосистеми n-rules (експортовано для тестів).

## Гарантії поведінки

- Read-only: knip запускається без `--fix`, жодних мутацій ФС/БД.
- Не друкує звіт — рендеринг на боці runner-а.
