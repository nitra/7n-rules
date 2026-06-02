---
kind: nitra-spec
status: draft
adr: null
plan: null
risk: high
---

# Push-оркестратор DAG блоків — дизайн

Дата: 2026-06-01
Власник: @vitaliytv
Статус: Draft (очікує апруву)

## Мета

Автоматично роздавати блоки графа (контракт
`docs/specs/2026-06-01-block-dag-state.md`): координатор сам бере `ready`-вузли,
**спавнить виконавця** (LLM у власному worktree) або кладе у людську чергу,
збирає `fact`, перераховує граф і повторює — доки граф не вичерпано. Стан —
винятково у файлах; оркестратор **stateless** (щотіку перечитує граф).

`risk: high` — оркестратор авто-спавнить агентів і авто-мерджить; помилка
дорога, тому глибокий review і людські ворота на ризикових вузлах.

## Принципи

1. **Stateless tick** — жодного власного стану; кожен прохід деривує граф із
   файлів. Краш-безпека «безкоштовно»: вбий будь-коли, перезапуск = новий tick.
2. **Push із routing** — координатор диспатчить, але **за level/risk**:
   low/med-risk → авто-LLM; **high-risk → людська черга** (не авто).
3. **Атомарність усіх файлів графу** (див. нижче) — нема торн-рідів і подвійних
   взять навіть при паралельних виконавцях і кількох машинах.
4. **Ізоляція** — кожен блок у власному worktree/гілці; фан-ін зливає.

## Атомарність файлів графу

Кожен артефакт атомарний на двох рівнях.

| Файл | Семантика | Локальний примітив | Розподілено |
| --- | --- | --- | --- |
| `*.plan.md` | write-once (immutable) | `writeFileSync(p, …, {flag:'wx'})` | 1 commit |
| `*.claim.md` | create-once (лок) | `wx` (`O_CREAT\|O_EXCL`) — EEXIST=зайнято | commit+**push** (перший виграє) |
| `*.fact.md` | write-once (термінал) | `wx` | 1 commit |
| `*.beat` | mutable (heartbeat) | temp+fsync+`rename` (як `.flow.json`) | не комітиться (transient) |

- **Heartbeat винесено** з claim у окремий `*.beat` → claim лишається immutable;
  єдиний мутабельний файл оновлюється атомарним `rename` (replace, без торн-рідів).
- `rename` атомарний на тій самій ФС (temp у тій самій теці) — наявний патерн
  `state-store`.
- **У git одиниця атомарності — commit**; **push** — розподілений арбітр (claim
  одним комітом → перший push у remote = власник; чужий → rejection → відступ).

Отже **жоден файл графу не переписується конкурентно**: plan/claim/fact —
write-once; beat — atomic-replace; арбітр взяття — push.

## Tick (ядро оркестратора)

```text
tick(graph):
  nodes  = scan(blocks/*.plan.md)              # id, dependsOn, owner, level, risk
  status = derive(nodes, claim?, fact?, beat?)  # чиста функція (з block-dag-state spec)
  reap_stale(status.in_progress)                # beat старший за TTL → claim вільний
  ready  = status.ready
  for n in ready (до WIP-ліміту):
     if route(n) == human: enqueue_human(n); continue     # high-risk → черга людей
     if claim(n) == 'busy': continue                       # хтось встиг (push-арбітр)
     dispatch_llm(n)                                        # flow run у worktree n.branch
  on fact(n) appears: (наступний tick підхопить — нічого не тримаємо)
  terminate if: усі done | (нема ready та є blocked-on-failed) → report
```

- **route(n)**: `risk==='high'` → human; інакше llm (level/risk керують лише
  глибиною review всередині блоку).
- **claim(n)**: атомарний `wx`; локально EEXIST → skip; далі commit+push, на
  rejection → fetch+skip (хтось перший).

## Dispatch виконавця

- **LLM:** для блоку — окремий `flow` у його worktree: `flow run <n.branch>`
  (5-фазний цикл: plan→TDD→verify→review→gate) через `subagent-runner`
  (+`withBudget`). По завершенню `flow` пише completion → оркестратор проєктує у
  `<id>.fact.md` (`wx`).
- **Human:** блок потрапляє у `ready`-чергу (`graph status`/нотифікація);
  людина бере вручну (claim) і робить свій flow. Оркестратор лише чекає `fact`.

## Concurrency / WIP

- **WIP-ліміт** (напр. `--max 4`) — не більше N паралельних dispatch.
- Подвійне взяття неможливе: claim — атомарний лок (`wx` локально + push глобально).
- Кожен LLM-виконавець — свій worktree → нема конфліктів за файли.

## Фан-ін (злиття паралельних гілок)

- **Integration-блок**: звичайний вузол із `dependsOn` на паралельний набір;
  його робота — merge гілок виконаних блоків + `verify`/`gate` на результаті.
- Merge-конфлікт → `fact: failed` з причиною → ескалація людині (не авто-форс).

## Провал і ретраї

- `fact.status==='failed'` → залежні лишаються `blocked`; вузол не `done`.
- Ретраї на рівні блоку — наявні executor'ні (≤3) → далі HITL.
- Якщо `ready` порожній, а є `blocked` через `failed` → граф **stalled**:
  оркестратор репортить і зупиняється (рішення за людиною).

## Stale-виконавці

`*.beat` не оновлювався довше за TTL (напр. 30 хв) → claim вважається мертвим;
репер видаляє `claim`+`beat` (commit+push) → вузол знову `ready`. Або ручний
`graph repair`.

## CLI-поверхня

| Команда | Дія |
| --- | --- |
| `n-cursor graph status` | скан → таблиця позиції DAG (read-only) |
| `n-cursor graph tick [--max N]` | один прохід: claim+dispatch ready (ідемпотентний) |
| `n-cursor graph run [--max N]` | цикл tick'ів до завершення/stall |
| `n-cursor graph repair` | зняти осиротілі claim (stale) |

Усе ідемпотентне й stateless → безпечно з CI/cron/руки.

## Перевикористання n-cursor

`subagent-runner` (спавн), `flow run`/`resume` (цикл на блок), `withBudget`
(ліміт API), worktree-ізоляція, `trace` (граф-в'ю), `state-store` (atomic
rename для `beat`). Оркестратор — тонкий tick поверх цього.

## Зв'язок із тестами

- `derive`/`route`/`reap_stale` — чисті, таблиця сценаріїв (ready/blocked/stale/route).
- `tick` — ін'єкція `scan`/`claim`/`dispatch`/`now`; без реального git/LLM.
- claim — атомарність: другий `wx` на той самий шлях → EEXIST → 'busy'.

## Scope

**In:** stateless `tick`/`run`/`status`/`repair`; push-dispatch LLM + human-черга
за route; атомарні файли графу (write-once + beat-rename); фан-ін через
integration-блок; stalled-репорт.

**Out (окремо):** GUI-дашборд; авто-генерація графа з однієї спеки (декомпозиція);
крос-репо графи; пріоритезація/критичний шлях (поки FIFO серед ready).

## Відкриті питання

- Хто пише `fact` за LLM-блок: сам `flow release` (як артефакт-вузол) чи
  оркестратор-проєкція? — схиляюсь до `flow` пише, оркестратор лише читає.
- WIP-ліміт глобальний чи per-owner-type (окремо люди / LLM)?
- Чи комітити `beat` (видимість мертвих локів крос-машинно) — компроміс
  «видимість vs шум комітів»; дефолт — transient (локально).
