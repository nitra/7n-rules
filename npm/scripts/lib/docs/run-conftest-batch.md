---
type: JS Module
title: run-conftest-batch.mjs
resource: npm/scripts/lib/run-conftest-batch.mjs
docgen:
  crc: 66ce25c3
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 55
---

## Огляд

Запускає `conftest test` на batched-списку файлів і повертає всі порушення
у структурованому вигляді. Використовується з `check-*.mjs`-скриптів, де
пер-документні правила винесені у `npm/policy/<rule>/<name>/` як rego-полісі
(Rego-authoritative). JS у `check-*.mjs` робить cross-file частину (walking
дерева, парність, kustomize-резолюція), а пер-документне валідаційне ядро
делегується сюді — один спавн `conftest` на (`namespace`, `policyDir`),
незалежно від кількості файлів. Це закриває дублювання JS↔rego і прибирає
ризик дрифту (типу `spec.config` vs `spec.default.config` у
`health_check_policy.rego`, що ми ловили cross-check тестами).

Hard-fail на відсутність `conftest` — через `ensureToolAsync`, що спочатку
намагається авто-встановити, і лише після невдачі кидає виняток.

Async (`spawnAsync`, не `spawnSync`) — детектор не блокує event loop, тож може
виконуватись у parallel lane `detectAll()` (ADR 260716-1354). Приймає опційний
`signal`/`timeoutMs` — прокидаються в `spawnAsync`.

## Публічний API

- buildConftestArgs — Pure args builder for conftest test. Extracted for unit-testability.
Preserves the existing args layout (files before -p; --output json --no-color
for parseable output); inserts --data right after --namespace when provided.
- runConftestBatch — Виконує `conftest test` для всіх файлів одним спавном і повертає масив
порушень. Якщо `files` порожній — повертає `[]` без спавна. Якщо `conftest`
не у PATH і авто-встановлення не вдалось — кидає виняток (hard fail).

## Сценарії використання

- `npm/scripts/lib/tests/run-conftest-batch.test.mjs` (buildConftestArgs; runConftestBatch) — emits base args without --data when tmpDataFile null; inserts --data <tmpfile> when tmpDataFile provided; appends extraArgs at the end (existing convention); кидає коли conftest відсутній у PATH і авто-install відключено; кидає коли rego-каталог не знайдено

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
