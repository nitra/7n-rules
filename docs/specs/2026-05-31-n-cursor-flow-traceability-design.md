---
kind: nitra-spec
status: draft
adr:
  - ../adr/20260531-133047-двосторонній-звязок-specplan-через-поле-plan-у-специфікаціях.md
  - ../adr/20260531-135743-трекінг-звязку-specplan-та-статусу-реалізації-у-plans.md
plan: null
---

# Spec: `n-cursor flow` і markdown traceability

**Date:** 2026-05-31
**Status:** Draft for review

## Контекст

`@nitra/cursor` уже має власні repository-specific інструменти: `n-cursor worktree`, `n-cursor lint`,
`n-cursor coverage`, `n-cursor change`, ADR hooks, правила `.cursor/rules` і skills. Зовнішні workflow frameworks не
володіють Nitra-specific контрактами репозиторію: де створювати worktree, як тримати coverage, як писати `.changes`,
як зв'язувати ADR, spec, plan і реалізацію в історію.

Потрібен фінальний target-state, де `@nitra/cursor` є суверенним AI-оркестратором: сам визначає workflow methodology,
виконує durable state machine, контролює quality gates і тримає traceability layer.

## Мета

Кожна нетривіальна задача має залишати машинно-читаний і людиночитний ланцюг:

```txt
task -> ADR -> spec -> plan -> code -> tests -> docs -> changelog -> responsible notification
```

Ланцюг має працювати однаково для людини, `n-cursor flow`, `pi.dev`, Cursor Agent, Claude Code або CI. Будь-який
учасник процесу пише ті самі файли й дотримується тих самих links/status fields.

## Non-goals

- Не підтримувати legacy-шляхи `docs/superpowers/specs` і `docs/superpowers/plans` після міграції.
- Не мати runtime або process dependency на зовнішній workflow framework.
- Не копіювати дослівно чужі prompt/workflow інструкції. Nitra prompts і state transitions є власною, версіонованою
  продуктовою поверхнею пакета.
- Не робити `n-cursor flow` прихованим wrapper-ом над одним конкретним LLM CLI.

## Новий канон docs

```txt
docs/adr/       # рішення, контекст, alternatives, consequences
docs/specs/     # що саме будуємо
docs/plans/     # як реалізуємо
.worktrees/     # worktree inventory + durable flow state
npm/.changes/   # release/changelog input для npm workspace
```

`docs/superpowers/specs` і `docs/superpowers/plans` переносяться одноразово в `docs/specs` і `docs/plans`. Після
цього ці старі каталоги не є valid location. `n-cursor trace status` має репортити файли в старих каталогах як
порушення, а не як підтримувану legacy-гілку.

## Sovereign flow methodology

`@nitra/cursor` owns agent methodology, repository execution and traceability.

`n-cursor flow` має власні canonical phases і prompt contracts:

- requirement intake and task classification;
- ADR/spec/plan traceability;
- worktree isolation;
- TDD-oriented execution;
- machine quality gates;
- semantic/spec compliance review;
- release prep;
- responsible notification.

Ці prompts і state transitions живуть у пакеті, версіонуються разом із `@nitra/cursor`, покриваються fixture tests і
мають changelog. Зовнішній framework може бути historical inspiration або migration source, але не є частиною runtime
contract.

Критика рішення: суверенний workflow означає більшу maintenance responsibility. Команда має підтримувати prompt
templates, state transitions, repair-loop semantics і docs lifecycle як продуктову API-поверхню, а не як одноразову
інструкцію для агента.

## Capability Router

Router обирає execution mode за model capabilities:

```json
{
  "models": {
    "claude-3-5-sonnet": {
      "orchestration": "polyfill",
      "capabilities": ["tool_use", "code_gen"]
    },
    "claude-4-8-opus": {
      "orchestration": "native",
      "capabilities": ["tool_use", "code_gen", "native_workflows"]
    }
  }
}
```

Modes:

