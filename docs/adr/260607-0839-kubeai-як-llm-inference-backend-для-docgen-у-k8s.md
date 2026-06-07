---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T08:39:43+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

## ADR kubeai як LLM inference backend для docgen у K8s

## Context and Problem Statement
Автономний docgen-gen.mjs використовує локальний ollama для Tier 1 inference. При розгортанні в Kubernetes локальний ollama недоступний, тому потрібно визначити, чим його замінити без змін у коді.

## Considered Options
* kubeai (OllamaEngine backend) — Kubernetes operator із нативним Ollama-сумісним API
* vllm (raw Deployment) — high-throughput inference із OpenAI API

## Decision Outcome
Chosen option: "kubeai з OllamaEngine backend", because для моделей ~4B параметрів із низьким concurrency (docgen-batch) kubeai достатній і дає Ollama-сумісний API — нульова зміна в коді, лише `OLLAMA_HOST=http://kubeai-svc.kubeai.svc:11434` у env.

### Consequences
* Good, because transcript фіксує очікувану користь: docgen-gen.mjs не потребує змін — той самий `ollamaChat` код працює локально та в K8s.
* Good, because kubeai підтримує scale-to-zero (`minReplicas: 0`), що прийнятно для рідкого batch docgen.
* Bad, because transcript не містить підтверджених негативних наслідків — kubeai молодший проєкт (2024), матурність нижча за vllm.

## More Information
Запропонований CR для gemma3:4b: `url: ollama://gemma3:4b`, `engine: OllamaEngine`, `resourceProfile: nvidia-gpu-l4:1`, `minReplicas: 0`, `maxReplicas: 2`. vllm відхилено через OpenAI-only API (потребував би proxy або зміни в коді) та overkill для 4B моделі.

---

## ADR CPU spot + cloud API замість GPU для batch docgen у K8s

## Context and Problem Statement
Для автономного запуску docgen у K8s потрібно вирішити, чи виділяти GPU node pool (kubeai + gemma3:4b) чи використовувати CPU spot instance із cloud LLM API (Haiku), оскільки GPU node pool дорогий і idle більшість часу.

## Considered Options
* GPU spot (g2-standard-4, L4) + kubeai (gemma3:4b) — локальний inference, ~$0.28/год
* CPU spot (e2-standard-2) + Haiku API — cloud inference, ~$0.014/год instance + API tokens
* CPU spot + Sonnet API — вища якість, ~$3.60 за 50 файлів

## Decision Outcome
Chosen option: "CPU spot + Haiku API", because для типового репо (≤200 файлів, рідкий batch) це дешевше (~$0.24 total) і в 10× швидше (~30с паралельно vs ~58хв послідовно) порівняно з GPU, і значно простіше в ops — ніяких GPU node pools та kubeai operator.

### Consequences
* Good, because transcript фіксує очікувану користь: CPU spot + Haiku ≈ $0.24 на 50 файлів vs GPU $0.28, швидкість у 10× краща завдяки паралельним subagent-запитам.
* Good, because transcript фіксує: GPU доцільний лише при потребі Sonnet-рівня якості (GPU $0.005/файл vs Sonnet $0.072/файл → 14× економія) або при 500+ файлів регулярно.
* Bad, because cloud API залежить від зовнішнього провайдера — privacy constraint або мережеві обмеження можуть блокувати цей шлях.

## More Information
Розрахунок на 50 файлів: GPU ~1 год, CPU+Haiku ~3 хв. Breakeven GPU vs Haiku — близько 500+ файлів за один run. Fallback-ланцюг у checkOllama() → false → pi → Haiku відбувається автоматично без змін у коді при відсутності GPU node.

---

## ADR Ollama pre-warm як обов'язковий крок перед orchestrated benchmark

## Context and Problem Statement
При запуску docgen-gen.mjs на першому файлі після холодного старту функція `checkOllama()` з timeout=3s не встигає отримати відповідь від ollama поки модель завантажується — повертає `false`, fallback іде до pi з моделлю `ollama/gemma3:4b`, pi падає з помилкою → результат `ERR ERR` у benchmark замість валідного виміру.

## Considered Options
* Додати pre-warm крок у benchmark (curl `/api/generate` з `num_predict:1`) перед Phase 1
* Збільшити timeout у `checkOllama()` (3s → 10s+)

## Decision Outcome
Chosen option: "pre-warm крок у benchmark", because це локальне рішення для тестового скрипта, яке не змінює production код docgen-gen.mjs — benchmark bench4.sh додав `curl --max-time 60 .../api/generate` перед Phase 1.

### Consequences
* Good, because transcript фіксує: після pre-warm ollama відповідає коректно і Phase 1 стартує без ERR.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо production поведінки — timeout 3s у `checkOllama()` залишається проблемою у production за холодного старту ollama.

## More Information
Проблема відтворена у bench3.sh: перші два файли `events.mjs` та `yaml.mjs` отримали `ERR ERR`. Виправлено у `/tmp/docgen-bench4.sh` через `curl -s --max-time 60 http://localhost:11434/api/generate -d '{"model":"gemma3:4b","prompt":"warmup","stream":false,"options":{"num_predict":1}}'`. Файл docgen-gen.mjs, рядок 102: `AbortSignal.timeout(3000)`.
