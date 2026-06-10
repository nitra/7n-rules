# hc-yaml.mjs

## Огляд

Файл виконує структурну валідацію конфігурації `modeline` у файлах `hc.yaml`. Функція `validateAbieHcModeline` перевіряє відповідність конфігурації визначеному контракту. Валідація проводиться порівнянням конфігурації з визначеною схемою, доступною за посиланням https://datreeio.github.io/CRDs-catalog/networking.gke.io/healthcheckpolicy_v1.json. Цей процес забезпечує коректність конфігурації для ідентифікації (abie.mdc). Експортована константа ABIE_HC_SCHEMA_URL використовується для посилання на цю схему.

## Поведінка

validateAbieHcModeline перевіряє modeline у файлі `hc.yaml`.

Перевіряє, чи перший рядок не порожній. Повертає повідомлення про необхідність наявності modeline `# yaml-language-server: $schema=… (abie.mdc)`.

Перевіряє, чи перший рядок містить необхідний modeline. Повертає повідомлення про відсутність modeline $schema (abie.mdc).

Перевіряє, чи значення $schema відповідає очікуваному URL. Повертає повідомлення про неправильне значення $schema, включаючи необхідний URL: https://datreeio.github.io/CRDs-catalog/networking.gke.io/healthcheckpolicy_v1.json (abie.mdc).

Повертає null у разі успішної валідації.

## Публічний API

ABIE_HC_SCHEMA_URL — Зберігає референтний URL `$schema` для файлу `hc.yaml` (abie.mdc).

validateAbieHcModeline — Перевіряє формат modeline (`# yaml-language-server: $schema=...`) у файлі `hc.yaml`.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- За невдалої перевірки повертає `false`/`null` замість винятку.
- Не звертається до мережі.
