# LLM Coverage Classifier — Design Spec

**Дата:** 2026-05-30
**Статус:** Approved
**Область:** `@nitra/cursor` (npm workspace)

---

## Контекст

`n-cursor coverage` запускає Stryker + vitest і публікує `COVERAGE.md` з raw mutation score.
Поточний raw score штовхає до «покрити 100%», хоча значна частина survived мутантів — еквівалентні, spawn-обгортки чи CLI glue, де unit-тест не додає сигналу.

Мета: ввести LLM-класифікатор, який відрізняє **Killable** мутанти/файли від **Allowed gaps**, і рахувати `Killable score` замість raw.

---

## Scope

**In scope:**

- Survived мутанти (з `mutation.json`).
- Uncovered-файли з `lines% < 50%` (з coverage-summary).
- Оновлення `COVERAGE.md` з `Killable Score` та секцією «Allowed gaps».
- File-hash-keyed cache (`coverage-classify.cache.json`) щоб не re-classify незмінений код.

**Out of scope:**

- Автоматичне пропускання мутантів у Stryker config.
- CI-гейт на Killable score (окрема feature).
- Python workspace (тільки JS).

---

## Архітектура

```
npm/scripts/coverage-classify/
  ├─ index.mjs          # entrypoint: classify(survived, uncoveredFiles, cwd) → verdicts[]
  ├─ prompt.mjs         # buildClassifyPrompt(category, item, context) → string  [pure]
  ├─ cache.mjs          # readCache / writeCache  (file-hash-keyed JSON)
  ├─ verdict-schema.mjs # Zod-схема VerdictSchema
  └─ apply.mjs          # filterKillable(rows, verdicts) → {killable, allowedGaps}

npm/rules/test/coverage/coverage.mjs
  └─ після Stryker → виклик classify() → передача в renderMarkdown()
```

### Data flow

```
n-cursor coverage
  │
  ├─ vitest --coverage    → coverage-summary.json
  ├─ stryker run          → mutation.json
  │
  ├─ COVERAGE classify()
  │   ├─ для кожного survived mutant / uncovered file:
  │   │   ├─ cache lookup (key = git-blob-hash + item-id) → hit: reuse
  │   │   └─ cache miss  → Claude API call → zod validate → write cache
  │   └─ aggregate: Killable = всі, крім {confidence ≥ 0.7 ∧ verdict ∈ [equivalent, defensive, glue, wrapper]}
  │
  └─ renderMarkdown(rows, verdicts) → COVERAGE.md
```

---

## Verdict Schema (Zod)

```js
const VerdictSchema = z.object({
  verdict: z.enum([
    'worth-testing', // є реальна логіка — пиши тест
    'equivalent', // мутант поведінково еквівалентний
    'defensive', // гілка для impossible state
    'glue', // CLI entry / runStandardRule wrapper
    'wrapper' // spawn / fetch wrapper — integration охопить
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(20).max(500),
  suggestedTest: z.string().max(300).optional(), // тільки для worth-testing
  category: z.enum(['mutant', 'uncovered-file'])
})
```

**Skip rule:** `verdict ∈ [equivalent, defensive, glue, wrapper] AND confidence ≥ 0.7`.
Усе інше — Killable (включно з `confidence < 0.7`).

---

## Claude API (Sonnet 4.6 + prompt caching)

```js
const r = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: userPromptText }]
})
```

### System prompt (cached, спільний для всього прогону)

Містить:

- Опис кожної категорії з прикладами (рядковий текст).
- Strict JSON output schema (mirror VerdictSchema).
- Правила:
  - `equivalent`: ОБОВ'ЯЗКОВО вказати конкретну поведінкову причину.
  - `defensive`: обґрунтувати чому стан impossible.
  - `glue/wrapper`: назвати, який integration test це покриває.
  - Заборона `confidence > 0.9` без reference до конкретного рядка коду.

### User prompt (per-item)

**mutant:**

