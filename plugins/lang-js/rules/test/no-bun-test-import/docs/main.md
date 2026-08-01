---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/test/no-bun-test-import/main.mjs
docgen:
  crc: f65fbc33
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Поведінка

`lint` збирає список усіх тестових файлів у робочій директорії. Для кожного тестового файлу він зчитує вміст і викликає `findBunTestImports`, щоб знайти всі декларації `import` з `'bun:test'`. `findBunTestImports` аналізує вміст файлу, розділяючи специфікатори імпорту, і повертає список знайдених декларацій із інформацією про те, чи є їхнє автоматичне виправлення можливим.

## Сценарії використання

- `plugins/lang-js/rules/test/no-bun-test-import/tests/no-bun-test-import.test.mjs` (check test.no-bun-test-import) — успіх: import з vitest → без violations; порушення: import з bun:test (test, expect) → 1 violation, fixable; порушення: import з bun:test (test, mock) → не fixable (mock без еквіваленту); не-тестові файли не скануються; обхід пропускає node_modules

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
