---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:36:08+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Ліквідація namespace `flow` та уніфікація у `graph`

## Context and Problem Statement

У системі існували два CLI-просторів: `n-cursor flow` (Пасивний Турнікет + Активний Раннер) і `n-cursor graph` (DAG-оркестратор). Архітектура думка.MD введена нова модель де граф є зовнішнім оркестратором, а протокол всередині вузла є лише плануванням + виконанням. Поділ на два namespace породжував дублювання: `flow run` і `graph run` ескалювали одне завдання, `flow cancel` дублював `graph kill`, `.flow.json` конфліктував з `task.md` як джерелом істини.

## Considered Options

* Залишити `flow` і `graph` паралельно зі спільним станом через `task.md`
* Ліквідувати `flow` повністю: перемістити `flow plan` → `graph plan`, видалити `flow init/spec/verify/release/run/resume/cancel/repair`

## Decision Outcome

Chosen option: "Ліквідувати `flow` повністю", because наявність двох namespace при єдиному джерелі стану (`task.md`) породжує концептуальну плутанину і race conditions; `graph` охоплює весь lifecycle вузла.

### Consequences

* Good, because transcript фіксує очікувану користь: єдина точка входу `n-cursor graph`, без дублювання команд, без `.flow.json`.
* Bad, because `n-cursor flow` видаляється разом з `flow run/resume/cancel/repair` — потребує міграції або видалення всіх залежностей у `.cursor/rules/n-flow.mdc`, `dispatcher/index.mjs`, `dispatcher/lib/`.

## More Information

Видалені команди та їх замінники:

| Видалено | Замінник |
|---|---|
| `flow init` | `graph run` створює worktree |
| `flow spec` | поглинено в `graph plan` |
| `flow plan` | `graph plan` |
| `flow verify` | видалено (замінено audit-чергою) |
| `flow release` | `graph done` |
| `flow review` | видалено (замінено аудитором з черги) |
| `flow gate` | видалено |
| `flow run/resume/cancel/repair` | `graph run / graph kill` |

---

## ADR Двофазне виконання вузла: `graph plan` + виконання

## Context and Problem Statement

Агент у worktree виконував планування і реалізацію в одному потоці без явних контрольних точок. Це унеможливлювало людський review між декомпозицією і виконанням, і не розрізняло атомарний від composite сценарію.

## Considered Options

* Єдина фаза: агент планує і виконує без зупинки
* Дві фази: Stage 1 (`graph plan`) → Stage 2 (виконання), розділені артефактами

## Decision Outcome

Chosen option: "Дві фази", because поділ дозволяє людині переглянути план до початку реалізації (через `mode: human`), і чітко відрізняє composite-розклад від атомарного виконання.

### Consequences

* Good, because `mode: human` (default) дозволяє людині затвердити план до виконання; composite шлях завершується на Stage 1 без зайвого виконання.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Артефакти Stage 1:
- Атомарний шлях: `plan_001.md` (numbered, immutable) — numbered незалежно від `run_NNN.md`
- Composite шлях: дочірні `task.md` → агент явно викликає `graph spawn <path>`

`task.md` front-matter:
```yaml
mode: human   # default — діалог з людиною
# або
mode: agent   # автономно
```

`graph plan` замінює обидві колишні команди `flow spec` (brainstorm, панель персон) і `flow plan` (декомпозиція).

---

## ADR Async аудит-черга замість синхронної самоперевірки

## Context and Problem Statement

`flow verify` (гібрид: скрипт + LLM) перевіряв `## Done when` перед сигналом завершення. Це вимагало або subprocess-запуску LLM всередині wrapper-скрипту, або дублювання семантичної перевірки між самим агентом і окремим процесом. `flow review` (adversarial diff-review) і `flow gate` також перевіряли якість, але синхронно і в тому ж потоці.

## Considered Options

* Залишити `flow verify` як гібридний синхронний гейт (скрипт + LLM subprocess)
* Видалити самоперевірку; якісний гейт — виключно зовнішній аудитор з async черги

## Decision Outcome

Chosen option: "Видалити самоперевірку; виключно аудит з черги", because аудитор як окремий агент з власним контекстом дає кращу ізоляцію ніж самоперевірка; `flow verify`, `flow review`, `flow gate` — три окремих механізми що перевіряли одне й те ж.

### Consequences

* Good, because transcript фіксує очікувану користь: спрощення протоколу вузла, єдиний якісний гейт, аудитор незалежний від виконавця.
* Bad, because агент не має зворотного зв'язку до `graph done/audit` — він мусить сам вирішити чи потрібен аудит (без синхронної підказки).

## More Information

Завершення атомарного вузла:
```
agent writes outputs_NNN.md
→ graph done            ← впевнений, merge
→ graph audit <path>    ← хоче зовнішній review → pending-audit_NNN.md → черга
```

`n-cursor watch` + post-merge hook сканує `pending-audit_NNN.md` і dispatches auditor-агент.

