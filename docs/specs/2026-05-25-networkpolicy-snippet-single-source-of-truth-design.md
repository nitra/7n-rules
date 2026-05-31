# NetworkPolicy snippet як єдине джерело правди

**Дата:** 2026-05-25  
**Статус:** Затверджено (v2 — superset check, multi-snippet, conftest --data)

## Проблема

Канон egress-правил NetworkPolicy зараз дублюється у 5+ місцях:

| Файл                                                                      | Роль                                      |
| ------------------------------------------------------------------------- | ----------------------------------------- |
| `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` | Шаблон «для очей»                         |
| `NETWORK_POLICY_EGRESS_YAML` у `manifests.mjs`                            | **Фактичний генератор** (рядковий шаблон) |
| `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` у `manifests.mjs`               | Список динамічних портів                  |
| `network_policy.rego` / `network_policy_test.rego`                        | OPA-перевірка + `valid_np` фікстура       |
| `npm/rules/k8s/k8s.mdc`                                                   | Документація                              |

Наслідок: зміна одного правила (наприклад, додавання link-local DNS `169.254.0.0/16`) потребує ручної синхронізації у всіх 5 файлах. Якщо щось пропустили — JS генерує старий канон, а snippet показує новий.

Додаткова проблема: усі workload-типи (Deployment, StatefulSet, Job, …) отримують ідентичний шаблон, хоча StatefulSet потребує додаткових intra-replica egress/ingress правил, а DaemonSet у host-network режимі — зовсім іншої форми.

## Рішення

Зробити snippet-файли єдиним джерелом правди для `spec` NetworkPolicy.

**Ключові рішення (прийняті під час брейнштормінгу):**

| Питання                   | Обраний варіант                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Хто тримає канон          | C: snippet → rego (через `conftest --data`) + JS читає snippet; JS — лише cross-file I/O        |
| Snippet → rego зв'язок    | 1: `conftest test --data snippet.yaml`; rego читає `data.snippet.spec`                          |
| Форма snippet'а           | α: `spec` без `metadata`/modeline; `matchLabels: {}` — порожньо                                 |
| Dispatch по workload-типу | α: анотація `nitra.dev/workload-kind: <kind>` → rego обирає потрібний snippet                   |
| Семантика перевірки       | **superset**: кожне canonical-правило має бути присутнє у списку; додаткові правила — дозволені |
| Порядок при superset      | β: порядок байдужий — rego шукає кожне canonical-правило через `some i; input[i] == canon_rule` |

## Архітектура (огляд)

```
┌──────────────────────────┐  ┌──────────────────────────┐
│ deployment.snippet.yaml  │  │ statefulset.snippet.yaml │
│ (ПОВНИЙ канон для        │  │ (ПОВНИЙ канон для        │
│  Deployment/Job/         │  │  StatefulSet:            │
│  CronJob/DaemonSet)      │  │  усе з deployment +      │
│                          │  │  intra-replica правила)  │
└────────────┬─────────────┘  └──────────────┬───────────┘
             │                              │
             ▼                              ▼
   ┌──────────────────┐         ┌──────────────────────────┐
   │ rego deny        │         │ JS thin layer            │
   │ (conftest --data │         │                          │
   │  обидва snippets)│         │ - loadSnippetSpec(name)  │
   │                  │         │ - kindToSnippetName(kind)│
   │ dispatch:        │         │ - buildNetworkPolicyYaml │
   │ annotation       │         │   (load ОДИН snippet     │
   │ nitra.dev/       │         │    за kind, додати       │
   │ workload-kind →  │         │    metadata + app)       │
   │ ОДИН snippet     │         │ - cross-file pairs       │
   │                  │         │ - regenerateLegacy       │
   │ superset check   │         │                          │
   │ ∀ rule ∈ canon:  │         │                          │
   │ ∃ i: np[i]==rule │         │                          │
   └──────────────────┘         └──────────────────────────┘
```

**Інваріанти:**

