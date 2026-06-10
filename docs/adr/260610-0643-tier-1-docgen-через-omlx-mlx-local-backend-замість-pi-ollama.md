---
session: 8e8df471-0800-4cad-8dd8-282eb35ec91b
captured: 2026-06-10T06:43:41+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e8df471-0800-4cad-8dd8-282eb35ec91b.jsonl
---

Якість справді краща — конкретніші формулювання, менше generic-фраз. Але проблема з «повторюваними гарантіями» все ще є. Тепер обговоримо оркестратор.
[assistant]
[thinking]

[assistant]
## Ідеї оркестратора для досягнення кращої якості через кілька запусків

Три принципові підходи, кожен по-різному балансує між часом і якістю:

### A. Self-critique loop (BEST for quality)
```
generate → score → critique → regenerate → score → …
```
- **Запит 1 (генерація):** один-shot на весь файл.
- **Запит 2 (critique):** окремий system-prompt «Ти критик: що в документі generic, що треба уточнити?», на вхід йде `src + attempt`.
- **Запит 3 (refine):** «Виправ документ за критикою», на вхід — `src + attempt + critique`.
- **Stop:** якщо det-score ≥ threshold або iteration ≥ N (наприклад 3).

Найкраща якість, бо модель «читає власний текст» з окремого позиції. ~150с/файл (3 запити × 50с).

---

### B. Section-by-section parallel + merge
```
[Огляд request] [Поведінка request] [Гарантії request] → merge → validate
```
- Три окремі HTTP-запити паралельно (через `Promise.all` або три `spawnSync`).
- Merge: конкатенація секцій зі стандартними заголовками.
- validate: той самий det-scorer.

Швидше (3 паралельних × 50с ≈ ~55с elapsed) але паралельний spawnSync у Node.js — треба `Worker` або sequential. Без worker ≈ 150с sequential. Спрощена альтернатива до A, але без "cross-section coherence".

---

### C. Tournament sampling (best-of-N)
```
generate×3 → score all → pick max-score
```
- 3 незалежних виклики з різною `temperature` (0.1, 0.4, 0.7).
- Det-scorer вибирає кращий.

Простий у реалізації, але ~150с/файл і **не гарантує виправлення помилок** — якщо модель системно не знає поняття, усі три спроби generic.

---

### D. Knowledge injection → generate → validate (cheapest per file, riskiest design)
```
extract metadata → inject → generate → score
```
- Перед генерацією: запит «Перелічи ключові терміни і їх значення з цього коду» → inject у system-prompt наступного запиту.
- Другий запит тоді генерує документ маючи «підказку».

**Ризик:** перший «knowledge extraction» query теж може бути generic. Але при ~25с для першого запиту + 50с для другого = 75с — дешевший ніж A.

---

## Рекомендований вибір

**A (self-critique loop) з max_iter=2** → 2 × 50с = ~100с/файл, ~5h для 175 файлів. Найкраща якість, мінімальні зміни архітектури — лише добавити `critiqueOmlx` функцію і цикл в `generateDoc`.

Хочеш реалізувати A? Або інший варіант?
[user]
Зробимо A, але давай зробимо тестовий прогін de 5 файлів i після кожного файлу будемо показувати diff

---
END OF TRANSCRIPT
---

## ADR Tier 1 docgen через omlx (MLX-local backend замість pi/ollama)

## Context and Problem Statement
Ollama було видалено з системи. Tier 1 docgen у `npm/skills/docgen/js/docgen-gen.mjs` використовував `pi --model ollama/gemma3:4b` для локальної генерації. Необхідно переключитися на `omlx serve` (MLX-сервер, OpenAI-сумісний) з моделлю `mlx-community--gemma-4-e2b-it-4bit` на `127.0.0.1:8000`.

## Considered Options
* Прямий HTTP fetch у `docgen-gen.mjs` (гілка `backend=omlx`)
* `pi`-адаптер поверх omlx (без змін у docgen)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прямий HTTP у docgen-gen.mjs через `callOmlx` + messages API", because це дозволяє передавати правильний `[system, user]` формат замість конкатенованого тексту, не залежить від `pi`, і omlx підтверджено відповідає на `POST /v1/chat/completions`.

Перемикач — env-змінна `N_CURSOR_DOCGEN_BACKEND=omlx`; URL конфігурується через `N_CURSOR_DOCGEN_OMLX_URL` (дефолт: `http://127.0.0.1:8000/v1/chat/completions`). Тимчасовий batch-скрипт `docgen-batch-omlx.mjs` сканує файли з `internalSymbols.length < 4` і не ескалює в cloud.

### Consequences
* Good, because transcript фіксує очікувану користь: det-score=80–100, якість стилістично краща — без сигнатур, без TypeScript-типів; передача справжніх `messages` покращила конкретність формулювань.
* Bad, because ~49–71с/файл (≈2.7 год на 175 файлів); модель схильна до generic "Гарантії"; det-scorer не вимірює реальну точність змісту — score=100 оманливий.

## More Information
- `npm/skills/docgen/js/docgen-gen.mjs`: додано `callOmlx` (sync `curl` через `spawnSync`), переключено `piOneShot`/`piOrchestrated` на `messages`-формат при `backend=omlx`.
- `npm/skills/docgen/js/docgen-batch-omlx.mjs`: новий тимчасовий batch-скрипт для A/B-прогону.
- `npm/lib/models.mjs`: `resolveModel('min')` каскадно по env-змінних `N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, …
- Модель: `mlx-community--gemma-4-e2b-it-4bit`, `~/.cache/huggingface/hub/models--mlx-community--gemma-4-e2b-it-4bit`.
- Команда пілоту: `N_CURSOR_DOCGEN_BACKEND=omlx node npm/skills/docgen/js/docgen-batch-omlx.mjs --limit 8 --from 1`.

---

## ADR Self-critique оркестратор для omlx docgen (варіант A)

## Context and Problem Statement
Після pilot-прогону 8 файлів через omlx виявлено системні слабкості: generic "Гарантії", втрата конкретних прикладів з коду, розпливчастий Public API. Потрібна стратегія для покращення якості через кілька запусків на один файл без переходу в cloud.

## Considered Options
* A: self-critique loop (generate → critique → refine → score, max_iter=2)
* B: section-by-section parallel + merge
* C: tournament sampling (best-of-N з різними temperature)
* D: knowledge injection → generate → validate

## Decision Outcome
Chosen option: "A — self-critique loop з max_iter=2", because забезпечує найкращу якість через те що модель «читає власний текст» з окремої позиції критика; мінімальні зміни архітектури (лише нова `critiqueOmlx`-функція та цикл у `generateDoc`).

### Consequences
* Good, because transcript фіксує очікувану користь: ~100с/файл (2 × 50с), без cloud-залежностей, модель виправляє власні generic-формулювання через critique-крок.
* Bad, because ~5 год на 175 файлів при max_iter=2; critique-запит теж може бути generic якщо модель системно не знає поняття.

## More Information
- Реалізація: новий тестовий прогін на 5 файлах, після кожного — `git diff` для оцінки.
- Точка розширення: `critiqueOmlx` → `refineOmlx` → det-score → stop або ще одна ітерація.
- Порівняльний прогін: перші 9 файлів уже перезаписано через two-phase pilot (plain-text → messages).
- Додаткової інформації в transcript не зафіксовано щодо фінальної реалізації critique-loop (transcript завершується до кодингу).
