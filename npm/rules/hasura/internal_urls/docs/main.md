---
type: JS Module
title: main.mjs
resource: npm/rules/hasura/internal_urls/main.mjs
docgen:
  crc: 7e348cf3
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 95
  issues: anchor-miss:(hasura.mdc),judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл обмежує правило lint лише nitra/abie репозиторіями й перевіряє, що `HASURA_GRAPHQL_ENDPOINT` в env-файлах вказує на очікуваний внутрішній Hasura endpoint. Він потрібен, щоб знаходити розсинхронізацію між env-конфігурацією та очікуваним endpoint-контрактом, свідомо не перевіряючи `base/` і нерелевантні репозиторії. Для перевірки файл звертається до мережі; помилки перехоплює fail-safe, не кидає винятків назовні і в окремих збійних сценаріях повертає `null` або інше порожнє значення замість винятку.

## Поведінка

`lint` запускає перевірку від кореня репозиторію: спершу читає `package.json`, визначає належність проєкту через `isNitraOrAbieRepository` до nitra/abie за `https://github.com/nitra/` і `https://github.com/abinbevefes/`, а для інших репозиторіїв не створює порушень.

Для релевантних проєктів `computeExpectedEndpointSegments` бере очікувані значення з Kubernetes YAML у `hasura/k8s/base`, після чого `lint` обходить дерево `.env`-файлів, свідомо пропускаючи `base/` та службово проігноровані шляхи. `isEnvFile` відсіює локальний `.env`, щоб правило не чіпало персональне середовище розробника.

У кожному відібраному env-файлі `HASURA_ENDPOINT_LINE_RE` знаходить рядок з `HASURA_GRAPHQL_ENDPOINT`, а `parseInternalHasuraEndpoint` приймає лише внутрішній HTTP endpoint кластера й повертає сегменти для порівняння з очікуваними значеннями. Якщо змінної немає, файл вважається коректним.

Результати сходяться назад у `lint`: успішні перевірки не впливають на звіт, а невідповідності перетворюються на violations із маркером ``. Помилки читання або некоректні допоміжні дані обробляються fail-safe: перевірка не кидає винятки назовні й за потреби працює з порожніми значеннями замість аварійного завершення.

## Публічний API

- HASURA_ENDPOINT_LINE_RE — Знаходить рядок присвоєння `HASURA_GRAPHQL_ENDPOINT` у env-файлі; захоплює значення URL без лапок і коментаря.
- parseInternalHasuraEndpoint — Розбір значення `HASURA_GRAPHQL_ENDPOINT` як внутрішнього кластерного URL.
Дозволяє лише `http://` (TLS усередині кластера зайвий) та DNS-суфікс
`<cluster>.internal` (GKE/GCP). Поле `cluster` містить ім'я кластера без
`.internal` (наприклад `abie-ua`).
- isEnvFile — Чи відносний шлях вказує на `*.env`, який треба перевіряти hasura.mdc.
Файл рівно `.env` (без імені) — виключення з правила (локальний файл
розробника, hasura.mdc його не зачіпає), тому повертає false.
- isNitraOrAbieRepository — Чи URL репозиторію вказує на nitra або abie (за маркерами hasura.mdc).
- computeExpectedEndpointSegments — Обчислює очікувані `service`/`namespace` з `hasura/k8s/base/{svc-hl,namespace}.yaml`.
Використовується і детектором, і T0-фіксом (щоб не дублювати YAML-читання).
- lint — Перевіряє hasura.mdc для поточного робочого каталогу.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
- Свідомо пропускає шляхи: `base/`.
