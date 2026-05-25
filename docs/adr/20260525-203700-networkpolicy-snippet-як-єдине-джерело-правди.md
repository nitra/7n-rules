---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T20:37:00+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

## ADR NetworkPolicy snippet як єдине джерело правди

## Context and Problem Statement
У проєкті існували щонайменше три незалежні визначення канонічного egress-блоку `NetworkPolicy`: жорстко закодований YAML-рядок `NETWORK_POLICY_EGRESS_YAML` у `npm/rules/k8s/js/manifests.mjs`, шаблон `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`, і коментар-канон у `npm/rules/k8s/policy/network_policy/network_policy.rego`. Після додавання GKE-специфічного egress-правила для NodeLocal DNSCache (`ipBlock: 169.254.0.0/16`, порти 53/UDP+TCP) виявилося, що зміна в snippet не впливає на генератор і валідатор — вони залишаються застарілими, і наступна зміна потребує оновлення трьох місць вручну.

## Considered Options
* Зберігати канон у `networkpolicy.snippet.yaml` і читати його під час генерації та перевірки (module-level `readFileSync` + YAML-парсинг у JS; `conftest --data snippet.yaml` для rego)
* Залишити три незалежні визначення без централізації
* Codegen `_canon.json` → rego data (pre-step генерує JSON зі snippet для OPA)
* Snapshot-тест без зміни rego (тест порівнює генератор зі snippet, але дублювання залишається)

## Decision Outcome
Chosen option: "Зберігати канон у `networkpolicy.snippet.yaml` і читати його під час генерації та перевірки", because користувач явно поставив завдання «зробити snippet єдиним джерелом правди, щоб майбутні зміни можна було робити саме в ньому»; rego отримує snippet через `conftest --data`, JS — через module-level lazy cache `getSnippetSpec()`.

### Consequences
* Good, because зміна канону NetworkPolicy потребує редагування лише `networkpolicy.snippet.yaml`; генератор `buildNetworkPolicyYaml`, OPA-перевірка `network_policy.rego` і тести автоматично відображають оновлений канон.
* Bad, because кожен виклик `conftest` у CI та `Makefile` має отримувати `--data path/to/networkpolicy.snippet.yaml`; якщо хтось запустить `conftest` без цього аргументу — rego-перевірки мовчки пропустять помилки або падуть із `data.spec == null`. Потрібен guard у rego і оновлення всіх місць запуску conftest.

## More Information
Файли до змін згідно з планом `docs/superpowers/plans/2026-05-25-networkpolicy-snippet-single-source-of-truth-plan.md` (коміт `1c902d7`):
- `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` — єдиний Canon; уже оновлено: link-local блок `ipBlock: 169.254.0.0/16`, 53/UDP+TCP
- `npm/rules/k8s/js/manifests.mjs` — видалити `NETWORK_POLICY_EGRESS_YAML`; додати `getSnippetSpec()` (module-level lazy cache через `readFileSync` + `parseDocument(...).toJS()`); оновити `buildNetworkPolicyYaml`
- `npm/rules/k8s/js/tests/manifests/helpers/run-conftest.mjs` — додати `--data .../networkpolicy.snippet.yaml` у виклик `conftest`
- `npm/rules/k8s/policy/network_policy/network_policy.rego` — замінити ручну enumerate (helpers `has_in_cluster_dns`, `has_http_https_rule` тощо) на structural compare `input.spec.egress == data.spec.egress`; додати guard на відсутній `data.spec`
- `npm/rules/k8s/policy/network_policy/network_policy_test.rego` — оновити `valid_np` до snippet-структури; додати тест на відсутній link-local
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` (~рядок 2207) — переписати тест egress на deep-equal зі snippet; додати тест парсингу snippet
- `npm/rules/k8s/k8s.mdc` (~рядок 510) — замінити захардкований канон посиланням на snippet
