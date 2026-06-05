---
kind: nitra-plan
status: draft
spec: ../specs/2026-05-31-n-cursor-lifecycle-composition-design.md
flow: null
implemented:
  state: false
  commits: []
  change: null
  verifiedAt: null
---

# Фази `spec` і `plan` (brainstorm → план) для n-cursor flow

> **For agentic workers:** дрібні TDD-кроки (спершу падаючий тест). Точні шляхи,
> повний код, жодних `TBD`. Канон — як у сусідніх `npm/scripts/dispatcher/lib/`
> (україномовний JSDoc, ін'єкції IO, fail-closed, vitest без реальних процесів).
> Коміти часті; версію/CHANGELOG руками не чіпати (лише `.changes/` наприкінці).

**Goal:** Закрити крок lifecycle **Spec→Plan** (traceability-design §3-4) двома
командами-турнікетами — `flow spec` і `flow plan` — і **вставити відсутній
brainstorm**: human↔agent (дефолт) та agent↔agent (`--panel`). Артефакти — у
канон `docs/specs/` + `docs/plans/`.

**Architecture:** обидві команди — Пасивний Турнікет: не пишуть код, у дефолті не
спавнять субагентів. Вони **фіксують** артефакти, що їх сформував агент (за
контрактом `.mdc`), і **верифікують** ланцюг наявним read-only `n-cursor trace`.
`--panel` веде agent↔agent brainstorm через `subagent-runner` Фасада B (спільний
модуль `plan-panel.mjs`). Ворота `verify` — **м'які** (попередження).

**Tech Stack:** Node ESM, vitest, наявні `dispatcher/lib/*`
(`state-store`, `planner`, `subagent-runner`, `events`), `dispatcher/trace.mjs`.

---

## Рішення (узгоджено з власником)

1. **Без суфікса `-design`.** Spec живе як `docs/specs/<date>-<slug>.md` — рівно
   як приклади у traceability-design (рядки 157/175: `…/specs/20260531-example.md`).
   Старі файли з `-design.md` лишаються; нова конвенція — без суфікса.
2. **Розщеплення на дві команди** `flow spec` + `flow plan` під дві lifecycle-фази
   (Spec, Plan) — замість однієї `flow plan`.
3. **`trace` — read-only верифікатор, не лінкер.** `trace link` не існує
   ([trace.mjs](../../npm/scripts/dispatcher/trace.mjs) лише парсить/флагує розриви).
   Тому frontmatter-лінки (`spec.plan`, `plan.spec`, `plan.flow`) **пише агент**
   за контрактом `.mdc`; наші команди викликають `trace` як **перевірку** і
   попереджають на розривах. (Мутатор `trace link` — окремий майбутній скоуп.)
4. **HITL у `--panel`** — апрув людини контрактом `.mdc` (ОК).

---

## Потік після змін

```
flow init <branch> "<опис>"                       → status: in_progress
[brainstorm: дизайн/підходи]
flow spec [--panel]                                ← НОВЕ
  → фіксує docs/specs/<date>-<slug>.md, trace-перевірка, status: spec
[brainstorm: декомпозиція в кроки]
flow plan [--panel]                                ← НОВЕ
  → фіксує docs/plans/<date>-<slug>.md, plan[] у .flow.json, status: planned
[пишеш код, TDD]
flow verify     → м'яке попередження, якщо плану нема (НЕ блокує)
flow release …  → status: done
```

`.flow.json` schema_version незмінний: додаємо лише значення `status: 'spec'`/
`'planned'` і поля-вказівники `spec_doc`/`plan_doc`.

---

## File Structure

- **Новий:** `npm/scripts/dispatcher/lib/artifact.mjs` — спільне: резолв
  найсвіжішого `docs/<kind>/*.md`, екстракт кроків `## Кроки`, виклик read-only
  `trace` як перевірки. (DRY для `spec`/`plan`.)
- **Новий:** `npm/scripts/dispatcher/lib/spec.mjs` — handler `spec`.
- **Новий:** `npm/scripts/dispatcher/lib/plan.mjs` — handler `plan`.
- **Новий:** `npm/scripts/dispatcher/lib/plan-panel.mjs` — agent↔agent brainstorm (спільний).
- **Модифікація:** `npm/scripts/dispatcher/lib/planner.mjs` — `parsePlan` відхиляє placeholder.
- **Модифікація:** `npm/scripts/dispatcher/trace.mjs` — додати `flow` у `LINK_FIELDS` (щоб plan→flow простежувався).
- **Модифікація:** `npm/scripts/dispatcher/index.mjs` — `spec`/`plan` у `SUBCOMMANDS`/`DEFAULT_HANDLERS`/`USAGE`.
- **Модифікація:** `npm/scripts/dispatcher/lib/commands.mjs` — `verify` м'яке попередження.
- **Модифікація:** `npm/rules/flow/flow.mdc` — кроки «Spec» і «План» (обидва режими, soft-gate).
- **Тести:** `tests/{artifact,spec,plan,plan-panel}.test.mjs`; доповнити `commands.test.mjs`, `trace.test.mjs`.
- **Changelog:** `.changes/` через `n-cursor change` (Added).

---

## Task 1: `parsePlan` відхиляє placeholder-кроки

**Files:** Modify `lib/planner.mjs`; Test `tests/planner.test.mjs`

- [ ] **Крок 1: падаючий тест**

```js
test('відхиляє placeholder-кроки (TBD/порожній) — fail-closed', () => {
  expect(() => parsePlan('[{"task":"TBD"}]')).toThrow(/placeholder|TBD/i)
  expect(() => parsePlan('[{"task":"  "}]')).toThrow()
})
```

- [ ] **Крок 2: запустити — впаде.**
- [ ] **Крок 3: реалізація — у `.map` `parsePlan`, після перевірки `task`:**

```js
const PLACEHOLDER = /^(tbd|todo|fixme|\.\.\.|placeholder)$/i
const trimmed = task.trim()
if (!trimmed || PLACEHOLDER.test(trimmed)) {
  throw new Error(`planner: крок ${i} — placeholder/порожній task (${task}) — fail-closed`)
}
```

- [ ] **Крок 4: тести зелено. Крок 5: commit** `refactor(flow): planner відхиляє placeholder-кроки`

---

## Task 2: `trace` простежує лінк plan→flow

**Files:** Modify `npm/scripts/dispatcher/trace.mjs`; Test `tests/trace.test.mjs`

- [ ] **Крок 1: тест — `flow:`-лінк аналізується (ok/розрив)**

```js
test('лінк flow аналізується як ланка ланцюга', () => {
  const a = analyze(
    [{ file: 'docs/plans/p.md', fm: { kind: 'nitra-plan', flow: '../../.worktrees/x.flow.json' } }],
    () => false
  )
  expect(a[0].links.find(l => l.field === 'flow').ok).toBe(false)
})
```

- [ ] **Крок 2: запустити — впаде (`flow` не в `LINK_FIELDS`).**
- [ ] **Крок 3: реалізація** — `const LINK_FIELDS = ['adr', 'spec', 'plan', 'flow', 'change', 'task']`.
- [ ] **Крок 4: тести зелено. Крок 5: commit** `feat(trace): простежувати лінк plan→flow`

---

## Task 3: Спільний модуль `artifact.mjs`

**Files:** Create `lib/artifact.mjs`; Test `tests/artifact.test.mjs`

DRY для `spec`/`plan`: резолв найсвіжішого артефакту, екстракт кроків,
read-only trace-перевірка.

- [ ] **Крок 1: тести**

```js
import { resolveArtifact, extractSteps, verifyTrace } from '../artifact.mjs'

test('resolveArtifact: найсвіжіший .md у docs/<kind>', async () => {
  await withTmpDir(async dir => {
    const d = join(dir, 'docs', 'specs')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, '2026-01-01-a.md'), 'x')
    writeFileSync(join(d, '2026-02-01-b.md'), 'y')
    expect(resolveArtifact(dir, 'specs')).toBe(join(d, '2026-02-01-b.md'))
  })
})

test('extractSteps: нумерований список ## Кроки', () => {
  const s = extractSteps('## Кроки\n1. A — acceptance: ok\n2. B\n')
  expect(s).toEqual([{ task: 'A', acceptance: 'ok' }, { task: 'B' }])
})

test('verifyTrace: код 0 → true; код 1 (розрив) → false (не кидає)', () => {
  expect(verifyTrace('/wt', () => 0)).toBe(true)
  expect(verifyTrace('/wt', () => 1)).toBe(false)
})
```

- [ ] **Крок 2: реалізація `artifact.mjs`**

```js
/**
 * Спільні утиліти фаз spec/plan: резолв артефакту в docs/<kind>, екстракт
 * кроків плану, read-only перевірка ланцюга через `n-cursor trace`.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Найсвіжіший `docs/<kind>/*.md` (лексикографічно — дата у префіксі).
 * @param {string} cwd корінь worktree
 * @param {'specs' | 'plans'} kind підкаталог docs
 * @returns {string | null} абсолютний шлях або null
 */
export function resolveArtifact(cwd, kind) {
  const dir = join(cwd, 'docs', kind)
  if (!existsSync(dir)) return null
  const md = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
  return md.length ? join(dir, md[md.length - 1]) : null
}

/**
 * Кроки зі секції `## Кроки` (`N. <task> — acceptance: <crit>`). Best-effort.
 * @param {string} text вміст plan-doc
 * @returns {{ task: string, acceptance?: string }[]} кроки
 */
export function extractSteps(text) {
  const steps = []
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*\d+\.\s+(.*)$/)
    if (!m) continue
    const [task, acceptance] = m[1].split(/\s+—\s+acceptance:\s+/i)
    steps.push(acceptance ? { task: task.trim(), acceptance: acceptance.trim() } : { task: task.trim() })
  }
  return steps
}

