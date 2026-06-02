---
kind: nitra-spec
status: draft
adr: null
plan: ../plans/2026-06-02-flow-coverage-stryker-local.md
risk: low
---

# coverage-gate: локальний Stryker замість npx — дизайн

Дата: 2026-06-02
Власник: @vitaliytv
Статус: Draft (очікує апруву)
Беклог: flow-adaptation-backlog #4/#8 (recurring verify-блокер)

## Проблема

`js-lint/coverage/coverage.mjs::runStryker` запускає Stryker через
`spawnSync('npx', ['@stryker-mutator/core', 'run', …])`. У середовищах, де `npx`
тягне core у власний кеш (напр. Zed node: `~/.../node/cache/_npx/<hash>/…`), core
вантажиться НЕ з проєктного `node_modules`. Plugin-discovery Stryker globить
`@stryker-mutator/*` відносно core-install-каталогу → у кеші бачить лише
core/api/instrumenter/util, а локально встановлений `@stryker-mutator/vitest-runner`
лишається невидимим → воркери падають `Cannot find TestRunner plugin "vitest"`.
Наслідок: `flow verify` (gate `coverage --changed`) червоний на кожній задачі;
команда щоразу обходить verify вручну.

Коментар у коді припускав, що `npx` ходить угору в локальний `node_modules/.bin` —
у цьому середовищі це не так.

## Рішення (валідовано експериментом)

Резолвити **локально встановлений** core із розташування самого модуля
(`createRequire(import.meta.url).resolve('@stryker-mutator/core/bin/stryker.js')`)
і запускати його через `process.execPath` (node), не `npx`. Тоді core вантажиться
з проєктного `node_modules`, де **поряд** лежить `vitest-runner` → discovery його
бачить. Експеримент: `node <core>/bin/stryker.js run --mutate …` → лог
«Starting initial test run (vitest test runner…)», 121 тест пройдено — плагін
завантажено. (`npx`-варіант падав одразу.)

Fallback: якщо локальний резолв не вдався (core не встановлено) — лишаємо `npx`
(краще спроба, ніж нічого).

Резолв працює незалежно від `cwd` (worktree без node_modules): `import.meta.url`
вказує на `npm/…`, тож `createRequire` бачить кореневий `node_modules` пакета.

## Зміни секціями

### A. `js-lint/coverage/coverage.mjs::runStryker`

- Зарезолвити `@stryker-mutator/core/bin/stryker.js` через `createRequire(import.meta.url)`.
- Якщо вдалося → `spawnSync(process.execPath, [strykerBin, 'run', ...mutateArgs], {cwd,...})`.
- Інакше → старий `npx`-fallback.
- Оновити коментар (чому local-resolve, а не npx).

## Тести (js-lint/coverage)

- `runStryker` — наявні тести мокають runner, тож прямого юніту на spawn немає;
  додати тест на резолвер-гілку, якщо є дешевий спосіб (інакше — інтеграційно через verify).
- Головна валідація — `flow verify` у цьому worktree: coverage-gate тепер ЗЕЛЕНИЙ.

## Не-цілі

- Не змінюємо, ЩО мутується (`--changed` scope), парсинг mutation.json, vitest-виклик.
- Не вирішуємо drop-vs-incremental coverage (беклог #4) — лишаємо incremental, просто робимо його робочим.

## Як перевірити

- `flow verify` у worktree → coverage-gate проходить (раніше падав на plugin).
- `bun test` js-lint/coverage — зелений.

## Ризики

Low. Зміна лише способу запуску того самого Stryker; fallback на npx збережено.
