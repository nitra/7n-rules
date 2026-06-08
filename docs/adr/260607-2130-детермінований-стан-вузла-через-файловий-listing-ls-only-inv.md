---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T21:30:26+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## Ризик №1 — Кількість worktrees і disk saturation

### Опис

Кожен активний вузол займає окремий git worktree. Worktree = повна копія робочого дерева репозиторія (всі файли, не тільки зміни). При великих репозиторіях — кожен worktree може важити сотні MB.

`graph run --auto` запускає всі ready вузли паралельно через `mkdir lock`. Немає вбудованого ліміту кількості одночасних worktrees.

### Конкретний сценарій

```
Репозиторій: 500MB (код + assets + node_modules через symlinks)
Граф: 50 ready вузлів після deps resolution

graph run --auto:
→ mkdir .worktrees/node-01-deadline/  ← 500MB
→ mkdir .worktrees/node-02-deadline/  ← 500MB
→ ...
→ mkdir .worktrees/node-50-deadline/  ← 500MB

Разом: 50 × 500MB = 25GB disk за ~30 секунд
MacBook Pro 512GB SSD: 25GB для worktrees alone
Якщо в репо є large binary assets або MLmodels → ще гірше
```

Крім disk — паралельні агенти одночасно пишуть файли, запускають компілятори, linters, тести. CPU і IO saturation на звичайному dev-ноутбуці. Якщо `budget_hard_sec = 3600` і 50 агентів одночасно — система може стати некерованою.

Друга проблема: git worktrees мають overhead на рівні `.git/worktrees/` — кожен реєструється у git index. Багато worktrees уповільнює `git status`, `git log`, навіть `git add` у основному репозиторії.

### Потенційне вирішення

**Варіант A — `max_worktrees` у конфігурації + back-pressure queue**

```json
// .n-cursor.json
{
"max_worktrees": 5,
"queue_strategy": "fifo"
}
```

`graph run --auto` запускає максимум N вузлів паралельно. Решта — у черзі. Коли один завершується → наступний стартує. Back-pressure природна.

**Варіант B — Shallow worktree (тільки tracked files, без node_modules)**

```bash
git worktree add --no-checkout .worktrees/node-01/
git -C .worktrees/node-01/ checkout HEAD -- src/ package.json
```

Worktree містить тільки файли потрібні для задачі, не весь репозиторій. Агент сам вирішує що йому потрібно (або orchestrator на основі `task.md`).

Складніше в реалізації, але worktree може важити 10MB замість 500MB.

**Варіант C — Worktree sharing між вузлами одного composite**

Дочірні вузли одного composite sharing один worktree (різні branch або subdirectory). Зменшує кількість worktrees, але ускладнює ізоляцію — вузли можуть конфліктувати.

**Рекомендую Варіант A** — `max_worktrees` + FIFO queue. Найпростіше в реалізації, передбачувана поведінка, не потребує змін в git або worktree протоколі. Default: `max_worktrees: 4` (залишає ресурси для основного середовища). Значення налаштовується per-machine або per-project. Черга nature — `graph scan` при кожному тіку підхоплює наступний ready вузол після завершення попереднього.

---

Готовий до **Ризику №2**?
[user]
А зафіксовано переходимо до ризику №2
[assistant]
## Ризик №2 — Каскадна інвалідація кореня

### Опис

`invalidated` стан поширюється: якщо вузол-батько інвалідований — всі його нащадки теж мають бути інвалідовані (їх результати засновані на недійсних даних). Якщо кореневий вузол або вузол з багатьма залежними отримує `invalidated` — весь або більша частина графу скидається. Весь накопичений прогрес втрачається, budget витрачається на повторні run.

### Конкретний сценарій

