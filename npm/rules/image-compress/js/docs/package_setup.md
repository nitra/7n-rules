---
docgen:
  source: npm/rules/image-compress/js/package_setup.mjs
  crc: 13f6d8f3
  score: 95
---

# package_setup.mjs

## Огляд

Файл виконує перевірку наявності та видалення кешу. Він зчитує рядки з `.gitignore`, перевіряє наявність кешу `HASH_CACHE_FILENAME` та видаляє застарілий кеш `LEGACY_CACHE_FILENAME`. Код перевіряє відповідність правилу, визначеного в (image-compress.mdc).

## Поведінка

1. Зчитування рядків з `.gitignore`
2. Перевірка наявності кешу `HASH_CACHE_FILENAME` у `.gitignore`
3. Перевірка видалення застарілого кешу `LEGACY_CACHE_FILENAME`
4. Перевірка відповідності правилу `image-compress.mdc`

## Публічний API

check — Перевіряє, чи відсутній у `.gitignore` файл `.n-minify-image.tsv` та чи видалено `.minify-image-cache.tsv`. Вказує, що CI-workflow для image не потрібен, оскільки лінтування зображень відбувається лише локально. (image-compress.mdc)

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.git`.
- Не звертається до мережі.
