# Package-level knowledge documentation для AS-IS → TO-BE змін

**Дата:** 2026-07-29
**Статус:** погоджено — готово до реалізації
**Зв'язані документи:** `.cursor/rules/n-doc-files.mdc`,
`docs/specs/2026-07-27-batch-local-avg-real-batches.md`,
`docs/specs/2026-07-18-lang-plugins-extraction-spec.md`,
`docs/adr/260719-2155-doc-files-гібрид-коментарі-плюс-llm-і-vue-sfc-екстрактор.md`

## 1. Проблема / Мета

Поточний `doc-files` вважає одиницею документації source-файл: зміна файла
інвалідовує сусідній Markdown за CRC, а генератор намагається стисло переказати
поведінку цього файла. Навіть наявний unit digest для великих JS/Vue/Rust-файлів
лишається одним запитом на один файл. Така модель має чотири системні обмеження:

1. Бізнес-процес майже завжди проходить через кілька файлів, private units,
   persistence, integrations і tests, тому пофайлові описи не складаються у
   цілісний AS-IS.
2. Великий або слабко прокоментований файл потрапляє в LLM повністю; на
   повільному LOCAL AVG/llm-d це дає timeout, хоча AST уже містить структурні
   межі для дроблення.
3. Файлова структура визначає структуру документації, хоча читачеві та
   AI-agent потрібні capabilities, processes, business rules і architecture
   responsibilities.
4. Немає формальної різниці між тим, що code реально реалізує, тим, що
   очікується від системи, і підтвердженою розбіжністю між ними.

Головний споживач нової документації — AI coding agent. Людина читатиме її
рідше, але має без code archaeology зрозуміти, що package робить, для чого він
існує та як працюють його бізнесові й архітектурні процеси. Implementation
details лишаються у code.

Основний сценарій:

1. агент отримує самодостатній fragment `Implemented AS-IS`;
2. користувач додає опис `TO-BE`;
3. агент через structured traceability знаходить affected files, symbols,
   tests, contracts і configs;
4. агент змінює implementation та верифікує новий процес.

Одиниця documentation domain — один package/crate/module. У monorepo кожен
domain має власний комплект документації та не розгортає implementation інших
workspace packages.

## 2. Ухвалені рішення

| # | Питання | Рішення |
|---|---|---|
| А | Одиниця документації | **Package/crate/module, не source-файл.** Source-файл лишається evidence node, change trigger і складовою fingerprint |
| Б | Канонічна модель | **Layered Package Knowledge Graph.** Markdown та machine manifest — projections однієї structured моделі |
| В | Джерела істини | Code є truth для `Implemented AS-IS`; explicit expectations є truth для `Expected`; жоден шар не перезаписує інший |
| Г | Поява gaps | Gap виникає тільки для explicit expectation, зіставленого з implemented claim. Відсутність expectation не є gap |
| Д | Структура документів | **Hybrid topic discovery:** стабільні `index`/manifest і автоматично знайдені capability/process/architecture topics |
| Е | Детальність | Повна модель для автоматично визначених business-critical flows; допоміжні technical capabilities стискаються. За невпевненості обирається повний опис |
| Є | Приватна implementation | Враховується як evidence для суттєвої поведінки, але private symbol names не потрапляють у людський Markdown |
| Ж | Межа graph | Тільки поточний documentation domain. Workspace/registry/vendor dependencies представлені opaque contracts без тіл |
| З | Великі graphs | AST-based semantic chunks + ієрархічний reduce із 100% required coverage, без обрізання хвоста за token budget |
| И | Мовні parsers | JS/TS — OXC; Vue — `compiler-sfc` + OXC/template AST; Rust/Python/PHP — повні parsers. Regex/brace scanner не є production source семантики |
| І | Parser failure | **Fail-closed:** parser error, unsupported syntax або неповний graph блокують publication; whole-file fallback не використовується |
| Ї | Human-authored текст | `MANUAL`-зони зберігаються дослівно. Explicit `EXPECTED`-зони також захищені, але додатково формують expectation claims |
| Й | CI4 | CI4 еволюціонує від ADR-only projections до layered evidence. `Rebuild Test` замінюється на `Changeability Test + Gap Test` |
| К | Сумісність | Поточний `n-doc-files`/`lint doc-files` зберігається як тимчасовий alias; перехід відбувається фазовано без автоматичного видалення legacy docs |