```
tasks/
data-pipeline/                 ← composite, корінь
collect-raw/                 ← resolved (fact_001.md, 2 год роботи)
clean-data/                  ← resolved (fact_001.md, 1 год, deps: collect-raw)
normalize/                   ← resolved (fact_001.md, 1 год, deps: clean-data)
train-model/                 ← resolved (fact_001.md, 4 год, deps: normalize)
evaluate/                    ← resolved (fact_001.md, 30 хв, deps: train-model)
generate-report/             ← resolved (fact_001.md, deps: evaluate)

Аудитор перевіряє collect-raw → FAIL (дані були некоректними)
→ Вада №6 (А): audit-result FAIL → пише invalidated у collect-raw

collect-raw invalidated →
clean-data deps: collect-raw → resolved → тепер deps NOT resolved
normalize deps: clean-data → теж
train-model deps: normalize → теж
evaluate deps: train-model → теж
generate-report deps: evaluate → теж

Весь граф: 8.5 годин роботи скасовано.
Всі 6 вузлів мають повторити повний цикл.
```

Два окремі проблеми всередині ризику:

**1. Propagation не автоматична** — специфікація не описує хто і коли propagate `invalidated` до залежних вузлів. Якщо orchestrator не виконує propagation — `clean-data` залишається `resolved` хоча його вхідні дані змінились. Тихий баг: граф завершується з некоректними результатами.

**2. Propagation занадто агресивна** — якщо `invalidated` автоматично каскадується — весь граф скидається при будь-якій помилці в основі. Немає часткового відновлення.

### Потенційне вирішення

**Варіант A — Propagation тільки до прямих залежних (shallow)**

`invalidated` у вузлі X → orchestrator знаходить всі вузли що мають `deps/X.md` → їм ставить `invalidated`.

Але тільки один рівень. Чи propagate далі — вирішує людина або explicit `graph invalidate --deep`.

Контролює cascading, але може залишити граф у несумісному стані якщо shallow недостатньо.

**Варіант B — Differential invalidation: тільки якщо outputs змінились**

При `invalidated` → re-run → новий `fact_NNN.md`. Orchestrator порівнює новий факт зі старим (hash або semantic diff). Якщо результат ідентичний — залежні вузли не інвалідуються.

Складна реалізація, потребує content comparison. Але найефективніша: половина графу може пережити re-run кореня без змін.

**Варіант C — `invalidation_scope` у `task.md`**

```yaml
invalidation_scope: shallow | deep | none
```

Per-node конфігурація: деякі вузли детерміновані (ті самі inputs → той самий output) → `invalidation_scope: none`. Деякі критичні → `deep`. Default: `shallow`.

**Варіант D — Manual propagation через `graph invalidate --cascade`**

Автоматичного каскаду немає. Інженер вирішує явно: `graph invalidate --cascade tasks/collect-raw/`. Граф не інвалідується без явного рішення.

**Рекомендую Варіант D + B як roadmap** — почати з ручного `graph invalidate --cascade` (простіше, менше ризику тихих помилок від автоматики). Додати differential invalidation (Варіант B) як оптимізацію у v2 коли є реальні дані про частоту змін outputs. Ручне управління примушує людину думати про scope інвалідації — це feature, не bug, при складних графах де ціна re-run висока.

---

Готовий до **Ризику №3**?
[user]
D зафіксовано переходимо до ризику №3
[assistant]
## Ризик №3 — LLM non-determinism у composite planning

### Опис

Коли агент виконує Stage 1 для composite вузла — він пише `plan_NNN.md` з `decision: composite` і одночасно створює дочірні вузли зі своєю структурою. Ця структура повністю визначається LLM в момент виконання — оркестратор "не втручається".

LLM недетерміновані. Той самий `task.md` при різних запусках може дати різну декомпозицію: різна кількість дочірніх вузлів, різні назви, різна топологія deps.

### Конкретний сценарій

```
tasks/implement-auth/task.md:
## Task: Реалізувати систему автентифікації

Run 1 (після graph kill та re-plan):
plan_002.md: decision: composite
→ implement-auth/
jwt-service/
session-store/
middleware/
tests/

Run 2 (після ще одного graph kill):
plan_003.md: decision: composite
→ implement-auth/
token-manager/        ← інша назва
cache-layer/          ← новий вузол
auth-middleware/      ← merge двох попередніх
```

