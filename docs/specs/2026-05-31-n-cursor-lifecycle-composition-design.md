---
id: n-cursor-lifecycle-composition
kind: nitra-spec # канон схеми front-matter для docs/specs|plans (поля: kind, id, status, adr, plan, task)
title: n-cursor flow — Суверенний Stateful AI-Оркестратор
date: 2026-05-31
version: 2.0
status: planned # draft | planned | implemented
adr: null # → docs/adr/<...>.md після фіксації рішення
plan: docs/plans/2026-05-31-n-cursor-flow-v2.0-a.md # присутність = «перейшов у планування»
task: null # → docs/tasks/<id>.md (spine; присутність = задача зафіксована)
owners: [] # CODEOWNERS / відповідальні
tags: [architecture, orchestrator, capability-router, fault-tolerance, traceability, pi.dev]
supersedes-recommendation: compose-and-extend (v1.x → §13)
---

# n-cursor flow: Суверенний Stateful AI-Оркестратор

**Дата:** 2026-05-31 · **Версія:** 2.7 · **Статус:** Draft (узгоджено напрям)

> **Що нового у 2.7 (Dual-Mode Dispatcher):** §8 переосмислено — **два фасади** навколо `.flow.json`: **Пасивний Турнікет** (`init`/`verify`/`release`) для IDE-агентів (вони пишуть код самі) і **Активний Раннер** (`run`) для headless. Інверсія контролю (§8.4) робить Quality Gates ідентичними для будь-якого автора. Це **примиряє** Sovereign і compose-and-extend: §12.2 (непрозорість) знято для інтерактиву, §13 — compose тепер = Фасад A. Безшовний handoff IDE↔headless через спільний стан (§8.3).
>
> **Що нового у 2.6 (рев'ю колеги, ч.3):** commit-інваріант (коміт лише після gates; repair не комітить — §4.1 п.7); verify звіряє **fingerprint** кожного gate (не stale — §5); **completion snapshot** у task record перед cleanup (§3 Ф5, §7); повна **схема task record** (§7); polyfill-default лише за наявного runner-а (§2.2); **dependency boundary** `SubagentRunner` (§15.1); **audit** allowed-gaps класифікатора (§3 Ф4); §15 → «Resolved & Open».
>
> **Що нового у 2.5 (рев'ю колеги, ч.2):** HITL Q&A — **структурований YAML-блок** у task record (людина заповнює лише `answer`), `resume` парсить через `gray-matter` (а не крихкий free-text, §4.2); **рішення §15.1** — inner-спавн субагентів через `claude-agent-sdk` за абстракцією `SubagentRunner`, **не** pi.dev (рекурсія pi.dev→flow→pi.dev + нема headless API).
>
> **Що нового у 2.4 (рев'ю колеги):** safe-resume замість `git reset --hard` (dirty-check + `git stash` + `flow repair --discard-step-work`, §4.1 п.7); naming-канон `.flow.json` / `.events.jsonl` скрізь; front-matter `kind: nitra-spec`; Done-контракт розписано **окремими gate-рядками** (§5); native — target-state формулювання (не «заглушка»); прибрано колонку `superpowers` з активної таблиці §8.
>
> **Що нового у 2.3:** Executor збирає **мікропромпт зі стану** (не історію переписки) — §3 Ф3; gate = **clean Killable 100%** з handshake «класифікатор↔executor» (передаємо в repair лише killable мутантів) — §3 Ф4, §12.4; **HITL-escalація** після N фейлів у task record + exit-code `2` — §4.2; **блокуючий контракт pi.dev↔flow** з exit-кодами 0/1/2 — §9.1.
>
> **Що нового у 2.2:** додано §4.1 «State store — crash-safety»: atomic temp+rename, WAL-журнал подій (єдиний sibling `.events.jsonl`), reuse `withLock` з fail-closed-override, per-step+global ліміти, `schema_version`, fail-closed на corruption + `flow repair`, та **resume з git-чекпойнта** (закриває idempotency-діру). За основу — спек колеги (§4.1), з уточненнями.
>
> **Що нового у 2.1:** runtime-стан переміщено з checkout-директорії у **sibling-файл** `.worktrees/<sanitized-branch>.flow.json` (поруч з `.md`-інвентарем). Причина (емпірично підтверджено): файл усередині checkout — untracked у feature-гілці й ризикує потрапити в `git add -A` під час Ф3. Те саме застосовано до audit-log (§9). Дякую за catch колезі.
>
> **Рішення власника (2.0):** spine — **повний Sovereign engine**. `@nitra/cursor` бере під контроль весь life-cycle задачі власним двигуном, **відмовляється від `superpowers`**, маршрутизує виконання через `capability-matrix.json`. Прийнято свідомо, з фіксованими ризиками й мітигаціями (§12). Попередня рекомендація v1.x (compose-and-extend) збережена як відкладена альтернатива (§13).
>
> **Що нового у 2.0:** Capability Router з **явним оголошенням моделі** (не детекцією); власний 5-фазний двигун (`dispatcher/`); compose-and-extend демотовано в §13; додано Accepted Risks & Mitigations (§12) і план розгортання (§14). Збережено з 1.x: fault-tolerant `.flow.json` (§4), lifecycle-ланцюг (§6), простежуваність `n-cursor trace` (§7), Contract + `verify` (§5).

---

## 1. Контекст і парадигма

### 1.1 Бізнес-ціль

Future-proof, суверенна інфраструктура розробки: один CLI володіє всім циклом задачі — від аналізу вимог до релізу — без залежності від стороннього фреймворку, що його worktree/контекст-логіка конфліктує з нашими пропрієтарними тулами.

### 1.2 Рішення

`@nitra/cursor` стає **Stateful AI-Оркестратором** (`n-cursor flow`). Він:

- маршрутизує задачу між **native** (модель з власними воркфлоу на рівні харнеса) і **polyfill** (наш детермінований двигун-машина станів);
- детерміновано фіксує стан на диску (fault-tolerance);
- реалізує власні 5 фаз (план → ізоляція → TDD-виконання → 2-етапне рев'ю → реліз);
- **не використовує `superpowers`** — промпти планування/рев'ю стають внутрішньою IP пакета.

### 1.3 Чесний статус рішення

Це рішення **переважує** рекомендацію аналізу v1.x (compose-and-extend). Воно прийняте власником продукту попри відомі ризики (немає рантайм-детекції моделі; двошарова оркестрація; maintenance власних промптів). Ризики не ігноруються — вони винесені в §12 з мітигаціями. Compose-and-extend лишається задокументованим у §13 із тригерами, за яких до нього повертаються.

---

## 2. Capability Router

### 2.1 Матриця можливостей

`npm/config/capability-matrix.json` — декларативний реєстр:

```json
{
  "models": {
    "claude-3-5-sonnet": { "orchestration": "polyfill", "capabilities": ["tool_use", "code_gen"] },
    "claude-4-8-opus": {
      "orchestration": "native",
      "capabilities": ["tool_use", "code_gen", "native_workflows", "ultracode"]
    }
  },
  "default": { "orchestration": "polyfill" }
}
```

### 2.2 Модель оголошується ЯВНО (ключова мітигація)

Рантайм-детекції моделі в кодобазі **немає** (підтверджено аналізом; §12.1). Тому Router **не вгадує** модель — її **декларують**, з безпечним fallback:

| Джерело       | Приклад                                           | Пріоритет        |
| ------------- | ------------------------------------------------- | ---------------- |
| CLI-прапорець | `n-cursor flow --model claude-4-8-opus "..."`     | 1 (найвищий)     |
| Env           | `N_CURSOR_FLOW_MODEL=claude-4-8-opus`             | 2                |
| Конфіг        | `.n-cursor.json → { "flow": { "model": "..." } }` | 3                |
| **Default**   | модель невідома/відсутня у матриці                | → **`polyfill`** |

Default → `polyfill` **лише якщо** доступний сконфігурований `SubagentRunner` (§15.1) і модель здатна до code-gen (бажано tool use або CLI-mediated edits); інакше — **fail fast** із діагностикою (не пробуємо наосліп без runner-а). polyfill **не** «працює з будь-якою моделлю» автоматично — мінімум: runner у наявності + code-gen. `native` вмикається лише за явної декларації моделі з `native_workflows`.

### 2.3 Два маршрути

- **native** — Диспетчер пакує задачу + обмеження репо в один payload і **відходить у тінь**, дозволяючи моделі виконувати воркфлоу автономно на рівні її харнеса. `flow/native.mjs` **визначає фінальний інтерфейс** native-маршруту; реалізація **активується**, коли доступна модель/API з `native_workflows`.
- **polyfill** — Диспетчер активує власну машину станів (§3), що мікроменеджить ШІ послідовними ізольованими API-запитами.

---

## 3. П'ять канонічних фаз (polyfill-двигун)

```
n-cursor flow → Ф1 План(JSON) → Ф2 Ізоляція(worktree) → Ф3 TDD-виконання(субагенти)
                   → Ф4 2-етапне рев'ю(lint+coverage+semantic) → Ф5 Реліз(change)
```

**Ф1 — Декларативне планування.** `dispatcher/planner.mjs` змушує ШІ видати суворий покроковий JSON-масив: кожен крок ≤ 5 хв розробки, з критеріями приймання. План кладеться у `.flow.json` (§4).

**Ф2 — Ізоляція.** Внутрішній виклик `n-cursor worktree add <branch> "<опис>"` (НЕ власна Git-логіка — reuse наявної CLI з інвентарем). Агент переходить у пласку `.worktrees/<sanitized>/`.

**Ф3 — TDD-виконання через субагентів.** `dispatcher/executor.mjs` ітерується по плану; на кожен крок — **чиста ізольована сесія** (субагент). Executor **не передає історію переписки** — він читає стан із `.flow.json` і збирає **короткий мікропромпт**: лише поточний крок + цільові файли + критерії приймання + Iron Law of TDD (спершу падаючі тести, тоді код). Дешевше за токенами й без context-drift; контекст збирається **детерміновано зі стану**, а не накопичується в діалозі. Спавн субагента — через абстракцію `SubagentRunner` (дефолт `claude-agent-sdk`; не pi.dev — §15.1).

**Ф4 — Двоетапне рев'ю.** `dispatcher/reviewer.mjs`:

1. **Машинна верифікація** — lint + `n-cursor coverage` (з LLM-класифікатором мутантів). **Критерій проходження — clean Killable = 100%**: не raw score, а `killed / (total − allowed)`, де allowed = класифіковані `equivalent`/`defensive`/`glue`. Класифікатор і executor **знають один про одного**: reviewer передає в repair-цикл субагента **лише killable** вцілілих мутантів, **ніколи** allowed — інакше субагент марно вичерпає 3 спроби на невбивному (equivalent) мутанті. Після 3 спроб → §4.2 (HITL).
2. **Семантична відповідність** — легкий агент перевіряє, що субагент не реалізував прихованих фіч поза планом.

**Ф5 — Реліз.** `n-cursor change` генерує `.changes/<timestamp>-<rand>.md` на основі виконаних кроків. Гілка готова до merge. Перед cleanup двигун пише **completion snapshot** у task record (§7): final status, список commits, gate-результати (+ classifier report), change-файл, notifications, blocked/HITL-історія — щоб durable-слід пережив видалення transient `.flow.json`.

> **Чому clean-100, а не raw/threshold:** інакше критерій неоднозначний і субагент зависає, намагаючись убити equivalent-мутанта. Класифікація allowed-gaps (узгоджено з `n-coverage-fix`) робить 100% **досяжним**. Залишковий ризик — false-negative класифікатора (позначив equivalent як killable) → ловить fallback 3-х спроб + HITL (§4.2, §12.4).
>
> **Audit allowed-gaps:** класифікатор пише **звіт** (які мутанти `allowed` і чому) — шлях у `.flow.json` + summary у task record (§7 / completion snapshot §3 Ф5). Без цього `allowed` міг би приховати реальний пропуск.

---

## 4. Fault-Tolerant State (`.flow.json`)

Стан детерміновано фіксується на диску — щоб мережевий збій, таймаут API чи перезапуск терміналу не втрачали прогрес.

**Локація:** `.worktrees/<sanitized-branch>.flow.json` — **sibling-файл** у `.worktrees/` (поруч із `<branch>.md`-інвентарем), **НЕ всередині** checkout.

> **Чому не всередині (`.worktrees/<branch>/.flow.json`):** `.worktrees/` ігнорується лише в **main**-репо; _усередині_ worktree це корінь feature-гілки, тож файл там — **untracked** і потрапляє в `git status`/`git add -A` (емпірично: `?? .flow.json`). А що Ф3 саме комітить код у цьому worktree — агент випадково закомітив би стан у гілку. Sibling у вже-ігнорованій `.worktrees/` цього уникає й не вимагає змін у `.gitignore` споживачів.

```json
{
  "schema_version": 1,
  "flow_id": "flow_20260531_1615",
  "branch": "feat/api-cache",
  "model": "claude-3-5-sonnet",
  "orchestration": "polyfill",
  "status": "in_progress",
  "current_step_index": 2,
  "metadata": { "base_commit": "a1b2c3d4", "started_at": "2026-05-31T13:15:00Z" },
  "plan": [
    {
      "step": 0,
      "task": "Специфікація інтерфейсу кешування",
      "status": "completed",
      "artifacts": ["docs/specs/cache-spec.md"]
    },
    {
      "step": 1,
      "task": "Падаючі тести для Redis-конектору",
      "status": "completed",
      "artifacts": ["npm/.../cache.test.mjs"]
    },
    {
      "step": 2,
      "task": "Логіка витіснення ключів",
      "status": "in_progress",
      "retry_count": 1,
      "errors": ["Linter: trailing comma at line 42"]
    }
  ]
}
```

**CLI життєвого циклу:**

```sh
npx @nitra/cursor flow "<опис фічі>"   # worktree + init state + план + виконання
npx @nitra/cursor flow resume          # читає <branch>.flow.json (sibling), продовжує з перерваного кроку
npx @nitra/cursor flow cancel          # маркує стан скасованим, прибирає sibling-и
npx @nitra/cursor flow repair          # fail-closed escape: діагностика/скидання пошкодженого стану
```

**Два обличчя spine (не плутати):** `<branch>.flow.json` — transient runtime-чекпойнт (у ігнорованій `.worktrees/`, поза git-історією). Durable історія — **task record (§7) + `.changes/`** (комітяться). Cleanup — через `n-cursor worktree remove` / `flow cancel` (видаляють sibling разом із `.md`); до того стан **переживає** краш чекпойнтом — добре для `resume` й пост-мортему фейлів (§9). `resume` спирається на чекпойнт; `trace` (§7) — на durable-сліди.

`state-store.mjs` (`dispatcher/lib/`) інкапсулює read/write/update стану атомарно.

### 4.1 State store — crash-safety

Сім вимог (за спеком колеги, з уточненнями):

1. **Atomic write:** temp-файл на **тому ж FS** (`.worktrees/<branch>.flow.json.<rand>.tmp`) → `fsync` → `rename`; fsync директорії де доцільно (Windows — ні). Абсолютні шляхи (правило `no-relative-fs-path`).
2. **WAL:** кожен перехід **спершу** дописує подію в append-only `.worktrees/<branch>.events.jsonl`, і лише потім міняє статус у snapshot `.flow.json`. Цей журнал — **єдиний** (субсумує api-облік §9), без третього лога.
3. **Серіалізація — reuse `withLock`** (`npm/scripts/utils/with-lock.mjs`): `key: flow-<sanitized-branch>`, `cacheDir` під `.worktrees/`. Він уже чистить stale (TTL `staleThreshold` + `process.kill(pid,0)`) і релізить на SIGINT/SIGTERM. **Override для flow:** його fallback «після `waitTimeout` — запуск без локу» замінити на **fail-closed** (двох writer-ів над станом не допускаємо).
4. **Помилки:** у стані — лише summary (обмежені к-сть і довжина) + шлях на повний лог (sibling).
5. **Ліміти:** `retry_count` **per-step** (repair) + **глобальна** стеля (budget §9). Конфіг: `flow.maxRepairAttempts` (дефолт 3) і окремо `flow.autonomous.maxApiCalls`/`maxCostUsd` — без перекриття пріоритетів.
6. **Fail-closed на corruption:** нечитабельний/невалідний `.flow.json` → **стоп** із діагностикою; **не** стартувати новий flow над тією ж гілкою. Escape: `flow repair` / `flow cancel --force`. Кожен стан несе `schema_version` — відрізняти «пошкоджено» від «старий формат».
7. **Resume з чекпойнта (idempotency) — найважливіше:** atomic-записи захищають **метадані**, а не саму роботу. **Checkpoint policy:** кожен успішний крок фіксує власний коміт. На retry/resume кроку N — **без `git reset --hard`** (він зніс би ручні правки, HITL-доробки чи debug-артефакти):
   1. **dirty-check**; зміни, що **не** від поточного невдалого кроку (напр. ручні правки) → не чіпати, ескалювати §4.2;
   2. частковий доробок невдалого кроку — `git stash` (відновлюваний, для debug), не видаляти;
   3. повторити крок із коміта N-1 (чистий чекпойнт).
      Жорстке скидання stash/dirty — лише опт-ін командою **`flow repair --discard-step-work`** (свідоме викидання).
      **Інваріант (критично):** step-commit створюється **тільки після проходження всіх gate-ів кроку** (§5); repair-спроби працюють у брудному дереві й **не комітять**. Тому HEAD завжди = останній зелений крок, і `git stash`/повтор лишаються коректними (інакше «коміт до gates» зламав би повернення до N-1).

### 4.2 Human-in-the-loop (escalація після N фейлів)

Крок вичерпав `maxRepairAttempts` (§4.1 п.5) → flow **не падає мовчки**, а ескалює, зі `status: blocked-on-human` у `.flow.json`:

- **Де і ЯК фіксуємо Q&A — структуровано (не вільний текст):** у **durable, закомічений** task record `docs/tasks/<id>.md`, але **машинно-парсабельним YAML-блоком** (вільний markdown парсити крихко — межа «питання/відповідь» вгадуватись не повинна). Людина заповнює **лише** `answer` + ставить `status: answered`:
  ```yaml
  hitl:
    - id: q1
      step: 2
      question: 'Який backend для кешу — Redis чи in-memory?'
      status: open # open | answered  (людина → answered)
      answer: '' # ← людина пише ТІЛЬКИ сюди
  ```
  `resume` парсить YAML (репо вже має `gray-matter`): є `open` / порожній `answer` → лишається `blocked`; усі `answered` → відповіді йдуть у мікропромпт кроку (§3 Ф3). `answered` із порожнім `answer` → невалідно, лишаємось blocked із діагностикою. Блок durable → потрапляє в `trace`.
- **Interactive (людина в чаті):** flow дописує питання в YAML-блок; людина заповнює `answer` + `answered`; `flow resume` зчитує, знімає `blocked`, продовжує.
- **Headless (pi.dev):** flow інформує по API (notify, §6 етап 8) і завершується кодом `2` (needs-human, §9.1) — pi.dev діє за політикою.

---

## 5. «Done»-Контракт і `n-cursor verify`

Незалежно від маршруту (native/polyfill) і середовища, результат валідний лише якщо:

| #   | Gate                    | Команда                  | Артефакт / критерій                          |
| --- | ----------------------- | ------------------------ | -------------------------------------------- |
| 1   | **Ізоляція**            | `n-cursor worktree add`  | `.worktrees/<sanitized>/`                    |
| 2   | **Lint чистий**         | `n-cursor lint`          | exit 0                                       |
| 3   | **Тести зелені**        | project tests (vitest …) | 0 failures                                   |
| 4   | **Coverage + mutation** | `n-cursor coverage`      | `COVERAGE.md`; clean Killable = 100% (§3 Ф4) |
| 5   | **Трекінг**             | `n-cursor change`        | `.changes/<id>.md`                           |
| 6   | **Цілісність ланцюга**  | `n-cursor trace`         | task record + front-matter лінки валідні     |

Gate-и **окремі навмисно** (щоб coverage не «поглинув» lint/тести). Ф4 проганяє 2–4; кожен пройдений gate фіксує у стані **fingerprint** дерева на момент проходження (`HEAD` + `git diff` + untracked — reuse `worktree-fingerprint.mjs`). `n-cursor verify` — фінальний **read-only** агрегатор: перевіряє артефакти (4–6) + для gate 2–3 **звіряє fingerprint** (stale-захист: дерево змінилось після gate → статус недійсний → re-run або fail), на фейл `exit 1` із зазначенням саме якого gate. native-маршрут проходить усі (контракт єдиний для обох шляхів).

---

## 6. Канонічний lifecycle-ланцюг

Повний цикл, кожен етап — файл + лінк:

```
задача → ADR → spec → plan → код → тести → документація → changelog → інформування
```

| #   | Етап         | Артефакт      | Локація                     | Маркер                                         |
| --- | ------------ | ------------- | --------------------------- | ---------------------------------------------- |
| 0   | задача       | task record   | `docs/tasks/<id>.md`        | head                                           |
| 1   | ADR          | запис рішення | `docs/adr/<date>-<slug>.md` | файл + лінк; авто-капче `capture-decisions.sh` |
| 2   | spec         | дизайн        | `docs/specs/<id>-design.md` | `plan:` присутній → «планований»               |
| 3   | plan         | план          | `docs/plans/<id>.md`        | файл + лінк                                    |
| 4   | код          | branch/PR     | `.worktrees/<branch>/`      | _derived_: коміти                              |
| 5   | тести        | coverage      | `COVERAGE.md`               | _derived_: `n-cursor coverage`                 |
| 6   | документація | docs          | `docs/**`                   | `docs:` flag або _derived_                     |
| 7   | changelog    | інвентар      | `.changes/<id>.md`          | _derived_: `n-cursor change`                   |
| 8   | інформування | notify        | task record `notified:`     | _explicit_: `n-publish-telegram` + CODEOWNERS  |

**Принцип:** маркери derived, де можливо («реалізовано» ⟺ існує пов'язаний `.changes/`); етапи умовні (`required | skipped(<причина>) | done`).

---

## 7. Простежуваність — `n-cursor trace`

**Spine — task record** `docs/tasks/<id>.md` (спільний `id`, лінки на всі етапи + статус). Кожен артефакт несе back-link `id` у front-matter (обов'язково для `docs/specs/`, `docs/plans/`).

**Схема task record** (front-matter + body):

```yaml
---
kind: nitra-task
id: <slug>
status: intake | in-progress | blocked-on-human | done | failed
adr: docs/adr/<...>.md
spec: docs/specs/<id>-design.md
plan: docs/plans/<id>.md
flow: <flow_id> # лінк на runtime-стан / completion snapshot
commits: [<sha>, ...] # step-commits (completion snapshot, §3 Ф5)
change: .changes/<id>.md
gates: { lint: ok, tests: ok, coverage: ok, trace: ok } # completion snapshot
notified: { ref: 'tg:team#…', at: '<ts>' } # або null
---
# <title>
## HITL          # YAML-блок §4.2 (hitl: [...])
## Summary       # final status, blocked/HITL history (completion snapshot, §3 Ф5)
```

```sh
npx @nitra/cursor trace            # усі ланцюги: де застряг кожен
npx @nitra/cursor trace <id>       # один граф
npx @nitra/cursor trace --json     # machine-readable
```

Граф: `ADR ↔ spec ↔ plan ↔ .flow.json ↔ .changes/<id>.md ↔ git commit`. Зшиває людино-читабельні артефакти (front-matter) + машинний стан + git-історію — однаково для людини й pi.dev.

---

## 8. Dual-Mode Dispatcher (гібридна оркестрація, інверсія контролю)

`n-cursor flow` — не завжди активний скрипт. Він дає **два фасади CLI** навколо єдиного джерела істини `.flow.json` (§4), для сумісності і з headless-скриптами (pi.dev/CI), і з розумними IDE-агентами (Cursor Composer, Claude Code). Патерн — **«Bring Your Own Agent»**.

### 8.1 Два фасади

**Фасад A — Пасивний Турнікет (Gatekeeper/Judge)** — для інтерактивних IDE, де агент має власний UI/модель і сам пише код. `n-cursor` **нікого не спавнить**, лише рухає стейт і судить:

- `flow init "<опис>"` — worktree + `.flow.json` (Ф1–Ф2). Якщо вже в придатному worktree — **не вкладає** новий (detect existing isolation).
- `flow verify` — Quality Gates (§5): lint, тести, `n-cursor coverage` з класифікатором → Pass або детальний лог (Ф4).
- `flow release` — `.changes` + фіналізація статусу + completion snapshot (§3 Ф5).

**Фасад B — Активний Раннер (Orchestrator)** — для pi.dev (headless) і CI:

- `flow run "<опис>"` — повний 5-фазний цикл: сам `init`, у циклі спавнить субагентів (Ф3, `SubagentRunner`), після кожного кроку програмно `verify`, в кінці `release`. Контракт виклику — §9.1.

**Зв'язок з §2:** фасад обирається **середовищем** (яку команду викликали), а не моделлю — надійніше за модельну детекцію. native/polyfill-маршрут (§2) діє **лише всередині Фасаду B**. Фасад A — це і є «розумний агент сам оркеструє» (те, що §2 називав `native`, без вгадування моделі).

### 8.2 Контракт з IDE (Cursor / Claude Code)

Sync матеріалізує правило `.cursor/rules/n-flow.mdc` (+ `CLAUDE.md`), щоб IDE-агенти знали Турнікет. Суть промпту: _«Ти — виконавець. Пишеш код сам, але: (1) старт через `flow init`; (2) написав крок — `flow verify`; (3) помилка → виправ і знову (3 спроби); (4) зелений verify → `flow release`»._
Майбутнє: ці команди — як нативні **MCP-інструменти** (`nitra_flow_verify()` через JSON-RPC) замість Bash.

### 8.3 Безшовний handoff

Обидва фасади на одному `.flow.json` → перемикання середовища **посеред** задачі:

1. Людина: `flow run "Додай кеш"` (Активний) → на кроці 2 субагент не проходить verify → `blocked-on-human` (§4.2). Раннер **звільняє lock** (§4.1 п.3), щоб передати естафету.
2. Людина відкриває репо в Cursor; агент бачить `.flow.json: blocked`, читає лог, фіксить код, кличе `flow verify` (Пасивний).
3. Зелено → задача продовжується/закривається. Стан і `trace` безперервні.

### 8.4 Інверсія контролю (під капотом)

`npm/scripts/dispatcher/` — матрьошка:

- **Рівень 1 (Суддя):** `state-store.mjs`, `reviewer.mjs` — лише FS/Git/JSON, **не знають** про LLM/API-ключі. Відповідають за `init`/`verify`/`release` (Фасад A).
- **Рівень 2 (Оркестратор):** `executor.mjs` — обгортка з LLM (`SubagentRunner`); генерує код, тоді кличе методи Рівня 1 для самоперевірки (Фасад B = Рівень 1 + 2).

Ця IoC гарантує **ідентичні, незламні Quality Gates** незалежно від автора коду — людина, Cursor Composer чи headless-субагент.

---

## 9. Автономний режим (резолв контрадикції)

> **Рішення 2.0 переважує §9 з v1.1.** Раніше було «pi.dev драйвить, n-cursor тонкий». Тепер spine — Sovereign, тож **драйвер — `n-cursor flow`** (власний двигун), а pi.dev — тригер/середовище.

`n-cursor flow --autonomous "<задача>"` на сервері:

- **Budget guard** (`.n-cursor.json → flow.autonomous`): `{ "maxApiCalls": 50, "maxCostUsd": 2.00, "onBudgetExceeded": "abort" }` — **двигун застосовує** (на відміну від v1.x, де це робив pi.dev).
- **Audit/events log** `.worktrees/<sanitized-branch>.events.jsonl` (append-only sibling, **єдиний** для WAL §4.1 і api-обліку) — типізовані події: `step_*`, `api_call` (timestamp, model, tokens, cost).
- **`--dry-run`** — план без API-викликів.
- На фейл `verify` → `status: failed` + лог; без «питати людину».

**Архітектурна межа двигуна:** `flow` спавнить **сфокусовані** субагенти покроково (а не один безконтрольний), стан між ними — через `.flow.json`. Прецедент headless-спавну: `npm/scripts/coverage-fix.mjs` (`claude-agent-sdk`).

### 9.1 Контракт виклику (pi.dev ↔ flow)

`n-cursor flow --autonomous` — **блокуючий синхронний** процес. pi.dev (зовнішній агент) запускає його й **чекає**; поки flow крутить цикл (spawn субагентів, TDD, рев'ю) — термінал pi.dev блокується. По завершенні pi.dev читає **exit code** і останній лог:

| Exit | Значення                           | Дія pi.dev                 |
| ---- | ---------------------------------- | -------------------------- |
| `0`  | успіх (Contract §5 виконано)       | merge / далі               |
| `1`  | фейл (gate / `verify` не пройдено) | за політикою (alert)       |
| `2`  | blocked-on-human (§4.2)            | інформувати відповідальних |

Останній лог — хвіст `.events.jsonl` (§4.1) + шлях у stdout. Це **єдиний контракт** між зовнішнім агентом і Диспетчером: subagent-оркестрація лишається **всередині** `flow` (pi.dev її не бачить і не координує — закриває й частину §15.1).

---

## 10. Файлова структура пакета

```
npm/
├─ bin/n-cursor.js                 # case 'flow' (init/verify/release/run) / 'trace' → dispatcher
├─ config/
│   └─ capability-matrix.json      # матриця можливостей (§2.1)
├─ rules/
│   └─ worktree/worktree.mdc       # канонічне pure-doc правило (однина)
├─ scripts/dispatcher/
│   ├─ index.mjs                   # парсинг argv, оголошення моделі, ініціалізація
│   ├─ planner.mjs                 # Ф1 (JSON-план)
│   ├─ executor.mjs                # Ф3 (сесії субагентів)
│   ├─ reviewer.mjs                # Ф4 (lint + coverage + semantic)
│   ├─ native.mjs                  # native payload: інтерфейс визначено, активується за наявності native_workflows
│   └─ lib/
│        ├─ prompts.mjs            # суверенні prompt-шаблони (System/User) + snapshot-тести
│        └─ state-store.mjs        # read/write/update .flow.json (атомарно)
└─ skills/
    └─ worktree/
         ├─ SKILL.md               # тонкий скілл для pi.dev/агентів (як керувати CLI)
         └─ meta.json              # { "worktree": false }  (ізоляція від рекурсії)
```

---

## 11. Міграція worktree-правила

`n-worktrees.mdc` (множина) **видаляється**; через sync розгортається пакетне `n-worktree.mdc` (однина), переписане під автоматичний виклик CLI. **Legacy не підтримуємо.**

> ⚠️ Звірити поточний стан назв (`.cursor/rules/n-worktree.mdc` уже згадується в `CLAUDE.md`) — узгодити зі spec `worktree-cli`, щоб не розійтись.

---

## 12. Accepted Risks & Mitigations

Ризики прийняті свідомо; кожен має мітигацію.

| #    | Ризик                                                   | Мітигація                                                                                                                                                                                        | Залишковий ризик                                                    |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 12.1 | **Немає рантайм-детекції моделі**                       | Модель **оголошується явно** (§2.2); default → `polyfill`                                                                                                                                        | помилкова декларація → не той маршрут (видно в `.flow.json`)        |
| 12.2 | **Непрозорі шари в інтерактиві**                        | **Знято Dual-Mode (§8):** в IDE працює Фасад A (Пасивний Турнікет) — `n-cursor` нікого не спавнить, агент пише код видимо. Власний двигун (Фасад B) — лише headless, де нема людини-спостерігача | у headless спостережуваність — через `.events.jsonl` + `trace`      |
| 12.3 | **Форк промптів = maintenance-тягар**                   | `prompts.mjs` як версіонована IP + snapshot-тести + **ревізія під кожен реліз моделі**                                                                                                           | втрата апстрім-ідей superpowers (компенсується періодичним оглядом) |
| 12.4 | **Subagent зависає на невбивному (equivalent) мутанті** | gate = clean Killable 100%; reviewer передає в repair **лише killable** survivors (allow-list класифікатора, §3 Ф4); fallback 3 спроби → HITL (§4.2)                                             | false-negative класифікатора → зайвий цикл, далі HITL               |
| 12.5 | **`native.mjs` поки без активної реалізації**           | інтерфейс визначено; активується за наявності `native_workflows`-моделі/API                                                                                                                      | до того весь трафік — через polyfill                                |

**Тригери повернення до compose-and-extend (§13):** maintenance промптів стане непідйомним; або харнеси (Claude Code/Cursor/pi.dev) почнуть давати простежуваність/контракт нативно, знецінюючи власний двигун.

---

## 13. Compose-and-Extend — тепер Фасад A (примирено Dual-Mode)

Початково compose-and-extend (n-cursor = лише Contract/state/trace; _оркеструє_ харнес) було відкинуто на користь повного Sovereign. **Dual-Mode (§8) їх примирює:** Пасивний Турнікет (Фасад A) **і є** compose-and-extend для інтерактивних середовищ — IDE/харнес оркеструє, `n-cursor` судить. Активний Раннер (Фасад B) лишає Sovereign-двигун для headless. Тобто це не «або-або», а вибір **за середовищем**.
`superpowers` лишається **не**-залежністю: baseline для IDE задає правило `n-flow.mdc` (§8.2), а не superpowers. Аргументи-ризики з §12 (нема детекції моделі тощо) чинні **лише для Фасаду B**.

---

## 14. План розгортання й тестування

**Тестування:** усі функції `state-store.mjs` і парсинг промптів — ізольовані юніт-тести. Сценарії `resume` й обробка фейлів Quality Gates — у git-пісочницях через `withTmpDir` (вимоги `n-test.mdc`: без `process.chdir`, абсолютні шляхи, `pool: 'forks'`).

**Впровадження (фази):**

- **v2.0-a:** `dispatcher/` polyfill-двигун (Ф1–Ф5) + `capability-matrix.json` + `state-store.mjs` + `flow`/`resume`/`cancel`.
- **v2.0-b:** `n-cursor verify` (контракт §5) + `n-cursor trace` (§7) + front-matter конвенція.
- **v2.0-c:** `--autonomous` (budget guard, audit log, `--dry-run`) (§9).
- **v2.1:** активувати реалізацію `native.mjs` (інтерфейс уже визначено), щойно з'явиться модель/API з `native_workflows`.

**Міграція шляхів (legacy не підтримуємо):** `git mv docs/superpowers/{specs,plans}` → `docs/{specs,plans}`; видалити `n-worktrees.mdc`; оновити `CLAUDE.md`.

---

## 15. Resolved & Open Questions

1. ✅ **[Resolved] Subagent-спавн у polyfill:** дефолт `claude-agent-sdk` (програмний `query()`, прецедент `coverage-fix.mjs`; повертає контроль двигуну + керована передача моделі/бюджету), за абстракцією `SubagentRunner` (плагіни `claude -p` / `cursor-agent -p` — прецедент `skills-cli.mjs`, RUNNERS `{claude, cursor}`). **Dependency boundary:** `@anthropic-ai/claude-agent-sdk` — **optional dependency**, **динамічний import** (як `coverage-fix.mjs`); потребує `ANTHROPIC_API_KEY`. Fallback `claude -p`/`cursor-agent -p` — на **CLI-auth** користувача (без API key). Нема ні SDK, ні CLI → fail із діагностикою. **pi.dev для inner-спавну — ні:** (а) нема headless pi-спавну; (б) рекурсія pi.dev→flow→pi.dev (§9.1). pi.dev лишається outer-тригером.
2. ✅ **[Resolved] Інтеграція з Cursor/Claude Code:** IDE не керуються ззовні, а використовують Диспетчер як **Пасивний Турнікет** (`init`/`verify`/`release`, §8.1) за вказівками у `.cursor/rules/n-flow.mdc` (або як **MCP-сервер** у майбутньому). Знімає потребу в «перехопленні» керування агентами.
3. **Документація (етап 6):** маркер derived чи explicit `docs:`? Дефолт — derived.
4. **Notify (етап 8):** канал за замовчуванням + резолв «відповідальних» (CODEOWNERS vs `owners:`).
5. **prompts.mjs cadence:** хто й коли ре-тюнить промпти під нові релізи моделей (власник §12.3).
6. **Interactive-режим:** _(частково знято §8: Фасад A — легкий прохід `init`/`verify`/`release`)_ — лишилось уточнити «дрібні правки без `init`».

---

## 16. Більше інформації

- `npm/bin/n-cursor.js:1435–1546` — command dispatch (додати `flow`/`trace`/`verify`)
- `npm/scripts/worktree-cli.mjs` — `n-cursor worktree` (Ф2)
- `npm/rules/test/coverage/coverage.mjs`, `npm/scripts/coverage-classify/` — `n-cursor coverage` + LLM-класифікатор (Ф4)
- `npm/rules/release/change.mjs` — `.changes/<id>.md` (Ф5)
- `npm/scripts/coverage-fix.mjs` — прецедент headless `claude-agent-sdk` (Ф3/§9)
- `.pi/extensions/n-cursor-adr/`, `.claude/hooks/capture-decisions.sh` — pi.dev + ADR авто-капче
- `.cursor/skills/n-publish-telegram/SKILL.md` — основа етапу notify