- Snippet парситься обома сторонами (JS + conftest) як plain YAML — жодних плейсхолдерів у файлі.
- Кожен snippet — **повний канон** для своєї групи workload-типів; жодного мерджу між snippet'ами в runtime.
- Rego — єдиний owner структурної перевірки `spec.egress`/`ingress`/`policyTypes`; за анотацією обирає ОДИН snippet.
- JS — owner лише workload-контексту (name, app, kind) і I/O (генерація, міграція); за `kind` обирає ОДИН snippet.
- Додаткові egress/ingress правила в NP — дозволені (superset, не exact-match).
- Дублювання канону між двома snippet'ами — **свідоме**: рознесення на «common + delta» зекономило б 70 рядків, але зробило б runtime-семантику менш прозорою (JS і rego мали б знати про merge); вибір на користь явності.

## §1 — Snippet-файли (нова структура)

### `template/deployment.snippet.yaml`

**Повний канон** для `Deployment`, `Job`, `CronJob`, `DaemonSet`.
`spec.podSelector.matchLabels: {}` — placeholder; JS підставить `{ app: <appLabel> }`.
Решта `spec.*` — статичний канон.

```yaml
spec:
  podSelector:
    matchLabels: {}
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

### `template/statefulset.snippet.yaml`

**Повний канон** для `StatefulSet` — містить усе, що є в `deployment.snippet.yaml`, **плюс** intra-replica правила. Тобто це окремий повний файл (не delta).

```yaml
spec:
  podSelector:
    matchLabels: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
    # intra-replica реплікація (StatefulSet pod ↔ pod у тому ж namespace)
    - from:
        - podSelector:
            matchLabels: {}
  egress:
    # ── ідентичні egress-правила як у deployment.snippet.yaml ──
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
    # In-cluster
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
    # ── додаткове для StatefulSet ──
    # intra-replica реплікація (StatefulSet pod ↔ pod у тому ж namespace)
    - to:
        - podSelector:
            matchLabels: {}
```

> **Важливо:** intra-replica `podSelector: matchLabels: {}` — **не** placeholder. Це справжній «будь-який pod у тому ж namespace» selector. JS-генератор (§4) НЕ підставляє сюди `app: <label>`. Цього вистачає для intra-replica StatefulSet у single-namespace, бо саме namespace ізолює replica-set від чужого трафіку. Якщо потрібна вужча ізоляція (тільки той самий StatefulSet, конкретний порт реплікації) — додавай як extra-rule поверх канону (superset дозволяє).

### Поточний `networkpolicy.snippet.yaml`

**Перейменовується** в `deployment.snippet.yaml` (link-local DNS-блок уже всередині — лишається на місці). `statefulset.snippet.yaml` створюється з нуля (копія `deployment.snippet.yaml` + intra-replica правила).

## §2 — Annotation-based dispatch

JS-генератор при створенні NP-документа додає анотацію:

```yaml
metadata:
  name: <deployName>
  annotations:
    nitra.dev/workload-kind: Deployment # або StatefulSet, Job, CronJob, DaemonSet
```

Rego читає `input.metadata.annotations["nitra.dev/workload-kind"]` → обирає **ОДИН** snippet для superset-перевірки:

| Значення анотації                           | Snippet для перевірки                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `Deployment`, `Job`, `CronJob`, `DaemonSet` | `deployment.snippet.yaml`                                                        |
| `StatefulSet`                               | `statefulset.snippet.yaml`                                                       |
| відсутня / невідома                         | `deployment.snippet.yaml` (conservative fallback) + `warn` про відсутню анотацію |

Conftest-виклик завантажує обидва файли:

```bash
conftest test \
  --data template/deployment.snippet.yaml \
  --data template/statefulset.snippet.yaml \
  -p npm/rules/k8s/policy/network_policy \
  --namespace k8s.network_policy \
  <glob k8s/**/networkpolicy.yaml>
