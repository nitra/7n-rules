---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:27:51+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Рефакторинг B завершено. Ось що змінилось:

**Видалено** (13 lib файлів + тести): `active`, `spec`, `review`, `gate`, `commands`, `plan`, `state-store`, `flow-lock`, `level`, `capability`, `budget`, `artifact`, `planner`, `snapshot`, `reviewer`, `events`

**Нові файли:**
- `lib/flow-plan.mjs` — `flow plan`: читає task.md (`mode`/`hint`), створює numbered `plan_NNN.md` template
- `lib/flow-verify.mjs` — `flow verify`: структурний check + stdout-контекст; exit code тільки
- `lib/flow-signals.mjs` — `flow done/audit/failed/spawn`: `NCURSOR_NODE_PATH` → `graph *`

**Оновлено:** `index.mjs` (новий USAGE + handlers), `tests/index.test.mjs`, `worktree-cli.mjs` (прибрано `cleanupFlowSiblings`)

**Результат:** 97 тестів, всі green.

---

## ADR Переосмислення `n-cursor flow` під двоетапний протокол вузла

## Context and Problem Statement
Існуючий `flow`-диспетчер з 11 командами (`init`, `spec`, `plan`, `verify`, `review`, `gate`, `release`, `run`, `resume`, `cancel`, `repair`) і `.flow.json` як центральним сховищем стану не відповідав новій архітектурі автономного DAG-оркестратора (`docs/думка.MD`), де стан зберігається у файлах (`task.md`, `run_NNN.md`, `outputs_NNN.md`) і вузол виконується у git worktree через `graph run`.

## Considered Options
* Зберегти стару систему і додати нові команди поряд
* Повне переосмислення `flow` як двоетапного протоколу всередині вузла
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Повне переосмислення `flow` як двоетапного протоколу всередині вузла", because `flow` тепер є протоколом всередині одного вузла (`graph` = зовнішній оркестратор), тому старий lifecycle навколо `.flow.json` є зайвим шаром.

### Consequences
* Good, because transcript фіксує очікувану користь: `flow` зменшився з 11 до 6 команд; `.flow.json` і `docs/specs/`/`docs/plans/` зникають; стан повністю у файловій системі, самовідновний.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Видалені команди: `flow init`, `flow spec`, `flow release`, `flow review`, `flow gate`, `flow run`, `flow resume`, `flow cancel`, `flow repair`
- Нові команди: `flow plan`, `flow verify`, `flow done`, `flow audit`, `flow failed`, `flow spawn`
- Node path в worktree: `NCURSOR_NODE_PATH` env var або `.n-cursor/current-node` файл
- `npm/scripts/dispatcher/lib/flow-plan.mjs`, `flow-verify.mjs`, `flow-signals.mjs`
- Дизайн зафіксований у `docs/думка.MD` (секція "Інтеграція з `n-cursor flow`")

---

## ADR Stage 1 Planning — `flow plan` з двома режимами та `hint`

## Context and Problem Statement
Агент у worktree повинен приймати рішення: розбити вузол на підграф (composite) чи виконати самостійно (atomic). Потрібен механізм що дозволяє задати режим прийняття рішення і опціональну підказку без блокування довільної агентської поведінки.

## Considered Options
* Поле `decompose: true/false` в `task.md` (A — жорсткий приписаний тип)
* Агент вирішує повністю самостійно без підказок (B)
* Опціональний `hint: atomic|composite` + агент вирішує сам якщо поля нема (C — гібрид)

## Decision Outcome
Chosen option: "C — `hint: atomic|composite` + агент вирішує сам", because гнучкість: людина може підказати очікуваний тип, але агент не заблокований цим полем.

### Consequences
* Good, because transcript фіксує: людина задає напрям (`hint`), агент адаптується до реальних даних; `flow plan` викликає агент, не блокує автоматично.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `hint:` — опціональне поле в front-matter `task.md`; відсутність = агент вирішує сам
- `mode: human` (default) — інтерактивний діалог перед записом `plan_001.md`
- `mode: agent` — автономно, без паузи
- `flow plan` не викликає `graph spawn` автоматично (Варіант B explicit); агент викликає `flow spawn` після створення дочірніх `task.md`
- `plan_001.md` секції: `## Context`, `## Approach`, `## Risks`