Після першого run залишились артефакти: `jwt-service/run_001.md`, `session-store/fact_001.md` (частково resolved). Після re-plan з'явилась нова структура де `session-store` — зник, `cache-layer` — новий.

`session-store/fact_001.md` — залишається в файловій системі. Orchestrator при скані знаходить директорію з `task.md` і `fact_001.md` → вузол `resolved`. Але в новому `plan_003.md` цей вузол не згадується. Orphan resolved вузол — виконана робота що нікому не потрібна, але займає місце і плутає scan.

Більш небезпечний варіант: новий вузол `cache-layer` має `deps/session-store.md` — але `session-store` з попереднього плану вже resolved. Orchestrator вважає dep resolved. Але `cache-layer` у плані 2 мав інші очікування від session store ніж план 1 написав у fact. Семантична несумісність без помилки.

### Потенційне вирішення

**Варіант A — `graph kill` видаляє дочірні вузли (повний reset піддерева)**

При `graph kill tasks/implement-auth/`:
- Видаляє всі `plan_*.md` з `implement-auth/`
- Рекурсивно видаляє всі дочірні директорії які не мають зовнішніх залежностей

Чиста slate для нового plan. Мінус: вся виконана робота дочірніх вузлів — втрачена. Агресивно але передбачувано.

**Варіант B — "Pin plan" механізм**

Після успішного composite planning людина виконує `graph pin tasks/implement-auth/`. Система фіксує поточну топологію. Повторний `graph plan` не може змінити структуру — тільки оновити budget або деталі всередині вже існуючих вузлів.

Топологія стабільна, LLM не може "переосмислити" структуру без явного `graph unpin`.

**Варіант C — Структура composite описана у `task.md` людиною**

Для критичних composite вузлів — людина прописує очікувану структуру у `## Structure` секції `task.md`. Агент при planning зобов'язаний слідувати цій структурі. LLM свобода тільки там де структура не вказана.

```markdown
## Structure (optional)
- jwt-service: JWT token generation and validation
- session-store: Redis-backed session management
- middleware: Express middleware integration
```

**Рекомендую Варіант B** — `graph pin` після першого успішного planning. Відповідає реальному workflow: спочатку агент пропонує структуру, людина погоджується (або виправляє), потім фіксує. Re-run не змінює структуру. `graph kill` без `--unpin` — скидає тільки плани і результати, не топологію. Це додає один explicit крок у workflow але захищає від тихого переосмислення структури при кожному re-run.

---

Готовий до **Ризику №4**?
[user]
В зафіксовано переходимо до ризику №4
[assistant]
## Ризик №4 — Clock skew на distributed FS

### Опис

`running_<pid>_until_<ts>` — deadline у назві файлу. Логіка визначення стану:

```
stalled = running_until_<ts> EXISTS AND ts ≤ now()
running = running_until_<ts> EXISTS AND ts > now()
```

`now()` береться на машині яка виконує `graph scan` або `n-cursor watch`. Файл створювався на машині яка запускала wrapper.

Якщо це різні машини (або навіть та сама машина з NTP drift) — `now()` може відрізнятись від реального `now()` в момент створення файлу.

### Конкретний сценарій

```
Distributed setup:
machine-A: запускає wrapper → пише running_<pid>_until_1749200400
(машина A: now = 1749196800, deadline = now + 3600)
machine-B: запускає watch → перевіряє ts ≤ now()
(машина B: now = 1749200600, clock на 200 сек вперед)

Watch на machine-B:
1749200400 ≤ 1749200600 → stalled!

Але насправді:
Процес на machine-A ще має 200 секунд до deadline.
Watch вважає що вузол завис і надсилає Telegram alert.
Можливо — kill process (якщо watch має auto-kill).

False positive: живий процес вбито через clock skew.
```

Менш небезпечний але частіший варіант — той самий MacBook з NTP resync:

