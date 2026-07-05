---
type: JS Module
title: fix-internal_urls.mjs
resource: npm/rules/hasura/internal_urls/fix-internal_urls.mjs
docgen:
  crc: f38b2bec
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

T0-автофікс для `hasura/internal_urls`: виправляє в `*.env` файлах значення `HASURA_GRAPHQL_ENDPOINT`, у яких `service` або `namespace` не збігаються з `metadata.name` із `hasura/k8s/base/svc-hl.yaml` та `hasura/k8s/base/namespace.yaml`. Структурно невалідний URL (не внутрішній кластерний формат) не виправляється — це вимагає ручного рішення про `cluster`/`port`.

## Поведінка

1. Спрацьовує лише за наявності порушень з причиною `internal-url-service-mismatch` або `internal-url-namespace-mismatch`.
2. Обчислює очікувані `service`/`namespace` з YAML-маніфестів (`computeExpectedEndpointSegments`).
3. Для кожного файлу-порушника переписує сегменти `service`/`namespace` у значенні `HASURA_GRAPHQL_ENDPOINT`, зберігаючи наявні `cluster` і `port`.
4. URL з причиною `internal-url-invalid` (структурно невалідний) не чіпає — така правка вимагає людського рішення про інфраструктуру.

## Гарантії поведінки

- Пише лише файли з переліку порушень; за відсутності збігу — no-op.
