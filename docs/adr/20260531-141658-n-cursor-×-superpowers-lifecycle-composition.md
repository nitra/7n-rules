---
session: 23e553b6-6bb0-45e4-bb88-629bade3d8f7
captured: 2026-05-31T14:16:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor--claude-worktrees-keen-swanson-f7dff6/23e553b6-6bb0-45e4-bb88-629bade3d8f7.jsonl
---

Документ закомічено: `docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md`.

**Що зафіксовано:**

- **Done-Contract** — три умови (worktree + coverage + `.changes/`), які перевіряє нова команда `n-cursor verify`
- **Compose-and-extend** — `n-cursor` матеріалізує baseline lifecycle skill (самодостатній), superpowers підхоплює нативний тул через `AGENTS.md` — без дублювання, без патчу плагіна
- **Самодостатність** — `npx @nitra/cursor` sync дає агенту повний lifecycle навіть без superpowers (для CI/pi.dev)
- **`n-cursor flow --autonomous`** — заплановано з budget guard (`.n-cursor.json#autonomous.maxCostUsd`), але не реалізовано до підтвердження конкретного use-case + бюджету
- **Відкладені альтернативи** — `capability-matrix` і in-house orchestrator з поясненням чому і тригером для перегляду

Для наступної сесії: v1 міграції — додати `n-cursor verify` команду та bundled `n-lifecycle` skill.

---

## ADR n-cursor × superpowers: Lifecycle Composition

## Context and Problem Statement
`@nitra/cursor` надає CLI-команди для worktree, coverage, change і lint, але не має єдиного «done»-контракту. Одночасно superpowers плагін надає lifecycle-скіли для агентів, проте на серверах (pi.dev CI runners) він не встановлений. Виникло питання: чи будувати власний оркестратор із `capability-matrix.json` та детекцією моделі, чи інтегруватися з superpowers мінімально.

## Considered Options
* `capability-matrix.json` + Capability Router (детекція моделі → Path A/B)
* In-house Orchestrator (замінити superpowers власними скриптами)
* Compose-and-extend (n-cursor дає Contract, superpowers лишається процесним шаром)

## Decision Outcome
Chosen option: "Compose-and-extend", because детекція активної моделі в рантаймі неможлива (жодного механізму в кодобазі немає, `native_workflows` — це фіча харнеса, не бітфлаг моделі), а superpowers вже спроєктований делегувати native tools через `AGENTS.md` (SKILL.md рядки 55, 203) — конфлікту немає. Контракт (`worktree + coverage + .changes`) стабільний незалежно від версії моделі.

### Consequences
* Good, because `n-cursor verify` дає єдину read-only перевірку Контракту для CI, autonomous runner і ручного dev-флоу.
* Good, because baseline lifecycle skill матеріалізується при `npx @nitra/cursor` sync — агент на сервері без superpowers отримує самодостатні інструкції.
* Good, because superpowers апстрім-покращення автоматично стають доступними без форку.
* Bad, because `n-cursor flow --autonomous` — окремий scope із вимогою budget guard (`.n-cursor.json#autonomous.maxCostUsd`); не реалізується до підтвердження конкретного use-case.

## More Information
- `npm/bin/n-cursor.js:1435–1546` — command dispatch (немає `flow`, `verify` — майбутні точки розширення)
- `npm/scripts/coverage-fix.mjs` — прецедент headless `claude-agent-sdk` виклику з репо
- superpowers `using-git-worktrees/SKILL.md:55,203` — native tool delegation design (підтверджує відсутність конфлікту)
- `docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md` — повний spec з міграційним планом v1/v2