- `polyfill` — модель не має native workflows; `n-cursor` запускає власну deterministic state machine.
- `native` — модель має `native_workflows`; `n-cursor` передає contract і перевіряє результат.
- `failed` — немає безпечного workflow path.

## CLI

```sh
npx @nitra/cursor flow "Реалізуй кешування для каталогу продуктів"
npx @nitra/cursor flow status <branch>
npx @nitra/cursor flow resume
npx @nitra/cursor flow resume <branch>
npx @nitra/cursor flow list
npx @nitra/cursor flow cancel <branch>

npx @nitra/cursor trace status
npx @nitra/cursor trace link --spec docs/specs/x.md --plan docs/plans/x.md
npx @nitra/cursor trace implemented --plan docs/plans/x.md --change npm/.changes/x.md
```

`flow` виконує lifecycle. `trace` працює як markdown control plane для людей, agents і CI: нормалізує links,
оновлює statuses, перевіряє цілісність графа.

`flow resume` без аргументів зчитує state для поточного worktree, якщо команда запущена всередині checkout. `flow resume
<branch>` працює з будь-якого каталогу репозиторію.

## Traceability artifacts

| Етап         | Artifact                        | Обов'язкові links                                           |
| ------------ | ------------------------------- | ----------------------------------------------------------- |
| task         | `.worktrees/<branch>.flow.json` | `adr`, `spec`, `plan`, `change`, `commits`, `notifications` |
| ADR          | `docs/adr/*.md`                 | `spec`, optional `plan`                                     |
| spec         | `docs/specs/*.md`               | `adr`, `plan`                                               |
| plan         | `docs/plans/*.md`               | `spec`, `flow`, `implemented`                               |
| code         | git commits                     | `plan`, `change` через plan/flow metadata                   |
| tests        | flow checks                     | `plan`, `commit`, command evidence                          |
| docs         | docs paths in flow state        | `spec`, `plan`, `change`                                    |
| changelog    | `.changes/*.md`                 | `plan`, `commits`                                           |
| notification | flow event                      | `responsible`, `channel`, `sentAt`, `summary`               |

## Spec frontmatter

Specs мають YAML frontmatter:

```yaml
kind: nitra-spec
status: draft
adr:
  - ../adr/20260531-example.md
plan: null
```

`plan: null` означає, що spec ще не перейшла до планування. Коли план створено, `n-cursor trace link` або
`n-cursor flow` замінює `null` на relative link:

```yaml
plan: ../plans/20260531-example.md
```

Allowed `status`:

- `draft`
- `approved`
- `planned`
- `superseded`
- `abandoned`

## Plan frontmatter

Plans мають YAML frontmatter:

```yaml
kind: nitra-plan
status: ready
spec: ../specs/20260531-example.md
flow: null
implemented:
  state: false
  commits: []
  change: null
  verifiedAt: null
```

Allowed `status`:

- `draft`
- `ready`
- `in_progress`
- `implemented`
- `superseded`
- `abandoned`

Коли реалізація завершена, `n-cursor trace implemented` або `n-cursor flow` оновлює:

```yaml
status: implemented
flow: ../../.worktrees/feat-example.flow.json
implemented:
  state: true
  commits:
    - abc1234
  change: ../../npm/.changes/1780218783124-a30f10.md
  verifiedAt: 2026-05-31T00:00:00.000Z
```

## Durable flow state

Flow state живе поруч із worktree inventory:

```txt
.worktrees/
  feat-product-cache/
  feat-product-cache.md
  feat-product-cache.flow.json
```

State-файл є source of truth для `resume`, audit і debug:

```json
{
  "schemaVersion": 1,
  "flowId": "20260531-abc123",
  "task": "Реалізуй кешування для каталогу продуктів",
  "mode": "polyfill",
  "model": "claude-3-5-sonnet",
  "runner": "cursor-agent",
  "status": "running",
  "branch": "feat/product-cache",
  "worktreePath": ".worktrees/feat-product-cache",
  "currentStepIndex": 2,
  "baseCommit": "a1b2c3d4",
  "startedAt": "2026-05-31T13:15:00.000Z",
  "updatedAt": "2026-05-31T13:45:00.000Z",
  "adr": ["docs/adr/20260531-example.md"],
  "spec": "docs/specs/20260531-product-cache.md",
  "plan": "docs/plans/20260531-product-cache.md",
  "steps": [
    {
      "index": 0,
      "task": "Створити специфікацію інтерфейсу кешування в docs/specs/",
      "status": "completed",
      "attempts": 1,
      "artifacts": ["docs/specs/cache-spec.md"],
      "errors": []
    },
    {
      "index": 1,
      "task": "Написати тести, що падають, для Redis-конектору",
      "status": "completed",
      "attempts": 1,
      "artifacts": ["npm/src/tests/cache.test.mjs"],
      "errors": []
    },
    {
      "index": 2,
      "task": "Реалізувати логіку витіснення ключів у лібці",
      "status": "running",
      "attempts": 2,
      "artifacts": [],
      "errors": ["lint failed: unexpected trailing comma at line 42"]
    }
  ],
  "checks": {
    "lint": null,
    "coverage": null,
    "review": null
  },
  "release": {
    "changeFile": null
  },
  "notifications": [],
  "events": []
}
```

Allowed flow `status`:

- `created`
- `planning`
- `running`
- `blocked`
- `failed`
- `completed`
- `cancelled`

## Fault-tolerant state store

State store має бути crash-safe:

- write operations are atomic: write temp file, fsync where practical, then rename;
- each transition appends an event before mutating high-level status;
- concurrent `flow resume` or repair attempts are serialized with a lock file under `.worktrees/`;
- failed checks are stored as summarized errors plus path to full log when available;
- retry counters live per step, not only globally;
- `maxRepairAttempts` default is 3 and is configurable through `.n-cursor.json`;
- a corrupted state file fails closed with a diagnostic and does not start a new flow over the same branch.

Rejected state location: `.worktrees/<branch>/.flow-state.json` inside the checkout. That location is tempting because it
travels with the worktree directory, but it creates a hidden untracked file inside the feature checkout unless every
consumer repo adds extra ignore rules. The canonical location remains `.worktrees/<sanitized-branch>.flow.json`, next to
`.worktrees/<sanitized-branch>.md`, because the parent `.worktrees/` inventory is already outside normal source changes.

## Lifecycle

1. **Task intake**
   Flow receives task text, creates `flowId`, chooses branch slug, writes initial `.flow.json`.

2. **ADR link**
   Flow links an existing ADR or creates a new ADR draft when task includes an architectural decision. ADR frontmatter or
   body links to spec once spec exists.

3. **Spec**
   Flow creates or links `docs/specs/<date>-<slug>.md` with `plan: null`, using Nitra-owned spec prompt contracts and
   normalizing frontmatter through `n-cursor trace`.

4. **Plan**
   Flow creates or links `docs/plans/<date>-<slug>.md`. Spec `plan` is updated immediately, so specs without plans are
   distinguishable.

5. **Worktree**
   Flow creates isolation only through `n-cursor worktree add <branch> "<task>"`. It never calls `git worktree add`
   directly.

6. **Code**
   Flow executes plan steps through selected runner. On shared worktree, implementation steps are sequential unless
   every parallel task has its own isolated worktree.

7. **Tests and checks**
   Flow records evidence for test-first steps where applicable, then runs canonical checks: `n-cursor lint`,
   project tests, `n-cursor coverage`, and spec/review checks.

8. **Docs**
   Flow records docs touched or confirms that no docs update is required. Documentation links back to spec or plan when
   relevant.

9. **Changelog**
   Flow creates `.changes/<id>.md` through `n-cursor change` for package-impacting changes and links it in plan
   frontmatter and `.flow.json`.

10. **Notification**
    Flow records responsible notification event with responsible party, channel, summary and timestamp. Sending can be
    manual or automated, but the event must be represented in state.

11. **Completion**
    Flow marks plan `implemented`, state `completed`, and leaves enough links to reconstruct the full chain.

