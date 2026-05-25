---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T20:32:53+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

## ADR Egress-правило для DNS через GKE NodeLocal DNSCache у NetworkPolicy

## Context and Problem Statement
У GKE з увімкненим NodeLocal DNSCache kubelet прописує у `/etc/resolv.conf` подів не ClusterIP kube-dns, а link-local адресу локального DNS-агента ноди (`169.254.x.x`). NetworkPolicy з `policyTypes: [Egress]`, яка дозволяє DNS лише через `namespaceSelector: kube-system`, блокує весь DNS у поді — трафік не доходить до kube-system, бо іде на `169.254.0.0/16:53`.

## Considered Options
* Дозволити egress тільки через `namespaceSelector: kube-system` (стандартний підхід без NodeLocal DNSCache)
* Додати `ipBlock: 169.254.0.0/16` для портів 53/UDP і 53/TCP (GKE NodeLocal DNSCache шлях)
* Обидва блоки разом

## Decision Outcome
Chosen option: "Обидва блоки разом", because на GKE DNS-трафік іде через link-local агента, а не через ClusterIP kube-dns. Блок `kube-system` лишається для сумісності з не-GKE кластерами.

### Consequences
* Good, because DNS-резолвінг у GKE-подах коректний — link-local блок пропускає запити до вузлового DNS-агента.
* Good, because правило `169.254.0.0/16` нешкідливе поза GKE: на ці адреси там ніхто не слухає.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` — додано egress-блок з `ipBlock.cidr: 169.254.0.0/16`, порти 53/UDP і 53/TCP. Діапазон 169.254.0.0/16 — RFC 3927, link-local, не маршрутизується за межі вузла.

---

## ADR `networkpolicy.snippet.yaml` як єдине джерело правди NetworkPolicy

## Context and Problem Statement
Канон структури NetworkPolicy (egress-правила) дублювався в трьох місцях: `NETWORK_POLICY_EGRESS_YAML` (рядкова константа у `manifests.mjs`), `canonical_egress` (масив у `network_policy.rego`) і `networkpolicy.snippet.yaml` (еталон «для очей», ніким програмно не читався). Будь-яка зміна канону вимагала ручного синхронізування всіх трьох місць.

## Considered Options
* Видалити rego, залишити лише JS + snippet
* Видалити JS-генерацію, зробити rego єдиним валідатором
* Залишити JS (cross-file прив'язка + auto-fix) і rego, але обидва читають зі snippet (варіант C)

## Decision Outcome
Chosen option: "варіант C — snippet як єдине джерело, JS і rego читають із нього", because JS-рівень надає незамінну cross-file прив'язку (workload → NP exists) і автофікс, якого rego не вміє, а rego дає структурну перевірку egress у conftest.

### Consequences
* Good, because зміна канону = редагування одного файлу (`networkpolicy.snippet.yaml`); JS (`buildNetworkPolicyYaml`) і rego (`canonical_egress`) оновлюються автоматично.
* Good, because `NETWORK_POLICY_EGRESS_YAML` видаляється — усувається пряме дублювання в коді.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Spec: `docs/superpowers/specs/2026-05-25-networkpolicy-snippet-single-source-of-truth-design.md`. План: `docs/superpowers/plans/2026-05-25-networkpolicy-snippet-single-source-of-truth.md`. JS-зміна: `readSnippetSpec()` (module-level cache, `readFileSync`, відносний шлях від `js/`), виклик у `buildNetworkPolicyYaml`. Rego-зміна: `canonical_egress := data.networkpolicy.spec.egress` через `conftest --data networkpolicy.snippet.yaml`.

---

## ADR Обгортка `networkpolicy:` у snippet для ізоляції `--data` namespace

## Context and Problem Statement
При передачі `networkpolicy.snippet.yaml` у conftest через `--data` його вміст потрапляє у кореневий `data`. Якщо файл починається безпосередньо з `spec:`, в rego утворюється `data.spec.egress` — який може конфліктувати з іншими `--data`-файлами, що також мають ключ `spec` на верхньому рівні.

## Considered Options
* Зберігати snippet без обгортки (`spec: ...` на верхньому рівні) — `data.spec.egress`
* Обгорнути весь вміст у ключ `networkpolicy:` — `data.networkpolicy.spec.egress`
* Генерувати окремий `network_policy_canon.yaml` як проміжний артефакт для `--data`

## Decision Outcome
Chosen option: "обгорнути у ключ `networkpolicy:`", because це ізолює namespace (`data.networkpolicy.spec.egress`) без додаткових артефактів і без template-engine; snippet залишається чистим YAML.

### Consequences
* Good, because `data.networkpolicy` не конфліктує з майбутніми `--data`-файлами, що мають власний `spec:`-ключ.
* Good, because JS читає `parseDocument(raw).toJSON().networkpolicy.spec` — один додатковий рівень, логіка не ускладнюється.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`. Rego-звернення: `data.networkpolicy.spec.egress`. JS-звернення: `readSnippetSpec()` повертає `doc.networkpolicy.spec`. Інші варіанти в transcript не обговорювалися.
