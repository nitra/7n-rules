---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T17:34:00+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

Весь проект покрито. Надаю ADR-рішення, що виникли за цю бенч-сесію.

---

## ADR Двотировий routing docgen за кількістю внутрішніх символів

## Context and Problem Statement
Під час бенч-сесії виявлено, що gemma3:4b orchestrated pipeline систематично генерує семантично помилкові документи для складних файлів — плутає внутрішні функції з публічними exports, приписує Rego-логіку JS-файлу, інвертує бізнес-логіку (`consistency.mjs`). Потрібен детермінований сигнал для вирішення, які файли треба відправити до cloud (Claude Sonnet), а які — обробити локально.

## Considered Options
* Підхід B (LLM-суддя): gemma3:4b оцінює власний вивід за шкалою 0–10 по чотирьох метриках
* Підхід A (детермінований скорер): перевірка виводу проти `facts` зі Stage 0 (відсутність заголовків, cache-hallucination, витік internal-символів)
* Складність файлу як сигнал: `facts.internalSymbols.length >= 4` → cloud

## Decision Outcome
Chosen option: "Складність файлу як сигнал (`sym ≥ 4`)", because Pearson r = −0.651 між `sym` і якістю доки — найсильніший предиктор серед усіх метрик; Підхід B має систематичний зсув +25 пп і не виловлює `no_leaks`; Підхід A після виправлення false positives дає ще гірший зсув +35 пп і сліпий до семантичних помилок (score=100 при зламаній документації `workflows.mjs`). Поріг `sym ≥ 4` підтверджено на реальних файлах проєкту.

### Consequences
* Good, because 78% файлів проєкту (189/241) обробляються локально (0 токенів, ~$0); 22% (52 файли) йдуть до cloud за ~$1.5–2 на весь проєкт.
* Good, because бенч на 4 граничних рівнях (sym=4–7) підтвердив: критичні семантичні помилки впевнено починаються з sym=5 (`lint.mjs` — хибна гарантія типу повернення), стають обов'язковими з sym=6–7 (`workflows.mjs`, `consistency.mjs` — інвертована логіка).
* Bad, because sym=4 є граничною зоною: `k8s-tree.mjs` (sym=4) дав score=90 локально і міг би залишитися в local tier, але поріг `≥ 4` відправляє його до cloud як консервативне рішення.

## More Information
* `npm/skills/docgen/js/docgen-gen.mjs:231` — `const DEFAULT_SYM_THRESHOLD = 4`
* `npm/skills/docgen/js/docgen-ignore.mjs` — додано `'npm/bin/**'` (stryker-сендбокси `npm/reports/**` вже були)
* Бенч: `~/docgen-bench3/complexity.mjs` — кореляційний аналіз (sym r=−0.651, exp r=+0.384, imp r=−0.585, combo r=−0.287)
* Audit: `~/docgen-bench3/tier_audit.mjs` — 241 файл, sym≥4: 52 cloud (22%), sym<4: 189 local (78%)
* Production run: 58 missing files generated — 6 cloud, 52 local, score min=80, avg~94%, 0 помилок
