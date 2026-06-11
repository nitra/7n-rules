---
session: d84a9f9e-46dc-4800-8576-09954b2ddb1b
captured: 2026-06-11T13:06:59+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/d84a9f9e-46dc-4800-8576-09954b2ddb1b.jsonl
---

## ADR Уніфікований `callLlm` як єдина точка перехоплення wire-trace

## Context and Problem Statement
Проєкт має два LLM-шляхи: прямий HTTP до локального `omlx`-сервера (`callOmlx`) і хмарний `pi`-CLI. Потрібно фіксувати reasoning та спостережувані сліди для аналізу якості скілів, але виклики розкидані по `docgen-gen.mjs`, `llm-worker.mjs`, `coverage-classify/index.mjs` — без єдиного чокпойнта.

## Considered Options
* **A. Local-only**: wrapper лише навколо `callOmlx` — один чокпойнт, але сліпий до `pi`-гілки.
* **B. + pi-шлях**: додатково інструментувати `pi`-гілки у кожному скілі окремо — немає єдиного чокпойнта, деградований сигнал.
* **C. Уніфікований `callLlm`**: спільна функція над обома бекендами вже існувала (`npm/lib/llm.mjs`, ADR 260610-2228); усі callerи мігрують на неї.

## Decision Outcome
Chosen option: "C. Уніфікований `callLlm`", because єдина точка забезпечує повне покриття обох бекендів без blind spot, а `npm/lib/llm.mjs` вже існував як готова інфраструктура; `fix/llm-worker.mjs` і `coverage-classify/index.mjs` мігровані з прямих `callOmlx`/`pi`-spawn на `callLlm`.

### Consequences
* Good, because transcript фіксує очікувану користь: усі виклики трасуються в одному форматі незалежно від бекенда; `doc-files` через `callLlm` охоплені автоматично.
* Bad, because міграція двох callerів (`llm-worker.mjs`, `coverage-classify`) потребувала рефактору; прямих `callOmlx(` callerів у product-коді не мало лишитись — перевірено grep'ом.

## More Information
Файли: `npm/lib/llm.mjs`, `npm/lib/omlx.mjs`, `npm/skills/fix/js/llm-worker.mjs`, `npm/scripts/coverage-classify/index.mjs`. Передіснуючий мінімальний trace (`N_CURSOR_LLM_TRACE` env) **замінений** (replace, не enrich) на always-on багатий JSONL-запис.

---

## ADR Двошарова модель зберігання: raw gitignored + aggregate в git

## Context and Problem Statement
Wire-trace з повними `messages` (вихідний код файлів) і reasoning занадто великий і чутливий для git-репо, але користувач хоче **назавжди зберігати знання**, отримані з трас — ця суперечність потребувала явного розподілу.

## Considered Options
* **Single-file gitignored**: весь trace gitignored; знання губляться разом із ротацією.
* **Двошарова модель**: сирий лог gitignored (scratch), дистильований агрегат коммітиться в git.

## Decision Outcome
Chosen option: "Двошарова модель", because сирий JSONL містить вихідний код файлів і роздув би git-історію; агрегат — малий, дистильований — і саме він несе довгострокову цінність для покращення проєкту.

### Consequences
* Good, because transcript фіксує очікувану користь: агрегат `docs/omlx-insights/` переживає 30-денну авто-очистку транскриптів Claude Code і може код-ревʼюватись у PR.
* Bad, because raw-шар потребує недеструктивної ротації (нумеровані `llm-trace.<seq>.jsonl`), щоб дані доживали до агрегації — деструктивна `.1`-ротація була початковою помилкою в спеці.

## More Information
Шлях raw: `<cwd>/.n-cursor/llm-trace.jsonl` (gitignored через `.gitignore`). Шлях aggregate: `docs/omlx-insights/` (git-committed). Специфікація: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.

---

## ADR Always-on wire-trace з kill-switch `N_CURSOR_OMLX_TRACE=0`

## Context and Problem Statement
Попередній поверхневий trace в `callLlm` був opt-in через `N_CURSOR_LLM_TRACE=<file>` — це означало, що збір даних вимагав ручного ввімкнення і на практиці залишався вимкненим.

## Considered Options
* **Opt-in через env**: `N_CURSOR_LLM_TRACE=<file>` — запис лише коли явно виставлено.
* **Always-on з kill-switch**: trace увімкнено за замовчуванням; `N_CURSOR_OMLX_TRACE=0` вимикає.

## Decision Outcome
Chosen option: "Always-on з kill-switch", because мета — пасивне накопичення знань без ручних дій; kill-switch лишає можливість вимкнути в CI чи при налагодженні.

### Consequences
* Good, because transcript фіксує очікувану користь: trace пишеться автоматично в `.n-cursor/` без будь-яких env-змінних.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо overhead на диску — ротація 50 MB — стартовий поріг, уточнюється після перших днів.

## More Information
Модуль: `npm/lib/omlx-trace.mjs`, функції `tracePath`, `writeTrace` (fail-safe). Старий env `N_CURSOR_LLM_TRACE` видалено з `llm.mjs`.

---

## ADR `callOmlxRaw` як internal rich-return, `callOmlx` лишається string-обгорткою

## Context and Problem Statement
`callOmlx` повертав лише `choices[0].message.content` (рядок), викидаючи `reasoning_content`, `usage` (включно з `model_load_duration`, `cached_tokens`), `finish_reason` і кількість retry. Для wire-trace потрібні ці поля, але публічний контракт (`callOmlx` → `string`) не можна ламати.

## Considered Options
* **Змінити контракт `callOmlx`** на rich-object — ламає всіх споживачів.
* **`callOmlxRaw` як internal функція** + `callOmlx = callOmlxRaw(...).content` як обгортка.

## Decision Outcome
Chosen option: "`callOmlxRaw` як internal rich-return", because дозволяє `callLlm` споживати повний обʼєкт без зміни публічного API; `callOmlx` лишається сумісним string-wrapper'ом для решти.

### Consequences
* Good, because transcript фіксує очікувану користь: живий smoke-тест підтвердив `reasoning_source: field`, повний `usage`, `sha256` у trace-записі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/lib/omlx.mjs`. Нові експорти: `callOmlxRaw`, `extractReasoning`. `extractReasoning` реалізує деградацію: `reasoning_content` (primary) → `<think>…</think>` в `content` (fallback) → `truncated` (коли `finish_reason=length` обрізав thinking всередину `content`). Поведінка `truncated` підтверджена живою перевіркою: при `max_tokens: 256` модель `Qwen3-4B-Thinking-2507-4bit` кладе думки в `content` без тегів.
