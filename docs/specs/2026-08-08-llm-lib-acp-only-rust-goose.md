# llm-lib: ACP-only Rust, goose як четвертий ACP-kind — повна відмова від pi-coding-agent і JS-фасаду

**Дата:** 2026-08-08
**Статус:** погоджено — готово до реалізації
**Зв'язані документи:** [реєстр відкладених питань](../plans/2026-08-05-open-questions-register.md) (§3.5 — цією специфікацією **скасовується** вердикт «лишається в JS назавжди» для LLM-орієнтованих поверхонь), [план міграції v2](2026-07-30-rules-v2-rust-core-migration.md)

## 1. Проблема / Мета

Після зрізів 1–7 Rust-міграції LLM-контур лишався останнім споживачем npm-екосистеми:
`@7n/llm-lib` (JS) ганяє агентний цикл через SDK `@earendil-works/pi-ai` /
`@earendil-works/pi-coding-agent` (динамічні `import()` у `one-shot.mjs`, `agent-fix.mjs`,
`agent-skill.mjs`, `internal/registry.mjs`), а Rust-крейт `llm-lib` доступний JS-споживачам
через napi FFI. Мета — 100% Rust заради уніфікації: єдина модель взаємодії з LLM — **ACP
(Agent Client Protocol)**, без pi-coding-agent, без napi, без JS-фасаду.

Обмеження: зберегти обидва класи бекендів — підписочні CLI (`cursor`/`codex`/`pi`) **і**
omlx локальні + API-ключові хмарні моделі; не писати власний агентний цикл, якщо є готовий.

## 2. Ухвалені рішення

| # | Питання | Рішення |
|---|---|---|
| А | Міжмовна межа | **ACP only**: жодного napi/JS-фасаду; `llm-lib-napi` видаляється. Будь-який зовнішній споживач — тільки ACP через stdio |
| Б | Модель сесії/івентів (session-core) | **Типи `agent-client-protocol`** — не власна модель. Зовнішнє підтвердження: goose зробив той самий вибір (`goose-sdk-types` залежить лише від `agent-client-protocol`) |
| В | Агентний цикл для omlx/API-ключових | **Goose як зовнішній ACP-агент (режим B)**: четвертий kind у наявному ACP-клієнті поруч із `cursor`/`codex`/`pi` — один двигун сесій на всі бекенди. Розглянуті альтернативи: build-цикл поверх genai; compose (rig / swiftide-agents); embedded goose core (режим A — технічно підтверджений тестом, див. §3.4, лишається тригер-апгрейдом). Вирішальний аргумент за B — вимога batch-емуляції через ACP (§3.6): пул ACP-сесій мусить існувати для підписочних користувачів у будь-якому разі, і він же задарма обслуговує goose для API-ключових — embed стає третім зайвим двигуном. genai відхилено лише як основу агентного циклу: для неагентних one-shot викликів (клас 1, §3.7) він лишається цільовим шляхом |
| Г | Підписочні CLI | Без змін: наявний `llm_lib::acp` (ACP-клієнт на `agent-client-protocol` 1.2) для `cursor`/`codex`/`pi` |
| Д | Batch-контур (doc-files: claims, entailment, gap-mappings) | **Capability-резолвер із двох рівнів** (§3.6): native OpenAI-сумісний Batch API → ACP-емуляція пулом one-shot сесій (підписочні CLI **і** omlx через goose-kind). Окремого local-concurrent шляху немає — `batch.rs` не лишається, його пул-ідеї переїжджають у реалізацію емуляції. Викликач бекенда не знає |
| Е | JS-споживачі `@7n/llm-lib` | **Жорстка міграція разом з контуром, без перехідного моста**: кожен споживач портується в Rust разом зі своєю командою; тимчасового ACP-stdio моста для JS немає |
| Ж | §3.5 реєстру («в JS назавжди») | **Скасовано**: `adr-normalize-local` і `docs build` більше не «назавжди в JS» — їхні контури мігрують у Rust |
| З | Тир-мапа для goose-kind | **Наявний env-контракт `N_*_MODEL`** — жодних нових ключів: резолвер `tiers.rs` лишається єдиним джерелом, `llm-lib` розкладає значення (префікс провайдера + модель) у `OPENAI_HOST`/`OPENAI_API_KEY`/model при спавні goose; семантика «лише сильніші, спочатку local, потім cloud» зберігається |
| И | Розмір пулу K ACP-емуляції | **Адаптивний**: старт з K=1–2, ramp-up доки немає помилок/деградації латентності, backoff на 429/відмовах — у межах верхнього кепа per-kind (страховка від rate-лімітів підписочних акаунтів до першого backoff-сигналу). Фасилітатор рекомендував статичні per-kind пресети; користувач обрав адаптивний |
| К | Capability-детекція batch-профілю | **Імпліцитно з наявних ключів + явний override**: є хмарний ключ (`N_CLOUD_*_MODEL` + API-key провайдера) → native; інакше → ACP-емуляція через сконфігурований kind. Єдиний новий ключ — опційний `N_BATCH_BACKEND=native\|acp` для примусового вибору/дебагу |
| Л | Версіонування `@7n/llm-lib` | **Feature-freeze одразу** (лише фікси); видалення JS-поверхні мігрованого контуру — major-релізом із deprecation-нотисом у CHANGELOG; фінал — `npm deprecate` пакета після останнього споживача |

