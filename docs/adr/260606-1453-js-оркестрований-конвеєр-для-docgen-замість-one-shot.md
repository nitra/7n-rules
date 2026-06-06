---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T14:53:44+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

[thinking]
The user is asking about implementing the complexity-based cloud fallback in `docgen-gen.mjs`. Looking at the transcript, this is where the session ended. The user agreed to the sym≥3 threshold as a practical approach.

Now my task is to analyze the transcript and produce ADR documentation.

Looking at the transcript, there are several key decisions made:

1. **Behavioral documentation style** (from the beginning)
2. **Orchestrated vs one-shot docgen** (major architectural decision)
3. **Section-minimal context (v2 orchestration)** with Stage 2 lint
4. **Local LLM Tier 1 with gemma3:4b** orchestrated mode
5. **Approach B rejected** (LLM-as-judge) for quality gate
6. **Approach A limitations** revealed (deterministic scoring)
7. **Complexity-based routing** (`sym ≥ 3` → cloud) as the adopted signal

The key architectural decisions I need to document as ADRs:

1. **JS-orchestrated pipeline over one-shot** - fundamental architectural shift
2. **Section-minimal context v2** - code only in `behavior` section
3. **Stage-2 deterministic lint** (stripSignatures + negative markers)
4. **`sym ≥ 3` complexity threshold** for cloud fallback
5. **Approach B (LLM judge) rejected** vs Approach A (deterministic) - with complexity gate as final choice

The session also confirmed gemma3:4b as the Tier 1 model (already in memory).

Let me think about which decisions are truly architectural and should be documented:

1. **ADR: JS-orchestrated конвеєр для docgen** - replacing pure one-shot with JS-orchestrated pipeline
2. **ADR: Section-minimal context** - code sent only to `behavior` section
3. **ADR: Complexity-based routing (sym ≥ 3) для Tier 2 fallback** - the new major decision from this session

Actually the most important decisions to document from this session are:
1. The complexity-based routing approach (most novel, just decided)
2. The deterministic Stage 2 lint (stripSignatures + negative markers)
3. The rejection of LLM-as-judge (Approach B)
4. JS-orchestrated pipeline (confirmed/formalized this session)

Let me produce 2-3 ADRs covering the main novel decisions from this transcript:
1. JS orchestration (architectural)
2. Complexity routing with sym≥3 threshold
3. LLM judge rejection
</thinking>

## ADR JS-оркестрований конвеєр для docgen замість one-shot

## Context and Problem Statement
Скіл `n-docgen` генерував документацію одним LLM-запитом (one-shot), де модель отримувала весь вихідний файл і самостійно вирішувала, що включити. Локальна модель (gemma3:4b) систематично витікала у implementation details: назви внутрішніх функцій, сигнатури з аргументами, кроки обходу файлової системи — особливо для складних файлів (k8s-tree.mjs, one-shot дав 17%).

## Considered Options
* JS-оркестрований конвеєр: детермінований Stage 0 (extractFacts) → секційні промпти Stage 1 → детермінований lint Stage 2 → асемблювання Stage 3
* One-shot: весь файл і всі секції в одному LLM-запиті

## Decision Outcome
Chosen option: "JS-оркестрований конвеєр", because LLM стає sервісом чистої прози; JS контролює, яка інформація (лише code або лише факти) потрапляє до кожної секції.

### Consequences
* Good, because transcript фіксує очікувану користь: g3 ORCH 92% vs g3 ONE 47% на тих самих файлах — розрив 45 пп на k8s-tree.mjs.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Три нові файли в `npm/skills/docgen/js/`: `docgen-extract.mjs` (Stage 0), `docgen-prompts.mjs` (Stage 1, секційні промпти), `docgen-gen.mjs` (оркестратор + Stage 2 `stripSignatures`). Коміти `17cfca32` і `45a7466c` у гілці `feat/docgen-orchestrator-pi`, злитій в `main` через `5e9d3a7b`.

