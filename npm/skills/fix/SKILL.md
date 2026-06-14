---
name: n-fix
description: >-
  DEPRECATED — використовуй /n-lint. fix злито в lint: `n-cursor lint` тепер і
  детектить, і виправляє (конформність + лінтери) за один прохід.
---

# n-fix — DEPRECATED (делегат на /n-lint)

Команду `n-cursor fix` **видалено**: рух-движок конформності (convergence-loop /
check-gate / Tier0 / LLM) поглинуто в `lint` (спека
`docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`).

**Використовуй `/n-lint`** замість цього скіла:

- `n-cursor lint` — дельта vs origin, **fix за замовчуванням** (лінтери на змінених файлах);
- `n-cursor lint --full` — весь репо + **конформність** (колишній `fix`: конфіги/файли/воркфлоу
  через convergence-движок);
- `n-cursor lint --read-only [--full]` — лише детект, нуль мутацій (CI / pre-commit);
- `n-cursor lint <rule>` — конформність одного правила (колишній `fix <rule>`).

Цей скіл лишено як тонкий делегат до наступного major; уся логіка — у `/n-lint`.
