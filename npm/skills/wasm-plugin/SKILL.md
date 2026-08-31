---
name: n-wasm-plugin
description: >-
  Авторинг плагінів contract v5 (wasm-компонент, n-rules:plugin@5.0.0) — scaffold нового guest-крейта, реалізація концерну, golden-тести через rules-plugin-host, publish (url+sha256 пін для wasmPlugins)
version: '1.0'
---

# n-wasm-plugin — авторинг wasm-плагінів contract v5

## Мета

Провести LLM-агента через повний цикл створення плагіна `n-rules:plugin@5.0.0`
(крокова структура — спека
`docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`, рішення І;
поточна форма ядрового світу — спека
`docs/specs/2026-08-31-plugin-contract-v5.md`): **scaffold** нового
guest-крейта → **реалізація** одного концерну → **golden-тести** через
реальний `rules-plugin-host` → **publish** (пін `url`+`sha256` для
`wasmPlugins`). Guest-мова за замовчуванням — **Rust** (`wit-bindgen`,
найзріліший wasm-toolchain у цьому репо); контракт приймає будь-який
компонент, що відповідає WIT `wit/world.wit`, тож ці кроки транслюються й
на інші мови зі своїм component-model-toolchain-ом, лише крок 1 (scaffold)
і Cargo-специфіка кроку 4 (publish) прив'язані до Rust.

**Джерело правди контракту** — `crates/rules-contract/wit/world.wit`
(world `plugin`, пакет `n-rules:plugin@5.0.0`). Якщо цей файл і цей SKILL.md
розійшлись — вір `.wit`, і онови цей документ.

## Передумови

- `rustup target add wasm32-wasip2` (стабільна ціль з rustc 1.82, тут — 1.95+;
  дає готовий Component Model компонент напряму з `cargo build`, без
  окремого `wasm-tools component new` + WASI adapter кроку).
- `wit-bindgen = "0.60"` — **пін звірено з `crates/plugin-lang-js/Cargo.toml`**
  (той самий, що й `crates/test-plugin-guest`); резолвиться в `0.60.0`
  (`Cargo.lock` кореня). Онови цей документ і шаблони кроку 1 разом, коли
  пін рухається (той самий каданс, що рішення М спеки — «кожен мінор через
  звичайний taze-флоу»).
- Чотири зразкові файли цього репо — читай перед першим використанням
  скіла: `crates/plugin-lang-js/` (реальний, повний приклад — два концерни,
  порт чинних JS-концернів `vue/tfm-translations` (per-file) і `style/gap`
  (full-scope) — замінив виведений пілот з одним концерном
  `crates/plugin-lang-js-pilot`), `crates/test-plugin-guest/` (мінімальна
  фікстура, теж кілька концернів в одному крейті — той самий мотив),
  `crates/rules-plugin-host/tests/plugin_lang_js.rs` і
  `crates/rules-plugin-host/tests/contract_test_kit.rs` (golden-тести).

## Крок 1 — scaffold нового guest-крейта

Шаблони — `npm/skills/wasm-plugin/template/`: `Cargo.toml.tpl`, `lib.rs.tpl`,
`plugin.toml.tpl`, `build.sh` (останній — без `.tpl`, копіюється дослівно,
без плейсхолдерів). Плейсхолдери шаблонів:

| Плейсхолдер | Значення |
| --- | --- |
| `__CRATE_NAME__` | назва Cargo-крейта (`kebab-case`, напр. `lang-rust-forbidden-todo`) |
| `__PLUGIN_ID__` | `Manifest.id` (напр. `myorg/forbidden-todo`) |
| `__CONCERN_ID__` | `ruleId/concernId` контрибуції (напр. `rust/forbidden_todo`) |
| `__CONCERN_REASON__` | стабільний machine `reason` кожної діагностики |
| `__MARKER__` | лише в демо-шаблоні — заміни разом із усією логікою `detect_one_file` |
| `__WIT_PATH__` | лише `lib.rs.tpl` — шлях у `wit_bindgen::generate!({ path: … })`, дивись нижче |

Шаблон декларує контрибуцію концерну як `ConcernContribution { key, scope,
glob, fix_glob }` (WIT `record concern-contribution`, `manifest.concerns:
list<concern-contribution>` — НЕ голий рядок): `key` = `__CONCERN_ID__`,
`scope` за замовчуванням `ConcernScope::PerFile` з порожнім `glob` (типовий
дефолт — виклик сам передає підмножину файлів у `DetectBatch`). Заміни
`scope`/`glob`, якщо концерн — whole-repo/крос-файлова перевірка: дивись
підрозділ «Full-scope / whole-batch концерн» нижче (крок 2) — тоді, коли
виклик не передав явний список файлів, хост будує batch сам за цим `glob`.

