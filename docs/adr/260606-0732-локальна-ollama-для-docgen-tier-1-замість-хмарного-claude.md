---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T07:32:38+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

## ADR Локальна Ollama для docgen Tier 1 замість хмарного Claude

## Context and Problem Statement
Скіл `n-docgen` диспатчить окремий Claude-субагент на кожен кодовий файл (Tier 1). У проєкті — 1442 файли-кандидати; середня вартість одного субагента ~25 k токенів → ~28–36 M токенів на повний прогін, що в перерахунку на ціну API (~$10–20/M) складає $300–770. Потрібно оцінити, чи можна Tier 1 перенести на локальну модель.

## Considered Options
* Залишити Tier 1 повністю на Claude (хмарні субагенти)
* Перенести Tier 1 на локальну Ollama (нульова хмарна вартість), решту — Claude

## Decision Outcome
Chosen option: "Перенести Tier 1 на локальну Ollama", because вартість Tier 1 (26–36 M токенів) — найбільша стаття; завдання механічне й незалежне (один файл → один `.md`), де хмарна якість не є необхідною.

### Consequences
* Good, because transcript фіксує очікувану користь: вартість Tier 1 падає до $0; Tier 2/3 лишається на Claude (~2.6 M токенів — незначно).
* Bad, because на 8 GB M2 прогін суворо послідовний (concurrency = 1, батчі по 5 зникають), а повний Tier 1 займає ~14.5–30 год залежно від моделі.

## More Information
Команда: `npx @nitra/cursor docgen scan --root <dir>` (повертає JSON-список кандидатів). Дефолтний пропуск `exists: true` вже економить ~10 M токенів (400 наявних файлів). Гібрид: локальний Tier 1 → Claude-хвіст (провали quality-gate) → Claude Tier 2/3. Виміри проведено на файлах `npm/rules/abie/lib/enabled.mjs`, `firebase_hosting.mjs`, `overlay-paths.mjs`, `k8s-tree.mjs`.

---

## ADR Вибір gemma4:4b як основної моделі для локального docgen Tier 1

## Context and Problem Statement
На 8 GB M2 необхідно вибрати локальну модель для docgen Tier 1, яка: (а) повністю або прийнятно вміщається у 8 GB unified RAM; (б) генерує якісну українськомовну поведінкову документацію; (в) дає прийнятну швидкість для разового прогону.

## Considered Options
* gemma3:4b (3.3 GB, 100% GPU, ~20 tok/s)
* qwen2.5-coder:3b (2.4 GB, 100% GPU, ~28–36 tok/s)
* qwen2.5:7b, qwen2.5-coder:7b, llama3.1:8b (5.1–5.7 GB, частковий CPU-офлоад)
* llama3.2:3b, gemma2:2b, phi3.5, qwen3:4b (2.0–4.0 GB)
* batiai/gemma4-e4b:q4 → aliased gemma4:4b (5.3 GB, 56%/44% CPU/GPU, ~11 tok/s)
* gemma4:e4b оригінал (9.6 GB → 0.4 tok/s у свопі — відкинуто)

## Decision Outcome
Chosen option: "gemma4:4b (alias batiai/gemma4-e4b:q4)", because benchmark на 3 різних файлах з еталонними документами (написаними в узгодженому стилі) показав: середня якість ~92% проти ~85% у gemma3:4b і ≤77% у менших моделей; при цьому 11 tok/s достатньо для нічного/вихідного прогону (~30 год на 1042 файли).

### Consequences
* Good, because transcript фіксує: gemma4:4b **слухає негативні обмеження** (без сигнатур/stdlib/внутрішніх імен), які gemma3:4b ігнорувала; перевагу підтверджено на `firebase_hosting` (93 vs 89%), `overlay-paths` (92 vs 85%), `k8s-tree` (90 vs 80%).
* Bad, because 56%/44% CPU/GPU офлоад (модель 5.3 GB не входить повністю у 8 GB) → вдвічі повільніша за gemma3:4b; на 8 GB прогін чутливий до одночасного навантаження (memory thrashing, виміряний у марафоні).

