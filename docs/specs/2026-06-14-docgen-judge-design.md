# Docgen LLM-judge (семантичний verdict-гейт) — дизайн-спека

Дата: 2026-06-14
Власник: @vitaliytv
Статус: **Implemented ✅** (2026-06-15) — `docgen-judge.mjs` + інтеграція в `generateDoc`; авто-активація за наявності `N_CLOUD_MIN_MODEL`, scope `inaccurate`, без cloud-моделі OFF, 9 тестів. Передісторія: Q4 + маркова правка дали FP-rate `scoreDoc` **92.3% → 46.2%** («фабрикація > мовчання»); judge закриває залишковий семантичний хвіст. Деталі в «Результати виміру».

## Результати виміру (Q4) — 2026-06-14

Інструмент: `npm/rules/doc-files/js/docgen-judge-measure.mjs` (генерація `omlx/gemma-4-e4b-it-OptiQ-4bit`, суддя `openai-codex/gpt-5.4-mini`, поріг 70). Корпус: 13 файлів `~/www/nitra/ai/run/gt/src/github/*.js`.

**Результат: 13/13 доків отримали `score=100` (PASS), але суддя визнав 12/13 `inaccurate` → FP-rate `scoreDoc` = 92.3% (inaccurate=92.3%, generic=0%).**

- Сильно вище порогу «>15% → будувати». `generic`=0% підтверджує: якщо гейт — то **тільки `inaccurate`**, R4/E2 для generic достатньо.

**Першопричина (поглиблений аналіз 2026-06-14) — НЕ галюцинації LLM, а детермінований шар.** Секція «Гарантії поведінки» генерується детерміновано (`guaranteesFromMarkers(facts)`, E3 — 0 LLM). Брешуть **самі `facts.markers`** через надто вузькі regex'и в `docgen-extract.mjs`, а LLM-«Огляд» їх лише **echo-їть**:
  - `NETWORK_RE = /\bfetch\(|https?\.|axios|got\(/` — **не ловить** `graphQLClient.request`/`.request(`/GraphQL/DB/RPC-клієнти → `network:false` для файлів, що реально ходять у мережу (перевірено: comment.js, sources.js роблять `graphQLClient.request`) → E3 емітить хибне «Не звертається до мережі», Огляд повторює.
  - `FALSY_RETURN_RE = /return\s+(false|null|''|"")/` — мітить **будь-який** `return null`, навіть на нормальному шляху (dev-link повертає `null` для непідтримуваного типу, не на помилці) → `returnsFalsyOnFail:true` → over-claim «fail-safe, повертає `false`/`null`/`Err`» (перевірено: python/sql/vue-chunker).
  - Окремо — **малий хвіст чистих LLM-галюцинацій в Огляді**: allowlist.js «без allowlist → доступ заборонено», код `return true`. Це НЕ з маркерів — суто вигадка моделі (док навіть сам собі суперечить: Огляд ≠ Поведінка).

**Висновок — пріоритети (за доктриною `programmatic-checks-for-llm.md`):**

1. **Полагодити екстрактор маркерів (0 токенів, найбільший ROI, бере левову частку 92%).** Розширити `NETWORK_RE` (graphql/`.request(`/octokit/db/rpc-клієнти; або інвертувати — список «мережевих» імпортів); звузити `FALSY_RETURN_RE` до falsy-return **усередині catch/error-гілки**. Це виправляє детермінований *джерело* брехні — і Гарантії, і echo в Огляді.
2. **Прибрати LLM-echo гарантій.** Заборонити «Огляд»/«Поведінці» повторювати behavioral-гарантії (read-only/мережа/обробка помилок) — вони належать ЛИШЕ детермінованій секції «Гарантії». Тоді брехня (якщо є) живе в одному місці, що фікситься на рівні маркерів.
3. **`inaccurate`-judge-гейт (цей spec) — лише на незводимий хвіст** чистих LLM-галюцинацій (allowlist-стиль), що лишиться після (1)+(2). Спершу **переміряти FP-rate після (1)+(2)** — можливо, хвіст падає нижче порогу «будувати», і гейт не потрібен.

