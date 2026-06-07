---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:40:59+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Чітка картина. Working tree вже має **частково** реалізований bridge-стан (`flow` перепридумали але ще не видалили). Наш план іде далі — `flow` зникає повністю.

Ось поетапний план, скоригований на реальний стан:

---

## План реалізації

**Поточний стан:** `dispatcher/index.mjs` вже оновлено (flow → graph-delegate), але `case 'flow':` ще в CLI, а `flow-*.mjs` модулі ще є як untracked файли.

---

### Фаза 1 — Cleanup (видалити flow)
Видалити: `dispatcher/index.mjs`, `dispatcher/lib/flow-plan.mjs`, `flow-verify.mjs`, `flow-signals.mjs`, `flow-resolve.mjs`, `executor.mjs`, `plan-panel.mjs` + відповідні тести. Оновити `n-cursor.js` — прибрати `case 'flow':`.

### Фаза 2 — Core graph modules
Нові файли: `graph/config.mjs`, `graph/scan.mjs`, `graph/node-state.mjs`, `graph/signals.mjs`, `graph/invalidate.mjs`, `graph/runner.mjs` + тести для кожного.

### Фаза 3 — `graph plan`
Нові файли: `graph/plan.mjs`, `graph/setup.mjs`, `graph/init.mjs` + тести.

### Фаза 4 — `graph run` wrapper
Нові файли: `graph/worktree-ops.mjs`, `graph/run.mjs` + тести.

### Фаза 5 — `graph run --auto` + `graph kill`
Нові файли: `graph/auto.mjs`, `graph/kill.mjs` + тести.

### Фаза 6 — `n-cursor watch`
Нові файли: `graph/watch.mjs`, `graph/telegram.mjs` + тести.

### Фаза 7 — CLI routing
Новий файл `graph/index.mjs`. Оновлення `n-cursor.js` — нові `case 'graph'` і `case 'watch'`.

---

**Правила per file:** кожен `.mjs` з логікою → свій `tests/*.test.mjs`, FS через `deps`-ін'єкцію, без реального диска в unit-тестах.

Починаємо з Фази 1?

---

The transcript ends here.

Проаналізуй сесію і зафіксуй ключові архітектурні рішення як ADR.
</thinking>

На основі transcript фіксую ключові архітектурні рішення.

## ADR Видалення `n-cursor flow` і перехід до єдиного `n-cursor graph`

## Context and Problem Statement
Система `n-cursor flow` (Пасивний Турнікет + Активний Раннер) створювала дублювання з новою autonomous DAG-архітектурою (`docs/думка.MD`). Команди `flow init/spec/plan/verify/gate/review/release/run/resume/cancel/repair` частково перекривали функціонал `graph run`, `graph plan` та аудит-черги, а `flow` як namespace ставав надлишковим після того, як `flow plan` став єдиною залишеною командою.

## Considered Options
* Залишити `flow` namespace з `flow plan` як єдиною командою
* Перейменувати `flow plan` → `graph plan` і видалити `flow` повністю

## Decision Outcome
Chosen option: "Перейменувати `flow plan` → `graph plan` і видалити `flow` повністю", because якщо в `flow` залишається лише одна команда, namespace стає надлишковим — `graph` вже є єдиним інтерфейсом для всієї DAG-архітектури.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка входу `n-cursor graph` для всього циклу виконання вузла.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені команди: `flow init`, `flow spec`, `flow plan`, `flow verify`, `flow gate`, `flow review`, `flow release`, `flow run`, `flow resume`, `flow cancel`, `flow repair`. Файли: `dispatcher/index.mjs`, `dispatcher/lib/flow-plan.mjs`, `flow-verify.mjs`, `flow-signals.mjs`, `flow-resolve.mjs`, `executor.mjs`, `plan-panel.mjs`. Нові: `graph/plan.mjs` (Stage 1).

---

## ADR Двоетапний протокол виконання вузла: `graph plan` + сигнали агента

## Context and Problem Statement
Autonomous агент всередині worktree потребував структурованого протоколу: спочатку визначити чи задача атомарна або складена (Stage 1), потім виконати роботу і сигналізувати результат (Stage 2). Без цього поділу агент не мав чіткого контракту для декомпозиції.

## Considered Options
* Два кроки: `flow spec` (дизайн) → `flow plan` (декомпозиція)
* Один крок: `graph plan` (spec + decompose разом)

## Decision Outcome
Chosen option: "Один крок: `graph plan` (spec + decompose разом)", because людина може зупинити процес після перегляду плану, але не потребує окремої команди для цього.

