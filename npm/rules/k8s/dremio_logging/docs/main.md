---
type: JS Module
title: main.mjs
resource: npm/rules/k8s/dremio_logging/main.mjs
docgen:
  crc: a89abb0a
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл описує правило для `zookeeper.yaml`, яке через `zkLogbackRootLevelViolation` виявляє надто гучний `root level` або відсутній `root` у пов’язаній конфігурації й повертає текст порушення з маркером ``. Також `lint` обходить файли, збирає такі порушення без запису у ФС чи БД і працює fail-safe: помилки перехоплює, назовні винятки не кидає.

## Поведінка

- zkLogbackRootLevelViolation — перевіряє, чи вміст `zookeeper.yaml` містить вбудований `logback.xml` з допустимим `root level` для `ConfigMap`, і повертає текст порушення, якщо рівень занадто гучний або `root` відсутній; інакше повертає `null` (k8s.mdc).
- lint — проходить по вказаних файлах, безпечно читає їхній вміст, застосовує перевірку для ZooKeeper-темплейта і збирає знайдені порушення, не кидаючи винятків назовні та не змінюючи ФС/БД (k8s.mdc).

## Публічний API

zkLogbackRootLevelViolation — знаходить у ZooKeeper Helm-темплейті вбудований `logback.xml`, якщо `root` виставлено на надто гучний рівень (`info/debug/trace`) або якщо `root` взагалі відсутній; не сигналить, коли рівень уже `warn/error/off`.

lint — read-only detector `k8s.dremio_logging` для ZooKeeper-темплейта, який працює per-file.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
