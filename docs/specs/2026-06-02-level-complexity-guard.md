---
kind: nitra-spec
status: draft
adr: null
plan: ../plans/2026-06-02-level-complexity-guard.md
risk: low
---

# detectLevel: COMPLEXITY-guard (fix+складність не тривіальне)

Дата: 2026-06-02
Беклог: #2-guard (варіант A: complexity → L2)

## Проблема

Після hygiene `detectLevel` усе ще: `fix mdc checker` / `fix суперечність у rules` → L0
(тривіальне, spec/plan можна пропустити, 1 рецензент). Але задача, що чіпає правила/чеки,
НЕ тривіальна — у задачі 1 пропущений-би spec майже пропустив невірний код.

## Рішення (A)

`COMPLEXITY_KEYS` (сигнали cross-cutting rules/checks): mdc, policy, політик, rego,
checker, чекер, правил, rules, суперечн, conflict, конфлікт, інваріант, invariant,
порушен, violation, кілька файл, декілька, meta-.
Порядок: `L3 > (L2_KEYS ∪ COMPLEXITY_KEYS) → 2 > isL0 → 0 > L1`. Складність (як і явні
L2-ключі) перекриває L0. Чисте `fix typo` лишається L0. Word-boundary hygiene — без змін.

## Зміни

`level.mjs`: COMPLEXITY_KEYS; у detectLevel перенести `(L2 || COMPLEXITY) → 2` ПЕРЕД `isL0 → 0`.

## Тести

fix mdc checker → 2; fix суперечність у rules → 2; fix rego policy → 2; чисте fix typo → 0;
bump → 0; add prefix validation → 1 (hygiene без регресу); feature → 2; migration → 3.

## Не-цілі

Не чіпаємо hygiene/detectRisk; over-класифікація (L0→L2) безпечніша за under.

## Ризики

Low. Реордер + новий набір ключів; евристика на тексті.