## 3. Терміни та scoped source of truth

### 3.1. Implemented AS-IS

Фактично реалізована поведінка domain, виведена з:

- source AST і symbol/import/call graph;
- routes, commands, events, scheduled jobs та інших entry points;
- state mutations, persistence й external integration calls;
- schemas/configs/contracts;
- виконуваних tests як scenario/effect evidence.

Code є єдиним джерелом істини для твердження «реалізовано зараз». LLM не має
права замінити code-derived claim текстом ADR, spec або manual section.

### 3.2. Expected

Явно очікувана поведінка, що поступово накопичується з:

- protected `EXPECTED`-зон;
- accepted ADR та їхніх `## Update YYYY-MM-DD`;
- formal specs;
- executable test assertions.

Passing test одночасно підтверджує implemented behavior і expected contract.
Failing test може утворити expectation gap. Skipped/disabled test сам по собі не
формує expectation, якщо його не підтверджує spec/ADR/`EXPECTED`.

### 3.3. Manual context

Текст у `MANUAL`-зонах пояснює business context і зберігається дослівно, але
не створює gap автоматично. Якщо manual claim доказово суперечить graph,
validator повертає окрему blocking-проблему `manual-conflict`: автор має або
оновити текст, або перенести його в `EXPECTED`, зробивши розбіжність явною.

### 3.4. Implementation gap

Результат порівняння зіставних expected та implemented claims:

| Status | Семантика |
|---|---|
| `satisfied` | expectation має підтверджену implementation |
| `missing` | expectation існує, але відповідної implementation немає |
| `diverged` | implementation суперечить expectation |
| `unresolved` | evidence недостатньо для безпечного зіставлення |

`unresolved` не перетворюється на `missing`/`diverged` через LLM-припущення.
Відсутність expectation не створює запис у gap model.

## 4. Архітектура

```text
domain manifests + source + tests + specs + ADR + protected sections
                              │
                              ▼
                    language parser adapters
                              │
                              ▼
                  normalized semantic source graph
                              │
             deterministic evidence extraction
                              │
                              ▼
              structured LLM claims with evidence refs
                              │
                              ▼
                  layered package knowledge graph
                    implemented │ expected
                              │
                   gap engine + topic discovery
                              │
                              ▼
          Markdown views + traceability manifest + diagrams
                              │
                    deterministic validators
                              │
                         atomic publish
```

AST/chunking є внутрішнім механізмом побудови knowledge graph. Chunk не є
документом, topic або одиницею freshness.

## 5. Documentation domain

### 5.1. Виявлення root

Domain root визначає language plugin:

- JS/TS — package із `package.json`;
- Rust — crate із `Cargo.toml`;
- Python — package/module boundary із `pyproject.toml`;
- PHP — package із `composer.json`.

Nested workspace package є окремим domain. Parent-domain не розгортає його
source graph навіть тоді, коли import резолвиться локальним workspace link.

Language plugins надають versioned slots:

- `knowledge.domain@1` — root signals, source roots, exclusions, manifest і
  boundary resolution;
- `knowledge.extractor@1` — extensions, parser adapter, semantic units та
  language-specific edges.

Поточні `doc-files.extensions@1` і `doc-files.extractor@1` підтримуються під час
міграції; їхні first-party implementations переходять у knowledge slots.

### 5.2. Domain identity

`domainId` виводиться з ecosystem + canonical package/crate/module name.
Filesystem path не входить до identity. Переміщення package в monorepo не має
створювати нову документацію за незмінного manifest identity.

Collision однакових canonical names у repo є blocking diagnostic і потребує
окремого namespace-рішення, а не path-based silent fallback.

## 6. Knowledge graph schema

Публічна schema versioned незалежно від package SemVer:

```js
{
  schemaVersion: 1,
  domain: {
    id,
    ecosystem,
    name,
    rootManifest,
    sourceFingerprint
  },
  nodes: SemanticNode[],
  edges: SemanticEdge[],
  claims: KnowledgeClaim[],
  topics: Topic[],
  gaps: Gap[],
  evidence: EvidenceRef[]
}
```

### 6.1. SemanticNode