---

## ADR Стан composite вузла як агрегація дочірніх станів

## Context and Problem Statement

Composite вузол (той що викликав `graph spawn` і має дочірні `task.md`) ніколи не пише `outputs_NNN.md` — він тільки декомпозується. Але всі стани вузла були визначені через присутність файлів. Виникала ситуація де composite вузол у стані `waiting` (є тільки `task.md` + `plan_001.md`) навіть коли всі його діти `resolved`.

## Considered Options

* Roll-up агент: оркестратор запускає батька знову і агент пише `outputs_001.md` з `ref:` на виходи дітей
* Implicit: оркестратор деривує стан батька з дітей — `outputs_NNN.md` не потрібен для composite

## Decision Outcome

Chosen option: "Implicit агрегація", because composite вузол є суто структурним — його стан це і є стан графу; примусовий roll-up агент додає зайву складність без нової цінності.

### Consequences

* Good, because transcript фіксує очікувану користь: стан деривується автоматично, без зайвих файлів і процесів.
* Bad, because сканер мусить розрізняти атомарні і composite вузли та рекурсивно обходити ієрархію знизу вверх.

## More Information

Правила агрегації composite вузла:

| Стан дітей | Стан батька |
|---|---|
| всі `resolved` | `resolved` |
| є `running` або `pending-audit` | `running` |
| є `failed`, немає `running` | `failed` |
| є `waiting`, немає `failed`/`running` | `waiting` |
| `invalidated` файл у батька | `invalidated` (cascade) |

Атомарний вузол = немає дочірніх директорій з `task.md`. Composite = є хоча б одна.

---

## ADR Нумерація `pending-audit_NNN.md` відповідає `outputs_NNN.md`

## Context and Problem Statement

Агент може робити кілька спроб: `outputs_001.md` → аудит відхилено → `outputs_002.md` → аудит прийнято. Потрібен чіткий зв'язок між конкретною версією виходу і відповідним запитом аудиту. Зберігати `ref:` поле у front-matter або використовувати окремий лічильник — ускладнювало б читання стану.

## Considered Options

* Numbered незалежно: `pending-audit_001.md`, `pending-audit_002.md` — власний лічильник
* NNN дзеркалює `outputs_NNN.md`: ім'я файлу саме є посиланням

## Decision Outcome

Chosen option: "NNN дзеркалює `outputs_NNN.md`", because ім'я файлу `pending-audit_003.md` однозначно вказує на `outputs_003.md` без додаткових полів; `ref:` у front-matter стає надлишковим.

### Consequences

* Good, because transcript фіксує очікувану користь: стан аудиту читається зі scan без парсингу front-matter.
* Bad, because агент мусить знати номер свого outputs при виклику `graph audit` — не може просто `graph audit <path>` з автоматичним найновішим.

## More Information

Типовий lifecycle нумерації у вузлі:
```
outputs_001.md          ← агент завершив першу спробу
pending-audit_001.md    ← graph audit (NNN з outputs)
run_001.md  (actor: agent,   result: success)
run_002.md  (actor: auditor, result: failed, audit_ref: pending-audit_001.md)
outputs_002.md
pending-audit_002.md
run_003.md  (actor: auditor, result: success, audit_ref: pending-audit_002.md)
```

---

## ADR Поле `audit_ref` у `run_NNN.md` аудитора для детекції обробленого аудиту

## Context and Problem Statement

`pending-audit_NNN.md` — immutable файл, він залишається після обробки. Оркестратор при повторному скані бачить `pending-audit_NNN.md` і не знає: вже оброблено чи ще чекає. Без явного зв'язку між запитом і результатом можливе подвійне призначення аудитора.

## Considered Options

* За timestamp: порівнювати `created_at` `pending-audit_NNN.md` і `run_*.md (actor: auditor)`
* Вирівнювання NNN: аудитор пише `audit-result_NNN.md` (окремий тип), NNN = NNN запиту
* `audit_ref` у front-matter аудиторського `run_NNN.md`: явне поле `audit_ref: pending-audit_002.md`

## Decision Outcome

Chosen option: "`audit_ref` у `run_NNN.md`", because явна вказівка надійніша ніж timestamp (clock skew, batch runs) і не вводить новий тип файлу.

### Consequences

* Good, because однозначний зв'язок запит→результат без додаткових файлів; оркестратор знаходить оброблений аудит за O(1) пошуком по `audit_ref`.
* Bad, because аудиторський `run_NNN.md` має обов'язкове поле `audit_ref` — порушення контракту без нього непомітне і спричиняє повторний dispatch.

## More Information

Front-matter аудиторського `run_NNN.md`:
```yaml
---
created_at: 2026-06-07T11:00:00Z
actor: auditor
result: success   # або failed
audit_ref: pending-audit_002.md
---
```

Оркестратор: `pending-audit_NNN.md` вважається обробленим якщо існує будь-який `run_*.md` з `audit_ref: pending-audit_NNN.md`.
