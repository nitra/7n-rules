---
session: 8a604541-32f2-4a17-b482-d057d3059bc4
captured: 2026-05-19T16:06:32+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8a604541-32f2-4a17-b482-d057d3059bc4.jsonl
---

## ADR Перехід з stdin на тимчасовий файл для `kubescape scan` (v4.x)

## Context and Problem Statement
`kubescape v4.0.8` не читає маніфест зі stdin через `-` (аргумент `scan -`): замість читання потоку він трактує `-` як шлях до файлу і повертає `fatal: no resources found to scan`. Реалізація `runKubescapeStdin` у `npm/rules/k8s/lint/lint.mjs:204–212` передавала буфер з `kubectl kustomize` через `spawnSync` з `input:` / `stdio:['pipe', ...]`, що спричиняло exit 1 на `lint-k8s` у всіх репо, що використовують `@nitra/cursor`.

## Considered Options
* Передавати маніфест через тимчасовий файл (`mkdtempSync` → `kubescape scan <file>` → `rm -rf` у `finally`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Передавати маніфест через тимчасовий файл", because kubescape v4.x не підтримує stdin, а передача через `kubescape scan <path>` підтверджена як робоча (exit 0 у `kubectl kustomize … > /tmp/built.yaml && kubescape scan /tmp/built.yaml`).

### Consequences
* Good, because transcript фіксує очікувану користь: мінімальний kustomize-тест пройшов kubescape успішно (exit 0, "All controls passed").
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/k8s/lint/lint.mjs` (функція перейменована з `runKubescapeStdin` → `runKubescapeManifest`), `npm/rules/k8s/k8s.mdc` (версія `1.38` → `1.39`, текст про вхід kubescape оновлено), `npm/package.json` (`1.13.50` → `1.13.51`), `npm/CHANGELOG.md`.
- `node_modules/@nitra/cursor` є symлінком на `../../npm`, тому фікс активний одразу.
- Команда `kubescape scan --help` не згадує stdin — підтверджує, що stdin не підтримується в v4.x.
- `kubescape version`: `4.0.8`, Build: Homebrew, 2026-05-08.

---

## ADR Вимкнення правила `k8s` у cursor-репо через `disable-rules`

## Context and Problem Statement
Cursor-репо містить власні сорці правила `k8s` під `npm/rules/k8s/`, у шляху яких є сегмент `k8s`. `findK8sRoots` знаходить цей каталог і запускає kubeconform на template-файлах (`*.snippet.yaml`, `policy/*/target.json`, `.kubescape-exceptions.json.snippet.json`), які не є справжніми K8s-маніфестами. Результат — помилки валідації (`missing 'kind' key`, `cannot unmarshal array`).

## Considered Options
* Додати `"disable-rules": ["k8s"]` у `.n-cursor.json` cursor-репо
* Додати `npm/rules/` до поля `ignore` у `.n-cursor.json`
* Виключати файли-шаблони за патерном у `findK8sRoots`

## Decision Outcome
Chosen option: "Додати `\"disable-rules\": [\"k8s\"]` у `.n-cursor.json` cursor-репо", because користувач самостійно застосував цей підхід — cursor-репо є self-referential і не повинно лінтити власну k8s-реалізацію як цільовий проєкт.

### Consequences
* Good, because transcript фіксує очікувану користь: вирішує self-referential проблему без зміни логіки правила (нульовий ризик регресії для кінцевих користувачів).
* Bad, because `lint-k8s` більше не виконується в cursor-репо, і будь-які реальні K8s-маніфести в репо (якщо з'являться) теж не будуть перевірені — Neutral, because transcript не містить підтвердження наслідку.

## More Information
- Змінений файл: `.n-cursor.json` (додано `"disable-rules": ["k8s"]`).
- `disable-rules` підтримується в `npm/bin/n-cursor.js:116` (масив сортується разом з `rules`, `skills`).
- Альтернатива `ignore` поле також обговорювалась у transcript, але не була обрана.