```js
{
  id,                    // stable, parser-derived
  kind,                  // capability | process | actor | rule | decision |
                         // state | outcome | component | integration |
                         // persistence | config | code-unit | test-scenario
  name,
  visibility,
  domainId,
  attributes,
  sourceFingerprint
}
```

### 6.2. SemanticEdge

Canonical edge kinds:

```text
contains, triggers, invokes, validates, decides, transitions,
reads, mutates, persists, emits, consumes, integrates,
implements, verifies, expects, recovers, produces
```

Кожен edge має provenance. LLM-derived edge без evidence не приймається.

### 6.3. KnowledgeClaim

```js
{
  id,
  subjectId,
  layer: 'implemented' | 'expected',
  predicate,
  value,
  evidenceIds,
  confidence,
  sourceFingerprint
}
```

`confidence` не замінює coverage gate. Низька confidence на business-critical
claim дає `unresolved`, а не публікацію м’якого припущення.

### 6.4. EvidenceRef

```js
{
  id,
  kind: 'code' | 'test' | 'spec' | 'adr' | 'manual' |
        'schema' | 'config' | 'trace',
  path,
  symbolId,
  span,
  contentHash
}
```

Людський Markdown не показує private `symbolId`; traceability manifest може
його містити.

## 7. Stable identifiers

1. Code-unit ID базується на domain ID + language-qualified symbol path.
2. Process seed ID базується на stable entry point, state/outcome anchors і
   integration boundary, а не на LLM-generated title.
3. Topic title може змінюватися без зміни topic ID.
4. Rename detection зіставляє old/new nodes за semantic signature,
   implementation hash similarity та graph neighborhood.
5. Topic зі збереженим primary anchor і достатнім overlap зберігає ID.
6. Ambiguous split/merge не виконується мовчки: engine генерує migration plan.
7. Manifest зберігає aliases/redirects для старих topic IDs.

LLM не генерує canonical IDs.

## 8. Автоматичний topic discovery

### 8.1. Seeds

Discovery починається з:

- public functions/classes/commands;
- HTTP/RPC/GraphQL handlers;
- queue/event producers і consumers;
- scheduled jobs;
- externally visible state transitions;
- tests/spec scenarios з domain outcomes.

### 8.2. Розгортання graph

Для кожного seed engine:

1. проходить reachable units у межах domain;
2. згортає recursive SCC;
3. додає state, persistence, integration та error-flow edges;
4. зберігає external dependencies як opaque contract nodes;
5. групує paths зі спільними actors, state/outcome та business rules.

### 8.3. Criticality

Criticality повністю автоматична. Feature vector містить:

- externally reachable entry point;
- persistence/state mutation;
- external side effect;
- authorization/security boundary;
- кількість distinct outcomes і alternative/error flows;
- test/spec scenario density;
- graph blast radius;
- domain-entity significance, підтверджену evidence.

Graph centrality сама по собі не визначає business criticality. За недостатньої
confidence topic отримує повну, а не скорочену документацію.

### 8.4. Типи topics

- `process` — trigger → activities/decisions → state/effects → outcome;
- `capability` — група пов’язаних processes із єдиною business purpose;
- `architecture` — responsibility/boundary, що реалізує capabilities;
- `contract` — зовнішній API/event/schema/config contract.

LLM може формулювати title і narrative лише після deterministic clustering.

## 9. Semantic chunking і hierarchical reduce

### 9.1. Parser policy

- JS/TS/JSX/TSX: чинний OXC AST.
- Vue: `compiler-sfc`; script/script-setup через OXC, template через Vue AST;
  styles не аналізуються як behavior.
- Rust: чинний brace/regex unit scanner не допускається як production parser.
  Перша implementation phase проводить conformance benchmark повного parser-а
  (`syn` adapter або Tree-sitter) й фіксує переможця до увімкнення Rust domain.
- Python/PHP: повний parser із spans та explicit error nodes; exact dependency
  обирається conformance benchmark-ом до увімкнення відповідної мови.

Benchmark є implementation task, а не можливістю залишити regex fallback.

### 9.2. Chunk planner

1. Межа chunk проходить лише між semantic units або control-flow regions.
2. Units із близькими graph edges пакуються разом до token budget.
3. Signature, docs, actor/state/outcome context повторюються для дочірніх
   chunks великого unit.