### Дві форми розташування — обери одну

**A. First-party (крейт живе в цьому монорепо, `crates/<name>/`).**

1. Скопіюй шаблони в новий `crates/<name>/` (той самий рівень, що
   `plugin-lang-js`/`test-plugin-guest`).
2. `__WIT_PATH__` → **відносний** шлях `../rules-contract/wit` (крейт на
   тому самому рівні вкладеності, що й `rules-contract`).
3. Додай крейт у `members` кореневого `Cargo.toml` — **звичайний рядок
   масиву**, НЕ `workspace.exclude` + власний `[workspace]` у крейті.
   Кореневий `Cargo.toml` документує чому (коментар біля `members`): цей
   репозиторій сам може бути вкладеним git-worktree, і `exclude`-варіант там
   ламається на `error: current package believes it's in a workspace when
   it's not`. Членство в кореневому workspace — єдиний робочий варіант.
4. `crates/rules-napi` і `.github/workflows/lint-rust.yml` НЕ чіпай у межах
   цього скіла, якщо задача явно цього не просить (napi-міст і CI —
   інфраструктура, окрема від авторингу конкретного плагіна; wiring нового
   плагіна в дефолтний прогін `n-rules lint` — окрема задача оркестрації).

**Б. Сторонній репозиторій (плагін живе поза цим монорепо).**

1. Скопіюй шаблони в корінь нового репозиторію плагіна.
2. **Vendor WIT**: скопіюй `crates/rules-contract/wit/` (разом із
   `wit/deps/slots/*.wit`) у `wit/` цього репозиторію — контракт не
   резолвиться через path-залежність поза монорепо. `__WIT_PATH__` → `"wit"`.
3. Ре-vendor вручну при кожному bump `n-rules:plugin` world (major-версія —
   negotiation зі skip-not-crash звіряє лише major, спека §3.2/§З; не чекай
   автоматичного сповіщення).
4. Крейт — сам собі workspace root (Cargo за замовчуванням розглядає
   одиночний пакет як власний implicit workspace); додаткового
   `[workspace]`-блоку зазвичай не треба, лише якщо в батьківському дереві
   поза контролем цього репо є ЧУЖИЙ `[workspace]`, що інакше поглинув би
   цей крейт.

### Заповнення шаблонів

Підстав усі плейсхолдери (таблиця вище) у скопійовані `Cargo.toml`,
`src/lib.rs`, `plugin.toml`. `build.sh` — **без змін**, копіюється дослівно
(`chmod +x`) — він сам обчислює `target_directory` через `cargo metadata`,
працює однаково для обох форм розташування (§ вище).

## Крок 2 — реалізація концерну

### Чисті helpers окремо від Guest-методів — ОБОВʼЯЗКОВО

**Ключове застереження** (`crates/plugin-lang-js/src/lib.rs`, доккомент
модуля): host-імпорти (`log`, `report-progress`, `run-tool` — WIT `import`,
plugin → host) **абортують процес**, якщо викликані поза реальним
wasmtime-`Store`. Це означає:

- `Guest::describe`/`Guest::detect`/`Guest::fix` — **тонкі обгортки**: одна
  умовна логіка + виклик чистої (pure) функції + `log`/`report-progress`.
  Ніколи не клади перевіряльну логіку концерну прямо в тіло `Guest`-методу.
- Уся логіка — у функціях без host-імпортів (`build_manifest`,
  `detect_one_file` у шаблоні) — саме їх кличуть `#[cfg(test)]`-юніт-тести
  на **host-таргеті** (`cargo test -p <crate>`, без wasm-збірки, секунди
  замість хвилин).
- `Guest`-поверхню (реальний `describe()`/`detect()`) тестує **лише**
  golden-тест через `rules-plugin-host` (крок 3) — там і лише там є живий
  `Store` з підключеними host-функціями.

### Parity-дисципліна (порт чинного JS-концерну)

Якщо цей плагін замінює концерн, що вже живе як JS (`plugins/lang-*/rules/…/main.mjs`):

1. Порт — **1:1**, не переосмислення. Той самий `reason`, той самий текст
   `message` (біт-у-біт, включно з пунктуацією й регістром), та сама умова
   спрацювання.
2. Фікстури — ті самі, що вже покривають JS-оригінал (`tests/*.test.mjs`
   сусіднього концерну) — перенеси вхідні файли дослівно, не переписуй
   «на свій смак».
3. Golden-тест (крок 3) звіряє wasm-вихід проти цих самих фікстур; якщо в
   репо вже є parity-тест на рівні lint-surface (зразок:
   `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs`,
   `crates/plugin-lang-js`) — розширюй його новим концерном, а не пиши
   паралельний.
