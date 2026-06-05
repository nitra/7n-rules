---
kind: nitra-spec
status: draft
adr: null
plan: null
---

# flow gate — структурований вердикт релізної готовності

Дата: 2026-06-01
Власник: @vitaliytv
Статус: Draft (очікує апруву)

## Мета

Капстоун над `verify` (механічні гейти) і `review` (adversarial findings):
єдина команда **`flow gate`**, що синтезує їх у структурований вердикт
**PASS / CONCERNS / FAIL** + числовий score + перелік причин, і пише його в
`.flow.json`. Дає traceability «чому готово / не готово» (ідея BMAD qa-gate, але
у нашому стані, без окремого yaml).

## Передісторія

Зараз `verify` повертає булеве 0/1, `review` пише findings. Немає єдиної точки,
що відповідає «чи можна релізити і чому». BMAD qa-gate показує цінність
структурованого вердикту з причинами й score. У нас уже є в стані `gates[]`
(від verify) і `review.findings` — `gate` їх лише синтезує (чиста функція).

## Scope

**In:**

- Чиста функція `computeGate(state)` → `{ verdict, score, reasons[] }`.
- Команда `flow gate` — пише `gate` у `.flow.json`, друкує вердикт; exit 1 на FAIL.
- `release` м'яко попереджає, якщо `gate.verdict === 'FAIL'` (не блокує — наша
  філософія м'яких воріт; FAIL — сигнал, рішення за людиною).
- Контракт `flow.mdc` — крок gate перед release.

**Out:** окремий qa-gate.yaml; NFR-секції; waiver-флоу.

## Дизайн

### `computeGate(state)` (чиста)

Вхід: `state.gates` (verify), `state.review.findings` (review).

- `failedGates` = gates із `!ok`; `high`/`med` = findings за severity.
- Вердикт:
  - **FAIL** — є провалений gate **або** ≥1 high-severity finding;
  - **CONCERNS** — є med-finding **або** verify ще не запускався (`gates` порожні);
  - **PASS** — gates зелені й немає high/med.
- `score` (0..100) = `100 − 40·failedGates − 25·high − 8·med − 15·(verify не запускався)`, clamp.
- `reasons[]` — людино-читабельні рядки (що саме знизило вердикт).

### `flow gate`

1. Нема стану → 1.
2. `computeGate(state)` → запис `gate: { verdict, score, reasons, at }` через `recordTransition`.
3. Друк: `gate: <verdict> (score N)` + причини.
4. Exit: FAIL → 1; PASS/CONCERNS → 0 (інформативний сигнал для CI/людини).

### `release`

Після наявної логіки — якщо `state.gate?.verdict === 'FAIL'`: лог-варн
«реліз на FAIL-гейті — переконайся свідомо» (не блокує).

## Зв'язок із тестами

- `computeGate` — чиста, таблиця сценаріїв (всі зелені→PASS; failed gate→FAIL;
  high→FAIL; med→CONCERNS; порожні gates→CONCERNS; score-кламп).
- `flow gate`: стан/now ін'єкція; нема стану→1; FAIL→1; PASS→0; запис у стан.
- `release`: тест, що при `gate.verdict==='FAIL'` є попередження.

## Ризики

- Подвійний рахунок (verify пише `status: failed` + gate FAIL) — gate лише
  читає, не дублює рішення verify; це різні рівні (gate — агрегат).