4. Leaf summaries будуються першими; callers отримують dependency summaries.
5. Cycles обробляються fixed-point refinement для SCC.
6. Кожен map-result повертає strict JSON claims + evidence IDs.
7. Hierarchical reduce не завершується, поки coverage ledger не покриває всі
   required nodes/edges.
8. Final Markdown synthesis не отримує весь source: тільки verified knowledge
   model відповідного topic.

### 9.3. Batch і model ladder

Chunks одного analysis wave є незалежними batch items. Tier ladder
застосовується per failed/unresolved chunk, а не перегенеровує весь domain.
Успішний result кешується за parser/prompt/schema/model-policy/content hash.

Publication не залежить від того, чи виконався batch справжнім server-side API,
емуляцією або послідовно: результат має пройти однаковий validator.

## 10. Output contract

Кожен domain має:

```text
docs/
├── index.md
├── explanation/
│   ├── architecture.md
│   ├── capabilities/
│   │   └── <stable-topic-id>.md
│   └── processes/
│       └── <stable-topic-id>.md
├── reference/
│   ├── contracts/
│   └── glossary.md
├── implementation-gaps.md
├── adr/
└── .docgen/
    └── manifest.json
```

Не створюються порожні `capabilities`, `processes` або `contracts` pages.
`index.md` і `manifest.json` обов’язкові. `architecture.md` створюється, коли
domain має більше одного responsibility/component або зовнішню boundary.

### 10.1. Process fragment

Business-critical process містить:

1. purpose;
2. actors і trigger;
3. preconditions;
4. main flow;
5. alternative/error flows;
6. business rules;
7. state transitions і side effects;
8. outcomes;
9. architecture responsibilities;
10. Expected behavior, якщо вона вже описана;
11. локальні Implementation gaps.

Fragment самодостатній для RAG і AS-IS/TO-BE prompt: не використовує «вище»,
«попередній компонент» або інші контекстно залежні посилання.

### 10.2. Human та generated zones

Підтримуються три типи:

- `AUTOGEN` — generated projection; hash захищає від ручної зміни;
- `MANUAL` — protected narrative context, не створює expectation;
- `EXPECTED` — protected expectation source зі stable ID.

`MERGED` у першій версії заборонений. Generated текст не редагує protected
zones. Topic split/merge без однозначного перенесення protected zone блокується.

### 10.3. Traceability manifest

Committed `docs/.docgen/manifest.json` містить:

- domains/topics/stable IDs/titles/aliases;
- topic fingerprints і generator versions;
- claims та compact evidence references;
- process step/business rule → files/symbols/tests/configs/contracts;
- reverse evidence index → affected claims/topics;
- gaps і status;
- AUTOGEN/MANUAL/EXPECTED zone registry і hashes.

Повний AST graph є відтворюваним cache і не комітиться. Manifest достатній для
AI impact lookup без повторного широкого пошуку.

## 11. Incremental lifecycle

```text
changed file
  → domain resolver
  → AST/content hash comparison
  → changed graph nodes/edges
  → reverse dependency closure
  → invalidated claims/topics/gaps
  → map/reduce only invalidated subgraphs
  → validate complete candidate domain
  → atomic publish
```

Вимоги:

- незмінний прогін не робить LLM calls;
- rename без semantic change не регенерує narrative;
- full rebuild і incremental rebuild дають однакові committed artifacts;
- partial chunk results можуть бути durable cache, але не потрапляють у docs;
- publication виконується через staging directory та atomic replacement;
- topic fingerprint включає evidence hashes, graph edges, parser/schema/prompt
  versions і protected expectation hashes;
- code file CRC/hash більше не штампується в окремій файловій документації.

## 12. Quality gates

Один усереднений score не використовується як release gate. Перевіряються
окремі інваріанти:

1. **Parse gate:** усі релевантні файли domain успішно розпарсені повним parser.
2. **Graph gate:** усі required entry points і reachable effects представлені.
3. **Coverage gate:** кожен published claim має evidence; кожен critical graph
   path від seed до outcome покритий.
4. **Entailment gate:** semantic verifier підтверджує, що claim не виходить за
   evidence.
5. **Gap gate:** статус відповідає deterministic fixture-моделі
   `satisfied/missing/diverged/unresolved`.