```
Wrapper пише файл: now=T, deadline=T+3600
NTP resync через годину: системний час стрибає на +30 секунд
Watch через 5 хв: now=T+3605 (через NTP), deadline=T+3600
→ T+3600 ≤ T+3605 → stalled
→ Але процес завершився 5 секунд тому нормально
→ running_until_* вже видалений wrapper'ом → false positive не виникає
```

На одній машині з нормальним NTP — skew зазвичай < 1 сек, не проблема. Реальний ризик — тільки при distributed setup або VM migration між хостами.

### Потенційне вирішення

**Варіант A — `stale_grace_sec` буфер**

```json
// .n-cursor.json
{ "stale_grace_sec": 60 }
```

Watch вважає `stalled` тільки якщо `now() > ts + grace`. 60 секунд буфер покриває NTP drift і більшість clock skew сценаріїв без додаткової складності.

**Варіант B — Timestamp у UTC + monotonic check**

Файл `running_<pid>_until_<ts>` де `ts` — unix epoch UTC. Watch порівнює з `Date.now() / 1000`. На одній машині це ідентично, на різних — залежить від синхронізації.

Не вирішує проблему але унеможливлює timezone помилки.

**Варіант C — Не вирішувати (scope обмеження)**

Специфікація явно документує: "distributed FS з різними machine clocks — не підтримується". `n-cursor` = single-machine або single-cluster з NTP. Для distributed setup — потрібен зовнішній coordinator (Redis, etcd).

**Рекомендую Варіант C + A** — явно задокументувати що distributed multi-machine setup поза scope, але додати `stale_grace_sec: 60` як захист від NTP jitter на одній машині. Не ускладнювати архітектуру для сценарію що виходить за межі цільового використання. Якщо distributed стане реальною вимогою — окремий ADR з coordinator-based рішенням.

---

Всі 4 ризики розібрані. Загальна картина:

| # | Зафіксовано |
|---|---|
| Ризик 1 | `max_worktrees: 4` + FIFO queue |
| Ризик 2 | `graph invalidate --cascade` (manual) |
| Ризик 3 | `graph pin` після першого composite planning |
| Ризик 4 | Scope: single-machine + `stale_grace_sec: 60` |

Хочеш внести всі зафіксовані рішення (по вадах і ризиках) у `docs/думка.MD`?

---

## ADR — Детермінований стан вузла через файловий listing (ls-only invariant)

## Context and Problem Statement
Дизайн `n-cursor graph` зберігає стан кожного вузла у файловій системі. Виникло питання: які стани не можна визначити без читання вмісту файлів? Аналіз показав що `human-pending` vs `waiting` неможливо розрізнити без читання `mode:` з `task.md`, а `deps`-список також потребує читання frontmatter. При великих графах це перетворюється на O(n) reads при кожному скані.

## Considered Options
* Зберегти `mode:` і `deps:` у frontmatter `task.md` (поточна схема)
* Перекодувати `mode` у назву файлу (`task_h.md` / `task_a.md`)
* `a.md` / `h.md` як mutable sentinel-файли + `deps/` директорія замість frontmatter

## Decision Outcome
Chosen option: "sentinel-файли `a.md`/`h.md` + `deps/` директорія", because це дозволяє визначити всі стани вузла виключно через `ls` без читання вмісту будь-якого файлу, при цьому `task.md` залишається стабільним (не перейменовується при зміні mode), а зміна mode = `rm h.md && touch a.md` без порушення git history.

### Consequences
* Good, because `graph scan` — O(file count), без парсингу; відновлення після збою тривіальне; зовнішні інструменти читають стан без знання протоколу.
* Bad, because кількість файлів на вузол зросла: замість одного `task.md` — `task.md` + `a.md`/`h.md` + `deps/` директорія.

## More Information
Формальний інваріант зафіксовано у `docs/думка.MD`: "всі стани визначаються виключно переліком файлів і директорій — без читання вмісту". Sentinel-файли: `a.md`, `h.md`, `invalidated`, `running_<pid>_until_<ts>` — mutable. Immutable: `task.md`, `plan_NNN.md`, `run_NNN.md`, `fact_NNN.md`, `pending-audit_NNN.md`, `audit-result_NNN.md`, файли в `deps/`.

