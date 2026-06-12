---
docgen:
  source: npm/rules/hasura/js/internal_urls.mjs
  crc: 83abefa3
  score: 90
---

# internal_urls.mjs

## Огляд

parseInternalHasuraEndpoint
Витягує значення HASURA_GRAPHQL_ENDPOINT з конфігурації для формування внутрішнього кластерного URL

isEnvFile
Перевіряє, чи файл має розширення .env і не є локальним файлом розробника

isNitraOrAbieRepository
Перевіряє, чи URL репозиторію містить маркери nitra або abie

check
Перевіряє коректність HASURA_GRAPHQL_ENDPOINT у файлах .env відповідно до конфігурації з package.json та YAML файлів

## Поведінка

parseInternalHasuraEndpoint
Розбирає значення HASURA_GRAPHQL_ENDPOINT як внутрішній кластерний URL

isEnvFile
Перевіряє, чи файл має розширення .env і не є локальним файлом розробника

isNitraOrAbieRepository
Перевіряє, чи URL репозиторію містить маркери nitra або abie

check
Перевіряє коректність HASURA_GRAPHQL_ENDPOINT у файлах .env відповідно до конфігурації з package.json та YAML файлів

## Публічний API

parseInternalHasuraEndpoint — розбиває значення `HASURA_GRAPHQL_ENDPOINT` на внутрішній URL кластера. Дозволяє `http://` та DNS-суфікс `<cluster>.internal` (GKE/GCP). Поле `cluster` містить ім'я кластера без `.internal` (наприклад `abie-ua`). Повертає сегменти або `{ ok: false }` при невідповідності формату внутрішнього кластерного URL.

isEnvFile — визначає, чи відносний шлях закінчується на `*.env`, який необхідно перевіряти (hasura.mdc). Файл з іменем `.env` повертається як виняток (false).

isNitraOrAbieRepository — перевіряє, чи URL репозиторію вказує на `nitra` або `abie` (за маркерами hasura.mdc).

check — виконує перевірку hasura.mdc для поточного робочого каталогу.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Не звертається до мережі.
