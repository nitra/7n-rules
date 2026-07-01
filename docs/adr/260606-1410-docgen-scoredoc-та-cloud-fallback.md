---
type: ADR
title: "Docgen scoreDoc та cloud fallback"
description: Детермінований scoreDoc використовується як quality gate, а LLM-суддя лише як джерело пояснень для хмарного patch-проходу.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

Після запуску docgen на `npm/rules/ga/` середня ручна якість документації була нижчою за benchmark. Потрібен механізм автоматично визначати документи, які треба передати на хмарний fallback, не покладаючись на ненадійний числовий self-score локальної LLM.

## Considered Options

- Підхід B: `gemma3:4b` як LLM-суддя, що повертає числовий score і текстові issues.
- Детермінований `scoreDoc` як quality gate без LLM-токенів.
- Hybrid: детермінований `scoreDoc` як gate, LLM-суддя лише для `issues[]`, далі Claude Haiku patch проблемних секцій.

## Decision Outcome

Chosen option: "Hybrid: детермінований `scoreDoc` як gate, LLM-суддя лише для `issues[]`, далі Claude Haiku patch проблемних секцій", because transcript фіксує, що LLM-суддя знаходить реальні проблеми, але числовий score системно завищений на +15..+35 пунктів, у середньому +24.

### Consequences

- Good, because детермінований `scoreDoc` може бути стабільним gate без токенів і без self-score drift.
- Good, because LLM-суддя все ще корисний як human-readable reason: він знаходив cache hallucination, Rego-leak і internal-symbol leaks.
- Bad, because transcript фіксує непридатність LLM-судді як числового gate: оцінки завищені порівняно з manual score.
- Neutral, because transcript не містить підтвердження реалізованого Claude fallback; наприкінці зафіксовано лише рішення додати `scoreDoc` та хмарний fallback через Claude.

## More Information

Факти з transcript:

- `fix.mjs`: LLM 85%, manual 50%, delta +35.
- `js/lint.mjs`: LLM 90%, manual 75%, delta +15.
- `js/workflows.mjs`: LLM 85%, manual 58%, delta +27.
- `lint/lint.mjs`: LLM 85%, manual 67%, delta +18.
- Середнє: LLM 86%, manual 63%, delta +24.

Запланована архітектура:

```text
Tier 1 local → generate
Stage 2.5 scoreDoc deterministic → score < 70?
якщо так → LLM-judge витягує only issues[]
→ Tier 2 cloud Claude Haiku + issue-context
→ patch тільки проблемних секцій
```

Змінені в сесії файли перед цим рішенням: `npm/skills/docgen/js/docgen-gen.mjs`, `npm/skills/docgen/js/docgen-prompts.mjs`, `npm/skills/docgen/js/docgen-extract.mjs`.
