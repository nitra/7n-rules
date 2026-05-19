---
session: b2548bae-dcf7-4da7-a1d3-edd830b8c5e9
captured: 2026-05-19T09:55:40+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b2548bae-dcf7-4da7-a1d3-edd830b8c5e9.jsonl
---

Немає окремого `prometheus`-директорія. Prometheus/Grafana у вашому кластері, мабуть, розгорнутий через Helm поза репо або в іншому namespace.

**Щодо 13133** — це OTel Collector `/healthz` endpoint (OpenTelemetry Collector "zpages/healthcheck extension"). Не Prometheus. Його є тільки 1 svc у репо — очевидно otel-collector.

**Prometheus типові порти:**

| Порт | Що |
|------|-----|
| `9090` | Prometheus HTTP API + scrape targets UI |
| `9100` | node_exporter |
| `9091` | pushgateway |
| `9093` | alertmanager |
| `9187` | postgres_exporter |
| `9121` | redis_exporter |

Жодного з цих портів **у репо нема** (тільки Valkey ServiceMonitor конфіг, де Prometheus scrape-ing може відбуватись через 9091/metrics — але це не фіксовано в Service YAML).

**Практичне питання:** Prometheus scrape — це **ingress** до ваших подів (Prometheus ходить до подів), а не egress від подів. Тому для NP-егресу ваших сервісів ці порти не потрібні — вони потрібні для NP-egress Prometheus-пода.

Якщо хочете — можу додати порт Prometheus (`9090`) і/або метрик-екпортерів до дефолтного списку? Або лишаємо аутлаєром?

Скажіть ваше рішення — зафіксую у spec.
[user]
так, Prometheus scrape — це ingress. ок. 13133 не потрібно тоді — викинути з out-of-scope і нічого там не писати про нього.

що роботи з 8000 та 3488 ?
[assistant]
[thinking]

[assistant]
[tool: Bash] {"command":"find /Users/vitaliytv/www/nitra -path '*/k8s/*' -name '*.yaml' 2>/dev/null | xargs grep -lE 'containerPort: 3488|containerPort: 8000|port: 3488|port: 8000' 2>/dev/null | head -10","description":"Find services using ports 3488 and 8000"}
[user]
[tool_result] /Users/vitaliytv/www/nitra/bono/nginx-static/k8s/base/deployment.yaml
/Users/vitaliytv/www/nitra/k8s/open-webui/hr.yaml
[assistant]
[tool: Bash] {"command":"grep -nE 'containerPort|port|image:' /Users/vitaliytv/www/nitra/bono/nginx-static/k8s/base/deployment.yaml | head -20","description":"Check nginx-static deployment"}
[user]
[tool_result] 18:        - containerPort: 80
[assistant]
[tool: Bash] {"command":"grep -n '3488\\|8000' /Users/vitaliytv/www/nitra/bono/nginx-static/k8s/base/deployment.yaml","description":"Check port 3488 in nginx-static"}
[user]
[tool_result] (Bash completed with no output)
[assistant]
[tool: Bash] {"command":"find /Users/vitaliytv/www/nitra -path '*/k8s/*' \\( -name '*.yaml' -o -name '*.yml' \\) 2>/dev/null | xargs grep -nE '3488|8000' 2>/dev/null | grep -v '.git'","description":"Find all refs to 3488 and 8000"}
[user]
[tool_result] /Users/vitaliytv/www/nitra/ai/k8s/base/deployment.yaml:20:        - containerPort: 3488
/Users/vitaliytv/www/nitra/ai/k8s/base/svc.yaml:9:          port: 3488
/Users/vitaliytv/www/nitra/k8s/open-webui/hr.yaml:19:        - name: containerPort
[assistant]
[thinking]

[assistant]
- **3488** — це `nitra/ai` сервіс. Один сервіс у своєму namespace, нестандартний порт. Скоріш за все AI backend.
- **8000** — `open-webui` (Helm release `hr.yaml`). Один Helm release поза основним K8s-деревом.

Обидва — аутлаєри, не частина загального канону. Для їх in-cluster комунікації після міграції:

- `open-webui` (8000): якщо він ходить до intra-cluster, мусить або мігрувати на `8080`, або власник додає `8000` у extra-порти у своєму `networkpolicy.yaml`. Але він зараз не є Deployment у managed tree (Helm release `hr.yaml`) — тому наша NP-генерація його скоріш за все не торкається.
- `nitra/ai` (3488): це реальний Deployment у дереві. Після міграції M1 його NP матиме 9 дефолтних портів — 3488 туди **не** входить. Тобто якщо якийсь інший pod захоче ходити **до** ai:3488, то блок буде на боці **ingress** ai (їхній NP дозволяє вхід), а не **egress** ініціатора. Якщо ж ai сам ходить кудись на 3488 — теж тільки один сервіс.

**Висновок:** 3488 і 8000 не треба в дефолтний список і не треба згадувати у spec. Якщо після міграції M1 щось зламається — виправляється додаванням порту у файл вручну (це out-of-scope для цього дизайну).

