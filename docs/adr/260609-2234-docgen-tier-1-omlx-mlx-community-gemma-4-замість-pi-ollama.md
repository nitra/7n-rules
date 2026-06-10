---
session: 8e8df471-0800-4cad-8dd8-282eb35ec91b
captured: 2026-06-09T22:34:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e8df471-0800-4cad-8dd8-282eb35ec91b.jsonl
---

Ось загальна оцінка пілоту:

**Pilot 9 files, backend=omlx:**
- Avg score = ~95/100, tier=1 для всіх, ~48–71s/файл
- Нова версія: коротша, чиста поведінкова структура, без TypeScript-сигнатур
- Стара версія (pi+gemma3): розкішно довга (до 209 рядків), з внутрішніми деталями

Якщо якість тебе влаштовує — я запущу повний прогон (175 файлів, ~2.5 год) або можеш самостійно: `N_CURSOR_DOCGEN_BACKEND=omlx node npm/skills/docgen/js/docgen-batch-omlx.mjs`. Що думаєш про результати першого файлу?

---

## ADR Docgen Tier 1: omlx / MLX-Community Gemma-4 замість pi + ollama

## Context and Problem Statement
Локальний Ollama-сервер із `gemma3:4b` видалено. Для Tier 1 docgen (файли з `internalSymbols.length < 4`) потрібна нова локальна LLM-відповідь без хмарних викликів. На машині встановлено `omlx` — OpenAI-сумісний MLX-сервер (Apple Silicon) із завантаженою моделлю `mlx-community/gemma-4-e2b-it-4bit`.

## Considered Options
* Прямий HTTP-виклик до `omlx serve` (`http://127.0.0.1:8000/v1/chat/completions`) з нової гілки в `docgen-gen.mjs`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прямий HTTP-виклик до omlx (`http://127.0.0.1:8000/v1/chat/completions`)", because pi-виклик зав'язаний на Ollama, якого більше нема; omlx надає OpenAI-сумісний ендпоінт і `mlx-community/gemma-4-e2b-it-4bit` вже завантажена на диск.

### Consequences
* Good, because transcript фіксує очікувану користь: пілот 9 файлів, avg score=95/100, tier=1 для всіх без жодних хмарних ескалацій; якість коротша й точніше відповідає STYLE-правилу (без сигнатур, поведінковий стиль).
* Bad, because ~48–71s/файл (~55s avg) при 175 файлах = ~2.5 год для повного прогону; `docgen-batch-omlx.mjs` — тимчасовий скрипт, не інтегрований у стандартний docgen CLI.

## More Information
- Змінені файли: `npm/skills/docgen/js/docgen-gen.mjs` (нова функція `callOmlx` + перемикач `N_CURSOR_DOCGEN_BACKEND=omlx`), `npm/skills/docgen/js/docgen-batch-omlx.mjs` (новий тимчасовий batch-скрипт).
- Ендпоінт: `http://127.0.0.1:8000/v1/chat/completions`, модель `mlx-community--gemma-4-e2b-it-4bit`, `max_tokens=2000`, `temperature=0.2`.
- Фільтр: лише файли з `sym < 4` (`DEFAULT_SYM_THRESHOLD = 4`); файли з `sym ≥ 4` пропускаються (без cloud-ескалації в цьому режимі).
- Детермінований scorer (`docgen-score.mjs`) перевіряє вихід: `score < 60` → помилка (без ескалації в cloud у цьому batch).
- Модель `mlx-community/gemma-4-e2b-it-4bit` відповідає через `reasoning_content` + `content`; скрипт читає `choices[0].message.content`.
- Запуск: `N_CURSOR_DOCGEN_BACKEND=omlx node npm/skills/docgen/js/docgen-batch-omlx.mjs [--limit N] [--from N]`.
