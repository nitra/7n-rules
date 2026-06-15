---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T14:01:49+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR Уніфікована LLM-fix абстракція з принципом bounded output

## Context and Problem Statement
Існувало дві незалежні реалізації opportunistic LLM-fix у lint-правилах: `runGenerationBatch` у `docgen-files-batch.mjs` (регенерація артефакту) і `llmLintFix` у `cspell-fix.mjs` (whole-file rewrite). Кожна мала власний preflight, circuit-breaker і knob моделі; спільного контракту не існувало, а безпечний тріаж (які правила можуть мати LLM-fix) не забезпечувався кодом.

## Considered Options
* Одна уніфікована абстракція: спільне оркестраційне ядро + per-rule стратегія з контрактом `fixOne → outcome ∈ {applied|suggested|nothing|systemic|transient|permanent}`; дві форми outcome (`apply` — регенерація bounded-артефакту; `suggest` — bounded JSON пропозиції)
* Окремі незалежні реалізації для кожного правила (статус-кво)

## Decision Outcome
Chosen option: "одна уніфікована абстракція", because стратегії мають спільний контракт (preflight / loop / circuit-breaker / cap / report) через `preflightLocalModel` у `npm/lib/llm.mjs`; форми outcome різні (apply ↔ suggest), але оркестрація спільна. Інваріант: кожна стратегія мусить давати **bounded output** незалежно від розміру входу — «перепис усього входу» заборонений (verified: `docgen-gen.mjs` 6k-файл → timeout 120 s при whole-file rewrite, 0 проблем при generate-bounded-doc).

### Consequences
* Good, because transcript фіксує очікувану користь: спільний `preflightLocalModel(model)` у `npm/lib/llm.mjs` прибрав дубльований preflight з `docgen-files-batch.mjs` і `cspell-fix.mjs`; тести 134/134 passed, eslint clean.
* Bad, because per-target loop і circuit-breaker лишились інлайн у doc-files (cspell — single-call); спільне ядро для loop/breaker не реалізовано в цій сесії — зазначено у спеці `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md` як незавершена уніфікація.

## More Information
Файли: `npm/lib/llm.mjs` (новий export `preflightLocalModel`), `npm/rules/doc-files/js/docgen-files-batch.mjs` (замінено локальний `preflightProblem`), `npm/rules/text/lint/cspell-fix.mjs` (теж). Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md` (статус: *measured ✅ 2026-06-15*). Changeset: `npm/.changes/260615-1344.md` (`patch/Changed`).

---

## ADR cspell-fix: класифікація-словник замість whole-file omlx-rewrite

## Context and Problem Statement
`npm/rules/text/lint/cspell-fix.mjs` використовував `llmLintFix` (просить модель повернути весь файл як JSON після виправлень). На реальному репо (1 406 cspell-знахідок, 292 файли) прогін показав: `curl exit 28` (timeout 120 s) на `docgen-gen.mjs`, memory-guard reject на `CHANGELOG.md` (~18 GB), parse-fail у більшості файлів, корисний результат — 0 фіксів. Причина архітектурна: whole-file rewrite порушує принцип bounded output (output ~ розмір файлу).

## Considered Options
* (a) whole-file `llmLintFix` (попередній підхід) — модель повертає весь файл
* (b) classify → `.cspell.json` — модель класифікує ≤80 слів (bounded JSON), валідні слова авто-дописуються у `.cspell.json`, ймовірні одруки виводяться як список на рев'ю (НЕ застосовуються)
* (c) detect-only baseline без LLM (статус-кво без автоматизації)

## Decision Outcome
Chosen option: "(b) classify → `.cspell.json`", because ~90 % cspell-знахідок на репо є валідними укр/тех-словами (підтверджено семплом: `instrumenter`, `schemars`, `лінтингу`, `монорепозиторію` тощо) — реальний ремедіейшн є додавання у словник, а не «виправлення». Варіант (b) bounded, безпечний (не мутує код), дав +79 валідних слів у `.cspell.json` за один omlx-виклик; (a) провалився на 2/2 тестових файлах із timeout/parse-fail.

### Consequences
* Good, because transcript фіксує очікувану користь: 0 timeout / 0 memory-guard / 0 parse-fail; один bounded omlx-виклик замість до 25 whole-file; 79/80 класифікацій коректні; результат видно як `git diff` на `.cspell.json`.
* Bad, because 1 шкідлива класифікація на 19 (`аутейдж`→`аудит`) потрапила як `valid` у словник у worktree-експерименті — помилки класифікатора можливі (тому typo-пропозиції НЕ застосовуються авто). Кілька junk-фрагментів (`docg`, `иться`) теж проскочили як valid.

## More Information
Файли: `npm/rules/text/lint/cspell-fix.mjs` (нова схема: `unknownWords`, `appendWordsToDict`, `classifyPrompt`, `parseClassify`), `npm/rules/text/lint/tests/cspell-fix.test.mjs`. Changeset: `npm/.changes/260615-1315.md` (`minor/Changed`). Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`, розділ «Результати виміру». Експеримент: worktree `exp/cspell-fix`, задача `banjjp4so`.

---

## ADR `meta.json: llmFix:true` як реальний opt-in через orchestrate

## Context and Problem Statement
Прапор `llmFix:true` у `meta.json` правила (введений у B) був декоративним: `runLint` у `npm/rules/lint/js/orchestrate.mjs` не читав його і передавав `readOnly` незалежно від значення. Opportunistic LLM-fix фактично вмикався лише умовою `!readOnly` всередині правила — без safety-тріажу на рівні orchestrate.

## Considered Options
* Прочитати `meta.llmFix` у `runLint` і передати прапор у `lint(files, cwd, { readOnly, llmFix })` — orchestrate контролює opt-in
* Лишити прапор декоративним і покластися на логіку всередині кожного правила

## Decision Outcome
Chosen option: "прочитати `meta.llmFix` у `runLint` і передати прапор", because це єдиний механізм, що гарантує: правило без `llmFix:true` у `meta.json` ніколи не отримає LLM-fix-сходинку навіть якщо всередині є код для неї. Це реалізує safety-тріаж зі спеки (логічні лінтери — opt-out за замовчуванням).

### Consequences
* Good, because transcript фіксує очікувану користь: додано `llmFix:true` у `npm/rules/doc-files/meta.json` і `npm/rules/text/meta.json`; правила без прапора (`eslint`, `oxlint` тощо) отримують `{ readOnly: true }` незалежно від режиму запуску.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/lint/js/orchestrate.mjs` (читання `metaById[id]?.llmFix`; також зафіксовано pre-existing `no-unsanitized/method` помилку на line 118, виправлено `// eslint-disable-line`), `npm/rules/doc-files/js/lint.mjs` (підпис `lint(files, cwd, { readOnly, llmFix })`), `npm/rules/text/js/lint.mjs`, `npm/rules/text/lint/lint.mjs`, `npm/rules/text/lint/cspell-fix.mjs` (підписи оновлено). Changeset: `npm/.changes/260615-1359.md` (`minor/Changed`). Схема: `npm/schemas/rule-meta.json` (додано `llmFix: boolean`).
