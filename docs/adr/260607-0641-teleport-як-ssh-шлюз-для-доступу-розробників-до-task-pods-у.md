---
session: bce336cc-aa1a-406e-9d06-59ac3091f37c
captured: 2026-06-07T06:41:07+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bce336cc-aa1a-406e-9d06-59ac3091f37c.jsonl
---

## ADR Teleport як SSH-шлюз для доступу розробників до task pods у k8s

## Context and Problem Statement
Розробники не мають доступу через `kubectl` до кластера де живуть `tasks/`. Потрібен механізм, що дозволяє бекенду `nitra/task` контролювати, хто і до яких task-pods може підключитись, без передачі k8s-credentials розробникам.

## Considered Options
* `kubectl port-forward` з SSH у поді
* Teleport (identity-aware SSH proxy)
* Власний SSH-gateway з custom auth-логікою
* Tailscale / WireGuard у поді

## Decision Outcome
Chosen option: "Teleport", because надає RBAC через pod-labels (`owner: {{internal.logins}}`), SSO-інтеграцію (GitHub/Google), короткоживучі SSH-сертифікати (TTL 8–24 год), і Zed підключається без патчів через стандартний `~/.ssh/config` + `ProxyCommand tsh proxy ssh`.

### Consequences
* Good, because transcript фіксує очікувану користь: розробник без `kubectl` підключається через `tsh` / Zed SSH; cert протухає → доступ закривається автоматично; аудит з коробки.
* Bad, because transcript фіксує одну складність: потрібно задеплоїти Teleport Auth + Proxy Server один раз у кластер (Helm chart).

## More Information
- `kubectl port-forward` відкинуто явно: "потрібно дати доступ розробникам у яких немає прав доступу через kubectl".
- Запропонована `~/.ssh/config` конфігурація: `ProxyCommand tsh proxy ssh --cluster=nitra %h:%p`.
- RBAC-схема: pod отримує label `owner: email`, Teleport Role дозволяє `node_labels.owner: "{{internal.logins}}"` — бекенд не видає прав вручну.
- Teleport Operator (k8s CRD) дозволяє бекенду реєструвати ноди декларативно через `kubectl apply`.

---

## ADR On-demand спавн dev pods бекендом з "Open in Zed" UX

## Context and Problem Statement
Dev pods для доступу розробників до task-nodes не можуть бути завчасно створені для всіх вузлів DAG-графу. Потрібний механізм динамічного provisioning з контролем lifecycle, що запускається через `nitra/task` UI без kubectl у розробника.

## Considered Options
* On-demand spawn через бекенд `nitra/task` (по запиту з UI)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "On-demand spawn через бекенд `nitra/task`", because це стандартний паттерн (GitPod, Codespaces), бекенд вже контролює права, і дозволяє монтувати актуальний `tasks-pvc` з реальним станом DAG (файли `run_NNN.md`, `outputs_NNN.md`, `task.md`).

### Consequences
* Good, because transcript фіксує очікувану користь: розробник отримує кнопку "Open in Zed" у UI → бекенд перевіряє права → `kubectl apply dev-pod.yaml` з labels `task=X, owner=email` → pod готовий (~5–15с) → Teleport реєструє ноду → повертає connection string.
* Bad, because transcript фіксує необхідність продумати lifecycle: grace period після закриття SSH-сесії, timeout без активності, видалення pod коли task-node переходить у стан `resolved`.

## More Information
- Lifecycle-таблиця з transcript: spawn при відкритті сесії → grace period після закриття → auto-delete по timeout → delete при `resolved`.
- Task-файл `nitra/task/tasks/open-in-zed/task.md` (створено `2026-06-07T12:30:00Z`, `budget_sec: 3600`) закріплює вимогу до реалізації.
- Dev pod монтує `tasks-pvc` (read-write або read-only залежно від ролі) — розробник бачить актуальний стан DAG, а не клон репо.
- Паралель з Codespaces/GitPod визнана в transcript з ключовою різницею: pod монтує `tasks-pvc` з DAG-станом, а не загальний dev-environment.

---

## ADR Назва UI-проєкту — `nitra/task`

## Context and Problem Statement
Потрібно назвати окремий веб-проєкт для візуалізації стану task-графу (`думка.MD`) та управління доступом розробників. Проєкт живе у `/Users/vitaliytv/www/nitra/task`.

## Considered Options
* `n-graph` (рекомендовано асистентом: коротко, вписується в `n-cursor` ecosystem)
* `graphwatch` (graph + watch-демон із думка.MD)
* `taskflow` (product-орієнтована назва)
* `nitra/task` (обрано користувачем)

## Decision Outcome
Chosen option: "`nitra/task`", because користувач явно визначив назву і розташування (`/Users/vitaliytv/www/nitra/task`) як частину широкої `nitra/*` namespace.

### Consequences
* Good, because вписується у `nitra/*` namespace поряд з іншими проєктами організації; не прив'язує назву до конкретної технології або до `n-cursor` CLI.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Проєкт вже існує: `ls /Users/vitaliytv/www/nitra/task` повернув `app`, `bun.lock`, `bunfig.toml`, `eslint.config.js`, `package.json`.
- Перший task-node у проєкті: `tasks/open-in-zed/task.md`.
- Назва `n-graph` була першою рекомендацією асистента; користувач її змінив.
