---
type: JS Module
title: main.mjs
resource: npm/rules/image-compress/check/main.mjs
docgen:
  crc: 94bc9b7f
  model: manual
---

## Огляд

Read-only detector image-compress/check: перевіряє синхронність image-файлів із
`.n-minify-image.tsv` через `@nitra/minify-image --json`, запущений під `bunx` (не `npx`) —
пакет використовує `Bun.Image` (bun-only global), недоступний у Node.

## Поведінка

1. Резолвить `bunx` через `resolveCmd` (абсолютний шлях). Якщо `bunx` відсутній у PATH —
   detector пропускається з info-діагностикою (0 violations), без fail.
2. Інакше запускає `bunx @nitra/minify-image --src=. --json` і парсить JSON-звіт.
3. Якщо запуск інструмента чи парсинг JSON провалюється — репортує `tool-error`.
4. Якщо `summary.needsCompression > 0` — репортує `needs-compression` з кількістю файлів, що
   потребують стиснення, і підказкою запустити `n-rules lint image-compress` локально.

## Публічний API

- `lint(ctx)` — detector image-compress/check.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД), стиснення (`--write`) — окремий fix.
- Graceful degradation за відсутності `bunx` у PATH — info-діагностика, не fail.
