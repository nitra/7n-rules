---
type: JS Module
title: main.mjs
resource: npm/rules/k8s/dremio_logging/main.mjs
docgen:
  crc: a89abb0a
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 95
  issues: anchor-miss:(k8s.mdc),judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`zkLogbackRootLevelViolation` перевіряє повідомлення, пов’язані з надто гучним `root` у `k8s.mdc`, а `lint` збирає ці перевірки в один pass і повертає результат без зупинки процесу. Поведінка read-only: правило не пише у ФС чи БД, працює fail-safe й не кидає винятків назовні.

## Поведінка

- `zkLogbackRootLevelViolation` — перевіряє, чи вбудований `logback.xml` у ZooKeeper-templated файлі не тримає `root` на надто гучному рівні; повертає текст порушення з міткою `` або `null`, якщо перевірка не потрібна або рівень уже прийнятний.
- `lint` — проходить по вказаних файлах у read-only режимі, збирає порушення для `k8s.dremio_logging` і не виводить помилки назовні; пропускає файли, які не вдалося прочитати, та позначає знайдені проблеми міткою ``.

## Публічний API

- zkLogbackRootLevelViolation — позначає ZooKeeper Helm-темплейт, якщо вбудований `logback.xml` має занадто гучний `root`-рівень (`info`, `debug`, `trace`) або взагалі не задає `root`; не чіпає файли, де `root` уже `warn`, `error` чи `off`.
- lint — запускає `k8s.dremio_logging` для ZooKeeper-темплейтів у межах одного файлу, лише для читання.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
