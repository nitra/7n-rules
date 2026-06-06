---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T15:57:19+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

## ADR gemma3:4b в оркестрованому режимі — еталон Tier 1 docgen

## Context and Problem Statement
Для локальної генерації поведінкової документації необхідно було визначити оптимальну пару «модель + режим» на 8 GB M2: порівнювались gemma3:4b та gemma4:4b у режимах `orchestrated` та `oneshot`, доповнені Stage-2 `stripSignatures` і негативними маркерами кешу.

## Considered Options
* `gemma3:4b` + `orchestrated` режим (секційно-мінімальний контекст v2)
* `gemma3:4b` + `oneshot` режим
* `gemma4:4b` + `oneshot` режим

## Decision Outcome
Chosen option: "`gemma3:4b` + `orchestrated`", because бенч (3 файли, 12-бальна шкала) показав 92% якості при 52s avg/file, тоді як `gemma3:4b oneshot` дав 47% (implementation dump на k8s-tree), а `gemma4:4b oneshot` — 75% при 162s avg (3× повільніше через 56/44 CPU/GPU split на 5.3 GB моделі).

### Consequences
* Good, because transcript фіксує очікувану користь: оркестрований режим не «зривається» в implementation details — k8s-tree: local=83% vs one-shot=17%.
* Bad, because `npm/skills/docgen/js/docgen-gen.mjs` та `docgen-prompts.mjs` ускладнюються: Stage 0 → Stage 1 секційні промпти → Stage 2 → Stage 3 assemble замість одного LLM-виклику.

## More Information
Зміни злиті в `main` через `git merge --no-ff feat/docgen-orchestrator-pi` (commit `5e9d3a7b`). Ключові файли: `npm/skills/docgen/js/docgen-gen.mjs`, `npm/skills/docgen/js/docgen-prompts.mjs`. Команда benchmark: `MODEL=gemma3:4b MTAG=g3 MODES=orchestrated,oneshot node ~/docgen-bench3/bench_final.mjs`.

---

## ADR `sym ≥ 4` як поріг маршрутизації local → cloud у docgen

## Context and Problem Statement
Локальна модель (gemma3:4b) генерує документацію незадовільної якості для складних файлів: видає тавтологічні Гарантії, хибні інваріанти та витоки внутрішніх імен. Потрібен детермінований сигнал (0 токенів), що вирішує, який файл іде в `local`, а який — у `cloud` (Claude).

## Considered Options
* `internalSymbols.length` (`sym`) як єдиний поріг
* `combo = sym + exp*2 + imp` (зважена сума)
* `sym + imp` (без exports)
* Кількість рядків коду (`loc`)

## Decision Outcome
Chosen option: "`sym ≥ 4` → cloud", because `sym` показав найсильнішу негативну кореляцію з якістю (Pearson r = −0.651) на 7 файлах; `exp` (кількість публічних exports) має ПОЗИТИВНУ кореляцію (+0.384) і розбавляє `combo`. Поріг 4 дає split 78% local / 22% cloud (189/52 з 241 source файлів проєкту після виключення `npm/reports/**` і `npm/bin/**`).

### Consequences
* Good, because transcript фіксує очікувану користь: local-група (sym < 4) avg 89% якості, cloud-група (sym ≥ 4) — 65%; на реальних файлах `commands.mjs` (sym=15) і `safety.mjs` (sym=17) локальна модель видала помилковий Огляд і хибні гарантії (LISTEN/NOTIFY для Bun SQL), що cloud-версія уникла.
* Bad, because `k8s-tree.mjs` (sym=4, якість 83%) потрапляє у cloud-tier попри прийнятну локальну якість — зайва витрата cloud-токенів для цього файлу.

## More Information
Аналіз у `~/docgen-bench3/complexity.mjs` та `~/docgen-bench3/tier_audit.mjs`. Реалізація — один рядок: `const tier = facts.internalSymbols.length >= 4 ? 'cloud' : 'local'` у `generateDoc`. Стан: threshold досліджено, інтеграція у `docgen-gen.mjs` — pending.

---

## ADR Відмова від LLM-судді (Approach B) і детермінованого скорингу (Approach A) як якісного гейту

## Context and Problem Statement
Після генерації документації потрібно було визначити, чи відповідає вихід заданій якості, щоб автоматично вирішувати, чи передавати файл у cloud. Розглядались два підходи — LLM-суддя (та ж модель оцінює свій вивід) і детермінований скоринг на основі `extractFacts`.

## Considered Options
* Approach B: gemma3:4b як суддя — окремий JSON-промпт із критеріями behavioral/no_leaks/structure/accuracy (0–10)
* Approach A: детермінований скоринг через `scoreDoc(md, facts)` — перевірка наявності `## Огляд`, витоків внутрішніх імен у Гарантіях, галюцинацій кешу
* Підхід через складність файлу (`sym` threshold, обраний ADR вище)

## Decision Outcome
Chosen option: "складність файлу (`sym` threshold)", because обидва scoring-підходи провалились як якісні гейти: Approach B — систематичний зсув +25 пп (модель «прощає» власні вироби), `no_leaks` завжди ≥ 9, час 109s avg (вдвічі більше генерації); Approach A після виправлення false positives (`\b` не працює з кирилицею, negation перед «кеш» не вловлювалась) — зсув збільшився до +35 пп і не бачить семантичних помилок (розмитий Огляд, Rego-інваріанти у Гарантіях).

### Consequences
* Good, because transcript фіксує очікувану користь: `sym`-поріг є детермінованим (0 токенів, < 1 ms), передбачуваним і корелює з реальними дефектами краще за обидва scoring-підходи.
* Bad, because transcript не містить підтверджених негативних наслідків — підхід обрано після двох невдалих експериментів, але реальне покриття помилок на більшій вибірці ще не перевірено.

## More Information
Experiment scripts: `~/docgen-bench3/judge_b.mjs` (Approach B), `~/docgen-bench3/score_a.mjs` (Approach A). Ключовий баг Approach A: `\b` не працює з кирилицею в JS regex — фікс через `(?:^|[\s,;.()\[\]*])(не|немає|без|відсутн)` для детекції заперечень перед «кеш».