6. **Privacy gate:** private symbol names відсутні у human Markdown.
7. **Identity gate:** topic rename/split/merge не втрачає zones або links.
8. **Projection gate:** Markdown, Mermaid і manifest не суперечать graph.
9. **Atomicity gate:** failure будь-якого gate не змінює committed docs.
10. **Portability gate:** CommonMark + GFM + Mermaid + дозволені CI4 HTML
    markers/`<details>`.

## 13. Адаптація CI4

### 13.1. Scoped truth

CI4 більше не проголошує одну універсальну форму source of truth:

- Markdown/ADR/spec — source of truth для очікуваного intent;
- code — source of truth для implemented behavior;
- knowledge graph — derived comparison model;
- Markdown views/manifest — versioned projections.

Accepted ADR лишаються canonical architecture decisions і expectation evidence,
але не є єдиним входом autogen.

### 13.2. Changeability Test

`Rebuild Test` («видалити `src/` і відтворити code лише з Markdown») видаляється.
Новий бінарний тест:

> Fresh LLM-session отримує self-contained AS-IS fragment, TO-BE description і
> repository. Через docs + manifest агент має знайти правильний domain,
> affected topics, files, symbols, tests, contracts і configs та побудувати
> повний implementation plan без широкого repo-wide пошуку.

Golden fixtures фіксують required impact set. Required recall — 100%; зайвий
impact не може виходити за documentation domain.

### 13.3. Gap Test

Golden scenarios перевіряють:

- no expectation → no gap;
- matching expectation → `satisfied`;
- missing implementation → `missing`;
- contradictory implementation → `diverged`;
- insufficient mapping evidence → `unresolved`;
- parser/coverage failure → publication blocked.

### 13.4. Monorepo layout

Заборона CI4 розпорошувати docs застосовується всередині documentation domain.
Repo root може мати агрегований `docs/index.md` із links на package docs, але не
дублює їхній business/architecture content.

### 13.5. arc42/Diátaxis

arc42/Diátaxis лишаються thin navigation skeleton, а не фіксований набір
порожніх pages. Auto-discovered processes/capabilities живуть у
`explanation/`; contracts — у `reference/`; accepted ADR — у `adr/`.

## 14. Migration поточного doc-files

### Фаза 0 — conformance corpus і shadow design

- Зібрати representative packages для JS, Vue, Rust, Python і PHP.
- Додати golden business processes, architecture boundaries, expected claims і
  impact sets.
- Провести parser benchmark Rust/Python/PHP.
- Зафіксувати quality/latency baseline поточного doc-files.

Жодна consumer documentation у цій фазі не змінюється.

### Фаза 1 — knowledge slots і normalized graph

- Додати `knowledge.domain@1` та `knowledge.extractor@1`.
- Адаптувати OXC/Vue extractors.
- Додати full-parser adapters Rust/Python/PHP.
- Побудувати deterministic graph/evidence CLI без LLM.

CLI має віддавати компактні поверхні:

```text
n-rules docs domains
n-rules docs index --domain <id>
n-rules docs slice --domain <id> --topic <id>
n-rules docs validate --domain <id>
```

### Фаза 2 — Implemented AS-IS у shadow mode

- Topic discovery, criticality, semantic chunks, map/reduce.
- Генерація candidate docs у staging/cache, без заміни legacy docs.
- Порівняння full/incremental rebuild.
- Changeability benchmark на golden corpus.

### Фаза 3 — Expected overlay і Gap engine

- `EXPECTED` zones, ADR/spec/test ingestion.
- Gap statuses і `implementation-gaps.md`.
- Protected-zone migration та conflict checks.

### Фаза 4 — CI4 v4 і dual publication

- Оновити CI4 scoped-truth модель.
- Замінити Rebuild Test на Changeability/Gap tests.
- Публікувати package-level docs поруч із чинними file docs.
- Старі CRC checks і нові topic fingerprints працюють паралельно.

### Фаза 5 — cutover

- Новий skill `n-docs` стає canonical.
- `n-doc-files` і `lint doc-files` лишаються deprecated aliases щонайменше один
  release cycle.
- Hooks/AGENTS переходять на package-level freshness.
- Legacy per-file docs перестають бути required і отримують migration report.
- Автоматичне видалення legacy docs заборонене; cleanup робиться окремим
  reviewed change.

### Фаза 6 — enforcement

- Parser/coverage/identity/projection gates стають blocking.
- CI перевіряє incremental determinism.
- Changeability Test і Gap Test входять у CI4 fixture suite.
- Unchanged run підтверджує zero LLM calls.

