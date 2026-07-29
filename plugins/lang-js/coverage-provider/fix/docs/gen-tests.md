---
type: JS Module
title: gen-tests.mjs
resource: plugins/lang-js/coverage-provider/fix/gen-tests.mjs
docgen:
  crc: 739ce109
  model: openai-codex/gpt-5.4-mini
  score: 80
---

## Огляд

Генерація unit-тестів через LLM з per-export tiered-маршрутизацією
(fix-шлях концерну `coverage` правила `test`, \`npx \@7n/rules lint test\`).

Стратегія:
  1. Класифікація кожного export-а: trivial/simple → спершу локальна модель, complex → cloud.
  2. Спільний header (imports, mocks, setup) — через cloud.
  3. Per-export describe()-блоки, маршрутизовані за складністю.
  4. Валідація локально згенерованих блоків; fallback на cloud при анти-патернах.
  5. Merge header + блоки → запис тест-файлу (через `recordWrite` ladder-а).

Локальна модель — opts.localModel або `N_LOCAL_MIN_MODEL → AVG → MAX`. Всі виклики йдуть
через LLM-хелпер концерну (`lib/llm.mjs` ядра). Без локальної моделі (або без
export-ів) — fallback на single-file cloud-генерацію. Валідація блоків жене
project-local vitest споживача (`bunx vitest run`) — bundled-vitest shim
колишнього `\@7n/test` не переносився (vitest — devDependency споживача).

## Публічний API

- findTestRules — Знаходить n-test.mdc правила проєкту, піднімаючись від dir (максимум 4 рівні).
- buildGenTestsPrompt — Будує display-only summary-промпт (використовується в тестах).
- generateTests — Генерує тести для всіх переданих файлів.
Per-export tiered-маршрутизація коли доступна локальна модель;
інакше — single-file cloud-генерація. Повертає записані файли для
`touchedFiles`-контракту fix-worker-а.

## Сценарії використання

- `plugins/lang-js/coverage-provider/tests/gen-tests.test.mjs` (buildGenTestsPrompt; findTestRules) — should include file path and coverage info in prompt; should truncate source over 6000 bytes; should handle missing source file; returns null when n-test.mdc not found; returns file content without YAML frontmatter when found; ще 17

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