### Consequences
* Good, because transcript фіксує очікувану користь: простіший протокол агента — менше станів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`graph plan` → атомарний шлях: `plan_001.md` (numbered, immutable; секції: `## Context`, `## Approach`, `## Risks`). Composite шлях: дочірні `task.md` → агент явно викликає `graph spawn`. `mode: human` (default) або `mode: agent` у front-matter `task.md`. Stage 2: агент пише `outputs_NNN.md` → `graph done | graph audit | graph failed`.

---

## ADR Асинхронна аудит-черга через `pending-audit_NNN.md`

## Context and Problem Statement
`flow review` і `flow gate` були синхронними і прив'язаними до конкретного запуску. Нова архітектура потребувала асинхронної зовнішньої перевірки: агент сигналізує готовність до аудиту, а окремий процес обробляє його незалежно від основного потоку виконання.

## Considered Options
* Синхронний `flow review` (запускається агентом перед merge)
* Асинхронна черга через `pending-audit_NNN.md` + окремий auditor wrapper

## Decision Outcome
Chosen option: "Асинхронна черга через `pending-audit_NNN.md` + окремий auditor wrapper", because аудит може займати довільний час і повинен виконуватись незалежним актором, а не блокувати агента-виконавця.

### Consequences
* Good, because transcript фіксує очікувану користь: аудит відокремлений від виконання, підтримує різні моделі (дешевша `audit_model`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`pending-audit_NNN.md` — NNN збігається з NNN відповідного `outputs_NNN.md` (filename = implicit ref). Оброблено якщо: ∃ `run_M.md` з `actor: auditor` і `run_M.created_at > pending-audit_NNN.created_at`. `graph run --actor auditor` = wrapper — spawns auditor subprocess, merge on success. Ліміт: ≥ 3 failed audit-циклів → Telegram ескалація. Конфіг: `audit_timeout_sec` у `task.md` або `.n-cursor-override.json`; `escalation_blacklist: ["pending-audit"]` для довгих задач.

---

## ADR Розділення оркестратора і монітора: `graph run --auto` vs `n-cursor watch`

## Context and Problem Statement
Два процеси (`graph run --auto` і `n-cursor watch`) могли б одночасно сканувати граф і запускати вузли, що призводить до race condition — один вузол запускається двічі.

## Considered Options
* Обидва сканують і запускають (з file lock `running.lock` як mutex)
* `git worktree add` як atomic mutex (провал = вузол вже запущено)
* Єдиний запускальник `graph run --auto`; `n-cursor watch` тільки моніторить

## Decision Outcome
Chosen option: "Єдиний запускальник `graph run --auto`; `n-cursor watch` тільки моніторить", because усунення race condition через архітектурне розділення відповідальностей надійніше за будь-який mutex.

### Consequences
* Good, because transcript фіксує очікувану користь: race condition відсутній за визначенням.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
post-merge hook → `graph run --auto` (one-shot). `n-cursor watch` (daemon): Telegram-ескалація при stale worktree, budget exhausted, ≥ 3 failed audits, pending-audit timeout, graph blocked. Per-node override: `.n-cursor-override.json` → `audit_timeout_sec`, `escalation_blacklist`.

---

## ADR Implicit resolved-стан composite вузла (без `outputs_NNN.md`)

## Context and Problem Statement
Composite вузол після `graph spawn` ніколи не пише `outputs_NNN.md` — він делегує роботу дочірнім вузлам. При цьому стан `resolved` у системі визначався наявністю `outputs_NNN.md`, що унеможливлювало resolved-стан для composite.

## Considered Options
* Roll-up run: оркестратор запускає батьківський вузол знову після `children-resolved` → батько пише `outputs_NNN.md`
* Implicit aggregation: composite resolved = всі дочірні resolved (без файлу у батька)
* Останній merge тригерить автоматичний запис `outputs_NNN.md` батька

## Decision Outcome
Chosen option: "Implicit aggregation: composite resolved = всі дочірні resolved (без файлу у батька)", because стан composite вузла є агрегацією дочірніх — батько не виробляє власних outputs, він є контейнером.

### Consequences
* Good, because transcript фіксує очікувану користь: відсутність додаткового roll-up запуску спрощує оркестрацію.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Composite визначається по `plan_001.md` → `decision: composite`. State derivation: всі діти `resolved` → батько `resolved`; є `running`/`pending-audit` → батько `running`; є `failed` без `running` → батько `failed`. Сканер обходить рекурсивно знизу вверх. Файли: `docs/думка.MD` (секція "Стани вузла").
