# Патч @nitra/minify-image — інвалідація AVIF через поле avifHash

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

`@nitra/minify-image` використовує кеш `.n-minify-image.tsv` (4 колонки: `path\thash\toriginalSize\tsize`). При виклику `--write` без `--avif` після попереднього `--write --avif` старий `.avif`-файл залишається в git, хоча вихідний PNG вже змінився: sha1 оновлено в TSV (MISS → перестиснення PNG), але `avifPath` не торкається. Наступний `--write --avif` бачить cache-HIT і не перегенерує застарілий AVIF.

## Рішення/Процедура/Факт

До `.n-minify-image.tsv` додається 5-та колонка `avifHash` — sha1 вихідного файла на момент генерації AVIF. Зміни у `npm/src/index.js`:

1. `parseHashLine` читає 5-ту колонку (якщо є) → `avifHash?: string`.
2. `readTsv4` приймає 4 або 5 колонок (зворотна сумісність зі старим TSV).
3. `saveHashCache` серіалізує `avifHash` як 5-ту колонку лише якщо присутній.
4. `tryCacheHit` та slow-path: умова змінюється з `!existsSync(avifPath)` на `!existsSync(avifPath) || hashEntry.avifHash !== hashEntry.hash` → розбіжність → перегенерація → `hashEntry.avifHash = hashEntry.hash`.
5. MISS path (`processOne`): `avifHash = avifPath ? newHash : hashCache.get(relPath)?.avifHash` — зберігає попереднє значення якщо `--avif` не використовувалось.

Нові тести: (A) базова генерація AVIF із записом `avifHash`; (B) зміна джерела → перегенерація при наступному `--avif`; (C) повторний `--avif` без змін → mtime стабільний; (D) старий 4-колонковий TSV читається без помилок.

## Обґрунтування

Після цього патчу `@nitra/cursor check image` може безумовно викликати `npx @nitra/minify-image --src=. --write --avif` і покладатись на коректну інвалідацію — дублювати sha1-логіку в `check-image.mjs` більше не потрібно.

## Розглянуті альтернативи

mtime-based інвалідація — відхилено: mtime непередбачуваний після git checkout. Окремий файл `.n-image-avif.tsv` у `@nitra/cursor` — відхилено: дублює відповідальність між пакетами.

## Зачіпає

`npm/src/index.js` у `@nitra/minify-image` (функції `parseHashLine`, `readTsv4`, `saveHashCache`, `tryCacheHit`, `processOne`), `npm/package.json`, `npm/CHANGELOG.md` у `@nitra/minify-image`.
