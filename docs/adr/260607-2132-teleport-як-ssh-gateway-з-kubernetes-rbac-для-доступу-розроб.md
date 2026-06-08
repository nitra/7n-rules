---
session: bce336cc-aa1a-406e-9d06-59ac3091f37c
captured: 2026-06-07T21:32:06+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bce336cc-aa1a-406e-9d06-59ac3091f37c.jsonl
---

---

## ADR Teleport як SSH gateway з Kubernetes RBAC для доступу розробників до dev pods

## Context and Problem Statement
Розробники без прав `kubectl` потребують SSH-доступу до dev pods у кластері де живуть файли задач (`tasks-pvc`). Бекенд `nitra/task` повинен самостійно вирішувати, чи має конкретний розробник право підключитися, без делегування цього рішення на рівень k8s RBAC.

## Considered Options
* Teleport (identity-aware SSH proxy з RBAC через labels)
* `kubectl port-forward` з SSH у поді

## Decision Outcome
Chosen option: "Teleport як SSH gateway", because `kubectl port-forward` потребує прав `kubectl` у розробника і не дає серверного контролю авторизації; Teleport дозволяє бекенду `nitra/task` контролювати доступ через label `owner: email` без надання розробникам прав до k8s API.

### Consequences
* Good, because transcript фіксує очікувану користь: короткоживучі X.509/SSH сертифікати (TTL 8–24 год), label-based RBAC де `owner == email` юзера підставляється динамічно з GitHub identity, audit log з коробки.
* Good, because Zed, VS Code і Cursor підключаються через стандартний SSH з `ProxyCommand tsh proxy ssh` у `~/.ssh/config` без патчів до редакторів; VS Code і Cursor підтримують URI deep link (`vscode://`, `cursor://`) для одноклікового відкриття.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Маніфести у `/Users/vitaliytv/www/nitra/task/k8s/`:
- `namespace.yaml`, `cnpg/cluster.yaml` (PostgreSQL 3 instances через CloudNativePG)
- `teleport/configmap.yaml` — `storage.type: postgresql`, `conn_string: "${PG_CONN_STRING}"`
- `teleport/statefulset.yaml` — 2 репліки Auth+Proxy, `volumeClaimTemplates: 1Gi`, env `PG_CONN_STRING` із CNPG secret `teleport-postgres-app`
- `teleport/rbac.yaml`, `teleport/roles.yaml` — Teleport Role `developer` дозволяє доступ лише до вузлів де `owner: "{{internal.logins}}"`
- `dev-pod/template.yaml` — Pod шаблон із sidecar `teleport-node` (k8s join method), монтує `tasks-pvc`
- Бекенд spawn flow: `POST /api/tasks/:id/open-editor` → `kubectl apply` dev pod → Teleport реєструє ноду → повертає hostname

---

## ADR Завдання системи `nitra/task` — вузловий task.md файл як одиниця роботи

## Context and Problem Statement
Потрібна структура для зберігання та запуску агентних задач у системі `n-cursor graph`. Задачі мають описувати що зробити, критерії завершення та вхідні дані, не прив'язуючись до конкретного виконавця.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Директорія-вузол із `task.md` із YAML frontmatter", because стан вузла визначається наявністю файлів (`waiting` = тільки `task.md`; `running` = є `run_*.md`; `resolved` = є `outputs_*.md`) без зовнішньої БД стану, що відповідає архітектурі рекурсивного складеного ОАГ описаній у `docs/думка.MD`.

### Consequences
* Good, because transcript фіксує очікувану користь: вузли незалежні, стан читається через `ls`, задачі запускаються через `n-cursor graph run tasks/<name>`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Створені вузли у `/Users/vitaliytv/www/nitra/cursor/tasks/`:
- `ui-task-view/task.md` — UI перегляду задач, budget 3600 сек
- `coverage-skill-test/task.md` — тестування `n-coverage-fix` після міграції на `pi`, budget 1800 сек
- `skills-orchestrator-migration/task.md` — міграція `npm/skills/` на JS-оркестратор паттерн, budget 7200 сек

Створений вузол у `/Users/vitaliytv/www/nitra/task/tasks/`:
- `open-in-editor/task.md` — кнопка "Open in Editor" з підтримкою VS Code, Cursor, Zed через `POST /api/tasks/:id/open-editor`

Frontmatter: `created_at` (ISO 8601), `budget_sec`. Секції: `## Task`, `## Done when`, `## Inputs`.

---

## ADR CloudNativePG (CNPG) як PostgreSQL backend для Teleport замість SQLite

## Context and Problem Statement
SQLite backend Teleport обмежує кількість реплік Auth Server до одного екземпляра. Потрібен HA-розгортання з rolling update без downtime.

## Considered Options
* CloudNativePG (PostgreSQL operator для k8s)
* SQLite (файловий backend, початковий варіант)

## Decision Outcome
Chosen option: "CloudNativePG", because PostgreSQL backend дозволяє запускати 2 репліки Teleport StatefulSet з rolling update без downtime; CNPG автоматично керує primary/replica failover і створює secret `teleport-postgres-app` із `uri` полем яке Teleport отримує через `${PG_CONN_STRING}`.

### Consequences
* Good, because transcript фіксує очікувану користь: StatefulSet з replicas: 2, rolling update, failover при падінні поду; `volumeClaimTemplates: 1Gi` на кожну репліку для host-сертифікатів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`k8s/cnpg/cluster.yaml` — `instances: 3` (1 primary + 2 replicas), namespace `teleport`.
`k8s/teleport/statefulset.yaml` — замінює `deployment.yaml`; env `PG_CONN_STRING` з `secretKeyRef: teleport-postgres-app / uri`.
`k8s/teleport/configmap.yaml` — `storage: {type: postgresql, conn_string: "${PG_CONN_STRING}"}`.
Видалено: `k8s/teleport/pvc.yaml` (SQLite PVC), `k8s/teleport/deployment.yaml`.
Порядок деплою: `cnpg/cluster.yaml` → дочекатись CNPG Ready → `teleport/statefulset.yaml`.