/**
 * Read-only перевірка цілісності ланцюга артефактів. Не мутує — лише сигнал.
 * @param {string} cwd корінь
 * @param {(cwd: string) => number} [runTrace] runner trace (0 — цілісно)
 * @returns {boolean} true, якщо ланцюг цілісний
 */
export function verifyTrace(cwd, runTrace) {
  const run =
    runTrace ??
    (c => {
      const { spawnSync } = require('node:child_process')
      return spawnSync('npx', ['@nitra/cursor', 'trace'], { cwd: c }).status ?? 1
    })
  return run(cwd) === 0
}
```

> `require` → за канону ESM звести до верхнього `import { spawnSync }` (тести
> інжектять `runTrace`). Звір зі стилем сусідів.

- [ ] **Крок 3: тести зелено. Крок 4: commit** `feat(flow): спільні утиліти артефактів spec/plan`

---

## Task 4: Команда `flow spec [--panel]`

**Files:** Create `lib/spec.mjs`; Test `tests/spec.test.mjs`

Контракт: без стану → 1. Резолвить (або бере з аргументу `<spec.md>`) spec-doc у
`docs/specs/`. Нема → 1 з підказкою. `--panel` → brainstorm-панель (синтез
підходів) перед фіксацією. Фіксує `spec_doc`, `status: 'spec'`; запускає
`verifyTrace` (warn на розриві).

- [ ] **Крок 1: тести** — без стану → 1; нема spec-doc → 1; валідний spec-doc → `status: 'spec'`, `spec_doc` у стані; розрив trace → warn, але код 0.
- [ ] **Крок 2: реалізація `spec.mjs`** (скелет):

```js
/**
 * `flow spec [--panel] [<spec.md>]` — фаза дизайну (Пасивний Турнікет).
 * Фіксує docs/specs/<…>.md (дизайн із brainstorm), верифікує ланцюг через trace.
 * Лінки frontmatter пише агент за контрактом .mdc (trace — лише перевірка).
 */
