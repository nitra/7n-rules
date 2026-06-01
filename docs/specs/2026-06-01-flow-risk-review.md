---
kind: nitra-spec
status: draft
adr: null
plan: null
risk: med
---

# risk-aware глибина review — дизайн

Дата: 2026-06-01
Власник: @vitaliytv
Статус: Draft (очікує апруву)

## Мета

Зробити `flow review` **ризик-орієнтованим**, а не лише розмір-орієнтованим
(зараз кількість рецензентів — лише за `level`). Сигнал ризику йде через увесь
ланцюг: `init` визначає baseline з опису → `flow spec` зчитує `risk:` із
frontmatter spec (override) → `flow review` масштабує кількість рецензентів і
**фокус** промпта.

## Передісторія

Security-фікс на 5 рядків — це `level 0` (1 рецензент), хоча ризик високий.
BMAD risk-profile показує цінність risk-driven перевірки. Без окремих `docs/qa/`
артефактів (зайва церемонія) — тримаємо ризик як `state.risk` + поле у spec.

## Scope

**In:**
- `detectRisk(desc)` → `low|med|high` за ключовими словами.
- `reviewersFor(level, risk)` — max(за рівнем, за ризиком).
- `init` пише `risk` у стан; `flow spec` зчитує `risk:` зі spec-frontmatter (override).
- `flow review` — кількість рецензентів за `reviewersFor`; high-risk додає
  безпековий фокус у промпт.
- Контракт `flow.mdc` — згадка ризику.

**Out:** окремі risk-profile/nfr-assess файли; скоринг probability×impact.

## Дизайн

- **detectRisk(desc):** high — `security|auth|crypto|payment|secret|token|permission|password`; med — `data|db|migration|delete|payment|gateway`; інакше low.
- **reviewersForRisk(risk):** high→3, med→2, low→1. **reviewersFor(level, risk):** `max(reviewersForLevel(level), reviewersForRisk(risk))`, кап 3.
- **init:** `risk: detectRisk(desc)` поряд з `level`.
- **spec:** після резолву doc — `parseFrontMatter`; якщо є `risk` ∈ {low,med,high} → `state.risk = <spec>` (override init-baseline). Так «risk у spec керує review».
- **review:** `reviewersFor(state.level, state.risk)`; `reviewerPrompt(diff, risk)` — для high додає рядок-лінзу «особлива увага БЕЗПЕЦІ (auth, секрети, ін'єкції, доступи)».

## Зв'язок із тестами

- `detectRisk`/`reviewersForRisk`/`reviewersFor` — чисті, таблиця.
- `init` пише risk; `spec` override з frontmatter; `review` спавнить N=reviewersFor і додає лінзу для high.

## Ризики

- Подвійне джерело (init vs spec) — spec має пріоритет (явніший намір); якщо у
  spec нема `risk`, лишається init-baseline.
