---
type: JS Module
title: update-blue-oak.mjs
resource: npm/scripts/update-blue-oak.mjs
docgen:
  crc: 83f26045
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 95
---

## Огляд

Оновлює вбудований список ліцензій Blue Oak Council, звертаючись до мережі за даними з https://blueoakcouncil.org/list.json. Цей процес створює або оновлює файл npm/data/blue-oak.json, який містить SPDX-ідентифікатори ліцензій рівнів Model, Gold, Silver та Bronze. Запуск здійснюється вручну у `@nitra/cursor` за допомогою команди `bun npm/scripts/update-blue-oak.mjs`. Оновлення необхідне при апгрейді @nitra/cursor, оскільки нові permissive ліцензії з'являються рідко. Lead-рівень (найгірший, GPL-compatible) навмисно виключений.

## Поведінка

1. Завантажує дані з https://blueoakcouncil.org/list.json.
2. Перевіряє успішність отримання даних. У разі невдачі припиняє виконання.
3. Парсить отримані дані.
4. Ітерує по рейтингах у даних.
5. Вибирає лише рейтинги Model, Gold, Silver та Bronze.
6. Збирає всі SPDX-ідентифікатори ліцензій, що належать до обраних рейтингів.
7. Формує об'єкт, що містить версію та список зібраних SPDX-ідентифікаторів.
8. Зберігає цей об'єкт у файл npm/data/blue-oak.json.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
