---
type: JS Module
title: fix-service_deploy_pipeline.mjs
resource: plugins/ci-azure/rules/azure-pipelines/service_deploy_pipeline/fix-service_deploy_pipeline.mjs
docgen:
  crc: 7841b82d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл існує для автоматичного переведення legacy `.azurepipelines/**.yml` у сервіс-канон ADR 260718-0835: він детерміновано переписує pipeline-и, де `trigger.paths.include` не відповідає формі `plan → lint_<domain> → deploy`, бо `lint --path` у `@7n/rules` 1.17 змінив семантику без major-бампа; `plan` додається через `bunx n-rules ci plan --path <svc> --azure`, а `lint_<key>` визначаються за файлами піддерева сервісу тими самими glob-ами, що й `ci plan`. Міграція зберігає коментарі та незачеплене форматування завдяки мутаціям через YAML Document API (`setIn`/`splice`). Також вона підшиває потрібні `dependsOn` і `condition` для нових lint-джоб і не перезаписує нетривіальний `condition`. Файл працює fail-safe: не кидає винятків назовні й за окремих помилок повертає порожнє значення замість exception.

## Поведінка

- `migratePipelineFile` — Мігрує один `.azurepipelines/**.yml` із `trigger.paths.include` до сервіс-канону: за потреби додає `plan`, замінює legacy `lint`-джоби на per-domain `lint_<key>`, підшиває `dependsOn`/`condition` і `--no-fix`, зберігаючи коментарі та форматування; якщо файл поза скоупом, `null` або міграція не вдається, повертає `false` без винятку назовні.
- `patterns` — Описує rule-pattern, який знаходить порушені service pipeline-и та застосовує автоматичну міграцію до кожного знайденого файлу; помилки окремих файлів перехоплює, а результатом повертає список змінених файлів і повідомлення про кількість мігрованих pipeline-ів.

## Публічний API

- migratePipelineFile — переносить один pipeline-файл у канонічний формат і сигналізує, чи були зміни.
- patterns — T0-патерн для fix-конвеєра: розпізнає порушені service pipeline-и й застосовує міграцію.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
