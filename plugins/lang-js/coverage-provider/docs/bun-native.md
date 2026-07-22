---
type: JS Module
title: bun-native.mjs
resource: plugins/lang-js/coverage-provider/bun-native.mjs
docgen:
  crc: 18eab5d0
  model: openai-codex/gpt-5.4-mini
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей файл визначає, чи workspace належить до Bun-native і має покриватися через `bun test --coverage`, коли prod-код імпортує `bun`, `bun:sqlite`, `bun:ffi` та інші Bun-специфічні модулі, але не `bun:test`. Окремо він перевіряє, чи для такого workspace є придатні до запуску тести.

Це потрібно тому, що `vitest` у `Node ESM/vitest module-runner` не резолвить `bun`, а в Bun runtime тестові імпорти з `vitest` ремапляться на `bun:test`, тож coverage для таких workspace-ів збирають саме через `bun test --coverage`.

## Поведінка

`isBunNativeRoot` і `hasRunnableTests` працюють як попередні перевірки перед вибором режиму coverage для workspace: перша відсіює workspace-и, де prod-код залежить від Bun runtime, друга — чи взагалі є тести, які має сенс запускати через `bun test`. Обидві функції читають лише дерево файлів у межах workspace-кореня й не змінюють стан; у разі помилок під час обходу або читання вони можуть завершитися помилкою.

`isBunNativeRoot` шукає ознаки Bun-залежного prod-коду серед JS/TS-файлів, але свідомо ігнорує test/spec-файли, щоб не сплутати тестові імпорти з реальними runtime-залежностями. Якщо знаходить такий workspace, результатом стає сигнал перейти на Bun coverage; інакше workspace вважається не bun-native для цієї перевірки.

`hasRunnableTests` використовується як окремий запобіжник перед запуском `bun test`: вона визначає лише факт наявності придатних тестових файлів у workspace, щоб уникнути помилки «нема чого запускати» і коректно пропустити запуск, коли тестів немає.

## Публічний API

- isBunNativeRoot — Чи workspace bun-native: хоч один prod JS/TS-файл імпортує `bun`/`bun:*` (крім `bun:test`).
- hasRunnableTests — Чи workspace має тест-файли, які запустить `bun test` (`*.test.{js,mjs,ts}`).
  Пре-скан перед запуском: `bun test` без тестів завершується помилкою, а нам
  потрібен той самий graceful skip, що дає vitest `--passWithNoTests`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Помилки не перехоплюються на рівні всього файла.
- За певних помилок можуть повертатися порожні значення замість винятку.