import { existsSync } from 'node:fs'
import { cwd as processCwd } from 'node:process'
import { flowEventsPath } from './events.mjs'
import { resolveArtifact, verifyTrace } from './artifact.mjs'
import { runPanel } from './plan-panel.mjs'
import { flowStatePath, readState, recordTransition } from './state-store.mjs'

export async function spec(rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const state = readState(flowStatePath(cwd))
  if (!state) {
    log('spec: стану нема — спершу `flow init`')
    return 1
  }

  if (rest.includes('--panel')) {
    const synth = await runPanel({ task: state.branch, cwd, runner: deps.runner, log, mode: 'spec' })
    if (synth) log('spec: панель синтезувала підходи — збережи дизайн у docs/specs/ і повтори `flow spec`')
  }

  const doc = rest.find(a => a.endsWith('.md')) ?? resolveArtifact(cwd, 'specs')
  if (!doc || !existsSync(doc)) {
    log('spec: нема docs/specs/<date>-<slug>.md — спершу пройди brainstorm (див. flow.mdc)')
    return 1
  }
  if (!verifyTrace(cwd, deps.trace)) log('⚠️ spec: trace виявив розрив ланцюга — перевір лінки frontmatter')

  recordTransition(
    { statePath: flowStatePath(cwd), eventsPath: flowEventsPath(cwd) },
    { type: 'spec' },
    s => ({ ...s, spec_doc: doc, status: 'spec' }),
    deps.now ?? Date.now
  )
  log(`spec: зафіксовано ${doc} → status: spec`)
  return 0
}
```

- [ ] **Крок 3: тести зелено. Крок 4: commit** `feat(flow): команда spec (фаза дизайну, обидва режими)`

---

## Task 5: Команда `flow plan [--panel]`

**Files:** Create `lib/plan.mjs`; Test `tests/plan.test.mjs`

Аналогічно `spec`, але: резолв `docs/plans/`, екстракт кроків (`extractSteps`) →
`parsePlan` (нормалізація+валідація) → запис `plan[]`, `plan_doc`,
`status: 'planned'`; `verifyTrace` (warn). М'яка передумова: якщо `status` ще не
`'spec'` — лог-нагадування «спершу `flow spec`», але **не блокує** (узгоджено з
м'якими воротами).

- [ ] **Крок 1: тести** — без стану → 1; нема plan-doc → 1; валідний plan-doc → `status: 'planned'`, `plan[]` (`{step,task,acceptance,status:'pending'}`), `plan_doc`; placeholder-крок у doc → 1 (через `parsePlan`); розрив trace → warn, код 0.
- [ ] **Крок 2: реалізація `plan.mjs`** — як `spec.mjs`, але після резолву:

```js
const steps = rest.includes('--panel')
  ? await runPanel({ task: state.branch, cwd, runner: deps.runner, log, mode: 'plan' })
  : extractSteps(readFileSync(doc, 'utf8'))
