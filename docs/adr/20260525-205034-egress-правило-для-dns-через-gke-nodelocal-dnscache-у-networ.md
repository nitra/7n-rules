---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T20:50:34+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

Based on the transcript, here are the ADR records:

---

## ADR Egress-правило для DNS через GKE NodeLocal DNSCache у NetworkPolicy

## Context and Problem Statement
У GKE-кластерах з увімкненим NodeLocal DNSCache kubelet прописує в `/etc/resolv.conf` подів не ClusterIP kube-dns (наприклад `10.40.0.10`), а link-local адресу локального DNS-агента на ноді (діапазон `169.254.0.0/16`, RFC 3927). Запит на `cluster-hasura-rw.gt-main.svc.n.internal` спочатку йде на `169.254.x.x:53`, і лише звідти агент проксує у CoreDNS/kube-dns. Правило `to: namespaceSelector kube-system` не покриває цей шлях — трафік блокується до того, як взагалі досягає kube-system.

## Considered Options
* Додати egress-правило `ipBlock: 169.254.0.0/16`, порти 53/UDP та 53/TCP
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати egress-правило `ipBlock: 169.254.0.0/16`, порти 53/UDP та 53/TCP", because без цього правила будь-який pod у NetworkPolicy з `policyTypes: [Egress]` не може резолвити DNS-імена сервісів у GKE-кластері з NodeLocal DNSCache.

### Consequences
* Good, because transcript фіксує очікувану користь: pod може резолвити cluster-internal DNS-імена незалежно від того, чи є окреме правило на kube-dns ClusterIP.
* Bad, because transcript не містить підтверджених негативних наслідків. Діапазон `169.254.0.0/16` — link-local (RFC 3927), не маршрутизується в інтернет; у не-GKE-кластерах без NodeLocal DNSCache правило просто нічого не пропускає.

## More Information
Правило додано до `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` (перейменовується в `deployment.snippet.yaml`):
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
Паралельно вже існує правило на `namespaceSelector: {kubernetes.io/metadata.name: kube-system}` — обидва потрібні: перше для GKE NodeLocal DNSCache, друге як fallback / non-GKE кластери.

---

## ADR NetworkPolicy snippet як єдине джерело правди для канону egress

## Context and Problem Statement
Канон egress-правил NetworkPolicy дублювався у 5+ місцях: рядковий шаблон `NETWORK_POLICY_EGRESS_YAML` в `manifests.mjs`, структурна JS-перевірка `networkPolicyManifestViolations`, OPA-правила в `network_policy.rego`, фікстура `valid_np` у rego-тестах, і `networkpolicy.snippet.yaml` як «еталон для очей» (ніким не читався в runtime). Будь-яка зміна канону (наприклад, додавання link-local DNS-правила) потребувала оновлення в кожному з них з ризиком розбіжностей.

## Considered Options
* Snippet → JS (читається як джерело правди, rego лишається вручну)
* Snippet → rego через `conftest --data snippet.yaml` (JS тонкий шар I/O, rego перевіряє через data)
* Rego як канон, JS читає rego
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Snippet → rego через `conftest --data snippet.yaml`", because це найкоротший шлях від одного файлу до автоматичної перевірки без codegen-артефактів: conftest завантажує snippet через `--data`, rego порівнює `input.spec.egress` проти `data.deployment_snippet.spec.egress` через deep-subset. JS зберігає роль cross-file I/O (workload → NP прив'язка, n-fix), але позбавляється власного канону.

### Consequences
* Good, because transcript фіксує очікувану користь: зміна канону в одному snippet-файлі автоматично відображається в генерацію (`buildNetworkPolicyYaml`) і валідацію (rego) без ручного оновлення.
* Bad, because видалення публічного експорту `networkPolicyManifestViolations` з `manifests.mjs` є breaking change для JS-API `@nitra/cursor` — потребує major version bump.

