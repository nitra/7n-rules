---
type: JS Module
title: collect-test-file-offenders.mjs
resource: plugins/lang-js/rules/test/lib/collect-test-file-offenders.mjs
docgen:
  crc: bf54977d
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл знаходить JS-тести `*.test.mjs` і `*.test.js` у репозиторії з урахуванням `.n-rules.json` та повертає для кожного з них відносні шляхи до offenders. Це дає змогу окремо перевіряти, які саме тестові файли виходять за межі правил проєкту, без додаткового парсингу чи нормалізації результату.

## Поведінка

- `isTestFile` — визначає, чи шлях належить до JS-тесту `*.test.mjs` або `*.test.js`.
- `collectTestFileOffenders` — знаходить усі тестові файли в репозиторії з урахуванням `.n-rules.json` та збирає для них знайдені порушення з відносними шляхами.

## Публічний API

- isTestFile — Розпізнає JS-файли з тестовою назвою `*.test.mjs` або `*.test.js`.
- collectTestFileOffenders — Обходить репозиторій з урахуванням `.n-rules.json:ignore`, знаходить `*.test.{mjs,js}` і проганяє кожен файл через `findOffenders` для спільних test-конвенцій на кшталт `no-console-store-restore` і `vitest-api-conventions`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
