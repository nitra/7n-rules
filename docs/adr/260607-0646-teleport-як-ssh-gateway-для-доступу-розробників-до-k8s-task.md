---
session: bce336cc-aa1a-406e-9d06-59ac3091f37c
captured: 2026-06-07T06:46:31+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bce336cc-aa1a-406e-9d06-59ac3091f37c.jsonl
---

## ADR Teleport як SSH gateway для доступу розробників до k8s task pods

## Context and Problem Statement
Розробники потребують SSH-доступу до dev pods у k8s де живуть `tasks/` вузли, але не мають прав `kubectl`. Бекенд повинен контролювати авторизацію — хто і до якого task-node може підключитись.

## Considered Options
* `kubectl port-forward` з SSH-сервером у поді
* Власний SSH gateway з кастомною auth-логікою
* Teleport (identity-aware SSH proxy з RBAC, SSO, audit log)

## Decision Outcome
Chosen option: "Teleport", because `kubectl port-forward` вимагає прав у розробника що є порушенням вимоги; власний gateway можливий але потребує суттєвого обсягу реалізації (сертифікати, audit, SSO); Teleport вирішує всі вимоги з коробки — бекенд ставить `owner: email` label на dev pod, Teleport RBAC динамічно обмежує доступ без ручної видачі прав.

### Consequences
* Good, because розробник не має `kubectl`-доступу — авторизація повністю контролюється бекендом через Teleport RBAC labels.
* Good, because короткоживучі SSH-сертифікати (TTL 8–24 год) виключають управління статичними ключами; після закінчення TTL доступ автоматично закривається.
* Good, because Zed, VS Code і Cursor підключаються через стандартний `~/.ssh/config` з `ProxyCommand tsh proxy ssh` — жодних патчів до редакторів.
* Bad, because потрібно один раз задеплоїти Teleport Auth Server + Proxy Server у кластер (Helm chart є, але це додатковий операційний компонент).

## More Information
Конфіг `~/.ssh/config` для розробника:
```
Host *.teleport.nitra.com
ProxyCommand tsh proxy ssh --cluster=nitra %h:%p
User dev
```
Teleport Role приклад із динамічним label:
```yaml
spec:
allow:
node_labels:
owner: "{{internal.logins}}"
```
Файл задачі: `nitra/task/tasks/open-in-zed/task.md`

---

## ADR On-demand spawning dev pods при запиті розробника

## Context and Problem Statement
Розробники звертаються до конкретних task-nodes для інспекції або патчу `task.md` / `run_*.md`. Тримати постійно запущені pods для кожного вузла — надмірно; потрібна модель де pod з'являється лише коли він потрібний.

## Considered Options
* Постійно запущені dev pods (по одному на task-node)
* On-demand spawning: pod створюється бекендом при запиті, видаляється після неактивності

## Decision Outcome
Chosen option: "On-demand spawning", because це паттерн GitPod / GitHub Codespaces — бекенд `nitra/task` отримує запит із UI, перевіряє права, виконує `kubectl apply` з labels `task=X, owner=email`, чекає `pod Ready` (~5–15 с), після чого Teleport node-agent у поді реєструється автоматично і бекенд повертає connection string розробнику.

### Consequences
* Good, because transcript фіксує очікувану користь: pods не споживають ресурси коли ніхто не працює з task-node.
* Good, because бекенд є єдиною точкою контролю lifecycle — spawn, grace period, timeout, видалення при переході task у `resolved`.
* Bad, because transcript не містить підтверджених негативних наслідків щодо cold-start latency (~5–15 с на spawn), але це потенційна UX-затримка.

## More Information
Lifecycle таблиця із transcript:
| Подія | Дія |
|---|---|
| Developer відкрив сесію | pod spawn |
| SSH-сесія закрита | pod живе ще N хвилин (grace period) |
| Timeout без активності | pod видаляється |
| Task-node → `resolved` | pod видаляється з попередженням |

Pod монтує `tasks-pvc` де живуть реальні `run_NNN.md`, `outputs_NNN.md` — розробник бачить актуальний стан DAG.
Файл задачі: `nitra/task/tasks/open-in-zed/task.md`

---

## ADR Підтримка кількох редакторів через URI deep link у кнопці "Open in editor"

## Context and Problem Statement
UI `nitra/task` повинен дозволити розробнику одним кліком відкрити task-node у редакторі. Різні розробники використовують різні редактори (Zed, VS Code, Cursor); підхід має бути однаковим для всіх де можливо.

## Considered Options
* Підтримка тільки Zed (SSH hostname вручну)
* Підтримка VS Code + Cursor через `vscode://` / `cursor://` URI, Zed — через copy hostname

## Decision Outcome
Chosen option: "VS Code + Cursor через URI deep link, Zed через copy hostname", because VS Code і Cursor підтримують `vscode-remote` URI-протокол що дозволяє браузеру автоматично відкрити редактор з підключенням; Zed наразі не має аналогічного URI-протоколу тому для нього єдиний варіант — скопіювати hostname.

### Consequences
* Good, because transcript фіксує очікувану користь: для VS Code і Cursor — zero-step UX (один клік відкриває редактор і підключає).
* Bad, because Zed потребує ручного кроку (copy hostname + вставити у діалог); transcript відзначає це як поточне обмеження Zed.
* Neutral, because перейменування задачі з `open-in-zed` на `open-in-editor` — transcript не містить підтвердження що перейменування було виконано.

## More Information
URI формат:
```
# VS Code
vscode://vscode-remote/ssh-remote+<hostname>.teleport.nitra.com/tasks

# Cursor
cursor://vscode-remote/ssh-remote+<hostname>.teleport.nitra.com/tasks
```
Всі три редактори використовують однаковий `~/.ssh/config` з Teleport `ProxyCommand`.
Файл задачі: `nitra/task/tasks/open-in-zed/task.md`
