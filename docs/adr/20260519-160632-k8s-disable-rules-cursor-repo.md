# Вимкнення правила `k8s` у cursor-репо через `disable-rules`

**Status:** Accepted
**Date:** 2026-05-19

## Context and Problem Statement
Cursor-репо містить власну реалізацію правила `k8s` під `npm/rules/k8s/`, де є сегмент `k8s` у шляхах. `findK8sRoots` знаходив цей каталог і запускав kubeconform на template-файлах (`*.snippet.yaml`, `policy/*/target.json`, `.kubescape-exceptions.json.snippet.json`), які не є справжніми K8s-маніфестами. Результат — помилки валідації (`missing 'kind' key`, `cannot unmarshal array`).

## Considered Options
* Додати `"disable-rules": ["k8s"]` у `.n-cursor.json` cursor-репо
* Додати `npm/rules/` до поля `ignore` у `.n-cursor.json`
* Виключати файли-шаблони за патерном у `findK8sRoots`

## Decision Outcome
Chosen option: "Додати `\"disable-rules\": [\"k8s\"]` у `.n-cursor.json` cursor-репо", because cursor-репо є self-referential і не повинно лінтити власну k8s-реалізацію як цільовий проєкт; це вирішує проблему без зміни логіки правила (нульовий ризик регресії для кінцевих користувачів).

### Consequences
* Good, because self-referential проблема вирішена без зміни логіки правила.
* Neutral, because `lint-k8s` більше не виконується в cursor-репо, і будь-які реальні K8s-маніфести (якщо з'являться) теж не будуть перевірені — transcript не містить підтвердження наслідку.

## More Information
- Змінений файл: `.n-cursor.json` (додано `"disable-rules": ["k8s"]`).
- `disable-rules` підтримується в `npm/bin/n-cursor.js:116` (масив сортується разом з `rules`, `skills`).
- Альтернатива поле `ignore` також обговорювалась у transcript, але не була обрана.
- Додаткової інформації в transcript не зафіксовано.
