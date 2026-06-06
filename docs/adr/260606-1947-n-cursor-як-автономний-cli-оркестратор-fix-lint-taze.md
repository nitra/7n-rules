---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-06T19:47:09+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

## ADR n-cursor як автономний CLI-оркестратор (fix, lint, taze)

**Context and Problem Statement**
Команди `fix`, `lint`, `taze` були перевірниками; вся логіка «як виправляти» містилась у SKILL.md і виконувалась агентом. Прийняте рішення — перенести оркестрацію в CLI.

**Decision Outcome**: CLI-команди стають автономними оркестраторами; SKILL.md скорочується до одного рядка `npx @nitra/cursor fix`.

---

**Зафіксовані рішення** у `docs/adr/260606-1944-n-cursor-як-автономний-cli-оркестратор.md`:

1. **CLI як автономний оркестратор** — `fix` сам виконує convergence-loop + T0-auto + LLM-tier + check-gate; агент лише перевіряє exit code
2. **`fix --json` видалено з публічного API** — замінено внутрішньою `_fix-check` (підкреслення = private)
3. **LLM-tier через `pi` (C1 pattern)** — script збирає контекст → `pi --no-tools --mode text` → script застосовує; провайдер обирається користувачем у `~/.pi/`
4. **`"orchestrator": true` у `meta.json`** — декларативний прапор для програмного розрізнення типу скіла
5. **fix → lint послідовно** — паралельні під-worktree відкинуто через гарантовані конфлікти на спільних файлах
