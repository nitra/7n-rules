---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T07:21:11+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

## ADR resolveModel() каскад як єдина точка вибору моделі

## Context and Problem Statement
Шість глобальних tier-констант (`N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`) використовувались напряму в різних файлах без прозорого fallback: якщо локальна змінна не встановлена, споживач отримував порожній рядок. Потрібно щоб система прозоро каскадувала до наступного доступного tier.

## Considered Options
* Пряме звернення до констант (існуючий підхід)
* `resolveModel(tier)` helper з каскадним fallback у `npm/lib/models.mjs`

## Decision Outcome
Chosen option: "`resolveModel(tier)` helper з каскадним fallback", because контракт каскаду потрібно зафіксувати в одному місці, а не дублювати логіку по всіх споживачах.

Каскад:
- `resolveModel('min')` → `LOCAL_MIN` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_MIN`
- `resolveModel('avg')` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_AVG`
- `resolveModel('max')` → `LOCAL_MAX` → `CLOUD_MAX`

### Consequences
* Good, because всі споживачі автоматично отримують першу доступну модель без додаткового умовного коду.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Функція додана в `npm/lib/models.mjs`. Пряме використання констант замінено в: `npm/scripts/coverage-classify/index.mjs` (Tier 1 cache key), `npm/skills/fix/js/llm-worker.mjs` (`MODEL`, `MODEL_HEAVY`), `npm/scripts/coverage-fix.mjs`, `npm/scripts/dispatcher/lib/subagent-runner.mjs`.

---

## ADR docgen Tier 1 — пряме ollama HTTP як основний шлях

## Context and Problem Statement
Проводився експеримент: замінити пряме HTTP до `localhost:11434/api/chat` на виклики через `pi` CLI для уніфікованого провайдер-нейтрального інтерфейсу. Порівнювались три реалізації на 10 парних файлах (Round 1 benchmark).

## Considered Options
* OLD: ollama HTTP orchestrated (прямий `fetch` до `localhost:11434/api/chat`, окремий запит на кожну секцію)
* pi one-shot (один виклик `pi` для всього документа)
* pi orchestrated (один виклик `pi` на кожну секцію; `spawnSync`)

## Decision Outcome
Chosen option: "OLD: ollama HTTP orchestrated", because pi orchestrated вдвічі повільніший при однаковій загальній якості, а pi one-shot значно гірший за якістю.

Дані Round 1 benchmark (10 парних файлів, `N_LOCAL_MIN_MODEL=ollama/gemma3:4b`):

| | OLD | pi orchestrated |
|---|---|---|
| avg ms | **68 106** | 135 446 (×2.0) |
| avg score | **94.0** | 94.0 |
| sym=1 avg score | **95** | 75 (−20, cache-hallucination) |
| sym=2 avg score | 87.5 | **97.5** (+10) |

pi one-shot (часткові дані): score 65–75, критична проблема `no-overview`.

### Consequences
* Good, because вдвічі швидший за pi orchestrated при тій самій загальній якості 94.0.
* Bad, because прив'язка до `localhost` ollama HTTP — не universally portable без checkOllama() fallback.

## More Information
OLD-версія: `npm/skills/docgen/js/docgen-gen.mjs` (HEAD). NEW pi orchestrated: `/tmp/docgen-gen-new.mjs`. Результати: `/tmp/docgen-bench-results.tsv`, скрипт `/tmp/docgen-bench.sh`. Виявлений побічний ефект: `withTimeout` у OLD-версії тримає Node.js event loop живим ~5 хвилин після завершення генерації через pending `setTimeout` у `Promise.race`.

---

## ADR docgen fallback — checkOllama() + pi orchestrated коли ollama недоступна

## Context and Problem Statement
Docgen має запускатися автономно в середовищах без локального ollama (CI без GPU, розробники без встановленого ollama). Потрібна стратегія деградації без зміни основного шляху.

## Considered Options
* Тільки ollama HTTP (поточний стан — падає якщо ECONNREFUSED)
* Тільки pi (повільно, без переваг прямого ollama)
* checkOllama() → ollama HTTP якщо доступно, pi orchestrated якщо ні

## Decision Outcome
Chosen option: "checkOllama() + pi orchestrated fallback", because це зберігає швидкий ollama-шлях для локальної розробки і K8s з GPU, але автоматично деградує до pi для CI і середовищ без GPU без жодних змін у виклику.

Запропонована реалізація (не реалізована в цій сесії):
```js
async function checkOllama() {
try {
const r = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) })
return r.ok
} catch { return false }
}
// generateDoc: const useOllama = localModelId() && await checkOllama()
```

### Consequences
* Good, because transcript фіксує очікувану користь: нульова зміна коду для K8s — достатньо env var `OLLAMA_HOST`; для CI без GPU pi fallback активується автоматично.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Рішення обговорено, але не реалізоване в цій сесії. Fallback-модель для pi: `N_CLOUD_MIN_MODEL` (наприклад Haiku). `OLLAMA_HOST` пропонується внести в контракт моделей поруч з tier-константами у `npm/lib/models.mjs`.

---

## ADR K8s LLM inference — kubeai з OllamaEngine

## Context and Problem Statement
Для автономного запуску docgen у K8s (де `localhost:11434` відсутній) потрібен inference backend. Порівнювались kubeai та vllm як основні кандидати для обслуговування моделі gemma3:4b.

## Considered Options
* kubeai (K8s operator, `InferenceModel` CRD, Ollama-сумісний API через `OllamaEngine`)
* vllm (OpenAI-сумісний API, Deployment вручну, потребує KEDA для автоскейлінгу)
* Ollama як звичайний K8s Deployment (без оператора)

## Decision Outcome
Chosen option: "kubeai з OllamaEngine", because надає Ollama-сумісний API (`/api/chat`, `/api/generate`) → нульова зміна у `docgen-gen.mjs`; підтримує scale-to-zero (критично для batch job з низьким навантаженням); vllm є overkill для 4b-моделі з низьким concurrency і потребує зміни API-контракту.

### Consequences
* Good, because transcript фіксує очікувану користь: "нульова зміна в коді, просто env var `OLLAMA_HOST=http://gemma3-4b.kubeai.svc:80`".
* Bad, because transcript зазначає: kubeai молодший проєкт (2024); scale-to-zero cold-start ~60–120s (прийнятно для batch, але не для real-time).

## More Information
Обговорення відбулось у цій сесії, рішення не реалізоване. Приклад `InferenceModel` CR наведено в transcript: `url: ollama://gemma3:4b`, `engine: OllamaEngine`, `minReplicas: 0`, `maxReplicas: 2`. Якщо kubeai недоступний (checkOllama() → false) — автоматично активується pi fallback до `N_CLOUD_MIN_MODEL`.
