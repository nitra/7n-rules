---
kind: nitra-spec
status: draft
adr: null
plan: null
risk: med
---

# Файловий стан DAG блоків — контракт

Дата: 2026-06-01
Власник: @vitaliytv
Статус: Draft (очікує апруву)

## Мета

Дробити задачу на блоки (підзадачі) з графом залежностей, роздавати їх людям і
LLM (частину паралельно, частину послідовно), і тримати **весь стан у файлах**
так, щоб простим скануванням встановити: **де** процес (позиція в графі), **на
кому** кожен блок і **який саме** блок. Жодної центральної БД — файли є джерелом
істини, усе придатне для git-рев'ю, diff і крос-машинної координації.

## Принцип

**Файл = стан вузла.** Кожен блок має до трьох артефактів; за їх наявністю +
полем `dependsOn` похідний статус вузла обчислюється чистою функцією.
Координація — через git: claim атомарно створюється (`O_CREAT|O_EXCL`),
комітиться й пушиться; **арбітр конкуренції — `git push` (перший push виграє)**.

## Структура каталогів

Один граф = одна епіка/фіча. Усе **трекається git**.

```text
docs/graphs/<graph-id>/
  graph.md                       # маніфест: мета графа (вузли/ребра деривуються з блоків)
  blocks/
    B01-schema.plan.md           # ПЛАН/контракт блоку (immutable після створення)
    B02-parser.plan.md
    B02-parser.claim.md          # ЗАЯВКА (атомарний файл) — присутній поки in_progress
    B01-schema.fact.md           # ФАКТ (по завершенню) — присутній = термінальний
```

## Артефакти (контракт front-matter)

### 1. `<id>-<slug>.plan.md` — план/контракт блоку

Створюється на плануванні; далі **не змінюється** (намір фіксований).

```yaml
---
kind: nitra-block
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
kind: nitra-block-claim
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
kind: nitra-block-fact
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
## Нотатки для залежних блоків
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

Скан `blocks/*.plan.md` (id, dependsOn, owner) + перевірка наявності
`*.claim.md` / `*.fact.md`. Чиста функція:

```text
fact існує             → done | failed           (status із fact; хто = fact.by)
claim існує, fact нема  → in_progress             (хто = claim.by)
нема claim/fact:
   усі dependsOn done   → ready                   (можна брати; кому = plan.owner)
   є невиконаний dep    → blocked                 (чекає на dep)
```

Похідні відповіді з одного скану:

- **де процес** — розбиття вузлів на `done / in_progress / ready / blocked / failed`; «фронт» = `in_progress ∪ ready`;
- **на кому** — `claim.by` (активні) або `plan.owner` (готові до взяття);
- **який блок** — `id` + `slug` (+ `graph`).

Паралель/послідовність/незалежність випадають із графа: кілька `ready` →
паралель; ланцюг `dependsOn` → послідовність; нема ребра → незалежні.

## Життєвий цикл блоку

1. **plan** створено (`pending`/`ready`/`blocked` за депендесами).
2. виконавець бере: атомарно створює `claim.md` (`wx`) → commit → **push**
   (push-success = власність). Поки працює — оновлює `heartbeat`.
3. завершення: створює `fact.md` (`status: done|failed`, evidence), **видаляє**
   `claim.md`, commit, push.
4. залежні вузли стають `ready`, коли всі їхні `dependsOn` мають `fact: done`.

## Stale-локи (мертвий виконавець)

Claim із застарілим `heartbeat` (старше за TTL, напр. 30 хв) → вважається
вільним; репер (або `repair`-команда) видаляє осиротілий claim. Альтернатива —
ручне зняття людиною. Без heartbeat-TTL завислий воркер заблокує вузол.

## Інтеграція з n-cursor (перевикористання, не дублювання)

- **Блок ≈ flow.** Виконання блоку — окремий `flow` у своєму worktree:
  `plan.md` блоку → `flow plan`; runtime — `.flow.json`; завершення
  (`flow gate`/`release`) генерує `fact.md` вузла (durable-проєкція
  completion-snapshot).
- **`graph.md` + блоки** — DAG поверх лінійних flow (модель «лінійний flow ×
  граф зверху»).
- **`trace` розширюється** на `kind: nitra-block*` + ребра `dependsOn`:
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
(`wx` + push-арбітр); похідний статус; stale-TTL; розширення `trace` на блоки.

**Out (окремо):** автоматична роздача/оркестратор (топосорт «запусти всі ready»);
`n-cursor graph status` (CLI-скан → таблиця); merge/фан-ін автоматизація.

## Відкриті питання

- Owner у plan (призначення) vs `by` у claim (фактичний виконавець) — дозволяємо
  розбіжність (план запропонував cheap-model, узяла людина); фіксуємо обидва.
- `graph.md` маніфест: мінімальний (лише мета) — ребра деривуються з блоків
  (єдине джерело істини — `dependsOn` у plan).
