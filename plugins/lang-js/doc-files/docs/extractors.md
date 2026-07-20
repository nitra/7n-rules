---
type: JS Module
title: extractors.mjs
resource: plugins/lang-js/doc-files/extractors.mjs
docgen:
  crc: 06668f9d
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Мовний doc-files-екстрактор JS-екосистеми (extension-point `doc-files`, фаза 5b spec lang-plugins-extraction): перетворює вміст js/mjs/ts-файлу на структурований факт-лист для генерації поведінкової документації. Default-експорт — обʼєкт екстрактора `{ id: 'js', extensions: ['.js','.mjs','.ts','.vue'], extractFacts, extractUnits }`, який ядро вантажить динамічно з маніфеста плагіна (`contributes.handlers['doc-files']`) лише на шляху генерації.

## Поведінка

- `extractFacts(src, relPath)` для `js`/`mjs`/`ts` збирає: провідний файловий JSDoc-коментар (намір модуля), експортовані декларації з їхніми JSDoc-описами (`@param`/`@returns` парсяться у структуру), імпорти класифіковані на stdlib/npm/internal, імена внутрішніх імпортованих символів та неекспортованих top-level функцій/класів (щоб модель не подавала їх як публічний API), і поведінкові маркери-евристики.
- Інші розширення (включно з `.vue`) → факт-лист із `unsupported: true` — генерація йде whole-file шляхом.
- Маркери навмисно консервативні («фабрикація гірша за мовчання»): `readOnly` — немає ні ФС-запису, ні DB-мутацій (включно з raw-SQL tagged-template з DML-ключовим словом на початку шаблону); `catchesErrors`/`returnsFalsyOnFail` — лише якщо модуль ніде не кидає; `network` свідомо over-detect (хибна гарантія «без мережі» небезпечніша); `caches` — лише за іменованим cache/memo-маркером, а не будь-яким `new Map()`; `skips` — помічені літерали пропущених тек.
- `extractUnits` — делегує `extractUnitsJs` з `units-js.mjs` (oxc AST, юніт-шар).

## Публічний API

- default — обʼєкт екстрактора для handler-модуля extension-point `doc-files`.
- extractFacts — код файлу → факт-лист (`{relPath, lang, header, exports, imports, internalSymbols, localSymbols, markers}` або `{unsupported: true}`).

## Гарантії поведінки

- Read-only: не пише у ФС, не запускає команд, не ходить у мережу.
- Не кидає на довільному тексті — розширення без підтримки дає `unsupported`, а не виняток.
- Регекс-евристики без бектрекінг-вразливих патернів (обмежені квантифікатори).