Я зараз приберу 13133 з out-of-scope і теж не писатиму про 3488/8000. Оновлю spec.
[assistant]
[tool: Read] {"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md"}
[user]
[tool_result] 1	# Design: NetworkPolicy egress — явний список in-cluster портів
2
3	...
[assistant]
[tool: Edit] {"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md","old_string":"## Out of scope\n\n- Порти 8000 (`open-webui`) та 3488 (`nitra/ai`) — нестандартні аутлаєри; власники сервісів мігрують окремо (вручну або окремим тікетом).\n- Порт 13133 (OTel healthcheck) — єдиний svc; при потребі власник додає вручну.\n- Перевірка протоколу (TCP/UDP) для in-cluster портів.\n- Adminer-специфічні external egress порти (5432/3306/1433 → `ipBlock 0.0.0.0/0`).\n- Rego-перевірка вичерпного списку in-cluster портів (\"більше — ок, менше — теж ок\").","new_string":"## Out of scope\n\n- Перевірка протоколу (TCP/UDP) для in-cluster портів.\n- Adminer-специфічні external egress порти (5432/3306/1433 → `ipBlock 0.0.0.0/0`).\n- Rego-перевірка вичерпного списку in-cluster портів (\"більше — ок, менше — теж ок\")."}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
Spec оновлено: 13133, 8000 і 3488 прибрані з тексту. Вони просто не існують у spec — ніяких згадок.

Файл: [docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md](docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md)

Дайте фінальний ок — і перейдемо до writing-plans.
[user]
ok

---

The session transcript ends here.

## ADR: Явний список in-cluster портів замість відкритого `namespaceSelector: {}`

## Context and Problem Statement
Поточний канонічний `egress` у `networkpolicy.snippet.yaml` дозволяє `to: [{namespaceSelector: {}}]` **без `ports:`**, що фактично відкриває весь in-cluster трафік — це порушення принципу least-privilege. Потрібно перейти до явного списку дозволених in-cluster портів для всіх auto-generated `NetworkPolicy`.

## Considered Options
* **A. Аналіз залежностей (JS/package.json)** — детектити порти динамічно на основі залежностей проєкту (`pg`, `mysql2`, `redis` тощо) — відхилено як надто крихке та складне.
* **B. Статичний глобальний список in-cluster портів** — замінити catch-all `namespaceSelector: {}` явним `ports:` зі стандартним набором (80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318) для **всіх** NP.
* **C. Зберегти відкритий in-cluster + DB-порти тільки для Adminer у `ipBlock 0.0.0.0/0`** — мінімально інвазивна зміна лише для сервісів Adminer-типу.

## Decision Outcome
Chosen option: **"B — статичний глобальний список in-cluster портів"**, because це покращує least-privilege без аналізу залежностей і охоплює всі workload глобально — рішення прийнято явно в ході брейнсторму.

### Consequences
* Good, because transcript фіксує очікувану користь: всі auto-generated `networkpolicy.yaml` отримають явний список in-cluster портів замість catch-all, що реалізує least-privilege для in-cluster egress.
* Bad, because сервіси з нестандартними портами (3488 у `nitra/ai`, 8000 у `open-webui`) після міграції M1 матимуть лише дефолтні 9 портів — власники мусять додати extra-порти вручну.

## More Information
- Дефолтний список: `80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318`
- Константа: `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` у `npm/rules/k8s/fix/manifests/check.mjs`
- Шаблон: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`
- Rego: `npm/rules/k8s/policy/network_policy/network_policy.rego` — новий `deny` для catch-all `{namespaceSelector: {}}` без `ports:`
- Стратегія міграції **M1**: `fix`-крок у `check.mjs` — якщо NP існує і має catch-all `namespaceSelector: {}` без `ports:`, повністю переписати через `buildNetworkPolicyYaml(deployName, appLabel)`
- Spec: `docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md`

---

## ADR: Семантика чеку для in-cluster egress портів — лише структура правила обов'язкова

## Context and Problem Statement
При переході до явного списку in-cluster портів у NetworkPolicy постало питання, наскільки суворо `check k8s` має валідувати вміст `ports:` у in-cluster egress rule.

## Considered Options
* **Суворо: всі 9 дефолтних портів обов'язкові** — fail, якщо будь-якого бракує.
* **Мінімум: лише структура правила обов'язкова** — `namespaceSelector: {}` без `ports:` (catch-all) — deny; але перелік конкретних портів не перевіряється.
* **Дозволений список: тільки ці порти, не більше** — extra-порти забороняються.

## Decision Outcome
Chosen option: **"Мінімум: лише структура правила обов'язкова"**, because це дозволяє гнучко додавати сервіс-специфічні порти без зміни canonical check, і при цьому запобігає catch-all без `ports:`.

### Consequences
* Good, because transcript фіксує очікувану користь: власники можуть додавати extra-порти у свій `networkpolicy.yaml` без порушення check.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Rego deny: спрацьовує на `to: [{namespaceSelector: {}}]` без `ports:` або з порожнім `ports:`.
- Rego deny НЕ спрацьовує, якщо `ports` має хоч один елемент (навіть нестандартний).
- Файл: `npm/rules/k8s/policy/network_policy/network_policy.rego`
