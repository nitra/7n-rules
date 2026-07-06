# Уніфікація local/cloud: вивід myllm-проксі з дефолтного шляху LLM-викликів

- Дата: 2026-07-06
- Статус: специфікація (код не змінювався)
- Репо: `@nitra/llm-lib` (cursor), `myllm`, pi-конфіг (`~/.pi/agent/models.json`)
- Prior-art: `docs/specs/2026-07-05-llm-lib-extraction-spec.md` (винос шару),
  chains (llm-lib@1.2.0, myllm вкладка «Ланцюжки»), `myllm/docs/spec-llm-efficiency.md`
  (напрям F — гігієна промптів на клієнті), `nitra/7n-test/docs/specs/2026-07-04-omlx-prompt-budget.md`
  (prompt-budget — клієнтська половина compress)

## Context

Локальні й хмарні LLM-виклики зараз **асиметричні**:

- **cloud**: `pi → провайдер` напряму. myllm у шляху нема; trace фіксує метадані; chains працюють.
- **local**: `pi → myllm-проксі (:8088) → omlx (:8000)`. pi-конфіг **захардкоджений на :8088** —
  тобто **100% локальних викликів ідуть крізь myllm**. Якщо myllm не запущений, весь локальний
  LLM-стек мертвий (single point of failure).

Chains уже забрали в проксі його головну роль: кореляція запитів у задачі тепер живе в trace
(джерело правди, бачить і local, і cloud — чого проксі принципово не міг), клієнтська атрибуція —
через `X-Chain-Cwd` без process-інтроспекції. Перевірено: **chain-аналіз НЕ читає тіла з
`requests.jsonl`** — будує промпт із trace-метаданих кроків.

У шляху проксі лишилися дві реальні функції:

1. **Компресія промптів** (`compress.rs`, 418 рядків) — захист агентних сесій від
   `prefill_memory_exceeded`. Спека efficiency: корінь OOM — на клієнті (напрям F), і клієнтська
   половина вже зроблена (`@nitra/llm-lib/prompt-budget`); compress.rs — residual-захист.
2. **Повні тіла запитів/відповідей** (`requests.jsonl`) — потрібні лише старій кнопці
   «Аналіз через pi» для одиночного запиту + дебаг-інспекції в UI.

Мета — привести local до одного механізму з cloud (`pi → бекенд` напряму), а все, що давав проксі,
перенести в клієнтський шар (llm-lib) або зробити опційним.

## Зафіксовані рішення (користувач)

1. **Обсяг:** проксі **повністю виводиться з дефолтного шляху** — pi baseUrl → omlx `:8000`
   напряму (симетрично cloud). Проксі лишається **опційним дебаг-режимом** для не-llm-lib клієнтів.
2. **Компресія:** переноситься в llm-lib як internal streamFn-mixin (той самий патерн, що
   `max-tokens`/`chain-headers`).
3. **Тіла:** opt-in body-capture у llm-lib (`~/.n-cursor/llm-bodies/`) — бонусом працює й для cloud.

## Цільова архітектура

```text
── ДО ──
local:  pi → myllm-проксі(:8088) [compress + requests.jsonl] → omlx(:8000)
cloud:  pi → провайдер напряму                                     trace(метадані)

── ПІСЛЯ ──
local:  pi → omlx(:8000) напряму  ┐
cloud:  pi → провайдер напряму     ├─ llm-lib mixin-стек: max-tokens · chain-headers ·
                                   ┘   compress(нове) · body-capture(нове, opt-in)
                                       → trace(метадані) + llm-bodies/(opt-in, повні тіла)

myllm:  UI поверх trace (вкладка «Ланцюжки») + omlx admin API (жива черга) +
        body-capture стор (single-request аналіз). Проксі = опційний дебаг для
        НЕ-llm-lib трафіку (raw curl тощо), не в дефолтному шляху.
```

