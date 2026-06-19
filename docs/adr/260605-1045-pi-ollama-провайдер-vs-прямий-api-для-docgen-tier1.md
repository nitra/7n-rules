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
