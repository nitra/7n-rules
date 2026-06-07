---
session: bce336cc-aa1a-406e-9d06-59ac3091f37c
captured: 2026-06-07T06:27:14+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bce336cc-aa1a-406e-9d06-59ac3091f37c.jsonl
---

## ADR Введення Teleport як SSH gateway для доступу розробників до task-нод у Kubernetes

## Context and Problem Statement

Система `n-cursor graph` запускатиме task-вузли у Kubernetes. Розробники мають потребу підключатись до dev pods (наприклад через Zed remote SSH) для інспекції та патчингу конкретних task-нод, але вони не мають і не повинні мати прямого `kubectl`-доступу до кластера. Авторизацію (хто до якого вузла може підключитись) має контролювати бекенд-застосунок, а не k8s RBAC безпосередньо.

## Considered Options

* Teleport як identity-aware SSH gateway з label-based RBAC
* `kubectl port-forward` для прямого SSH-доступу до pod

## Decision Outcome

Chosen option: "Teleport як identity-aware SSH gateway", because `kubectl port-forward` вимагає наявного `kubectl`-доступу у розробника — що явно відхилено в сесії. Teleport дозволяє бекенду `nitra/task` контролювати права через labels (`owner: email`) без видачі kubectl-прав, а Zed підключається як до звичайного SSH через `~/.ssh/config` + `ProxyCommand tsh proxy ssh`.

### Consequences

* Good, because бекенд при створенні dev pod ставить label `owner: email` → Teleport автоматично надає доступ лише власнику вузла без ручної видачі прав.
* Good, because Teleport видає short-lived SSH-сертифікати (TTL 8–24 год) замість статичних ключів; доступ закривається автоматично після протухання cert.
* Good, because Zed не потребує жодних патчів: підключення через стандартний SSH з `ProxyCommand tsh proxy ssh --cluster=nitra %h:%p` у `~/.ssh/config`.
* Bad, because потрібно задеплоїти Teleport Auth Server + Proxy (один раз, Helm chart наявний) — додаткова операційна залежність у кластері.

## More Information

- UI-застосунок для задач: `nitra/task` (`/Users/vitaliytv/www/nitra/task`)
- Структура вузлів задач: `tasks/ui-task-view/task.md`, `tasks/coverage-skill-test/task.md`, `tasks/skills-orchestrator-migration/task.md`
- Dev pod label-схема: `task: <node-name>`, `owner: <email>`, `project: nitra-cursor`
- Teleport Role використовує динамічний шаблон `{{internal.logins}}` для прив'язки `owner` до email юзера
- Teleport Operator (k8s CRD) дозволяє бекенду декларативно реєструвати нові dev pods через `kubectl apply`
- SSO: GitHub OAuth або Google достатньо як identity provider