```

> **Уточнення для реалізації:** conftest завантажує `--data` у `data.*` з ключем = basename без `.yaml`. Тобто `deployment.snippet.yaml` → `data.deployment_snippet`, `statefulset.snippet.yaml` → `data.statefulset_snippet`. Перевірити на `conftest test --trace` під час реалізації.

## §3 — Rego: superset check (β-семантика)

### Зміна правил deny

**Видаляються** granular deny-правила (kube-dns, catch-all-egress, missing-internet-ports тощо).  
**Замінюються** на:

```rego
# Маппінг анотації → snippet (fallback на deployment, якщо невідома/відсутня)
canon_for_kind(kind) := data.statefulset_snippet if kind == "StatefulSet"
canon_for_kind(kind) := data.deployment_snippet  # default

# Кожне правило з обраного канону egress має бути присутнє в input
deny contains msg if {
  is_np_doc
  is_object(input.spec)
  kind := object.get(input.metadata.annotations, "nitra.dev/workload-kind", "")
  canon := canon_for_kind(kind)
  some canon_rule in canon.spec.egress
  not list_contains(input.spec.egress, canon_rule)
  msg := sprintf(
    "spec.egress: бракує канонічного правила (%s.snippet.yaml): %s (k8s.mdc)",
    [snippet_name_for_kind(kind), json.marshal(canon_rule)]
  )
}

# Аналогічно для spec.ingress
deny contains msg if {
  is_np_doc
  is_object(input.spec)
  kind := object.get(input.metadata.annotations, "nitra.dev/workload-kind", "")
  canon := canon_for_kind(kind)
  some canon_rule in canon.spec.ingress
  not list_contains(input.spec.ingress, canon_rule)
  msg := sprintf(
    "spec.ingress: бракує канонічного правила (%s.snippet.yaml): %s (k8s.mdc)",
    [snippet_name_for_kind(kind), json.marshal(canon_rule)]
  )
}

# Helper: структурна рівність елемента (order-independent для зовнішнього списку)
list_contains(list, item) if {
  some i
  list[i] == item
}

snippet_name_for_kind(kind) := "statefulset" if kind == "StatefulSet"
snippet_name_for_kind(_) := "deployment"
```

### Deny що лишаються

- `kind != "NetworkPolicy"` — лишається.
- `apiVersion != "networking.k8s.io/v1"` — лишається.
- `not spec.podSelector.matchLabels.app` — лишається (значення довільне, але ключ є).
- `not input.metadata.annotations["nitra.dev/workload-kind"]` → `warn` (не `deny`), бо існуючі файли без анотації не мають ломати CI одразу.

### Що НЕ змінюється

- Cross-file перевірка `metadata.name = workloadName` / `matchLabels.app = workloadApp` — лишається в JS (`validateNetworkPolicyForWorkload`).

### Rego-тести

`valid_np` фікстура більше не зашита в `network_policy_test.rego` вручну.  
В тестах використовується `with data as { "common_snippet": ..., "statefulset_snippet": ... }`, де значення — програмно побудовані з правильної структури, або тести запускаються через `conftest verify --data …` (тоді `data` вже завантажено).

**Мінімальний набір тестів:**

- `valid_np` з annotation `Deployment` + усі правила з `deployment.snippet` → 0 deny.
- `valid_np` з annotation `Deployment` без link-local DNS правила → deny з посиланням на `deployment.snippet`.
- `valid_np` з annotation `StatefulSet` + усі правила з `statefulset.snippet` → 0 deny.
- `valid_np` з annotation `StatefulSet`, без intra-replica правил → deny з посиланням на `statefulset.snippet`.
- `valid_np` з annotation `StatefulSet`, але лише з deployment-канон (без intra-replica) → deny (бо superset проти `statefulset.snippet`, не `deployment.snippet`).
- `valid_np` з **додатковим** egress правилом (понад канон) → 0 deny (superset дозволяє extra).
- `missing_app_in_match_labels` → deny.
- `wrong_kind` (`kind != NetworkPolicy`) → deny.
- Анотація відсутня → `warn` (не `deny`) + перевірка йде проти `deployment.snippet` (fallback).

## §4 — JS thin layer

### Нові функції

```js
// Lazy-кешований завантажувач snippets по імені файлу (без '.snippet.yaml')
const _snippetCache = {}

