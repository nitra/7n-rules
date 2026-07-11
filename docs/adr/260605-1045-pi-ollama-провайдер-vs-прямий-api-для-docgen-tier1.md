---
type: ADR
title: ""
---

## ADR pi (ollama-провайдер) vs прямий ollama API для docgen Tier 1

## Context and Problem Statement
Після вибору `gemma3:4b` як локальної моделі для Tier 1 скіла `docgen` виникло питання транспорту: викликати модель напряму через `http://localhost:11434/api/chat` чи через `pi --provider ollama --model gemma3:4b` (pi-coding-agent, підключений до Ollama через OpenAI-сумісний ендпойнт). Різниця не в самій моделі, а в агентному середовищі: прямий виклик отримує лише текст файлу у промпті, pi запускає модель з інструментами (`read`, `grep`, `bash`).

## Considered Options
* Прямий ollama API: `POST http://localhost:11434/api/chat`, `stream:false`, промпт = source file text
* pi (ollama-провайдер): `pi -p --provider ollama --model gemma3:4b @<sourcePath>`, модель має доступ до інструментів

## Decision Outcome
Chosen option: "pi (ollama-провайдер)", because на однакових 3 файлах (firebase_hosting, overlay-paths, k8s-tree) і однаковому Tier-1 промпті pi дав якість **98%** проти **86%** у прямого API — на 12 п.п. вище. Різниця пояснюється тим, що pi виконує модель в агентному циклі: вона може використати `grep`/`read` для пошуку споживачів файлу в суміжних файлах (секція `## Де використовується`), яку прямий API не може заповнити (бачить лише переданий файл). Прямий API також галюцинував на `k8s-tree.mjs` (стверджував «stale-стану є ризик між прогонами», тоді як кеш — module-level singleton).

### Consequences
* Good, because pi із tools знаходить крос-файловий контекст (хто викликає модуль), що дає коректну секцію `## Де використовується` і виключає клас галюцинацій про поведінку модуля.
* Bad, because pi повільніший: середній wall-час/файл ~68 с проти ~51 с (прямий API), тобто Tier 1 займе ~20 год замість ~15 год (послідовно, concurrency=1 на 8 GB M2).

## More Information
Конфігурація pi: `~/.pi/agent/models.json` — провайдер `"ollama"` із `baseUrl: "http://localhost:11434/v1"`, `api: "openai"`, `apiKey: "ollama"`, `compat: {supportsDeveloperRole: false, noSystemRole: true}`. Модель видно через `pi --list-models gemma` як `ollama / gemma3:4b / 128K ctx`.

Виміряні дані: бенчмарк `/tmp/docgen-bench3/run.py`; результати `/tmp/docgen-bench3/results.jsonl` (3 моделі × 2 транспорти × 3 файли); еталонні доки — `/tmp/docgen-bench3/etalon/`.

Архітектурний наслідок: щоб pi мав доступ до інструментів, йому потрібне CWD = корінь репозиторію; CLI `docgen gen --engine pi-ollama` має запускатися з кореня.

## Update 2026-06-04

Додаткові архітектурні деталі гібридного підходу (transcript d943f92b):

**CLI-інтерфейс**: `npx @nitra/cursor docgen gen --engine ollama|claude [--root <dir>] [--concurrency 1] [--num-ctx 8192] [--max-bytes 24000] [--overwrite]`. Ollama-шлях використовує sequential `for-of` (concurrency=1, не `Promise.all`).

**Quality-gate** для Ollama-виводу: непорожній вихід; починається з `# <stem>`; містить хоча б одну секцію `## `. При невдачі — 1 retry, потім пропуск файлу.

**Єдине джерело правди промпту**: `npm/skills/docgen/js/docgen-prompt.mjs`, функція `buildTier1Prompt({ sourcePath, docPath, sourceContent })`. При зміні стилю документації — оновлювати лише цей модуль; `SKILL.md` та `.cursor/skills/n-docgen/SKILL.md` синхронізуються.

**Замір продуктивності на M2/8 GB, `gemma4:e4b` (9.6 GB)**: warm load 74 с, генерація 0.4 tok/s, інгест 5.4 tok/s — модель перевищує RAM і свопується. При 1042 файлах → ~37 діб. Рекомендований поріг: модель ≤ ~50% RAM. Рекомендована модель для 8 GB: `qwen2.5-coder:7b` (q4 ~4.7 GB); повний потенціал від 32 GB RAM.