## Polyfill phases

In `polyfill` mode, `n-cursor flow` runs a deterministic state machine:

1. **Plan** — generate structured JSON plan with acceptance criteria and expected artifacts.
2. **Isolation** — create the checkout through `n-cursor worktree add`.
3. **TDD execution** — execute code-changing steps with test-first evidence where applicable.
4. **Two-stage review** — run local machine checks first, then semantic/spec compliance review.
5. **Release prep** — generate `.changes/<id>.md`, update plan implementation metadata, record notification intent.

Prompts for these phases are Nitra-owned templates. They must be compact, fixture-tested and documented as package
behavior because downstream teams will rely on them.

## Markdown normalization

`n-cursor trace` responsibilities:

- parse YAML frontmatter in specs/plans;
- add missing `kind` fields;
- validate status enum values;
- link spec to plan and plan to spec;
- reject files in `docs/superpowers/specs` and `docs/superpowers/plans`;
- validate that linked files exist;
- validate that implemented plans have `implemented.state: true`, at least one commit or documented reason, and check
  evidence in `.flow.json`;
- print a summary table for all specs and plans.

`trace` should use a structured Markdown/YAML parser, not ad hoc string edits.

## Package structure

```txt
npm/config/capability-matrix.json
npm/schemas/flow-state.json
npm/schemas/nitra-spec.json
npm/schemas/nitra-plan.json
npm/scripts/flow/router.mjs
npm/scripts/flow/state.mjs
npm/scripts/flow/state-store.mjs
npm/scripts/flow/polyfill.mjs
npm/scripts/flow/native.mjs
npm/scripts/flow/planner.mjs
npm/scripts/flow/executor.mjs
npm/scripts/flow/reviewer.mjs
npm/scripts/flow/release.mjs
npm/scripts/flow/prompts.mjs
npm/scripts/flow/runners/claude.mjs
npm/scripts/flow/runners/cursor-agent.mjs
npm/scripts/trace/trace-cli.mjs
npm/scripts/trace/markdown-artifacts.mjs
npm/bin/n-cursor.js
```

## `.n-cursor.json`

```json
{
  "flow": {
    "defaultRunner": "cursor-agent",
    "defaultModel": "claude-3-5-sonnet",
    "stateDir": ".worktrees",
    "specDir": "docs/specs",
    "planDir": "docs/plans",
    "maxRepairAttempts": 3,
    "defaultOrchestration": "polyfill",
    "requireTddEvidence": true,
    "requireCoverage": true,
    "responsible": []
  }
}
```

`responsible` can later hold team-specific routing rules. Empty array means flow records notification as required but does
not auto-send it.

## One-time migration

Implementation includes a single migration:

```sh
git mv docs/superpowers/specs docs/specs
git mv docs/superpowers/plans docs/plans
```

Then update repository links from `docs/superpowers/specs` and `docs/superpowers/plans` to `docs/specs` and
`docs/plans`. No runtime fallback remains after migration.

## Testing and verification

- Unit tests for frontmatter parsing, link normalization, status validation and old-path rejection.
- Unit tests for flow state read/write/resume transitions.
- CLI tests for `trace status`, `trace link`, `trace implemented`.
- Integration tests on a temporary git repo for flow state + worktree inventory.
- Markdown fixture tests for spec without plan, spec with plan, implemented plan, broken links and invalid statuses.

Final verification for implementation work:

- `bun test` in `npm/`;
- `npx @nitra/cursor trace status`;
- `npx @nitra/cursor fix changelog` when package files changed;
- `npx @nitra/cursor coverage` when code-changing flow components changed.

## Open decisions already closed in this spec

- Durable state is required; in-memory-only state is not acceptable.
- New canonical docs paths are `docs/specs` and `docs/plans`.
- Legacy `docs/superpowers/*` paths are migrated once, then rejected.
- External workflow framework dependency is rejected for target-state `n-cursor flow`.
- `@nitra/cursor` owns methodology, traceability and repository execution.
