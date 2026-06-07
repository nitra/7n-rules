---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T07:37:32+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

Причина зрозуміла: ollama runner займає 3.3GB RAM. M2 8GB = RAM + GPU спільна, тому після 2+ годин тестування система вичерпала пам'ять і ollama деградувала. Нові тести в цьому стані дадуть недостовірні дані.

**Статус бенчмарків:**

**Round 1 (06:25–06:47) — валідні дані:**
- Phase 1 (OLD = ollama HTTP, commit `84f203c7`): машина свіжа
- Phase 2 (NEW = pi orchestrated): теж нормальний стан

**Round 2 (07:08–07:20) — невалідний:** `git checkout HEAD` відновив pi-orchestrated версію (коміт `9440f459` вже був у HEAD), тобто обидві фази тестували одне й те саме.

---

Ось повна таблиця Round 1 (єдині достовірні дані):

### Round 1: OLD (ollama HTTP) vs NEW (pi orchestrated) — 10 файлів

| файл | sym | OLD ms | NEW ms | Δ speed | OLD score | NEW score | Δ score |
|------|-----|--------|--------|---------|-----------|-----------|---------|
| discover-check-rules | 0 | 38993 | 144508 | ×3.7 | 100 | 100 | 0 |
| cache.mjs | 0 | 71932 | 138017 | ×1.9 | 100 | 100 | 0 |
| timing-summary | 0 | 36007 | 143960 | ×4.0 | 100 | 100 | 0 |
| check-reporter | 1 | 39553 | 120091 | ×3.0 | 90 | 70 | −20 |
| run-lint-step | 1 | 49874 | 183818 | ×3.7 | 100 | 80 | −20 |
| trufflehog | 2 | 95962 | 105641 | ×1.1 | 80 | **100** | +20 |
| resolve-target-files | 2 | 148411 | 140426 | ×0.9 | 90 | 90 | 0 |
| with-lock | 2 | 119496 | 142388 | ×1.2 | 100 | 100 | 0 |
| http-route | 3 | 47154 | 106295 | ×2.3 | 100 | 100 | 0 |
| run-standard-lint | 2 | 33679 | 129319 | ×3.8 | 80 | **100** | +20 |

**Зведення по sym:**

| sym | OLD avg ms | NEW avg ms | Уповільнення | OLD score | NEW score | Δ |
|-----|-----------|-----------|-------------|-----------|-----------|---|
| 0 (3 файли) | 49k | 142k | **×2.9** | 100 | 100 | 0 |
| 1 (2 файли) | 45k | 152k | **×3.4** | 95 | 75 | **−20** |
| 2 (4 файли) | 99k | 129k | **×1.3** | 87.5 | 97.5 | **+10** |
| 3 (1 файл) | 47k | 106k | **×2.3** | 100 | 100 | 0 |
| **Загалом** | **68k** | **135k** | **×2.0** | **94** | **94** | **0** |

**Висновок:**
- Швидкість: pi orchestrated у **2× повільніший** в середньому
- Якість: **рівна** (94 vs 94), але по-різному розподілена:
- `sym=1` файли: OLD на 20 pts краще (pi вводить cache-hallucination)
- `sym=2` файли: NEW на 10 pts краще (pi уникає internal-name витоків)

Для нових тестів на більшій кількості файлів потрібен свіжий стан машини (після перезапуску і 10-15 хв відпочинку для звільнення пам'яті). Хочеш зачекати і перезапустити бенчмарк пізніше, чи Round 1 + ці висновки достатні для рішення?

---

## ADR: pi orchestrated vs ollama HTTP для Tier 1 docgen

## Context and Problem Statement

В ході сесії проводився порівняльний бенчмарк двох реалізацій Tier 1 LLM-виклику в `npm/skills/docgen/js/docgen-gen.mjs`: пряме HTTP до ollama (`ollamaChat` / `generateOrchestrated`) та provider-нейтральний виклик через CLI `pi` (`piOrchestrated`). Мета — зрозуміти компроміс між швидкістю і якістю, щоб вибрати рішення для продакшн-коду.

## Considered Options

* **ollama HTTP orchestrated** — пряме HTTP до `localhost:11434`, власний streaming-парсинг, withTimeout per-call, модель задається через `localModelId()` (стрипає provider-префікс)
* **pi orchestrated** — spawn `pi` CLI per section: `spawnSync('pi', ['--model', 'provider/model-id', '-p', prompt, '--no-session', '--mode', 'text', '--no-tools'], {timeout: LOCAL_TIMEOUT_MS})`

## Decision Outcome

Chosen option: "pi orchestrated", because він provider-нейтральний (прибирає прямий ollama HTTP та власний streaming-парсинг), уже закомічений у HEAD (`9440f459`), і показав рівну якість з ollama HTTP в Round 1 benchmark.

### Consequences

* Good, because transcript фіксує очікувану користь: однакова середня якість (score 94 vs 94 по 10 файлах), provider-нейтральність через `resolveModel()`, скорочення коду на ~100 рядків.
* Bad, because pi orchestrated у 2× повільніший в середньому (68s → 135s), з піком ×3.4 для sym=1 файлів; `sym=1` файли втратили 20 pts якості (cache-hallucination). Крім того, залежність від `LOCAL_TIMEOUT_MS=5min` per-section і повільна ollama може призводити до ETIMEDOUT.

## More Information

- Бенчмарк файли Round 1: `npm/scripts/lib/discover-check-rules-from-cursor.mjs`, `cache.mjs`, `timing-summary.mjs`, `check-reporter.mjs`, `run-lint-step.mjs`, `trufflehog.mjs`, `resolve-target-files.mjs`, `with-lock.mjs`, `http-route.mjs`, `run-standard-lint.mjs`
- OLD версія: commit `84f203c7` (`feat(npm): додати каскадний fallback для tier-моделей`)
- NEW версія: commit `9440f459` (`refactor(npm): переосмислити dispatcher flow`)
- Scorer: `scoreDoc` у `docgen-gen.mjs`, штрафи: `no-overview`(−25), `short-behavior`(−20), `cache-hallucination`(−20), `internal-name`(−10)
- Env: `N_LOCAL_MIN_MODEL=ollama/gemma3:4b`, M2 8GB unified memory
