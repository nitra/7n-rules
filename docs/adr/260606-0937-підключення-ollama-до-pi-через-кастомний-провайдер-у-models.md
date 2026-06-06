---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T09:37:45+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

## ADR Підключення Ollama до pi через кастомний провайдер у `models.json`

## Context and Problem Statement
`pi` за замовчуванням знав лише провайдер `openai-codex`. Потрібно було підключити локальний Ollama (`gemma3:4b`) для docgen-експериментів без зміни основного pi-провайдера.

## Considered Options
* Кастомний провайдер через `~/.pi/agent/models.json` з `api: "openai-completions"` і `baseUrl: "http://localhost:11434/v1"`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "кастомний провайдер через `~/.pi/agent/models.json`", because Ollama надає OpenAI-сумісний ендпойнт на `:11434/v1`, а pi підтримує `api: "openai-completions"` зі схемою `ProviderConfig` (поля `baseUrl`, `apiKey`, `compat`).

### Consequences
* Good, because transcript фіксує очікувану користь: `pi --list-models gemma` показав `ollama gemma3:4b 128K 16.4K` і пробний виклик повернув `Так.`.
* Bad, because `pi --provider ollama` без явного `--model` бере глобальний default (`gpt-5.5`), а не першу ollama-модель — потрібно завжди передавати `--model`.

## More Information
Файл конфігурації: `~/.pi/agent/models.json`. Документація формату: `$PKG/docs/models.md` пакету `@earendil-works/pi-coding-agent`. Команда перевірки: `pi --list-models gemma`.

---

## ADR System-prompt — головний важіль якості локальних моделей

## Context and Problem Statement
Прямий виклик ollama без system-prompt давав ~71% якості (витік stdlib, сигнатур, обрізання на `overlay-paths`). Потрібно було з'ясувати, чи якість pi-варіанта (~87%) зумовлена самим pi чи чимось іншим.

## Considered Options
* Пояснення: перевага pi як інструмента (агентна обгортка, node-процес)
* Пояснення: наявність system-prompt (pi має вбудований coding-assistant system-prompt)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "наявність system-prompt", because варіант C (прямий ollama `/api/chat` + system-role) дав ~85% якості — на рівні pi (~87%), тоді як варіант A (прямий без system) — ~71%. Різниця A↔(B,C) системна (~15 п.п.) з конкретними причинами; різниця B↔C (~2 п.п.) — в межах шуму ручного оцінювання.

### Consequences
* Good, because transcript фіксує очікувану користь: прямий `/api/chat` + system-prompt прибрав обрізання `overlay-paths`, прибрав витік regex/`fs.promises`, підняв якість до рівня pi без node-оверхеду.
* Bad, because 2 п.п. різниці між B і C пояснюється якістю конкретного system-prompt (відшліфований у pi vs чорновий за 1 спробу), тому «рівень pi» не гарантовано відтворюється з будь-яким промптом.

## More Information
Бенч-скрипти: `~/docgen-bench3/run.py`, `~/docgen-bench3/confirm.py`. Результати: `~/docgen-bench3/results.jsonl`. Еталони: `~/docgen-bench3/etalon/`.

---

## ADR Архітектура JS-оркестратора docgen: інверсія керування

## Context and Problem Statement
One-shot виклик локальної моделі (~85% для `gemma3:4b`) давав витоки (stdlib, сигнатури, внутрішні імена) і нестабільну структуру. Потрібен підхід, що підніме якість без переходу на більшу модель.

## Considered Options
* One-shot (один промпт → повна документація)
* JS-оркестратор: детермінована екстракція фактів + секційні міні-промпти + детермінована зборка
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "JS-оркестратор з інверсією керування", because модель псує саме те, що можна зробити детерміновано: імена функцій, список stdlib, структуру секцій. JS (`docgen-extract.mjs` → `docgen-prompts.mjs` → `docgen-gen.mjs`) тримає факти й структуру, а модель перефразовує тільки прозу.

