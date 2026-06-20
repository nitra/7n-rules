---
session: abfb2eb3-9386-4893-bded-ada6a89c0e04
captured: 2026-06-20T06:55:58+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/abfb2eb3-9386-4893-bded-ada6a89c0e04.jsonl
---

**0 кандидатів**. Чому:
- 310 «чистих» (нормалізованих) — транскрипту більше немає, cross-project перевірити неможливо.
- 222 чернетки — сесійний transcript-файл уже видалений.
- 6 — чисте Q&A без правок (перевірка пропускає).
- Ті 134, де transcript є → всі помічені як `in-project` (файли в `$PROJECT_ROOT`).

Практично: проблеми «чужі ADR пишуться в цей проєкт» ще не було — або існуючі такі вже нормалізовані і транскрипт пішов. Новий gate буде діяти наперед.

**Синк `normalize-decisions.sh` зроблено, усі три хуки ✅ конформні.**

---

## ADR: Відкидання нерелевантних ADR через cross-project gate у capture-хуці

## Context and Problem Statement

При паралельній роботі в кількох проєктах в одній сесії Stop-hook `capture-decisions.sh` згодовував LLM **весь транскрипт**, включно з `tool_use`-правками файлів із чужих репозиторіїв. Результатом були ADR-чернетки, що містили рішення з інших проєктів, записані в `docs/adr/` поточного проєкту. Питання: де відкидати нерелевантні ADR — на рівні capture чи normalize?

## Considered Options

* Додати відкидання на рівні `capture-decisions.sh` (детермінований gate + scope у промпті)
* Додати відкидання на рівні `normalize-decisions.sh`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати відкидання на рівні `capture-decisions.sh`", because:
- На цьому рівні ще живий сигнал «який це проєкт»: `CHANGED_FILES` із `tool_use.file_path` містить повні шляхи, і вже є helper `is_tooling_only_change` у `lib/tooling-only.sh` за тим самим патерном.
- На нормалайзі залишається лише проза чернетки — докази приналежності до проєкту втрачені.
- Нерелевантна чернетка взагалі не пишеться й не споживає бюджет нормалайзу.

Реалізація: два шари у `capture-decisions.sh`:
1. **Детермінований cross-project gate** (`has_in_project_change`): якщо в сесії були правки, але жодна не під `$PROJECT_ROOT` → skip (вимикається `ADR_CAPTURE_SKIP_CROSS_PROJECT=0`).
2. **Scope у промпті**: для змішаних сесій додано рядок `CURRENT PROJECT ROOT` + інструкцію документувати лише рішення в межах цього кореня.
3. **Helper `has_in_project_change`** у `lib/tooling-only.sh` поряд із наявним `is_tooling_only_change`.

### Consequences

* Good, because детермінований gate спрацьовує до LLM-виклику — дешево і без помилкових позитивів.
* Good, because нормалайз залишається запасною сіткою без змін.
* Bad, because для змішаних сесій (current + чужі файли) scope у промпті — це soft-constraint, не гарантія; LLM теоретично може все одно включити чуже рішення. Transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли (канонічне джерело + синхронізовані копії):
- `npm/.claude-template/hooks/capture-decisions.sh` — cross-project gate + scope у промпті
- `npm/.claude-template/hooks/lib/tooling-only.sh` — helper `has_in_project_change`
- `.claude/hooks/capture-decisions.sh` — синхронізована копія
- `.claude/hooks/lib/tooling-only.sh` — синхронізована копія
- `.claude/hooks/normalize-decisions.sh` — синхронізований із канонічним template (передіснуюча розбіжність, не пов'язана з основним завданням)

Новий тест: `npm/rules/adr/js/tests/capture-decisions-cross-project.test.mjs` (4 кейси, 36/36 тестів правила `adr` зелені).

Env-змінна для вимкнення: `ADR_CAPTURE_SKIP_CROSS_PROJECT=0`.

Конформність: `bun npm/rules/adr/fix.mjs` → усі три хуки ✅.
