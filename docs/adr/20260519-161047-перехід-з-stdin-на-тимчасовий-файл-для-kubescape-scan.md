---
session: 8a604541-32f2-4a17-b482-d057d3059bc4
captured: 2026-05-19T16:10:47+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8a604541-32f2-4a17-b482-d057d3059bc4.jsonl
---

## ADR Перехід з stdin на тимчасовий файл для kubescape scan

## Context and Problem Statement
`kubescape v4.0.8` не підтримує читання stdin через `kubescape scan -` — замість stdin він трактує `-` як шлях до файлу і повертає `no files found to scan` / `no resources found to scan`, завершуючись exit 1. Попередня реалізація `runKubescapeStdin` у `npm/rules/k8s/lint/lint.mjs` передавала kustomize-маніфест через stdin (`stdio: ['pipe', 'inherit', 'inherit']`), що призводило до падіння `bun run lint` на кроці `lint-k8s` у всіх репозиторіях.

## Considered Options
* Передавати маніфест через stdin (pipe) → `kubescape scan -` (попередня реалізація, @nitra/cursor 1.13.49–1.13.50)
* Писати маніфест у тимчасовий файл і передавати шлях → `kubescape scan <tmpfile>`

## Decision Outcome
Chosen option: "Писати маніфест у тимчасовий файл і передавати шлях", because `kubescape scan --help` у v4.0.8 не згадує stdin; ручна перевірка підтвердила, що `kubectl kustomize <dir> > /tmp/built.yaml && kubescape scan /tmp/built.yaml --severity-threshold high` завершується exit 0 і виводить `All controls passed`.

### Consequences
* Good, because transcript фіксує очікувану користь: тест з мінімальним kustomize-проектом (Deployment + NetworkPolicy + kustomization.yaml) завершився exit 0 після застосування фіксу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/k8s/lint/lint.mjs` — функція перейменована `runKubescapeStdin` → `runKubescapeManifest`; тимчасовий dir створюється через `mkdtempSync(join(tmpdir(), 'nitra-cursor-k8s-'))`, файл `manifest.yaml` записується синхронно, cleanup — у `finally`
- `npm/rules/k8s/k8s.mdc` — версія `1.38` → `1.39`; текст про stdin (` kubectl kustomize <dir> | kubescape scan -`) виправлено на шлях до тимчасового файлу
- `npm/package.json` — `1.13.50` → `1.13.51`; `npm/CHANGELOG.md` — новий запис `[1.13.51] Fixed`
- kubescape: `4.0.8`, Homebrew, build `2026-05-08`; `node_modules/@nitra/cursor` у cursor-репо є symlink → `../../npm`, тому фікс активний одразу без перевстановлення