### Consequences
* Good, because transcript фіксує очікувану користь: оркестрований `gemma3:4b` дав ~86% проти ~80% one-shot (+6 п.п.), API-секції із точними назвами з JSDoc, зникли витоки `walkDir`/механіки кешу.
* Bad, because v1 (повний код у кожну секцію) показав 3.8× сповільнення через повторний інгест; потребував v2 з секційно-мінімальним контекстом для вирівнювання часу.

## More Information
Файли: `npm/skills/docgen/js/docgen-extract.mjs`, `docgen-prompts.mjs`, `docgen-gen.mjs` у worktree `.worktrees/feat-docgen-orchestrator-pi`. Конвеєр: Stage 0 (екстракція, 0 токенів) → Stage 1 (секційні LLM-виклики) → Stage 2 (детермінований лінт) → Stage 3 (зборка).

---

## ADR Секційно-мінімальний контекст (v2): код — тільки у секцію «Поведінка»

## Context and Problem Statement
v1 оркестратора надсилав повний код файлу в усі 4 секційні виклики → повторний інгест коду 4× → 3.8× повільніше за one-shot (310 с vs 57 с для `overlay-paths`).

## Considered Options
* Спільний prefill: повний код у system, секційні виклики накопичують turns (multi-turn сесія)
* Секційно-мінімальний контекст: код іде тільки в `Поведінку`; `Огляд`/`API`/`Гарантії` отримують лише факт-лист (крихітний JSON)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "секційно-мінімальний контекст", because `Огляд` потребує лише header-коментар, `Публічний API` — список експортів (уже є в факт-листі), `Гарантії` — лише markers. Код потрібен тільки `Поведінці`. Менший контекст = менший інгест = швидше, незалежно від KV-cache.

### Consequences
* Good, because transcript фіксує очікувану користь: `overlay` 310→77 с (×4), `k8s` 141→55 с (швидше за one-shot), якість ~86% збережено.
* Bad, because `gemma4:4b` (`batiai/gemma4-e4b:q4`) повертає порожній рядок (`""`) для секцій без коду в контексті — секційно-мінімальний підхід для неї фундаментально не працює (підтверджено прямим дебаг-викликом).

## More Information
Зміна у `docgen-prompts.mjs`: функція `sectionMessages` — `Поведінка` отримує `src`, решта — `factsSummary(facts)`. Детермінований Stage-2 лінт у `docgen-gen.mjs`: `lintSection(text, facts)` зрізає сигнатури (`word(…)` у прозі) і забороняє імена з `facts.privateSymbols`.

---

## ADR Канонічний alias `gemma4:4b` для `batiai/gemma4-e4b:q4` в Ollama та pi

## Context and Problem Statement
Квантована модель Gemma 3n E4B завантажена під назвою `batiai/gemma4-e4b:q4` (namespace третьої сторони). Потрібна чиста канонічна назва для використання в скриптах, pi та `ollama run`.

## Considered Options
* Використовувати `batiai/gemma4-e4b:q4` як є
* Створити alias `gemma4:4b` через `ollama cp` (спільний blob, 0 додаткового диску)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "alias `gemma4:4b` через `ollama cp`", because `ollama cp` ділить blob-и (ID `d682bf87e3a3`) — не займає додаткового місця, а коротша назва зручніша в скриптах і `pi --model`.

### Consequences
* Good, because transcript фіксує очікувану користь: `ollama run gemma4:4b` і `pi --list-models gemma4` повертають модель; оригінальний `batiai/`-запис видалений (`ollama rm`), alias лишився єдиним.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команди: `ollama cp batiai/gemma4-e4b:q4 gemma4:4b`, `ollama rm batiai/gemma4-e4b:q4`. Файл pi: `~/.pi/agent/models.json` — `gemma4:4b` перша в `providers.ollama.models`, `gemma3:4b` друга. Глобальний pi-default (`~/.pi/agent/settings.json`: `defaultModel: "gpt-5.5"`) не змінювався навмисно.