---

## ADR `flow verify` як гібридний структурно-семантичний гейт

## Context and Problem Statement
Потрібна якісна перевірка виконаної роботи проти критерію `## Done when` з `task.md`. Попередня реалізація (`flow gate` + `flow review`) спиралась на `.flow.json` кроки та запускала окремий LLM-підпроцес. В новій архітектурі стан у файлах, а агент — і є виконавець і суддя.

## Considered Options
* Скрипт (детерміновано) — тільки структурні перевірки (A)
* LLM-підпроцес (семантично) — окремий `claude` процес (B)
* Гібрид: скрипт перевіряє структуру, агент оцінює семантику сам (C)

## Decision Outcome
Chosen option: "C — гібрид", because агент вже є LLM і може оцінити семантику `## Done when` самостійно без нового підпроцесу; скрипт гарантує структурні інваріанти детерміновано.

### Consequences
* Good, because transcript фіксує: немає нового LLM-субпроцесу, немає артефакту (`verify_001.md` не пишеться), агент завжди має context (`## Done when` + outputs на stdout).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `flow verify`: exit 0 = структурно OK (`outputs_NNN.md` існує і непорожній) + stdout context; exit 1 = структурна помилка
- Після виклику агент сам вирішує: `flow done` | `flow audit` | `flow failed`
- Семантична оцінка — сам виконавець-агент, не `flow verify`
- `npm/scripts/dispatcher/lib/flow-verify.mjs`

---

## ADR Аудит через async-чергу з numbered `pending-audit_NNN.md`

## Context and Problem Statement
Агент може завершити роботу впевнено (`done`) або з сумнівом (`audit`). У другому випадку потрібен механізм зовнішнього аудиту, який не блокує агента і не вимагає синхронного запуску аудитора.

## Considered Options
* Синхронний аудит (wrapper одразу запускає аудитора після `graph audit`)
* Async черга через файлову систему (`pending-audit_NNN.md`), оброблювана `n-cursor watch`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Async черга через `pending-audit_NNN.md`", because `n-cursor watch` вже є демоном, сканування файлів = zero overhead, immutable-нумерація зберігає зв'язок audit↔outputs.

### Consequences
* Good, because transcript фіксує: NNN в `pending-audit_NNN.md` завжди = NNN відповідного `outputs_NNN.md`; ім'я файлу є посиланням (явний `ref:` не обов'язковий); до 3 failed-циклів до ескалації людині.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `pending-audit_NNN.md` — numbered, immutable; front-matter: `created_at`, `outputs_ref`, `actor`
- Відповідність: `outputs_002.md` → `pending-audit_002.md`
- `flow audit` команда в `npm/scripts/dispatcher/lib/flow-signals.mjs`
- `n-cursor watch` dispatches auditor; ліміт: 3 поспіль `actor: auditor, result: failed` → ескалація

---

## ADR `flow`-рівневі сигнали як обгортки над `graph`-командами

## Context and Problem Statement
Агент всередині worktree має сигналізувати оркестратору про результат (`done`, `audit`, `failed`, `spawn`), але не знає свого абсолютного шляху в DAG — знає лише що запущений у певному worktree.

## Considered Options
* Агент викликає `graph done <path>` напряму (потребує знання шляху)
* `flow done/audit/failed/spawn` обчислюють path з CWD (з `NCURSOR_NODE_PATH` env або `.n-cursor/current-node` файлу) і делегують у `graph *`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`flow`-рівневі сигнали як обгортки", because агент всередині вузла ніколи не знає свій абсолютний path; wrapper встановлює `NCURSOR_NODE_PATH` при запуску агента, `flow` читає env і делегує.

### Consequences
* Good, because transcript фіксує: чисте розділення шарів — `flow` = inside-node protocol, `graph` = outside orchestrator; агент ніколи не звертається до `graph *` напряму.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `NCURSOR_NODE_PATH` env var встановлюється wrapper-скриптом (`graph run`)
- Fallback: файл `.n-cursor/current-node` у корені worktree
- `npm/scripts/dispatcher/lib/flow-signals.mjs`: `done()`, `audit()`, `failed()`, `spawn()`
- `flow audit` додатково створює `pending-audit_NNN.md` перед делегуванням
