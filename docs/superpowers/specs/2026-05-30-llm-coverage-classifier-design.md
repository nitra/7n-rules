# LLM Coverage Classifier — Design

**Дата:** 2026-05-30  
**Статус:** Approved

---

## Проблема

Поточний `n-cursor coverage` рахує «сирий» mutation score і відсотки покриття рядків. Ці метрики не розрізняють:

- мутанти, де справді потрібен тест (`killable`),
- мутанти, що семантично еквівалентні оригіналу (`equivalent`),
- файли, що є CLI-обгортками та покриваються інтеграційно (`glue`).

Результат — тиск до 100%-покриття змушує писати безцінні тести й ускладнює читання COVERAGE.md.

---

## Рішення

Після Stryker + vitest автоматично класифікуємо кожен survived мутант і кожен uncovered файл через Claude Sonnet 4.6 (prompt-cached). COVERAGE.md отримує окремий **Killable score** — єдина метрика, яку дійсно варто захищати.

---

## Архітектура

### Нові файли

| Файл | Призначення |
|---|---|
| `npm/scripts/lib/classify-coverage.mjs` | Orchestrator: читає джерела, кешує, батчить LLM, повертає `ClassifiedItem[]` |
| `npm/scripts/lib/classify-coverage-prompt.mjs` | System-prompt (cached) + per-item user-повідомлення |

### Змінені файли

| Файл | Зміна |
|---|---|
| `npm/rules/test/coverage/coverage.mjs` | Додає крок `classify` після Stryker + vitest |
| `npm/rules/test/js/coverage/coverage.mjs` (js-lint provider) | Повертає `survivalData` для classify |
| Файл що генерує `COVERAGE.md` | Нові секції: Killable score, Killable Mutants, Allowed Gaps |

### Кеш

`reports/classify/cache.json` — масив `ClassifiedItem`:

```ts
interface ClassifiedItem {
  id: string              // sha256(filePath + original + mutant)
  filePath: string
  line?: number
  original?: string       // undefined для uncovered-files
  mutant?: string         // undefined для uncovered-files
  type: 'mutant' | 'uncovered-file'
  verdict: 'killable' | 'equivalent' | 'defensive' | 'glue' | 'integration-only'
  confidence: number      // 0.0–1.0
  reason: string          // 1-2 речення від LLM
  classifiedAt: string    // ISO timestamp
}
```

---

## Flow

```
bun run coverage
  └─ runCoverageSteps()
       ├─ Stryker           →  reports/stryker/mutation.json (survived[])
       ├─ vitest --coverage →  reports/coverage-summary.json (uncoveredFiles[])
       ├─ classifyWithLLM(survived[], uncoveredFiles[])
       │      ├─ load cache.json  →  filter already-classified items
       │      ├─ build batched request (all new items in one Claude call)
       │      │     system: cached prompt (800 tokens, cache_control: ephemeral)
       │      │     user:   per-item blocks (file + line + context ±5 + existing tests)
       │      ├─ parse JSON responses → classify low-confidence (<0.7) → killable
       │      └─ merge + save cache.json
       └─ writeCoverageReport(rows, classified)
            ├─ Killable score = killed ÷ (killed + killable-survived)
            ├─ Table: ## Killable Survived Mutants  (verdict = killable)
            └─ Table: ## Allowed Gaps               (verdict ≠ killable + reason)
```

---

## LLM Prompt Design

### System prompt (кешований, постійний)

```
You are a mutation testing analyst. Classify each item as exactly one verdict:

  killable         — real behavior difference; a unit test is the right tool
  equivalent       — mutant produces identical observable behavior
  defensive        — test would be fragile/trivial (internal null-guard on always-valid input)
  glue             — CLI entrypoint / spawn-wrapper, covered by integration/subprocess test
  integration-only — real logic, but subprocess or integration test fits better than unit

Return ONLY valid JSON per item:
{ "verdict": "...", "confidence": 0.0-1.0, "reason": "<1-2 sentences>" }

Rules:
- confidence < 0.7 → still classify, but caller treats as killable regardless
- "equivalent" requires you to state what identical behavior looks like
- do NOT invent tests; only classify
```

