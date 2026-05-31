---
captured: 2026-05-31T16:40:56+03:00
---

## ADR n-cursor flow — Суверенний Stateful AI-Оркестратор

## Context and Problem Statement

`@nitra/cursor` надає CLI-набір (`worktree`, `coverage`, `change`, `verify`) без єдиного lifecycle-двигуна. Попередня версія spec (v1.1) рекомендувала `compose-and-extend` — `n-cursor` доповнює `superpowers`-скіли тонким Contract Gate. Однак вимога повної суверенності, fault-tolerant відновлення після збоїв та автономного запуску без зовнішніх плагінів (CI, pi.dev) спонукала переглянути цей підхід. Потрібно вирішити: чи `n-cursor` лишається тонким gate-провайдером, чи стає самодостатнім двигуном lifecycle.

## Considered Options

* **Compose-and-extend (Contract Gate)** — `n-cursor` дає Contract (`worktree` + `coverage` + `.changes`), `superpowers` reference-скіл у середині lifecycle; pi.dev стартує агента, `n-cursor` лише `verify`.
* **Capability Router з `capability-matrix.json`** — два шляхи виконання на основі авто-детекції моделі (`native_workflows` vs скриптовий loop).
* **Sovereign Stateful AI Orchestrator** — `n-cursor flow` є повним lifecycle-двигуном: explicit model declaration → polyfill/native router, 5-фазний engine, fault-tolerant `.flow-state.json`, `resume`/`cancel`.

## Decision Outcome

Chosen option: **"Sovereign Stateful AI Orchestrator"**, because compose-and-extend не дає fault-tolerance (немає `.flow-state.json`/`resume`), superpowers-кеш ефемерний і може зникнути mid-session (підтверджено в сесії), а автономний runner на сервері вимагає самодостатнього двигуна без зовнішніх плагінів. Capability Router реалізується через **явне** оголошення моделі (`--model` › env › config › default `polyfill`), а не авто-детекцію (механізм детекції в кодовій базі відсутній).

### Consequences

* Good, because `n-cursor flow resume` відновлює виконання з `.flow-state.json` після будь-якого збою (мережа, таймаут, перезавантаження).
* Good, because самодостатній baseline без `superpowers` вкрай потрібний для CI та pi.dev (автономних серверів).
* Good, because `n-cursor trace` будує наскрізний граф `ADR ↔ spec ↔ .flow-state.json ↔ .changes ↔ git commit` — трасованість для всього 9-фазного lifecycle.
* Good, because capability router з `capability-matrix.json` + явна декларація моделі — будівний контракт (на відміну від авто-детекції).
* Bad, because власний 5-фазний engine (`planner.mjs`, `executor.mjs`, `reviewer.mjs`) потребує підтримки prompt-шаблонів при кожному релізі нових моделей (ризик дрейфу стосовно апстрім superpowers).
* Bad, because два шари оркестрації (`n-cursor flow` + харнес) потенційно знижують прозорість у чаті — мітигація: `flow` виводить кожен крок в stdout із structured log.

## More Information

- Spec v2.0: `docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md`
- Файлова структура двигуна: `npm/scripts/dispatcher/{index,planner,executor,reviewer,native}.mjs`, `lib/{prompts,state-store}.mjs`
- Конфіг: `npm/config/capability-matrix.json`
- State: `.worktrees/<branch>/.flow-state.json` (gitignored)
- Прецедент headless subagent у репо: `npm/scripts/coverage-fix.mjs` (`@anthropic-ai/claude-agent-sdk`)
- Міграція шляхів: `docs/superpowers/specs` → `docs/specs`, `docs/superpowers/plans` → `docs/plans` (legacy не підтримується)
- Supersedes: compose-and-extend spec v1.1 (intermediate decisions captured in `20260531-141658-*` та `20260531-155531-*`)
