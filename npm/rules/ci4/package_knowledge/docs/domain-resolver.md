---
type: JS Module
title: domain-resolver.mjs
resource: npm/rules/ci4/package_knowledge/domain-resolver.mjs
docgen:
  crc: 63db9ae9
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Виявляє package-level documentation domains за маніфестами екосистем.

Resolver не аналізує source: він лише фіксує стабільну identity домену та
вкладені межі, які downstream language adapters використають для обходу.

## Поведінка

canonicalDomainName гарантує унікальну ідентифікацію пакетів, узгоджуючи назви відповідно до правил відповідних екосистем, зокрема використовуючи формат PEP 503 для Python, тоді як для інших систем лише обрізає існуючі ідентифікатори.

resolveDocumentationDomains надає повний перелік знайдених доменів, підтримуючи лише домени, що ґрунтуються на маніфестах, як-от package.json або composer.json. Вихідний результат містить стабільні домени та діагностичні повідомлення про некоректні маніфести.

resolveDomainForPath визначає найглибший домен, що володіє заданим шляхом, за умови, що шлях знаходиться всередині репозиторію та одного з виявлених доменів; якщо шлях поза репозиторієм чи доменними коренями, результат буде відсутнім.

Процес не враховує внутрішню структуру джерел, фокусуючись лише на стабільних межах, визначених маніфестами.

## Публічний API

- canonicalDomainName — Canonicalizes package names according to ecosystem identity rules.
  Python uses its PEP 503 canonical project-name form; the other manifests
  already define canonical package identities and only need trimming.
- resolveDocumentationDomains — Resolves every manifest-backed documentation domain in a repository.

Returned domains and diagnostics are sorted by stable values. Invalid
manifests and duplicate canonical identities remain diagnostics instead of
silently receiving a path-derived fallback identity.

- resolveDomainForPath — Finds the owning domain for a source path. The deepest nested root wins;
  paths outside the repository and manifest roots without a domain return null.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/domain-resolver.test.mjs` (package knowledge domain resolver; knowledge graph v1 schema) — discovers every supported manifest with path-independent canonical identity; excludes nested roots from the parent and resolves the deepest domain; emits stable blocking diagnostics instead of path-based fallback identities; canonicalizes only ecosystem-defined name variants; skips workspace-only Cargo and config-only Python manifests; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
