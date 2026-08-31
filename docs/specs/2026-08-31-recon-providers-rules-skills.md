# Розвідка: три родини JS поза лічбою T0-концернів — `coverage-provider`, `npm/rules/**`, `skills/`

**Дата:** 2026-08-31
**Статус:** розвідка (коду не написано жодного рядка)
**Причина:** міграція JS→Rust рахувала ОДНУ вісь — T0-фіксери концернів. Три
родини нижче не потрапляли в підрахунок узагалі, хоча разом дають
**89 продуктивних JS-файлів і 22 781 рядок** — понад третину всього
продуктивного JS репозиторію (258 файлів / 57 459 рядків).
**Зв'язані документи:** `docs/plans/2026-08-05-open-questions-register.md`
§2.103 (два свідомо відкритих блокери зрізу 6),
`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md` §7.4/§12.4.1 (вироки по
поверхнях npm-пакета), `docs/specs/2026-08-08-llm-lib-acp-only-rust-goose.md`
(класи 1-3 міграції LLM-контуру).

## Метод і межі

Кожне твердження нижче — з файлу й рядка, звірене в коді цього дерева
(гілка `docs/recon-providers-rules-skills`). Твердження документів, які коду
суперечать, винесені в окремий розділ «Документ проти коду» і НЕ використані
як підстава для класу портовності. Lint і `doc-files` не запускались (свідомо,
за брифом). Поза скоупом: `lint-surface` і `npm/scripts/lib`+`npm/bin` —
паралельні розвідки.

Класи портовності:

| Клас | Значення |
| --- | --- |
| **A** | портовне як є — цільова поверхня в Rust уже існує й активна |
| **B** | потребує НОВОЇ поверхні; у кожному записі названо якої саме |
| **C** | структурно не портовне — з доказом у коді |
| **D** | зникає разом зі зрізом 6 (споживач помирає разом із каналом) |

## Зведення

| Родина | Файлів | Рядків | Клас | Одним рядком |
| --- | ---: | ---: | --- | --- |
| `coverage-provider` (4 плагіни) | 31 | 7 671 | **B** | немає ані WIT-домену `coverage`, ані слот-каналу в napi-мості; сам слот `coverage.provider@1` резолвиться ЛИШЕ JS-шиною |
| `npm/rules/**` не-тестові `.mjs` | 58 | 15 110 | **B** (доміну), **A** (`test/coverage` LLM-класифікація), **D** (`release/`) | блокер §2.103; `doc-files` має великий, але НЕ підключений Rust-двійник |
| `npm/skills/**` JS | 3 | 4 030 | **C** для `git-reconcile`, **B** для `taze` | виконує їх НАШ CLI, а не агент консюмера — це блокер «бінар і більше нічого», не примітка до нього |
| **Разом** | **92** | **26 811** | | (з них 3 файли/4 030 рядків — скіли; 89/22 781 — перші дві родини) |

Три знахідки, заради яких варто читати далі:

1. **`text/cspell-fix` справді має нативний воркер — і він недосяжний за
   замовчуванням.** `crates/rules-fix/src/workers.rs:38-52` існує й робить те,
   що обіцяє `fix.rs:36-45`, але єдиний його виклик іде з
   `rules_fix::fix_concerns` (`crates/rules-fix/src/lib.rs:204-206`), а той —
   лише з опційного прапорця `n-rules lint --native-fix`
   (`crates/rules-cli/src/fix_cmd.rs:9-15`). Штатний fix-шлях
   (`npm/scripts/lib/lint-surface/run-fix.mjs:531-540`) native-воркерів НЕ
   знає взагалі й вантажить `fix-worker.mjs` із каталогу концерну. JS-воркер —
   не «залишок з іншої причини», а **чинний виконавець за замовчуванням**.
2. **Два інших `fix-worker.mjs` нативних двійників НЕ мають** — і причина, яку
   називає `fix.rs`, у коді підтверджується (для `test/coverage` — цілком, для
   `doc-files/check` — з поправкою, див. нижче).
3. **`skills/`-оркестратори виконує CLI, а не агент.** §7.4 специфи
   (`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md:1014-1017`) списує їх
   як «не блокер зрізу 6 (скіли виконує агент, не CLI)». Код каже протилежне:
   `crates/rules-cli/src/main.rs:189-223` СВІДОМО делегує саме ці два скіли в
   JS, а `npm/scripts/skills-cli.mjs:198-204,225-231` імпортує
   `orchestrate.mjs` у власному процесі.

