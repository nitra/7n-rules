---
session: af439e20-6686-4ea2-9699-db61751cdfda
captured: 2026-05-17T18:11:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/af439e20-6686-4ea2-9699-db61751cdfda.jsonl
---

## ADR Відмова від обмежень на metadata.name і metadata.namespace для HTTPRoute

## Context and Problem Statement
У репозиторії були цитати правила `k8s.mdc` про шаблон `<середовище>-<застосунок>` (приклад: `dev-sms`) для `metadata.name` та `metadata.namespace` в `HTTPRoute`-маніфестах. Виникло питання, як розширити це правило на випадок, коли `namespace` збігається з назвою середовища. Паралельно існував ADR `20260517-175412` (сесія `af439e20`, не закомічений у `main`) із протилежним порядком токенів `<застосунок>-<env>` (`sms-dev`).

## Considered Options
* Канон `<середовище>-<застосунок>` (`dev-sms`) для `metadata.name`
* Канон `<застосунок>-<env>` (`sms-dev`) для `metadata.name` (варіант із паралельного ADR)
* Не вводити обмежень на `metadata.name` взагалі — вибрано
* Не вводити обмежень на `metadata.namespace` взагалі — вибрано

## Decision Outcome
Chosen option: "Не вводити обмежень ні на `metadata.name`, ні на `metadata.namespace`", because дослідження показало: (1) жодного такого правила в `k8s.mdc` / rego-полісях фактично не існувало; (2) реальні маніфести демонструють щонайменше чотири різних патерни (`gt-site`/ns:`gt-dev`, `auth-run`/ns:`gt-dev`, `adminer-run`/ns:`adminer`, `open-webui`/ns:`open-webui`), тому будь-яке суворе правило одразу дало б fail на більшості існуючих файлів; (3) після brainstorming-питань автор переглянув намір і відмовився від уведення обмежень.

### Consequences
* Good, because transcript фіксує очікувану користь: усуває ризик хибних lint-помилок на репозиторіях, де простір імен = лише назва застосунку або лише середовище.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Перевірені файли маніфестів: `k8s/open-webui/hr.yaml`, `k8s/infisical/hr.yaml`, `k8s/litellm/helm/hr.yaml`, `k8s/run/adminer/k8s/base/hr.yaml`, `ai/gt/k8s/base/hr.yaml`, `ai/run/auth/k8s/base/hr.yaml`, `ai/run/nitra-bot/k8s/base/hr.yaml`.
- Перевірені rule-файли: `npm/rules/k8s/k8s.mdc`, `npm/rules/k8s/policy/manifest/manifest.rego`, `npm/rules/k8s/policy/base_manifest/base_manifest.rego`.
- ADR сесії `af439e20` (`docs/adr/20260517-175412-розширення-таблиці-httproute-name-namespace-проєктний-ns-наз.md`) — незакомічений, описував протилежний порядок токенів; рішення цієї сесії робить той ADR застарілим.