Реалізацію в код не внесено — зафіксовано архітектурне рішення та результати feasibility-оцінки.

## Update 2026-06-06

Відхилено pi RPC-режим (`pi --mode rpc`) для docgen Tier 1. Benchmark (`~/docgen-bench3/pi_recipe.py`): RPC-сесія накопичує контекст між незалежними файлами — 267/144/296 с/файл проти ~30–74 с у per-file виклику. При накопиченні KV-cache (`ollama ps` показав `CONTEXT 4096, 100% GPU`) memory pressure на 8 GB збільшує latency і призводить до крос-забруднення документів. Рішення: per-file виклик (`pi -p --no-session ...`) з чистим контекстом на кожен файл — єдиний прийнятний режим для docgen; файли незалежні й потребують ізольованого контексту.

## Update 2026-06-06

**Per-file виклик vs персистентна RPC-сесія pi.** RPC-сесія (`--mode rpc`) неправильна для docgen Tier 1: незалежні файли в одній сесії накопичують контекст — файл N тягне файли 1…N-1 та їхні доки → кожен наступний виклик повільніший. Заміряно на 3 файлах: RPC — 267/144/296 с; per-file pi — 31/124/70 с. Причина сповільнення: thrashing на 8 GB (pi-node + ollama + накопичений контекст конкурують за unified memory). Boot overhead: per-file pi ~3.8–5 с/виклик, прямий HTTP <1 с (~1.1 год економії на 1042 файлах). Обраний патерн: per-file виклик або прямий HTTP per-file. Рецепт per-file pi: `pi -p --provider ollama --model gemma4:4b --no-tools --no-session --no-context-files --append-system-prompt "$STYLE"`.

## Update 2026-06-06

Бенч-підтвердження (3 режими × 2 моделі): pi з вбудованим system-prompt — ~87%; прямий ollama /api/chat з явним system-prompt — ~85%; без system-prompt — ~70%. Різниця між pi і прямим+system (~2 п.п.) — у межах шуму; системна різниця (~15 п.п.) дає саме наявність system-prompt, а не транспорт.

**Вимірюваний overhead pi:** ~3.8–6.4 с cold node-start на кожен виклик. При 1042 файлах з паралельною оркестрацією — ~1.1 год прихованого накладного часу. Throughput інференсу (~20 tok/s) однаковий в обох варіантах.

**pi RPC-режим (`--mode rpc`)** для амортизації старту непридатний: персистентна сесія між незалежними файлами накопичує контекст, сповільнюючи подальші файли та несучи ризик крос-забруднення.

**Оркестрований JS-конвеєр (Stage 0–3):** детермінована екстракція фактів → секційні LLM-виклики → пост-лінт → зборка підняла якість gemma3:4b з ~80% до ~86% (+6 п.п.). v1 shared-context: регрес ×3.8 по часу (overlay 310 с vs 57 с one-shot). v2 секційно-мінімальний контекст прибрав регрес (overlay 77 с, k8s 55 с).

**Модельний trade-off (8 GB RAM):** gemma3:4b (~85%, ~20 tok/s, 100% GPU, 3.3 GB) — швидкі/чорнові прогони; gemma4:4b / batiai/gemma4-e4b:q4 (~92%, ~11 tok/s, 56% CPU/44% GPU, 5.3 GB) — якість-first генерація для документації що читається людьми. Аліас: `ollama cp batiai/gemma4-e4b:q4 gemma4:4b`. Blob `d682bf87e3a3` спільний — диск не подвоюється. Бенч-скрипти: `~/docgen-bench3/duel.py`, `~/docgen-bench3/confirm.py`.

## Update 2026-06-07

- Для `docgen` Tier 1 перевірено заміну прямого ollama HTTP + orchestrated mode на `piOneShot(resolveModel('min'))`.
- Рішення: залишити ollama HTTP + orchestrated mode для Tier 1, бо benchmark показав регресію якості з score `100` до `65–75` при переході на one-shot через `pi`.
- Benchmark для Tier 1: old ollama HTTP + orchestrated — `44–47s`, score `100`; `pi` + `gemma3:4b` one-shot — `35–51s`, score `65–75`, issues `no-overview`, `internal-name`; `pi` + cloud default one-shot — близько `12s`, score `75`, issue `no-overview`.
- Причина регресії: втрата orchestrated режиму, де секції документації генеруються окремими промптами з `numPredict`-обмеженнями.

## Update 2026-06-07

