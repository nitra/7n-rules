---
type: JS Module
title: gql-sse.js
resource: plugins/lang-js/rules/test/storybook-scaffold/template/mocks/gql-sse.js
docgen:
  crc: fe63fba2
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Надає єдиний MSW-хелпер `sseSubscription` для мокання Apollo GraphQL-підписок у Storybook через `graphql-sse`. Кожна подія виконання підписки надсилається як окремий SSE `next`-запис у distinct-connection режимі: `event: next\ndata: <JSON>\n\n`, щоб пакети не дублювали формат цього wire-протоколу.

## Поведінка

1. `sseSubscription` приймає послідовність готових GraphQL execution-result повідомлень для однієї підписки.

2. Для кожного повідомлення створює окрему SSE-подію типу `next`, сумісну з wire-протоколом `graphql-sse` у distinct-connection режимі.

3. Повертає потік тіла відповіді, який MSW-хендлер може використати для мокання Apollo GraphQL-підписки у Storybook.

4. Завершує потік після надсилання всіх повідомлень, щоб сценарій підписки мав детермінований кінець.

5. Централізує формат тестових subscription-подій, щоб пакети не дублювали власну реалізацію цього протоколу.

## Публічний API

- sseSubscription — Формує SSE-стрім тіла відповіді для MSW-хендлера підписки graphql-sse.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
