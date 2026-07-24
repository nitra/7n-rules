---
type: JS Module
title: main.mjs
resource: npm/rules/image-avif/avif_generation/main.mjs
docgen:
  crc: 7e73761a
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 85
  issues: internal-name:walkDir,anchor-miss:(image-avif.mdc),judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

scanAvif — read-only детектор AVIF для `.vue` і `.html`: він знаходить raster-посилання і класифікує їх як `avif-needs-rewrite`, `avif-missing` або `avif-orphan`. `AVIF_NEEDS_REWRITE`, `AVIF_MISSING`, `AVIF_ORPHAN`, `MINIFY_PACKAGE_NAME`, `CLEANUP_EXTRA_IGNORE_DIR_NAMES` — публічні константи для цих перевірок і спільних правил сканування. `lint --no-fix` лише звітує і не мутує tree, а переписування посилань, AVIF-генерацію та прибирання сиріт виконує окремий T0-fix `fix-avif_generation.mjs`. Cache працює в межах одного прогону.

## Поведінка

`scanAvif` запускає спільний read-only потік для detector-а й T0-fix: спершу перевіряє, чи є в репозиторії хоч одне raster-посилання, придатне для AVIF-етапу, далі збирає зв’язки між `.vue`/`.html`, `.avif` і package.json, а потім формує результати для лінту без жодної мутації дерева. Якщо raster-посилань немає, весь етап пропускається; якщо в workspace немає workspaces або `.vue`-файлів, AVIF-правило для проєкту теж не активується.

`MINIFY_PACKAGE_NAME` позначає пакет, через який читається opt-out у `package.json`: коли пакет вимикає AVIF-перевірку, його шаблони не беруть участі в перевірці посилань, а його `.avif` не можна автоматично вважати сиротами. Це захищає файли, що можуть використовуватись через alias, runtime-обчислення або зовнішні посилання, які статичний скан тут не бачить.

`CLEANUP_EXTRA_IGNORE_DIR_NAMES` додає спільні виключення для обходу, щоб `scanAvif` і `lint` не зачіпали каталоги, які не мають впливати на AVIF-діагностику.

`AVIF_NEEDS_REWRITE` використовується для випадків, коли raster-посилання вже має доступний `.avif`-двійник, але посилання ще не переписане на нього; `AVIF_MISSING` — коли потрібного `.avif`-двійника немає; `AVIF_ORPHAN` — коли `.avif` лишився без живих посилань у відсканованих шаблонах.

`lint` лише звітує ці три стани як violations і не виконує генерацію AVIF, переписування посилань чи видалення сиріт; ці дії лишаються за окремим T0-fix. Маркери повідомлень прив’язані до `image-avif.mdc`, а сам detector спирається на `package.json` як джерело opt-out-конфігурації.

## Публічний API

- AVIF_NEEDS_REWRITE — Стабільні reasons.
- AVIF_MISSING — Стабільний reason: для растрового зображення відсутній згенерований AVIF-двійник.
- AVIF_ORPHAN — Стабільний reason: AVIF-файл лишився без растрового джерела — кандидат на cleanup.
- MINIFY_PACKAGE_NAME — Імʼя CLI-пакета, який генерує AVIF (використовує T0-fix).
- CLEANUP_EXTRA_IGNORE_DIR_NAMES — Імена каталогів, які cleanup НЕ зачіпає, бо це артефакти збірки/нативні
платформи — `.avif` всередині — це продукт попереднього `bun run build`/Capacitor sync,
а не кандидати на видалення. `walkDir` уже скіпає `node_modules`, `.git`, `dist`,
`coverage`, `.turbo`, `.next` — додатково для cleanup ігноруємо ще ці.
- scanAvif — Чистий read-only скан усього AVIF-етапу (без npx, без запису, без unlink). Спільний
для detector-а (→ violations) і T0-fix (виконує генерацію, потім rescan + write/unlink).
- lint — Read-only detector AVIF-етапу: ЗВІТУЄ потрібні rewrite-и (`avif-needs-rewrite`),
відсутні `.avif`-двійники (`avif-missing`) і `.avif`-сироти (`avif-orphan`).
Не валідує image-compress cache/dependency policy — це окреме правило.

## Гарантії поведінки

- Кешує результати в межах одного прогону.