4. Регулярні вирази/парсери — перенось синтаксис, що приймає цільова мова
   guest-а, без прихованих семантичних відмінностей (напр. Rust `regex`-крейт
   не підтримує lookaround чи backreference — якщо JS-оригінал на них
   покладався, потрібен явний алгоритмічний еквівалент, не «майже той самий»
   регекс: наприклад, negative lookahead `(?!=)` — regex без нього + ручна
   перевірка наступного символу після матчу; backreference `\2` (однакова
   лапка на відкритті/закритті) — regex, що приймає БУДЬ-ЯКУ лапку з обох
   боків, якщо жодна фікстура не змішує лапки в одному виразі).
5. **JS-оригінал на справжньому AST-парсері (oxc-parser), не на regex —
   КОНТРИБУЦІЯ вимагає byte-exact parity, апроксимація ДОПУСТИМА лише як
   groundwork БЕЗ контрибуції.** Виявлено задачею Q2 батч 2 (`plugin-lang-js`,
   концерни `js-bun-redis/imports`, `js-bun-db/safety`, `js-mssql/deps`,
   JS-оригінали через `oxc-parser`, `bun-sql-scan.mjs`/`mssql-pool-scan.mjs`
   — сотні рядків AST-обходу з control-flow-чутливою детекцією guard-ів,
   трасуванням `Identifier` → `init` через усі `VariableDeclarator`), потім
   де-скоуп рішенням оркестратора після звіту батчу (той самий batch,
   наступний зріз): перша спроба дала цим трьом концернам контрибуцію з
   **regex-наближенням** («count + reason, не байтова рівність `message`»)
   — відхилено, бо parity-дисципліна цього SKILL.md (п.1-3 вище) не
   допускає shadowing byte-inexact реалізацією: контрибуція = «ця
   реалізація тепер джерело правди для споживачів» (доккомент
   `describe()`/host-диспетчеризації), і «майже той самий» вивід на
   реальних (не лише синтетичних) фікстурах — прихована регресія, не
   задокументована розбіжність.
   - Написання власного токенізатора чи вендорингу справжнього JS/TS-парсера
     (`oxc_parser` Rust-крейт, чи tree-sitter) для ОДНОГО концерну —
     непропорційна робота понад обсяг задачі порту одного концерну. Якщо
     справжнє AST-рішення поза обсягом задачі, а JS-оригінал побудований на
     повноцінному парсері (не одному regex із локальним lookaround/
     backreference-обмеженням, п.4) — **без контрибуції** для цього концерну.
   - Regex-наближення в цьому випадку дозволене лише як **groundwork без
     контрибуції**: detect-функція й unit-тести (на самій функції, без
     JS⇄wasm parity-твердження) лишаються в крейті під майбутнє справжнє
     AST-рішення, але НЕ в масиві `ConcernContribution` у `describe()`/
     `plugin.toml` — і НЕ в golden-/parity-тестах, що звіряють wasm проти
     JS-канону (ці тести існують лише для концернів У КОНТРИБУЦІЇ).
     `Guest::detect`-match-гілка для ключа може лишитись (недосяжна без
     контрибуції — захисна відповідність, не мертвий код), але host її
     ніколи не викличе.
   - Задокументуй причину groundwork-статусу doc-коментарем біля кожної
     regex-наближеної функції (зразок — `crates/plugin-lang-js/src/lib.rs`,
     секція «Регекс-наближення» на початку файлу) і в `plugin.toml`/
     `Cargo.toml` (чому концерну немає в списку контрибуцій) — той самий
     мотив, що п.4: наступний агент має відразу зрозуміти, чому detect-
     функція існує, але без контрибуції.
   - Якщо JS-оригінал через `createViolationReporter`'s `fail(msg)` **без
     other opts** — `reason` за замовчуванням дорівнює `ctx.concernId` (bare,
     без `ruleId/`-префікса) для КОЖНОГО типу порушення концерну, не лише
     одного; звір це читанням `main.mjs` ПЕРЕД тим, як вигадувати окремі
     `reason`-константи на кожен внутрішній сценарій — часто вся складність
     AST-детекції зводиться до одного bare `reason` (корисно знати навіть
     для groundwork-функцій без контрибуції).

### T0-фікс поверх wasm-концерну (`export fix`)

