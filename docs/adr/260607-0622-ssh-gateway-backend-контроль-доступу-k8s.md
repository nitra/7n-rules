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
