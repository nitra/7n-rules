# NetworkPolicy: HTTPRoute-aware GCLB ingress rule

**Date:** 2026-05-26
**Scope:** `npm/rules/k8s/`
**Concern:** policy → fix (генерація NetworkPolicy при `check k8s`)
**Status:** approved (brainstorming) — pending implementation plan

## Контекст і мотивація

Поточний канон NetworkPolicy у `npm/rules/k8s/policy/network_policy/template/{deployment,statefulset}.snippet.yaml` дозволяє ingress лише з `podSelector: {}` (intra-namespace pod ↔ pod). Це блокує:

- **GKE Gateway data-plane (Envoy):** трафік приходить з proxy-only subnet регіону (приклад `us-central1-proxy-only` = `10.10.0.0/23`). Без явного правила NP пакет dropиться.
- **Google health checks:** діапазони `35.191.0.0/16` і `130.211.0.0/22` (HTTPS load balancer і Gateway).

Симптом: workload, прив'язаний до `HTTPRoute`, отримує `503` / `connection refused` після застосування канонічного NP — pods доступні з кластера, але не з Gateway/HC.

**Рішення:** для workload-ів, на які вказує хоча б один `HTTPRoute` (через `backendRef` → `-hl` Service → `app` label), `check k8s` автоматично додає в `networkpolicy.yaml` ingress-правило з фіксованим набором CIDR-ів і TCP-портами з `backendRefs[].port`.

## Архітектурні рішення (з brainstorming)

| Питання                      | Рішення                                                        | Альтернативи                       |
| ---------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| Enforcement                  | JS auto-fix (без rego deny)                                    | rego deny, гібрид                  |
| Структура порту              | Одне ingress-правило з масивом `ports[]` (унікальні TCP-порти) | Кілька правил, хардкод 8080        |
| CIDR-набір                   | Хардкод `35.191.0.0/16`, `130.211.0.0/22`, `10.0.0.0/8`        | Конфіг через анотацію, config-file |
| HTTPRoute → workload mapping | Strict via Service `spec.selector.matchLabels.app`             | Strip `-hl` (convention-based)     |

## Архітектура

### Нова функція

```
collectHttpRouteIngressForWorkload(dir, appLabel, fail) → { ports: number[] } | null
```

- **Вхід:** абсолютний шлях каталогу `dir`, `appLabel` workload, `fail(msg)` callback.
- **Поведінка:** індексує всі YAML у каталозі (multi-doc), збирає HTTPRoute backendRefs і Service селектори, фільтрує по `appLabel`.
- **Вихід:** `{ ports: [...] }` з відсортованим за зростанням масивом унікальних TCP-портів, або `null`, якщо жоден backendRef не вказує на цей workload.

### Розширення існуючої функції

```
buildNetworkPolicyYaml(deployName, appLabel, kind, gclbPorts?)
```

- Новий **опційний** параметр `gclbPorts: number[]` — якщо непорожній, додає одне ingress-правило перед серіалізацією YAML.
- Default `undefined` → байтово ідентичний існуючому output (no regression для caller-ів, які не знають про HTTPRoute).

### Інтеграція

Виклики `buildNetworkPolicyYaml` у `ensureNetworkPolicyForWorkloadsInDir` і `regenerateLegacyNetworkPolicyDocsInFile`:

1. Перед побудовою YAML викликають `collectHttpRouteIngressForWorkload(dir, appLabel, fail)`.
2. Якщо результат `≠ null` — передають `result.ports` як `gclbPorts`.
3. Якщо `null` — викликають без `gclbPorts` (baseline canon).

## Структура ingress-правила

Доданий блок (окремий ingress-rule, **після** canon `from.podSelector: {}`):

```yaml
ingress:
  - from:
      - podSelector: {} # canon (intra-namespace)
  - from:
      - ipBlock: { cidr: 35.191.0.0/16 }
      - ipBlock: { cidr: 130.211.0.0/22 }
      - ipBlock: { cidr: 10.0.0.0/8 }
    ports:
      - { protocol: TCP, port: <port1> }
      - { protocol: TCP, port: <port2> }
```

- CIDR-и в `from` — фіксований порядок (як у конвенції).
- `ports[]` — TCP, відсортовані за зростанням (детерміністичний diff).
- Для **StatefulSet** правило додається аналогічно поверх `statefulset.snippet.yaml`; intra-replica `from.podSelector: {matchLabels: {}}` залишається.

## Resolution algorithm

Для одного `dir` і одного `appLabel`:

1. **Index каталогу** (один прохід, кеш у межах виклику):
   - Усі YAML-файли в `dir` → `parseAllDocuments` (multi-doc).
   - Зібрати:
     - `httpRoutes: Array<{ backendRefs: Array<{name, port}> }>` для кожного документа з `kind: HTTPRoute` і `apiVersion: gateway.networking.k8s.io/*`.
     - `servicesByName: Map<string, string>` — `metadata.name` → `spec.selector.matchLabels.app` для кожного `kind: Service`.

2. **Фільтр по `appLabel`:**
   - Обхід `httpRoutes` → для кожного `(backendRef.name, port)` → `servicesByName.get(name)` === `appLabel`.
   - Якщо так — `ports.add(port)`.

3. **Повертаємо** `Array.from(ports).sort((a,b) => a-b)` або `null` якщо порожньо.

### Error handling

