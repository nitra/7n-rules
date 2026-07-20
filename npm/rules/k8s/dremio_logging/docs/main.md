---
type: JS Module
title: main.mjs
resource: npm/rules/k8s/dremio_logging/main.mjs
docgen:
  crc: a89abb0a
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 95
  issues: anchor-miss:(k8s.mdc),judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Перевіряє `zookeeper.yaml` на надто гучний `root level` у вбудованому `logback.xml` і формує звіт про порушення з маркером `zk-logback-root-level`. `zkLogbackRootLevelViolation` і `lint` працюють як read-only, не змінюють ФС чи БД, і поводяться fail-safe: помилки перехоплюються, назовні винятки не виходять.

## Поведінка

- `zkLogbackRootLevelViolation` — перевіряє, чи вбудований `logback.xml` у `zookeeper.yaml` має допустимий `root level` (`warn`, `error`, `off`); якщо блоку немає — не чіпає файл, якщо рівень надто гучний або відсутній — повертає текст порушення з посиланням на `k8s.mdc`.
- `lint` — проходить по вказаних файлах, безпечно читає їх як `zookeeper.yaml`-кандидати, фіксує порушення для `k8s.dremio_logging` і не перериває перевірку на помилках читання; для кожного знайденого випадку додає повідомлення з маркером `zk-logback-root-level`.

## Публічний API

- zkLogbackRootLevelViolation — знаходить у Helm-темплейті ZooKeeper вбудований `logback.xml`, де `root` заданий занадто гучно або взагалі відсутній; пропускає, якщо рівень уже `warn`, `error` чи `off`
- lint — запускає `k8s.dremio_logging` для ZooKeeper-темплейту на рівні окремого файла, без змін у вмісті

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