## More Information
Назва в Ollama: `gemma4:4b` (alias, `ollama cp batiai/gemma4-e4b:q4 gemma4:4b`, спільні blob-и, 0 додаткового диску). Запис у `~/.pi/agent/models.json` — перший у списку провайдера `ollama`. `gemma3:4b` лишається другою моделлю (швидкість-first варіант: ~85% якості, ×2 швидше). Бенчмарк: `/tmp/docgen-bench2/`, `/tmp/docgen-bench3/`, еталони написані й оцінені вручну в сесії.

---

## ADR System-prompt як визначальний чинник якості docgen, незалежно від транспорту

## Context and Problem Statement
Порівняння (A) прямий `ollama /api/generate` без system-prompt vs (B) `pi --provider ollama` показало суттєву різницю якості (A ~71%, B ~87%). Потрібно зрозуміти, чим зумовлена різниця, щоб вирішити, чи вимагає виклик через pi.

## Considered Options
* Використовувати pi як транспорт (зберігає його вбудований system-prompt)
* Використовувати прямий `ollama /api/chat` без system-prompt
* Використовувати прямий `ollama /api/chat` з явним system-prompt

## Decision Outcome
Chosen option: "прямий ollama /api/chat з явним system-prompt", because контрольований експеримент (C) показав: прямий виклик із system-role (`/api/chat`, два повідомлення: `system` + `user`) дає ~85% — рівень pi (~87%) у межах похибки ±3 п.п. суб'єктивного оцінювання. Різниця між B і C — якість самого system-prompt, а не архітектура транспорту.

### Consequences
* Good, because transcript фіксує: прямий `/api/chat` + system-prompt дає повний контроль над `num_ctx`/`num_predict` (зникає проблема обрізання, яка впала A на `overlay-paths`); відсутній ~4 с node-старт на кожен виклик pi; простіша інтеграція у CLI-команду.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
Ключові параметри system-prompt: мова Ukrainian; чистий Markdown без ` ``` `-обгортки; без сигнатур/типів/параметрів; без переліку stdlib; без regex і приватних імен; ловити крайові деталі (що пропускається, що не перевіряється, fail-safe). Секції: `## Огляд`, `## Поведінка`, `## Публічний API` (лише нетривіальні), `## Гарантії поведінки`. Post-process: `sed '/^```/d'` для залишкових fence. pi-варіант (per-file, `--no-tools --no-session --append-system-prompt`) — рівноцінна альтернатива з ергономічними перевагами та помірним часовим податком (~4 с/файл старт + довший вивід).

---

## ADR Канонічна назва gemma4:4b через ollama cp замість batiai/-префікса

## Context and Problem Statement
Встановлена модель зареєстрована в Ollama як `batiai/gemma4-e4b:q4`. Префіксна назва незручна для скриптів і конфігів; потрібна коротша канонічна.

## Considered Options
* Використовувати `batiai/gemma4-e4b:q4` скрізь
* Створити чистий alias через `ollama cp`

## Decision Outcome
Chosen option: "ollama cp до gemma4:4b", because `ollama cp` ділить blob-и з оригіналом (0 додаткового диску), а коротка назва `gemma4:4b` читабельна в скриптах і конфізі pi.

### Consequences
* Good, because transcript фіксує: `pi --list-models gemma4` одразу показує `ollama  gemma4:4b  128K  16.4K`; `ollama run gemma4:4b` відповідає без помилок.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команди: `ollama cp batiai/gemma4-e4b:q4 gemma4:4b`; прибрано проміжний alias `gemma4-e4b:q4`. Обидва імені (`batiai/gemma4-e4b:q4` і `gemma4:4b`) мають однаковий blob ID `d682bf87e3a3`. Конфіг: `~/.pi/agent/models.json` — `gemma4:4b` перша у списку провайдера `ollama`.
