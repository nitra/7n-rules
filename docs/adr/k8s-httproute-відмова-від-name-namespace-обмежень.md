# Відмова від обмежень на `metadata.name` і `metadata.namespace` для HTTPRoute

**Status:** Accepted
**Date:** 2026-05-17

## Context and Problem Statement

Планувалося ввести формальний шаблон для `metadata.name`/`metadata.namespace` HTTPRoute-ресурсів. Вивчення реальних маніфестів показало чотири різних патерни: `gt-site`/ns:`gt-dev`, `auth-run`/ns:`gt-dev`, `adminer-run`/ns:`adminer`, `open-webui`/ns:`open-webui`. Паралельна чернетка (сесія `af439e20`, 17:54) пропонувала порядок `<застосунок>-<env>`, проте ці зміни не потрапили до `main`.

## Considered Options

- Ввести правило `<застосунок>-<env>` для `metadata.name`
- Ввести правило `<середовище>-<застосунок>` для `metadata.name`
- Прибрати всі планові обмеження на `metadata.name` і `metadata.namespace`

## Decision Outcome

Chosen option: "Прибрати всі планові обмеження", because жодного такого правила у `k8s.mdc`/rego-полісях фактично не існувало; реальні маніфести демонструють різнорідні патерни, тому будь-яке суворе правило генерувало б false-positives.

### Consequences

- Good, because унеможливлює хибні deny-спрацювання на задеплоєних маніфестах із різними патернами.
- Neutral, because структурні перевірки залишаються: `base_manifest.rego` (непорожній `metadata.namespace`), `base_kustomization.rego` (непорожній `namespace:`), cross-resource name matching.
- Bad, because transcript не містить підтвердження негативних наслідків.

## More Information

Перевірені маніфести: `k8s/open-webui/hr.yaml`, `k8s/run/adminer/k8s/base/hr.yaml`, `ai/gt/k8s/base/hr.yaml`, `ai/run/auth/k8s/base/hr.yaml`, `k8s/litellm/helm/hr.yaml`.
Перевірені rule-файли: `npm/rules/k8s/k8s.mdc`, `npm/rules/k8s/policy/manifest/manifest.rego`, `npm/rules/k8s/policy/base_manifest/base_manifest.rego`.
Чернетка `docs/adr/20260517-175412-розширення-таблиці-httproute-name-namespace-проєктний-ns-наз.md` стає застарілою.