Якщо JS-оригінал має супутній T0-паттерн (`fix-<concern>.mjs`, `export const
patterns: T0Pattern[]`) — типовий випадок для `test/no-*`-концернів з
авто-фіксом — **фіксер портується в guest через `export fix`** (fix-контур
contract v3; зразок-пілот — `test/no-bun-test-import`,
`fix_no_bun_test_import` у `crates/plugin-lang-js/src/lib.rs`), а JS-файл
видаляється. Конвеєр: детект дає violations → `run-fix.mjs` через
`resolveWasmConcernMap` синтезує T0Pattern `wasm-fix:<ruleId>/<concernId>`
→ napi `runWasmConcernFix` будує `FixRequest` (files — з `file`-полів
violations, вміст хост читає сам) → guest `fix()` повертає `FixPlan`
(`write` з ПОВНИМ новим вмістом файлу / `delete`) → хост валідує план
(safe repo-relative шляхи, ліміти розміру —
`rules-contract::validators::fix`) → JS-обгортка застосовує edits із
`recordWrite` ПЕРЕД кожною мутацією (rollback-контракт).

Правила порту фіксера:

1. Guest НЕ читає диск: працюй лише з `request.files` (вміст хост передав
   inline) і `request.diagnostics` (`data` на WIT-межі — JSON-рядок,
   парси `serde_json`-ом).
2. Порожній план = «фіксити нічого» — це і є `test() === false` синтетичного
   патерна; окремого test-хука в guest немає.
3. Концерни без фікса НЕ потребують нічого: заглушка `FixPlan { edits:
   vec![] }` — сумісна поведінка v3.0 (доккомент `wit/world.wit` біля
   `export fix`).
4. Кейси видаленого JS-фіксера зберігай на трьох рівнях: unit-тести
   guest-логіки (`#[cfg(test)]`), host-виклик через `LoadedPlugin::fix`
   (`crates/rules-plugin-host/tests/plugin_lang_js.rs`) і dispatch-рівень
   (`loadT0Patterns`/`runFixPipeline`,
   `npm/scripts/lib/lint-surface/tests/wasm-fix-e2e.test.mjs`).

Перевір **живим смок-тестом**, не лише читанням коду: tempdir із
фікстурою-порушенням → `runWasmConcern` (detect) → `runWasmConcernFix`
(план) → застосування → повторний wasm-detect дає 0. Зразок —
тест «fix-смок» у
`npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs` і живий
pipeline-смок у `wasm-fix-e2e.test.mjs`. Якщо план виходить порожнім на
валідній фікстурі — wasm-`Diagnostic` не несе поле (чи форму поля), на яке
матчить guest-фікс (типово `reason` і ключі `data`): виправляй wasm-вихід
детектора, форма violations лишається канонічною.

### Кілька концернів в одному крейті

Шаблон (крок 1) демонструє лише скаффолд з ОДНИМ концерном
(`__CONCERN_ID__` — єдиний плейсхолдер) — це форма scaffold-кроку, не межа
контракту: один guest-крейт МОЖЕ нести кілька контрибуцій. Патерн (зразок —
`crates/plugin-lang-js` — два концерни, і `crates/test-plugin-guest` — три
тест-хуки):

### Концерн ЛИШЕ для фіксу (`fix_only_concerns`, контракт `4.0.0`)

Якщо плагін має дати фікс, але детект концерну має лишитись за чинною
JS/policy-реалізацією, ключ іде в `Manifest::fix_only_concerns`, а НЕ в
`concerns`. Різниця не косметична: будь-який ключ у `concerns` вмикає
detect-шедоуїнг — `npm/scripts/lib/lint-surface/detect.mjs` ПОВНІСТЮ заміняє
`main.mjs`/policy-детект концерну викликом `detect()` плагіна. До контракту
`4.0.0` способу «лише fix» не існувало взагалі, і оголошення концерну заради
фіксу мовчки вимикало його детект.

Ключ РІВНО в одному зі списків: маніфест, що називає його в обох, хост
відхиляє на завантаженні (`rules_contract::validators::manifest`) — два
взаємно виключних наміри, які хост не вгадує.

### Окремий скоуп фіксу (`fix_glob`, контракт `4.0.0`)

`ConcernContribution.fix_glob` — глоби, за якими хост будує batch і знімки
host-diff саме для `fix`. Порожній список = «fix ділить скоуп із детектом»
(fallback на `glob`), і для більшості концернів так і треба.

Заповнюй його, коли скоуп фіксу ШИРШИЙ за скоуп детекту — типово для
exec-tool-фіксерів: детект читає маніфест (`Cargo.toml`), а тул мутує
`src/**`. Без `fix_glob` єдиним виходом було розширити detect-glob заради
фіксу, тобто змусити детект читати зайве; з ним обидва скоупи чесні.

1. `Manifest::concerns` — список із кількох `ConcernContribution` (кожен свій
   `key`/`scope`/`glob`), не один елемент.