---

## Родина 1 — `coverage-provider` у чотирьох lang-плагінах

### 1.1. Що це і хто це викликає

31 продуктивний `.mjs`, 7 671 рядок:

| Плагін | Файлів | Рядків | Вміст |
| --- | ---: | ---: | --- |
| `plugins/lang-js/coverage-provider` | 21 | 6 252 | vitest+Stryker колектор (`js-collector.mjs`, 1 211), Storybook-вимір, AST-аналіз, runtime-probe (522), LLM fix-шлях (`fix/`, 6 файлів / 2 963) |
| `plugins/lang-rust/coverage-provider` | 4 | 469 | `cargo llvm-cov` + `cargo mutants` + агентні fix-hooks |
| `plugins/lang-python/coverage-provider` | 3 | 528 | `uv run pytest --cov` + mutmut 4.x + агентні fix-hooks |
| `plugins/lang-php/coverage-provider` | 3 | 422 | PHPUnit/Pest clover + `infection/infection`, БЕЗ fix-hooks |

Це **слот-поверхня плагіна**, а не `rules/<rule>/<concern>` — саме тому родина
випадала з усіх підрахунків концернів. Реєстрація — рядком у маніфесті
плагіна, не каталогом:

- `plugins/lang-js/package.json:109-112` — `{"slot": "coverage.provider",
  "version": 1, "id": "coverage-js", "resource": "./coverage-provider/provider.mjs"}`;
  те саме в `lang-rust/package.json:60`, `lang-python/package.json:79-82`,
  `lang-php/package.json:117-120`.

### 1.2. Як слот резолвиться

Ланцюг рівно один, і він цілком JS:

1. `npm/rules/test/coverage/main.mjs:63-72` (`resolveProviders`) →
   `resolveSlotGraph` (`npm/scripts/lib/plugin-slots.mjs:529`) →
   `getSlotContributions(graph, 'coverage.provider', [1])`
   (`plugin-slots.mjs:580`) → `await import(pathToFileURL(c.resourcePath))` →
   `assertCoverageProvider` (`npm/scripts/lib/plugin-api.mjs:136-148`).
2. Контракт провайдера — качиний, перевіряється `typeof`:
   обов'язкові `id`/`title` + `detect`/`collect`/`collectPerFile`
   (`plugin-api.mjs:127-128`); fix-hooks (`generateTests`/`generateStories`/
   `fixSurvived`/`fixFailingTests`) — опційні, їх перевіряє
   `npm/rules/test/coverage/fix-worker.mjs:105` (`typeof provider[hook] !== 'function'`).
3. Дискавері принципово синхронне й НЕ читає `resource`
   (`plugin-slots.mjs:10-19`), імпорт живого модуля робить сама поверхня —
   тобто «слот» тут = `await import()` довільного JS-файлу з каталогу плагіна.

Плагін без `requiresPluginApi === 2` у граф не потрапляє взагалі
(`plugin-slots.mjs:403` — warning, не мовчазна деградація).

### 1.3. Чи є Rust-відповідник

**Немає жодного, і місця для нього в контракті теж немає.**

- `crates/rules-contract/wit/world.wit` експортує рівно п'ять функцій гостя:
  `describe` (575), `detect` (578), `fix` (595), `ecosystem-outdated` (601),
  `docgen-render` (606). Слова `coverage` у WIT немає взагалі
  (перевірено `grep -rn coverage --include='*.wit'` — нуль збігів).
- Розширюваний host→plugin канал `host-context: func(slot: string) ->
  option<string>` (`world.wit:708`) передає лише рядок і йде в зворотному
  напрямку — він не може повернути хосту ані `collect`-таблицю, ані
  `touchedFiles`.
- `NATIVE_CONCERNS` (`crates/rules-core/src/concerns/mod.rs:230-277`) ключа
  `test/coverage` не містить, тож і детектор, що кличе провайдерів, лишається
  JS.

**Клас: B.** Потрібна НОВА поверхня, і прецедент, як її заводять, у контракті
вже є: `ecosystem-outdated` — це той самий за формою слот `taze.provider`,
винесений в експорт WIT. Обсяг нової поверхні для coverage:

1. новий export у `world.wit` (мажор контракту — додавання поля/функції
   ламає інстанціацію гостей, `world.wit:97-107`), на кшталт
   `coverage-detect` / `coverage-collect` / `coverage-collect-per-file`;
2. host-проводка в `crates/rules-napi` (дзеркало `run_wasm_concern`), бо
   поверхня має викликатись і зі старого JS-шляху, поки він живий;
3. **окремий канал для fix-hooks**: чотири хуки — це агентні LLM-сесії, що
   пишуть файли (`plugins/lang-js/coverage-provider/provider.mjs:46-120`,
   `plugins/lang-rust/coverage-provider/fix-hooks.mjs:11-12`), тобто
   `FixPlan`-ом вони не виражаються; це або host-імпорт «запусти агентну
   сесію», або перенесення хуків у `rules-fix` з провайдером як джерелом
   лише промптів.

Застереження, яке варто врахувати ДО вибору форми: `ecosystem-outdated` і
`docgen-render` уже існують у контракті **другий рік і не реалізовані жодним
гостем** — усі шість плагінів повертають `DomainError::NotSupported`
(`crates/plugin-lang-rust/src/lib.rs:2987-2993`,
`crates/plugin-lang-js/src/lib.rs:16199-16204`,
`crates/plugin-lang-python/src/lib.rs:2819-2824`,
`crates/plugin-lang-php/src/lib.rs:1463-1468`,
`crates/plugin-ci-github/src/lib.rs:3323-3328`,
`crates/plugin-ci-azure/src/lib.rs:913-918`). Тобто наявність домену в WIT
сама по собі нічого не мігрує; додавання `coverage`-домену без порту гостей
дасть сьомий і восьмий `NotSupported`.

### 1.4. Що всередині — і що з цього справді складне

- **Спавн зовнішніх тулів** (`spawnSync` у всіх чотирьох провайдерах:
  `lang-js/js-collector.mjs:8`, `lang-rust/provider.mjs:10`,
  `lang-python/provider.mjs:11`, `lang-php/provider.mjs:11`) — клас, який ядро
  вже вміє: T3-хвиля exec-tool фіксів робить рівно це
  (`crates/rules-core/src/concerns/fix.rs:10-21`). Портовне як є.
- **Парсери звітів** (`lcov.mjs`, `mutants.mjs`, `mutmut.mjs`, `clover.mjs`,
  `infection.mjs`) — чисті функції над текстом, ~370 рядків сумарно. Портовне
  як є; частина вже має Rust-аналоги в екосистемі крейтів.
- **`lib/runtime-probe.mjs` (522 рядки)** — записує тимчасовий скрипт і
  спавнить його, щоб `import()`-нути модуль КОРИСТУВАЧА і покликати його
  експорти з edge-case аргументами (`runtime-probe.mjs:1-16`). Сам харнес
  портовний (Rust так само вміє написати файл і спавнити `node`), але його
  РОБОТА — виконання JS консюмера; це не аргумент проти порту, це нагадування,
  що для JS-репозиторію нода в дереві є за визначенням.
- **`fix/` у lang-js (2 963 рядки) + `fix-hooks.mjs` у rust/python** — агентні
  сесії через `@7n/llm-lib/agent-fix` (`lang-rust/fix-hooks.mjs:11`,
  `lang-python/fix-hooks.mjs:11`). Цільова поверхня в Rust існує
  (`rules-fix` веде драбину й агентні спроби —
  `crates/rules-fix/src/lib.rs:204-216`), але каналу «плагін просить хоста
  провести агентну сесію» в контракті немає — це і є та сама нова поверхня з
  п. 3 вище.
- **Зв'язаність із npm-`exports`, які зріз 6 планово вбиває:** `lang-rust` і
  `lang-python` провайдери імпортують ядрові парсери через
  `@7n/rules/rules/test/coverage/lib/lcov.mjs`
  (`lang-rust/provider.mjs:17`, `lang-python/provider.mjs:17-18`) — тобто
  через `exports["./rules/*"]` (`npm/package.json:58`), яку §7.5 специфи
  списує у «зникає повністю». Ця залежність ламається раніше, ніж хтось
  візьметься за порт: **зріз 6 не може закрити `types/`-вирок, не зачепивши
  coverage-провайдери**. У розборі §12.4.1 цей зв'язок не названий.

---

