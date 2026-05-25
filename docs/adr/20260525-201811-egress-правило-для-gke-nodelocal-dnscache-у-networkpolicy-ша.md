---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T20:18:11+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

## ADR Egress-правило для GKE NodeLocal DNSCache у NetworkPolicy шаблоні

## Context and Problem Statement
У кластерах GKE з увімкненим NodeLocal DNSCache kubelet підставляє у `/etc/resolv.conf` не ClusterIP kube-dns, а локальний DNS-агент вузла за link-local адресою діапазону `169.254.0.0/16`. Без явного egress-дозволу на цей діапазон у `NetworkPolicy` з `policyTypes: [Egress]` DNS-запити поду блокуються до того, як трафік досягає CoreDNS/kube-dns, що спричиняє повний збій резолвінгу імен.

## Considered Options
* Додати egress-правило `ipBlock: cidr: 169.254.0.0/16` з портами 53/UDP та 53/TCP
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати egress-правило `ipBlock: cidr: 169.254.0.0/16` з портами 53/UDP та 53/TCP", because це єдиний коректний шлях на GKE з NodeLocal DNSCache — правило `namespaceSelector: kube-system` не покриває link-local маршрут, а `169.254.0.0/16` є RFC 3927 link-local адресою, що не маршрутизується в інтернет і нешкідлива у не-GKE кластерах.

### Consequences
* Good, because transcript фіксує очікувану користь: DNS-резолвінг у подах з egress NetworkPolicy працює коректно на GKE з NodeLocal DNSCache.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл шаблону: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`
- Файл JS-генератора: `npm/rules/k8s/js/manifests.mjs`, функція `buildNetworkPolicyYaml` (~рядок 4262), масив `egressParts`
- Коміт: `524243d`
- RFC 3927: link-local діапазон `169.254.0.0/16` — адреси «на цій же машині/лінку», не маршрутизуються

---

## ADR networkpolicy.snippet.yaml як єдине джерело правди для egress canon

## Context and Problem Statement
Canonical egress-правила NetworkPolicy були визначені в трьох місцях одночасно: YAML-шаблон `networkpolicy.snippet.yaml`, JS-генератор `buildNetworkPolicyYaml` у `manifests.mjs`, і OPA Rego-файл `network_policy.rego`. Синхронізація між ними була ручною — додавання нового правила (`169.254.0.0/16`) до snippet не спричиняло автоматичного оновлення JS чи rego.

## Considered Options
* (A) Snippet читається з диска під час тесту/перевірки — runtime I/O залежність від шляху
* (B) Snippet «запікається» в `manifests.mjs` через codegen-скрипт при кожній зміні
* (C) Snippet — test-oracle: тест читає snippet і перевіряє що JS-генератор містить кожен egress-запис (subset check)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "C — Snippet як test-oracle з subset check", because тест є автоматичним gate у CI (розсихання неможливе без fail), генератор лишається в JS з параметрами (workloadName, appLabel), які snippet не має, і відсутній runtime I/O при генерації.

### Consequences
* Good, because transcript фіксує очікувану користь: майбутні зміни canon — тільки в snippet; bun test одразу виявляє неузгодженість між snippet і JS-генератором.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Тест: `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs`, describe-блок `networkpolicy.snippet.yaml sync with buildNetworkPolicyYaml`
- Семантика перевірки: для кожного entry у `spec.egress` snippet — `deepContains(jsEntry, snippetEntry)` має повернути `true` для хоча б одного entry в JS-виході
- Spec: `docs/superpowers/specs/2026-05-25-networkpolicy-snippet-single-source-of-truth-design.md`
- Коміт: `524243d`

---

## ADR Видалення OPA Rego-перевірки NetworkPolicy

## Context and Problem Statement
Файли `network_policy.rego` і `network_policy_test.rego` реалізовували per-document структурну перевірку NetworkPolicy через conftest/OPA. Rego-логіка дублювала JS-валідатор (`validateNetworkPolicyForWorkload`), але без підтримки cross-file контексту (workloadName, appLabel), автофіксу (`n-fix`) та без підключення як Admission Webhook у кластері.

## Considered Options
* (A) Видалити rego повністю — один шлях валідації через JS
* (B) Лишити rego, синхронізувати з snippet через codegen або мостик
* (C) Лишити rego як незалежну «другу думку», без синхронізації
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "(A) Видалити rego повністю", because це cursor-репо без кластерного Admission Webhook; rego не виконується ні в CI conftest, ні у кластері; JS-валідатор покриває більше кейсів (cross-file, autofik); третя копія логіки — зайве місце для розсихання.

### Consequences
* Good, because transcript фіксує очікувану користь: зменшення кількості місць де живе canonical egress-логіка з трьох до двох (snippet + JS).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Видалені файли: `npm/rules/k8s/policy/network_policy/network_policy.rego`, `npm/rules/k8s/policy/network_policy/network_policy_test.rego`
- Коміт: `524243d` (166 рядків видалено)
- Grep перед видаленням підтвердив відсутність посилань на rego у `*.json`, `*.mjs`, `*.yaml`
