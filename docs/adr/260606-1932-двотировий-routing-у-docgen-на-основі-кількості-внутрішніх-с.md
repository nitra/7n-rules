---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T19:32:37+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

ось фінальний ADR на основі transcript, що починається після resume-summary:

---

## ADR Двотировий routing у docgen на основі кількості внутрішніх символів

## Context and Problem Statement
При генерації поведінкової документації через локальну модель `gemma3:4b` якість падає для складних файлів — модель плутає внутрішні символи з публічним API, продукує тавтологічні гарантії та хибні інваріанти. Потрібен детермінований сигнал для вибору між дешевим локальним і надійним хмарним маршрутом.

## Considered Options
* `sym` (кількість internal symbols з `extractFacts`) як єдиний сигнал routing-у
* Комбінований score `sym + exp*2 + imp` (combo)
* Підхід A: детермінований скорер (regex-патерни) після генерації
* Підхід B: LLM-суддя (gemma3:4b оцінює власний вихід) після генерації

## Decision Outcome
Chosen option: "`sym ≥ 4` → cloud (Claude Sonnet), `sym < 4` → local (gemma3:4b orchestrated)", because Pearson r = −0.651 між `sym` і якістю доки — найсильніший з усіх вимірюваних сигналів; `combo` слабший (−0.287) бо `exp` має позитивну кореляцію (+0.384); Підхід A після виправлення false positives дав зміщення +35 пп (гірше за B); Підхід B — +25 пп зміщення і 109s/файл.

### Consequences
* Good, because 78% файлів (sym < 4) обробляються безкоштовно локально; cloud-порція (22%, ~52 файли на 241-файловому проєкті) коштує ~$1.5–2 за повний прогін.
* Good, because порогове рішення детерміновано і займає 0 токенів — обчислюється з `extractFacts` до будь-якого LLM-виклику.
* Good, because порівняльний тест на реальних файлах (commands.mjs sym=15, safety.mjs sym=17, workflows.mjs sym=6, consistency.mjs sym=7) підтвердив: локальна модель при sym ≥ 5 видає або тавтологію у Гарантіях, або хибні інваріанти, або перекидає напрямок порівняння версій.
* Bad, because sym=4 є граничним — `k8s-tree.mjs` (sym=4) дав 90% локально, що прийнятно, але pipeline все одно маршрутизує його у cloud.
* Bad, because детермінований скорер (Підхід A) сліпий до семантичних помилок — workflows.mjs отримав score=100 при критично зламаній доці; це підтверджує що порогова стратегія надійніша за post-hoc scoring.

## More Information
* Константа у коді: `DEFAULT_SYM_THRESHOLD = 4` у `npm/skills/docgen/js/docgen-gen.mjs:231`
* Pre-routing: `if (complexity >= symThreshold && env.ANTHROPIC_API_KEY) → claudeOneShot(...)` у `docgen-gen.mjs:263`
* Borderline zone `sym ∈ [2, 4)` → Tier 1 local + `cloudScoreDoc` (Haiku рефері) → fallback при `score < QUALITY_THRESHOLD (7)` у `docgen-gen.mjs:25`
* Stryker sandboxes `npm/reports/stryker/.tmp/` не були виключені — виявлено під час tier-аудиту; фікс: `'npm/bin/**'` додано до `DOCGEN_IGNORE_GLOBS` у `npm/skills/docgen/js/docgen-ignore.mjs` (commit `6436a901`)
* Tier-аудит на 241 файл (після виключення stryker/bin/tests): local=189 (78%), cloud=52 (22%) при sym ≥ 4
* Correlation script: `~/docgen-bench3/complexity.mjs`; Tier audit script: `~/docgen-bench3/tier_audit.mjs`
