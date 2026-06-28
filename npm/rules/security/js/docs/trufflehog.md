---
type: JS Module
title: trufflehog.mjs
resource: npm/rules/security/js/trufflehog.mjs
docgen:
  crc: 29622ef1
  score: 95
---

Огляд

Файл виконує перевірку конфігураційних файлів та шаблонів для забезпечення безпеки. Перевіряється наявність `package.json` та `.trufflehog-exclude`. Дані з цих файлів використовуються для перевірки відповідності шаблону файлу `security.mdc`.

## Поведінка

1. Перевірка наявності package.json в корені репозиторію.
2. Перевірка наявності .trufflehog-exclude в корені репозиторію.
3. Зчитування файлу .trufflehog-exclude.snippet.txt.
4. Зчитування шаблону з .trufflehog-exclude.snippet.txt.
5. Перевірка відповідності вмісту .trufflehog-exclude шаблону з security.mdc.
6. Повернення коду виходу перевірки.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
