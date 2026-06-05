---
kind: nitra-plan
id: n-cursor-flow-v2.0-a
spec: docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md
status: draft
date: 2026-05-31
scope: Polyfill-двигун (Фасад B) поверх Level-1 фундаменту (Фасад A)
---

# План реалізації: n-cursor flow v2.0-a

**Spec:** [`2026-05-31-n-cursor-lifecycle-composition-design.md`](2026-05-31-n-cursor-lifecycle-composition-design.md) (v2.7)
**Scope:** polyfill-двигун (`flow run`, Фасад B) + Level-1 фундамент (`init`/`verify`/`release`, Фасад A). **Поза scope:** `native.mjs` (v2.1), trace/notify (§7/§8 етап), міграція шляхів.

## Порядок збірки (обґрунтування)

За IoC §8.4: **Level 1 (Суддя)** — фундамент, від якого залежить **Level 2 (Оркестратор)**. Тому будуємо **знизу вгору**: спершу Level 1 (`state-store` → `verify`/`init`/`release` = Фасад A, чистий FS/Git/JSON, **без LLM**), тоді Level 2 (`executor` + `SubagentRunner` = Фасад B). Переваги: (1) ризикову LLM-оркестрацію беремо **останньою**, на вже протестованому фундаменті; (2) після Фази 2 **Фасад A уже придатний до використання** (IDE-Турнікет працює) — рання цінність.

**Тести (наскрізно, §14 + `n-test.mdc`):** усе в git-пісочницях через `withTmpDir`, абсолютні шляхи, **без** `process.chdir`, `pool: 'forks'`. `SubagentRunner` у тестах executor-а — **мок** (нуль реальних API-викликів). `state-store`/`reviewer`/`planner` — чисті unit-тести.

---

## Фаза 0 — Каркас і CLI-розводка

- [ ] **T0.1 — dispatcher skeleton + CLI case.** Створити `npm/scripts/dispatcher/{index.mjs,lib/}`. У `npm/bin/n-cursor.js` додати `case 'flow'` → `dispatcher/index.mjs`, що парсить підкоманду (`init|verify|release|run|resume|cancel|repair`) і поки кидає `not implemented`.
      _Тест:_ кожна підкоманда маршрутизується; невідома → exit 1 з підказкою.
- [ ] **T0.2 — capability-matrix + декларація моделі.** `npm/config/capability-matrix.json` + резолвер у `index.mjs` (§2.2: CLI `--model` › env `N_CURSOR_FLOW_MODEL` › `.n-cursor.json#flow.model` › default `polyfill`). Default-polyfill **тільки** за наявного runner-а (§2.2), інакше fail.
      _Тест:_ пріоритет джерел; unknown→polyfill лише з runner-ом, інакше діагностика.

## Фаза 1 — Level 1: `state-store` (crash-safe)

- [ ] **T1.1 — atomic state I/O.** `dispatcher/lib/state-store.mjs`: read/write/update `.worktrees/<branch>.flow.json` (sibling, §4). Atomic temp(той самий FS)+`fsync`+`rename` (§4.1.1); `schema_version`.
      _Тест:_ round-trip; нема часткового запису на симульованому краші; пошкоджений → **fail-closed** (§4.1.6).
- [ ] **T1.2 — WAL.** Append-only `.worktrees/<branch>.events.jsonl`: подія **перед** зміною статусу (§4.1.2); reconcile при resume.
      _Тест:_ подія дописана до мутації; реконсиляція після обриву.
- [ ] **T1.3 — lock (reuse `withLock`).** `npm/scripts/utils/with-lock.mjs` з `key: flow-<sanitized-branch>`, `cacheDir` під `.worktrees/`; **override** fallback «run-unlocked» → **fail-closed** (§4.1.3).
      _Тест:_ серіалізація конкурентних; stale (TTL/PID) очищається; fail-closed замість unlocked.
- [ ] **T1.4 — sibling lifecycle.** Створення/cleanup `.flow.json`/`.events.jsonl`/логів разом із worktree (узгодити з `worktree remove`).
      _Тест:_ `remove`/`cancel` прибирають усі sibling-и.

## Фаза 2 — Level 1: Фасад A (`init` / `verify` / `release`) — **shippable**

- [ ] **T2.1 — `flow init`.** Worktree через `n-cursor worktree add` (reuse, Ф2) + ініціалізація `.flow.json`. **Detect existing isolation** (§8.1): уже в придатному worktree → не вкладати новий.
      _Тест:_ створює worktree+стан; вкладений виклик → reuse, не дублює.