## Родина 2 — `npm/rules/**`, JS, що лишився

**Виміряно:** 58 не-тестових `.mjs`, 15 110 рядків
(`find npm/rules -name '*.mjs' -not -path '*/tests/*'`). Реєстр §2.103
(`docs/plans/2026-08-05-open-questions-register.md:12486`) називає 57 — розбіжність
в один файл; на вироки не впливає, але число в реєстрі варто перезняти командою,
а не переносити.

Розкладка:

| Кластер | Файлів | Рядків | Клас |
| --- | ---: | ---: | --- |
| `doc-files/` (docgen 16 + `package_knowledge` 21) | 37 | 12 639 | **B** (див. 2.2) |
| `test/coverage/` (main + lib + classify + fix-worker) | 10 | 1 131 | **A** для класифікації, **B** для решти |
| `text/cspell-fix/fix-worker.mjs` | 1 | 175 | **A** — двійник уже написаний |
| `release/` (`change.mjs`, `release.mjs`, `lib/*`) | 5 | 667 | **D** |
| дрібні `lib/` (`abie` ×2, `changelog`, `graphql`, `rego`) | 5 | 498 | змішано |

12 `main.mjs` (`find npm/rules -name main.mjs | wc -l` → 12) і 3
`fix-worker.mjs` — числа реєстру тут підтверджуються точно.

### 2.1. Три `fix-worker.mjs` — окремий розбір (найцінніша частина задачі)

#### `text/cspell-fix/fix-worker.mjs` (175 рядків) — **клас A, двійник УЖЕ є, але не активний**

Твердження `crates/rules-core/src/concerns/fix.rs:36-45` («уже портований
нативно — `crates/rules-fix/src/workers.rs::build_cspell_worker`») **правдиве**:

- `crates/rules-fix/src/workers.rs:38-40` — `has_fix_worker(key)` повертає
  `true` рівно для `"text/cspell-fix"`;
- `workers.rs:92-186` — `build_cspell_worker`: детект через
  `rules_core::concerns::detect_cspell` (`workers.rs:114`), класифікація,
  дозапис `.cspell.json` (`workers.rs:149-169`);
- пояснення, чому ключа немає в `NATIVE_FIXES` (фіктивний T0-патерн затінив би
  воркерний шлях), теж збігається з кодом: `run-fix.mjs` бере native-патерн
  через `getNativeFixKeys()`/`listNativeFixes()`
  (`npm/scripts/lib/lint-surface/run-fix.mjs:84-88`), а воркер резолвить
  ОКРЕМОЮ гілкою (`run-fix.mjs:531-540`).

**Але доккомент не каже головного, і без цього він вводить в оману.** Єдиний
виклик native-воркера — `rules_fix::fix_concern`
(`crates/rules-fix/src/lib.rs:204-206`: `workers::build_fix_worker(key, cwd,
files).unwrap_or_else(…)`), а `rules-fix` є залежністю рівно одного крейта —
`crates/rules-cli/Cargo.toml:44`, звідки його кличе лише `fix_cmd`
(`crates/rules-cli/src/fix_cmd.rs:105-116`), тобто **опційний прапорець
`n-rules lint --native-fix`**. Його доккомент це фіксує прямо:
«`--native-fix` — близнюк наявного `--native-detect`: опційний вмикач бінаря.
Без нього `lint` без `--no-fix` і далі делегується в JS-CLI, де живе чинний
fix-пайплайн» (`fix_cmd.rs:9-15`).

Штатний шлях фіксу — JS: `resolveWorker` (`run-fix.mjs:531-540`) бере
`fix-worker.mjs` із каталогу концерну (`run-fix.mjs:434-447`) і викликає його
на драбині (`run-fix.mjs:1067-1068`). Native-воркерів ця гілка не знає взагалі
(у файлі 57 згадок `native`, усі — про T0-патерни й `runNativeConcernFix`,
жодної про `listNativeFixes`-аналог для воркерів).

**Висновок:** видалення `npm/rules/text/cspell-fix/fix-worker.mjs` СЬОГОДНІ
зламало б дефолтний фікс. Роботи для повного зняття цих 175 рядків лишилось
менше, ніж здається, і вона не в порті: або (а) навчити JS-драбину брати
воркер із аддона тим самим прийомом, що й T0-патерни, або (б) зробити
`--native-fix` дефолтом. Обидва варіанти — рішення про перемикання шляху, не
про порт. Детектор того самого концерну, до речі, native вже за замовчуванням
(`NATIVE_CONCERNS` містить `"text/cspell-fix"` —
`crates/rules-core/src/concerns/mod.rs:232`), тож ситуація асиметрична:
детект іде в Rust, фікс — у JS.

