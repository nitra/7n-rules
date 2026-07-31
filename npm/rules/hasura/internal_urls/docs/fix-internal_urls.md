---
type: JS Module
title: fix-internal_urls.mjs
resource: npm/rules/hasura/internal_urls/fix-internal_urls.mjs
docgen:
  crc: 3dcef8d3
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 75
---

## Поведінка

1. Ініціюється перевірка, де застосовуються визначені в `patterns` правила.
2. Для кожної виявленої порушення, що стосується причини `internal-url-service-mismatch` або `internal-url-namespace-mismatch`:
    3. Обчислюється очікувана коректна назва служби та простір імен шляхом зчитування метаданих з файлів `hasura/k8s/base/svc-hl.yaml` та `hasura/k8s/base/namespace.yaml`.
    4. Виявляються всі файли, що містять порушення, і які не знаходяться у директорії `base/`.
    5. Для кожного такого файлу виконується спроба заміни значення `HASURA_GRAPHQL_ENDPOINT` на очікуване:
        а. Значення з файлу зчитується та парситься для отримання поточної інформації про кластер та порт.
        б. Якщо початковий URL є внутрішнім кластерним URL і не виявляє відмінностей у сегментах `service` або `namespace` (з урахуванням очікуваних значень), заміна не виконується.
        в. В іншому випадку, значення `HASURA_GRAPHQL_ENDPOINT` у файлі замінюється, зберігаючи існуючий `cluster` та `port`.
        г. Здійснюється запис зміненого файлу.
6. Якщо один або більше файлів були змінені, повертається інформація про змінені файли та повідомлення про застосування правила.

## Сценарії використання

- `npm/rules/hasura/internal_urls/tests/fix-internal_urls.test.mjs` (hasura-internal-url-mismatch pattern) — test: спрацьовує лише на mismatch-причини; apply: переписує service, зберігаючи namespace/cluster/port; apply: не чіпає структурно невалідний URL (internal-url-invalid)

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Свідомо пропускає шляхи: `base/`.