---

## ADR — `running_<pid>_until_<ts>` як sentinel для running/stalled станів

## Context and Problem Statement
У дизайні відсутній стан "завис" (`stalled`). Вузол міг бути `running` (worktree існує) але перевищити ліміт часу, і ніде це не фіксувалось — тільки `running` → `failed` без проміжного стану. Виникло питання: як детектувати `stalled` без читання вмісту?

## Considered Options
* Implicit: watch вбиває при timeout, явного стану немає
* Sentinel файл `stalled` який пише watch
* Deadline у назві sentinel-файлу + PID для live-process detection

## Decision Outcome
Chosen option: "`running_<pid>_until_<ts>`", because deadline і PID у назві файлу дозволяють детектувати `running` vs `stalled` чистим `ls` + порівнянням timestamp; PID дозволяє `kill -0 <pid>` для перевірки чи процес живий без читання вмісту.

### Consequences
* Good, because `stalled` = presence check + filename parse (ts ≤ now()); cleanup при краші — автоматичний через гібрид: wrapper робить cleanup при старті нового run (Варіант A), watch перевіряє PID при кожному скані (Варіант B).
* Bad, because `budget_hard_sec: 0` (вимкнено) потребує спеціальної обробки щоб не створити sentinel з deadline у минулому; clock skew на multi-machine setups — поза scope (single-machine + `stale_grace_sec: 60`).

## More Information
Файл: `tasks/<node>/running_<pid>_until_<ts>`. Git-ignored. Видаляється wrapper'ом при нормальному завершенні. Пріоритет станів: `invalidated` > `resolved` > `pending-audit` > `stalled` > `running` > `waiting`/`blocked` > `human-pending` > `unassigned` > `failed`. Зафіксовано у `docs/думка.MD`.

---

## ADR — `deps/` директорія замість `deps:` frontmatter + siblings-only контракт

## Context and Problem Statement
Список залежностей вузла зберігався у `deps:` полі frontmatter `task.md`. Це порушувало ls-only інваріант: щоб дізнатись залежності — треба читати `task.md`. Також виникло питання про scope: чи можуть вузли залежати від вузлів на інших рівнях ієрархії?