if (!steps) return 1
let normalized
try { normalized = parsePlan(JSON.stringify(steps)) }
catch (e) { log(`plan: ${e.message}`); return 1 }
if (!verifyTrace(cwd, deps.trace)) log('⚠️ plan: trace виявив розрив — перевір spec/plan/flow лінки')
recordTransition(/* … */, s => ({ ...s, plan: normalized, plan_doc: doc, status: 'planned' }))
```

- [ ] **Крок 3: тести зелено. Крок 4: commit** `feat(flow): команда plan (фаза плану, обидва режими)`

---

## Task 6: Панель `plan-panel.mjs` (agent↔agent brainstorm)

**Files:** Create `lib/plan-panel.mjs`; Test `tests/plan-panel.test.mjs`

Спільна для `spec` (mode: 'spec' — підходи) і `plan` (mode: 'plan' — кроки).
Персони `architect/skeptic/tester` `Promise.all` → суддя синтезує:

- `mode:'plan'` → JSON-масив кроків (повертає масив);
- `mode:'spec'` → текст підходів (повертає рядок/`true` як сигнал).
  Будь-який фейл → `null` із логом. Runner-інтерфейс — `runStep` (як `planner.mjs`).

- [ ] **Крок 1: тести** — happy synth (plan → масив кроків; spec → truthy); суддя-фейл → null.
- [ ] **Крок 2: реалізація** — `PERSONAS` + суддя-промпт за `mode`; парс `[`…`]` для plan.
- [ ] **Крок 3: тести зелено. Крок 4: commit** `feat(flow): --panel (agent↔agent brainstorm, спільний для spec/plan)`

> Реальний `runner` — `createRunner(deps)` (як у `active.mjs`); у `spec`/`plan`:
> `runner: deps.runner ?? await createRunner(deps)` з обробленням помилки.

---

## Task 7: CLI-маршрутизація `spec`/`plan`

**Files:** Modify `index.mjs`; Test CLI

- [ ] **Крок 1: тести** — `runFlowCli(['spec'])`/`['plan']` маршрутизують у відповідні handler-и.
- [ ] **Крок 2: реалізація:**

```js
import { spec } from './lib/spec.mjs'
import { plan } from './lib/plan.mjs'
'  npx @nitra/cursor flow spec [--panel]    # Фаза дизайну: зафіксувати docs/specs/<…>',
'  npx @nitra/cursor flow plan [--panel]    # Фаза плану: зафіксувати docs/plans/<…> + state',
export const SUBCOMMANDS = ['init', 'spec', 'plan', 'verify', 'release', 'run', 'resume', 'cancel', 'repair']
export const DEFAULT_HANDLERS = { init, spec, plan, verify, release, run, resume, cancel, repair }
```

- [ ] **Крок 3: тести зелено. Крок 4: commit** `feat(flow): маршрутизація spec/plan`

---

## Task 8: М'які ворота у `verify` (попередження, НЕ блокує)

**Files:** Modify `lib/commands.mjs`; Test `tests/commands.test.mjs`

- [ ] **Крок 1: тест** — без `state.plan` verify попереджає (`/план/i`), код = за gate-ами (0). Старі тести зелені.
- [ ] **Крок 2: реалізація — у `verify` після `readState`:**

```js
const state = readState(statePath)
if (state && !state.plan?.length) {
  log('⚠️ verify: плану не зафіксовано (`flow plan`) — рекомендовано спершу сформувати план')
}
// далі — наявна логіка; код = verdict.pass ? 0 : 1
```

- [ ] **Крок 3: тести зелено. Крок 4: commit** `feat(flow): verify попереджає про відсутній план (м'які ворота)`

---

## Task 9: Контракт `flow.mdc`

**Files:** Modify `npm/rules/flow/flow.mdc`

Вставити кроки 2 (Spec) і 3 (План) між init і кодом (зсунути нумерацію):

```markdown
2. **Spec (дизайн)** — рекомендовано, не блокує. Brainstorm нашими термінами
   (НЕ викликаючи superpowers):
   - **human↔agent (дефолт):** питання по одному (перевага multiple-choice) →
     2-3 підходи з рекомендацією → дизайн секціями з апрувом;
   - **agent↔agent:** `flow spec --panel` (панель architect/skeptic/tester → суддя).
     Збережи дизайн → `docs/specs/<date>-<slug>.md` (`kind: nitra-spec`, `plan: null`),
     тоді `npx @nitra/cursor flow spec`.

3. **План** — декомпозиція дизайну в кроки:
   - збережи `docs/plans/<date>-<slug>.md` (`kind: nitra-plan`, `spec:` → лінк на
     spec, `flow:` → шлях `.flow.json`; секція `## Кроки`:
     `N. <task> — acceptance: <критерій>`);
   - `npx @nitra/cursor flow plan` (або `--panel` для agent↔agent).
     Команда дзеркалить кроки у `.flow.json` (`status: planned`) і запускає `trace`
     для перевірки ланцюга. `verify` без плану лише попередить.
