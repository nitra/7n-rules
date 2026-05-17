---
session: af439e20-6686-4ea2-9699-db61751cdfda
captured: 2026-05-17T18:17:30+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/af439e20-6686-4ea2-9699-db61751cdfda.jsonl
---

## ADR Відмова від обмежень на `metadata.name` і `metadata.namespace` для HTTPRoute

## Context and Problem Statement

В існуючому правилі `npm/rules/k8s/k8s.mdc` (і копіях `.cursor/rules/n-k8s.mdc`) раніше передбачалося правило `<середовище>-<застосунок>` для `metadata.name`/`metadata.namespace` HTTPRoute-ресурсів. Паралельна сесія `af439e20` (17:54 того ж дня) сформувала untracked ADR зі схемою `<застосунок>-<env>` та rego-полісі `npm/rules/k8s/policy/httproute/httproute.rego` — однак ці зміни так і не потрапили до `main`. Реальні маніфести демонструють чотири різних патерни (`gt-site`/`gt-dev`, `auth-run`/`gt-dev`, `adminer-run`/`adminer`, `open-webui`/`open-webui`, `litellm`/`litellm`), тобто жодного однорідного канону на практиці не склалося.

## Considered Options

* Ввести правило `<застосунок>-<env>` для `metadata.name` HTTPRoute (варіант із паралельного ADR `af439e20`)
* Ввести правило `<середовище>-<застосунок>` для `metadata.name` HTTPRoute (початковий намір сесії)
* Прибрати всі планові обмеження на `metadata.name` і `metadata.namespace` для HTTPRoute (обраний варіант)

## Decision Outcome

Chosen option: "Прибрати всі планові обмеження на `metadata.name` і `metadata.namespace` для HTTPRoute", because існуючі маніфести не відповідають жодному з пропонованих шаблонів, а після аналізу реального стану репо користувач підтвердив, що обмеження на name і namespace не потрібні.

### Consequences

* Good, because transcript фіксує очікувану користь: унеможливлює хибні deny-спрацювання на вже задеплоєних маніфестах із різними патернами (`gt-site`, `adminer-run`, `open-webui` тощо).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Untracked ADR, що підлягає видаленню або анулюванню: `docs/adr/20260517-175412-розширення-таблиці-httproute-name-namespace-проєктний-ns-наз.md` (сесія `af439e20`).
- Реальні `hr.yaml` у репо: `k8s/run/adminer/k8s/base/hr.yaml` (`adminer-run`/`adminer`), `ai/gt/k8s/base/hr.yaml` (`gt-site`/`gt-dev`), `k8s/open-webui/hr.yaml` (`open-webui`/`open-webui`).
- Структурні namespace-перевірки, які НЕ є предметом цього рішення і залишаються: `npm/rules/k8s/policy/base_manifest/base_manifest.rego` (непорожній `metadata.namespace` для namespaced kind), `npm/rules/k8s/policy/base_kustomization/base_kustomization.rego` (непорожній `namespace:` у kustomization).
- Перевірка `metadata.name` між пов'язаними ресурсами (Hasura HTTPRoute ↔ Deployment, ConfigMap ↔ Deployment, HPA ↔ Deployment, `-hl` Service) також **не скасовується** — вона структурна, а не конвенційна.
