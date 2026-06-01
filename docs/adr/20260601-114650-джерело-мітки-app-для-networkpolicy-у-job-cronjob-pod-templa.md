---
session: 7c82f900-0137-439e-94ec-f340366e57a4
captured: 2026-06-01T11:46:50+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/7c82f900-0137-439e-94ec-f340366e57a4.jsonl
---

## ADR Джерело мітки `app` для NetworkPolicy у Job/CronJob — pod-template labels

## Context and Problem Statement
У правилі `k8s` (`@nitra/cursor`) функція `workloadAppLabel` читала мітку `app` для `CronJob` з `spec.jobTemplate.spec.selector.matchLabels.app`. Це невалідне поле: apiserver відхиляє Job без `manualSelector: true`, бо `spec.selector` у Job/CronJob генерується контролером автоматично. Через це споживачі були змушені додавати фейковий `jobTemplate.spec.selector` у маніфести.

## Considered Options
* Читати мітку `app` з pod-template labels (`spec.template.metadata.labels.app` / `spec.jobTemplate.spec.template.metadata.labels.app`)
* Дозволити `manualSelector: true` як легальний обхід
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Читати мітку `app` з pod-template labels", because pod-template labels — валідне й завжди присутнє поле; `spec.selector` у Job/CronJob без `manualSelector: true` відхиляється apiserver, тому покладатися на нього некоректно.

Зміни охоплюють обидва workload-типи:
- **Job** → `spec.template.metadata.labels.app` (новий хелпер `appLabelFromPodTemplate`)
- **CronJob** → `spec.jobTemplate.spec.template.metadata.labels.app`
- **Deployment / StatefulSet / DaemonSet** — без змін (`spec.selector.matchLabels.app`)

Додатково: `workloadAppLabel` для CronJob без `spec` (або `spec: null`) тепер повертає `null` замість `TypeError` — ваду знайдено під час впровадження.

### Consequences
* Good, because CronJob-маніфест без `jobTemplate.spec.selector` проходить `check k8s` без помилки — споживачам більше не потрібен фейковий selector.
* Good, because поведінка узгоджена між JS-логікою (`manifests.mjs`), повідомленням `fail` і документацією (`k8s.mdc`); rego-шар Job/CronJob не зачіпає.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/k8s/js/manifests.mjs` — доданий хелпер `appLabelFromPodTemplate(spec)`, оновлено `workloadAppLabel` (~рядок 4044), повідомлення `fail` (~рядок 5634)
- `npm/rules/k8s/k8s.mdc:388` — документація NetworkPolicy оновлена
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — оновлено та додано тести для Job, CronJob, malformed-CronJob
- Change-файли: `npm/.changes/1780303133983-34569d.md` (bump: patch, Fixed), `npm/.changes/1780303502325-9cd834.md` (bump: patch, Fixed — null-safety)
- Перевірено: JS 743/743, rego 42/42 (`opa test`)
- Команда деривації: `npx @nitra/cursor change --bump patch --section Fixed --ws npm`
