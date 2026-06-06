---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T07:30:17+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

## ADR Локальна Ollama для docgen Tier 1 замість хмарних Claude-субагентів

## Context and Problem Statement
Скіл `n-docgen` генерує Tier 1 документацію (~1042 нових файлів у проєкті) через Claude-субагенти, що коштує ~26 M хмарних токенів (~$300–570 за повний прогін). Мета — знизити вартість Tier 1 до $0, перемістивши генерацію на локальний ollama-сервер, не зачіпаючи Tier 2/3 (синтез — залишається на Claude).

## Considered Options
* Локальна Ollama для Tier 1 (всіх незалежних file-per-file субагентів)
* Гібрид: Ollama-bulk Tier 1 + Claude для провалів quality-gate + Claude Tier 2/3
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Гібрид: Ollama Tier 1 + Claude-хвіст + Claude Tier 2/3", because Tier 1 складається з 1042+ незалежних механічних задач «один файл → один md», що ідеально лягають на локальну модель. Tier 2/3 (синтез, ~2.6 M токенів, 16 модулів) — залишається на Claude, бо якість синтезу критична.

### Consequences
* Good, because transcript фіксує очікувану користь: ~26 M хмарних токенів Tier 1 → $0; Claude витрачається лише на ~2.6 M токенів (Tier 2/3) + Claude-хвіст.
* Bad, because на 8 GB M2 Tier 1 стає суворо послідовним (concurrency=1): паралельний batch по 5 (хмарний патерн) зникає. Повний прогін — 14–42 год залежно від моделі.

## More Information
Команди: `npx @nitra/cursor docgen scan --root <dir>` (детермінований список), `POST http://localhost:11434/api/chat` (генерація). Конфіг pi-провайдера: `~/.pi/agent/models.json` (`ollama`, `baseUrl: http://localhost:11434/v1`). Бенчмарки: `/tmp/docgen-bench*/run.py` (не збережено в репо). Файли-джерела тестів: `npm/rules/abie/lib/enabled.mjs`, `npm/rules/abie/js/firebase_hosting.mjs`, `npm/rules/abie/lib/overlay-paths.mjs`, `npm/rules/abie/lib/k8s-tree.mjs`.

---

## ADR System-prompt як вирішальний фактор якості Ollama-генерації

## Context and Problem Statement
При виклику `gemma3:4b` напряму через `POST /api/chat` без system-role якість доки була ~71% (витік stdlib/regex/сигнатур, обрізання на великих файлах). Виклик через `pi --provider ollama` давав ~87%. Потрібно було з'ясувати причину різниці: транспорт (pi vs HTTP) чи вміст промпту.

## Considered Options
* Перехід на pi як транспорт (вбудований system-prompt pi)
* Прямий `ollama /api/chat` з явним `system`-повідомленням
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прямий ollama /api/chat з system-prompt", because контрольований експеримент (A: прямий без system ~71%, B: pi ~87%, C: прямий+system ~85%) показав: 15 п.п. приросту дає system-prompt, а не сам інструмент pi. Різниця B↔C (2 п.п.) — у межах шуму суб'єктивного оцінювання (~±3 п.п.).

### Consequences
* Good, because transcript фіксує очікувану користь: прямий HTTP без node-старту (~4 с/виклик на pi), повний контроль `num_ctx`/`num_predict` (усуває обрізання), простіша інтеграція в CLI `docgen gen`.
* Bad, because transcript не містить підтверджених негативних наслідків. Pi лишається валідним варіантом із ергономічних міркувань — per-file виклик із `--append-system-prompt` дає рівноцінну якість.

## More Information
Конфіг прямого виклику: `POST http://localhost:11434/api/chat`, тіло `{model, messages:[{role:"system",...},{role:"user",...}], stream:false, options:{num_ctx:8192, num_predict:1100, temperature:0.2}}`. System-prompt містить: заборону ` ``` `-огорожі, заборону переліку stdlib/regex/типів/сигнатур, вимогу фіксувати крайові деталі (що свідомо пропускається, fail-safe). Pi per-file рецепт: `pi -p --provider ollama --model <model> --no-tools --no-session --no-context-files --append-system-prompt "$STYLE"`.

---

## ADR Вибір локальної моделі для docgen Tier 1 на 8 GB M2

## Context and Problem Statement
На 8 GB Apple M2 unified memory необхідно вибрати локальну LLM для docgen Tier 1. Головні вісі: модель має поміщатися в RAM (інакше своп → 0.4 tok/s, як `gemma4:e4b` 9.6 GB на 8 GB — непридатно), і якість українськомовної поведінкової доки має бути прийнятною.

## Considered Options
* `gemma3:4b` (3.3 GB, 100% GPU, ~20 tok/s, ~85% vs еталон)
* `gemma4-e4b:q4` (5.3 GB, 56%/44% CPU/GPU офлоад, ~11 tok/s, ~92% vs еталон)
* `qwen2.5-coder:3b` (2.4 GB, 100% GPU, ~28 tok/s, ~77% vs еталон) — відхилено через мовні дефекти і витік сигнатур
* `qwen3:4b` — відхилено: ігнорує `/no_think`, відповідає не українською
* 7–8B моделі (`qwen2.5:7b`, `llama3.1:8b`, `qwen2.5-coder:7b`) — відхилено: не вміщаються у 8 GB → CPU-офлоад без виграшу в якості

## Decision Outcome
Chosen option: "gemma4-e4b:q4 як quality-first, gemma3:4b як speed-first", because бенчмарк на 3 різнопланових файлах (`firebase_hosting.mjs`, `overlay-paths.mjs`, `k8s-tree.mjs`) показав: `gemma4-e4b:q4` стабільно дотримується негативних обмежень (без сигнатур/stdlib/regex/приватних імен), які `gemma3:4b` частково ігнорувала; виграш ~7 п.п. за рахунок удвічі більшого часу прогону (~30 год vs ~14.5 год на 1042 файли).

### Consequences
* Good, because transcript фіксує очікувану користь: `gemma4-e4b:q4` дає ~92% якості vs еталон (`gemma3:4b` ~85%); обидві суттєво вище «нульового» варіанта `gemma4:e4b` (9.6 GB → своп → 0.4 tok/s → 37 діб, непридатно).
* Bad, because `gemma4-e4b:q4` (5.3 GB) не вміщається повністю у 8 GB — 56% CPU/44% GPU офлоад → час удвічі більший і tok/s нижча (залежить від поточного memory pressure машини).

## More Information
Виміряний профіль: `ollama ps` SIZE/PROCESSOR після `keep_alive` warm. Canonical alias: `ollama cp batiai/gemma4-e4b:q4 gemma4-e4b:q4` (спільні blob-и, ID `d682bf87e3a3`, ~0 диску). Реєстрація у pi: `~/.pi/agent/models.json`, масив `models` провайдера `ollama`, перша модель = дефолтна в межах провайдера. Глобальний pi-default (`~/.pi/agent/settings.json`) не змінювався навмисно — щоб не перевести весь pi-кодинг на локальну модель. Бенчмарк-скрипти: `/tmp/docgen-bench2/run.py`, `~/docgen-bench3/duel.py`, `~/docgen-bench3/g4.py`.
