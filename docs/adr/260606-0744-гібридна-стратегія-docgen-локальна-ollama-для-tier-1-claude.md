---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T07:44:29+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

## ADR Гібридна стратегія docgen: локальна Ollama для Tier 1, Claude для Tier 2/3

## Context and Problem Statement
Tier 1 docgen (1042+ незалежних файлів → md) коштує ~26M хмарних токенів (~$300–570 за повний прогін). Постало питання, чи можна перенести Tier 1 на локальний рушій, зберігши Claude лише для синтезу.

## Considered Options
* Локальна Ollama для Tier 1 + Claude-хвіст + Claude Tier 2/3 (гібрид)
* Повністю Claude (status quo)

## Decision Outcome
Chosen option: "Локальна Ollama для Tier 1 (гібридна стратегія)", because Tier 1-задачі незалежні й механічні, якість ~85–92% прийнятна як чорновик; Claude лишається для Tier 2/3 (~2.6M токенів) і файлів, що провалили quality-gate.

### Consequences
* Good, because transcript фіксує: ~26M хмарних токенів Tier 1 → $0; Tier 2/3 коштує лише ~2.6M токенів; масштабується лінійно послідовним одним потоком на 8 GB M2.
* Bad, because якість знижується до ~85–92% проти Claude; файли, що перевищують num_ctx або провалили quality-gate, потребують Claude-хвоста; Tier 1 займає ~14.5–30 год замість хвилин.

## More Information
Розрахункова база: `npx @nitra/cursor docgen scan` → 1442 файли (400 exists=true, 1042 нових), 16 модулів, середнє 90 members. Виміри tok/s на Apple M2 8 GB: прямий `/api/generate` або `/api/chat` з `keep_alive`; конкретні числа — в ADR про вибір моделей.

---

## ADR Вибір локальних моделей Tier 1 на 8 GB Apple M2

## Context and Problem Statement
8 GB unified RAM Apple M2 встановлює жорстке обмеження: модель + KV-cache + macOS = ~5–5.5 GB бюджету. Моделі ≥5.5 GB свопляться і падають до 0.4–1.3 tok/s (виміряно на `gemma4:e4b` 9.6 GB → 0.4 tok/s). Бенчмарк 9 кандидатів (чистий старт, той самий docgen-промпт, відсотки якості проти рукописного еталона) звузив вибір.

## Considered Options
* gemma3:4b (3.3 GB, 100% GPU)
* gemma4:4b / batiai/gemma4-e4b:q4 (5.3 GB, 56%/44% CPU/GPU)
* qwen3:4b — відхилено: ігнорує `/no_think`, відповідає не-UA мовою
* qwen2.5-coder:3b — відхилено: мовні дефекти (77%, «єх немає», «Некидає винятків»)
* llama3.2:3b, gemma2:2b, phi3.5— відхилено: слабка українська або зіпсований формат
* qwen2.5:7b, qwen2.5-coder:7b, llama3.1:8b — відхилено: частковий CPU-офлоад без якісної переваги

## Decision Outcome
Chosen option: "gemma3:4b (швидкість-first) + gemma4:4b (якість-first)", because перетин «100% або прийнятний GPU-fit × добра українська» дає лише ці дві; gemma4:4b слухає негативні обмеження краще за 4B-клас.

### Consequences
* Good, because transcript фіксує заміряну якість: gemma3:4b ~85% (20 tok/s, ~14.5 год на 1042 файли), gemma4:4b ~92% (11 tok/s, ~30 год); обидві юзабельні для Tier 1 на 8 GB.
* Bad, because gemma4:4b частково офлоадиться (RAM 6.2 GB, 56% CPU), час удвічі більший; обидві дають витік реалізації у ~8–15% файлів — потрібен quality-gate і Claude-хвіст.

## More Information
Моделі на диску: `gemma4:4b` (alias `batiai/gemma4-e4b:q4`, blob `d682bf87e3a3`, 5.3 GB), `gemma3:4b` (blob `a2af6cc3eb7f`, 3.3 GB). Бенчмарк проводився на файлах `npm/rules/abie/js/firebase_hosting.mjs`, `npm/rules/abie/lib/overlay-paths.mjs`, `npm/rules/abie/lib/k8s-tree.mjs`; еталони — рукописні доки в стилі Огляд/Поведінка/Гарантії поведінки.

---

## ADR System-prompt як первинний важіль якості для локальних docgen-моделей

## Context and Problem Statement
Порівняльний експеримент (прямий Ollama без system-prompt; pi з вбудованим coding-assistant system-prompt; прямий Ollama з явним поведінковим system-prompt) виявив різкий розрив у якості між «без system» і «з system», тоді як вибір транспорту (pi vs прямий) дав лише шум у межах ±3 п.п.

## Considered Options
* Прямий Ollama `/api/chat` без system-prompt
* Виклик через `pi` (вбудований coding-assistant system-prompt pi)
* Прямий Ollama `/api/chat` + явний поведінковий system-prompt

## Decision Outcome
Chosen option: "Прямий Ollama /api/chat + явний поведінковий system-prompt", because якість pi-рівня (~85%) досягається без node-оверхеду pi (~4 с/файл) і з повним контролем `num_ctx`/`num_predict` — що усуває обрізання виводу, що спостерігалось у варіанті без system.

### Consequences
* Good, because transcript фіксує: наявність system-prompt підіймає якість на +14–16 п.п. (варіант A ~71% → варіанти B/C ~85–87%); контроль `num_predict` усуває обрізання; відсутність node-старту економить ~1.1 год на 1042 файлах.
* Bad, because потрібно писати й підтримувати power-промпт в єдиному місці (`docgen-prompt.mjs`); залишковий ` ``` `-fence у виводах потребує пост-обробки `sed '/^```/d'`.

## More Information
Конфіг виклику: `POST http://localhost:11434/api/chat`, `stream: false`, `options.num_ctx` і `options.num_predict` явно, `keep_alive: "15m"`, повідомлення `[{role:"system", content: STYLE_PROMPT}, {role:"user", content: PROMPT+source}]`. Стиль-промпт: заборона `\`\`\``-огорожі, без сигнатур/типів/stdlib/regex/приватних імен, секції Огляд/Поведінка/Публічний API/Гарантії поведінки, лови крайові деталі (що свідомо пропускається, що НЕ перевіряється). pi також залишається як валідний транспорт (`--provider ollama --model gemma4:4b --append-system-prompt "$STYLE"`) за умови per-file викликів (не RPC-сесія — вона накопичує контекст).