#### `doc-files/check/fix-worker.mjs` (67 рядків) — **нативного двійника НЕМАЄ; клас B**

`fix.rs:87-94` каже, що це не T0-фікс і ключа в `NATIVE_FIXES` не буде.
Перевірено: `has_fix_worker` знає рівно один ключ (`workers.rs:38-40`), тож
нативного ВОРКЕРА теж немає — доккомент `fix.rs` про це не бреше, але й не
говорить (він пояснює лише відсутність T0-запису).

Сам воркер — тонкий (67 рядків); уся вага в тому, що він викликає:
`describeFile` (`docgen-scan/main.mjs`), `buildTestEvidenceIndex`
(`docgen-test-context/main.mjs`), `runGenerationBatch`/`purgeOrphanedDocs`
(`docgen-files-batch/main.mjs`) — `doc-files/check/fix-worker.mjs:23-26`.
Тобто його порт = порт усього docgen-кластера (2.2).

Інваріант, який має пережити будь-який порт і записаний лише тут:
`crc-mismatch` НЕ можна закривати детермінованим штампом CRC — свіжий CRC
поверх старого тексту назавжди маскує дрейф
(`doc-files/check/fix-worker.mjs:12-17`, дзеркало в `fix.rs:88-93`).

#### `test/coverage/fix-worker.mjs` (144 рядки) — **нативного двійника НЕМАЄ; клас C для самого воркера**

`fix.rs:95-101` («`fix-worker.mjs` поверх fix-hooks coverage-провайдерів
мовних плагінів… робота живе в провайдерах lang-плагінів») — **підтверджено
кодом**: воркер резолвить провайдерів через ту саму слот-шину
(`test/coverage/fix-worker.mjs:85`, `resolveProviders` з `main.mjs`) і лише
диспетчеризує чотири опційні хуки (`fix-worker.mjs:105-141`). `concern.json`
теж збігається з описом: `"fixability": "code"`, `"skipLocalTier": true`
(`npm/rules/test/coverage/concern.json:3-4`).

Тобто цей файл — **диспетчер над родиною 1**: він не портується окремо в
принципі, він зникає рівно тоді, коли `coverage.provider` дістає native-канал.
Класифікувати його як самостійну одиницю міграції — помилка обліку.

**Підсумок по трьох воркерах:** нативний двійник має рівно один
(`text/cspell-fix`), і саме він недосяжний за замовчуванням. Двом іншим
двійників немає, і причини, записані в `fix.rs`, коду не суперечать.

### 2.2. `doc-files/` — 37 файлів, 12 639 рядків: є великий Rust-двійник, і він ні до чого не підключений

`crates/rules-docs` — 24 модулі, ~500K сирцю (`candidate.rs`, `claims.rs`,
`entailment.rs`, `gap_mappings.rs`, `planner.rs`, `render.rs`, `runner.rs`,
`validator.rs`, `zones.rs`, `topics.rs`…). Його `lib.rs:25-28` заявляє:
«Команда `docs build` зібрана цілком — `runner::build_package_knowledge`
зшиває всі стадії».

**Але жоден крейт від нього не залежить.** `rules-docs` присутній у
`Cargo.toml:5` як член воркспейсу — і більше ніде: `grep -rn "rules-docs"
crates/*/Cargo.toml` дає лише його власний маніфест і згадку в коментарі
`crates/plugin-lang-python/Cargo.toml:39`; `grep -rn "rules_docs" crates
--include='*.rs'` поза самим крейтом — нуль збігів. Команда `docs` у CLI
лишається в списку делегованих у JS (`crates/rules-cli/src/cli.rs:383`), і
фактичний вхід — `npm/bin/n-rules-cli.mjs:2022`:
`await import('../rules/doc-files/package_knowledge/cli.mjs')`.

