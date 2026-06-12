---
docgen:
  source: npm/rules/style-lint/js/lint.mjs
  crc: 94e067b3
  score: 100
---

# lint.mjs

## Огляд

filterStyleFiles
Вибирає файли, що мають розширення .css, .scss або .vue.

lint
Запускає команду stylelint з опцією --fix для перевірки та виправлення стилів.

## Поведінка

filterStyleFiles
фільтрує список файлів, повертаючи лише ті, що закінчуються на .css, .scss або .vue

lint
запускає команду stylelint з опцією --fix для перевірки та виправлення стилів

## Публічний API

filterStyleFiles відбирає файли за стилем

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
