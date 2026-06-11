---
created_at: 2026-06-07T12:10:00Z
budget_sec: 7200
---

## Task

Продовжити міграцію скілів `npm/skills/` на JS-оркестратор паттерн: convergence-loop із check-gate, tier-routing через `npm/lib/models.mjs`, без `claude-agent-sdk`.

Пріоритет — скіли з uncommitted змінами у `git status` (docgen, fix llm-worker) та ті, що досі використовують прямі SDK-виклики.

## Done when

- [ ] `npm/skills/docgen/js/docgen-gen.mjs` — повністю на `pi` tier-routing, без `@anthropic-ai/claude-agent-sdk` або `@anthropic-ai/sdk`
- [ ] `npm/skills/fix/js/llm-worker.mjs` — LLM-виклики через `pi` tier-routing
- [ ] `npm/scripts/dispatcher/lib/subagent-runner.mjs` — оновлено відповідно до нового контракту (uncommitted зміни зчинені)
- [ ] Всі змінені файли покриті тестами (`npm run test` — зелений)
- [ ] Change-файл для `npm` workspace: `n-cursor change --ws npm --bump minor --section Changed`
- [ ] `bun run lint` — чистий вихід

## Inputs

### context

Паттерн міграції: `npm/lib/models.mjs` (TIER_1/TIER_2), `pi` CLI як транспорт.
Завершені міграції для зразка: `1279b3f7` (coverage-fix + subagent-runner), `a883b44d` (coverage-classify).

### uncommitted-work

ref: git status — модифіковані: `npm/lib/models.mjs`, `npm/scripts/coverage-classify/index.mjs`, `npm/scripts/coverage-fix.mjs`, `npm/scripts/dispatcher/lib/subagent-runner.mjs`, `npm/skills/docgen/js/docgen-gen.mjs`, `npm/skills/fix/js/llm-worker.mjs`.

### constraint

Кожен скіл — окремий коміт. Не ламати існуючі тести між комітами.
`lint` — тільки один послідовний прогон (не паралельно) — правило проєкту.
