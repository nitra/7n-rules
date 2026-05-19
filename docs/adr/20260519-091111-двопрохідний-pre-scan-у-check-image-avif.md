---
session: c1067437-1e71-478f-a762-d388755ae5a8
captured: 2026-05-19T09:11:11+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/c1067437-1e71-478f-a762-d388755ae5a8.jsonl
---

## ADR Двопрохідний pre-scan у check image-avif

## Context and Problem Statement
`check image-avif` запускав `npx @nitra/minify-image --avif` і rewrite-пасс навіть коли у `.vue`/`.html`-файлах не було жодного raster-посилання, яке треба переписати. Потрібно пропускати весь AVIF-етап, якщо посилань немає.

## Considered Options
* Двопрохідний rewrite: спочатку pre-scan `.vue`/`.html`, потім — AVIF-генерація і rewrite
* Скіп AVIF повністю за відсутності raster-посилань (без rewrite orphan-сиріт)

## Decision Outcome
Chosen option: "Двопрохідний rewrite", because користувач явно обрав цей варіант: pre-scan ходить по `.vue`/`.html` тими ж regexp-ами, що й основний rewrite-пасс; якщо жодного raster-посилання не знайдено — `check()` повертає `0` без запуску `npx --avif`, без rewrite і без cleanup.

### Consequences
* Good, because transcript фіксує очікувану користь: зайвий виклик `npx @nitra/minify-image` не відбувається, якщо репозиторій не має `.vue`/`.html` із raster-посиланнями.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/image-avif/fix/avif_generation/check.mjs` — `hasAnyRasterImage` замінено на `hasAnyVueRasterReference`; функція ходить по `.vue`/`.html` у workspace-пакетах із урахуванням opt-out `disable-avif`
- `npm/rules/image-avif/image-avif.mdc` — версія `1.3` → `1.4`, описано pre-scan як крок 1
- `npm/rules/image-avif/fix/avif_generation/check.test.mjs` — 2 тести адаптовано, 19/19 passed
- AVIF cleanup orphan-сиріт також відкладається до прогону з фактичними raster-посиланнями

---

## ADR Видалення захисту `ignore: ["npm/rules"]` з .n-cursor.json

## Context and Problem Statement
У `.n-cursor.json` було поле `"ignore": ["npm/rules"]`, яке через `npx @nitra/cursor` генерувало блок `## Захищені директорії` у `CLAUDE.md`. Блок забороняв Claude редагувати `npm/rules/`, де живе вся логіка правил пакета. При потребі редагувати `npm/rules/image-avif/` агент не міг цього зробити.

## Considered Options
* Видалити `"ignore": ["npm/rules"]` з `.n-cursor.json` повністю
* Залишити виняток тільки для `npm/rules/image-avif/`

## Decision Outcome
Chosen option: "Видалити `\"ignore\": [\"npm/rules\"]` з `.n-cursor.json` повністю", because користувач явно обрав цей варіант під час сесії; захист було додано у commit `ee5f7d3` ("1.13.38", 2026-05-18) і знято через `Edit` `.n-cursor.json` + `npx @nitra/cursor` для перегенерації `CLAUDE.md`.

### Consequences
* Good, because transcript фіксує очікувану користь: агент може редагувати файли в `npm/rules/` без блокування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `.n-cursor.json` — видалено поле `"ignore": ["npm/rules"]`
- `CLAUDE.md` — перегенеровано через `npx @nitra/cursor`; блок `## Захищені директорії` зник
- Commit із першим введенням захисту: `ee5f7d3` від 2026-05-18, `git log -- .n-cursor.json`
