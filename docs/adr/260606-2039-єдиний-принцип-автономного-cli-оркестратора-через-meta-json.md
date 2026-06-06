---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-06T20:39:08+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

Based on this session transcript, I'll generate the ADR documentation for the key design decisions.

---

## ADR Єдиний принцип автономного CLI-оркестратора через `meta.json`

## Context and Problem Statement
Кожен `@nitra/cursor` скіл (`fix`, `lint`, `taze`, `docgen`) мав власну ad-hoc логіку запуску, різне представлення у SKILL.md і не гарантував автономного convergence-loop без участі агента-LLM. Потрібен єдиний declarative механізм, щоб визначити які скіли є оркестраторами, а які — ні.

## Considered Options
* Поле `"orchestrator": true` у `meta.json` кожного скіла
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Поле `"orchestrator": true` у `meta.json`", because це єдина декларативна мітка, яку Claude і зовнішні інструменти можуть читати для визначення можливостей скіла; зміна однієї ознаки дає змогу переналаштовувати скіли один за одним і звіряти результат без переписування CLI.

### Consequences
* Good, because `meta.json` стає єдиним source-of-truth: скіл є оркестратором тоді й лише тоді, коли там стоїть прапорець — без магічних угод про іменування чи структуру директорій.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/skills/fix/meta.json` → `{ "auto": "завжди", "worktree": true, "orchestrator": true }`. Наступні скіли на черзі: `docgen`, `taze`, `lint` (застосовувати послідовно та звіряти результат).

---

## ADR Публічний CLI-інтерфейс `fix` як оркестратор; `_fix-check` як внутрішня команда

## Context and Problem Statement
`n-cursor fix --json` був одночасно публічним API і внутрішнім механізмом перевірки. Це плутало межі відповідальності: `fix --json` в документації виглядав як призначена для користувача команда, тоді як фактично він потрібен лише оркестратору і `t0.mjs`.

## Considered Options
* Прибрати `fix --json` з публічного API; замінити на внутрішню команду `_fix-check` (underscore = private)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прибрати `fix --json`; ввести `_fix-check`", because `npx @nitra/cursor fix` тепер завжди запускає повний convergence-loop (оркестратор), а внутрішній check викликається лише як subprocess оркестратора і `t0.mjs` через `_fix-check`.

### Consequences
* Good, because публічний інтерфейс став простим: `fix [rules] [--max-iter N]` без прихованих флагів.
* Bad, because `_fix-check` — недокументована деталь; будь-який зовнішній скрипт, що покладався на `fix --json`, зламається без попередження.

## More Information
`npm/bin/n-cursor.js`: `case 'fix'` → завжди `runOrchestratorCli`; `case '_fix-check'` → `runFixCommand(args, { json: true })`. `npm/skills/fix/js/t0.mjs` оновлено: `[N_CURSOR_BIN, 'fix', '--json', ...ruleFilter]` → `[N_CURSOR_BIN, '_fix-check', ...ruleFilter]`.

---

## ADR C1-паттерн для LLM-tier: script збирає контекст → pi → script застосовує

## Context and Problem Statement
Попередній `llm-worker.mjs` використовував Anthropic SDK з tool-use (read_file / write_file / run_command), що вимагало захардкодженого `ANTHROPIC_API_KEY` і прив'язки до конкретного провайдера. Потрібен підхід, де кожен користувач налаштовує власні ключі доступу і немає залежності від конкретного SDK.

## Considered Options
* C1-паттерн: script детерміністично витягує контекст (rule `.mdc` + файли з violation output) → викликає `pi -p "..." --no-session --mode text --no-tools` → парсить JSON-відповідь → записує файли
* Tool-use через Anthropic SDK (попередня реалізація)

## Decision Outcome
Chosen option: "C1-паттерн через `pi`", because `pi` є provider-агностичним шаром — кожен користувач налаштовує власний ключ (`ANTHROPIC_API_KEY`, ChatGPT Plus, Ollama тощо) без змін у коді оркестратора.

### Consequences
* Good, because transcript фіксує очікувану користь: GPT-5 через pi успішно виправив `process.env.TEST_KEY` → `env.TEST_KEY` у повному e2e тесті.
* Bad, because C1 потребує попередньої екстракції всіх релевантних файлів скриптом; якщо violation output не дає повних шляхів — LLM не отримає контекст (що і сталося до фіксу workspace-aware regex).

## More Information
`npm/skills/fix/js/llm-worker.mjs`: `MODEL_HAIKU = env.N_CURSOR_FIX_MODEL_HAIKU ?? ''` (порожній рядок = не передавати `--model`, pi обирає дефолт — GPT-5 через subscription). `callPi`: `const modelArgs = model ? ['--model', model] : []`. Workspace-aware `extractFilePaths`: `[npm] skills/foo.mjs` → `npm/skills/foo.mjs` через regex `\[([\w-]+)\]\s+(path)`.

---

## ADR Pi model routing: без `--model` для subscription-based провайдерів

## Context and Problem Statement
При виклику `pi --model gpt-5.3-codex-spark` виникав `No API key found for azure-openai-responses` — pi v0.78.0 маршрутизує всі явні назви моделей через Azure endpoint, а не через OAuth-підписку. Credentials у `~/.pi/agent/auth.json` (ключ `openai-codex`) не підходять для azure-маршруту.

## Considered Options
* Не передавати `--model` flag, якщо model = `''` → pi використовує subscription default (GPT-5)
* Передавати конкретну назву моделі через `--model`
* Налаштовувати `ANTHROPIC_API_KEY` у середовищі

## Decision Outcome
Chosen option: "Не передавати `--model` при порожньому значенні", because підтверджено в transcript: `pi -p '...' --no-session --mode text --no-tools` без `--model` → відповідає GPT-5 через openai-codex OAuth subscription без помилок. З будь-яким явним `--model <name>` → `azure-openai-responses` помилка.

### Consequences
* Good, because transcript фіксує очікувану користь: e2e LLM-tier пройшов — GPT-5 виправив violation за ітерацію 1.
* Bad, because без явної назви моделі неможливо гарантувати конкретну версію — pi обиратиме дефолт відповідно до свого стану.

## More Information
`npm/skills/fix/js/llm-worker.mjs`: `function callPi(prompt, model) { const modelArgs = model ? ['--model', model] : [] ... }`. Env vars: `N_CURSOR_FIX_MODEL_HAIKU`, `N_CURSOR_FIX_MODEL_SONNET` для override. Заборона: `gemma4:4b` не використовувати без явного дозволу — inference >120s → ETIMEDOUT.
