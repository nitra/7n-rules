---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T07:47:33+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

## ADR Локальна Ollama для docgen Tier 1 замість хмарних субагентів

## Context and Problem Statement
Tier 1 docgen (`npx @nitra/cursor docgen scan` → 1442 файли, ~26 M токенів, ~$300–570 за прогін) — найбільша і найдорожча стаття витрат. Задача механічна й незалежна по файлах, що дозволяє розглянути локальний інференс без деградації кінцевого Tier 2/3.

## Considered Options
* Локальна Ollama для Tier 1, Claude для Tier 2/3 і хвоста
* Повністю хмарні Claude-субагенти на всіх рівнях

## Decision Outcome
Chosen option: "Локальна Ollama для Tier 1 + Claude для Tier 2/3", because 1042 незалежні файлові задачі ідеально паралелізуються локально без втрати якості синтезу; Tier 1 обнуляє найбільшу хмарну статтю (~26 M токенів → $0), а Tier 2/3 (~2.6 M) лишається в Claude де якість критична.

### Consequences
* Good, because transcript фіксує очікувану користь: Tier 1 коштує $0 при прийнятній якості ~85–92% vs еталон.
* Bad, because на 8 GB M2 прогін строго послідовний (concurrency=1); повний Tier 1 займає ~14.5–30 год залежно від моделі, проти хмарних паралельних батчів.

## More Information
- `npx @nitra/cursor docgen scan` — повертає JSON з 1442 записами; `exists:true` пропускаються за замовчуванням (економить ~10 M токенів / ~400 файлів).
- `DOCGEN_IGNORE_GLOBS` у `docgen-ignore.mjs` — найдешевший спосіб скоротити обсяг до запуску.
- Команди бенчмарку: `ollama ps`, `curl http://localhost:11434/api/generate`, `pi --list-models`.
- Tier 2/3 (~2.6 M токенів) лишається на Claude — синтез агрегатів вимагає вищої якості.

---

## ADR Gemma3:4b і Gemma4:4b (E4B q4) як моделі для локального Tier 1

## Context and Problem Statement
Після рішення про локальний Tier 1 потрібно обрати модель, яка **вміщається у 8 GB unified memory** Apple M2 і забезпечує прийнятну українську документацію з фокусом на поведінку.

## Considered Options
* `gemma4:e4b` (9.6 GB) — оригінальна встановлена модель
* `gemma3:4b` (3.3 GB)
* `qwen2.5-coder:3b` (2.4 GB)
* `qwen2.5:7b`, `qwen2.5-coder:7b`, `llama3.1:8b` (5.1–5.7 GB, частковий CPU-офлоад)
* `llama3.2:3b`, `gemma2:2b`, `phi3.5`, `qwen3:4b`
* `batiai/gemma4-e4b:q4` (5.3 GB, q4-перепак)

## Decision Outcome
Chosen option: "gemma3:4b (швидкість-first) і gemma4:4b — alias на `batiai/gemma4-e4b:q4` — (якість-first)", because об'єктивний бенчмарк 9 моделей із чистим стартом показав: (a) усе ≥5 GB свопиться або офлоадиться на 8 GB, (b) `gemma3:4b` — єдина, що дала 100% GPU + ~20 tok/s + ~85% якості, (c) `gemma4:4b` (q4, 5.3 GB) частково офлоадиться (56%/44%) але дає ~92% якості при ~11 tok/s.

### Consequences
* Good, because transcript фіксує: `gemma3:4b` → ~14.5 год на 1042 файли; `gemma4:4b` → ~30 год; обидві дають доку без дампу сигнатур/stdlib при правильному system-prompt.
* Bad, because `gemma4:4b` офлоадить 56% на CPU → нестабільний тайм на завантаженій машині (thrashing). `gemma3:4b` лишає в моделі тонку залишкову течу stdlib/regex, яку 4B-модель не прибирає надійно.

## More Information
- Бенчмарк-скрипти: `/tmp/docgen-bench/run.py`, `/tmp/docgen-bench2/run.py` (9 моделей).
- Метрики: `ollama ps` → поля `SIZE`, `PROCESSOR`; `/api/generate` → `eval_count / eval_duration`.
- Прибрані після бенчмарку: `qwen3:4b`, `qwen2.5:7b`, `qwen2.5-coder:7b`, `llama3.1:8b`, `llama3.2:3b`, `gemma2:2b`, `phi3.5`.
- Alias: `ollama cp batiai/gemma4-e4b:q4 gemma4:4b`; оригінальний тег `batiai/gemma4-e4b:q4` прибрано.
- Конфіг pi: `~/.pi/agent/models.json`, провайдер `ollama`, `gemma4:4b` першою.

