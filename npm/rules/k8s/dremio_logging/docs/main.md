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

Перевіряє коректність root-рівня логування у конфігурації k8s.mdc і сигналізує про порушення, коли root надто гучний або не задано. `zkLogbackRootLevelViolation` формує зрозумілий маркер порушення ``, а `lint` зупиняє пропуск некоректної конфігурації, не виносячи помилки назовні.

## Поведінка

- `zkLogbackRootLevelViolation` — перевіряє, чи вбудований `logback.xml` у ZooKeeper-templated `zookeeper.yaml` має допустимий рівень root; повертає текст порушення з маркером ``, якщо рівень надто гучний або root не задано, і `null`, коли перевіряти нічого або конфігурація вже прийнятна.
- `lint` — проходить по файлах із контексту лінту, читає їх у режимі read-only, фіксує порушення для ZooKeeper-templated `zookeeper.yaml` через `fail` із маркером `` і не пропускає винятки назовні.

## Публічний API

- zkLogbackRootLevelViolation — знаходить у ZooKeeper Helm-template вбудований `logback.xml`, якщо `root level` занадто гучний або взагалі не заданий; `warn/error/off` пропускає.
- lint — запускає read-only detector `k8s.dremio_logging` для ZooKeeper-template пофайлово.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
