---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T09:45:56+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

Коміт успішно прийнято. Тепер формую ADR-документацію для цієї сесії.

## ADR Підключення pi до Ollama через `~/.pi/agent/models.json` (OpenAI-сумісний ендпойнт)

## Context and Problem Statement
pi не має вбудованого провайдера `ollama` (перевірено: `pi --list-models ollama` — «No models matching»). Ollama підтримує OpenAI-сумісний ендпойнт на `:11434/v1`, що дозволяє підключити його через механізм кастомних провайдерів pi.

## Considered Options
* Кастомний провайдер через `~/.pi/agent/models.json` з `api: "openai-completions"` та `baseUrl: "http://localhost:11434/v1"`
* Зміна глобального `defaultProvider`/`defaultModel` у `~/.pi/agent/settings.json`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Кастомний провайдер через `~/.pi/agent/models.json`", because це дозволяє звертатися до Ollama через `--provider ollama --model <name>` без зміни глобального pi-default (`gpt-5.5` для інтерактивного кодингу залишається незмінним).

### Consequences
* Good, because transcript фіксує очікувану користь: `pi --list-models gemma` показує `ollama gemma3:4b 128K`, пробний виклик повертає «Так.», глобальний pi-дефолт для coding-задач не зачеплений.
* Bad, because `pi --provider ollama` без явного `--model` бере глобальний default (`gpt-5.5`), а не першу ollama-модель — тобто «неявного дефолту» для ollama не існує; потрібен явний `--model` на кожен виклик.

## More Information
Конфіг: `~/.pi/agent/models.json`, поля `api: "openai-completions"`, `baseUrl: "http://localhost:11434/v1"`, `apiKey: "ollama"`, `compat.supportsDeveloperRole: false`. Схема полів знайдена в `@earendil-works/pi-coding-agent/dist/core/model-registry.js` (ProviderConfig). Документація кастомних провайдерів: `$PKG/docs/models.md`. Canonical alias gemma4 створено: `ollama cp batiai/gemma4-e4b:q4 gemma4:4b`.

---

## ADR Секційно-мінімальний контекст для JS-оркестрованого docgen-конвеєра

## Context and Problem Statement
Наївна оркестрація (повний код файлу передається в кожну з 4 секційних LLM-підзадач) виявилася у 3–4× повільнішою за one-shot (overlay: 310 с проти 57 с), бо ollama повторно інгестує весь код при кожному stateless `/api/chat`-запиті, а на 8 GB M2 це викликає частковий swap. Shared-prefix KV-cache між незалежними запитами не спрацьовує надійно.

## Considered Options
* Секційно-мінімальний контекст: код — тільки в секцію «Поведінка»; інші секції отримують лише крихітний факт-лист (exports, markers, заборонені символи)
* Персистентна RPC-сесія pi (`pi --mode rpc`): спільний `system+код` завантажується один раз, секції шляхом накопичення turns
* Один спільний system-промпт зі всім кодом + 4 послідовних user-turns у stateless-викликах
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Секційно-мінімальний контекст", because це усуває повторний інгест коду без залежності від KV-cache або персистентної сесії. RPC-сесія відкинута: накопичення контексту між незалежними секціями шкідливе (файл 3 тягне за собою матеріал файлів 1–2), і виміряний прогін RPC показав 144–296 с через контенцію пам'яті на 8 GB.

### Consequences
* Good, because transcript фіксує очікувану користь: час orchestrated впав до рівня one-shot (firebase 22 с vs 20 с, k8s 25 с vs 35 с), якість gemma3:4b виросла з ~80% до ~89% завдяки заземленню на факт-листі без роздутого кодового контексту в кожній секції.
* Bad, because gemma4:4b (`batiai/gemma4-e4b:q4`) несумісна з цим підходом: повертає порожній рядок `""` для секцій без вихідного коду в контексті — перевірено як із `system+user`-split, так і зі злитим single-user-message. Для gemma4:4b залишається тільки one-shot.

## More Information
Реалізація: `npm/skills/docgen/js/docgen-prompts.mjs` (функція `sectionMessages`) — код передається тільки в запит секції `behavior`; `docgen-gen.mjs` — Stage 2 детермінований зріз сигнатур (regex прибирає `(arg, …)`) та бан внутрішніх символів з факт-листа. Commit: `17cfca32` у гілці `feat/docgen-orchestrator-pi`.

---

## ADR Детермінований Stage 0 екстрактор як джерело фактів (0 токенів LLM)

## Context and Problem Statement
Локальні моделі (gemma3:4b) стабільно протікали деталями реалізації в документацію: назви stdlib-функцій (`fs.promises`, `path`), regex-паттерни, приватні ідентифікатори (`yamlCache`, `readAndParseYamlDocs`), повні сигнатури функцій. Негативні інструкції в промпті («не згадуй stdlib») лише частково стримували витік — модель ігнорувала їх у 30–40% випадків.

## Considered Options
* Детермінований JS-екстрактор (`docgen-extract.mjs`): exports + JSDoc, imports (stdlib/npm/internal), поведінкові маркери, список заборонених символів — все без LLM
* Чисто промпт-інжиніринг (більш суворі негативні обмеження в промпті)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Детермінований JS-екстрактор", because факти, відомі зі статичного аналізу коду (імена, класифікація залежностей, маркери), не повинні делегуватися моделі — вона їх або придумує, або пропускає. Екстрактор виносить ці факти з-під LLM і передає їх у секційні промпти як готові дані.

### Consequences
* Good, because transcript фіксує очікувану користь: після впровадження екстрактора зникли витоки `yamlCache`/`deploymentCache` з «Гарантій», API-секція отримала точні назви функцій з JSDoc без вигаданих сигнатур; Stage 2 детермінований зріз дорізає залишкові `(arg)` у «Поведінці».
* Bad, because transcript не містить підтверджених негативних наслідків. Обмеження: екстрактор адаптований до JS/MJS-файлів з JSDoc; для `.vue`/`.py` потрібні окремі парсери або деградація до one-shot без факт-листа.

## More Information
Реалізація: `npm/skills/docgen/js/docgen-extract.mjs`. Витягує: `header` (провідний `/** */`-блок), `exports` (ім'я + JSDoc-опис кожного), `imports` (класифіковані за `BUILTIN_MODULES`), `markers` (`readOnly`, `catchesErrors`, `writes`, `caches`, `skips`), `internalSymbols` (ідентифікатори з internal-імпортів — забороняються в «Поведінці» через `facts.internalSymbols`). Worktree: `.worktrees/feat-docgen-orchestrator-pi`, commit `17cfca32`.