2. `Guest::detect` розгалужується за `batch.concern-id` (`if`/`match` на
   константи-ключі концернів) — кожна гілка кличе СВІЙ чистий helper.
   `report_progress`/`log` лишаються в тілі `Guest::detect`, не в helper-ах
   (той самий мотив, що й форма з одним концерном).
3. Після scaffold-кроку вручну додай додаткові константи-ключі, гілку в
   `build_manifest().concerns` і гілку в `Guest::detect` — інструменти скіла
   (шаблони) генерують стартову форму з ОДНИМ концерном, розширення на кілька
   концернів — ручний крок 2, не окремий шаблон.

### Full-scope / whole-batch концерн

Шаблон демонструє лише `detect_one_file(file) -> Option<Diagnostic>` (одна
перевірка на ОДИН файл). Якщо концерн — крос-файлова/whole-repo перевірка
(напр. «клас, використаний у файлі A, має бути визначений десь у файлах
B/C/…», зразок — `style/gap`, `crates/plugin-lang-js`), чиста логіка НЕ
per-file: пиши `detect_whole_batch(files: &[SourceFile]) -> Vec<Diagnostic>`
(чи подібну назву), яка аналізує ВЕСЬ переданий `&[SourceFile]` разом, і
клич її з `Guest::detect` замість `files.iter().filter_map(detect_one_file)`.

Дві речі мають узгоджуватись, щоб цей концерн реально отримував whole-repo
`files`, коли викликач не передав дельту:

1. `ConcernContribution.scope = ConcernScope::Full` і непорожній `glob`
   (посилання на файли, які концерн хоче бачити — той самий синтаксис, що й
   `concern.json.lint.glob` JS-плагінів).
2. Викликач (napi-міст `crates/rules-napi::run_wasm_concern`) розрізняє
   `files: None` (host сам будує batch за `glob` контрибуції,
   whole-repo обхід) від `files: Some([])` (явно порожній batch) — це вже
   реалізовано хостом, автору концерну лишається коректно заповнити
   `scope`/`glob` у `build_manifest()`.

#### Розбіжність full-scope мосту: `.n-rules.json`-ignore не застосовується

Виявлено задачею Q1 батч 1 (`plugin-lang-js`). Host-бік full-scope збору
(`crates/rules-napi::build_full_scope_files`) будує whole-repo batch через
`rules_core::scan::walk_dir(cwd, &[])` (`.gitignore` +
дефолтний `.git`/`node_modules`/worktrees-набір) відфільтрований `glob`
контрибуції — і **все**. Якщо JS-оригінал, що ти портуєш, збирав файли через
`walkDir(cwd, onFile, ignorePaths)` з ДОДАТКОВИМ `ignorePaths`
(найчастіше — `loadCursorIgnorePaths(cwd)`, `npm/scripts/lib/load-cursor-config.mjs`:
консюмер-специфічний `ignore` у `.n-rules.json`, понад дефолтний набір), wasm-порт
цей додатковий ignore-список НЕ відтворює — `build_full_scope_files` про нього
не знає і сама зміна цієї функції (щоб читала `.n-rules.json`) — інфраструктурна
робота понад один плагін (торкається УСІХ full-scope wasm-концернів одразу), не
задача авторингу одного концерну.

Що робити, портуючи такий концерн:

1. `ConcernContribution.glob` — точний відповідник `concern.json.lint.glob`
   JS-оригіналу (як завжди) — host звужує whole-repo обхід ще ДО читання
   вмісту, це не міняється.
2. Якщо JS-оригінал використовував додатковий предикат файлу ПОНАД glob (напр.
   `isTestFile(absPath)` — перевірка суфікса імені, не лише шаблону каталогу
   — зразок: `npm/scripts/lib/collect-test-files.mjs`), відтвори цей
   предикат як гість-фільтр УСЕРЕДИНІ чистої `detect_whole_batch`-функції
   (той самий мотив, що `detect_one_file_tfm`'s `!file.path.ends_with(".vue")`
   у `crates/plugin-lang-js`) — захист, якщо `detect` цього концерну колись
   викличуть з файлами поза очікуваним підмножиною (напр. прямий per-file
   виклик, не лише full-scope міст).
3. **Задокументуй розбіжність** doc-коментарем біля чистої функції (зразок —
   `detect_no_process_chdir`, `crates/plugin-lang-js/src/lib.rs`): яка саме
   JS-поведінка (`ignorePaths`/`.n-rules.json` `ignore`) не відтворена і чому
   (обсяг задачі — не інфраструктура host-боку). Не намагайся мовчки
   "виправити" це патчем `build_full_scope_files` в межах задачі одного
   концерну — зміни там торкаються `style/gap`/усіх наявних full-scope
   концернів одночасно і потребують окремого regression-покриття.

