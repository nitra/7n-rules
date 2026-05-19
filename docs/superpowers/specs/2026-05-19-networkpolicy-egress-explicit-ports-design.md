# Design: NetworkPolicy egress — явний список in-cluster портів

**Дата:** 2026-05-19
**Область:** `npm/rules/k8s` — генерація та перевірка `networkpolicy.yaml`

---

## Проблема

Поточний канонічний egress дозволяє `to: [{namespaceSelector: {}}]` **без** поля `ports`. У термінах Kubernetes NetworkPolicy це означає: будь-який Pod у будь-якому namespace на будь-якому порту. Тобто catch-all egress у межах кластера для всіх workload-ів.

Це слабке місце з точки зору least-privilege: ingress-policy на боці БД-подів — єдина залишкова межа. Хочемо явно перерахувати дозволені in-cluster порти.

---

## Рішення

### 1. Новий канон egress (in-cluster блок)

Замість відкритого `namespaceSelector: {}` — той самий selector, але з явним списком портів:

```yaml
spec:
  egress:
    # 1) kube-dns — без змін
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }

    # 2) HTTP/HTTPS назовні — без змін
    - to:
        - ipBlock: { cidr: 0.0.0.0/0 }
      ports:
        - { protocol: TCP, port: 80 }
        - { protocol: TCP, port: 443 }

    # 3) НОВЕ: in-cluster — явний список замість catch-all
    - to:
        - namespaceSelector: {}
      ports:
        - { protocol: TCP, port: 80 }
        - { protocol: TCP, port: 443 }
        - { protocol: TCP, port: 5432 }   # Postgres
        - { protocol: TCP, port: 3306 }   # MySQL / MariaDB
        - { protocol: TCP, port: 1433 }   # MSSQL
        - { protocol: TCP, port: 6379 }   # Redis / Valkey
        - { protocol: TCP, port: 8080 }   # Hasura / HTTP backends
        - { protocol: TCP, port: 4317 }   # OTLP gRPC
        - { protocol: TCP, port: 4318 }   # OTLP HTTP
```

**Дефолтний список:** `80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318` (9 портів).

**Глобально:** канон один — для всіх auto-generated NP, без розділення за типом workload. Adminer-специфічна обробка не вводиться (DB-порти вже у дефолті in-cluster блоку).

### 2. Зовнішні БД — поза скоупом

Зовнішні Postgres / RDS / Cloud SQL потребують DB-портів у `ipBlock 0.0.0.0/0`. Канон цього **не** додає. Якщо конкретному workload (наприклад Adminer, що ходить на RDS) це потрібно — власник вручну розширює `ipBlock 0.0.0.0/0` у своєму `networkpolicy.yaml` додатковими портами. Check цьому не заважає (див. семантику нижче).

### 3. Аутлаєри 8000 / 3488 / 13133

Workload-и, що зараз слухають на нестандартних портах:

- `8000` (open-webui)
- `3488` (нестандартний)
- `13133` (OTel healthcheck)

У дефолтний список **не входять**. Після міграції їхній in-cluster трафік на ці порти зламається. Власники мігрують їх **окремою задачею**: або перевести на стандартні порти (`8080`), або додати екстра-порти вручну до свого NP. Не входить у скоуп цього дизайну.

---

## Семантика check

| Перевірка | Поведінка |
|---|---|
| kube-dns rule | Без змін: вимагається rule з `kube-system` namespaceSelector + `kube-dns` podSelector + порти 53 UDP/TCP. |
| `ipBlock 0.0.0.0/0` з 80 та 443 | Без змін: обов'язковий. Extra-порти у тому ж блоці — дозволені. |
| In-cluster `namespaceSelector: {}` rule | **Зміна:** має існувати, AND `ports:` непорожній. Catch-all (порожній/відсутній `ports`) — fail. |
| Конкретний список портів in-cluster | **Не перевіряється.** Семантика «мінімум — лише структура». Workload може звузити чи розширити список. |
| `egress: [{}]` (allow-all whole rule) | Без змін: заборонено. |

**Філософія:** єдина точка enforcement — структура (catch-all більше не приймається). Конкретні порти — за вибором сервісу.

---

## Файли, що змінюються

| Файл | Зміна |
|---|---|
| `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` | Новий канон: in-cluster блок з 9 портами. |
| `npm/rules/k8s/policy/network_policy/network_policy.rego` | Додати deny на in-cluster rule з порожнім/відсутнім `ports`. |
| `npm/rules/k8s/policy/network_policy/network_policy_test.rego` | Тести: catch-all → fail; rule з ports → pass; нестандартний набір портів → pass. |
| `npm/rules/k8s/fix/manifests/check.mjs` | Оновити `NETWORK_POLICY_EGRESS_YAML`; винести список портів у `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS`. |
| `npm/rules/k8s/fix/manifests/check-schema.test.mjs` | Оновити фікстури під новий канон. |
| `npm/rules/k8s/k8s.mdc` | Оновити людиночитаний опис канону egress (нагадування, що catch-all заборонено). |
| `npm/CHANGELOG.md` | Запис про зміну канону + міграцію. |

---

## Міграція (M1: повний перезапис існуючих NP)

Існуючі `networkpolicy.yaml` у всіх репо містять старий catch-all і після зміни check fail-нуть. Поточний `check k8s` дописує NP, **лише** коли його немає; виявлені — лише валідуються. Тому додаємо разовий fix-крок.

**Алгоритм:**

1. У `check.mjs`, у логіці валідації NP, після перевірки структури — якщо `spec.egress` містить in-cluster rule з порожнім/відсутнім `ports`, видалити старий файл і викликати `buildNetworkPolicyYaml(deployName, appLabel)` для перегенерації з новим каноном.
2. Згенерований YAML детермінований; коментарів і кастомних правок зараз там немає, тож втрат не буде.
3. Кроки fix у користувача:
   ```
   npx @nitra/cursor fix k8s
   ```
   приведе всі NP у репо до нового канону за один прогін.
4. Власники сервісів аутлаєрів (`8000`/`3488`/`13133`) — окремо мігрують свої файли.

**Альтернативи відхилено:**

- M2 (ручне оновлення) — повільно, помилкобезпечно.
- M3 (`rm` + регенерація) — втрачає `metadata.namespace` у base-маніфестах, теоретично втрачає кастомні правки (зараз їх немає, але правило бажано тримати ідемпотентним).

---

## Обґрунтування підходу

Розглядалось три варіанти:

- **A. Project dependency analysis** (детектити `pg`/`mysql2` у `package.json` → дозволяти відповідні порти) — відхилено: складно, крихко, мульти-мовність робить це неможливим у статичній перевірці.
- **B. Static port list (обраний)** — прозоро, детерміновано; «вручну розширити» — звичайне редагування файлу.
- **C. Локальна зміна тільки для Adminer** — відхилено на користь global B. Безпека покращується для всіх workload-ів одночасно.

---

## Out of scope

- Аналіз `package.json` чи інших файлів для автодетекції залежностей.
- Adminer-специфічна детекція `metadata.name`.
- Per-workload override через labels/annotations.
- Міграція аутлаєрів `8000`/`3488`/`13133` (окремий тікет).
- Зовнішні DB через `ipBlock 0.0.0.0/0` (можливо у майбутніх ітераціях; зараз — ручне розширення per-workload).