Це найважливіша знахідка родини 2 після воркерів: **8 583 рядки
`package_knowledge` мають готовий (за власною заявою) Rust-порт, який ніхто не
викликає.** Реєстр §2.103 згадує `crates/rules-docs` як «уже несе контур»
(рядки 12521-12523) — і не каже, що контур не підключений. Перед тим, як
планувати порт `doc-files`, треба відповісти на дешевше питання: **що саме
лишилось, щоб `n-rules docs …` пішла в `rules-docs`?** За заявою `lib.rs:31-34`
бракує лише мовних екстракторів, які «прийдуть зі slot-dispatch-ем» — тобто
знову той самий відсутній слот-канал, що й у родини 1. Самі екстрактори при
цьому вже існують і зареєстровані слотом `doc-files.extractor@1`
(`plugins/lang-js/package.json:115-118`, `lang-rust/package.json:61`,
`lang-php/package.json:97`; споживач —
`npm/rules/doc-files/docgen-scan/lang-extensions.mjs:78`) — але, як і
`coverage.provider`, це JS-модулі за `resource`-шляхом, які резолвить лише
JS-шина. Тобто «прийдуть зі slot-dispatch-ем» = «прийдуть, коли з'явиться
той самий native-канал».

Докген-частина (16 файлів, 4 056 рядків: `docgen-scan`, `docgen-gen`,
`docgen-files-batch`, `docgen-judge`, `docgen-prompts`, `docgen-crc`,
`docgen-wave-batch`, `docgen-test-context`, `docgen-extract-anchors`,
`docgen-ignore`) Rust-двійника не має. Її залежності — JS-поверхня llm-lib:
`@7n/llm-lib/model-tiers`, `/one-shot`, `/chain`
(`docgen-gen/main.mjs:5-7`), `@7n/llm-lib/batch`, `/local-providers`
(`docgen-files-batch/main.mjs:35-36`). Оскільки llm-lib має і Rust-контур
(`rules-fix` користується `llm_lib::journal`, `llm_lib::acp` —
`crates/rules-fix/src/lib.rs:196`, `crates/rules-cli/src/skill_cmd.rs:38`),
це **клас B з відомою цільовою поверхнею**, а не C.

### 2.3. `release/` (5 файлів, 667 рядків) — **клас D**

Вхід — `npm/bin/n-rules-cli.mjs:2002`
(`await import('../rules/release/release.mjs')`), тобто команда `release`
JS-CLI. Це поверхня публікації самого пакета, а не консюмерського лінту;
разом із npm-каналом зникає й вона. Окремого порту не потребує — потребує
рішення «чим замінюється `n-rules release` після зрізу 6», якого в §12.4.1
немає.

### 2.4. Дрібні `lib/` (5 файлів, 498 рядків)

- `changelog/lib/package-manifest.mjs` — **свідомо НЕ видаляється**, і це
  задокументовано в порті: `crates/rules-core/src/concerns/package_manifest.rs:12-14`
  («Сам JS-файл `package-manifest.mjs` НЕ видаляється: `readPackageManifest`
  лишається споживаний `npm/rules/release/release.mjs`…»). Тобто його доля
  прив'язана до `release/` — клас **D**, слідом за 2.3.
