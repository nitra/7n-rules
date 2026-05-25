---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T20:40:09+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

## ADR Egress-правило для DNS через GKE NodeLocal DNSCache у NetworkPolicy

## Context and Problem Statement
У кластерах GKE з увімкненим NodeLocal DNSCache kubelet налаштовує `/etc/resolv.conf` подів не на ClusterIP kube-dns, а на локальний DNS-агент вузла за link-local адресою (діапазон `169.254.0.0/16`, RFC 3927). Коли на под вішається `NetworkPolicy` з `policyTypes: [Egress]`, DNS-запити на `169.254.x.x:53` блокуються раніше, ніж трафік досягає `kube-system`, і весь DNS у поді лягає.

## Considered Options
* Дозволити egress на `169.254.0.0/16` портами 53/UDP і 53/TCP через `ipBlock`
* Дозволити egress лише на kube-dns ClusterIP (через `namespaceSelector: kube-system`) без link-local блоку
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Дозволити egress на `169.254.0.0/16` портами 53/UDP і 53/TCP через `ipBlock`", because на GKE з NodeLocal DNSCache трафік до kube-dns клієнт вузла не йде безпосередньо з поду через ClusterIP; запит спочатку потрапляє на link-local агента (типово `169.254.20.10`), і правило `namespaceSelector: kube-system` цей шлях не покриває.

### Consequences
* Good, because transcript фіксує очікувану користь: DNS-резолвінг залишається працездатним у подів із політикою Egress на GKE без відключення NodeLocal DNSCache.
* Bad, because transcript не містить підтверджених негативних наслідків; на кластерах без NodeLocal DNSCache правило просто не спрацьовує (на `169.254.x.x` там нічого не слухає).

## More Information
Зміна внесена у `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` (egress-блок):
```yaml
- to:
- ipBlock:
cidr: 169.254.0.0/16
ports:
- protocol: UDP
port: 53
- protocol: TCP
port: 53
```
Офіційна документація GKE NodeLocal DNSCache: https://cloud.google.com/kubernetes-engine/docs/how-to/nodelocal-dns-cache

---

## ADR networkpolicy.snippet.yaml як єдине джерело правди

## Context and Problem Statement
Кодова база підтримувала три незалежні копії канону NetworkPolicy: рядковий шаблон `NETWORK_POLICY_EGRESS_YAML` у `manifests.mjs`, структурні deny-правила у `network_policy.rego` та `template/networkpolicy.snippet.yaml`, який не читався жодним runtime-механізмом. Після додавання link-local egress-правила в snippet виявилося, що ані JS-генератор, ані rego-перевірка цю зміну не підхопили — проблема системна.

## Considered Options
* snippet → JS, rego повністю видалити (одна runtime-копія у JS)
* snippet → rego (через conftest --data), JS повністю видалити (одна runtime-копія у rego)
* snippet → обидві сторони: rego читає spec через `conftest --data`, JS читає spec через `readFileSync`; JS зберігає cross-file логіку та I/O (Option C)

## Decision Outcome
Chosen option: "snippet → обидві сторони (Option C)", because JS виконує три функції, які rego не замінює: cross-file прив'язку workload→NP, автоматичне створення/міграцію файлів через `n-fix`, cross-file помилки типу «у Deployment X нема NetworkPolicy». Відмова від JS означала б втрату цієї автоматизації без еквівалентної заміни.

