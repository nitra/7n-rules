---
type: JS Module
title: docgen-files-batch.mjs
resource: npm/rules/doc-files/js/docgen-files-batch.mjs
docgen:
  crc: 18c96a58
  score: 95
---

runDocFilesGenCli
Запускає генерацію документації для застарілих або відсутніх файлів.

runDocFilesStampCli
Перештампує frontmatter джерело та CRC у наявних документах без виклику LLM.

## Поведінка

runDocFilesGenCli
Запускає генерацію документації для застарілих/відсутніх док.

runDocFilesStampCli
Перештампує frontmatter source+crc у наявних доках без виклику LLM.

## Публічний API

- runDocFilesGenCli — згенерувати документацію для застарілих/відсутніх док.
- runDocFilesStampCli — детерміновано (пере)штампувати frontmatter `source`+`crc` у наявних доках без виклику LLM. Для міграції док, які ще не мають CRC. Поля якості (`score`/`issues`) зберігаються з наявного frontmatter.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Не звертається до мережі.