### Домени поза lint (рішення К спеки)

Якщо плагін підтримує `ecosystem-outdated`/`docgen-render` — реалізуй
відповідний `Guest`-метод і додай домен у `Manifest::domains`. Якщо ні —
лиши заглушку `Err(DomainError::NotSupported)` (шаблон уже так робить) і
**не** додавай домен у `describe()`: хост будує мапу «домен → підтримка»
рівно з `Manifest::domains` і не викликає незадекларовані експорти —
заглушка існує на випадок розсинхрону, не як основний шлях.

## Крок 3 — golden-тести через rules-plugin-host

Інтеграційний тест на **зібраному** `.wasm` (не на Rust-функціях напряму) —
зразки: `crates/rules-plugin-host/tests/plugin_lang_js.rs` (реальний плагін,
два концерни) і `tests/contract_test_kit.rs` (мінімальна фікстура, ширше
покриття API `PluginHost`/`LoadedPlugin`).

1. Постав тест у `crates/rules-plugin-host/tests/<plugin_id>.rs` (той самий
   крейт, що й зразки — golden-тести плагінів живуть поруч із хостом, не в
   крейті самого плагіна).
2. `require_fixture()`-мотив: **жодного мовчазного skip**. Якщо `.wasm` не
   зібраний — тест панікує з точною командою збірки (`bash crates/<name>/build.sh`
   чи `bash <plugin-repo>/build.sh`), як в обох зразках.
3. Публічний API — лише `PluginHost::new(run_tool_callback)` →
   `host.load(path, world_version)` → `plugin.describe()`/`plugin.detect(&batch)`/
   `plugin.fix(&request)` (`crates/rules-plugin-host/src/lib.rs` документує
   повний потік). Жоден `wasmtime`/`wit-bindgen` тип не потрібен на боці
   тесту плагіна — вузький публічний trait хоста (рішення М спеки) свідомо
   ізолює Component Model API churn.
4. Мінімум перевірок: `describe()` — `id`/`world_version`/`domains`/`concerns`/`capabilities`;
   `detect()` — рівно очікувана кількість діагностик, `reason`/`severity`/`file`/`message`
   на кожному файлі-фікстурі (violate + clean case); якщо плагін підтримує
   `fix` — окремий тест на `FixPlan`.
5. `run_tool` callback у тестах — заглушка (`stub_run_tool()` у зразках),
   якщо плагін не декларує `tools` у маніфесті.

**Скіл сам себе перевіряє в CI**: `crates/rules-plugin-host/tests/wasm_plugin_skill_smoke.rs`
ганяє детермінований scaffold → build → detect за цими самими шаблонами на
концерні-фікстурі — якщо цей документ і шаблони розійшлись із реальним
конвеєром, той тест падає (мітигація §3.6 спеки, деталі в кроці нижче
«CI-смок цього скіла»).

## Крок 4 — publish (дистрибуція)

1. **Release-збірка**: `bash crates/<name>/build.sh` (чи `build.sh` кореня
   стороннього репо) — виводить абсолютний шлях до `<crate>_stem.wasm`
   (`wasm32-wasip2/release/`).
2. **sha256**: `shasum -a 256 <шлях_до_.wasm>` — перші 64 hex-символи виводу
   (нижній регістр) — це і є пін.