```

У «Чого не роби» додати: «Не лінкуй spec↔plan руками неконсистентно — тримай
`spec.plan`/`plan.spec`/`plan.flow`; `flow spec`/`flow plan` перевіряють їх через `trace`.»

- [ ] **Крок 1: внести. Крок 2:** `bun rules/flow/fix.mjs` — валідно. **Крок 3: commit** `docs(flow): контракт — фази Spec і План`

---

## Task 10: Лінт, тести, changelog, реліз

- [ ] `bun run lint` (один послідовний прогон) — чисто.
- [ ] `cd npm && npx vitest run scripts/dispatcher` — зелено.
- [ ] coverage/mutation для нових модулів (n-test) — за потреби дописати.
- [ ] `npx @nitra/cursor change --bump minor --section Added --message "flow: фази spec і plan (brainstorm human↔agent + --panel)"`.
- [ ] оновити frontmatter цього плану: `flow:` → шлях `.flow.json`, `implemented.state: true`, `commits`, `verifiedAt`; `flow verify` → `flow release`.

---

## Self-review

- **Покриття рішень:** без `-design` (Task 4 — `docs/specs/<date>-<slug>.md`); розщеплення `spec`+`plan` (Task 4/5/7); trace read-only як перевірка + лінк plan→flow (Task 2/3); HITL контрактом (Task 6/9). ✅
- **Композиція:** не вводимо `PLAN.md`; не дублюємо/не імітуємо `trace link` (агент пише лінки, trace верифікує); brainstorm — у термінах n-cursor (Sovereign). ✅
- **Сумісність:** `.flow.json` schema_version незмінний; `status: 'spec'/'planned'`, `spec_doc`/`plan_doc` адитивні; exit-коди `verify`/`release` не змінюються. ✅
- **Типи:** кроки нормалізує єдина точка `parsePlan`. ✅

## Залишковий борг (поза скоупом)

- **`trace link` (мутатор)** — авто-запис `spec.plan`/`plan.spec`/`plan.flow`
  замість ручного авторства агентом. Зараз агент пише, trace лише перевіряє.
- **Дублювання з `active.mjs`** — `--panel` і `flow run` ділять `createRunner` +
  планування; винести спільний планувальник після злиття.
