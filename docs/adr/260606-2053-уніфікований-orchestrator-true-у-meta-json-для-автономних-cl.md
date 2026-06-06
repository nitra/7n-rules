---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-06T20:53:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

Тепер тестуємо новий вивід на чистому репо:
[assistant]
[tool: Bash] {"command":"bun npm/bin/n-cursor.js fix js-run 2>&1","description":"Test new concise output format","timeout":30000}
[user]
[tool_result] ✅ fix: 1 правил — все чисто
[assistant]
Лаконічно і зрозуміло. Готово до перевірки на іншому проєкті, а після — переходимо до `docgen`.

---

Саме зараз, поки ти перевіряєш — ось запит на **ADR** від сесії:

---

## ADR Уніфікований `orchestrator: true` у `meta.json` для автономних CLI-скілів

## Context and Problem Statement
Різні `@nitra/cursor`-скіли (`fix`, `taze`, `docgen`, `lint`) мали різні точки входу та механізми запуску: агентний скіл через Claude, окремі команди типу `fix-run`, ручні виклики. Потрібен уніфікований принцип — єдина декларація в `meta.json`, яка сигналізує що скіл запускає автономний convergence-loop без участі агента-LLM.

## Considered Options
* Прапор `"orchestrator": true` у `meta.json` кожного скіла
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прапор `"orchestrator": true` у `meta.json`", because користувач сформулював: *"я хочу єдиний принцип оркестратора, (тобто у скіла в meta.json встановлюємо це оркестраторний чи ні)"* — єдиний атрибут контролює режим запуску без зміни коду CLI.

### Consequences
* Good, because всі скіли оголошують свій режим в одному файлі; `npx @nitra/cursor <skill>` поводиться однаково незалежно від внутрішньої реалізації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/skills/fix/meta.json`: `{ "auto": "завжди", "worktree": true, "orchestrator": true }`
- Реалізація: `npm/skills/fix/js/orchestrator.mjs` — convergence-loop (T0-check → T0-auto → T1 LLM)
- Внутрішня команда `_fix-check` (підкреслення = private) замінила публічний `fix --json`
- LLM-tier через `pi` (C1 pattern): script збирає контекст → pi → script застосовує