## 3. Деталі реалізації

### 3.1. Цільова структура крейтів

```
llm-lib/crates/
  llm-lib             — доменний шар: tiers, trace/telemetry, prompt-budget,
                        write-guard політики; session/event = типи agent-client-protocol
    ├─ acp/           — ЄДИНИЙ двигун сесій до зовнішніх ACP-агентів:
    │                   cursor | codex | pi | goose ← один код, чотири kind-и;
    │                   тут же пул сесій для batch-емуляції (§3.6)
    └─ batch/         — batch-фасад із capability-резолвером (§3.6);
                        native-шлях на reqwest (вже є: remote_batch.rs); batch.rs
                        виводиться — його пул-логіка вливається в ACP-емуляцію
  llm-lib-napi        — ВИДАЛЯЄТЬСЯ разом з останнім JS-споживачем
```

Окремого модуля агентного циклу немає: агентність — це завжди ACP-сесія до зовнішнього
агента. Фізичний спліт на окремі крейти — відкладено до появи першого споживача, якому
потрібна лише частина; зараз — модулі одного крейта.

### 3.2. Goose як четвертий ACP-kind: контур підключення

- Goose спавниться як ACP-агент через stdio (goose має власний ACP-сервер — `goose-acp`),
  тим самим `llm_lib::acp`-кодом, що й `cursor`/`codex`/`pi`; додається лише
  `AcpAgentKind::Goose` з пресетом спавну.
- Провізіонінг: goose-бінар стає провізіонованим тулом на машинах і в CI (пін версії,
  установка — та сама історія, що §4.1 реєстру для інших тулів).
- Провайдер для omlx усередині goose: `openai` (env `OPENAI_HOST`/`OPENAI_API_KEY` →
  `N_OMLX_API_KEY`, host з конфіга omlx) або declarative JSON-конфіг провайдера.
- Тир-резолвінг (`min`/`avg`/`max`): мапа тир → (provider, model, host) у `llm-lib`,
  передається goose через env/config при спавні — симетрично наявним пресетам інших kind-ів.
- Write-guard / deny-fragments: перехоплення `session/request_permission` — механізм уже
  реалізований в ACP-шляху, працює для goose без змін.
- Tool-и: MCP-розширення конфігуруються на боці goose; політика дозволів — на нашому боці
  через permission-перехоплення.

### 3.3. Інвентаризація JS-споживачів для жорсткої міграції

Кожен рядок мігрує «разом з контуром» — команда переїжджає в Rust, її LLM-виклики
переходять на шлях свого класу (§3.7): genai / batch-фасад (клас 1), зовнішні
ACP-kind-и включно з goose (клас 2) або власний цикл на rig-agent (клас 3):

| JS-поверхня | Контур | Клас (§3.7) | Цільовий шлях |
|---|---|---|---|
| `one-shot.mjs` | разові структуровані виклики | 1 | genai напряму — completions без tool-ів |
| `agent-fix.mjs` (+ write-guard, anchored-edit, coverage fix-хуки) | LLM-ladder лінт-фіксів | 3 | **власний цикл на rig-agent** (§3.7) — єдиний контур, де зовнішній агент не дає потрібних гарантій |
| `agent-skill.mjs` | скіл-раннер (skills-cli, taze, git-reconcile) | 2 | стандартні ACP-kind-и (goose/codex/cursor/pi) |
| `batch.mjs` / `chain.mjs` | doc-files/claims/entailment, coverage classify, adr-normalize | 1 | batch-фасад §3.6 (native → ACP-емуляція) |
| `internal/registry.mjs` (pi ModelRegistry) | резолвінг моделей | — | тир-мапа `llm-lib` (§3.2) |
| `adr-normalize-local` (925-рядковий конвеєр) | ADR-нормалізація | 1 | порт конвеєра в Rust, LLM-ходи через batch-фасад; retrieval лексичний (Jaccard), ембедингів немає — rig-core для retrieval не потрібен |
| `docs build [--publish]` | doc-files генерація | 1 | порт на batch-фасад §3.6 |
| `acp.mjs` (JS-обгортка napi) | ACP-виклики з JS | — | зникає разом з napi |
| `harness.mjs`, `web-tools.mjs`, `coverage/lib/llm.mjs` (`callText`/`callAgent`) | публічні експорти без in-repo споживачів | — | не портуються: вивід/deprecate при міграції відповідного контуру (`harness`-профіль `{kind:'fix'}` — основа контракту §3.7) |