- Додатково виміряно `pi orchestrated` для docgen Tier 1.
- Порівняння benchmark: old ollama HTTP orchestrated — `discover-check-rules` `44s / score=100`, `trufflehog` `47s / score=100`; new `pi orchestrated` (`gemma3:4b`) — `71s / score=100`, `61s / score=90`; new `pi one-shot` — `51s / score=75`, `35s / score=65`.
- Висновок transcript: `pi orchestrated` значно кращий за one-shot за якістю, але повільніший за прямий ollama HTTP через overhead N×`spawnSync(pi)` замість streaming HTTP socket.
- На момент transcript фінальний вибір між old ollama HTTP і `pi orchestrated` ще очікував підтвердження користувача.

## Update 2026-06-07

- Для 6-тирної моделі додано helper `resolveModel(tier)` у `npm/lib/models.mjs`, щоб споживачі не читали env-константи напряму.
- Зафіксований каскад:
  - `resolveModel('min')` → `LOCAL_MIN || LOCAL_AVG || LOCAL_MAX || CLOUD_MIN`
  - `resolveModel('avg')` → `LOCAL_AVG || LOCAL_MAX || CLOUD_AVG`
  - `resolveModel('max')` → `LOCAL_MAX || CLOUD_MAX`
- Споживачі, згадані в transcript: `docgen-gen.mjs`, `llm-worker.mjs`, `coverage-fix.mjs`, `subagent-runner.mjs`, `coverage-classify/index.mjs`.
- Для docgen Tier 1 прямий streaming HTTP до `localhost:11434/api/chat` замінено на `pi` orchestrated: окремий `pi -p ... --model ... --no-session --mode text --no-tools` виклик на кожну секцію з `sectionMessages()`.
- Причина вибору pi orchestrated: pi one-shot дав регресію якості, а orchestrated повернув якість до рівня прямого ollama HTTP при provider-neutral транспорті.
- Негативний наслідок з transcript: pi orchestrated на частині benchmark повільніший за прямий ollama HTTP; також стара реалізація мала проблему з `setTimeout(5min)`, який тримав Node.js event loop живим.

## Update 2026-06-07

Уточнено рішення для docgen Tier 1:

- Основний шлях: direct ollama HTTP orchestrated через `/api/chat`.
- Fallback: `checkOllama()` → якщо ollama недоступна, використовувати pi orchestrated.
- `checkOllama()` перевіряє `${OLLAMA_HOST}/api/tags` з timeout 3s і кешує результат на рівні процесу.
- `OLLAMA_HOST` має дозволяти K8s-сценарій з kubeai без зміни коду.
- Для K8s inference обрано kubeai з OllamaEngine, бо він надає Ollama-сумісний API і підтримує scale-to-zero.
- Transcript фіксує, що реалізація fallback у цій сесії ще не була виконана.

## Update 2026-06-07

Зафіксовано валідний Round 1 benchmark для Tier 1 docgen:

- OLD: direct ollama HTTP.
- NEW: pi orchestrated.
- Середній час: OLD 68s, NEW 135s, тобто pi orchestrated приблизно вдвічі повільніший.
- Середній score: 94 проти 94.
- Для `sym=1` OLD кращий на 20 points через cache-hallucination у pi orchestrated.
- Для `sym=2` NEW кращий на 10 points через менше internal-name витоків.
- Round 2 визнано невалідним, бо обидві фази фактично тестували одну й ту саму версію.
- Env benchmark: `N_LOCAL_MIN_MODEL=ollama/gemma3:4b`, M2 8GB unified memory.

Цей update суперечить висновку чернетки про вибір pi orchestrated як основного шляху; надійні числові дані transcript підтримують direct ollama HTTP як швидший primary path із pi як fallback.

## Update 2026-06-07

Реалізовано автоматичний вибір backend для `npm/skills/docgen/js/docgen-gen.mjs`:

- `checkOllama() → true` використовує `ollamaOrchestrated` / `ollamaOneShot`.
- `checkOllama() → false` використовує `piOrchestrated` / `piOneShot`.
- `checkOllama()` виконує `fetch(OLLAMA_HOST/api/tags)` з timeout 3s і кешує результат на процес.
- `OLLAMA_HOST` має default `http://localhost:11434` і сумісний з kubeai у K8s.
- `ollamaModelName()` прибирає prefix `ollama/`, наприклад `ollama/gemma3:4b` → `gemma3:4b`.
- CLI показує активний backend як `[tier1 ollama-orchestrated]` або `[tier1 pi-orchestrated]`.