## More Information
Файли: `npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml`, `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml` (перейменовано з `networkpolicy.snippet.yaml`; додано `statefulset.snippet.yaml`). Conftest виклик: `conftest test --data deployment.snippet.yaml --data statefulset.snippet.yaml -p npm/rules/k8s/policy/network_policy --namespace k8s.network_policy`. Spec: `docs/superpowers/specs/2026-05-25-networkpolicy-snippet-single-source-of-truth-design.md`.

---

## ADR Deep-subset семантика для rego-перевірки NetworkPolicy

## Context and Problem Statement
При переході до snippet як canon-of-truth постало питання семантики rego-перевірки: чи має `input.spec.egress` бути точно рівним канону (byte-equal), або може містити додаткові правила (наприклад, egress до S3-CIDR конкретного workload-у). Строга рівність унеможливлює будь-яке відхилення від шаблону, що є надмірно жорстким для production-кейсів.

## Considered Options
* Строга структурна рівність `input.spec.egress == canon.spec.egress`
* Deep-subset: канон ⊆ `input.spec.egress` (кожне canonical-правило присутнє, зайве дозволено) плюс safety-net заборони
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Deep-subset + safety-net", because команда хоче зберегти можливість додавати workload-специфічні egress-правила (наприклад, вихід до S3 або до зовнішнього API) без зміни canonical snippet. Safety-net явно забороняє небезпечні паттерни: `to: [{}]` без `ports` (catch-all), `namespaceSelector: {}` без `ports`.

### Consequences
* Good, because transcript фіксує очікувану користь: extra egress-правила у конкретному workload-і проходять перевірку; canonical-правила (link-local DNS, kube-dns, internet 80/443, in-cluster) залишаються обов'язковими.
* Bad, because відсутність строгої рівності означає, що випадково додане зайве правило (не catch-all, але надмірно широке) не буде відловлено автоматично — контроль залишається на code review.

## More Information
Семантика `rule_in_list`: deep equality через `json.marshal(item) == json.marshal(canon_rule)` — порівняння object-значень незалежно від порядку ключів у map, але порядок правил у масиві не фіксується (set-семантика на рівні масиву egress-rules). Spec: `docs/superpowers/specs/2026-05-25-networkpolicy-snippet-single-source-of-truth-design.md` розділ «Rego: семантика перевірки».

---

## ADR Multi-canon dispatch через анотацію `nitra.dev/workload-kind`

## Context and Problem Statement
Різні workload-типи мають різні canonical egress-вимоги: StatefulSet потребує додаткового intra-replica правила (`to: [{podSelector: {}}]`) для реплікації між pod-ами, якого не потрібно Deployment/Job/CronJob/DaemonSet. При одному snippet'і неможливо задовільнити обидва типи одночасно без додаткової інформації про тип workload у NP-документі.

## Considered Options
* Анотація `nitra.dev/workload-kind` у кожному NetworkPolicy-документі — rego читає анотацію і dispatch'ить на відповідний snippet
* «Match the closest» — rego перевіряє відповідність хоча б одному зі snippet'ів без анотації
* JS вибирає snippet і викликає conftest з відповідним `--data` залежно від знайденого workload-типу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Анотація `nitra.dev/workload-kind`", because JS-генератор уже знає workload-kind при генерації, анотація самодокументує NP-файл, а rego отримує self-describing input без необхідності сканувати сусідні файли (чого conftest не вміє).

### Consequences
* Good, because transcript фіксує очікувану користь: NP-файл явно вказує, до якого workload-типу він належить; rego може dispatch'ити на правильний snippet без cross-file lookups.
* Bad, because StatefulSet без анотації `nitra.dev/workload-kind` (legacy або ручний) отримує fallback до `deployment.snippet.yaml` — conftest падає на intra-replica правилах. Міграція через `n-fix` є обов'язковою.

## More Information
Значення анотації: `Deployment | StatefulSet | Job | CronJob | DaemonSet`. JS-генератор `buildNetworkPolicyYaml(deployName, appLabel, workloadKind)` виставляє анотацію автоматично. Fallback (відсутня анотація): `deployment.snippet.yaml`. Файли: `npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml`, `statefulset.snippet.yaml`.