| Випадок                                                           | Поведінка                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YAML read/parse error для HTTPRoute / Service у каталозі workload | `fail(...)` з повідомленням: `${rel}: не вдалося індексувати HTTPRoute/Service для GCLB ingress (HTTPRoute → NetworkPolicy mapping; k8s.mdc): <reason>` |
| Service без `spec.selector.matchLabels.app`                       | Тихий пропуск (не наш case)                                                                                                                             |
| `backendRef.port` не number                                       | Тихий пропуск (не Service backendRef)                                                                                                                   |
| `backendRef.name` не знайдено в `servicesByName`                  | Тихий пропуск (cross-ns ReferenceGrant — поза скоупом)                                                                                                  |
| HTTPRoute без backendRefs                                         | No-op                                                                                                                                                   |
| Duplicate ports у різних HTTPRoute / правилах                     | Дедуп через `Set`                                                                                                                                       |

Контраст з `indexOneK8sYamlForHasuraCanon` (silent ignore): там пропуск безпечний, бо канон Hasura — best-effort superset; тут пропуск дав би **неповний** NetworkPolicy без попередження, тому explicit `fail`.

## Тести

Розташування: `npm/rules/k8s/js/tests/` (Bun test, як інші).

### Unit — `collectHttpRouteIngressForWorkload`

1. Каталог без HTTPRoute → `null`.
2. Один HTTPRoute з backendRef `foo-hl:8080`, Service `foo-hl` з `selector.app: foo`, `appLabel: foo` → `{ ports: [8080] }`.
3. HTTPRoute з двома різними портами (`8080`, `9090`) для одного `app` label → `{ ports: [8080, 9090] }`.
4. HTTPRoute з 4 правилами Hasura-канона і тим самим backendRef `:8080` → дедуп до `[8080]`.
5. HTTPRoute з backendRef, що не матчить `appLabel` → `null`.
6. backendRef з явним `kind: Service` → працює; `kind: SomeCRD` → ігнор.
7. Service без `selector.matchLabels.app` → тихо ігнор (правило не додається).
8. Зламаний `hr.yaml` → `fail` callback викликається з конкретним повідомленням; функція повертає `null` (graceful degradation).

### Integration — `buildNetworkPolicyYaml`

9. `gclbPorts: undefined` → output байтово ідентичний до поточного canon (no-regression baseline).
10. `gclbPorts: [8080]` (Deployment) → spec має додаткове ingress-правило між canon `podSelector` і egress; `ports = [{TCP, 8080}]`.
11. `gclbPorts: [8080, 9090]` → одне правило з обома ports (сортовано).
12. `gclbPorts: [8080]` для **StatefulSet** → правило додається; intra-replica `from.podSelector: {matchLabels: {}}` лишається; egress без змін.

### E2E fixture

Каталоги в `npm/rules/k8s/js/tests/fixtures/` (як у решти k8s-перевірок):

13. `base/` з `deploy.yaml` + `svc.yaml` + `svc-hl.yaml` + `hr.yaml` + порожній/легасі `networkpolicy.yaml` → після `regenerateLegacyNetworkPolicyDocsInFile` NP містить GCLB-правило з портом з HTTPRoute.
14. Те саме без `hr.yaml` → NP без GCLB-правила (baseline canon).

## Документація (`npm/rules/k8s/k8s.mdc`)

1. **Новий блок** під розділом «Deployment: `topologySpreadConstraints`, HPA / PDB через `components/`, NetworkPolicy у `base/`»:

   > **HTTPRoute → NetworkPolicy ingress:** якщо в каталозі workload є `HTTPRoute` (Gateway API) з `backendRef` на `<workload>-hl` Service, `check k8s` автоматично додає в NetworkPolicy цього workload ingress-правило з GCLB / Envoy data-plane CIDR-ами на TCP-порти з `backendRefs[].port` (дедуп). Без цього правила трафік від GKE Gateway (proxy-only subnet, наприклад `10.10.0.0/23` для `us-central1`) і health checks Google (`35.191.0.0/16`, `130.211.0.0/22`) блокується базовим NetworkPolicy.

2. **Приклад YAML** — секція `base/networkpolicy.yaml` (рядки 487-554 у поточній версії) збагачена додатковим ingress-правилом з коментарем `# GCLB + Envoy data-plane (auto-added by check k8s for HTTPRoute-paired workloads)`.

3. **JSDoc** — оновлений у `buildNetworkPolicyYaml` (новий параметр) і нова `collectHttpRouteIngressForWorkload` з коротким описом контракту. Без дублювання алгоритму у `.mdc` (відповідно до `mdc-check`).

## Out of scope

- **Rego deny-rule** для відсутності GCLB-правила в NP (вирішили JS-only).
- **Конфігурованість CIDR-ів** (хардкод; YAGNI, винесемо як з'явиться запит).
- **Cross-namespace backendRefs** через `ReferenceGrant` (тихий пропуск; поточна конвенція в репо — backend у тому ж namespace).
- **Non-HTTP routes** (`GRPCRoute`, `TCPRoute`, `TLSRoute`, `UDPRoute`) — поза скоупом цієї specі. Якщо потрібно — окремий passe.
- **UDP-порти** — Gateway API HTTPRoute завжди TCP.
- **NetworkPolicy ipBlock з `except:`** для звуження `10.0.0.0/8` — конкретні proxy-only підмережі (типу `10.10.0.0/23`) можна додати пізніше при потребі.

## Файли, які зміняться

- `npm/rules/k8s/js/manifests.mjs` — нова `collectHttpRouteIngressForWorkload`, розширення `buildNetworkPolicyYaml`, виклики у `ensureNetworkPolicyForWorkloadsInDir` і `regenerateLegacyNetworkPolicyDocsInFile`.
- `npm/rules/k8s/js/tests/` — нові unit + E2E fixture-тести.
- `npm/rules/k8s/k8s.mdc` — новий блок + оновлений приклад.
- `npm/CHANGELOG.md` + version bump у `npm/package.json` (обов'язково; підтвердити через `npx @nitra/cursor check changelog` — див. `n-changelog` rule).
