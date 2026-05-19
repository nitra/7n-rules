---
session: b2548bae-dcf7-4da7-a1d3-edd830b8c5e9
captured: 2026-05-19T10:03:31+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b2548bae-dcf7-4da7-a1d3-edd830b8c5e9.jsonl
---

## ADR Явний список in-cluster портів в egress NetworkPolicy замість catch-all

## Context and Problem Statement
Поточний канонічний egress `networkpolicy.yaml` містить `to: [{namespaceSelector: {}}]` без поля `ports:`, що у K8s означає дозвіл на будь-який порт до будь-якого Pod у кластері — це суперечить принципу least-privilege. Запит додати DB-порти для Adminer-подібних сервісів став точкою входу для ширшої ревізії in-cluster egress.

## Considered Options
* **A. Проєктний аналіз:** детектувати використовувані БД з `package.json` / env і генерувати NP динамічно.
* **B. Статичний явний список портів глобально:** замінити catch-all на `namespaceSelector: {}` + фіксований `ports:` для всіх NP.
* **C. Зберегти відкритий in-cluster, Adminer — лише зовнішній egress (ipBlock 0.0.0.0/0) з DB-портами.**

## Decision Outcome
Chosen option: "B. Статичний явний список портів глобально", because варіант A є занадто крихким (false negatives, мультимовна матриця, нестабільний при зміні залежностей), а варіант C не покращує загальну модель безпеки. Варіант B дає одне джерело правди та детермінований генератор.

Дефолтний список: `80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318` — на підставі аудиту реальних `containerPort` / `port:` у репо `nitra`.

Семантика check: обов'язкова лише **структура** правила (`to: [{namespaceSelector: {}}]` + непорожній `ports:`); наявність усіх 9 дефолтних портів не перевіряється; extra-порти явно дозволені.

### Consequences
* Good, because transcript фіксує очікувану користь: in-cluster трафік обмежений конкретними портами замість catch-all, catch-all без `ports:` стає `deny` у rego.
* Bad, because workload-и з нестандартними портами (8000, 3488, 13133) потребують ручного extra-переліку після міграції; Prometheus-порти навмисно виключені і потребують окремого ADR при деплойменті.

## More Information
* Шаблон: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`
* Генератор: константа `NETWORK_POLICY_EGRESS_YAML` та `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` у `npm/rules/k8s/fix/manifests/check.mjs`
* Нове rego-deny: `spec.egress: to.namespaceSelector: {} мусить мати ports — catch-all заборонено` у `npm/rules/k8s/policy/network_policy/network_policy.rego`
* Spec: `docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md`
* Plan: `docs/superpowers/plans/2026-05-19-networkpolicy-egress-explicit-ports.md`

---

## ADR Стратегія міграції існуючих NetworkPolicy на явний список портів

## Context and Problem Statement
Після зміни канону всі існуючі `networkpolicy.yaml` у репо матимуть catch-all `to: [{namespaceSelector: {}}]` без `ports:` — нова rego-перевірка одразу дасть `deny`, що зламає CI для всіх сервісів.

## Considered Options
* **M1. Автоматичний повний перезапис:** якщо NP містить catch-all без `ports:`, викликати `buildNetworkPolicyYaml(deployName, appLabel)` і повністю переписати файл.
* **M2. Ручне оновлення:** кожен власник сервісу редагує свій `networkpolicy.yaml` вручну.
* **M3. Масове видалення + `fix`:** `rm` усіх `networkpolicy.yaml`, потім `npx @nitra/cursor fix k8s`.

## Decision Outcome
Chosen option: "M1. Автоматичний повний перезапис", because M2 — повільно й помилкобезпечно для ~12 воркфлоу, M3 втрачає будь-які локальні extra-порти (хоча на момент міграції їх не існує). M1 детермінований: `buildNetworkPolicyYaml` вже є, результат однаковий що при створенні, що при міграції.

### Consequences
* Good, because transcript фіксує очікувану користь: один `npx @nitra/cursor fix k8s` приводить увесь репо у відповідність без ручних правок.
* Bad, because якщо хтось додав local extra-порти до NP до запуску міграції — вони будуть стерті (прийнято свідомо, бо на момент рішення таких файлів у репо немає).

## More Information
* Функція міграції: `regenerateLegacyNetworkPolicyDocsInFile` (нова, у `npm/rules/k8s/fix/manifests/check.mjs`) — виявляє catch-all без `ports:` і викликає `buildNetworkPolicyYaml`.
* Тести: `check-schema.test.mjs` — новий describe `"legacy NetworkPolicy migration"`.
* Аутлаєри портів 8000 / 3488 / 13133 явно out-of-scope цієї міграції — окремий тікет.
