---
type: JS Module
title: collect-test-files.mjs
resource: npm/scripts/lib/collect-test-files.mjs
docgen:
  crc: d4b01600
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Спільна логіка для `test/no-*`-концернів, що сканують `*.test.{mjs,js}`. Вона обходить дерево з урахуванням ignore-правил із `.n-rules.json`, визначає тестові файли, а для звітів уніфікує їхні шляхи до відносного POSIX-формату. Компонент read-only: не виконує записів у ФС чи БД.

## Поведінка

- **isTestFile** — визначає, чи шлях вказує на JS-тестовий файл із суфіксом `.test.mjs` або `.test.js`.
- **collectTestFiles** — збирає всі такі тестові файли в дереві репозиторію, враховуючи ігнорування з `.n-rules.json`.
- **toRelPosix** — перетворює абсолютний шлях на відносний до кореня репозиторію у POSIX-форматі для уніфікованих повідомлень.

## Публічний API

- isTestFile — Визначає, чи шлях веде до JS test-файла з розширенням `*.test.mjs` або `*.test.js`.
- collectTestFiles — Знаходить у `cwd` усі файли `*.test.{mjs,js}`, пропускаючи те, що відфільтровано через `.n-rules.json`.
- toPosixRel — Перетворює шлях файлу від `cwd` у posix-формат для єдиного виду повідомлень про порушення.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