Порядок: спершу контури на неагентному шляху (batch — Rust-код готовий), потім
agent-fix/agent-skill (goose loop), останніми — adr-normalize і docs build (найбільші
конвеєри). `peerDependencies` на `@earendil-works/*` знімаються з `llm-lib/package.json`
в останньому зрізі; npm-пакет `@7n/llm-lib` deprecated після міграції останнього споживача.

### 3.4. Виконаний технічний тест embed-режиму A (2026-08-08) — страховий варіант

Режим A (embedded goose core) перевірений практично і **працює вже сьогодні** — лишається
задокументованим апгрейд-шляхом, якщо зʼявиться причина (наприклад, спавн-вартість CLI
стане вузьким місцем контуру). Scratch-проєкт: git-pin `goose v1.45.0`, повний embed-цикл
проти mock OpenAI-сумісного сервера (canned SSE + non-stream відповіді):

1. `Agent::new()` + `session_manager.create_session(...)` — **OK** (session management ззовні);
2. `create_with_named_model("openai", …)` з `OPENAI_HOST` на mock + `update_provider` — **OK**;
3. `agent.reply(...)` → стрім `AgentEvent::Message` з canned-текстом — **OK**, exit 0;
   mock зафіксував model-discovery (`GET /v1/models`) і `POST /v1/chat/completions`.

Виміряна ціна embed: git-база goose ≈ 449 МБ у `~/.cargo/git/db`, чиста збірка dev-профілю
≈ 4м48с, git-пін без semver (ядра на crates.io немає — імʼя зайняте, опубліковані лише
`0.1.0-alpha.x` частини). Саме ця ціна плюс аргумент §3.6 і схилили вибір до режиму B.

### 3.5. Ризики і страховка

- **Поведінка goose контролюється конфігом, не кодом**: зовнішній агент оновлюється
  окремо від нас. Страховка — пін версії бінаря у провізіонінгу + рішення Б: контракт
  споживачів виражений ACP-типами, тож перемикання на embed (режим A, §3.4) — локальна
  заміна бекенда без зміни контракту. Тригер перегляду: стабільні crates.io-релізи
  goose-sdk із session-level API.
- **Спавн-вартість CLI на сесію**: для агентних задач — копійки на тлі LLM-ходів; для
  batch-емуляції компенсується пулом переживаючих сесій (§3.6).
- **Провізіонінг goose** на машинах розробників і в CI — новий тул у контурі §4.1 реєстру.
- **Escape-hatch «власний агент на rig» — перший споживач визначений**: інвентаризація
  2026-08-08 (§3.7) довела кодом, що контур `fix` (agent-fix + write-guard + anchored-edit
  + verify-петля + coverage fix-хуки) вимагає гарантій, які зовнішній агент не дає
  принципово. Для решти контурів escape-hatch лишається закритим (YAGNI). Власний цикл
  на `rig-agent` експонується пʼятим kind-ом за тим самим контрактом ACP-типів.

### 3.6. Batch-фасад: capability-резолвер

Вимога: doc-files (та інші batch-контури) працюють у користувачів з будь-яким профілем
доступу до LLM. Фасад `batch::run(Vec<PromptJob>) → Vec<Result<Output>>`; викликач
бекенда не знає. Резолюція за конфігом/env — два рівні:

1. **native** — користувач має OpenAI-сумісний Batch API (ключ + endpoint):
   справжні async-джоби `/v1/batches` (`remote_batch.rs`, уже в Rust) — дешевше
   (провайдерські знижки) і без утримання зʼєднань;
