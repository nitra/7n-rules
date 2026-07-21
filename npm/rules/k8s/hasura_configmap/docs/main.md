---
type: JS Module
title: main.mjs
resource: npm/rules/k8s/hasura_configmap/main.mjs
docgen:
  crc: ec4396c4
  model: openai-codex/gpt-5.4-mini
  score: 90
  issues: internal-name:validateHasuraConfigMapRemoteSchemaPermissions,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Gated detector для поверхні `k8s/hasura_configmap`, який захищає `hasura_configmap.rego` від промоції в ungated standalone detector через generic lint-surface з `hasHandWrittenMain` у `scripts/lib/lint-surface/detect.mjs`. Саме `k8s/manifests/main.mjs` через `findDeploymentDocInDir` і `isHasuraDeploymentManifest` робить cross-file JS-гейт і лише тоді викликає `validateHasuraConfigMapRemoteSchemaPermissions`, тож перевірка охоплює тільки ті `ConfigMap`, для яких поруч є Hasura Deployment. Це потрібно, щоб не проганяти Hasura-специфічний `rego` на звичайні `ConfigMap` у `k8s` і не ловити false positive на CronJob/Job `ConfigMap` поза Hasura-манифестами, зокрема в контексті issue `efes-cloud/backend`.

## Поведінка

1. `lint` запускає перевірку поверхні `k8s/hasura_configmap` у режимі read-only та збирає підсумок через reporter.
2. Вона бере корінь workspace, враховує `cursor`-ігнори й шукає YAML-файли лише в межах `k8s`.
3. Якщо в `k8s` немає YAML-файлів, перевірку пропускає і повертає успішний результат без порушень.
4. Якщо YAML-файли знайдені, перевіряє лише ті ConfigMap, для яких поруч є Hasura Deployment; звичайні ConfigMap без такого сусідства не ескалюються в цю перевірку.
5. У разі виявлення невідповідностей фіксує порушення, а за відсутності проблем — підтверджує успішний стан.

## Публічний API

- lint — Detector k8s/hasura_configmap (read-only).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
