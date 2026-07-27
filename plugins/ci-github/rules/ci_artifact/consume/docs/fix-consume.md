---
type: JS Module
title: fix-consume.mjs
resource: plugins/ci-github/rules/ci_artifact/consume/fix-consume.mjs
docgen:
  crc: 0306103e
---

T0-фікс generic-consumer-а слоту `ci.artifact@1` (`mergeStrategy: "deep-subset"`, spec `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.2). Приводить кожен цільовий файл до канонічного `template` — детерміновано, без LLM.

## Поведінка

Патерн `ci-github-ci-artifact-consume`:

1. `test` — застосовний, якщо серед violations є хоч одна з `data.kind` `artifact-missing`/`artifact-mismatch` і `data.fix === true`.
2. `apply` — заново викликає `collectArtifacts(ctx.cwd)` (той самий graph-порядок, що детектор), і для кожної релевантної contribution, чий `(artifactId, targetPath)` збігається з targeted violations і `descriptor.fix === true`, викликає `loadCanonicalTemplate` + `applyDeepSubsetFix`.

Contributions застосовуються у ТОМУ САМОМУ graph-порядку, що детектор (spec §10 Фаза 3 п.4 — deterministic order при двох contributors в один target file): кожен наступний виклик `applyDeepSubsetFix` читає файл ПІСЛЯ merge-у попередньої contribution, тож contribution Б (напр. `patch-existing`) бачить уже застосовану contribution А (напр. `required-file`).

## Публічний API

`patterns` — масив `T0Pattern[]` (один елемент: `ci-github-ci-artifact-consume`).

## Гарантії поведінки

* **Contribution-scoped fix**: T0 чіпає лише ті `(artifactId, targetPath)`, для яких були targeted violations — не перезаписує contributions, чий `fix === false`.
* **Ідемпотентність**: успадковується від `applyDeepSubsetFix` — повторний прогін без нових violations не пише файли.
* **Fail-safe на template-error**: якщо `loadCanonicalTemplate` не вдається — T0 нічого не пише для цієї contribution (детектор уже репортить `template-error` окремо).
