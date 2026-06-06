# k8s NetworkPolicy: мітка `app` для Job/CronJob — з pod-template labels

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

Правило `k8s` в `@nitra/cursor` визначало мітку `app` для генерації NetworkPolicy: для CronJob — з `spec.jobTemplate.spec.selector.matchLabels.app`, для Job — з `spec.selector.matchLabels.app`. Kubernetes apiserver відхиляє Job/CronJob з ручним `spec.selector` без `manualSelector: true` (селектор з `controller-uid` генерується контролером автоматично). Споживачі були вимушені додавати фейковий `spec.selector` / `jobTemplate.spec.selector` у маніфести лише для проходження перевірки NetworkPolicy.

## Considered Options

- Читати `app` з `spec.selector.matchLabels.app` / `spec.jobTemplate.spec.selector.matchLabels.app` (попередня поведінка).
- Читати `app` з pod-template labels: `spec.template.metadata.labels.app` для Job та `spec.jobTemplate.spec.template.metadata.labels.app` для CronJob.

## Decision Outcome

Chosen option: "Читати `app` з pod-template labels", because pod-template labels є валідним і завжди присутнім полем у Job/CronJob, тоді як ручний `spec.selector` відхиляється apiserver без `manualSelector: true`.

### Consequences

- Good, because CronJob і Job маніфести більше не потребують фейкового `spec.selector` для проходження перевірки NetworkPolicy.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because CronJob з `app` лише у `spec.selector` (без template labels) тепер повертає `null` — верифіковано через `node -e`.

## More Information

- `npm/rules/k8s/js/manifests.mjs` функція `workloadAppLabel()` (~рядок 4019): CronJob-гілка змінена з `appLabelFromSpecSelector(jobSpec)` на хелпер, що читає `jobTemplate.spec.template.metadata.labels.app`; Job-гілка — на `spec.template.metadata.labels.app`.
- `npm/rules/k8s/js/manifests.mjs` ~рядок 5634 — текст `fail`-повідомлення оновлено: замість `spec.selector.matchLabels.app або jobTemplate для CronJob` → `spec.jobTemplate.spec.template.metadata.labels.app`.
- `npm/rules/k8s/k8s.mdc` рядок ~388 — документація NetworkPolicy оновлена відповідно.
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — тест `workloadAppLabel для StatefulSet і CronJob` оновлено: фікстура CronJob має `app` лише в `jobTemplate.spec.template.metadata.labels`, без `jobTemplate.spec.selector`.
- Change-файл: `npm/.changes/1780303133983-34569d.md` (bump: patch, section: Fixed).

## Update 2026-06-01

- Другий change-файл `npm/.changes/1780303502325-9cd834.md` (bump: patch, Fixed) — null-safety для CronJob без `spec`.
- `workloadAppLabel` для CronJob без `spec` (або `spec: null`) повертає `null` замість `TypeError` — ваду знайдено в ході впровадження, виправлено через `getNestedObject` по ланцюжку.
- Конкретні рядки у `npm/rules/k8s/js/manifests.mjs`: `workloadAppLabel()` — ~рядок 4044, повідомлення `fail` — ~рядок 5634.
- `manualSelector: true` як рішення явно відхилено: мета — прибрати залежність від ручного selector, а не легалізувати його.
- Rego-шар Job/CronJob не зачіплено рефакторингом.
