---
type: JS Module
title: source-loader.mjs
resource: npm/rules/ci4/package_knowledge/source-loader.mjs
docgen:
  crc: 05878c8b
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Завантажує source inputs рівно одного package knowledge domain.

Loader використовує manifest boundary та exclusions nested domains, поважає
gitignore і не переходить через symlinks. Він повертає stable relative paths
і content, придатні для deterministic candidate pipeline.

## Поведінка

discoverDomainCodeExtensions повертає перелік підтримуваних code extensions лише для абсолютного domain root; якщо root недоступний або невалідний, функція зупиняється з діагностикою. Під час збору результату недоступні файли, вихід за boundary через symlink або інші проблеми читання блокують відповідь і не дають часткового переліку.

loadDomainSources приймає лише абсолютний domain root і непорожній набір valid extensions; інакше повертає діагностику без результату. На виході дає стабільні relative paths і content лише для файлів із переданими extensions; пошук не зачіпає .git і node_modules, а також не включає вкладені domains. Будь-яка помилка читання, недоступний root або escape за boundary через symlink переводять виклик у diagnostic flow без часткового успіху.

## Публічний API

- discoverDomainCodeExtensions — Виявляє наявні підтримувані code extensions без залежності від встановлених adapters.

Кожен recognized file перечитується через той самий containment gate, тому race,
unreadable file або symlink escape блокує вибір adapter-ів до candidate pipeline.
- loadDomainSources — Завантажує всі source files одного domain без source nested packages.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/source-loader.test.mjs` (loadDomainSources; discoverDomainCodeExtensions) — loads stable source order and excludes nested package/build trees; does not follow a symlink outside the domain; rejects invalid roots and extension contracts; returns sorted extensions across supported language ecosystems; excludes nested domains and returns an empty inventory when no code exists; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