### Consequences
* Good, because transcript фіксує очікувану користь: зміна канону відбувається в одному файлі (`networkpolicy_snippet.yaml`); rego і JS-генератор підтягують зміни автоматично без ручної синхронізації.
* Good, because transcript фіксує очікувану користь: видаляються `NETWORK_POLICY_EGRESS_YAML`, `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` і `networkPolicyManifestViolations` — три дублюючих описи канону в JS.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — rego і JS читають один файл різними механізмами, що додає мінімальну операційну складність (шлях до snippet'а треба вказувати в обох місцях).

## More Information
Реалізація описана у spec `docs/superpowers/specs/2026-05-25-networkpolicy-snippet-single-source-of-truth-design.md` та плані `docs/superpowers/plans/2026-05-25-networkpolicy-snippet-single-source-of-truth.md` (17 кроків, 6 фаз). Ключові файли: `npm/rules/k8s/policy/network_policy/template/networkpolicy_snippet.yaml`, `npm/rules/k8s/policy/network_policy/network_policy.rego`, `npm/rules/k8s/js/manifests.mjs`.

---

## ADR Підключення snippet до rego через conftest --data

## Context and Problem Statement
Після рішення зробити snippet єдиним джерелом правди потрібно вирішити, як rego-правила «бачать» вміст YAML-файлу — OPA не імпортує YAML як код напряму.

## Considered Options
* `conftest --data snippet.yaml` — snippet передається як data при кожному виклику conftest; в rego доступно через `data.networkpolicy_snippet.spec`
* Codegen у `_canon.json` — pre-step бун-скрипту парсить snippet і пише JSON-артефакт, який rego імпортує
* Snapshot-тест — rego тримає `valid_np` як зашитий об'єкт; окремий bun-тест порівнює його зі snippet'ом

## Decision Outcome
Chosen option: "`conftest --data snippet.yaml`", because найменше рухомих частин: немає проміжних артефактів, немає кроку перегенерації, немає ризику розходження між артефактом і snippet'ом. Зміна snippet → автоматично перевіряється на наступному запуску conftest.

### Consequences
* Good, because transcript фіксує очікувану користь: `conftest test --data networkpolicy_snippet.yaml` та `conftest verify --data networkpolicy_snippet.yaml` — єдині команди без додаткових build-кроків.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — крапка в оригінальній назві файлу `networkpolicy.snippet.yaml` спричиняла незручну нотацію `data["networkpolicy.snippet"]` у rego; вирішено перейменуванням на `networkpolicy_snippet.yaml`.

## More Information
Скрипти у `npm/rules/k8s/package.json` оновлюються (крок 2 плану):
```json
"conftest": "conftest test --trace --data policy/network_policy/template/networkpolicy_snippet.yaml -p policy --namespace k8s",
"test-rego": "conftest verify --trace --data policy/network_policy/template/networkpolicy_snippet.yaml -p policy --namespace k8s"
```
Rego-ключ для звернення до snippet: `data.networkpolicy_snippet.spec` (після перейменування файлу).

---

## ADR Підстановка `matchLabels` у snippet (порожній `{}`, JS підставляє `app`)

## Context and Problem Statement
Snippet містить `spec.podSelector.matchLabels: {}` — порожній об'єкт. При генерації NetworkPolicy для конкретного workload'а JS має підставити `app: <appLabel>`. Питання: чи зберігати snippet з порожнім `{}`, чи використовувати плейсхолдер-токени, чи зробити повний документ з прикладом.

## Considered Options
* α: порожній `matchLabels: {}` у snippet; JS merge `{ app: appLabel }`; rego перевіряє лише наявність і непорожність ключа `app`
* β: плейсхолдер `app: __APP__` у snippet; JS рядкова підстановка; rego ігнорує плейсхолдер-поля
* γ: повний документ з `name: NAME-PLACEHOLDER`, `app: APP-PLACEHOLDER`; JS і rego роблять substitution / mask

## Decision Outcome
Chosen option: "α: порожній `matchLabels: {}`", because мінімальне втручання у наявний формат snippet'а і найменший новий контракт — жодних плейсхолдер-токенів, які треба підтримувати синхронно в JS і rego.

### Consequences
* Good, because transcript фіксує очікувану користь: rego-правило для `matchLabels` формулюється як один додатковий deny («ключ `app` має бути присутнім і непорожнім»), а вся решта `spec.*` — byte-exact deep-equal зі snippet'ом.
* Bad, because Neutral, because transcript не містить підтверджених негативних наслідків.

## More Information
JS-підстановка у `buildNetworkPolicyYaml` (після рефакторингу):
```js
spec: {
...canon.spec,
podSelector: {
...canon.spec.podSelector,
matchLabels: { ...canon.spec.podSelector.matchLabels, app: appLabel },
},
}
```
Файл: `npm/rules/k8s/js/manifests.mjs`, функція `buildNetworkPolicyYaml`.