2. **ACP-емуляція** — все інше, включно з omlx: пул із K одночасних one-shot
   ACP-сесій будь-якого kind-а (підписочні cursor | codex | pi, або goose-kind,
   наведений на omlx чи API-ключового провайдера) з чергою, ретраями і backoff.
   Семантичні відмінності від native (немає 24-год async-вікна і знижок) ховаються
   за фасадом — для doc-files неважливі, він і сьогодні працює конкурентними викликами.

Окремого local-concurrent рівня немає: прямий HTTP-пул `batch.rs` виводиться, його
напрацювання (конкурентність, черга, ретраї) переносяться в реалізацію пулу емуляції.
Пул ACP-сесій — той самий механізм, що обслуговує агентні контури; це і є вирішальний
аргумент рішення В: він потрібен безумовно, тож embed-цикл був би зайвим двигуном
поруч із ним і native-шляхом.

### 3.7. Класи LLM-контурів (інвентаризація 2026-08-08)

Повна інвентаризація всіх LLM-точок репо (чотири паралельні розвідки: llm-lib поверхні,
LLM-ladder фіксів, doc-files конвеєри, adr-normalize + решта) дала три класи:

**Клас 1 — агентність не потрібна → batch-фасад (§3.6) / genai one-shot.**
doc-files (обидва конвеєри: per-file docgen і package_knowledge), adr-normalize
(batch-хвилі з self-consistency голосуванням, лексичний Jaccard-retrieval без
ембедингів), coverage classify (structured mutation-judge з дисковим кешем),
cspell-fix, capture-decisions. Усе — stateless completions, стан/ID/побічні ефекти
тримає JS-оркестрація (при порті — Rust). Головний виграш нового транспорту для
цього класу — native structured output (`response_format` замість «схеми в промпті»),
що зніме частину ladder-ретраїв за invalid-json-shape.

**Клас 2 — стандартна агентність → зовнішні ACP-kind-и.**
agent-skill-сімейство: skills-cli, taze, git-reconcile. User-trust сесії з повним
toolset-ом (включно з bash) — рівно семантика зовнішніх coding-агентів. Особливі
вимоги (turn-ceiling+abort, deny-command-fragments, bounded min→max із JS-валідацією
між викликами) виражаються на ACP-межі; deny-fragments уже реалізований у
`llm_lib::acp::session` для підписочних CLI.

**Клас 3 — власний цикл на rig-agent → рівно один контур: `fix`.**
Внутрішній цикл agent-fix вимагає гарантій, недосяжних для зовнішнього агента:

- порожній allowlist tool-ів замість deny (жодного bash); anchored-профіль
  **вилучає** builtin read/edit і замінює власним анкерним протоколом (атомарна
  валідація до застосування, нуль fuzzy-match);
- синхронне перехоплення кожного write-tool-виклику: veto + pre-image до запису +
  повний editLog `oldText→newText` — живить дистиляційний маховик (успішний
  LLM-фікс → корпус → детермінований T0-патерн), якого в чужому агенті немає;
- verify-петля з інжекцією canonical-перевірки в ту саму сесію в межах спільного
  бюджету рунга (&lt;5с — чесна зупинка; інфраструктурні помилки не палять ітерації);
- streamFn-перехоплення кожного виклику (chain-headers, context-compression,
  maxTokens per-call), склейка system+user в один prompt для слабких локальних
  моделей, синтез помилки зі `stopReason='error'`, turn-ceiling з abort;
- доменні верифікатори між ходами (eslint-worker: AST-гард tagged-templates,
  пул per-file сесій з deadline-fraction).

Сюди ж — agentic fix-хуки coverage-провайдерів (`fixSurvived`/`generateTests`/
`generateStories`): та сама механіка через слот `coverage.provider@1`.
Серіалізовний профіль `harness.mjs` `{kind:'fix', tier, timeoutMs, verifyMax,
anchoredEdits, …}` — готовий контракт для Rust-реалізації цього циклу.

Зовнішній harness навколо циклу (ladder 4 рунгів, snapshot/rollback per rung,
collateral-veto cross-file + hunk-window, test-gate) — детермінована оркестрація
поза LLM; вона портується в Rust незалежно від вибору двигуна циклу.

## Відкриті питання

Немає — усі питання сесії закриті рішеннями А–Л (сесія 2026-08-08, ітеративний раунд
по чотирьох відкритих пунктах: З, И, К, Л). Нові питання, що виникнуть при імплементації,
фіксувати в [реєстрі відкладених питань](../plans/2026-08-05-open-questions-register.md).
