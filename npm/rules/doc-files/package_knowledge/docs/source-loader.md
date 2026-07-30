---
type: JS Module
title: source-loader.mjs
resource: npm/rules/doc-files/package_knowledge/source-loader.mjs
docgen:
  crc: 2c3d67e5
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

discoverDomainCodeExtensions повертає лише ті розширення, для яких у межах одного domain реально є source-файли; якщо root недоступний або хоча б один знайдений файл не можна безпечно підтвердити як такий, що лишається в boundary, вся операція зупиняється з diagnostics. Потік не бере до уваги `.git` і `node_modules`, а також nested domains, тож результат описує тільки поточний domain.

loadDomainSources працює тільки для абсолютного domain root і приймає лише коректно сформований список розширень; інакше повертає blocking diagnostics. На виході дає стабільний набір source-об’єктів із relative path та content, або diagnostics, якщо root недоступний, є непридатні розширення, чи хоча б один source не вдалося безпечно прочитати або він виявився поза boundary.

## Публічний API

- discoverDomainCodeExtensions — Виявляє наявні підтримувані code extensions без залежності від встановлених adapters.

Кожен recognized file перечитується через той самий containment gate, тому race,
unreadable file або symlink escape блокує вибір adapter-ів до candidate pipeline.
- loadDomainSources — Завантажує всі source files одного domain без source nested packages.

## Сценарії використання

- `npm/rules/doc-files/package_knowledge/tests/source-loader.test.mjs` (loadDomainSources; discoverDomainCodeExtensions) — loads stable source order and excludes nested package/build trees; does not follow a symlink outside the domain; rejects invalid roots and extension contracts; returns sorted extensions across supported language ecosystems; excludes nested domains and returns an empty inventory when no code exists; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
