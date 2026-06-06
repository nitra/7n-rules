---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T07:46:23+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

Точно так — і це **правильна точка входу**. JS (або Bun/mjs) підходить ідеально, бо:

- Stage 0 (екстракція) вже є в `@nitra/cursor` як `docgen scan` — можна перевикористати ту ж AST/regexp-логіку;
- виклики до Ollama — прямий `fetch` до `localhost:11434/api/chat` (нічого зайвого);
- зборка — шаблон рядків.

Схема виходить така:

```
npx @nitra/cursor docgen gen --engine ollama --model gemma4:4b [--root <dir>]
```

Всередині для кожного файлу:

```
File.mjs
↓
[Stage 0 — JS парсер]
exports[]  ←── static analysis (без LLM)
jsdoc
behavioral_markers { skips, throws, readOnly, … }
↓
[Ollama /api/chat session — один per-file keep_alive]
turn 1: system + source → "Огляд" (1–3 речення)
turn 2: + behavioral_markers → "Поведінка" (кроки)
turn 3: + exports[] → "Публічний API" (лише якщо >1 export)
turn 4: + fact_list → "Гарантії поведінки"
↓
[Stage 3 — JS збирач]
strip fences
canonical ## headers
quality-gate (є всі секції? непорожньо?)
→ write docs/path.md
```

Одна сесія (`keep_alive`) на файл — код інгестується **один раз**, решта викликів дешеві. JS контролює **весь** формат і структуру — модель відповідає тільки за прозу.

Готовий **прототипувати `gen` команду в `npm/`** на тих самих 3 тестових файлах і виміряти якість/час? Або спочатку уточниш архітектуру — наприклад, чи Stage 0 має бути окремим `analyze` субкомандом, чи вбудованим у `gen`?

---

## ADR Гібридна стратегія docgen: локальна Ollama для Tier 1, Claude для Tier 2/3

## Context and Problem Statement
Повний прогін `docgen` на 1442 файлах проєкту коштує ~$300–570 хмарних токенів (переважно Tier 1: ~26 M токенів із 28 M загалу). Tier 1 — масова незалежна генерація по одному файлу, де якість не критична так, як у синтезних рівнях. Виникло питання: чи реально перенести Tier 1 на локальну Ollama й де межі цього підходу на конкретному залізі (8 GB M2).

## Considered Options
* Виключно хмарний Claude для всіх рівнів (поточний стан)
* Виключно локальна Ollama для Tier 1 (заміна)
* Гібрид: Ollama для Tier 1-bulk → Claude-хвіст (quality-gate failures) → Claude для Tier 2/3

## Decision Outcome
Chosen option: "Гібрид: Ollama (Tier 1) + Claude (Tier 2/3 і хвіст)", because локальна Ollama скорочує найбільшу статтю витрат (~26 M токенів → $0), а Claude лишається лише для синтезу (~2.6 M) і складного хвосту. На 8 GB M2 модель `gemma4:4b` (q4, 5.3 GB, ~92% якості vs еталон) визнана основною; `gemma3:4b` (3.3 GB, ~85%, 20 tok/s) — резервом для швидких чорнових прогонів.

### Consequences
* Good, because Tier 1 переходить на $0, зберігаючи 85–92% якості еталонної доки.
* Bad, because на 8 GB `gemma4:4b` частково офлоадиться (56% CPU/44% GPU, ~11 tok/s) → Tier 1 займає ~30 год послідовно; `gemma3:4b` вдвічі швидша (20 tok/s, ~14.5 год), але на 7 п.п. гірша за якістю.

## More Information
- Виміряна якість (прямий `/api/chat` + system-prompt): `gemma4:4b` ~92%, `gemma3:4b` ~85%, `qwen2.5-coder:3b` ~77%; усі інші моделі відхилено (мовні дефекти або не влазять у 8 GB).
- Ключовий висновок бенчмарків: якість визначає **наявність system-prompt**, а не вибір між pi CLI та прямим API. Pi з `--append-system-prompt` дає рівноцінний результат, але додає ~4 с node-старту на файл.
- Модель `gemma4:4b` є alias (`ollama cp batiai/gemma4-e4b:q4 gemma4:4b`), зареєстрована першою в `~/.pi/agent/models.json` провайдера `ollama`.
- Конфіг Ollama через pi: `~/.pi/agent/models.json`, `baseUrl: http://localhost:11434/v1`, `api: openai-completions`.
- Бенчмарк-скрипти: `/tmp/docgen-bench*/run.py` (тимчасові), еталонні доки: `/tmp/docgen-bench*/etalon/`.
- Екстраполяція часу (1042 файли, послідовно, без паралелізму): `gemma4:4b` ≈ 30 год, `gemma3:4b` ≈ 14.5 год.

---

## ADR Оркестрований конвеєр docgen для локальних моделей

## Context and Problem Statement
One-shot Tier 1 на `gemma3:4b` дає ~85% якості еталона через системні помилки: витік stdlib/сигнатур/внутрішніх імен, галюцинації у гарантіях, обрізання виводу для великих файлів. Постало питання: чи можна оркестрацією на рівні JS-коду підняти якість `gemma3:4b` до рівня `gemma4:4b` (≥92%), не жертвуючи швидкістю.

## Considered Options
* One-shot one-prompt (поточний підхід)
* Секційний конвеєр: JS-екстракція → секційні LLM-виклики → детермінована зборка

## Decision Outcome
Chosen option: "Секційний конвеєр із JS точкою входу", because JS-парсер детерміновано виводить `exports[]`, JSDoc, behavioral_markers (що пропускається, що не перевіряється, read-only, throws) — це заземлює LLM-виклики і прибирає найбільші класи помилок без додаткових токенів; одна per-file Ollama-сесія (`keep_alive`) амортизує інгест коду між секційними turn-ами.

### Consequences
* Good, because JS контролює структуру й формат (canonical `##`-заголовки, strip-fences, quality-gate), модель відповідає лише за прозу; заземлення фактами усуває галюцинації в `Гарантіях` і витік внутрішніх імен у `Публічному API`.
* Bad, because Stage 0 (статичний екстрактор) прив'язаний до мови — для `.vue`/`.py` потрібні окремі екстрактори або деградація до one-shot.

## More Information
- Архітектура конвеєру (per-file): `Stage 0` JS-парсер → `Stage 1` секційні LLM turn-и в одній Ollama-сесії (`/api/chat`, `keep_alive`) → `Stage 3` JS-зборка (strip fences, перевірка секцій, запис `docs/path.md`).
- Точка входу: `npx @nitra/cursor docgen gen --engine ollama --model gemma4:4b [--root <dir>]`.
- Секційні turn-и: turn 1 → `## Огляд`; turn 2 + behavioral_markers → `## Поведінка`; turn 3 + exports[] → `## Публічний API` (тільки якщо >1 export); turn 4 + fact_list → `## Гарантії поведінки`.
- KV-cache Ollama: незмінний префікс `system + source` перевикористовується між turn-ами → ре-інгест майже безкоштовний.
- Поточний стан: архітектура обговорена, реалізацію `gen`-команди ще не розпочато.
