# @nitra/llm-lib

Тонкий шар роботи з LLM — локальні моделі (omlx на Apple Silicon) і хмарні провайдери —
поверх [pi](https://github.com/badlogic/pi-mono) (earendil-works). Дає споживачам те, що
pi свідомо лишає на caller-а: model tiers, fail-fast політику, трасування, телеметрію,
бюджети промптів. Спека: `docs/specs/2026-07-05-llm-lib-extraction-spec.md` у корені репо.

## Принципи

- **Substrate-незалежний публічний API.** Consumers не бачать pi-типів і pi-термінів:
  усі експорти приймають/повертають plain objects. pi — внутрішня деталь (`lib/internal/`),
  заміна substrate не зачіпає споживачів.
- **Fail-fast.** Жодних вбудованих retry/backoff: memory-guard rejection локального
  сервера — миттєвий crash із тілом запиту; retry-стратегія (якщо потрібна) —
  відповідальність оркестратора споживача.
- **Lazy pi.** Top-level import будь-якого модуля пакета НЕ вантажить pi SDK —
  dynamic import відбувається лише при фактичному LLM-виклику. `@earendil-works/*` —
  optional peerDependencies: споживач сам вирішує, як їх ставити.
- **Глобальна observability.** Trace (`~/.n-cursor/llm-trace.jsonl`) і telemetry-стор
  (`~/.n-cursor/telemetry/`) — крос-проєктні; джерело розрізняється полем `caller`.

## Публічний API

| Імпорт | Що дає |
| --- | --- |
| `@nitra/llm-lib/one-shot` | `runOneShot({messages, modelTier?, modelSpec?, ...})` → `{content, usage, error, model, caller}` |
| `@nitra/llm-lib/agent-fix` | `runAgentFix(ruleId, violation, cwd, opts)` → `{applied, touchedFiles, telemetry, error, rollback}`; `buildFixPrompt(...)` |
| `@nitra/llm-lib/agent-skill` | `runAgentSkill(prompt, opts)` → `{ok, telemetry, error}` |
| `@nitra/llm-lib/model-tiers` | `LOCAL_MIN…CLOUD_MAX`, `resolveModel(tier)`, `thinkingLevelForTier(tier)`, `parseModelId(spec)`, `isLocalModel(spec)` |
| `@nitra/llm-lib/chain` | `startChain({kind, unit, cwd?})` → chain handle (передається як `opts.chain` у раннери), `chain.end({outcome, extra?})`; `promptHash(text)` |
| `@nitra/llm-lib/chains-report` | `buildChainsReport(records, {sinceTs?})`, `parseTraceJsonl(text)`; CLI `n-llm-chains-report [--since ISO]` |
| `@nitra/llm-lib/write-guard` | `createWriteGuard({cwd, root, ...})`, `gitRoot(cwd)`, `NEW_FILE` |
| `@nitra/llm-lib/trace` | `writeTrace(record)`, `tracePath()` |
| `@nitra/llm-lib/telemetry-store` | `recordFixTelemetry(record)`, `signatureOf(record)`, `openCount(rule)`, `telemetryDir()` |
| `@nitra/llm-lib/with-timeout` | `withTimeout(promise, ms, {onTimeout?, label?})` |
| `@nitra/llm-lib/prompt-budget` | `budgetFor(kind)`, `fitToBudget(chunks, maxChars)`, `packBatch(items, maxChars)`, `capText(text, maxChars)` |
| `@nitra/llm-lib/body-capture` | `captureBody(record, opts?)` (opt-in, `N_LLM_TRACE_BODIES=1`), `bodiesDir()`, `bodyCaptureEnabled()` |

`lib/internal/` (registry, memory-guard, max-tokens, chain-headers, compress-context,
apply-compression) — НЕ публічний API: не імпортувати зовні пакета, subpath-експортів
на нього нема.

## Local == cloud: один транспортний механізм

Локальні (omlx) і хмарні виклики йдуть тим самим шляхом — `pi → бекенд напряму`, без
обовʼязкового проксі посередині (спека
`docs/specs/2026-07-06-proxy-retirement-unify-local-cloud.md`). Те, що раніше давав
myllm-проксі, тепер живе в клієнтському mixin-стеку раннерів (однаково для local і cloud):

- **Компресія промптів** (`internal/apply-compression.mjs` + `internal/compress-context.mjs`)
  — safety-net проти `prefill_memory_exceeded`/context-window overflow: мінізує вбудований
  JSON і обрізає старі непротектовані блоки перед відправкою. Дефолт увімкнено
  (`N_LLM_COMPRESS=0` вимикає — лише для дебагу).
- **Body-capture** (`lib/body-capture.mjs`, opt-in) — повні тіла prompt/response для
  local **і** cloud (проксі бачив лише local) у `~/.n-cursor/llm-bodies/`.

Проксі (якщо запущений) лишається опційним дебаг-інструментом для не-llm-lib трафіку
(raw curl тощо) — не в дефолтному шляху.

## Ланцюжки (chains)

Групування викликів у задачу з фінальним результатом — для аналітики escalation
local→cloud і T0-дистиляції:

```js
import { startChain } from '@nitra/llm-lib/chain'

const chain = startChain({ kind: 'fix-concern', unit: 'rule/concern', cwd })
try {
  await runOneShot({ ..., chain })      // кожен виклик = крок ланцюжка
  await runAgentFix(rule, v, cwd, { chain })
} finally {
  chain.end({ outcome: ok ? 'success' : 'fail', extra: { ... } })
}
```

Локальні виклики додатково несуть заголовки `X-Chain-Id/Step/Kind/Cwd` — проксі
myllm корелює свій request-лог із ланцюжком. **Контракт `promptHash`** (спільний
з myllm, не міняти односторонньо): `sha256(trim(content останнього user-повідомлення))`,
перші 16 hex lowercase.

## Env-контракт

Тири моделей (формат `"provider/model-id"`, pi-нотація):

```bash
N_LOCAL_MIN_MODEL / N_LOCAL_AVG_MODEL / N_LOCAL_MAX_MODEL
N_CLOUD_MIN_MODEL / N_CLOUD_AVG_MODEL / N_CLOUD_MAX_MODEL
```

Каскад `resolveModel`: `min` → LOCAL_MIN→AVG→MAX→CLOUD_MIN; `avg` → LOCAL_AVG→MAX→CLOUD_AVG;
`max` → LOCAL_MAX→CLOUD_MAX. Порожній результат = дефолт провайдера pi.

Runtime-knobs (нове імʼя має пріоритет; legacy-alias працює далі, але deprecated):

| Нове | Legacy | Дефолт |
| --- | --- | --- |
| `N_LLM_MAX_TOKENS` | `N_PI_MAX_TOKENS` | 8192 |
| `N_LLM_TRACE_PATH` | `N_CURSOR_TRACE_PATH` | `~/.n-cursor/llm-trace.jsonl` |
| `N_LLM_TELEMETRY_DIR` | `N_CURSOR_TELEMETRY_DIR` | `~/.n-cursor/telemetry` |
| `N_LLM_FIX_TURN_CEILING` | `N_CURSOR_FIX_TURN_CEILING` | 50 |
| `N_LLM_SKILL_TURN_CEILING` | `N_CURSOR_SKILL_TURN_CEILING` | 80 |
| `N_LLM_SKILL_TIMEOUT_MS` | `N_CURSOR_SKILL_TIMEOUT_MS` | 600000 |
| `N_LLM_LOCAL_PROVIDERS` | — | `omlx` (кома-список провайдерів, що вважаються локальними) |
| `N_LLM_COMPRESS` | — | увімкнено (`0` — вимикає клієнтську компресію контексту, лише для дебагу) |
| `N_LLM_TRACE_BODIES` | — | вимкнено (`1` — увімкнути body-capture повних тіл, важкі дані) |
| `N_LLM_BODIES_DIR` | — | `~/.n-cursor/llm-bodies` |
| `N_LLM_BODIES_MAX_MB` | — | `500` (ретеншн: авто-очистка найстаріших файлів понад ліміт) |

Моделі/ключі провайдерів конфігуруються у pi: `~/.pi/agent/models.json` + `auth.json`
(omlx — як custom OpenAI-compatible provider).

## Приклад

```js
import { runOneShot } from '@nitra/llm-lib/one-shot'

const { content, error } = await runOneShot({
  messages: [{ role: 'user', content: 'Класифікуй слово: "kubectl"' }],
  modelTier: 'min', // локальна, з каскадом у cloud
  caller: 'my-tool:classify'
})
```
