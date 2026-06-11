---
docgen:
  source: npm/rules/js-run/lib/temporal-scan.mjs
  crc: 5b15b070
---

# temporal-scan.mjs

## Огляд

Цей файл є частиною системи, яка сканує код Bun workspace на наявність використання ключового слова `Temporal`. Він запобігає використанню `Temporal` у backend-коді, оскільки Bun 1.3.x ще не має глобального `Temporal`, та охоплює сценарії з імпортом та polyfill. Це забезпечує відповідність коду поточним вимогам Bun runtime щодо обробки часу.

## Поведінка

Знаходить використання identifier `Temporal` у тексті. Повертає список рядків та фрагментів коду, де зустрічається `Temporal`.
Чи сканувати файл за розширенням (JS/TS-сім'я, виключно з `.d.ts`). Повертає `true`, якщо файл має відповідне розширення, і не є файлом `.d.ts`.

## Публічний API

- findTemporalUsageInText — Знаходить згадки про `Temporal` у тексті.
- isTemporalScanSourceFile — Визначає, чи потрібно сканувати файл за розширенням (JavaScript/TypeScript або `.d.ts`).

## Гарантії поведінки

- Функція `findTemporalUsageInText` повертає `true` лише якщо знайде identifier `Temporal` у наданому тексті.
- Функція `findTemporalUsageInText` повертає `false` якщо identifier `Temporal` не знайдено.
- Функція `isTemporalScanSourceFile` повертає `true` якщо у файлі є identifier `Temporal`.
- Функція `isTemporalScanSourceFile` повертає `false` якщо у файлі немає identifier `Temporal`.
- Результат роботи `findTemporalUsageInText` не гарантує, що identifier `Temporal` використовується правильно.
- Результат роботи `isTemporalScanSourceFile` не гарантує, що використання `Temporal` є допустимим.
- Кеш не використовується.
