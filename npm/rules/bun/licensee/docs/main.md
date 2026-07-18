---
type: JS Module
title: main.mjs
resource: npm/rules/bun/licensee/main.mjs
docgen:
  crc: 6c6685e8
  model: manual
---

## Огляд

Read-only detector `bun/licensee`: перевіряє ліцензії npm-залежностей проєкту через зовнішній інструмент `licensee` (`bun x licensee`), звіряючи їх з allowlist у `.licensee.json`. Розрізняє два принципово різні провали: `licensee` знайшов реально заборонену ліцензію (`license-violation`) — і `licensee` сам впав з помилкою (`licensee-crashed`), наприклад через несумісність `@npmcli/arborist` (яким він читає `node_modules`) з деревом, зібраним `bun install`.

## Поведінка

1. Якщо `.licensee.json` відсутній — `licensee-config-missing`; генерація конфігу — окремий T0-фікс (`fix-licensee.mjs`), не тут.
2. Якщо `bun` не знайдено в PATH — `bun-missing`.
3. Запускає `bun x licensee --production --errors-only` (без `--quiet` — реальне порушення потребує деталі: ім'я/версія/ліцензія пакета, які `licensee` пише в stdout через `print()`).
4. Статус 0 — без порушень.
5. Статус ≠ 0 і є вивід у **stderr** — трактується як crash/`die()` самого `licensee` (invalid config або необроблений виняток усередині тула), НЕ як ліцензійне порушення: `licensee-crashed`, повідомлення включає stderr і підказку перевірити вручну `bunx licensee --production`.
6. Статус ≠ 0 і stderr порожній, є вивід у **stdout** — це справжній `NOT APPROVED`-звіт від `licensee` (`--errors-only` друкує лише невідповідні пакети): `license-violation` з деталлю пакета/ліцензії у повідомленні.

## Публічний API

- `lint(ctx)` — detector-контракт unified lint surface; повертає `{ violations }`.

## Гарантії поведінки

- Read-only: не пише `.licensee.json` і не змінює `node_modules`/lockfile сам (побічний ефект `bun x` — авто-встановлення пакета `licensee`, якщо відсутній у bunx-кеші, — керується bun, не цим модулем).
- Канал stdout/stderr — єдиний сигнал розрізнення crash vs реальне порушення; текстові евристики за вмістом повідомлення не використовуються.
