## ADR Невідповідність порядку транспортів у n-docgen llm.mjs і ADR-0007

## Context and Problem Statement
ADR-0007 (`docs/adr/0007-docgen-transport-benchmark.md`) зафіксував рішення «C — прямий Ollama API + system-role» як основний транспорт для `n-docgen`. Бенчмарк показав, що pi без хмарного fallback додає складність без приросту якості (різниця B↔C = 1 п.п. — шум). Під час перегляду коду виявлено, що `.cursor/skills/n-docgen/src/llm.mjs` використовує pi як **primary transport**, а прямий `/api/chat` — як fallback, що є інверсією прийнятого ADR рішення.

## Considered Options
* Залишити поточний pi-first порядок (розходиться з ADR-0007)
* Переставити порядок: прямий Ollama primary, pi — fallback або видалити (відповідає ADR-0007)

## Decision Outcome
Chosen option: "прямий Ollama primary", because ADR-0007 підтверджено в сесії: pi без хмарного fallback — зайвий шар без переваги якості. Якщо cloud fallback (`claude-3.5-haiku` тощо) відсутній, pi не додає цінності й є точкою збою.

### Consequences
* Good, because усуває розбіжність між задокументованим рішенням (ADR-0007) і реалізацією.
* Good, because transcript фіксує очікувану користь: прибирається додатковий процес і залежність від `~/.pi/agent/models.json`.
* Bad, because втрачається автоматичний fallback-шлях через pi до хмарних моделей — якщо в майбутньому cloud fallback додадуть, pi-інтеграцію потрібно буде відновити вручну.

## More Information
Файл з невідповідністю: `.cursor/skills/n-docgen/src/llm.mjs` (рядки 15–42).
Прийнятий транспорт: `fetch(OLLAMA_HOST + "/api/chat", { body: { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }], stream: false } })`.
Референсне рішення: `docs/adr/0007-docgen-transport-benchmark.md` (Status: Accepted, Date: 2026-06-01).
