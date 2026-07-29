---
type: JS Module
title: deterministic.mjs
resource: npm/rules/ci4/package_knowledge/deterministic.mjs
docgen:
  crc: ecc17f10
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min-retry
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Надає спільні deterministic primitives для package-knowledge core.

Усі graph/cache consumers використовують однакове рекурсивне впорядкування
JSON, prefixed SHA-256 і fail-closed versioned cache contract.

## Поведінка

Викликати canonicalize дозволяє отримати канонічну копію будь-якого JSON-подібного значення, стандартизуючи порядок ключів об'єктів.

canonicalHash створює однозначний хеш SHA-256, заснований на канонічно впорядкованому представленні в JSON.

loadVersionedCache завантажує кешоване значення певної версії, якщо шляху до кешу надано, і повертає дефолтне, якщо кеш відсутній або невідповідний.

saveVersionedCache атомно зберігає канонічне кешоване значення за вказаним шляхом, створюючи необхідні директорії.

## Публічний API

- canonicalize — Рекурсивно стабілізує object keys для byte-stable JSON.
- canonicalHash — Створює prefixed SHA-256 для canonical JSON-подібного значення.
- loadVersionedCache — Відкриває injected або durable successful-result cache заданої версії.
- saveVersionedCache — Atomically persists only the supplied canonical successful-result cache.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/deterministic.test.mjs` (package knowledge deterministic primitives) — orders nested object keys without changing array order; hashes equivalent object inputs identically; normalizes injected cache entries in place at the required version

## Гарантії поведінки

- Кешує результати в межах одного прогону.
