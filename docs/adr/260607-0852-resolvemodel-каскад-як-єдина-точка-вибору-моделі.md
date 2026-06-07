---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T08:52:10+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

Ось ADR-документи з цієї сесії:

---

## ADR resolveModel — каскад як єдина точка вибору моделі

## Context and Problem Statement
Проєкт має 6 env-змінних для моделей (`N_LOCAL_MIN/AVG/MAX_MODEL`, `N_CLOUD_MIN/AVG/MAX_MODEL`). Споживачі (docgen, lint, тощо) дублювали логіку fallback вручну — кожен по-своєму, без гарантії єдиного пріоритету.

## Considered Options
* Єдина helper-функція `resolveModel(tier)` у `npm/lib/models.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`resolveModel(tier)` у `npm/lib/models.mjs`", because каскад має бути задокументований лише в одному місці, а всі споживачі просто викликають `resolveModel('min'|'avg'|'max')`.

Каскади:
- `'min'` → `LOCAL_MIN` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_MIN`
- `'avg'` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_AVG`
- `'max'` → `LOCAL_MAX` → `CLOUD_MAX`

### Consequences
* Good, because transcript фіксує очікувану користь: система прозоро деградує до cloud коли локальні моделі відсутні.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/lib/models.mjs`, функція `resolveModel`. Споживач `npm/skills/docgen/js/docgen-gen.mjs` (рядок 7: `import { resolveModel } from '../../../lib/models.mjs'`).

---

## ADR checkOllama — pi orchestrated як fallback коли ollama недоступна

## Context and Problem Statement
Docgen покладався на локальний ollama HTTP (`localhost:11434`). Якщо ollama не запущена або не відповідає за 3 секунди, весь docgen падає — без можливості використати `pi` CLI як резервний бекенд.

## Considered Options
* `checkOllama()` з 3s timeout → ollama primary, pi fallback
* Pure pi orchestrated (без ollama взагалі) — `/tmp/docgen-gen-new.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`checkOllama()` з 3s timeout → ollama primary, pi fallback", because HEAD вже містить цю реалізацію; pure pi показала вдвічі повільніший throughput при однаковій якості (Round 1: OLD avg 68s, NEW avg 135s, score однаковий 94.0).

### Consequences
* Good, because transcript фіксує очікувану користь: docgen працює як на machine з ollama, так і без неї.
* Bad, because при холодному старті ollama 3s timeout спрацьовує передчасно → перший файл отримує ERR замість TIMEOUT. Зафіксовано в bench3 (events.mjs, yaml.mjs: ERR замість 80/100).

## More Information
`npm/skills/docgen/js/docgen-gen.mjs` рядок 100–108 (`checkOllama`), рядок 329 (stderr output format `[tier${r.tier} ${r.backend}-orchestrated] ${r.ms}ms / score=${r.score}`). Warm-up fix: `curl http://localhost:11434/api/generate -d '{"model":"gemma3:4b","prompt":"hi","num_predict":3}'` перед Phase 1 benchmark.

---

## ADR kubeai як LLM inference backend для автономного K8s docgen

## Context and Problem Statement
При автономному запуску docgen у K8s немає локального ollama на тому самому поді. Потрібен сервіс LLM inference, сумісний з наявним кодом (ollama HTTP API), щоб не змінювати `docgen-gen.mjs`.

## Considered Options
* kubeai (K8s operator, ollama-compatible API, auto-scaling to 0)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "kubeai", because він реалізує ollama HTTP API → zero code change у docgen (`OLLAMA_HOST` вказує на kubeai service), підтримує auto-scaling до 0 GPU-нодів коли idle.

### Consequences
* Good, because transcript фіксує очікувану користь: `OLLAMA_HOST=kubeai-service` — єдина зміна в деплойменті; docgen code незмінний.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
K8s архітектура: `docgen pod (CPU node) → OLLAMA_HOST → kubeai pod (GPU spot node, ollama engine, gemma3:4b)`. Рекомендований instance: T4 spot (`n1-standard-4 + T4`, ~$0.16/год); аналіз показав T4 ≈ $0.033 на 50 файлів (direct HTTP без pi spawn) vs ARM CPU spot ≈ $0.079.

---

## ADR GPU T4 spot vs CPU spot для локального gemma3:4b у K8s

## Context and Problem Statement
Задача docgen запускається автономно в K8s: потрібно вирішити чи дешевше/практичніше використати CPU-only preemptible або GPU preemptible instance для inference gemma3:4b.

## Considered Options
* NVIDIA T4 spot (`n1-standard-4 + T4`, $0.16/год)
* NVIDIA L4 spot (`g2-standard-4`, $0.28/год)
* ARM CPU spot (`t2a-standard-4`, $0.038/год)
* x86 CPU spot (`n2-standard-4`, $0.048/год)

## Decision Outcome
Chosen option: "NVIDIA T4 spot", because за 50 файлів T4 обходиться ~$0.033 (12 хв), тоді як ARM CPU ~$0.079 (125 хв) — вдвічі дорожче і в 10× повільніше; ризик spot preemption під час 2+ годинного CPU batch неприйнятний.

### Consequences
* Good, because transcript фіксує очікувану користь: gemma3:4b Q4_K_M = 2.3 GB → вміщається в T4 (16GB) з запасом; T4 дешевше хмарного Haiku API (Haiku: ~$0.24 на 50 файлів).
* Bad, because GPU spot instance може бути preempted; transcript не містить рішення щодо retry strategy.

## More Information
Розрахунок базується на mem bandwidth: T4 = 300 GB/s → ~40 tok/s для gemma3:4b Q4; ARM Graviton4 = 75 GB/s → ~4 tok/s. Benchmark на локальному M2 показав ~300s/файл при load avg 6–12 (система перевантажена). Direct HTTP до kubeai прибирає pi spawn overhead (~25–30s/файл).
