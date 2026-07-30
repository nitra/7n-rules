---
type: JS Module
title: deterministic.mjs
resource: npm/rules/doc-files/package_knowledge/deterministic.mjs
docgen:
  crc: 90e3b1cd
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Надає спільні deterministic primitives для package-knowledge core.

Усі graph/cache consumers використовують однакове рекурсивне впорядкування
JSON, prefixed SHA-256 і fail-closed versioned cache contract.

## Поведінка

`canonicalize` повертає стабілізовану копію вкладених структур, придатну для порівняння й серіалізації без залежності від порядку ключів у вихідному об’єкті. Для масивів зберігає форму даних, а примітивні значення й `null` проходять без змін.

`canonicalHash` дає один і той самий `sha256:`-ідентифікатор для семантично однакових JSON-подібних значень. Це зручно для кешів і графових записів, де важлива відтворюваність ключа між прогонами.

`loadVersionedCache` працює з відсутнім або недоступним шляхом як з порожнім кешем, але лише для відомої версії схеми; дані з іншою версією або непридатною формою не приймає. Якщо передано вже наданий кеш, він нормалізується до очікуваного контракту в межах поточного виклику, тож спільне використання має враховувати зміну переданого об’єкта.

`saveVersionedCache` зберігає лише вказаний versioned cache і нічого не пише, коли шлях не задано. Запис виконується атомарно на рівні заміни файла, тому читачі не мають бачити напівзаписаний стан.

## Публічний API

- canonicalize — Рекурсивно стабілізує object keys для byte-stable JSON.
- canonicalHash — Створює prefixed SHA-256 для canonical JSON-подібного значення.
- loadVersionedCache — Відкриває injected або durable successful-result cache заданої версії.
- saveVersionedCache — Atomically persists only the supplied canonical successful-result cache.

## Сценарії використання

- `npm/rules/doc-files/package_knowledge/tests/deterministic.test.mjs` (package knowledge deterministic primitives) — orders nested object keys without changing array order; hashes equivalent object inputs identically; normalizes injected cache entries in place at the required version

## Гарантії поведінки

- Кешує результати в межах одного прогону.
