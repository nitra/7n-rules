---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T19:49:15+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

Ось один ADR з цієї сесії:

## ADR Двотировий routing docgen на основі `sym` як тир-сигналу

## Context and Problem Statement
Проєктний docgen-конвеєр генерує поведінкову документацію для 241 вихідного файлу (після фільтрації stryker-сендбоксів та `npm/bin/`). Потрібно визначити, які файли можна обробляти локальною моделлю (gemma3:4b, безкоштовно), а які вимагають хмарного Claude — і встановити автоматичний quality gate з timeout.

## Considered Options
* `sym` (кількість внутрішніх символів) як єдиний routing-сигнал з порогом ≥ 4
* `combo = sym + exp*2 + imp` як зважена метрика
* `sym + imp` (без ваги для `exp`)
* Підхід B: LLM-суддя (Haiku оцінює якість) як основний gate
* Підхід A: детермінований скорер як основний gate

## Decision Outcome
Chosen option: "`sym ≥ 4` → Tier 2 (cloud), `sym < 4` → Tier 1 local + Haiku-рефері з timeout 5 хв", because Pearson-кореляція `sym` з якістю документації = −0.651 (найсильніший сигнал); `exp` має позитивну кореляцію (+0.384) і розбавляє `combo`; практичне порівняння хмарних і локальних доків підтвердило критичні семантичні помилки на sym ≥ 5 (хибні гарантії, інвертована логіка, плутання internal/public API), тоді як sym < 4 показав мінімальний score 80.

### Consequences
* Good, because на 241 файлі split 78% local / 22% cloud (~$1.5–2 на повний прогін); timeout 5 хв запобігає зависанню без втрати результату — timeout ескалює до Tier 2 автоматично.
* Bad, because sym=4 (12 файлів) є граничною зоною — k8s-tree.mjs дав 90% локально, отримує cloud; Haiku-рефері коштує токенів для ВСІХ sym < 4 файлів, хоча в реальному прогоні 52 файлів мінімальний score = 80 і ескалація не спрацювала жодного разу.

## More Information
- Константи: `DEFAULT_SYM_THRESHOLD = 4`, `LOCAL_TIMEOUT_MS = 5 * 60 * 1000` у `npm/skills/docgen/js/docgen-gen.mjs:231–233`
- `BORDERLINE_SYM_LOW` прибрано — Haiku-рефері тепер для всіх `sym < 4`
- `npm/bin/**` додано до `DOCGEN_IGNORE_GLOBS` у `npm/skills/docgen/js/docgen-ignore.mjs`
- `npm/reports/**` вже був у списку (stryker-сендбокси)
- Порівняння хмарних vs локальних доків: `~/docgen-bench3/comparison/` (git-репо, cloud як база)
- Audit-скрипт: `~/docgen-bench3/tier_audit.mjs`
- Pearson: sym=−0.651, exp=+0.384, imp=−0.585, combo=−0.287