function loadSnippetSpec(snippetName) {
  // 'deployment' | 'statefulset'
  if (_snippetCache[snippetName]) return _snippetCache[snippetName]
  const path = new URL(`../policy/network_policy/template/${snippetName}.snippet.yaml`, import.meta.url)
  _snippetCache[snippetName] = parseDocument(readFileSync(path, 'utf8')).toJS().spec
  return _snippetCache[snippetName]
}

// Mapping workload-kind → snippet name (єдиний у JS)
const KIND_TO_SNIPPET = {
  Deployment: 'deployment',
  Job: 'deployment',
  CronJob: 'deployment',
  DaemonSet: 'deployment',
  StatefulSet: 'statefulset'
}
function snippetNameForKind(kind) {
  const name = KIND_TO_SNIPPET[kind]
  if (!name) throw new Error(`Unknown workload kind for NetworkPolicy canon: ${kind}`)
  return name
}
```

### `buildNetworkPolicyYaml` (переписати)

```js
export function buildNetworkPolicyYaml(deployName, appLabel, kind) {
  const snippetName = snippetNameForKind(kind)
  const spec = structuredClone(loadSnippetSpec(snippetName))
  spec.podSelector.matchLabels = { app: appLabel }
  // intra-replica matchLabels:{} (якщо є — у statefulset.snippet) лишається як є
  // (не placeholder, див. §1.3)

  const schemaUrl = `${YANNH_BASE}networkpolicy-networking-v1.json`
  return [
    `# yaml-language-server: $schema=${schemaUrl}`,
    stringify({
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: {
        name: deployName,
        annotations: { 'nitra.dev/workload-kind': kind }
      },
      spec
    })
  ].join('\n')
}
```

**Жодного merge між snippets** — це навмисно. Кожен snippet — самодостатній повний канон.

### Що видаляється з JS

| Символ                                    | Рядки (~) | Причина                                          |
| ----------------------------------------- | --------- | ------------------------------------------------ |
| `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` | 4250      | порти у snippet                                  |
| `NETWORK_POLICY_EGRESS_YAML`              | 4256-4281 | замінено `loadSnippetSpec`                       |
| `networkPolicyManifestViolations`         | 4316-4362 | структуру тримає rego; **breaking** → major bump |

### Що залишається (без змін)

- `NETWORK_POLICY_FILENAME` (3914)
- `validateNetworkPolicyForWorkload` — лише cross-file: знайти NP по `metadata.name`, перевірити `matchLabels.app`. Structural egress не перевіряє (це rego).
- `ensureNetworkPoliciesForWorkloadsInDir` (6432)
- `appendNetworkPolicyDocuments` (6328)
- `regenerateLegacyNetworkPolicyDocsInFile` (6397) — але тригер розширюється (§6).

### CHANGELOG / version bump

- Видалення `networkPolicyManifestViolations` — **публічний** export → **major** version bump `@nitra/cursor`.
- Додавання третього параметра `kind` до `buildNetworkPolicyYaml` — breaking якщо хтось mocked signature. Зафіксувати в CHANGELOG.

## §5 — CI / lint-k8s

Root `package.json`, скрипт `lint-k8s`:

```bash
# після kubeconform + kubescape
conftest test \
  --data npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml \
  --data npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml \
  -p npm/rules/k8s/policy/network_policy \
  --namespace k8s.network_policy \
  $(find . -path '*/k8s/**/networkpolicy.yaml' -not -path '*/node_modules/*')