## 15. Орієнтовні implementation owners

- `npm/rules/doc-files/main.mdc` — layered truth, package domains,
  Changeability/Gap tests.
- `npm/rules/doc-files/package_knowledge/` — freshness detector, generation worker,
  deterministic validators.
- `npm/rules/doc-files/` — compatibility surface і код, що переноситься або
  делегує новому engine під час migration.
- `npm/bin/n-rules-cli.mjs` — `docs domains|index|slice|validate`.
- `npm/scripts/lib/plugin-slots.mjs` — discovery knowledge slots без нового
  parallel plugin mechanism.
- `plugins/lang-js/doc-files/` — OXC/Vue adapter migration.
- `plugins/lang-rust/doc-files/` — full Rust parser adapter замість
  brace scanner.
- `plugins/lang-python/doc-files/` — Python AST adapter.
- `plugins/lang-php/doc-files/` — PHP AST adapter.
- `npm/skills/docs/` — canonical package documentation skill.
- `npm/skills/doc-files/` — deprecated compatibility wrapper.

Точне розкладання helper-файлів підпорядковується `scripts.mdc`: single-concern
код живе поруч із `package_knowledge`, cross-rule/plugin contracts — у
versioned plugin API/shared infrastructure.

## 16. Акцепт-критерії

1. Package без manual docs/spec/ADR генерує evidence-backed
   `Implemented AS-IS`, architecture view, index і manifest.
2. Додавання одного `EXPECTED` claim створює лише локальне порівняння; без
   expectation gap не виникає.
3. AS-IS process fragment дозволяє fresh agent пройти Changeability Test із
   100% recall required impact set.
4. Один package у monorepo не розгортає source іншого package.
5. Rename файла без semantic change зберігає topic ID та narrative.
6. Зміна одного leaf unit інвалідує тільки його claims і reverse-dependent
   topics.
7. Full та incremental rebuild byte-equivalent для generated zones/manifest,
   за винятком заборонених volatile timestamps.
8. Parser failure не змінює docs і повертає explicit blocking diagnostic.
9. Private symbol names не протікають у Markdown, але доступні в manifest
   traceability.
10. Protected `MANUAL`/`EXPECTED` sections переживають regeneration, rename і
    однозначну topic migration.
11. Невдалий chunk ескалюється model ladder-ом локально; успішні chunks не
    перегенеровуються.
12. Повторний прогін без changes виконує zero LLM calls.
13. Legacy file docs не видаляються автоматично під час cutover.

## 17. Не входить у scope

- відтворення повного source code лише з Markdown;
- graph implementation кількох workspace packages як одного domain;
- аналіз source third-party dependencies;
- site generator або web UI;
- автоматичне застосування TO-BE code changes — це downstream consumer;
- ручна конфігурація business criticality;
- мовчазний whole-file/regex fallback при parser failure;
- історичний event-sourced knowledge graph першої версії.

## 18. Відкриті implementation питання

- Який full parser перемагає conformance benchmark для Rust:
  `syn`-adapter чи Tree-sitter.
- Які конкретні parser packages забезпечують найкращий
  completeness/portability баланс для Python і PHP.
- Який entailment verifier достатньо стабільний для blocking quality gate:
  один stronger-tier judge чи consensus двох незалежних passes.
- Чи комітити aggregate repo-root `docs/index.md`, чи генерувати його тільки
  для monorepo з двома і більше documentation domains.

Ці питання не змінюють погоджену архітектуру. Фаза 0 має закрити їх
conformance/golden benchmark-ом до production publication відповідної мови.

## 19. Відкладені альтернативи

- Розширити current unit digest і лишити один document на source-файл:
  відкладено, бо не моделює cross-file business process.
- Один великий document на package: відкладено через topic churn, контекстне
  переповнення та слабку інкрементальність.
- Два незалежні дерева `implemented/` і `expected/`: відкладено через
  дублювання та drift; layers живуть у спільній graph identity.
- Language Server як обов’язковий runtime: відкладено через portability й
  неоднакове consumer environment.
- Agentic traversal без deterministic graph: відкладено через непередбачуване
  coverage.
- Event-sourced knowledge history: відкладено до появи реальної потреби
  відтворювати еволюцію процесів.
