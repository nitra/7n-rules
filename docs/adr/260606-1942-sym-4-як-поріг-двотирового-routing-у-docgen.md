---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T19:42:48+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

Ось ADR для фінального рішення сесії:

---

## ADR sym ≥ 4 як поріг двотирового routing у docgen

## Context and Problem Statement
Документаційний pipeline (docgen) працює на двох рівнях: локальна модель (gemma3:4b, безкоштовно) та хмарна (Claude Sonnet, платно). Потрібно детерміновано вирішувати, який tier використовувати для конкретного файлу без LLM-залежного скорингу.

## Considered Options
* Підхід B — LLM-суддя (gemma3:4b) оцінює якість doc по шкалі 0-10
* Підхід A — детермінований скорер на регулярних виразах
* Складність файлу (`sym`) як сигнал для pre-routing

## Decision Outcome
Chosen option: "`sym ≥ 4` → cloud (pre-routing), `sym < 4` → local", because кореляція Pearson між кількістю internal symbols і якістю документації становить −0.651 — найсильніший одиничний предиктор; порогове значення 4 дає 78% local / 22% cloud розподіл на 241 файлі реального проєкту з підтвердженою різницею якості: local-avg 89% (sym < 4) vs 65% (sym ≥ 4).

### Consequences
* Good, because threshold детермінований і коштує 0 токенів — рішення приймається на `extractFacts()` без додаткових API-викликів.
* Good, because transcript фіксує очікувану користь: sym=4 файли на межі (k8s-tree.mjs: 90% якості), sym≥5 файли мають критичні помилки — перевернута логіка версій (consistency.mjs), хибні інваріанти (safety.mjs), витік internal-символів у публічний API (workflows.mjs).
* Bad, because `exp` (exports count) має ПОЗИТИВНУ кореляцію (+0.384) — файли з багатьма публічними функціями (overlay-paths.mjs: 6 exports, 92%) обробляються локально добре, але поріг лише по `sym` це не враховує.
* Bad, because Stryker-сендбокси (`npm/reports/stryker/.tmp/`) дублюють source файли і перекошують sym-підрахунок — виправлено додаванням `npm/reports/**` і `npm/bin/**` до `DOCGEN_IGNORE_GLOBS`.

## More Information
* `npm/skills/docgen/js/docgen-gen.mjs:231` — `const DEFAULT_SYM_THRESHOLD = 4`
* `npm/skills/docgen/js/docgen-gen.mjs:261–265` — pre-routing block: `if (complexity >= symThreshold && env.ANTHROPIC_API_KEY) { claudeOneShot(...) }`
* `npm/skills/docgen/js/docgen-ignore.mjs` — додано `npm/bin/**` у `DOCGEN_IGNORE_GLOBS` (commit `6436a901`)
* Бенч-дані: `~/docgen-bench3/complexity.mjs`, `~/docgen-bench3/tier_audit.mjs`
* Порівняльні доки: `~/docgen-bench3/comparison/` (git repo: cloud = base commit, local = working tree)

---

Now let me analyze the full transcript to see if there are more ADRs to extract. Actually, the ADR document above represents the main design decision. The transcript also discusses the discovery that Stryker sandboxes inflate the sym counts, the rejection of Approaches A and B as quality gates, and the decision to use a simpler non-empty/timeout check vs the current det-scorer. Let me write the ADRs appropriately.