Тобто judge підтвердив цінність насамперед **як discovery-tool**: він виявив, що значна частина «галюцинацій» — це баг детермінованого екстрактора маркерів. «Гарантії» прибирати НЕ треба (вони — єдине auditable місце цих claim'ів); треба полагодити маркери, що їх живлять.

### Переміряння після фіксу (1) — 2026-06-14

Внесено фікс маркерів (`docgen-extract.mjs`): розширено `NETWORK_RE` (graphql/`.request(`/octokit/db/rpc), `FALSY_RETURN_RE` звужено до falsy-return усередині `catch`. Перегенеровано той самий корпус 13 файлів і переміряно.

**FP-rate: 92.3% → 76.9%** (accurate 1→3, inaccurate 12→10). Фікс реальний, але **скромний** — і це сам по собі результат: маркери ≠ вся проблема. Класифікація 10 залишкових:

- **Гарантії over-assert (7-8/10)** — `readonly`/`fail-safe`/`no-network`/`falsy` стверджуються, коли код суперечить: `comment.js` read-only, але робить GraphQL-мутації (`readOnly` дивиться лише ФС-запис, не БД); `client.js`/`dev-link`/`dependency-extractor` «fail-safe, без винятків», а код `throw`-ить; `dev-link` «повертає false/null/Err», а тільки `null` (wording over-claim).
- **Транзитивна мережа (2/10)** — `sources.js`/`cli-sources.js` мережать ЧЕРЕЗ локальні хелпери (`client.js`) → file-local regex принципово сліпий.
- **Over-detection (1/10)** — `commits.js`: маркер тепер `network:true`, а функція — no-op.
- **Чиста LLM + варіативність** — `vue-chunker` (плутає `if` з API); `allowlist`/`chunker-utils` **флапали** між прогонами (4B недетермінований → вимір має шум ±).

**ГОЛОВНИЙ ВИСНОВОК (переглянутий):** домінантна причина — не конкретні два regex'и, а **сама секція «Гарантії» дефолтить на ствердження** (`assume X unless proven`), і коли евристика хибна — народжується небезпечна гарантія. Рішення — застосувати до ВСІХ маркерів той принцип, який у коді вже є для кешу: **«фабрикація > мовчання» → стверджувати гарантію ЛИШЕ за high-confidence, інакше ОПУСКАТИ**:
- `network`: казати «без мережі» лише якщо взагалі нема зовнішніх викликів/імпортів; інакше — мовчати (не «звертається»/«не звертається»).
- `readOnly`: лише якщо нема ні ФС-запису, ні DB-мутацій (`insert/update/delete/mutation`), ні зовнішніх клієнтів.
- `fail-safe`/`falsy`: лише якщо є catch→return-falsy І НЕМА `throw` назовні.

Це 0-токенне, доктрина-консистентне, і прибрало б ~7-8/10 залишкових. Транзитивну мережу — окремо (import-propagation: якщо імпорт із сиблінга, чий маркер `network:true`). А **чистий LLM-хвіст + варіативність 4B** (vue-chunker, флапи) — це й є незводима частина під `inaccurate`-judge.

### Переміряння після фіксу (2) — «фабрикація > мовчання» — 2026-06-14

Переписано маркери на принцип «опускай, якщо не впевнений» (`docgen-extract.mjs` + `guaranteesFromMarkers` + LLM-hint `factsSummary`): `readOnly` лише якщо нема ні ФС-запису, ні DB-мутацій (`MUTATION_RE`); `catchesErrors`/`returnsFalsyOnFail` лише якщо нема `throw` назовні (`THROW_RE`); **прибрано негативні/дефолтні гарантії** («Не звертається до мережі», determinism-фолбек, read-only «ні») і з Гарантій, і з LLM-hint. М'якше формулювання falsy (без «false/null/Err»).

**FP-rate: 92.3% → 76.9% → 46.2%** (accurate 1→3→**7**, inaccurate 12→10→6, усі 13 згенеровано). Маркова правка — найбільший важіль; «фабрикація > мовчання» прибрала майже весь детермінований шар брехні (comment/cli-sources/commits/sources/sql-chunker → accurate).

**Залишкові 6 — інша природа (семантичний хвіст):**
- **Чисті LLM-галюцинації в наративних секціях (4/6)** — 4B перебріхує деталі коду: `dev-link` (поля результату), `parse-url` (каже «integer-check», код — `Number.isFinite`), `vue-chunker` (вигаданий API-символ `if`), `client` (неіснуюче читання `res.json`). **File-local детермінізм це не ловить у принципі.**
- **Гарантія на межі + варіативність (2/6)** — `allowlist` read-only правдивий, але суддя вимагає позитивного доказу (+ файл флапав accurate↔inaccurate між раундами — шум 4B); `dependency-extractor` fail-safe over-generalized.

**ФІНАЛЬНЕ РІШЕННЯ:**
1. ✅ **Маркова правка (зроблено)** — 92→46%. Найбільший ROI, 0 токенів. Можна ще трохи (read-only вимагати позитивних ознак), але віддача спадна й упирається в шум 4B.
2. **`inaccurate`-judge-гейт (цей spec) — виправданий**: 46% ≫ 15%, і залишок тепер — **саме семантичні наративні галюцинації**, які детермінізм не бере. Scope строго `inaccurate`, модель хмарна, гейтити смугою. Це домен, де judge незамінний (на відміну від маркового шару, який ми вже прибрали детерміновано).
3. **Транзитивна мережа** (sources/cli-sources) — у цьому раунді вже accurate (бо прибрали хибне «no network» — тепер просто мовчимо); якщо знадобиться позитивне твердження — окремий import-propagation, не блокер.

Тобто суддя підтвердив повний цикл доктрини: **discovery (judge) → codify deterministically (markers) → re-measure → judge лише на незводимий семантичний хвіст.** Вимір 4B має шум ±~10% (флапи), тож числа трактувати як порядок, не точність.

## Мета

Додати **опціональний LLM-judge** як другий, *семантичний* гейт якості у `generateDoc` (`npm/rules/doc-files/js/docgen-gen.mjs`), що доповнює існуючий детермінований `scoreDoc`. Judge ловить те, чого структурно-лексичний скорер ловити не може: **семантичні галюцинації** (твердження, що суперечать джерелу) і **generic-прозу, яку не покриває regex-блоклист `GENERIC_RES`**. Реалізація — реюзом готового патерну `coverage-classify` (verdict-схема + кешований LLM-виклик з каскадом local→cloud), без зовнішніх агент-харнесів.

## Передісторія

`generateDoc` уже має багатошаровий контроль якості (усе локальне, 0 хмари в дефолті):

1. **`orchestratedDoc`** — генерація секція-за-секцією + **`critiqueRefineSection` (E2)** — критик тим самим локальним моделем каже, що generic, потім refine.
2. **`scoreDoc` (Stage 2.5, детермінований, 0 токенів)** — 7 правил: `no-overview` (−25), **R4 `generic-overview`** через `GENERIC_RES` (−35), `short-behavior` (−20), `cache-hallucination` (−20), R6 `internalSymbolPenalty`, **R5 `anchorMissPenalty`** (кожен валідний анкор — дослівний підрядок src — має бути в доці), R7 `surzhik` (−10).
3. **`best-of-2` (E4)** — retry з temp 0.5, det-вибір кращого.
4. `degraded: score < threshold` — далі рішення приймає batch/користувач.

Окремо в пакеті вже існує **виробничий LLM-judge-патерн** — `npm/scripts/coverage-classify/`:
- `prompt.mjs` — `SYSTEM_PROMPT` (кешований) + `buildUserPrompt(ctx)`;
- `verdict-schema.mjs` — Zod `VerdictSchema` + `parseVerdict(rawText)`;
- `index.mjs` — `classifyOne` з каскадом `resolveModel('min') → CLOUD_MIN → FALLBACK_VERDICT`, виклик через `pi -p --no-session --mode text --no-tools`;
- `cache.mjs` — `deriveBlobHash`/`deriveCacheKey`/`readCache`/`writeCache`;
- `apply.mjs` — `isAllowedGap(verdict, threshold)` (confidence-гейт).

Спека переносить саме цей патерн на docgen.

## Проблема (де нинішній гейт сліпий)

`scoreDoc` — структурно-лексичний + один захардкоджений семантичний чек:

- **Галюцинації поза `cache`.** `cache-hallucination` — єдиний захардкоджений regex. Будь-яке інше хибне твердження про поведінку (напр. «валідує X», коли код цього не робить) проходить зі score=100. R5 (anchors) перевіряє лише, що в доці **присутні** підрядки джерела — не що **твердження істинні**.
- **Generic-проза поза `GENERIC_RES`.** R4 — regex-блоклист відомих фраз; коментар у коді прямо визнає «парафрази, які обходять exact-blocklist». Це arms-race: кожну нову generic-форму треба додавати regex'ом.
- **E2-critique судить тим самим слабким локальним моделем**, що й генерує → на 4B самокритика ненадійна (модель «не бачить» власних generic-фраз).

Judge генералізує (1) і (2) одним викликом замість нескінченного дописування regex'ів, і виносить судження **окремою (сильнішою/хмарною) моделлю**, а не самокритикою.

## Scope

**In:**

- Новий модуль `npm/rules/doc-files/js/docgen-judge.mjs` (verdict-схема + prompt + кешований виклик).
- Точка інтеграції у `generateDoc` — **після** `best-of-2`, **перед** поверненням, за фіче-флагом.
- Реюз `coverage-classify` (схема/prompt/cache patterns) — не дублювати інфраструктуру кешу.
- Env-контракт і розширення return-об'єкта `generateDoc`.
- Юніт-тести + bench проти `bench/etalon/`.

**Out:**

- Заміна `scoreDoc` (лишається дешевим першим проходом — judge його **доповнює**, не замінює).
- Хмарна escalation як дефолт (judge за флагом; дефолт docgen лишається локальним).
- Інтеграція MiMoCode / зовнішніх агент-харнесів (відхилено — див. «Альтернативи»).
- Judge для `unsupported`-структур (там `score=null`, скорер не застосовний).
- Зміна `critiqueRefineSection` (E2) — ортогонально.

## Дизайн

### Потік (після змін)

```
extractFacts → orchestratedDoc (+E2 critique-refine) → scoreDoc (det, 7 правил)
  → best-of-2 (E4)
  → [НОВЕ] judgeGate(doc, src, facts, detScore):
        умова запуску: N_CLOUD_MIN_MODEL задано  І  score ≥ threshold
        → judge(src, doc) → verdict {verdict, confidence, reason}
        → якщо verdict ∈ {generic, inaccurate} і confidence ≥ JUDGE_THRESHOLD:
             позначити degraded=true, issues += `judge:<verdict>`
             (опційно: ще один best-of retry перед фінальним degraded)
  → return { md, score, judge?, degraded, ... }
```

### Чому «підозріла смуга», а не кожен файл

LLM-виклик на КОЖЕН файл уб'є батч. Judge запускати лише там, де він додає сигнал:

- **score ≥ threshold** (det-скорер каже «ок») — саме тут ховаються false-positives (структурно повне, семантично погане). Це головна ціль.
- Не чіпати **score сильно < threshold** — уже `degraded`, judge нічого не змінить.
- Тобто смуга: `threshold ≤ score < threshold + JUDGE_BAND` (напр. band=15) **АБО** `score ≥ threshold` залежно від політики (див. Open Questions Q1).

### Verdict-схема (`docgen-judge.mjs`, дзеркало `verdict-schema.mjs`)

```js
import { z } from 'zod'
export const DocVerdictSchema = z.object({
  verdict: z.enum(['accurate', 'generic', 'inaccurate']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(20).max(500),
  // опційно: конкретні рядки-порушники для логів/refine
  offending: z.array(z.string().max(200)).max(5).optional()
})
export function parseDocVerdict(rawText) { /* як parseVerdict: indexOf('{')..lastIndexOf('}') + parse */ }
```

- `accurate` — опис специфічний і відповідає джерелу → пропустити.
- `generic` — вода/бойлерплейт, обходить `GENERIC_RES` → degraded.
- `inaccurate` — твердження суперечать джерелу (галюцинація) → degraded (пріоритетний кейс).

### Prompt

- `SYSTEM_PROMPT` (статичний, кешований через `cache_control: ephemeral` як у coverage-classify): «Ти рецензент технічної документації. На вхід — джерельний код і згенерована дока. Класифікуй: accurate / generic / inaccurate. inaccurate — будь-яке твердження, не підтверджене кодом. generic — опис, що підходить до будь-якого файлу. Поверни лише JSON …».
- `buildUserPrompt(src, doc, facts)` — джерело (з лімітом рядків, як `TEST_FILE_MAX_LINES`) + згенерована дока + (опційно) `facts.exports`/anchors для звірки.

### Backend / каскад (дзеркало `classifyOne`)

```
judge: resolveModel('avg')  →  CLOUD_MIN  →  FALLBACK_VERDICT { verdict:'accurate', confidence:0 }
```

- **Не локальна `min` (4B).** Для судді точність важливіша за швидкість; беремо `avg`/хмарну. FALLBACK = `accurate` (fail-open: judge ніколи не блокує пайплайн, лише може зловити погане).
- Виклик через той самий `pi -p --no-session --mode text --no-tools` (узгоджено з coverage-classify), timeout 60с.

### Кеш

Реюз `cache.mjs`: ключ = `deriveCacheKey(filePath, { docHash })` де `docHash` — хеш згенерованої доки (verdict валідний доки дока не змінилась). Уникає повторних judge-викликів на стабільних файлах у батчі/повторних прогонах.

## Контракт

### Env

| Змінна | Дефолт | Призначення |
|---|---|---|
| `N_CLOUD_MIN_MODEL` | (порожньо) | **модель судді ТА авто-активація**: задано → гейт увімкнено (без нього — OFF, 0 змін) |
| `N_CURSOR_DOCGEN_JUDGE_THRESHOLD` | `0.7` | min confidence verdict'а `inaccurate`, щоб позначити degraded |

### `generateDoc` return (дельта)

Додати опційне поле — не ламати наявних споживачів:

```js
judge: { verdict, confidence, reason } | null   // null якщо judge не запускався
```

`degraded` стає `score < threshold || (judge && judge.verdict !== 'accurate' && judge.confidence >= JUDGE_THRESHOLD)`.
`issues` доповнюється кодом `judge:generic` / `judge:inaccurate`.

## Тести

- `docgen-judge.test.mjs`: `parseDocVerdict` (валід/невалід JSON, schema-fail), каскад (mock callPi: tier1 throws → tier2 → fallback), кеш-hit/miss.
- `generateDoc`: judge OFF (дефолт) → return без поля `judge`, поведінка незмінна; judge ON + mock verdict `inaccurate` → `degraded:true`, `issues` містить `judge:inaccurate`.
- **Bench** проти `npm/rules/doc-files/js/bench/etalon/`: порахувати, скільки доків зі `score ≥ threshold` judge позначає `generic`/`inaccurate` (= спіймані false-positives det-скорера) і чи нема false-negatives на еталонних (мають лишатись `accurate`).

## Метрики успіху

- **Precision гейта:** на еталонах judge НЕ перекваліфіковує good-доки в degraded (target: 0 на curated etalon).
- **Доданий recall:** ≥ N доків зі `score ≥ threshold`, що насправді generic/inaccurate, тепер ловляться (вимір на реальному батчі docgen).
- **Вартість:** +1 LLM-виклик лише на «підозрілу смугу» (не весь батч); сумарний приріст часу батча ≤ X% (узгодити).

## Ризики і пом'якшення

- **Латентність/вартість.** → Гейтити смугою + кеш по docHash + fail-open fallback. Дефолт OFF.
- **Ненадійність судді.** Слабка модель судитиме погано. → `avg`/cloud, не `min`; structured-output + `parseDocVerdict` валідація; confidence-поріг.
- **Подвійний рахунок із R4/E2.** Judge і `GENERIC_RES`/critique частково перетинаються. → Judge запускати ПІСЛЯ них; він — генералізація, що ловить **залишок**, який regex/самокритика пропустили. Моніторити, чи judge стабільно дублює R4 (тоді band звузити).
- **Arms-race інверсія.** Якщо judge ловить новий generic-патерн часто — кодифікувати його у `GENERIC_RES` (дешевий regex) і лишити judge для рідкісного хвоста. Judge = детектор для майбутніх детермінованих правил.

## Альтернативи (відхилені)

- **Інтегрувати MiMoCode/agent-харнес замість прямих викликів.** Відхилено: інвертує детерміновану архітектуру (loop у коді, модель — примітив), не embeddable (бінарник, SDK залитий порожнім), важчий за прямий виклик, і програв pi у локальному бенчі (give-up #578, SSE-таймаут, memory wall на 16 ГБ). Усі його фічі (`/goal` judge, Max Mode, Dynamic Workflow) уже мають аналоги тут (judge-гейт, best-of-2, JS-оркестрація).
- **Розширювати лише `GENERIC_RES`/хардкоджені regex.** Не масштабується на семантичні галюцинації; нескінченний arms-race на парафрази.
- **Покладатись на E2 self-critique.** Той самий слабкий локальний модель; ненадійна самооцінка на 4B.

## Open Questions

- **Q1.** Смуга запуску: тільки `score ≥ threshold` (ловити false-positives) чи й `[threshold, threshold+band)` (рятувати майже-прохідні)? → визначити після bench.
- **Q2.** При `inaccurate` — одразу `degraded`, чи спершу ще один best-of retry із `judge.reason`/`offending` як підказкою критику (E2-refine, керований judge)? Останнє дорожче, але може врятувати без хмари.
- **Q3.** Чи виносити judge у спільний `npm/lib/llm-judge.mjs` (узагальнити coverage-classify + docgen-judge під один verdict-каркас), щоб не дублювати каскад/кеш?
