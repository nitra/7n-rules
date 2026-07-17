---
type: JS Module
title: main.mjs
resource: npm/rules/text/markdownlint/main.mjs
docgen:
  crc: 6aec4713
  model: manual
---

## Огляд

Multi-surface detector `text/markdownlint`: `policy` перевіряє наявність `.markdownlint-cli2.jsonc`, `lint` запускає сам `markdownlint-cli2` (delta — по `ctx.files`, full — за glob `**/*.md`/`**/*.mdc`) і повертає обидва результати в одному `LintResult`.

## Поведінка

1. Policy-перевірка (`evaluatePolicyConcern`) додає порушення, якщо `.markdownlint-cli2.jsonc` відсутній.
2. Якщо серед цільових файлів немає Markdown/MDC — `markdownlint-cli2` не запускається, повертаються лише policy-порушення.
3. `logMessage` (banner, `Finding:`/`Found:`/`Linting:`/`Summary:` прогрес-текст) — no-op, не деталь порушення.
4. `logError` (один готовий рядок на порушення від дефолтного форматера markdownlint-cli2: `<file>:<line>:<col> <rule> <опис> [<деталь>]`) — накопичується в масив і вбудовується у violation-повідомлення. Без цього LLM fix-worker (і non-verbose підсумок) бачив лише голе "markdownlint знайшов порушення", без файлу/рядка/правила.
5. Ненульовий exit-код `markdownlint-cli2` → одне порушення `reason: 'markdownlint'` з накопиченою деталлю.

## Публічний API

- `lint(ctx)` — detector-контракт unified lint surface; повертає `{ violations }` (policy + lint-порушення разом).

## Гарантії поведінки

- Read-only: не пише `.markdownlint-cli2.jsonc` сам — генерація конфігу окремим T0 (не в цьому detector-і).
- `logError`-деталь — єдине джерело причини провалу; текстові евристики за кодом виходу не використовуються.
