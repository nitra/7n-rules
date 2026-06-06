---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-06T21:03:19+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

## ADR `_fix-check` як приватна CLI-команда замість `fix --json`

## Context and Problem Statement
`fix --json` слугувало публічним API для машинного читання результатів перевірки. Після перетворення `fix` на оркестратор ця команда більше не мала сенсу, але `t0.mjs` та `orchestrator.mjs` обидва потребували способу викликати логіку перевірки як підпроцес.

## Considered Options
* Внутрішня команда `_fix-check` (підкреслення = private) — `orchestrator` і `t0` викликають її як subprocess
* Пряме JS-імпортування функції перевірки без subprocess-накладних

## Decision Outcome
Chosen option: "Внутрішня команда `_fix-check`", because це мінімальна зміна: до `npm/bin/n-cursor.js` додається один `case '_fix-check'`, а `fix --json` прибирається з публічного API повністю. Прямий JS-виклик потребував би вилучення логіки в окремий модуль.

### Consequences
* Good, because підкреслення-префікс (`_fix-check`) сигналізує "не публічний API" без додаткової документації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/bin/n-cursor.js` — case `fix` тепер завжди викликає `runOrchestratorCli`; case `_fix-check` викликає `runFixCommand(args, { json: true })`; `case 'fix-run'` — deprecated alias зі стерженням до orchestrator. `npm/skills/fix/js/t0.mjs` — `[N_CURSOR_BIN, 'fix', '--json', ...]` замінено на `[N_CURSOR_BIN, '_fix-check', ...]`. `npm/skills/fix/js/orchestrator.mjs` — функція `runFixCheck` викликає `_fix-check` subprocess і парсить stdout JSON.

---

## ADR pi model routing — порожній рядок замість прапора `--model`

## Context and Problem Statement
При виклику `pi --model gpt-5.4-mini ...` pi v0.78.0 маршрутизує запит через провайдер `azure-openai-responses`, для якого потрібен окремий API-ключ. Без прапора `--model` pi використовує дефолтну підписку (GPT-5 через `openai-codex` OAuth або Google). Передача порожнього рядка як значення `--model` не вирішувала проблему.

## Considered Options
* Опустити прапор `--model` коли значення — порожній рядок (`model ? ['--model', model] : []`)
* Завжди передавати конкретну назву моделі
* Використовувати прапор `--provider` для явного вибору провайдера

## Decision Outcome
Chosen option: "Опустити прапор `--model` коли значення — порожній рядок", because це єдиний спосіб задіяти subscription-default без знання конкретної назви моделі на машині користувача. Тест підтвердив: `pi -p "..." --no-session` → `GPT-5`, `pi -p "..." --model gpt-5 --no-session` → `azure-openai-responses` помилка.

### Consequences
* Good, because transcript фіксує очікувану користь: GPT-5 через pi виправив `process.env.TEST_KEY` → `env.TEST_KEY` за одну ітерацію без налаштування API-ключів.
* Bad, because дефолтна модель залежить від конфігурації pi на конкретній машині — поведінка непередбачувана між машинами.

## More Information
`npm/skills/fix/js/llm-worker.mjs` — функція `callPi(prompt, model)`: `const modelArgs = model ? ['--model', model] : []`. Дефолти `MODEL = ''` і `MODEL_HEAVY = ''`. Тестова команда: `pi -p '{"ok":true}' --no-session --mode text --no-tools` повернула `{"ok":true}`.

---

## ADR Провайдер-нейтральні env vars для LLM-tier оркестратора

## Context and Problem Statement
`MODEL_HAIKU` і `MODEL_SONNET` — назви специфічні для Anthropic Claude. На машинах де налаштований Google, OpenAI або інший провайдер pi, помилка `No API key found for anthropic` виникала при дефолтному запуску, і повідомлення про помилку не давало підказки як її виправити.

## Considered Options
* Провайдер-нейтральні назви `MODEL` / `MODEL_HEAVY` із env `N_CURSOR_FIX_MODEL` / `N_CURSOR_FIX_MODEL_HEAVY`
* Зберегти Anthropic-специфічні назви (`MODEL_HAIKU`, `MODEL_SONNET`)

## Decision Outcome
Chosen option: "Провайдер-нейтральні назви `MODEL` / `MODEL_HEAVY`", because pi підтримує формат `provider/model-id` (наприклад `google/gemini-2.5-flash`, `ollama/gemma3:4b`, `openai/gpt-4o-mini`) і відсутність anthropic — нормальна ситуація. Нова назва відображає роль (легка/важка модель) незалежно від провайдера.

### Consequences
* Good, because transcript фіксує очікувану користь: при помилці `No API key` виводиться корисне повідомлення з прикладами `provider/model-id` форматів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/skills/fix/js/llm-worker.mjs` — `export const MODEL = env.N_CURSOR_FIX_MODEL ?? ''`; `export const MODEL_HEAVY = env.N_CURSOR_FIX_MODEL_HEAVY ?? ''`. `npm/skills/fix/js/orchestrator.mjs` — `const { runLlmWorker, MODEL, MODEL_HEAVY } = await import('./llm-worker.mjs')`. Помилку `No API key` перехоплює функція `callPi` і повертає повідомлення з прикладами налаштування.