---

## ADR Секційно-мінімальний контекст v2 та Stage-2 детермінований лінт

## Context and Problem Statement
Перша версія оркестрації (v1) передавала повний код у кожну секцію — це дало лише +6 пп якості відносно one-shot і сповільнило генерацію у 2–5× (кожна секція перевантажувалась повним файлом). Окремо виявлено дві стійкі галюцинації: сигнатури функцій з аргументами у тексті (`name(arg)`) і згадка кешу в Гарантіях у файлів без кешування.

## Considered Options
* Секційно-мінімальний контекст (v2): код лише у секцію `behavior`, решті секцій — тільки fact-list
* Передавати повний код у кожну секцію (v1)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Секційно-мінімальний контекст v2 + Stage-2 лінт (0 токенів)", because усуває 2 головних патерни галюцинацій детерміновано: `stripSignatures` знімає залишки сигнатур, негативні маркери (`'Кешування: НЕМАЄ — не згадуй кеш у гарантіях'`) у `factsSummary` блокують cache-hallucination.

### Consequences
* Good, because transcript фіксує очікувану користь: v2 відновлює конкурентний час (g3 ORCH 52s avg ≈ g3 ONE 53s) при збереженні якості 92%.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`docgen-prompts.mjs`: функції `sectionMessages` (v2, секційно-мінімальний) і `oneShotMessages`. `docgen-gen.mjs`: `stripSignatures` застосовується і для orchestrated, і для one-shot. Негативні маркери у `factsSummary`: `caches ? 'Кешування: так' : 'Кешування: НЕМАЄ — не згадуй кеш у гарантіях'`.

---

## ADR Відхилення LLM-судді (Підхід B) та детермінованого скорингу (Підхід A) на користь complexity-gate

## Context and Problem Statement
Генератор docgen потребував якісного gate, щоб автоматично визначати, які файли потребують хмарного re-генерування замість локального. Протестовано два підходи: B (gemma3:4b оцінює власний вихід) і A (детермінований скоринг за фактами із Stage 0).

## Considered Options
* Підхід B (LLM-суддя): окремий промпт до тієї ж моделі, оцінка 0-10 за 4 критеріями
* Підхід A (детермінований скоринг): перевірка вихідного doc проти `facts` — галюцинація кешу, витік internal symbols, відсутність `## Огляд`, коротка Поведінка
* Complexity-gate: `facts.internalSymbols.length >= 3 → 'cloud'` (0 токенів, 0 часу)

## Decision Outcome
Chosen option: "Complexity-gate (`sym ≥ 3`)", because Підхід B має систематичний зсув +25 пп (модель "прощає" власні вироби, `no_leaks` = 9 навіть для файлів із явними витоками). Підхід A після виправлення false positives показав зсув +35 пп — гірше за B, бо не бачить семантичних галюцинацій. `sym` (кількість внутрішніх символів) має Pearson −0.651 з якістю і детерміновано не потребує жодного LLM-виклику.

### Consequences
* Good, because transcript фіксує: поріг `sym ≥ 3` дає local-групу avg 89% (js/lint.mjs 75%, firebase_hosting 100%, overlay-paths 92%) vs cloud-групу avg 65% — розрив 24 пп; threshold-cost 0 токенів, <1 ms.
* Bad, because transcript фіксує: k8s-tree (sym=4, якість 83% для local) потрапляє у cloud-групу попри прийнятну локальну якість — консервативний false positive.

## More Information
Бенч-скрипти: `~/docgen-bench3/judge_b.mjs` (Підхід B), `~/docgen-bench3/score_a.mjs` (Підхід A), `~/docgen-bench3/complexity.mjs` (correlation analysis, 7 файлів). Рекомендована реалізація у `generateDoc`: `const tier = facts.internalSymbols.length >= 3 ? 'cloud' : 'local'`. Хмарний Tier 2 не реалізований у цій сесії.
