---
type: JS Module
title: fix-migrations.mjs
resource: npm/rules/hasura/migrations/fix-migrations.mjs
docgen:
  crc: 126425f7
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

T0-автофікс для `hasura/migrations`: видаляє заборонені файли `down.sql` у `hasura/migrations/**` (у проєкті директорія міграції має містити лише `up.sql`).

## Поведінка

1. Спрацьовує лише за наявності порушень з причиною `down-sql-forbidden`.
2. Для кожного файлу-порушника видаляє `down.sql` за шляхом з violation.
3. Помилку видалення окремого файлу тихо пропускає й переходить до наступного (не перериває фікс інших файлів).

## Гарантії поведінки

- Видаляє лише файли з переліку порушень; інших файлів не торкається.
