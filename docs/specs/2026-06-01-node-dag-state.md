---
kind: nitra-spec
status: draft
adr: null
plan: null
risk: med
---

# Файловий стан DAG вузлів — контракт

Дата: 2026-06-01
Власник: @vitaliytv
Статус: Draft (очікує апруву)

## Мета

Дробити задачу на вузли (підзадачі) з графом залежностей, роздавати їх людям і
LLM (частину паралельно, частину послідовно), і тримати **весь стан у файлах**
так, щоб простим скануванням встановити: **де** процес (позиція в графі), **на
кому** кожен вузол і **який саме** вузол. Жодної центральної БД — файли є джерелом
істини, усе придатне для git-рев'ю, diff і крос-машинної координації.

## Принцип

**Файл = стан вузла.** Кожен вузол має до трьох артефактів; за їх наявністю +
полем `dependsOn` похідний статус вузла обчислюється чистою функцією.
Координація — через git: claim атомарно створюється (`O_CREAT|O_EXCL`),
комітиться й пушиться; **арбітр конкуренції — `git push` (перший push виграє)**.

## Структура каталогів

Один граф = одна епіка/фіча. Усе **трекається git**.

```text
docs/graphs/<graph-id>/
  graph.md                       # маніфест: мета графа (вузли/ребра деривуються з вузлів)
  nodes/
    B01-schema.plan.md           # ПЛАН/контракт вузла (immutable після створення)
    B02-parser.plan.md
    B02-parser.claim.md          # ЗАЯВКА (атомарний файл) — присутній поки in_progress
    B01-schema.fact.md           # ФАКТ (по завершенню) — присутній = термінальний
```

## Артефакти (контракт front-matter)

### 1. `<id>-<slug>.plan.md` — план/контракт вузла

Створюється на плануванні; далі **не змінюється** (намір фіксований).

```yaml
---
kind: nitra-node
id: B02                          # стабільний id (НЕ індекс; не змінюється)
graph: cache-epic
title: Парсер конфігу
slug: parser
dependsOn: [B01]                 # hard-залежності за id (ребра DAG; [] = корінь)
owner: { type: llm, who: cheap-model }   # кому призначено (llm|human + хто)
isolation: worktree              # worktree (паралельно) | inline (спільне дерево)
spec: ../../specs/2026-…-cache.md    # лінк на контракт/інтерфейс (опц.)
---
## Кроки
1. … — acceptance: …
## Контракт
Експонує: `parseConfig(buf) → Config`. Споживає: схему з B01.
## Acceptance
…
```

### 2. `<id>-<slug>.claim.md` — заявка (атомарний лок, у git)

Присутність файлу = `in_progress`. Створюється **атомарно** (див. нижче).

```yaml
---
kind: nitra-node-claim
id: B02
graph: cache-epic
by: { type: llm, who: claude@session-x }    # хто фактично взяв
branch: feat/cache-parser                    # ізоляція виконання
started_at: 2026-06-01T19:00:00Z
heartbeat: 2026-06-01T19:12:00Z              # оновлюється воркером (для stale-репера)
---
```

### 3. `<id>-<slug>.fact.md` — факт (по завершенню)

Присутність = термінальний стан. Claim знімається (видаляється) при появі факту.

```yaml
---
kind: nitra-node-fact
id: B02
graph: cache-epic
status: done                     # done | failed
by: { type: llm, who: claude@session-x }
branch: feat/cache-parser
commits: [a1b2c3]
artifacts: [npm/scripts/…/parser.mjs]
gate: PASS                       # вердикт із flow gate (опц.)
verifiedAt: 2026-06-01T19:40:00Z
---
## Що зроблено
## Відхилення від плану
## Нотатки для залежних вузлів
```

## Атомарність через файл (а не директорію)

Claim має **потрапляти в git**, тому це звичайний файл (директорія-лок не
трекається й не реплікується git). Атомарність — двома рівнями:

1. **Локально** — атомарне ексклюзивне створення:

   ```js
   import { writeFileSync } from 'node:fs'
   try {
     writeFileSync(claimPath, frontmatter, { flag: 'wx' })  // O_CREAT|O_EXCL: або створив, або EEXIST
   } catch (e) {
     if (e.code === 'EEXIST') return 'busy'                 // вже заклеймлено локально
     throw e
   }
   ```

   `flag: 'wx'` — один syscall, без read-then-write race.

