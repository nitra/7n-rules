---
type: JS Module
title: source-loader.mjs
resource: npm/rules/ci4/package_knowledge/source-loader.mjs
docgen:
  crc: 9f9a15b2
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Завантажує source inputs рівно одного package knowledge domain.

Loader використовує manifest boundary та exclusions nested domains, поважає
gitignore і не переходить через symlinks. Він повертає stable relative paths
і content, придатні для deterministic candidate pipeline.

## Поведінка

discoverDomainCodeExtensions повертає блокер, якщо root домену не є absolute path або якщо root недоступний через filesystem error; у таких випадках користувач отримує diagnostics замість списку розширень. Він знаходить лише наявні `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.rs`, `.py` та `.php`, враховує gitignore, не переходить symlinks, а шляхи в межах `.git` і `node_modules` свідомо пропускаються.

loadDomainSources повертає блокер за тих самих умов для root, а також коли передані extensions не відповідають очікуваному формату. Успішний результат містить лише стабільні relative paths і вміст source-файлів; будь-яка помилка під час обробки окремого source перетворюється на diagnostics і зупиняє видачу результату.

Обидві функції працюють у межах одного domain і не змішують source з вкладених domains; для цього враховуються exclusions nested domains. Якщо під час перевірки source виявляється вихід за boundary через symlink або файл стає недоступним, це також повертається як blocker.

## Публічний API

- discoverDomainCodeExtensions — Виявляє наявні підтримувані code extensions без залежності від встановлених adapters; unreadable file або symlink escape блокує вибір adapter-ів.
- loadDomainSources — Завантажує всі source files одного domain без source nested packages.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/source-loader.test.mjs` (loadDomainSources; discoverDomainCodeExtensions) — loads stable source order and excludes nested package/build trees; does not follow a symlink outside the domain; rejects invalid roots and extension contracts; returns sorted extensions across supported language ecosystems; excludes nested domains and returns an empty inventory when no code exists; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