---

## ADR System-prompt як основний важіль якості локального Tier 1

## Context and Problem Statement
Бенчмарк виявив, що прямий виклик `ollama /api/generate` без system-prompt давав ~71% якості (витік regex, сигнатур, stdlib, обрізання), тоді як той самий виклик через pi давав ~87%. Потрібно зрозуміти, чи перевага у транспорті (pi) чи в іншому факторі.

## Considered Options
* pi як транспорт (власний system-prompt pi)
* Прямий `ollama /api/chat` без system-prompt
* Прямий `ollama /api/chat` з явним system-prompt

## Decision Outcome
Chosen option: "Прямий `/api/chat` з явним двоповідомленним форматом (`system` + `user`)", because контрольований експеримент A/B/C довів: різниця між A (~71%) і B/C (~85–87%) пояснюється виключно наявністю system-prompt, а не транспортом. C (прямий + system) наздогнав B (pi) до ±2 п.п., що лежить у межах шуму ручного оцінювання.

### Consequences
* Good, because прямий `/api/chat` + system дає якість рівня pi без node-оверхеду (~4 с/файл), повний контроль `num_ctx`/`num_predict` (усуває обрізання) і просту інтеграцію в CLI.
* Bad, because transcript не містить підтверджених негативних наслідків; залишковий дефект (`gemma3:4b` все одно подекуди вставляє stdlib/regex) — це стеля 4B-моделі, а не вада рецепту.

## More Information
- Конфігурація: `POST http://localhost:11434/api/chat`, `stream:false`, дві ролі: `system` (стиль без stdlib/сигнатур/regex/внутрішніх імен) + `user` (промпт + вміст файлу).
- Пост-обробка: `sed '/^```/d'` — зрізає залишковий fence у виводах.
- `num_predict` контролює максимум виходу; без нього прямий виклик обрізався (варіант A, `overlay-paths`: 62%).
- pi-рецепт per-file: `pi -p --provider ollama --model gemma4:4b --no-tools --no-session --no-context-files --append-system-prompt "$STYLE"`.

---

## ADR Per-file виклик (не RPC-сесія) для оркестрації docgen Tier 1

## Context and Problem Statement
pi підтримує два режими headless-роботи: окремий процес на кожен виклик (`-p`) і персистентна RPC-сесія (`--mode rpc`) через stdin/stdout. Для docgen Tier 1 потрібно вибрати оркестраційний патерн.

## Considered Options
* Персистентна pi RPC-сесія (один процес, батч файлів через stdin)
* Per-file виклик `pi -p` (новий процес на кожен файл)
* Прямий `ollama /api/chat` без pi (per-file HTTP)

## Decision Outcome
Chosen option: "Per-file виклик (або прямий HTTP per-file)", because RPC-сесія для docgen концептуально неправильна: файли незалежні, проте в одній сесії контекст накопичується — файл N тягне за собою файли 1…N-1 та їхні доки → кожен наступний виклик повільніший і зростає ризик крос-забруднення. Замір підтвердив: RPC дав 267/144/296 с проти 31/124/70 с у звичайного per-file pi.

### Consequences
* Good, because per-file ізоляція гарантує відсутність крос-забруднення між файлами; прямий HTTP-варіант прибирає ~4 с node-старту на файл (~+1.1 год на 1042 файлів).
* Bad, because per-file pi платить ~3.8–4 с node-boot на кожен файл; на 1042 файлах — зайва ~1 год відносно прямого HTTP.

## More Information
- RPC-режим pi: `pi --mode rpc`, протокол JSON по stdin/stdout; документація: `$PKG/docs/rpc.md`.
- boot-overhead виміряно: RPC ~1.1 с (boot), per-file pi ~3.8 с; прямий HTTP — <1 с.
- Сповільнення RPC-прогону (267/144/296 с) — memory thrashing на 8 GB: pi-node + ollama + накопичений контекст сесії конкурують за unified memory.
- `ollama ps` під час RPC показав `CONTEXT 4096, 100% GPU` — дефолтний маленький контекст, але thrashing від розміру самого node-процесу pi.