```
File: rules/abie/lib/hc-yaml.mjs  Line: 45  Col: 5
Type: BooleanLiteralMutation
Original: if (line.trim() === '')
Mutant:   if (false)

Context (lines 40-55):
<code>

Existing tests: rules/abie/lib/tests/hc-yaml.test.mjs (10 tests)
Last modified: 2 hours ago
```

**uncovered-file:**

```
File: rules/docker/lib/docker-hadolint.mjs  Lines%: 12%  Fn%: 12%
<source або signature + JSDoc (якщо > 200 LOC)>

Existing tests: none
Last modified: 3 weeks ago
```

---

## Cache

### Файл: `npm/reports/coverage-classify.cache.json`

```json
{
  "version": 1,
  "model": "claude-sonnet-4-6",
  "entries": {
    "<git-blob-hash>:<mutant-line>:<col>:<replacement>": {
      "verdict": "equivalent",
      "confidence": 0.87,
      "reason": "...",
      "category": "mutant",
      "classifiedAt": "2026-05-30T12:00:00Z"
    }
  }
}
```

- `.gitignore` entry: `npm/reports/coverage-classify.cache.json`.
- Version mismatch (schema зміна) → full rebuild.
- Git-blob-hash як ключ: якщо файл змінився → hash змінюється → re-classify автоматично.

---

## Error Handling

| Ситуація                               | Поведінка                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` не задано          | Skip classify, COVERAGE.md без Killable секцій. Log: `⚠ classify: ANTHROPIC_API_KEY не встановлено — skip` |
| API error (5xx / rate limit)           | Retry ×2 (backoff 1s, 4s). Після 3 невдач → verdict `{worth-testing, confidence:0, reason: 'API error'}`   |
| Invalid JSON у відповіді               | `extractJson` (grab first `{…}`) + zod parse. При fail → treat as API error                                |
| `confidence < 0.7`                     | Залишається у Killable, позначається `⚠ low-confidence`                                                    |
| Файл видалено між coverage та classify | Skip з логом                                                                                               |

---

## COVERAGE.md output

```md
## Score

| Область | Рядки | Функції | Вбито мутацій | Raw Score | Killable Score | Allowed gaps |
| ------- | ----- | ------- | ------------- | --------- | -------------- | ------------ |
| JS      | 78.8% | 86.1%   | 132/141       | 93.62%    | **97.1%**      | 8            |

## Allowed gaps (LLM-classified, confidence ≥ 0.7)

| File              | Line | Verdict    | Conf | Reason                                                                           |
| ----------------- | ---- | ---------- | ---- | -------------------------------------------------------------------------------- |
| `rules/*/fix.mjs` | —    | glue       | 0.92 | runStandardRule wrapper; integration covered by integration-repo-checks.test.mjs |
| `coverage.mjs`    | 188  | equivalent | 0.87 | Mutation→false unreachable: єдиний caller `runCoverageSteps({fix:false})`        |
```

---

## Integration у `n-cursor coverage`

У `coverage.mjs`:

```js
// після runStryker(opts) → result
if (process.env.ANTHROPIC_API_KEY) {
  const { classify } = await import('../../../scripts/coverage-classify/index.mjs')
  result.verdicts = await classify(result.survivedMutants, result.uncoveredFiles, cwd)
}
result.killableScore = computeKillableScore(result, result.verdicts)
```

Classify виконується **автоматично** в кожному `n-cursor coverage` прогоні, якщо є API key.

---

## Testing strategy (нові тести classify-модуля)

| Файл                                              | Що покриває                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `coverage-classify/tests/prompt.test.mjs`         | `buildClassifyPrompt`: обрізання до ±10 рядків, injection існуючих тестів, формат uncovered-file |
| `coverage-classify/tests/cache.test.mjs`          | read/write/hit/miss, version mismatch → rebuild, git-hash change → re-classify                   |
| `coverage-classify/tests/verdict-schema.test.mjs` | zod parse: happy path, reason < 20 chars → error, confidence out of range                        |
| `coverage-classify/tests/apply.test.mjs`          | `filterKillable`: `confidence < 0.7` → not skipped; `equivalent 0.85` → allowed-gap              |

API call — тільки integration test (за `ANTHROPIC_API_KEY`), не mocked unit.
