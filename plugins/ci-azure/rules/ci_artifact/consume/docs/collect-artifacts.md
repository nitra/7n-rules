---
type: JS Module
title: collect-artifacts.mjs
resource: plugins/ci-azure/rules/ci_artifact/consume/collect-artifacts.mjs
docgen:
  crc: 74241d83
---

Тонка обгортка над `collectCiArtifactContributions` (`@7n/rules/scripts/lib/ci-artifact-collect.mjs`) з capability цього consumer-а (spec `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.3). Спільна логіка (collect + collision-детекція) живе в `@7n/rules`'s `ci-artifact-collect.mjs` — той самий контракт, що й `@7n/rules-ci-github`, розрізняючись лише capability-фільтром.

## Поведінка

`collectArtifacts(cwd)` викликає `collectCiArtifactContributions(cwd, 'ci:azure')`.

## Публічний API

`collectArtifacts` — повертає `{ relevant, collisions, errors }` для `ci:azure`.

## Гарантії поведінки

* **Один consumer — одна capability**: `TARGET_CAPABILITY = 'ci:azure'` — фіксоване значення.
* **Той самий контракт, що й GitHub-consumer**: обидва просто передають різну capability у спільний `collectCiArtifactContributions`.
