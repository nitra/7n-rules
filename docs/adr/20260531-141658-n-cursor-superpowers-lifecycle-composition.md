# n-cursor × superpowers: Lifecycle Composition

**Status:** Accepted
**Date:** 2026-05-31

## Context and Problem Statement

`@nitra/cursor` надає CLI-команди для worktree, coverage, change і lint, але не має єдиного «done»-контракту. Одночасно superpowers плагін надає lifecycle-скіли для агентів, проте на серверах (pi.dev CI runners) він не встановлений. Виникло питання: чи будувати власний оркестратор із `capability-matrix.json` та детекцією моделі, чи інтегруватися з superpowers мінімально.

## Considered Options

- `capability-matrix.json` + Capability Router (детекція моделі → Path A/B)
- In-house Orchestrator (замінити superpowers власними скриптами)
- Compose-and-extend (n-cursor дає Contract, superpowers лишається процесним шаром)

## Decision Outcome

Chosen option: "Compose-and-extend", because детекція активної моделі в рантаймі неможлива (жодного механізму в кодобазі немає, `native_workflows` — це фіча харнеса, не бітфлаг моделі), а superpowers вже спроєктований делегувати native tools через `AGENTS.md` (SKILL.md рядки 55, 203) — конфлікту немає. Контракт (`worktree + coverage + .changes`) стабільний незалежно від версії моделі.

### Consequences

- Good, because `n-cursor verify` дає єдину read-only перевірку Контракту для CI, autonomous runner і ручного dev-флоу.
- Good, because baseline lifecycle skill матеріалізується при `npx @nitra/cursor` sync — агент на сервері без superpowers отримує самодостатні інструкції.
- Good, because superpowers апстрім-покращення автоматично стають доступними без форку.
- Bad, because `n-cursor flow --autonomous` — окремий scope із вимогою budget guard (`.n-cursor.json#autonomous.maxCostUsd`); не реалізується до підтвердження конкретного use-case і бюджету.

## More Information

- `npm/bin/n-cursor.js:1435–1546` — command dispatch (немає `flow`, `verify` — майбутні точки розширення)
- `npm/scripts/coverage-fix.mjs` — прецедент headless `claude-agent-sdk` виклику з репо
- superpowers `using-git-worktrees/SKILL.md:55,203` — native tool delegation design (підтверджує відсутність конфлікту)
- `docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md` — повний spec з міграційним планом v1/v2
- `@nitra/cursor` v1.39.0 (`npm/package.json`)
- Додаткової інформації про Capability Router в transcript не зафіксовано понад те, що він явно відкладений.

## Update 2026-05-31

Spec закомічений у воркдереві `keen-swanson-f7dff6` (commit `c8dfe28`): `docs/specs/2026-05-31-n-cursor-superpowers-composition-design.md`.

Spec фіксує повне рішення:
- 8-фазний ланцюжок `задача → ADR → spec → план → код → тести → документація → changelog → notify` з front-matter-лінками по спільному `id`
- **Contract Gate** (`n-cursor verify`) — єдиний блокуючий gate для interactive та pi.dev
- **Baseline без superpowers** — `n-cursor` матеріалізує мінімальний lifecycle при `npx @nitra/cursor`
- **Capability Router** — явно відкладено як named-тригер (умова перегляду: стабільний програмний handoff в Anthropic API / `claude-agent-sdk`)
- 4 Open Questions для наступного рев'ю (OQ-1..4), включно з питанням autonomous launcher vs pi.dev-host

ADR: `docs/adr/20260531-141658-n-cursor-×-superpowers-lifecycle-composition.md` (commit `ad98ac8`). Прецедент headless-агентів: `npm/scripts/coverage-fix.mjs` (@anthropic-ai/claude-agent-sdk). Прецедент pi.dev-розширення: `.pi/extensions/n-cursor-adr`.