## Considered Options
* `deps:` у frontmatter `task.md` (поточна схема)
* `deps/` директорія де ім'я файлу = dep-id + відносні або абсолютні шляхи
* `deps/` директорія зі siblings-only контрактом (dep-id = ім'я сусіда)

## Decision Outcome
Chosen option: "`deps/` директорія зі siblings-only контрактом", because список deps видно з `ls deps/` без читання вмісту; siblings-only усуває неоднозначність імен і не потребує парсингу шляхів; composite-батько відповідає за координацію між гілками.

### Consequences
* Good, because deps satisfaction = `ls deps/` → перевірити `fact_*.md` у `tasks/<dep-id>/`; файли в `deps/<dep-id>.md` можуть містити опціональний ref + контекст для агента (читається тільки агентом, не orchestrator'ом).
* Bad, because залежності між вузлами на різних рівнях ієрархії неможливі без реструктуризації графу; якщо є два вузли з однаковою назвою у різних піддеревах — конфлікт dep-id.

## More Information
Конвенція: файли в `deps/` мають розширення `.md` (`deps/collect-data.md`). dep-id = `basename без .md`. Immutable після worktree. Зафіксовано у `docs/думка.MD` рядки 236–252.

---

## ADR — `fact_NNN.md` для composite вузлів (orchestrator-written)

## Context and Problem Statement
Composite вузол не мав `fact_NNN.md` — його "resolved" стан визначався рекурсивним обходом всіх нащадків. Це робило перевірку стану composite O(n) замість O(1) і ускладнювало deps satisfaction між гілками.

## Considered Options
* Implicit resolved: composite resolved = всі діти resolved (рекурсивний обхід)
* `fact_NNN.md` для composite написаний orchestrator'ом при завершенні всіх дітей
* Порожній sentinel `.resolved`

## Decision Outcome
Chosen option: "`fact_NNN.md` для composite написаний orchestrator'ом", because уніфікує протокол — всі resolved вузли (atomic і composite) мають `fact_NNN.md`; deps satisfaction однаковий для обох типів; O(1) перевірка стану.

### Consequences
* Good, because `resolved` = presence check для обох типів; NNN-нумерація і трасовуваність збережена; orchestrator вже відслідковує completion дітей — один додатковий `write` при переході.
* Bad, because orchestrator стає writer'ом `fact_NNN.md`, а не тільки агент — два різні writer'и для одного типу файлу залежно від типу вузла.

## More Information
Зміст composite `fact_NNN.md` = summary дочірніх результатів (written by orchestrator). Зафіксовано у рішенні по Ваді №4 сесії 2026-06-07.

---

## ADR — Audit FAIL → `invalidated` + новий цикл

## Context and Problem Statement
При audit FAIL специфікація не описувала що відбувається далі. `pending-audit_NNN.md` та `audit-result_NNN.md` immutable, NNN зайнятий. Повторний аудит того самого `fact_NNN.md` неможливий без порушення immutable контракту. Вузол залишався `resolved` (є `fact_*.md`) попри FAIL аудиту.

## Considered Options
* Повторний audit з новою нумерацією (`pending-audit_NNN_attempt_M.md`)
* Аудит FAIL = тільки нотифікація, без автоматичного state transition
* Аудит FAIL → `invalidated` → новий run цикл → новий NNN

## Decision Outcome
Chosen option: "Аудит FAIL → orchestrator пише `invalidated`", because використовує існуючий механізм `invalidated`; immutable не порушується; повторний цикл отримує новий NNN природно; повна трасовуваність: `invalidated` + `audit-result_NNN.md(FAIL)`.

### Consequences
* Good, because протокол залишається консистентним; старий `fact_NNN.md` + `audit-result_NNN.md(FAIL)` + `invalidated` = повна картина події в git history.
* Bad, because `invalidated` тепер може бути виставлений двома різними тригерами (ручна інвалідація і audit FAIL) — логіка orchestrator має розрізняти причину якщо потрібна різна подальша дія.

## More Information
Файл `audit-result_NNN.md` має поле `result: pass | fail`. При `fail` orchestrator пише `invalidated`. Зафіксовано у рішенні по Ваді №6 сесії 2026-06-07.

---

## ADR — Context window агента: `max_context_runs` + тільки останні N run

## Context and Problem Statement
Агент отримує у context всі `run_NNN.md` накопичені вузлом. Після 10+ failed спроб context window заповнюється власною невдалою історією, залишаючи менше простору для реального виконання. LLM може також "навчитись" помилкам з попередніх run.

## Considered Options
* Всі `run_NNN.md` у context (поточна схема)
* Тільки останній `run_NNN.md`
* `max_context_runs: N` у конфігурації + тільки останні N

## Decision Outcome
Chosen option: "`max_context_runs: N` (default: 3) + тільки останній run", because N=3 достатньо для розуміння "що нещодавно пішло не так"; налаштовується per-node для складних задач; не потребує змін у форматі файлів.

### Consequences
* Good, because context window агента bounded; ранні failed run не забруднюють context; архів всіх run_NNN.md залишається у filesystem для аудиту.
* Bad, because агент може не знати про помилку зроблену 4+ runs тому якщо max_context_runs=3 — може повторити її.

## More Information
`max_context_runs` у `.n-cursor.json` (global) або `a.md` (per-node). Orchestrator включає останні min(N, total_runs) файлів. Зафіксовано у рішенні по Ваді №9 сесії 2026-06-07.

---

## ADR — `max_worktrees` + FIFO queue для паралельних worktrees

## Context and Problem Statement
`graph run --auto` запускає всі ready вузли паралельно без ліміту. При великому графі і великому репозиторії — одночасне створення 50+ worktrees може спустошити disk і перевантажити CPU/IO на dev-машині.

## Considered Options
* Без ліміту (поточна схема)
* `max_worktrees` + back-pressure FIFO queue
* Shallow worktree (тільки необхідні файли)

## Decision Outcome
Chosen option: "`max_worktrees: 4` (default) + FIFO queue", because найпростіше в реалізації; передбачувана поведінка; не потребує змін у git або worktree протоколі; черга природна — `graph scan` при кожному тіку підхоплює наступний ready вузол.

### Consequences
* Good, because disk і CPU використання bounded; default 4 залишає ресурси для основного середовища розробки.
* Bad, because при max_worktrees=4 і 50 ready вузлах — загальний час виконання збільшується лінійно; немає priority queue (критичні вузли чекають поряд зі звичайними).

## More Information
`max_worktrees` у `.n-cursor.json`. Default: 4. FIFO: `graph scan` додає у чергу в порядку topological sort (вузли без залежностей — перші). Зафіксовано у рішенні по Ризику №1 сесії 2026-06-07.

---

## ADR — `graph invalidate --cascade` (manual) для каскадної інвалідації

## Context and Problem Statement
При інвалідації вузла-основи всі залежні вузли мають теж бути інвалідовані (їх результати засновані на недійсних даних). Автоматична propagation ризикує скинути весь граф при будь-якій помилці. Відсутність propagation залишає граф у несумісному стані.

## Considered Options
* Автоматична каскадна propagation при `invalidated`
* Differential invalidation (порівняти outputs до і після re-run)
* `graph invalidate --cascade` (ручна explicit команда)

## Decision Outcome
Chosen option: "`graph invalidate --cascade` (ручна explicit команда)", because примушує людину думати про scope інвалідації; не ризикує автоматично скинути весь граф; differential invalidation додається як оптимізація у v2.

### Consequences
* Good, because інженер контролює що саме інвалідується; немає тихих каскадних скидань великих частин графу.
* Bad, because людина може забути виконати `--cascade` після інвалідації основи — граф залишиться у несумісному стані без автоматичного попередження.

## More Information
`graph invalidate --cascade tasks/<node>/` — рекурсивно пише `invalidated` у всі вузли що мають `deps/<node>.md`. Команда ідемпотентна. Differential invalidation (порівняння hash outputs) — roadmap v2. Зафіксовано у рішенні по Ризику №2 сесії 2026-06-07.

---

## ADR — `graph pin` для стабілізації composite топології

## Context and Problem Statement
При повторному `graph plan` для composite вузла LLM може запропонувати іншу декомпозицію ніж попередній раз. Старі дочірні вузли стають orphan (виконана робота втрачається або плутає scan). Нова топологія може семантично несумісно використати результати старих вузлів через deps.

## Considered Options
* Дозволити зміну топології при кожному re-plan (поточна схема)
* `graph pin` після першого successful planning — фіксує топологію
* Структура composite у `## Structure` секції `task.md` (людина контролює)

## Decision Outcome
Chosen option: "`graph pin` після першого composite planning", because відповідає реальному workflow (агент пропонує → людина погоджується → фіксує); re-run не змінює топологію без explicit `graph unpin`; `graph kill` без `--unpin` скидає тільки плани і результати, не топологію.

### Consequences
* Good, because топологія стабільна між re-run; orphan вузлів не виникає; семантична сумісність deps збережена.
* Bad, because додає один explicit крок у workflow; якщо перша декомпозиція хибна — потрібен `graph unpin` + `graph kill` + `graph plan`.

## More Information
`graph pin <path>` — пише `.pinned` sentinel у директорію composite вузла. `graph plan` при наявності `.pinned` — оновлює тільки budget/деталі існуючих дочірніх, не структуру. Зафіксовано у рішенні по Ризику №3 сесії 2026-06-07.