---

## ADR Workspace-aware витяг шляхів із violation output

## Context and Problem Statement
`_fix-check` повертає violation output де шляхи файлів позначені workspace-тегом: `[npm] skills/fix/js/llm-worker.mjs:183`. Без урахування workspace-префікса `extractFilePaths` повертала `skills/fix/js/llm-worker.mjs`, але файл фізично розташований за `npm/skills/fix/js/llm-worker.mjs` — і pi не отримував вміст файлу для виправлення.

## Considered Options
* Workspace-aware regex: `\[([\w-]+)\]\s+(path)` → `${ws}/${path}`
* Без зміни — розраховувати на збіг відносних шляхів від кореня проєкту

## Decision Outcome
Chosen option: "Workspace-aware regex", because `[npm]` у violation output — це workspace-тег, і шлях після нього є відносним до цього workspace. Тест: `node -e "...matchAll(wsRe)..."` підтвердив правильне перетворення `[npm] skills/fix/js/llm-worker.mjs` → `npm/skills/fix/js/llm-worker.mjs`.

### Consequences
* Good, because transcript фіксує очікувану користь: після виправлення GPT-5 успішно отримав вміст файлу і виправив порушення.
* Bad, because workspace-тег `[npm]` залежить від формату violation output — зміна формату зламає резолвер.

## More Information
`npm/skills/fix/js/llm-worker.mjs` — функція `extractFilePaths(output, projectRoot)` з двома regex: `wsRe` для `[ws] path/to/file.ext` і `re` для шляхів без workspace-тега. `existsSync(join(projectRoot, p))` фільтрує неіснуючі кандидати. Violation формат: `❌ [npm] skills/fix/js/llm-worker.mjs:183 — process.env.TEST_KEY`.

---

## ADR Лаконічний вивід оркестратора — деталі лише при проблемах

## Context and Problem Statement
Попередній вивід `🔄 n-cursor fix \n\n── Ітерація 1/3 ──\n✅ fix: 0/19 порушень` виглядав як обірваний результат — заголовок ітерації без фінального підсумку. Користувач повідомив: "виглядає як обрив, не дойшло до кінця".

## Considered Options
* Один підсумковий рядок при чистому репо; деталі лише коли є порушення або LLM-виклики
* Завжди показувати заголовки ітерацій

## Decision Outcome
Chosen option: "Один підсумковий рядок при чистому репо", because чистий запуск — найчастіший сценарій і не потребує деталей. При наявності порушень або LLM-ескалацій вивід розширюється: `🔄 fix: N/M порушень (rule1, rule2)` → `⚙️ T0-auto: rule1` → `⚡ LLM (pi): rule2 ✅`.

### Consequences
* Good, because transcript фіксує очікувану користь: чистий запуск тепер виводить `✅ fix: 19 правил — все чисто` — жодного сумніву що все перевірено.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/skills/fix/js/orchestrator.mjs` — функція `runOrchestratorCli`: при `failed.length === 0` на першому check виводить `✅ fix: ${total} правил — все чисто` і повертає `0`. При наявності порушень акумулює рядки `lines[]` і виводить їх після завершення ітерацій. `npm/.changes/260606-2053.md` — change-файл для цієї зміни.
