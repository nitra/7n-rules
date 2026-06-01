---
session: 7c82f900-0137-439e-94ec-f340366e57a4
captured: 2026-06-01T11:40:55+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/7c82f900-0137-439e-94ec-f340366e57a4.jsonl
---

## ADR Джерело мітки `app` для NetworkPolicy у Job/CronJob — pod-template labels замість `spec.selector`

## Context and Problem Statement

Правило `k8s` в `@nitra/cursor` визначало мітку `app` для CronJob з `spec.jobTemplate.spec.selector.matchLabels.app`, а для Job — з `spec.selector.matchLabels.app`. Kubernetes-apiserver відхиляє Job/CronJob з ручним `spec.selector` без `manualSelector: true` (селектор з `controller-uid` генерується контролером автоматично), тому споживачі були змушені додавати фейковий `jobTemplate.spec.selector` у маніфести, щоб пройти перевірку.

## Considered Options

* Читати `app` з `spec.selector.matchLabels.app` / `spec.jobTemplate.spec.selector.matchLabels.app` (попередня поведінка)
* Читати `app` з pod-template labels: `spec.template.metadata.labels.app` для Job та `spec.jobTemplate.spec.template.metadata.labels.app` для CronJob

## Decision Outcome

Chosen option: "Читати `app` з pod-template labels", because pod-template labels є валідним і завжди присутнім полем у Job/CronJob, тоді як ручний `spec.selector` відхиляється apiserver без `manualSelector: true`.

### Consequences

* Good, because CronJob і Job маніфести більше не потребують фейкового `spec.selector` / `jobTemplate.spec.selector` для проходження перевірки NetworkPolicy.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `npm/rules/k8s/js/manifests.mjs` — функція `workloadAppLabel()` (~рядок 4019): CronJob-гілка замінена з `appLabelFromSpecSelector(jobSpec)` на новий хелпер, що читає з `jobTemplate.spec.template.metadata.labels.app`; Job-гілка аналогічно переведена на `spec.template.metadata.labels.app`.
- `npm/rules/k8s/js/manifests.mjs` ~рядок 5634 — текст `fail`-повідомлення оновлено: замість `spec.selector.matchLabels.app або jobTemplate для CronJob` тепер вказує на `spec.jobTemplate.spec.template.metadata.labels.app` для CronJob.
- `npm/rules/k8s/k8s.mdc` рядок ~388 — документація NetworkPolicy: фраза «для CronJob — з `spec.jobTemplate.spec.selector.matchLabels`» замінена на `spec.jobTemplate.spec.template.metadata.labels.app`.
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — тест `workloadAppLabel для StatefulSet і CronJob` оновлено: фікстура CronJob має `app` лише в `jobTemplate.spec.template.metadata.labels`, без `jobTemplate.spec.selector`.
- Change-файл: `npm/.changes/1780303133983-34569d.md` (bump: patch, section: Fixed).
- Верифікація: `node -e` підтверджує — CronJob з `app` лише в template labels повертає мітку; CronJob лише з `selector` (без template labels) повертає `null`.