- `graphql/lib/graphql-gql-scan.mjs` — споживач `npm/scripts/auto-rules.mjs:32`
  (область паралельної розвідки по `npm/scripts/lib`; тут лише фіксую
  зв'язок).
- `abie/lib/{enabled,env-dns}.mjs`, `rego/lib/run-external-tool.mjs` —
  локальні хелпери відповідних правил; окремих зовнішніх споживачів
  не знайдено.

---

## Родина 3 — JS у `skills/`

**Три продуктивні файли, 4 030 рядків:**
`npm/skills/git-reconcile/js/orchestrate.mjs` (3 484 рядки, 137.8K),
`npm/skills/taze/js/orchestrate.mjs` (456), `npm/skills/taze/js/migration-cache.mjs` (90).

### 3.1. Хто це виконує — головне питання родини

**Не агент консюмера. Наш CLI, у власному процесі.**

Ланцюг:

1. `crates/rules-cli/src/skill_cmd.rs:44-49` — константа
   `ORCHESTRATED_SKILLS = ["taze", "git-reconcile"]` із доккоментарем: «Порт
   конвеєрів — окремий зріз спеки, тож тут вони лишаються делегованими».
2. `crates/rules-cli/src/main.rs:210-223` — `skill_runner_is_native` повертає
   `false` для цих двох скілів, тобто бінар СВІДОМО віддає їх JS.
3. `crates/rules-cli/src/js_fallback.rs:121-134` — делегація спавнить
   `bun`, інакше `node`; без жодного з них — hard error
   (`js_fallback.rs:172-173`).
4. `npm/scripts/skills-cli.mjs:198-204` (`taze`) і `:225-231`
   (`git-reconcile`) — `await import('../skills/<id>/js/orchestrate.mjs')` і
   виклик `runTazeOrchestrator`/`runGitReconcileOrchestrator` у тому ж процесі.

Тобто `npx @7n/rules skill pi taze` — це **JS-процес нашого пакета**, який
детерміновано веде кроки й точково кличе агента, а не агент, що читає
`SKILL.md`. Це прямо описано і в самому скілі:
«`npx @7n/rules skill pi|cursor|codex taze` **не** передає цей файл одним
суцільним промптом… Замість цього `npm/skills/taze/js/orchestrate.mjs`:
1. Детерміновано, без LLM, виконує кроки 1-3…» (`npm/skills/taze/SKILL.md:18-24`).

### 3.2. Де цей JS фізично лежить

**У пакеті, не в дереві консюмера.** Синхронізація скілів копіює лише
top-level файли каталогу скіла; підкаталоги свідомо пропускаються —
`npm/bin/n-rules-cli.mjs:957-961`:

> «Лише top-level файли скіла. `main.json` — метадані (не для споживача);
> підкаталоги (`js/` — скіл-специфічний код) виконуються з пакета через
> `npx`, у проєкт не копіюються».

Отже `.cursor/skills/n-taze/` у консюмера отримує лише `SKILL.md` — а
`orchestrate.mjs` виконується з `node_modules/@7n/rules/skills/…`. `cwd`
процесу при цьому — дерево консюмера (`skills-cli.mjs:204`:
`orchestrate({ cwd: projectDir, … })`), і саме це, схоже, мала на увазі
специфа під «працює вже В ДЕРЕВІ КОНСЮМЕРА».

### 3.3. Що з цього випливає для «бінар і більше нічого»

Наслідок жорсткіший за той, що записаний у §7.4. Після зрізу 6 `skills/`
вшивається в бінар (вирок §7.4), і тоді для цих двох скілів бінар не має
куди делегувати: `js_fallback::resolve_entry` шукає
`node_modules/@7n/rules/bin/n-rules.js` (`js_fallback.rs:16,29`) — файл, якого
після зняття npm-каналу не існує. **`n-rules skill … taze` і
`… git-reconcile` перестають працювати мовчки-ламано, а не деградують.**
Це блокер того самого класу, що й `npm/rules/**` `.mjs` (§2.103 п.1), і в
реєстрі його зараз немає.

### 3.4. Класи

- **`taze/js/orchestrate.mjs` + `migration-cache.mjs` (546 рядків) — клас B.**
  Оркестратор веде екосистемні гілки через `EcosystemProvider`-порт
  (`npm/skills/taze/SKILL.md:26-34`), тобто через ту саму слот-шину, що й
  coverage. Цільова поверхня в контракті ЧАСТКОВО вже є —
  `ecosystem-outdated` (`world.wit:601`), — але не реалізована жодним гостем
  (усі `NotSupported`, посилання в 1.3). Нова поверхня, якої бракує:
  реалізація `ecosystem-outdated` у lang-гостях + host-канал «виконай
  bounded-виклик агента на один major-запис» (кроки 4-6 скіла).
- **`git-reconcile/js/orchestrate.mjs` (3 484 рядки) — клас C для порту «як
  є», B за наявності рішення.** Доказ структурності — не розмір, а те, що
  цей файл робить: Git inventory / patch-equivalence / worktree / cherry-pick
  / gates / push / PR детерміновано, з LLM лише на semantic triage і
  розв'язанні конфліктів (`npm/scripts/skills-cli.mjs:213-217`). Це
  повноцінний workflow-рушій над `git` і `gh`, а не адаптер над контрактом
  плагіна; жодна з п'яти WIT-поверхонь (`describe`/`detect`/`fix`/
  `ecosystem-outdated`/`docgen-render`) його форму не виражає. Порт означає
  писати новий крейт із нуля, а не переносити — і саме тому
  `skill_cmd.rs:44-49` чесно каже «краще віддати JS, ніж підмінити конвеєр
  одним ходом».