The session contains several design decisions worth capturing as separate ADRs:
1. `sym ≥ 4` as tier routing threshold (main)
2. Rejection of LLM judge (Approach B) and deterministic scorer (Approach A) as quality gates
3. docgen-ignore.mjs — adding npm/reports/** and npm/bin/**

Let me emit these as separate ADRs.

## ADR sym ≥ 4 як поріг двотирового routing у docgen

## Context and Problem Statement
Документаційний pipeline (docgen) має два рівні обробки: локальна модель (gemma3:4b, безкоштовно) і хмарна (Claude Sonnet). Потрібен детермінований нульо-токенний сигнал для pre-routing без залучення LLM-суддів.

## Considered Options
* Підхід B — LLM-суддя (gemma3:4b) оцінює якість готової доки (JSON-скор 0–10)
* Підхід A — детермінований скорер: відсутній `## Огляд`, хибне кешування, вихід internal-символів
* Складність файлу (`sym = internalSymbols.length`) як pre-routing сигнал

## Decision Outcome
Chosen option: "складність файлу (`sym ≥ 4`) як pre-routing сигнал", because Pearson r = −0.651 між `sym` і якістю доки — найсильніший одиничний предиктор; B відхилено (+25 пп систематичного зсуву, 109 с/файл), A відхилено (+35 пп зсуву після виправлення false-positives, сліпий до семантичних помилок).

### Consequences
* Good, because рішення приймається на `extractFacts()`, 0 токенів, без API-викликів.
* Good, because transcript фіксує очікувану користь: на 241 файлі реального проєкту — 78% local / 22% cloud; підтверджено на реальних прикладах: sym=4 k8s-tree.mjs 90% якості, sym=5+ мають критичні семантичні помилки.
* Bad, because `exp` (exports count) має позитивну кореляцію (+0.384) — файли з багатьма публічними функціями обробляються локально добре, але threshold по `sym` цього не враховує; можливий зайвий cloud-виклик.
* Bad, because sym=4 є граничною зоною (один файл у бенчі): при зміщенні розподілу файлів у проєкті точність класифікації може знизитись.

## More Information
* `npm/skills/docgen/js/docgen-gen.mjs:231` — `const DEFAULT_SYM_THRESHOLD = 4`
* `npm/skills/docgen/js/docgen-gen.mjs:261–265` — pre-routing: `if (complexity >= symThreshold && env.ANTHROPIC_API_KEY) { claudeOneShot(...) }`
* Кореляційний аналіз: `~/docgen-bench3/complexity.mjs` (Pearson: sym=−0.651, exp=+0.384, imp=−0.585)
* Tier-аудит проєкту: `~/docgen-bench3/tier_audit.mjs`
* Підтверджувальне порівняння: `~/docgen-bench3/comparison/` — cloud base commit vs local working tree для `commands.mjs` (sym=15) і `safety.mjs` (sym=17)

---

## ADR Відхилення LLM-судді і детермінованого скорера як quality gate

## Context and Problem Statement
Після генерації доки локальною моделлю потрібен механізм оцінки якості, який вирішує — прийняти результат чи ескалювати до хмари. Було розглянуто два підходи: LLM-суддя (Підхід B) і детермінований скорер на регулярних виразах (Підхід A).

## Considered Options
* Підхід B — gemma3:4b оцінює готову доку як JSON `{behavioral, no_leaks, structure, accuracy}` 0–10
* Підхід A — regex-скорер: штрафи за відсутній `## Огляд`, хибне кешування, internal-символи у Гарантіях

## Decision Outcome
Chosen option: "відхилені обидва, використовується pre-routing за `sym`", because B має +25 пп систематичного зсуву та `no_leaks` завжди = 9; A після виправлення false-positives (Cyrillic `\b`, `shellcheck` → `ensureTool`) має +35 пп зсуву і не бачить семантичних помилок: розмитий Огляд, Rego-інваріанти приписані JS-файлу, перевернута логіка версій — все дає score=100.

### Consequences
* Good, because transcript фіксує очікувану користь: pre-routing дешевший (0 токенів) і корелює з реальною якістю краще за обидва скорери.
* Bad, because transcript не містить підтверджених негативних наслідків; детермінований скорер залишається як метрика у `generateDoc` але не як gate для ескалації.

## More Information
* `~/docgen-bench3/judge_b.mjs` — Підхід B (відхилено): JSON-скоринг через ollama, avg 109 с/файл
* `~/docgen-bench3/score_a.mjs` — Підхід A (відхилено): regex-скорер з виправленим Cyrillic word-boundary (`(?:^|[\s,;.()\[\]*])(не|немає|без|відсутн)` замість `\bне\b`)
* Зведена таблиця з transcript: fix.mjs A=100% / B=85% / manual=50%; workflows.mjs A=100% / B=85% / manual=58% — обидва скорери систематично завищують

---

## ADR Виключення npm/reports та npm/bin із docgen-ignore

## Context and Problem Statement
Під час tier-аудиту виявлено, що `docgen-scan.mjs` обходить `npm/reports/stryker/.tmp/sandbox-*/` — Stryker mutation testing sandboxes, які є копіями source файлів для ізольованого тестування. Це дублювало 695 файлів (938 замість реальних 241) і перекошувало sym-розподіл.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "додати `npm/reports/**` і `npm/bin/**` до `DOCGEN_IGNORE_GLOBS`", because `npm/reports/stryker/` — згенеровані артефакти тестування, не source код; `npm/bin/n-cursor.js` — згенерований bundle (sym=34), документувати його безглуздо.

### Consequences
* Good, because transcript фіксує очікувану користь: реальний розмір проєкту для docgen — 241 файл замість 938; sym-розподіл більше не спотворений.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* `npm/skills/docgen/js/docgen-ignore.mjs` — `npm/bin/**` додано у commit `6436a901`; `npm/reports/**` вже було присутнє до цієї сесії
* `~/docgen-bench3/tier_audit.mjs` — `SKIP_PATH_PREFIXES = ['npm/reports', 'npm/bin']` визначено вручну під час аудиту, потім перенесено у `docgen-ignore.mjs`
