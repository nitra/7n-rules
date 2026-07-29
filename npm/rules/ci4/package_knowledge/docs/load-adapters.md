---
type: JS Module
title: load-adapters.mjs
resource: npm/rules/ci4/package_knowledge/load-adapters.mjs
docgen:
  crc: c58d0f43
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 80
---

## Огляд

Матеріалізує package-knowledge adapters через універсальний plugin slot bus.

Loader вимагає явні repository/domain roots і повертає лише повний валідний
набір adapters. Broken resource, contract mismatch або відсутній extractor
для потрібного extension є blocking diagnostic без whole-file fallback.

## Публічний API

- loadKnowledgeAdapters — Матеріалізує мовні knowledge adapters через універсальний slot bus. `repoRoot` і
`domainRoot` обовʼязкові та явні: loader не визначає domain boundary і не читає `cwd`.
Він повертає `adapters: null` за першої blocking-проблеми, тому caller фізично не може
продовжити з частковим набором або whole-file fallback.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/load-adapters.test.mjs` (loadKnowledgeAdapters) — реєструє обидва versioned slots у manifest-порядку без нового plugin mechanism; preserves optional full-parser test collector on knowledge extractor adapter; зберігає детермінований порядок plugins для domain і extractor adapter-ів; вимагає явні абсолютні repoRoot і domainRoot, не використовує cwd; блокує domainRoot поза межами repoRoot; ще 6

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
