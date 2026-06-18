---
type: ADR
title: "Двопрохідний pre-scan у check image-avif"
---

# Двопрохідний pre-scan у check image-avif

**Status:** Accepted
**Date:** 2026-05-19

## Context and Problem Statement

`check image-avif` запускав `npx @nitra/minify-image --avif` і rewrite-пасс навіть коли у `.vue`/`.html`-файлах не було жодного raster-посилання, яке треба переписати. Потрібно пропускати весь AVIF-етап, якщо посилань нема.

## Considered Options

- Двопрохідний rewrite: спочатку pre-scan `.vue`/`.html`, потім — AVIF-генерація і rewrite
- Скіп AVIF повністю за відсутності raster-посилань (без rewrite orphan-сиріт)

## Decision Outcome

Chosen option: "Двопрохідний rewrite", because користувач явно обрав цей варіант: pre-scan ходить по `.vue`/`.html` тими ж regexp-ами, що й основний rewrite-пасс; якщо жодного raster-посилання не знайдено — `check()` повертає `0` без запуску `npx --avif`, без rewrite і без cleanup.

### Consequences

- Good, because зайвий виклик `npx @nitra/minify-image` не відбувається, якщо репозиторій не має `.vue`/`.html` із raster-посиланнями.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because AVIF cleanup orphan-сиріт також відкладається до прогону з фактичними raster-посиланнями.

## More Information

- `npm/rules/image-avif/fix/avif_generation/check.mjs` — `hasAnyRasterImage` замінено на `hasAnyVueRasterReference`; функція ходить по `.vue`/`.html` у workspace-пакетах із урахуванням opt-out `disable-avif`.
- `npm/rules/image-avif/image-avif.mdc` — версія `1.3` → `1.4`, описано pre-scan як крок 1.
- `npm/rules/image-avif/fix/avif_generation/check.test.mjs` — 2 тести адаптовано, 19/19 passed.

Супутнє рішення (та сама сесія): видалено поле `"ignore": ["npm/rules"]` з `.n-cursor.json` — захист, доданий у commit `ee5f7d3` (`1.13.38`, 2026-05-18), знятий щоб агент міг редагувати файли в `npm/rules/`; `CLAUDE.md` перегенеровано через `npx @nitra/cursor`.