Ключ: усе, що mixin-стек домішує в кожен pi-виклик, працює **однаково для local і cloud** —
це і є «один механізм».

## Частина A — llm-lib: компресія (mixin)

**Спайк (обовʼязковий перший крок):** `compress.rs` працює з raw OpenAI chat body
(`messages[].content` як string або text-parts). У pi streamFn доступний
`context.messages: Message[]` (pi-ai types.d.ts:317-319) — pi-internal форма, `content` теж
string|parts, але Message може нести tool-calls/reasoning-блоки. Спайк: зіставити pi `Message`
shape з очікуваннями compress-логіки на 2-3 реальних агентних сесіях (dump `context` у
streamFn-обгортці) → підтвердити, що truncate-middle + minify-embedded-JSON застосовні до
`context.messages` без ламання tool-calls.

**Реалізація** — `llm-lib/lib/internal/compress-context.mjs` (INTERNAL, приймає pi context;
дзеркало max-tokens.mjs). Портувати з `compress.rs`:
- константи: `PROTECTED_TAIL_MESSAGES=2`, `TRUNCATE_THRESHOLD=4000`, `TRUNCATE_HEAD=1500`,
  `TRUNCATE_TAIL=500`, `SYSTEM_TRUNCATION_SIZE_THRESHOLD=120_000`;
- `minifyEmbeddedJson(text)` (pretty→compact вбудованого JSON), `truncateMiddle(text)`
  (head+маркер+tail), захист tail-messages і system (до порогу), skip tool-calls-повідомлень
  byte-exact, skip запитів із `response_format`;
- mixin `applyCompression(session, opts?)`: обгортає `session.agent.streamFn`, стискає
  `context.messages` перед `orig(model, context, options)`. No-op без `.agent`. Enable-прапорець
  `N_LLM_COMPRESS` (дефолт on — це safety-net, вимикається лише для дебагу).

**Wiring:** усі три раннери (`one-shot`/`agent-fix`/`agent-skill`) кличуть `applyCompression`
після `applyMaxTokens` (там само, де chain-headers). Порядок mixin-стека зафіксувати в JSDoc.

**Тести:** портувати тест-кейси з `compress.rs::tests` (11 сценаріїв: minify, truncate old,
protect tail, skip tool/response_format) на pi-context-фікстури; mixin-тест дзеркало
`max-tokens.test.mjs`.

## Частина B — llm-lib: body-capture (opt-in)

`llm-lib/lib/body-capture.mjs` (internal): при `N_LLM_TRACE_BODIES=1` пише повні
prompt/response у `~/.n-cursor/llm-bodies/<chainId||caller>/<step>.json`
`{ ts, model, promptHash, messages, response, usage }`. Шлях — env-override
`N_LLM_BODIES_DIR`. Best-effort (як writeTrace, ніколи не валить виклик). Ретеншн:
size/age-cap авто-очистка (як telemetry-store).

**Ключова перевага над проксі:** тіла зʼявляються і для **cloud**-викликів (проксі бачив лише
local) — повний контекст для chain-аналізу симетрично.

Раннери: після збору response (перед фінальним trace) — `captureBodies({...})` за прапорцем.
Дефолт **off** (тіла важкі; вмикають свідомо для дебагу/аналізу).

## Частина C — pi-конфіг: flip baseUrl

`~/.pi/agent/models.json` omlx `baseUrl`: `http://127.0.0.1:8088/v1` → `http://127.0.0.1:8000/v1`
(napряму omlx). **Тільки після** приземлення Частини A (компресія-safety-net має бути на клієнті
ДО того, як прибрати проксі-компресію зі шляху — інакше важкі агентні сесії почнуть бити OOM).

Це машинно-локальна зміна (не в git-репо) — зафіксувати в README llm-lib і в
[[docgen-omlx-model-local]] як частину env-канону.

## Частина D — myllm: проксі → опційний дебаг

