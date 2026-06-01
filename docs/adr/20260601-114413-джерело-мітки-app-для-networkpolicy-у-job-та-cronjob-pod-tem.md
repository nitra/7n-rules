---
session: 7c82f900-0137-439e-94ec-f340366e57a4
captured: 2026-06-01T11:44:13+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/7c82f900-0137-439e-94ec-f340366e57a4.jsonl
---

## ADR Джерело мітки `app` для NetworkPolicy у Job та CronJob — pod-template labels

## Context and Problem Statement

У пакеті `@nitra/cursor` (правило `k8s`) функція `workloadAppLabel()` читала мітку `app` для `CronJob` з `spec.jobTemplate.spec.selector.matchLabels.app`, а для `Job` — з `spec.selector.matchLabels.app`. Ручний `spec.selector` у Job/CronJob є невалідним: apiserver відхиляє такий ресурс без `manualSelector: true`, оскільки селектор генерується контролером автоматично. Через це споживачі змушені були додавати фейковий `jobTemplate.spec.selector` у маніфести.

## Considered Options

* Зберегти `spec.selector.matchLabels.app` і легалізувати через `manualSelector: true`
* Перенести джерело мітки на pod-template labels (`spec.template.metadata.labels.app` / `spec.jobTemplate.spec.template.metadata.labels.app`)

## Decision Outcome

Chosen option: "Перенести джерело мітки на pod-template labels", because `spec.selector` у Job/CronJob є невалідним без `manualSelector: true`; pod-template labels є валідним і завжди присутнім полем, тому саме вони мають слугувати джерелом мітки `app`.

### Consequences

* Good, because споживачі більше не зобов'язані додавати фейковий `spec.selector` у маніфести CronJob/Job.
* Good, because `workloadAppLabel()` захищено від `null`/відсутнього `spec` (виявлена в ході правки вада: CronJob без `spec` кидав виняток, виправлено через `getNestedObject` по ланцюжку).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `npm/rules/k8s/js/manifests.mjs` — додано хелпер `appLabelFromPodTemplate(spec)`, що читає `spec.template.metadata.labels.app`; `workloadAppLabel()` для `CronJob` тепер звертається до `spec.jobTemplate.spec.template.metadata.labels.app`, для `Job` — до `spec.template.metadata.labels.app`; Deployment/StatefulSet/DaemonSet лишилися на `spec.selector.matchLabels.app`.
- `npm/rules/k8s/js/manifests.mjs` — оновлено повідомлення `fail`: тепер явно вказує `spec.template.metadata.labels.app` для Job і `spec.jobTemplate.spec.template.metadata.labels.app` для CronJob.
- `npm/rules/k8s/k8s.mdc:388` — абзац про NetworkPolicy уточнено аналогічно.
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — оновлено тест `workloadAppLabel для StatefulSet і CronJob`; додано тест для `Job` (template labels) та для `CronJob`/`Job` з відсутнім `spec` (повертає `null`, не виняток).
- Тести: JS 743/743 зелені (`vitest run`), rego 42/42 (`opa test`).
- Change-file: `npm/.changes/1780303133983-34569d.md` (`bump: patch`, `section: Fixed`).
- `manualSelector: true` як рішення явно відхилено — мета прибрати залежність від ручного selector, а не легалізувати його.
