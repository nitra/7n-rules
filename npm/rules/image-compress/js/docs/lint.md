---
type: JS Module
title: lint.mjs
resource: npm/rules/image-compress/js/lint.mjs
---

Адаптер підключає `@nitra/minify-image` до єдиної точки входу `n-cursor lint image-compress`.

## Поведінка

1. У fix-режимі запускає `npx @nitra/minify-image --src=. --write`.
2. У read-only режимі запускає `npx @nitra/minify-image --src=. --json`.
3. Парсить JSON-звіт і падає, якщо `summary.needsCompression > 0`.
4. Повертає exit code дочірнього процесу або reporter exit code.

## Публічний API

`lint` — оркестраторний entrypoint для правила `image-compress`.

## Гарантії поведінки

- Read-only режим не стискає файли і не пише cache, покладаючись на `--json` detect-mode у `@nitra/minify-image`.
- Fix-режим делегує запис тільки `@nitra/minify-image --write`.
- За помилки запуску або невалідного JSON повертає ненульовий exit code.