- **Проксі лишається** (`proxy.rs` не видаляється) — але **не в дефолтному шляху**. Запускається
  вручну для інспекції не-llm-lib трафіку (raw curl, сторонні тули, що не пишуть trace).
- `compress.rs` **лишається** для цього дебаг-проксі-режиму (не дублювання: клієнтська компресія —
  для llm-lib-шляху, проксі-компресія — для сирих клієнтів, що йдуть крізь проксі). Позначити в
  doc-коментарі, що канонічна логіка тепер у llm-lib, а тут — паритетна копія для проксі-режиму.
- **Single-request «Аналіз через pi»** (стара кнопка на записі історії): читає тіла з
  **body-capture стору** (`~/.n-cursor/llm-bodies/`) як первинне джерело; `requests.jsonl` —
  fallback лише коли проксі активний. Нова Rust-команда `read_request_bodies(chainId?, requestId?)`.
- **Жива черга/генерація** — уже з omlx admin API напряму, від проксі не залежить; працює й у
  direct-режимі (перевірити, що admin-порт omlx доступний без проксі).
- **UI-натяк:** банер «проксі не запущено — direct-режим» замість помилки, коли `requests.jsonl`
  порожній, але trace живий.

## Порядок виконання

1. **A-спайк:** dump pi `context.messages` на реальних сесіях → підтвердити застосовність
   compress-логіки. Якщо форма несумісна — ескалувати рішення (компресія на іншому pi-seam).
2. **A:** compress-mixin + тести → llm-lib minor. **Валідація safety-net:** важка агентна сесія
   `pi → omlx :8000 напряму` (тимчасовий flip) з компресією vs без — guard не спрацьовує з нею.
3. **B:** body-capture (opt-in) + тести → та сама llm-lib minor.
4. **C:** flip pi baseUrl → :8000 (машинно-локально, після publish A). Прогнати `lint --full` fix
   і 7n-test coverage у direct-режимі — нуль регресій, myllm можна не запускати.
5. **D:** myllm — single-request на body-capture стор, банер direct-режиму, doc-коментар
   compress.rs. Проксі-режим лишається робочим для дебагу.

## Ризики

| Ризик | Мітигація |
| --- | --- |
| pi `context.messages` несумісний із compress-логікою | A-спайк ПЕРШИМ; fallback — компресія на raw-body seam якщо streamFn-context не підходить |
| Важкі сесії почнуть OOM після flip без клієнт-компресії | Жорсткий порядок: A (компресія) приземляється й валідовано ДО C (flip); `N_LLM_COMPRESS` дефолт on |
| Не-llm-lib клієнти (raw curl, історичний mcp-omlx) втрачають компресію/лог | Для них лишається опційний проксі (Частина D); llm-lib-клієнти (cursor/7n-test) — покриті mixin-стеком |
| Втрата видимості сирого трафіку | Свідомо прийнято: proxy-режим доступний за потреби; llm-lib-трафік видно краще (trace+bodies, local+cloud) |
| omlx admin API недоступний без проксі | Перевірити на кроці D, що жива черга працює в direct; інакше — тонкий admin-pass-through |

## Верифікація

- llm-lib: нові тести (compress-mixin портовані з compress.rs, body-capture) + регресія раннерів
  (без opt-in — форма trace незмінна).
- E2E direct-режим: `pi baseUrl=:8000`, myllm ВИМКНЕНО → `npx @nitra/cursor lint --full` fix
  відпрацьовує, chains пишуться в trace, `n-llm-chains-report` рахує — все без проксі.
- Safety-net: агентна сесія, що раніше била `prefill_memory_exceeded` без компресії, з клієнтською
  компресією проходить напряму до omlx.
- body-capture: `N_LLM_TRACE_BODIES=1` → тіла для local І cloud кроків; myllm single-request аналіз
  читає їх без запущеного проксі.
- Проксі-режим: запущений вручну myllm-проксі досі логує сирий curl-трафік (регресії нема).