3. **Форма піна для консюмера** (`wasmPlugins` у `.n-rules.json`, схема
   `npm/scripts/lib/lint-surface/wasm-plugins.mjs`):

   ```json
   {
     "wasmPlugins": [
       { "name": "<plugin-id>", "url": "https://…/<crate>.wasm", "sha256": "<64-hex>" }
     ]
   }
   ```

   `url` — транспорт-агностичний (GitHub Releases — первинний для власних
   плагінів; OCI/npm — опційні дзеркала). Хост кешує за sha256
   (`~/.cache/@7n/rules/plugins/<sha256>.wasm` mac/linux,
   `%LOCALAPPDATA%\@7n\rules\plugins\` на Windows) і звіряє реальний hash
   вмісту при кожному кеш-хіті — підміна/пошкодження під тим самим імʼям не
   пройде мовчки.

4. **Dev-петля** (лише поза CI — `wasm-plugins.mjs` явно відхиляє цю форму
   під `env.CI`):

   ```json
   {
     "wasmPlugins": [
       { "name": "<plugin-id>", "path": "./target/wasm32-wasip2/release/<crate>.wasm" }
     ]
   }
   ```

5. **TODO(v3-wasm-first-party-pins)**: вбудована таблиця `name → url+sha256`
   для власних (first-party) плагінів цього репо (спека §3.4, рішення Н) ще
   не існує — до її появи будь-який плагін, включно з first-party,
   потребує ручного піна в конфізі споживача. Не вигадуй цю таблицю
   заздалегідь — коли зʼявиться перший опублікований плагін, її додасть
   окрема задача.

## Межі (capabilities) — тримай мінімальними

- **`fs_read`**: типовий концерн лишає **порожнім**. Хост уже читає вміст
  файлів під час scan-у і передає його inline у `detect-batch`/`fix-request`
  (спека §3.2) — плагін не робить повторний IO. Заповнюй `fs_read` лише
  якщо концерну справді потрібен доступ поза переданим батчем (рідкісний
  випадок — обґрунтуй у коментарі `plugin.toml`).
- **`network`**: `false` за замовчуванням, і майже завжди має лишитись
  таким — enforcement на боці `PluginHost` (`WasiCtx` без мережевих
  дозволів, доки `capabilities.network` явно `true`). Мережевий доступ —
  усвідомлене виключення, не дефолт.
- **`tools`** (host-mediated spawn, рішення Д спеки, задача N1): плагін
  декларує `tools = ["shellcheck@^0.9"]` у `plugin.toml`, кличе `run-tool` —
  сам нічого не спавнить (wasm фізично не може). **Контур WIRED
  (задача N1)**:
  - Host-бік (`crates/rules-plugin-host/src/tool_resolver.rs`):
    `ToolResolver` — мапа «ім'я тула (без semver-суфікса декларації) →
    абсолютний шлях бінаря». Виклик `run-tool` із тулом ПОЗА мапою → типізована
    помилка ВСЕРЕДИНІ `tool-output` (`status: none`, людиночитний `stderr`),
    НЕ паніка. Резолвлений тул виконується через `std::process::Command`
    (stdout/stderr/exit-code капчурені), з таймаутом 120с (`DEFAULT_TOOL_TIMEOUT`) —
    процес, що не встиг, примусово вбивається (разом з усіма форкнутими
    нащадками — `process_group`/`kill(-pid, SIGKILL)` на unix). Версійний
    діапазон декларації (`@^0.9`) хост-бік ІГНОРУЄ — версійну політику
    реалізує ensure-tool на JS-боці (ставить канонічну закріплену версію з
    `tool-pins.json` ще ДО того, як шлях потрапляє в `ToolResolver`).
  - JS-бік (`npm/scripts/lib/lint-surface/wasm-plugins.mjs`): при резолві
    плагіна читає повний маніфест через `wasmPluginManifest()` (napi), для
    кожного `manifest.tools` кличе ensure-tool контур (`ensureToolAsync`,
    `npm/scripts/lib/ensure-tool.mjs`) — будує мапу «ім'я → шлях»,
    прокидає її в `runWasmConcern(..., toolPaths)`. Тул, якого ensure-tool
    не знає (немає в `TOOLS`-реєстрі) чи не зміг поставити (мережа,
    rate-limit) — `console.warn`, ПРОПУСКАЄТЬСЯ з мапи (skip-not-crash на
    рівні ОДНОГО tool-у, не плагіна) — плагін і решта його tools лишаються
    робочими, виклик `run-tool` для ЦЬОГО tool-у отримає типізовану помилку
    в `tool-output` (host-бік вище).
  - Реальний прогін через `n-rules lint` тепер ВИКОНУЄ задекларований tool
    (не заглушка). Golden-тести плагіна (крок 3) з `ToolResolver::empty()`
    (порожній) усе одно валідні для концернів без tools; якщо плагін
    декларує tools і golden-тест має перевірити реальний виклик — резолвни
    фейковий бінарник (shell-скрипт у tempdir) у `ToolResolver::new(map)`
    (зразок — `run_tool_reaches_resolved_fake_tool_binary`
    `crates/rules-plugin-host/tests/contract_test_kit.rs`).
- **`exec-tool`** (зріз 5 контракту v3.1, спека
  `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`, рішення А/Б/В/З) —
  `run-tool` ПЛЮС виконавчий контекст. Бери його, якщо тулу потрібне бодай
  щось із трьох:
  - **`cwd`** (posix-relative від кореня репо; `none` — сам корінь). Без
    нього процес успадковує cwd ХОСТ-процесу, який збігається з коренем репо
    випадково. Обгортка, що читає `node_modules`/конфіги відносно себе, без
    цього поля перевіряє не той каталог;
  - **`env`** — пари НАКЛАДАЮТЬСЯ поверх успадкованого середовища, не
    заміщують його;
  - **scratch-обмін**: `scratch-in` хост матеріалізує у тимчасовому каталозі
    ПЕРЕД спавном (вшиті в компонент конфіги/політики), `scratch-out` —
    глоби файлів, які хост зчитує ПІСЛЯ виходу процесу (звіти тула).
    Абсолютний шлях каталогу гість бере зі слоту `scratch-dir@1`
    (`host-context`) і САМ кладе його в `args` — placeholder-підстановки в
    аргументах контракт свідомо не має. Каталог живе РІВНО один
    `detect`/`fix`-виклик, тож шлях не можна кешувати між викликами;
    відсутній `scratch-out`-файл — не помилка, а «звіту немає».

  Помилки — та сама форма, що в `run-tool`: `status: none` + людиночитний
  `stderr`, ніколи не паніка. `exec-tool` виконує ВЖЕ зарезолвлений тул і
  нічого не добуває — провізіонінг живе в окремій команді `tools ensure`.

  **Схеми `manifest.tools`** (рішення В): `pinned:` (дефолт за відсутності
  схеми — github-реліз із закріпленою версією), `path:` (резолв по `PATH`:
  `path:bun`, `path:bunx` — те, що ensure-tool завантажити не може й не має)
  і `npm:` (`<cwd>/node_modules/.bin/<name>`, фолбек `PATH` —
  `npm:stylelint`, тобто задекларована залежність npm-пакета плагіна).

  > **Trust boundary — прочитай ДО того, як напишеш перший `exec-tool`.**
  > Спавнений тул виконується **з правами хоста, ПОЗА wasm-пісочницею**, і
  > **МОЖЕ писати в репо**. Ані `fs_read`, ані `network` до нього не
  > застосовуються: пісочниця обмежує wasm-код гостя, а не процес, який гість
  > попросив запустити. Хост звужує лише ЯКИЙ бінарник (задекларований),
  > ЗВІДКИ він стартує (`cwd` — безпечний repo-relative) і ЩО потрапляє у
  > scratch (без `..`, з лімітами). Тобто **межа довіри плагіна — його пін
  > (`url` + `sha256`), а не пісочниця**: ревʼю піна = ревʼю прав.
  > Enforcement не додається свідомо (потрібен був би власний sandbox-шар
  > навколо спавна на трьох ОС).

  Живий зразок — `bun/licensee` (`crates/plugin-lang-js/src/lib.rs`, секція
  «Зріз 5»); golden-тести з фейковим `bun` —
  `crates/rules-plugin-host/tests/plugin_lang_js.rs`; повний контекст разом
  (cwd + env + scratch) — `test/guest-exec-tool`
  у `crates/test-plugin-guest`.
- **`ci_artifacts`** (слот `ci.artifact@1`): типізовані записи
  `n-rules:slots` (`crates/rules-contract/src/slots/ci_artifact.rs`) —
  семантичні перевірки (safe-path, id-regex) живуть у
  `crates/rules-contract/src/validators/ci_artifact.rs` (host-валідатори,
  не WIT-типізація — рішення Л спеки). Заповнюй лише якщо плагін реально
  робить contribution у слот; порожній `ci_artifacts = []` — типовий випадок.

## CI-смок цього скіла

`crates/rules-plugin-host/tests/wasm_plugin_skill_smoke.rs` — детермінований
(без LLM) прогін кроку 1 цього документа: бере ті самі шаблони
(`npm/skills/wasm-plugin/template/*`), підставляє плейсхолдери
концерну-фікстури (`skill-smoke/forbidden-marker` — детект забороненого рядка-маркера),
пише в ізольований `tempfile::tempdir()`, запускає скопійований `build.sh`,
вантажить зібраний `.wasm` через реальний `PluginHost` і жене `detect` на
файлі-порушнику й чистому файлі. Живе в `rules-plugin-host` (не окремий
workflow) — цей крейт уже покритий `cargo test --workspace` у
`.github/workflows/lint-rust.yml`, де `wasm32-wasip2`/`wasm-tools` уже
встановлені для сусідніх guest-фікстур — нуль нових рядків workflow.

Локально: `cargo test -p rules-plugin-host --test wasm_plugin_skill_smoke`.
Якщо цей тест падає після правки шаблонів чи `wit/world.wit` — конвеєр,
описаний цим SKILL.md, більше не робочий; полагодь ПЕРЕД тим, як покладатись
на скіл для реального плагіна.

## Примітка

Окремих команд `check`/`fix` для цього скіла немає — авторинг плагіна
завершується зеленим `cargo test -p rules-plugin-host --test <plugin_id>`
(крок 3) і, за потреби публікації, обчисленим sha256 (крок 4). Дельта-лінт
(`npx @7n/rules lint`) проекту як завжди застосовний до змінених `.rs`-файлів
цього скіла (rustfmt/clippy через `rust.mdc`) — не підміняє golden-тести.
