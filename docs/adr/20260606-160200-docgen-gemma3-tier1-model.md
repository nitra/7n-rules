## ADR gemma3:4b як Tier 1 модель (відхилення gemma4:4b)

## Context and Problem Statement
На M2 MacBook з 8 GB RAM доступні дві Ollama-моделі для Tier 1 локальної генерації документації: `gemma3:4b` (3.3 GB) та `gemma4:4b` (5.3 GB). Потрібно обрати одну модель для tier 1 продуктивної генерації.

## Considered Options
* `gemma3:4b` — 3.3 GB, повністю поміщається у GPU VRAM на 8 GB M2 (усі шари у Metal)
* `gemma4:4b` — 5.3 GB, 56%/44% CPU/GPU split на 8 GB M2 через перевищення VRAM

## Decision Outcome
Chosen option: "`gemma3:4b`", because бенчмарк зафіксував середній час 52s/файл для g3 проти 162s/файл для g4 (×3.1 повільніше) при нижчій якості g4 (75% vs 92% для orchestrated g3 на тих самих файлах).

### Consequences
* Good, because g4 overlay-paths: 258s на один файл через CPU swap; g4 k8s-tree: 149s; g3 аналоги: 55–68s — різниця ~3× підтверджена на кожному файлі.
* Good, because gemma3:4b повністю поміщається у GPU VRAM і не конкурує з ОС за пам'ять під час генерації.
* Bad, because gemma4:4b може показати кращі результати на інших типах файлів або при більшій VRAM (16 GB+) — не тестувалося.

## More Information
Вимірювання: `~/docgen-bench3/bench_final.mjs`; результати: `~/docgen-bench3/final/g3_ORCH__*.md`, `~/docgen-bench3/final/g4_ONE__*.md`. Команди Ollama: `ollama run gemma3:4b "" 2>/dev/null` (preload), `ollama stop gemma3:4b` (звільнення VRAM). Конфігурація у `docgen-gen.mjs`: `model = 'gemma3:4b'` (tier 1), `cloudModel = 'claude-sonnet-4-6'` (tier 2).