2. **Розподілено (кілька машин/гілок)** — арбітр **`git push`**:
   `add claim → commit → push`. Якщо хтось запушив claim першим — твій push
   відхиляється (non-fast-forward) або claim конфліктує; `fetch`, бачиш чужий
   claim → відступаєш і береш інший `ready`-вузол. **Хто перший у remote —
   той власник.**

Тобто `wx` дає локальне взаємовиключення, а git push — глобальне. Директорія
тут не потрібна й шкідлива (git її не несе).

## Похідний статус вузла (як читати позицію графа)

Скан `nodes/*.plan.md` (id, dependsOn, owner) + перевірка наявності
`*.claim.md` / `*.fact.md`. Чиста функція:

```text
fact існує                    → done | failed     (status із fact; хто = fact.by)
claim & відкрите ask (без ans) → awaiting-human    (питання підняте; кому = ask.needs)
claim існує, fact нема         → in_progress       (хто = claim.by)
нема claim/fact:
   усі dependsOn done          → ready             (можна брати; кому = plan.owner)
   є невиконаний dep           → blocked           (чекає на dep)
```

Похідні відповіді з одного скану:

- **де процес** — розбиття вузлів на `done / in_progress / awaiting-human / ready / blocked / failed`; «фронт» = `in_progress ∪ awaiting-human ∪ ready`;
- **на кому** — `claim.by` (активні) або `plan.owner` (готові до взяття);
- **який вузол** — `id` + `slug` (+ `graph`).

Паралель/послідовність/незалежність випадають із графа: кілька `ready` →
паралель; ланцюг `dependsOn` → послідовність; нема ребра → незалежні.

## Життєвий цикл вузла

1. **plan** створено (`pending`/`ready`/`blocked` за депендесами).
2. виконавець бере: атомарно створює `claim.md` (`wx`) → commit → **push**
   (push-success = власність). Поки працює — оновлює `heartbeat`.
3. завершення: створює `fact.md` (`status: done|failed`, evidence), **видаляє**
   `claim.md`, commit, push.
4. залежні вузли стають `ready`, коли всі їхні `dependsOn` мають `fact: done`.

## Питання до людини в межах вузла (HITL-ескалація)

Кейс: вузол узяв LLM, але в процесі впирається у рішення, яке не може/не має
права прийняти сам (продуктове, безпекове, архітектурне). Він **не падає** —
ставить **питання** людині, отримує **рішення** й продовжує. Усе — тими ж
файлами-артефактами (write-once, атомарні, у git).

### Артефакти питання/рішення (per-вузол, write-once)

```text
nodes/<id>-<slug>.ask-<qid>.md    # питання (kind: nitra-node-ask)
nodes/<id>-<slug>.ans-<qid>.md    # рішення (kind: nitra-node-ans)
```

**`ask-<qid>.md`** (створює LLM атомарно, `wx`):

```yaml
---
kind: nitra-node-ask
node: B02
qid: q1
by: { type: llm, who: claude@session-x }
needs: [auth, db]          # домени експертизи, потрібні для рішення (для routing)
blocking: true             # чи блокує вузол (зазвичай так)
context: [ docs/specs/…, nodes/B02-parser.plan.md, "diff:HEAD~1" ]  # повний контекст
at: 2026-06-01T19:20:00Z
---
## Питання
… формулювання …
## Варіанти
A) … B) … (з оцінкою наслідків)
```

**`ans-<qid>.md`** (створює людина атомарно, `wx`):

```yaml
---
kind: nitra-node-ans
node: B02
qid: q1
by: { type: human, who: "@vitaliytv" }    # хто вирішив (для traceability/класифікації)
at: 2026-06-01T19:35:00Z
---
## Рішення
Обрано B, бо …
```

### Потік

1. LLM упирається → пише `ask-<qid>.md` (`wx`, commit, push) → вузол стає
   **`awaiting-human`**. Агент паузиться/завершується; **claim лишається** (вузол
   ще «його»), але **слот `--max-llm` звільняється** (агент не працює).