- [ ] **T2.2 — `reviewer.mjs` + `flow verify`.** Gates (§5): lint (`n-cursor lint`), тести, `n-cursor coverage` (clean Killable 100% з allow-list класифікатора, §3 Ф4). Кожен gate фіксує **fingerprint** (`worktree-fingerprint.mjs`, §5); verify звіряє проти stale; `exit 0/1` із зазначенням gate. Audit-звіт allowed-gaps у `.flow.json` (§3 Ф4).
      _Тест:_ pass/fail на кожен gate; stale-fingerprint → недійсно; allow-list не йде в repair; audit-звіт записаний.
- [ ] **T2.3 — `flow release` + completion snapshot.** `n-cursor change` (reuse, Ф5) + фіналізація статусу + **completion snapshot** у task record `docs/tasks/<id>.md` (§3 Ф5, §7: status/commits/gates/change/notify/hitl).
      _Тест:_ change-файл створено; snapshot містить commits+gates; durable після cleanup стану.
- [ ] **T2.4 — правило `n-flow.mdc` (контракт Турнікету, §8.2).** Bundled `npm/rules/flow/flow.mdc` + матеріалізація при sync; промпт «init→verify(3 спроби)→release».
      _Тест:_ `n-cursor fix` матеріалізує правило; вміст відповідає §8.2.

> **Майлстоун:** Фасад A повний — IDE-агент (Cursor/Claude Code) може користуватись Турнікетом без Level 2.

## Фаза 3 — Level 2: `SubagentRunner` + `planner`

- [ ] **T3.1 — `SubagentRunner` (§15.1).** Абстракція; дефолт `claude-agent-sdk` (**dynamic import**, optional dep, `ANTHROPIC_API_KEY`); fallback `claude -p`/`cursor-agent -p` (CLI-auth). Нема нічого → fail-діагностика.
      _Тест (мок SDK/CLI):_ вибір runner-а; передача моделі; відсутність → fail.
- [ ] **T3.2 — `planner.mjs` (Ф1).** Згенерувати JSON-план (кроки ≤5 хв + критерії приймання) у `.flow.json`.
      _Тест:_ схема плану валідна; кроки парсяться; порожній/невалідний → fail-closed.

## Фаза 4 — Level 2: `executor` + `flow run`

- [ ] **T4.1 — `executor.mjs` (Ф3).** Ітерація плану; на крок — **мікропромпт зі стану** (§3 Ф3, без історії), спавн субагента, TDD. **Commit-інваріант** (§4.1.7): коміт **тільки після** gates; repair не комітить.
      _Тест:_ мікропромпт зібрано зі стану (не з діалогу); коміт лише post-gate.
- [ ] **T4.2 — repair-цикл + HITL.** Per-step retry (max 3, §3 Ф4) → на вичерпанні **structured HITL** (§4.2: YAML-блок у task record, `blocked-on-human`).
      _Тест:_ лічильник retry per-step; HITL-YAML записано; `resume` читає `answer`.
- [ ] **T4.3 — `flow run` + `resume`/`cancel`/`repair`.** Повний цикл init→loop(executor+verify)→release. **Safe-resume** (§4.1.7: dirty-check + `git stash`, без `reset --hard`); `repair --discard-step-work`.
      _Тест:_ happy-path (мок runner); resume посеред кроку з чистого чекпойнта; cancel прибирає sibling-и.
- [ ] **T4.4 — `flow run --autonomous` + контракт §9.1.** Budget guard (`flow.autonomous.maxApiCalls/maxCostUsd`); exit-коди **0/1/2** (ok/fail/needs-human); блокуючий синхронний контракт.
      _Тест:_ budget-abort; коректні exit-коди на кожен результат.

---

## Залежності й послідовність

```
Ф0 → Ф1 (state-store) → Ф2 (Фасад A: verify/init/release ✅shippable)
                                   ↓
                         Ф3 (SubagentRunner+planner) → Ф4 (executor+run, Фасад B)
```

Level 2 **не починаємо**, поки Level 1 (Ф1–Ф2) не зелений. `native.mjs` — окремий план v2.1.

## Definition of Done (для всього v2.0-a)

- `flow init/verify/release/run/resume/cancel/repair` працюють; `flow run` проганяє повний цикл на демо-задачі (мок-runner у CI, реальний — локально).
- Покриття: `state-store`, `reviewer`, `planner`, резолвер моделі — unit-тести; `executor`/`run` — інтеграційні з мок-runner; усі в `withTmpDir`.
- Сам пакет проходить власні gates: `n-cursor lint` + `n-cursor coverage` (clean Killable за порогом) + `.changes/` запис.