```

GHA workflow `.github/workflows/…` — додати крок «Install conftest» (аналогічно kubeconform).

## §6 — Migration

### Тригер міграції

`networkPolicyHasLegacyCatchAllEgress` (поточний, вузький) **замінюється** на `networkPolicySpecDiffersFromCanon(doc, kind)`:

```js
function networkPolicySpecDiffersFromCanon(npDoc, kind) {
  const canon = loadSnippetSpec(snippetNameForKind(kind))
  // superset: кожне канонічне правило має бути в npDoc.spec
  return (
    !canonContainedIn(canon.egress ?? [], npDoc.spec?.egress ?? []) ||
    !canonContainedIn(canon.ingress ?? [], npDoc.spec?.ingress ?? [])
  )
}
// canonContainedIn(canonList, actualList): every item in canonList deep-equal-matches some item in actualList
```

Перший прогін `n-fix` після мерджу перепише **всі** `networkpolicy.yaml` у репо під новий канон (додасть link-local DNS, додасть анотацію `nitra.dev/workload-kind`, додасть intra-replica для StatefulSet). Це **очікуваний масовий diff** — виносити в окремий PR.

### Послідовність реалізації

1. Перейменувати snippet → `common.snippet.yaml`; створити `statefulset.snippet.yaml`.
2. Переписати JS (`loadCanonSpec`, `buildNetworkPolicyYaml` з `kind`, видалити дублі, розширити тригер міграції).
3. Переписати rego (superset check, annotation dispatch).
4. Переписати rego-тести (фікстури з `--data`).
5. Додати conftest у `lint-k8s` + GHA.
6. Bun-тести: оновити `buildNetworkPolicyYaml`-тест, видалити `networkPolicyManifestViolations`-тести.
7. CHANGELOG: major bump.
8. Прогнати `bun test`, `conftest test` → чисто.
9. Прогнати `n-fix` → окремий PR з масовим diff'ом NP-файлів.
10. Оновити `k8s.mdc`: прибрати перелік портів → посилання на `common.snippet.yaml`.

## §7 — `.mdc` документація

`npm/rules/k8s/k8s.mdc`, блок «NetworkPolicy»:

**Прибрати:** перелік портів (5432, 6379, …) — порти у snippet'і.  
**Прибрати:** структуру egress в тексті — вона у snippet'і.  
**Залишити:**

- Коли потрібна NetworkPolicy (для кожного workload)
- Прив'язка `metadata.name = workload-name`, `podSelector.matchLabels.app = workload-app`
- `nitra.dev/workload-kind` анотація (що означає, звідки береться)
- Посилання на `template/deployment.snippet.yaml` і `template/statefulset.snippet.yaml` як на source of truth (два повних канони, без merge)
- Пояснення link-local DNS (GKE NodeLocal DNSCache, `169.254.0.0/16`, RFC 3927) — чому ця адреса, а не kube-dns ClusterIP
- Команда для запуску conftest

## §8 — Open risks

| Risk                                                                                 | Severity     | Mitigant                                                                      |
| ------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------- |
| Snippet парситься у JS і conftest (два парсери)                                      | Low          | Snippet без anchors/multi-doc/complex types; тест «snippet існує і парситься» |
| Relative path до snippet'а зашитий у JS                                              | Low          | Bun-тест «loadCanonSpec('common') не кидає»                                   |
| conftest --data ключ = basename без .yaml (перевірити)                               | Medium       | Перевірити через `conftest test --trace` у перший день реалізації             |
| n-fix масово перепише NP-файли                                                       | Expected     | Окремий PR, не змішувати з реалізаційним                                      |
| DaemonSet host-network mode — інший канон                                            | Out of scope | Не покривається; існуючий код уже зламаний; окремий дизайн                    |
| Додаткові правила (extra-egress) — тепер дозволені, але rego не попереджає про drift | Low          | Свідоме рішення (superset); при необхідності — окремий `warn`                 |

## Файли змін

```
npm/rules/k8s/policy/network_policy/template/
  deployment.snippet.yaml                      ← перейменований з networkpolicy.snippet.yaml
  statefulset.snippet.yaml                     ← новий, ПОВНИЙ канон (не delta)
npm/rules/k8s/js/manifests.mjs                 ← loadSnippetSpec, KIND_TO_SNIPPET, buildNetworkPolicyYaml(kind), видалити дублі
npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs  ← оновити тести
npm/rules/k8s/policy/network_policy/network_policy.rego        ← superset deny, annotation dispatch
npm/rules/k8s/policy/network_policy/network_policy_test.rego   ← фікстури з --data
npm/rules/k8s/k8s.mdc                          ← прибрати дублювання, посилання на snippet
package.json (root)                            ← conftest у lint-k8s
.github/workflows/…                            ← install conftest step
npm/CHANGELOG.md                               ← major bump
```
