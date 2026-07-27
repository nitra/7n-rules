---
type: JS Module
title: main.mjs
resource: plugins/ci-azure/rules/ci_artifact/consume/main.mjs
docgen:
  crc: 56a629fd
---

Detector generic-consumer-а слоту `ci.artifact@1` для `ci:azure` (spec `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.3). Перевіряє наявність канонічного lint-кроку (АБО загального full-lint fallback-у) на будь-якій глибині `azure-pipelines.yml` — без жодного PHP/lang-specific literal тут.

## Поведінка

1. `collectArtifacts(ctx.cwd)` збирає всі валідні (без колізій) `ci.artifact@1` contributions для `ci:azure`.
2. `reportCiArtifactCollectionDiagnostics` репортить invalid-payload/collision діагностики.
3. Для кожної релевантної contribution: `loadCanonicalCommand` читає canonical-команду з template; при помилці — violation `template-error`. Інакше `diagnoseArtifact` перевіряє `targetPath`:
   - файл відсутній → без violation (`patch-existing`-семантика: pipeline-файл належить окремому концерну azure-pipelines);
   - файл є, без canonical/fallback-кроку або без `--no-fix` — violation `artifact-mismatch`.

v1 — diagnostic-only: `fix: false` у payload, T0-фіксу немає.

## Публічний API

`lint(ctx)` — detector-контракт unified lint surface (`LintContext → LintResult`).

## Гарантії поведінки

* **Provider-agnostic**: жодного PHP чи іншого lang-specific literal — уся семантика приходить із payload-у contribution-а.
* **Мовчазний skip при відсутньому pipeline-файлі**: файл належить іншому, окремому концерну.
* **Diagnostics із provenance**: кожне повідомлення включає `artifactId` і `contributorPlugin`.
