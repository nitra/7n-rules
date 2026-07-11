---
type: ADR
title: SSH gateway з backend-контролем доступу до k8s
description: Доступ розробників до dev-середовища в k8s має проходити через gateway з backend-авторизацією, а не через прямі kubectl-права.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Розробникам потрібен доступ до dev-середовища в k8s для роботи з файловим станом задач і Zed Remote. Водночас transcript фіксує вимогу, що розробники не повинні мати прямі `kubectl` права. Потрібно визначити, де має виконуватися авторизація доступу.

## Considered Options

- `kubectl port-forward` + SSH у pod.
- SSH gateway або bastion з backend-авторизацією.
- Teleport як готовий gateway з RBAC, SSO й audit log.
- Власний gateway: HTTP auth, перевірка прав у backend/DB, створення dev pod і проксування SSH.

## Decision Outcome

Chosen option: "SSH gateway або bastion з backend-авторизацією", because `kubectl port-forward` вимагає kubectl-доступу, якого розробники не мають і не повинні мати; рішення про доступ має приймати backend перед відкриттям SSH-зʼєднання.

### Consequences

- Good, because розробникам не потрібно видавати прямі k8s credentials.
- Good, because backend може централізовано контролювати, хто й до якого dev-середовища має доступ.
- Neutral, because transcript розглядає Teleport і власний gateway, але не фіксує остаточний вибір реалізації між ними.
- Bad, because transcript не містить підтвердження негативних наслідків.

## More Information

Transcript згадує два варіанти реалізації gateway:

- Teleport: RBAC, SSO, audit log, `tsh proxy`; позначений як швидкий production-старт.
- Власний gateway: HTTP auth, перевірка прав у DB/backend, динамічне створення dev pod, SSH-проксування через OpenSSH/ProxyCommand.

Dev pod має монтувати той самий PVC, що й worker-поди з task-графом. Рівень доступу може бути read або rw залежно від ролі. Повʼязані файли стану задач: `tasks/<node>/task.md`, `run_NNN.md`, `outputs_NNN.md`, `pending-audit_NNN.md`.

## Update 2026-06-07

Додано повʼязані деталі k8s-середовища для task-графа:

- Worker-поди й dev pod мають монтувати спільний `tasks-pvc`, щоб Zed Remote бачив живий файловий стан задач.
- Рекомендований dev-доступ у transcript: pod із SSH-сервером і `zed --headless`; приклад тимчасового доступу — `kubectl port-forward pod/n-graph-dev 2222:22`, але цей варіант не підходить для розробників без `kubectl` прав.
- UI задач не має напряму монтувати `tasks/`; він читає стан через API на базі `graph scan --json`, REST або SSE.
- Запропоновані назви UI: `n-graph`, `graphwatch`, `taskflow`; остаточний вибір назви transcript не підтвердив.

## Update 2026-06-07

- Teleport обрано як identity-aware SSH gateway для доступу розробників до dev pod-ів без видачі `kubectl`-прав.
- Відхилено `kubectl port-forward`, because він вимагає прямого `kubectl`-доступу у розробника.
- Бекенд `nitra/task` контролює доступ через label-и pod-ів: `task: <node-name>`, `owner: <email>`, `project: nitra-cursor`.
- Teleport Role використовує `{{internal.logins}}` для зіставлення користувача з `owner` label.
- Zed підключається через стандартний SSH: `~/.ssh/config` + `ProxyCommand tsh proxy ssh --cluster=nitra %h:%p`.
- Teleport додає short-lived SSH-сертифікати, SSO через GitHub OAuth або Google і audit log.
- Операційний наслідок: потрібно задеплоїти Teleport Auth Server + Proxy, transcript згадує Helm chart.

## Update 2026-06-07

- Для UX доступу розробників до task-nodes додано on-demand spawning dev pod-ів через бекенд `nitra/task`.
- Потік: UI-запит → перевірка прав у бекенді → `kubectl apply dev-pod.yaml` з labels `task=<name>`, `owner=<email>` → очікування `pod Ready` → Teleport node-agent реєструється → бекенд повертає connection string.
- Dev pod монтує `tasks-pvc`, тому розробник бачить актуальні `task.md`, `run_NNN.md`, `outputs_NNN.md`.
- Lifecycle: grace period після закриття SSH-сесії, auto-delete по timeout або при переході task-node у `resolved`.
- Назву UI-проєкту зафіксовано як `nitra/task`; transcript згадує розташування `/Users/vitaliytv/www/nitra/task`.

## Update 2026-06-07

- Підтверджено, що dev pod-и створюються on-demand, а не тримаються постійно для кожного task-node.
- Подія `Developer відкрив сесію` запускає pod spawn; після закриття SSH-сесії pod живе grace period; після timeout або переходу task-node у `resolved` pod видаляється.
- Для кількох редакторів запропоновано `Open in editor` UX:
  - VS Code: `vscode://vscode-remote/ssh-remote+<hostname>.teleport.nitra.com/tasks`
  - Cursor: `cursor://vscode-remote/ssh-remote+<hostname>.teleport.nitra.com/tasks`
  - Zed: copy hostname, because transcript не фіксує підтримку URI deep link у Zed.
- Всі редактори використовують однаковий `~/.ssh/config` з `ProxyCommand tsh proxy ssh`.
- Конфіг SSH з transcript: `Host *.teleport.nitra.com`, `ProxyCommand tsh proxy ssh --cluster=nitra %h:%p`, `User dev`.

## Update 2026-06-07

Додано деталізацію backend-controlled SSH доступу для `nitra/task`:

- Розробник не отримує `kubectl`; доступ до dev pod контролюється бекендом через Teleport labels.
- Teleport RBAC використовує label `owner: {{internal.logins}}`, щоб розробник бачив лише власні pod-и.
- Dev pod монтує `tasks-pvc`, спільний із worker pods `n-cursor graph`.
- Join method: Kubernetes ServiceAccount JWT, без статичних токенів.
- Кнопка `Open in Editor` створює dev pod on-demand і повертає connection string.
- VS Code і Cursor відкриваються через `vscode://vscode-remote/ssh-remote+<host>/tasks` та `cursor://vscode-remote/ssh-remote+<host>/tasks`; Zed використовує hostname copy fallback.
- Маніфести згадані в transcript: `k8s/teleport/configmap.yaml`, `deployment.yaml`, `service.yaml`, `ingress.yaml`, `pvc.yaml`, `rbac.yaml`, `roles.yaml`, `k8s/dev-pod/template.yaml`, `k8s/dev-pod/rbac.yaml`, `k8s/README.md`.