### Per-item user message

```
File: rules/abie/js/hc_pairing.mjs:42
Type: mutant
Original:  if (opts.fix)
Mutant:    if (true)
Context:
  40:  const allSurvived = rows.flatMap(r => r.survived ?? [])
  41:  // eslint-disable-next-line ...
  42:  if (opts.fix) {
  43:    const { fixSurvivedMutants } = await import(...)
  44:    await fixSurvivedMutants(allSurvived, cwd)
  45:  }
Existing tests that import this file: [rules/test/coverage/tests/coverage.test.mjs]
```

Для uncovered-files:
```
File: scripts/lib/run-rule-cli.mjs
Type: uncovered-file
Lines%: 8.3%  LOC: 12
Purpose (first JSDoc line): "CLI argv-glue, викликається через spawn..."
Existing tests that import this file: none
```

---

## COVERAGE.md — новий формат

```markdown
## Coverage

| Область | Рядки | Функції | Killable score | Мутантів всього |
| --- | --- | --- | --- | --- |
| JS | 78.8% | 86.1% | **97/98 (99%)** | 143 |
| **Разом** | 78.8% | 86.1% | **97/98 (99%)** | 143 |

> Killable score = killed ÷ (killed + killable-survived).
> 12 мутантів класифіковано як equivalent/glue/integration-only — не враховуються.

## Killable Survived Mutants

| File | Line | Original → Mutant | Reason |
|---|---|---|---|
| rules/abie/lib/k8s-tree.mjs | 48 | `!cache` → `false` | cache bypass undetected |

## Allowed Gaps

| File | Line | Verdict | Reason |
|---|---|---|---|
| rules/abie/fix.mjs | — | glue | 3-line spawn-wrapper; integration test covers this |
| scripts/lib/run-rule-cli.mjs | 12 | glue | CLI argv-glue; covered by subprocess integration |
```

---

## Кешування та cost

**Ключ кешу:** `sha256(filePath + original + mutant)` (для uncovered-file: `sha256("uncovered:" + filePath)`).

**Логіка:**
- Якщо ключ є в `cache.json` → verdict береться з кешу, LLM не викликається.
- Якщо джерельний файл змінився → `original`/`mutant` тексти зміняться → ключ не збігається → перекласифіковуємо автоматично.

**Threshold для uncovered-files:** `lines% < 25%` AND `LOC ≥ 10` (уникаємо шуму від 1-рядкових re-export файлів).

**Cost estimate (Sonnet 4.6):**
- System prompt ≈ 800 tokens, кешується (5-хв TTL Anthropic).
- Per item ≈ 150 tokens in + 80 tokens out.
- 50 нових items × (150 in + 80 out) ≈ **$0.015** за прогін.
- Повторний прогін без нових мутантів → 0 LLM-calls (cache hit).

---

## Testing

| Що тестувати | Підхід |
|---|---|
| `buildSystemPrompt()` | Snapshot — рядок містить усі 5 вердиктів |
| `buildItemMessage(mutant)` | Snapshot — правильний контекст ±5 рядків |
| `buildItemMessage(uncoveredFile)` | Snapshot — містить `Type: uncovered-file` |
| `mergeClassified(cache, new)` | Unit — правильний merge, dedup за id |
| `computeKillableScore(rows, classified)` | Unit — правильний знаменник (killed + killable-survived) |
| `lowConfidence → killable override` | Unit — confidence 0.6 → verdict = killable |
| `classify-coverage.mjs` end-to-end | Vi.mock антропік клієнта — повний pipeline без реального LLM |

Реальний LLM у тестах не викликається. Інтеграційний тест `n-cursor coverage` (subprocess) перевіряє форматування COVERAGE.md.

---

## Обмеження

- LLM **не додає** items у skip-list автоматично — тільки класифікує.
- При `confidence < 0.7` item завжди `killable` (conservative fallback).
- `cache.json` комітиться в репо (разом з `mutation.json`) — повторні CI runs безкоштовні.
- Якщо ANTHROPIC_API_KEY відсутній → classify step пропускається, COVERAGE.md пишеться без Killable score (з попередженням).