---

## Документ проти коду — чотири розбіжності

1. **`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md:1014-1017`:** «Це не
   блокер зрізу 6 (скіли виконує агент, не CLI)». Код:
   `crates/rules-cli/src/main.rs:210-223` + `skill_cmd.rs:44-49` +
   `npm/scripts/skills-cli.mjs:198-204,225-231` — два скіли виконує саме CLI,
   через JS-делегацію. Дужка з обґрунтуванням хибна, а разом із нею — і
   вирок «не блокер» (розділ 3.3).
2. **`docs/specs/…phase8-skeleton.md:1010-1013`:** «скіли несуть виконуваний
   JS, який працює вже В ДЕРЕВІ КОНСЮМЕРА». Формально — ні:
   `npm/bin/n-rules-cli.mjs:957-961` явно НЕ копіює `js/` у проєкт. Точне
   формулювання: JS живе в пакеті, виконується з `cwd` консюмера. Наслідок
   для доставки протилежний до того, що читається з тексту: файли не
   «розповзаються по чужих деревах», їх треба ЗАПУСТИТИ з бінаря.
3. **`plugins/lang-rust/coverage-provider/provider.mjs:7-8`:** «Fix-hooks
   (LLM-генерація тестів) для Rust поки не реалізовані — fix-worker пропускає
   провайдер без хуків». Код того ж файлу: `provider.mjs:244-245`
   (`generateTests` → `import('./fix-hooks.mjs')`) і `:254-255`
   (`fixSurvived`); сам `plugins/lang-rust/coverage-provider/fix-hooks.mjs`
   (120 рядків) існує з коміту `61e637059` («python-провайдер, rust
   fix-hooks…»). Доккомент застарів на два комміти й ніколи не звірявся.
   **Та сама неправда продубльована в згенерованій доці**
   `plugins/lang-rust/coverage-provider/docs/provider.md:15` («Для Rust
   fix-hooks генерації тестів ще не реалізовані, тому fix-worker цей
   провайдер пропускає») — з валідним CRC у frontmatter. Тобто CRC-гейт
   вважає доку актуальною: він стереже дрейф ТЕКСТУ джерела, а не
   правдивість твердження. (Для `lang-php` аналогічне речення
   `provider.mjs:9` — правдиве: `fix-hooks.mjs` там немає.)
4. **`crates/rules-core/src/concerns/fix.rs:36-45`** формально правдивий
   (двійник існує), але замовчує, що native-воркер недосяжний без
   `--native-fix` (`crates/rules-cli/src/fix_cmd.rs:9-15`). Читач доккоментаря
   робить висновок «JS тут уже не працює» — а він працює й є дефолтом.
   Це не помилка факту, це пропущений факт, від якого залежить рішення
   «чи можна видаляти файл».

Спільне в усіх чотирьох: причина, записана в документі, пережила код, який її
породив. Це рівно той урок, що вже сформульований у самому репозиторії —
`fix.rs:106-112`: «рація „не портуємо“ має переглядатись разом з
інструментом, інакше вона живе довше за причину».

---

## Що з цього випливає для планування

1. **Спільний знаменник трьох родин — один: відсутній slot-канал у
   контракті.** Coverage (1.3), мовні екстрактори `rules-docs`
   (`crates/rules-docs/src/lib.rs:31-34`) і `taze`-оркестратор (3.4)
   впираються в те саме. Це аргумент робити ОДНУ поверхню, а не три.
2. **Найдешевша робота — не порт.** Дві позиції знімаються перемиканням, а не
   переписуванням: `text/cspell-fix/fix-worker.mjs` (175 рядків) чекає на
   рішення про `--native-fix`, а `package_knowledge` (8 583 рядки) — на
   з'ясування, чого бракує вже написаному `rules-docs`. Разом це 8 758 рядків
   із 22 781 — і жодного нового Rust-модуля.
3. **`test/coverage/fix-worker.mjs` не є одиницею міграції** (2.1) — він
   зникає разом із портом родини 1. Рахувати його окремо означає двічі
   порахувати ту саму роботу.
4. **Дві дірки в §12.4.1, які варто закрити до планування зрізу 6:** доля
   `n-rules release` (2.3) і зв'язок coverage-провайдерів із
   `exports["./rules/*"]` (1.4) — обидві поверхні розбір пропустив.
