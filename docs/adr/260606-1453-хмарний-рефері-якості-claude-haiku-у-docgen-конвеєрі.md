---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T14:53:02+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

Закомічено. Ось що реалізовано і як тестувати:

---

### Що зроблено

`cloudScoreDoc(md, facts, src)` у `docgen-gen.mjs`:
- Надсилає до Claude Haiku: факти + код (≤4000 chars, кешується) + згенерований doc
- Повертає JSON-скор: `{ огляд:1-3, поведінка:1-3, гарантії:1-3, стиль:1-3, issues:[] }`
- Конвертує у 0-100% та порівнює з `QUALITY_THRESHOLD=70`
- Якщо нижче — перегенерує через `claudeOneShot` (Tier 2)

**Дві гілки:**
- `scoreCloud=false` (default) → детермінований gate (Stage 2.5a)
- `scoreCloud=true` → хмарний рефері Haiku (Stage 2.5b) → якщо < 70% → Tier 2

---

### Як запустити тест

Потрібно встановити `ANTHROPIC_API_KEY` у shell:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."

# Тест на одному файлі (score + cloud judge):
bun npm/skills/docgen/js/docgen-gen.mjs \
npm/rules/ga/js/workflows.mjs --score-cloud 2>&1

# Або через bench-скрипт:
bun /Users/vitaliytv/docgen-bench3/score_cloud.mjs
```

API ключ у [console.anthropic.com](https://console.anthropic.com/) → API Keys → Create key. Вартість: ~$0.0001/файл (Haiku + caching).

---
<br>

This is the end of the transcript.

---

## ADR Хмарний рефері якості (Claude Haiku) у docgen-конвеєрі

## Context and Problem Statement

Локальні моделі (gemma3:4b, gemma4:4b) демонстрували систематичне завищення скору при самооцінці (+25 п.п. для gemma3:4b) і не виявляли семантичних дефектів — таких як галюциновані Rego-інваріанти у `Гарантіях` або розмитий `Огляд`. Детермінований скоринг (Підхід A) ловив лише структурні проблеми і також завищував результат (+35 п.п. після виправлення false positives). Потрібен незалежний рефері, який розуміє семантику і не оцінює власний вивід.

## Considered Options

* Підхід A — детермінований скоринг (regex проти `facts` із Stage 0, 0 токенів)
* Підхід B — локальний LLM-суддя (gemma3:4b оцінює власний вивід)
* Підхід C — Claude Haiku як хмарний рефері (незалежна зовнішня оцінка)

## Decision Outcome

Chosen option: "Підхід C — Claude Haiku як хмарний рефері", because Підходи A та B показали систематичний bias (+35 п.п. і +25 п.п. відповідно) і не виявляли семантичних дефектів (галюциновані Rego-інваріанти, розмитий `Огляд`). Claude Haiku як зовнішня модель без self-assessment bias здатна зіставити doc із кодом і фактами по суті.

### Consequences

* Good, because transcript фіксує очікувану користь: Claude Haiku розуміє Ukrainian semantic content і може зіставляти `Гарантії` з реальними фактами із `extractFacts` (маркери `caches`, `network`, `internalSymbols`), що недосяжно детерміністично.
* Good, because `cache_control: { type: 'ephemeral' }` на ФАКТИ і КОД-блоки знижує вартість повторних викликів; оціночна ціна ~$0.0001/файл.
* Bad, because потребує `ANTHROPIC_API_KEY` у runtime-середовищі; без ключа `scoreCloud=false` (default) — рефері мовчки пропускається, Tier 2 не спрацьовує.
* Bad, because transcript не містить підтверджених негативних наслідків щодо latency Haiku у production-потоці — вимірювання ще не проводились.

## More Information

Реалізовано у `npm/skills/docgen/js/docgen-gen.mjs`:
- Функція `cloudScoreDoc(md, facts, src, model='claude-haiku-4-5-20251001')` — повертає `{ score: 0-100, scores: {огляд,поведінка,гарантії,стиль}, issues: string[], tok: number }`
- Промпт-рубрика `SCORE_RUBRIC` — 4 критерії 1-3, відповідь ТІЛЬКИ JSON
- `generateDoc` з `scoreCloud=true` запускає Stage 2.5b після Stage 2.5a (детермінований), при `cs.score < QUALITY_THRESHOLD(70)` → `claudeOneShot` (Tier 2)
- CLI-флаг `--score-cloud`; результат у stderr: `cloud-scores={...}`
- Тест-скрипт: `~/docgen-bench3/score_cloud.mjs`
- Commit: `81613077`
