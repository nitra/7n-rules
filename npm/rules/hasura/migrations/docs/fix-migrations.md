---
type: JS Module
title: fix-migrations.mjs
resource: npm/rules/hasura/migrations/fix-migrations.mjs
docgen:
  crc: b2161ecb
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 75
---

## Поведінка

1. Отримує множину шляхів до файлів, що містять заборонені файли `down.sql` у каталозі `hasura/migrations`.
2. Для кожного знайденого шляху виконує операцію видалення відповідного файлу.
3. Записує інформацію про змінений файл у системі записів.
4. Повертає інформацію про змінені файли, якщо видалено хоча б один файл.
5. `patterns` визначає набір автоматичних виправлень для виявлених порушень.

## Сценарії використання

- `npm/rules/hasura/migrations/tests/fix-migrations.test.mjs` (hasura-migrations-remove-down-sql pattern) — test: true за наявності down-sql-forbidden, false інакше; apply: видаляє down.sql, залишає up.sql; apply: no-op, якщо порушень немає

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