2. **Routing за експертизою** — open `ask` з `needs:[…]` маршрутизується на
   «правильну» людину (див. нижче); людині надається **повний контекст** (з
   `context[]` + plan вузла + diff + spec + попередні рішення) — bundle через
   `graph ask show <qid>`.
3. Людина пише `ans-<qid>.md` (`wx`, commit, push) — рішення **зафіксоване**
   (durable). Кандидат на промоушн у ADR (це архітектурне рішення).
4. `ans` з'явився → вузол назад `in_progress` → LLM **продовжує** з рішенням як
   hint (механізм `flow resume` уже застосовує HITL-відповіді як підказки кроку).
5. LLM завершує → `fact`.

### Routing за знаннями людей (закладаємо; повне — окремий інкремент)

- **Профіль людини** `docs/people/<who>.md` (`kind: nitra-person`):

  ```yaml
  expertise: { auth: expert, db: competent, frontend: novice }   # домен → рівень
  ```

- Матч `ask.needs` × `expertise` → ранжування кандидатів (експерт у домені >
  competent; немає — ескалація/найкращий доступний). Skill-based routing (як
  маршрутизація тикетів / on-call).
- **Поки** (мінімум): питання у спільну чергу з тегами `needs`; повний матчер —
  далі.
- **Re-use знань (майбутнє):** накопичені `ans` із тегами `needs` → база рішень;
  схоже питання може зматчитись на минуле рішення (lookup) **перед** ескалацією.

### Інваріанти

- `ask`/`ans` — **write-once** (`wx`), як plan/fact: незмінні, атомарні, push-арбітр.
- Кілька питань на вузол — різні `qid` (`q1`, `q2`, …); вузол `awaiting-human`,
  доки є хоч одне `ask` без парного `ans`.
- Питання **не** дорівнює провалу: `fact` не пишеться; залежні лишаються `blocked`,
  але не `failed`.

## Stale-локи (мертвий виконавець)

Claim із застарілим `heartbeat` (старше за TTL, напр. 30 хв) → вважається
вільним; репер (або `repair`-команда) видаляє осиротілий claim. Альтернатива —
ручне зняття людиною. Без heartbeat-TTL завислий воркер завузлає вузол.

## Інтеграція з n-cursor (перевикористання, не дублювання)

- **Вузол ≈ flow.** Виконання вузла — окремий `flow` у своєму worktree:
  `plan.md` вузла → `flow plan`; runtime — `.flow.json`; завершення
  (`flow gate`/`release`) генерує `fact.md` вузла (durable-проєкція
  completion-snapshot).
- **`graph.md` + вузли** — DAG поверх лінійних flow (модель «лінійний flow ×
  граф зверху»).
- **`trace` розширюється** на `kind: nitra-node*` + ребра `dependsOn`:
  `n-cursor trace` друкує позицію графа (done/ready/blocked/in_progress) і
  флагує розриви (claim без plan, осиротілий claim, fact на невиконаних депендесах).

## Worked example

```text
graph: cache-epic
B01 schema      dependsOn:[]        fact:done       (human @vitaliytv)
B02 parser      dependsOn:[B01]     claim (llm)     ← in_progress
B03 cache-store dependsOn:[B01]     ready (llm)     ← можна брати паралельно з B02
B04 wire-up     dependsOn:[B02,B03] blocked         (чекає B02,B03)
```

Один скан: фронт = {B02 in_progress, B03 ready}; B04 blocked; B01 done.

## Scope

**In:** контракт plan/claim/fact + frontmatter-схеми; правило claim-as-atomic-file
(`wx` + push-арбітр); похідний статус; stale-TTL; розширення `trace` на вузли.

**Out (окремо):** автоматична роздача/оркестратор (топосорт «запусти всі ready»);
`n-cursor graph status` (CLI-скан → таблиця); merge/фан-ін автоматизація.

## Відкриті питання

- Owner у plan (призначення) vs `by` у claim (фактичний виконавець) — дозволяємо
  розбіжність (план запропонував cheap-model, узяла людина); фіксуємо обидва.
- `graph.md` маніфест: мінімальний (лише мета) — ребра деривуються з вузлів
  (єдине джерело істини — `dependsOn` у plan).
