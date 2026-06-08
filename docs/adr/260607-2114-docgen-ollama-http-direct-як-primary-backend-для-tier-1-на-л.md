---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T21:14:31+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

Готую ADR-документацію за сесією.

## ADR docgen: ollama HTTP direct як primary backend для Tier 1 на локальній gemma3:4b

## Context and Problem Statement
`npm/skills/docgen/js/docgen-gen.mjs` потребував вибору між двома підходами для Tier 1 generation: (1) прямими HTTP-запитами до `localhost:11434/api/chat` (ollama HTTP orchestrated) і (2) серіальними викликами `pi` CLI через `spawnSync` (pi orchestrated). Обидва підходи серіально генерують 4 секції документа (overview / behavior / api / guarantees) і використовують `ollama/gemma3:4b` як локальну модель.

## Considered Options
* Ollama HTTP direct orchestrated — 4 HTTP POST до `/api/chat` через `node:http`, без процесів-нащадків
* Pi CLI orchestrated — 4 `spawnSync('pi', [...])` виклики з `--no-session --mode text --no-tools`
* Hybrid (ollama primary + pi fallback через `checkOllama()`)

## Decision Outcome
Chosen option: "Ollama HTTP direct orchestrated як primary, pi orchestrated як fallback через `checkOllama()`", because бенчмарк Round 1 (10 файлів, `ollama/gemma3:4b`, load avg ≤3) показав OLD (ollama HTTP) у 2× швидший за NEW (pi) при однаковій якості (обидва 94.0/100); pi spawn overhead домінує при sym=0–1, де файли займають 36–72 s (OLD) проти 106–183 s (NEW).

### Consequences
* Good, because transcript фіксує очікувану користь: sym=0–1 файли стають 2.9×–3.4× швидшими; sym=2 файли прискорюються на 1.3×; загальний batch 50 файлів: ~68 s/файл vs ~135 s/файл.
* Good, because у K8s-варіанті (kubeai як `OLLAMA_HOST`) pi spawn overhead повністю усувається — той самий код без змін.
* Bad, because при sym=1 pi показав ліпшу стабільність якості у деяких файлах: OLD score 95, NEW score 75 через `cache-hallucination` між секціями без shared context.
* Bad, because при `OLLAMA_HOST` недоступний (cold start, fallback) `checkOllama()` додає 3 s latency на перший виклик процесу.

## More Information
* Вимірювання: `npm/scripts/dispatcher/lib/events.mjs`, `cache.mjs`, `timing-summary.mjs`, `check-reporter.mjs`, `run-lint-step.mjs`, `trufflehog.mjs`, `resolve-target-files.mjs`, `with-lock.mjs`, `http-route.mjs`, `run-standard-lint.mjs`
* Скрипт Round 1: `/tmp/docgen-bench-results.tsv`; Round 2 (у процесі запуску): `/tmp/docgen-round2.sh`, PID 99521
* OLD версія (84f203c7): `ollamaChat()` через `node:http` + `request('/api/chat')`; збережена у `/tmp/docgen-gen-old.mjs`
* NEW версія (HEAD 9440f459): pure pi, `spawnSync('pi', ['-p', prompt, '--model', model, '--no-session', '--mode', 'text', '--no-tools'])`
* Env var: `N_LOCAL_MIN_MODEL=ollama/gemma3:4b`; `resolveModel('min')` → `LOCAL_MIN` → `CLOUD_MIN` cascade
* det-scorer штрафи: `no-overview` −25, `short-behavior` −20, `cache-hallucination` −20, `internal-name` −10

---

## ADR K8s inference для docgen: kubeai + T4 GPU spot над CPU-only spot

## Context and Problem Statement
Для автономного запуску docgen у Kubernetes (batch над кодовою базою) потрібно замінити локальний ollama-демон інфраструктурним рішенням. Без GPU inference `gemma3:4b` на CPU дає ~2.5–4 tok/s, що робить batch нерентабельним порівняно з cloud API.

## Considered Options
* kubeai + NVIDIA T4 spot (n1-standard-4 + T4 GPU, ~40 tok/s)
* kubeai + NVIDIA L4 spot (g2-standard-4, ~70 tok/s)
* CPU-only ARM spot (t2a-standard-4 Graviton4, ~4 tok/s)
* CPU-only x86 spot (n2-standard-4, ~2.5 tok/s)
* Cloud API (Haiku / Sonnet) — обговорювався, але відхилений у цьому аналізі

## Decision Outcome
Chosen option: "kubeai + T4 GPU spot", because transcript фіксує T4 як «золоту середину»: $0.033 / 50 файлів vs $0.079 CPU ARM та $0.035 L4; gemma3:4b Q4_K_M = 2.3 GB < T4 16 GB з великим запасом; kubeai надає ollama-compatible API тому `OLLAMA_HOST` достатньо без змін у docgen-коді.

### Consequences
* Good, because transcript фіксує очікувану користь: T4 spot = найдешевший варіант ($0.033/50 файлів) при прийнятному часі (~13 хв); CPU ARM дорожче і повільніше ($0.079, ~130 хв).
* Good, because kubeai autoscale to 0 GPU-нодів в idle → плата лише за реальний inference; архітектура: `docgen pod (CPU node)` → `OLLAMA_HOST=kubeai-service` → `kubeai pod (T4 spot)`.
* Bad, because pi spawn overhead (~25–30 s/файл on top of inference) залишається поки docgen не переключиться на direct HTTP; реальний час з pi = ~35–40 хв замість теоретичних 12.5 хв.
* Bad, because spot preemption ризик на довгих batch (>3 год) — але T4 при 13 хв/50 файлів не є вузьким місцем.

## More Information
* kubeai: K8s operator, ollama-compatible API, zero code change при встановленні `OLLAMA_HOST`
* Ціни GCP spot (оцінка з transcript): T4 $0.16/год, L4 $0.28/год, t2a-standard-4 $0.038/год, n2-standard-4 $0.048/год
* gemma3:4b Q4_K_M активні ваги ≈ 2.3 GB; throughput пропорційний mem bandwidth: T4/L4 300 GB/s → ~40–70 tok/s; ARM 75 GB/s → ~4 tok/s
* Порівняння з cloud API (з попереднього аналізу сесії): Haiku API = $0.24/50 файлів, ~3 хв; T4+gemma3 = ~$0.10/50 файлів, ~13 хв
* Оптимізація: прибрати pi spawn і додати direct ollama HTTP path при `OLLAMA_HOST` задано → усуне 25–30 s/файл overhead
