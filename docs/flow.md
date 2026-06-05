# n-cursor flow — огляд

`n-cursor flow` — це **двофасадний оркестратор** життєвого циклу задачі поверх
єдиного джерела істини `.flow.json`. Він ізолює роботу в worktree, веде її через
фази (дизайн → план → код → перевірка → реліз) і лишає простежуваний слід
(spec ↔ plan ↔ flow ↔ change).

Модель — **Sovereign**: ідеї запозичені зі `superpowers` (brainstorming,
writing-plans, subagent-driven) і `BMAD` (project-levels, risk-profile,
adversarial review, qa-gate, advanced elicitation), але **не як залежності** —
вони адаптовані нашими термінами в CLI + контракт-правило.

## Два фасади

- **Пасивний Турнікет (Фасад A)** — для IDE-агентів (Cursor / Claude Code): агент
  **сам пише код**, а `n-cursor` лише ізолює, **судить** якість і релізить.
  Команди: `init`, `spec`, `plan`, `verify`, `review`, `gate`, `release`.
- **Активний Раннер (Фасад B)** — headless/CI: `run` спавнить субагентів через
  повний цикл; `resume` / `cancel` / `repair` — керування станом.

Контракт Фасада A описаний у правилі `npm/rules/flow/flow.mdc` (синкається в
`.cursor/rules/n-flow.mdc` споживачам).

## Конвеєр фаз

```text
init ──► spec ──► plan ──► (код) ──► verify ──► review ──► gate ──► release
 │        │        │                   │          │         │          │
level    risk    plan[]              gates[]   findings   verdict   completion
risk   (з spec)  status:planned                          PASS/…     status:done
```

| Команда                  | Призначення                                                                   | Пише в `.flow.json`                      |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------- |
| `init <branch> "<опис>"` | worktree + стан; детектить `level` (0–3) і `risk` (low/med/high)              | `branch`, `base_commit`, `level`, `risk` |
| `spec [--panel]`         | фаза дизайну; фіксує `docs/specs/<date>-<slug>.md`; підхоплює `risk:` зі spec | `spec_doc`, `risk`, `status: spec`       |
| `plan [--panel]`         | фаза плану; дзеркалить кроки `## Кроки` → `plan[]`                            | `plan[]`, `plan_doc`, `status: planned`  |
| `verify`                 | механічні Quality Gates (lint + coverage)                                     | `gates[]`, `fingerprint`                 |
| `review`                 | adversarial diff-review (читає лише `git diff base_commit`)                   | `review.findings[]`                      |
| `gate`                   | синтез вердикту `PASS / CONCERNS / FAIL` + score + причини                    | `gate`                                   |
| `release`                | `.changes/` + completion snapshot                                             | `status: done`, `completion`             |

## Brainstorm: два режими

Фази `spec` і `plan` підтримують два способи формування:

- **human↔agent (дефолт)** — агент веде діалог: питання по одному, 2-3 підходи з
  рекомендацією, дизайн секціями з апрувом. Опційно — техніки **advanced
  elicitation** (Expand/Contract, Critique & Refine, Identify Risks,
  Tree-of-Thoughts, Stakeholder Roundtable, Self-Consistency).
- **agent↔agent (`--panel`)** — панель субагентів-персон (architect / skeptic /
  tester) → суддя синтезує один артефакт; результат презентується людині.

## Scale-adaptive (рівні) і risk-aware review

- `init` визначає **рівень** задачі за описом: L0 тривіальне (`fix/typo/bump`) …
  L3 архітектурне (`platform/migration`). Для L0 фази spec/plan можна пропустити;
  для L≥1 — рекомендовані. Пропорційність процесу до масштабу.
- `init`/`spec` визначають **ризик** (`security/auth/secret` → high). `review`
  спавнить `max(за рівнем, за ризиком)` рецензентів (кап 3) — security-фікс на
  5 рядків (L0) з high-risk дістає 3 рецензенти з безпековим фокусом промпта.

## М'які ворота

Перевірки **інформативні, не блокувальні** (рішення за людиною):

- `verify` без плану — лише попередження;
- `review` пише findings, не валить;
- `gate` `FAIL` → код 1 як сигнал, але `release` на FAIL лише попереджає.

Винятки fail-closed: невалідний план (placeholder/`TBD`), пошкоджений стан.

## Артефакти й простежуваність

- **`docs/specs/<date>-<slug>.md`** (`kind: nitra-spec`) — дизайн із brainstorm.
- **`docs/plans/<date>-<slug>.md`** (`kind: nitra-plan`) — implementation-план;
  frontmatter `spec:` / `flow:` зв'язує ланцюг.
- **`.worktrees/<branch>.flow.json`** — runtime-стан (sibling, поза git).
- **`.changes/<id>.md`** — changeset (CI бампає версію; руками не чіпати).
- **`n-cursor trace`** — read-only верифікатор ланцюга `adr ↔ spec ↔ plan ↔
flow ↔ change`; флагує розриви. Лінки у frontmatter пише агент; `spec`/`plan`
  їх перевіряють.

Артефакт резолвиться за **slug гілки** (потім за `mtime`) — щоб серед кількох
spec/plan на одну дату взяти правильний.

## Приклад (Пасивний Турнікет)

```bash
npx @nitra/cursor flow init feat/cache "feature: кеш каталогу"   # level 2, risk low
# (brainstorm) → збереження docs/specs/2026-06-01-feat-cache.md
npx @nitra/cursor flow spec
# (декомпозиція) → docs/plans/2026-06-01-feat-cache.md з ## Кроки
npx @nitra/cursor flow plan
# ... пишеш код, TDD ...
npx @nitra/cursor flow verify     # lint + coverage
npx @nitra/cursor flow review     # adversarial diff-review
npx @nitra/cursor flow gate       # PASS / CONCERNS / FAIL
npx @nitra/cursor flow release --bump minor --section Added --message "кеш каталогу"
```

## Дотичні документи

- Контракт виконавця: `npm/rules/flow/flow.mdc`
- Дизайн-спеки: `docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md`,
  `docs/specs/2026-05-31-n-cursor-flow-traceability-design.md`
- Інкременти (spec + plan): `docs/specs/2026-06-01-flow-*.md`,
  `docs/plans/2026-06-01-flow-*.md`
- Код: `npm/scripts/dispatcher/`
