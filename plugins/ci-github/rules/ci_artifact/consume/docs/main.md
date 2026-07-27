---
type: JS Module
title: main.mjs
resource: plugins/ci-github/rules/ci_artifact/consume/main.mjs
docgen:
  crc: 59ff5c46
---

Detector generic-consumer-а слоту `ci.artifact@1` для `ci:github` (spec `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.2). Матеріалізує кожну активну contribution проти поточного стану consumer-репо — без жодного PHP/lang-specific literal тут, уся domain-семантика приходить із payload-у contribution-а.

## Поведінка

1. `collectArtifacts(ctx.cwd)` збирає всі валідні (без колізій) `ci.artifact@1` contributions для `ci:github`.
2. `reportCiArtifactCollectionDiagnostics` репортить invalid-payload/collision діагностики.
3. Для кожної релевантної contribution: `loadCanonicalTemplate` читає canonical YAML; при помилці — violation `template-error`. Інакше `diagnoseArtifact` порівнює `targetPath` з canonical-фрагментом:
   - файл відсутній, `mode: "required-file"` → violation `artifact-missing` (T0 створить файл);
   - файл відсутній, `mode: "patch-existing"` → без violation (файл належить іншому, окремому концерну);
   - файл є, є mismatch — violation `artifact-mismatch` на кожен mismatch-рядок.

Кожна violation несе `data: { kind, artifactId, contributorPlugin, contributionId, fix }` — T0 (`fix-consume.mjs`) використовує ці поля, щоб визначити, які contributions застосовувати.

## Публічний API

`lint(ctx)` — detector-контракт unified lint surface (`LintContext → LintResult`).

## Гарантії поведінки

* **Provider-agnostic**: жодного PHP чи іншого lang-specific literal — уся семантика приходить із payload-у contribution-а.
* **Мовчазний skip для `patch-existing`**: відсутність target-файлу в цьому режимі не порушення ЦЬОГО concern-а.
* **Diagnostics із provenance**: кожне повідомлення включає `artifactId` і `contributorPlugin`.
