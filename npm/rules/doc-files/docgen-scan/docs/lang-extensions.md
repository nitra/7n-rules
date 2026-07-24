---
type: JS Module
title: lang-extensions.mjs
resource: npm/rules/doc-files/docgen-scan/lang-extensions.mjs
docgen:
  crc: 14b28432
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 95
---

## Огляд

Огляд: Модуль керує завантаженням та очищенням документів та логіки для перевірок. Забезпечує функціональний потік, який включає отримання мапи розширень, завантаження екстракторів та очищення кешу для тестування.

## Поведінка

Поведінка крос-функціональний потік
pluginDocFilesExtensions повертає мапу розширень задекларованих у конфігах
loadDocFilesExtractors вантажує мовні екстрактори з handler-модулів
unavailableDocFilesPlugins повертає список плагінів, які не встановлені
clearDocFilesLangCache скидає кеші для тестування

## Публічний API

- pluginDocFilesExtensions — Мапа doc-files-розширень від плагінів для репо (`.rs` → 'Rust Module', …),
з кешем на процес. Порожня мапа — жодний активний плагін їх не декларує.
- loadDocFilesExtractors — Асинхронно вантажить мовні екстрактори з handler-модулів плагінів
(extension-point `doc-files`): default-експорт
`{ id, extensions: string[], extractFacts?, extractUnits? }`.
Битий модуль — мовчазний пропуск (генерація тоді йде whole-file шляхом).
- unavailableDocFilesPlugins — Задекларовані у `.n-rules.json` плагіни, недоступні в `node_modules` — рахується лише
коли мапа doc-files-розширень порожня (інакше принаймні один плагін реально доступний,
шукати "недоступні" немає сенсу — не hot-path concern, рахується лише в рідкісному
порожньому випадку).
- clearDocFilesLangCache — Скидає кеші (для тестів).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Кешує результати в межах одного прогону.
