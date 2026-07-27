---
type: JS Module
title: collect-artifacts.mjs
resource: plugins/ci-github/rules/ci_artifact/consume/collect-artifacts.mjs
docgen:
  crc: c6f96721
---

Тонка обгортка над `collectCiArtifactContributions` (`@7n/rules/scripts/lib/ci-artifact-collect.mjs`) з capability цього consumer-а (spec `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.2). Спільна для detector-а (`main.mjs`) і T0-фіксу (`fix-consume.mjs`) — щоб обидва бачили один і той самий набір contributions в одному й тому ж graph-порядку.

## Поведінка

`collectArtifacts(cwd)` викликає `collectCiArtifactContributions(cwd, 'ci:github')` — лише фіксує `targetCapability` цього consumer-а, уся інша логіка (collect + collision-детекція) живе в спільному `@7n/rules` helper-і.

## Публічний API

`collectArtifacts` — повертає `{ relevant, collisions, errors }` для `ci:github`.

## Гарантії поведінки

* **Один consumer — одна capability**: `TARGET_CAPABILITY = 'ci:github'` — фіксоване значення, не параметризується ззовні.
* **Той самий контракт, що й Azure-consumer**: обидва просто передають різну capability у спільний `collectCiArtifactContributions`.
