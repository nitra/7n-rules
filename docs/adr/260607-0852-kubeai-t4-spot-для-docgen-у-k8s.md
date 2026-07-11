---
type: ADR
title: kubeai і T4 spot для автономного docgen у K8s
description: Для автономного K8s docgen обрано Ollama-сумісний kubeai backend на NVIDIA T4 spot, щоб зберегти код docgen без змін і здешевити локальний inference.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

При автономному запуску `docgen-gen.mjs` у Kubernetes локального Ollama на тому самому поді немає. Потрібно надати LLM inference backend, сумісний з наявним Ollama HTTP API, і вибрати практичний compute-профіль для `gemma3:4b`.

## Considered Options

- kubeai як Kubernetes operator з Ollama-сумісним API та auto-scaling до 0.
- NVIDIA T4 spot (`n1-standard-4 + T4`, `$0.16/год`).
- NVIDIA L4 spot (`g2-standard-4`, `$0.28/год`).
- ARM CPU spot (`t2a-standard-4`, `$0.038/год`).
- x86 CPU spot (`n2-standard-4`, `$0.048/год`).

## Decision Outcome

Chosen option: "kubeai на NVIDIA T4 spot", because kubeai реалізує Ollama HTTP API і дозволяє залишити `docgen-gen.mjs` без змін через `OLLAMA_HOST`, а T4 для `gemma3:4b` за розрахунком transcript коштує приблизно `$0.033` на 50 файлів і працює суттєво швидше за CPU-only варіанти.

### Consequences

- Good, because `docgen pod` може звертатися до kubeai service через `OLLAMA_HOST`, не змінюючи код docgen.
- Good, because `gemma3:4b Q4_K_M` розміром близько 2.3 GB вміщується в T4 16GB із запасом.
- Good, because direct HTTP до kubeai прибирає pi spawn overhead, який transcript оцінює приблизно у 25–30s на файл.
- Bad, because GPU spot instance може бути preempted; transcript не містить підтвердженого рішення щодо retry strategy.

## More Information

- K8s архітектура з transcript: `docgen pod (CPU node) → OLLAMA_HOST → kubeai pod (GPU spot node, OllamaEngine, gemma3:4b)`.
- Приклад deployment-зміни: `OLLAMA_HOST=http://kubeai-svc.kubeai.svc:11434`.
- Розрахунок transcript: T4 ≈ `$0.033` на 50 файлів за 12 хвилин; ARM CPU ≈ `$0.079` на 50 файлів за 125 хвилин.
- Меморі bandwidth з transcript: T4 ≈ 300 GB/s і близько 40 tok/s для `gemma3:4b Q4`; ARM Graviton4 ≈ 75 GB/s і близько 4 tok/s.
- У цьому ж transcript згадано `resolveModel(tier)` у `npm/lib/models.mjs` як єдину точку вибору моделі, але це рішення вже покривається наявним clean ADR про cascade fallback моделей.

## Update 2026-06-07

- Додатково розглядалися `CPU spot + Haiku API` та `CPU spot + Sonnet API` як альтернатива GPU-backed inference для batch docgen.
- Для типового рідкого batch на ≤200 файлів transcript фіксував аргумент на користь CPU spot + Haiku: приблизно `$0.24` на 50 файлів і простіший ops без GPU node pool та kubeai operator.
- Пізніший розрахунок у цьому ж transcript уточнив, що для локального `gemma3:4b` у K8s NVIDIA T4 spot дешевший і швидший за CPU-only inference: T4 ≈ `$0.033` на 50 файлів проти ARM CPU ≈ `$0.079`.
- Для benchmark локального Ollama зафіксовано окремий operational факт: перед вимірюванням потрібен pre-warm через `curl /api/generate` з `num_predict:1`, бо `checkOllama()` з `AbortSignal.timeout(3000)` може передчасно повернути `false` на холодному старті моделі.
- Приклад warm-up команди з transcript: `curl -s --max-time 60 http://localhost:11434/api/generate -d '{"model":"gemma3:4b","prompt":"warmup","stream":false,"options":{"num_predict":1}}'`.
