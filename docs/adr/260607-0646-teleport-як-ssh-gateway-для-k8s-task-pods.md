---
type: ADR
title: Teleport як SSH gateway для k8s task pods
description: Розробники підключаються до task pods через Teleport і on-demand dev pods без прямого kubectl-доступу.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Розробники потребують SSH-доступу до dev pods у Kubernetes, де доступні task-вузли та `tasks/`-стан, але вони не мають і не повинні мати прямого `kubectl`-доступу до кластера. Авторизацію на рівні конкретного task-node має контролювати бекенд `nitra/task`, а не k8s RBAC, виданий розробникам напряму.

Також dev pods не мають бути постійно запущені для кожного task-node: вони потрібні лише коли розробник відкриває вузол для інспекції або патчу через редактор.

## Considered Options

- `kubectl port-forward` з SSH-сервером у pod.
- Власний SSH gateway з кастомною auth-логікою.
- Teleport як identity-aware SSH proxy з RBAC, SSO та audit log.
- Постійно запущені dev pods для task-nodes.
- On-demand spawning dev pods бекендом `nitra/task`.
- Підтримка тільки Zed через ручний SSH hostname.
- Підтримка VS Code і Cursor через URI deep link, а Zed через copy hostname.

## Decision Outcome

Chosen option: "Teleport + on-demand spawning dev pods", because `kubectl port-forward` вимагає kubectl-прав у розробника, що прямо суперечить вимозі; власний gateway потребує реалізації сертифікатів, audit і SSO; Teleport дає RBAC через labels, SSO, audit log і короткоживучі SSH-сертифікати з коробки. On-demand spawning дозволяє бекенду `nitra/task` перевіряти права, створювати pod з labels `task` і `owner`, чекати `Ready`, після чого Teleport node-agent реєструє pod як SSH target.

Для editor UX обрано URI deep link для VS Code і Cursor, а для Zed — copy hostname, because transcript зафіксував підтримку `vscode-remote` URI у VS Code/Cursor і відсутність аналогічного URI-протоколу для Zed.

### Consequences

- Good, because розробник не отримує `kubectl`-credentials: доступ контролюється бекендом через labels на dev pod і Teleport RBAC.
- Good, because короткоживучі SSH-сертифікати Teleport з TTL 8–24 год прибирають потребу у статичних SSH-ключах.
- Good, because Zed, VS Code і Cursor використовують стандартний SSH через `~/.ssh/config` і `ProxyCommand tsh proxy ssh` без патчів до редакторів.
- Good, because on-demand pods не споживають ресурси, коли ніхто не працює з task-node.
- Bad, because потрібно один раз задеплоїти Teleport Auth Server і Proxy Server у кластер; transcript згадує Helm chart, але це все одно додатковий операційний компонент.
- Bad, because для Zed transcript фіксує ручний крок copy hostname, на відміну від URI deep link у VS Code і Cursor.
- Neutral, because transcript не містить підтвердженого виміру впливу cold-start latency; згадується очікуваний порядок 5–15 секунд на spawn pod і реєстрацію Teleport.

## More Information

Факти з transcript:

- Бекенд/UI-проєкт: `nitra/task`, шлях `/Users/vitaliytv/www/nitra/task`.
- Task-файл для UX: `nitra/task/tasks/open-in-zed/task.md`.
- Dev pod labels: `task=<name>`, `owner=<email>`, `project=nitra-cursor`.
- Teleport Role використовує label-зв'язок на кшталт `node_labels.owner: "{{internal.logins}}"`.
- Teleport Operator / k8s CRD може дозволити декларативну реєстрацію dev pods.
- Dev pod монтує `tasks-pvc`, де розробник бачить актуальні `task.md`, `run_NNN.md`, `outputs_NNN.md`.

Приклад SSH config:

```sshconfig
Host *.teleport.nitra.com
  ProxyCommand tsh proxy ssh --cluster=nitra %h:%p
  User dev
```

Приклад URI для VS Code і Cursor:

```text
vscode://vscode-remote/ssh-remote+<hostname>.teleport.nitra.com/tasks
cursor://vscode-remote/ssh-remote+<hostname>.teleport.nitra.com/tasks
```

Lifecycle dev pod з transcript:

| Подія | Дія |
|---|---|
| Developer відкрив сесію | Бекенд створює pod on-demand |
| SSH-сесія закрита | Pod живе grace period |
| Timeout без активності | Pod видаляється |
| Task-node переходить у `resolved` | Pod видаляється з попередженням |
