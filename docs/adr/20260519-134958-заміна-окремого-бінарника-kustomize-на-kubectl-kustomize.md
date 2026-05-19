---
session: 344f127f-0f8d-475c-9cef-7c259d7fc757
captured: 2026-05-19T13:49:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/344f127f-0f8d-475c-9cef-7c259d7fc757.jsonl
---

## ADR Заміна окремого бінарника `kustomize` на `kubectl kustomize`

## Context and Problem Statement
В `npm/rules/k8s/lint/lint.mjs` kubescape запускався через попередній збір маніфесту окремим бінарником `kustomize build <dir>`. Це вимагало встановлення `kustomize` як окремого PATH-інструменту і кроку CI. Kubectl починаючи з певної версії вбудовує kustomize (`kubectl kustomize <dir>`) — той самий код, але без зайньої залежності.

## Considered Options
* Продовжувати використовувати окремий бінарник `kustomize` (попередня поведінка)
* Замінити на `kubectl kustomize <dir>` (вбудований у kubectl)

## Decision Outcome
Chosen option: "замінити на `kubectl kustomize <dir>`", because kubectl вже є обов'язковою залежністю середовища й містить вбудований kustomize v5.8.1 (`kubectl version --client` підтверджує `Kustomize Version: v5.8.1`), тому окремий бінарник є зайвою залежністю.

### Consequences
* Good, because прибирається один системний бінарник із PATH-залежностей (`kubeconform`, `kubescape`, `kustomize` → `kubeconform`, `kubescape`, `kubectl`).
* Good, because з CI-пайплайну (`k8s.mdc`) прибирається крок `Install kustomize` з curl-скриптом kubernetes-sigs.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/k8s/lint/lint.mjs` (функція `runKustomizeBuild` і `runKubescape`), `npm/rules/k8s/k8s.mdc` (розділ залежностей і GA-сніпет)
- Підтвердження наявності: `which kubectl` → `/opt/homebrew/bin/kubectl`; `kubectl version --client` → `Client Version: v1.36.1`, `Kustomize Version: v5.8.1`
- Тести: `bun test npm/rules/k8s/lint/` — 8 pass, 0 fail після змін
