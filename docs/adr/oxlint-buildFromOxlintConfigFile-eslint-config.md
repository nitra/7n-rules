# Oxlint у `@nitra/eslint-config`: перехід на `buildFromOxlintConfigFile`

**Status:** Accepted
**Date:** 2026-05-14

## Контекст

У `npm/index.js` функція `getConfig(...)` підключала `oxlint.configs['flat/recommended']`, який вимикає в ESLint лише правила з *recommended-пресету* oxlint. Це не збігалося з реально увімкненими правилами у `.oxlintrc.json` споживача пакету. Через це одні й ті самі перевірки виконувалися обома інструментами паралельно, порушуючи принцип «oxlint = джерело правди для overlap-правил».

## Рішення

У `npm/index.js` `oxlint.configs['flat/recommended']` замінено на виклик `buildFromOxlintConfigFile('.oxlintrc.json')` із пакету `eslint-plugin-oxlint`. Цей метод генерує flat-конфіг, що вимикає в ESLint рівно ті правила, які увімкнені у фактичному `.oxlintrc.json` споживача. Шлях визначається відносно `process.cwd()`; якщо файл відсутній — fallback на `flat/recommended` з виводом `console.warn`. Публічна сигнатура `getConfig({ node, vue, vue2 })` не змінюється; доданий необов'язковий параметр `oxlintConfigFile`. Версія пакету bumped `3.9.2 → 3.10.0`, у `npm/CHANGELOG.md` додано запис `## [3.10.0]`. Додано bun-тест із тимчасовим `.oxlintrc.json`, що підтверджує появу його правил як `'off'` у вихідному масиві `getConfig`.

## Обґрунтування

`.oxlintrc.json` є канонічним конфігом oxlint, синхронізованим із `@nitra/cursor`. Саме він визначає реальну поведінку лінтера у споживача. Використання `flat/recommended` як бази вимикання неточне: набір recommended ≠ кастомний конфіг споживача. `eslint-plugin-oxlint` надає `buildFromOxlintConfigFile` саме для цього сценарію, що підтримує узгодженість автоматично при оновленні `.oxlintrc.json` без ручних override-ів.

## Розглянуті альтернативи

- Залишити `flat/recommended` — відхилено: неповне перекриття правил.
- Вручну вимикати правила у `npm/index.js` — відхилено: порушує принцип «не дублюй канон вручну».

## Зачіпає

`npm/index.js` (логіка `getConfig`), `npm/package.json` (bump версії до `3.10.0`), `npm/CHANGELOG.md`, нові bun-тести в `npm/*.test.mjs`. Публічний API `getConfig` — зворотно сумісний.
