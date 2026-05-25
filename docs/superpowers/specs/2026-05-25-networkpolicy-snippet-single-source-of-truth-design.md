# NetworkPolicy snippet як єдине джерело правди

**Дата:** 2026-05-25  
**Статус:** Затверджено

## Проблема

Канон egress-правил NetworkPolicy зараз дублюється у 5+ місцях:

| Файл | Роль |
|------|------|
| `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` | Шаблон «для очей» |
| `NETWORK_POLICY_EGRESS_YAML` у `manifests.mjs` | **Фактичний генератор** (рядковий шаблон) |
| `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` у `manifests.mjs` | Список динамічних портів |
| `network_policy.rego` / `network_policy_test.rego` | OPA-перевірка + `valid_np` фікстура |
| `npm/rules/k8s/k8s.mdc` | Документація |

Наслідок: зміна одного правила (наприклад, додавання link-local DNS `169.254.0.0/16`) потребує синхронізації вручну у всіх 5 файлах. Якщо щось пропустили — JS генерує старий канон, а snippet показує новий.

## Рішення

Зробити `networkpolicy.snippet.yaml` єдиним джерелом правди для `spec` NetworkPolicy.

## Архітектура

### §1 — Повний snippet

Файл `networkpolicy.snippet.yaml` розширюється до **повного `spec`** з усіма egress-правилами статично:

```yaml
spec:
  podSelector:
    matchLabels: {}         # placeholder → {app: appLabel} при генерації
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
  egress:
    # DNS через kube-dns (kube-system)
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # DNS через NodeLocal DNSCache (GKE, link-local RFC 3927)
    - to:
        - ipBlock:
            cidr: 169.254.0.0/16
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # Зовнішній HTTP/S
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443
    # In-cluster (статичний список портів)
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443
        - protocol: TCP
          port: 5432
        - protocol: TCP
          port: 3306
        - protocol: TCP
          port: 1433
        - protocol: TCP
          port: 6379
        - protocol: TCP
          port: 8080
        - protocol: TCP
          port: 4317
        - protocol: TCP
          port: 4318
```

`podSelector.matchLabels: {}` — єдиний placeholder. Решта — статичні значення.

### §2 — JS читає snippet при старті модуля

У `manifests.mjs` видаляємо `NETWORK_POLICY_EGRESS_YAML` і `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS`.  
Замість них — одноразове кешування розпарсеного snippet'а при завантаженні модуля:

```js
// module-level: один раз, синхронно
const _snippetSpec = parseDocument(
  readFileSync(
    new URL('../policy/network_policy/template/networkpolicy.snippet.yaml', import.meta.url),
    'utf8'
  )
).toJS().spec

export function buildNetworkPolicyYaml(deployName, appLabel) {
  const spec = structuredClone(_snippetSpec)
  spec.podSelector.matchLabels = { app: appLabel }
  return [
    `# yaml-language-server: $schema=${YANNH_BASE}networkpolicy-networking-v1.json`,
    stringify({
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name: deployName },
      spec,
    }),
  ].join('\n')
}
```

`structuredClone` гарантує відсутність мутацій між викликами.  
`readFileSync` — синхронно, бо всі call sites `buildNetworkPolicyYaml` синхронні (`.map()` без `await`).

### §3 — Bun-тест як регресія

Додаємо тест (у `check-schema.test.mjs` або окремому файлі), який:
1. Викликає `buildNetworkPolicyYaml("api", "api")`
2. Парсить YAML-результат
3. Асертує конкретні egress-правила:
   - link-local `169.254.0.0/16`, порти 53 UDP + 53 TCP
   - kube-dns через namespaceSelector `kubernetes.io/metadata.name: kube-system` + podSelector `k8s-app: kube-dns`
   - ipBlock `0.0.0.0/0` порти 80/443
   - namespaceSelector `{}` з in-cluster портами

Цей тест падає одразу, якщо snippet зламаний або пропустили поле.

### Rego — ручна синхронізація

`network_policy_test.rego` має `valid_np` фікстуру. Вона **не** генерується автоматично зі snippet.  
Угода: `valid_np` оновлюється в **тому ж коміті** що й snippet. Bun-тест слугує головним сигналом про розбіжність.

`network_policy.rego` залишається і валідує те, що snippet не перевіряє сам: `podSelector.matchLabels.app != {}`, відсутність catch-all egress без портів тощо.

## Що змінюється

| Елемент | До | Після |
|---------|-----|-------|
| `networkpolicy.snippet.yaml` | Неповний, лише 1 egress-правило | Повний `spec` зі всіма правилами |
| `NETWORK_POLICY_EGRESS_YAML` | Рядковий шаблон з dynamic JS | **Видаляється** |
| `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` | JS-масив | **Видаляється** (порти в YAML) |
| `buildNetworkPolicyYaml` | Будує рядком через шаблон | Читає snippet, клонує, підставляє |
| Bun-тест на egress | Перевіряє за хардкодом | Перевіряє результат `buildNetworkPolicyYaml` |
| `network_policy_test.rego` `valid_np` | Ручна синхронізація (незадокументована) | Ручна синхронізація (задокументована угода) |

## Що залишається поза скоупом

- Автогенерація rego `valid_np` зі snippet (занадто складно, мало value).
- Зміни в `k8s.mdc` документації — окреме завдання.
- Оновлення існуючих `networkpolicy.yaml` файлів у проєктах — зробить `n-fix`.

## Файли змін

```
npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml  ← розширити
npm/rules/k8s/js/manifests.mjs                                           ← _snippetSpec, buildNetworkPolicyYaml, видалити NETWORK_POLICY_EGRESS_YAML
npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs            ← нові асерти
npm/rules/k8s/policy/network_policy/network_policy_test.rego            ← оновити valid_np
npm/CHANGELOG.md                                                          ← bump
```
