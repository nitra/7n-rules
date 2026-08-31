# Розвідка: `npm/scripts/lib/lint-surface/**` — що лишається JS і чому

Дата: 2026-08-31. Область: `npm/scripts/lib/lint-surface/` — 25 продуктивних
`.mjs`, 6576 рядків (`wc -l npm/scripts/lib/lint-surface/*.mjs`). Тести
(`lint-surface/tests/`) і файлова дока (`lint-surface/docs/`) поза підрахунком.

Документ — **розвідка**, не план. Кожне твердження про поточний стан має
адресу файл:рядок. Твердження без адреси — це висновок автора, і він
позначений явно.

Паралельно велися дві інші розвідки (решта `npm/scripts/lib` + `npm/bin`;
`coverage-provider`/`npm/rules`/`skills`) — їхні області тут не розглядаються.

---

## 1. Три канали Rust ⇄ JS, які треба тримати в голові

`lint-surface` живе на перетині **трьох** різних мостів, і плутанина між ними
— головна причина застарілих тверджень у документах (розділ 5).

| Канал | Напрям | Хто ініціює | Точка входу |
|---|---|---|---|
| **napi-аддон** | JS → Rust, синхронно, in-process | JS-оркестратор | `npm/scripts/lib/native.mjs` (`loadNative()`), Rust-бік `crates/rules-napi/src/lib.rs` |
| **зворотний міст** (NDJSON поверх unix-сокета) | Rust → JS, довгоживучий дочірній процес | `rules-cli` | `crates/rules-cli/src/bridge.rs`, JS-бік `lint-surface/bridge-host.mjs` |
| **js_fallback** (делегація цілої команди) | Rust → JS, argv-passthrough, окремий процес | `rules-cli` | `crates/rules-cli/src/js_fallback.rs:121` (`delegate`) |

### 1.1. napi — `native.mjs` як дзеркало `js_fallback.rs`

`npm/scripts/lib/native.mjs` — loader аддона: ланцюг кандидатів
(`nativeAddonChain`), `process.dlopen`, звірка `contractVersion()` з
`EXPECTED_CONTRACT_VERSION = 2` (`native.mjs:78`). Каскад резолву
(`N_RULES_NATIVE_ADDON` → локальна збірка у вихідному дереві → platform-підпакет)
свідомо дзеркалить каскад `resolve_entry` у `js_fallback.rs:47-67`
(`N_RULES_JS_ENTRY` → `node_modules/@7n/rules/bin/n-rules.js` → dev-репо).
Обидва — fail-loud, без мовчазного fallback.

Хто з `lint-surface` кличе `loadNative()`: `detect.mjs:14`,
`run-detectors.mjs:19`, `run-fix.mjs:26`, `render.mjs:16`, `wasm-plugins.mjs:118`.

Наявні napi-експорти (`crates/rules-napi/src/lib.rs`, `#[napi]`):
`contract_version`, `resolve_changed_base`, `sanitize_worktree_name`,
`worktree_create`, `worktree_remove`, `collect_changed_files`,
`collect_changed_files_since`, `is_worktree_checkout_path`, `walk_dir`,
`list_native_concerns`, `run_native_concern`, `run_native_concerns_batch`,
`list_native_fixes`, `run_native_concern_fix`, `build_lint_plan`,
`match_lint_globs`, `render_violations`, `sort_and_render_violations`,
`wasm_plugin_concerns`, `wasm_plugin_manifest`, `run_wasm_concern`,
`run_wasm_concern_fix`.

### 1.2. Зворотний міст — де саме проходить межа

`crates/rules-cli/src/lint_cmd.rs:13-25` містить таблицю поділу. Перевірено
проти коду — таблиця відповідає реалізації:

- дискавері `concern.json` + мердж по каталогах — Rust
  (`lint_cmd.rs:274-299`, `discover_by_rule`);
- capability-фільтр — Rust (`lint_cmd.rs:303-325`);
- rule-level гейт: **декларативний** — Rust (`lint_cmd.rs:339-352`,
  `rules_core::rule_applies`), на міст іде **лише** `AppliesSpec::Dynamic`
  (`lint_cmd.rs:349`);
- план, native-концерни, сортування/рендер/exit-код — Rust;
- **міст** (`bridge-host.mjs`) відповідає рівно на 4 операції:
  `discover` (резолв плагінів + ключі wasm-концернів), `applies` (лише
  dynamic-гейти), `detect` (батч концернів з `main.mjs`/policy),
  `ensureTool` (GitHub-Release гілка ensure-tool);
  диспатч — `bridge-host.mjs:224-247`.

Native-шлях `lint` **не дефолтний**: вмикається `--native-detect` або
`N_RULES_NATIVE_LINT=1` (`lint_cmd.rs:79-81, 105-112`). Він же чесно
делегує назад у JS, коли паритет недосяжний (`lint_cmd.rs:147, 153, 157, 173`):
без `--no-fix`, з `--path`, і якщо план зачепив wasm-концерн
(`lint_cmd.rs:234-241`).

`ci plan` має власну межу: native-шлях умикається лише коли плагіни
доказово порожні й усі гейти резолвляться нативно
(`ci_cmd.rs:100-115`, `native_eligible`). Інакше — делегація.

### 1.3. js_fallback — що ще делегується цілком

Точки виклику `js_fallback::delegate` у дереві: `main.rs:145`, `main.rs:184`
(argv не розібрався clap-ом), `main.rs:270` (`NativeCommand::Skill`),
`ci_cmd.rs:100/107/111/114`, `hook_cmd.rs:87`, `hook_cmd.rs:97`
(`delegate_with_stdin` — stdin переграється), `lint_cmd.rs:191`.

---

## 2. Пофайловий розбір

Класи: **A** — портовне як є; **B** — потребує нового host-каналу або зміни
контракту; **C** — структурно не портовне (з доказом); **D** — має зникнути
разом зі зрізом 6, портувати не треба.

### Зведена таблиця

| Файл | Рядків | Rust-відповідник | Клас |
|---|---:|---|:--:|
| `run-fix.mjs` | 1331 | `crates/rules-fix` (частковий) + `n7n-harness` | B |
| `run-detectors.mjs` | 882 | `rules-cli/lint_cmd.rs` + `rules-core/lint_plan.rs` (ядро портоване) | B ¹ |
| `wasm-plugins.mjs` | 713 | немає (лише виконання — `rules-plugin-host`) | B |
| `tier-sampling-bench.mjs` | 457 | немає | D |
| `detect.mjs` | 333 | `lint_cmd.rs::execute_plan` + `rules_core::concerns` (частковий) | B |
| `lint-lock.mjs` | 332 | немає (`tool_lock.rs` — інший лок) | A |
| `bridge-host.mjs` | 298 | `crates/rules-cli/src/bridge.rs` (протилежний бік) | C |
| `tier-sampling-experiment.mjs` | 290 | немає | D |
| `ci-plan.mjs` | 276 | `rules-core/ci_plan.rs` + `rules-cli/ci_cmd.rs` (повний порт) | A |
| `mt-tail.mjs` | 216 | немає | B |
| `progress.mjs` | 210 | немає | A |
| `types.mjs` | 163 | типи `rules-contract`/`harness` | D |
| `policy-test-step.mjs` | 149 | немає; **живих викликів немає** | D |
| `collateral-veto.mjs` | 131 | `n7n-harness::collateral` (повний порт) | D |
| `policy-lint-adapter.mjs` | 104 | `rules-core/conftest.rs` (частковий) | B |
| `path-scope.mjs` | 104 | немає | A |
| `ladder.mjs` | 101 | `n7n-harness::ladder` (повний порт) | D |
| `scheduler.mjs` | 96 | немає | A |
| `snapshot.mjs` | 89 | `n7n-harness::snapshot` (повний порт) | D |
| `test-gate.mjs` | 87 | `n7n-harness::test_gate` (повний порт) | D |
| `default-worker.mjs` | 67 | `rules-fix/workers.rs` + `llm_lib` | B |
| `violation-reporter.mjs` | 46 | немає (не потрібен) | D |
| `render.mjs` | 40 | `rules-core/lint_render.rs` (повний порт) | D |
| `blocking-inventory.mjs` | 31 | немає (не потрібен) | D |
| `codegen-opa-wrapper.mjs` | 30 | немає | A |

¹ Ядро файлу (дискавері, фільтри, план, диспатч, рендер) — класу A і вже
портоване; до B його зараховує хвіст (резолв плагінів). Детально — 2.2.

---

### 2.1. `run-fix.mjs` — 1331 рядок. Клас **B**

**Що робить.** Центральний fix-конвеєр: для кожного концерну плану виконує
послідовність «detect → T0 (детерміновані правки, поза rollback) → snapshot S1
→ re-detect → драбина тирів (restore S1 → worker → detect)* → rollback S1»
(доккомент `run-fix.mjs:1-16`). Тут же живуть: резолв T0-патернів із трьох
джерел (native-фікси реєстру, wasm-плагіни, `fix-<concern>.mjs`);
`guestFix`-переривання циклу T0; застосування правок плану на диск
(`applyPlanEdit`, включно з `write-bytes`/base64); collateral-veto й test-gate
на verdict-фазі; бюджет `cloud-avg`; фінальний рендер невиправленого хвоста і
його матеріалізація у MT-граф.

**Rust-відповідник — частковий, і це паралельна реалізація, не заміна.**
`crates/rules-fix` (2355 рядків: `lib.rs`, `t0.rs`, `attempt.rs`, `workers.rs`,
`verify.rs`, `detect.rs`, `config.rs`, `violation_map.rs`) склеює
`llm_lib::fix`/`harness::pipeline` з `rules-core`. Доккомент
`rules-fix/src/lib.rs:1-24` описує його саме як склейку.

Ключова відмінність архітектури, яку не можна пропустити при порті:
`rules-fix/src/t0.rs:1-11` — T0 у Rust **декларативний** (`harness::pipeline::T0Step`
рахує `EditPlan`, застосовує хост двома фазами `prepare` → журнал → `commit`),
тоді як JS `applyT0` (`run-fix.mjs:477-499`) пише файли одразу, без журналу.
JS-коментар `run-fix.mjs:96-105` це визнає прямо: «T0-патерни тут пишуть
напряму, без журналу — рекурсивний `fs.rm` дає той самий кінцевий стан без
потреби повторювати журнальну машинерію».

Доступ до Rust-контуру — прапорець `--native-fix` (`rules-cli/src/fix_cmd.rs:33`),
і він приймає **рівно один** ключ `rule/concern`
(`fix_cmd.rs:18-22`: «Приймається РІВНО один concern-ключ … спільний бюджет на
кілька concern-ів зʼявиться разом із native-планом фіксу»). Тобто плану фіксу
в Rust немає — `runFixPipeline` (`run-fix.mjs:1214`) не має відповідника.

**Чому B, а не A.** Три речі вимагають нового каналу:

1. **`fix-<concern>.mjs` — T0-патерни як виконуваний JS.**
   `loadT0Patterns` робить `await import(pathToFileURL(fixPath).href)`
   (`run-fix.mjs:414`) і читає експорт `patterns`. Живих таких файлів у
   дереві **7**, усі в плагінах: `plugins/lang-js/rules/test/stryker_config/`,
   `.../test/storybook-vitest-config/`, `.../js/eslint/fix-eslint.mjs`,
   `.../bun/package_json/fix-package_json.mjs`,
   `plugins/ci-azure/rules/azure-pipelines/service_deploy_pipeline/`,
   `plugins/ci-github/rules/ga/service_deploy_workflow/`,
   `plugins/ci-github/rules/ci_artifact/consume/`. У `npm/rules/` — **нуль**.
2. **`fix-worker.mjs`** — `loadFixWorker` (`run-fix.mjs:438-452`) теж динамічний
   `import()`. Живих 4: `npm/rules/test/coverage/`, `npm/rules/doc-files/check/`,
   `npm/rules/text/cspell-fix/`, `plugins/lang-js/rules/js/eslint/`. З них
   `text/cspell-fix` уже портовано — `rules-fix/src/workers.rs:38-41`
   (`has_fix_worker(key) → key == "text/cspell-fix"`).
3. **MT-хвіст** — `materializeTailToMt` (`run-fix.mjs:1188`) робить
   `await import('./mt-tail.mjs')`; MT — зовнішня система (див. 2.10).

**Що з нього вже НЕ треба портувати** (є в `n7n-harness`, розділ 2.14–2.17):
драбина, snapshot/rollback, collateral-veto, test-gate.

**Назва каналу для B.** Потрібен один із двох:
- **WIT**: `fix`-гілка вже є в контракті плагінів (`run_wasm_concern_fix`,
  `rules-napi/src/lib.rs:1172`), тож 7 `fix-*.mjs` і 3 непортовані
  `fix-worker.mjs` мають переїхати в гостей — це не новий канал, а
  використання наявного;
- або **розширення `bridge`** операцією `t0`/`fixWorker` — але це прямо
  суперечить меті «повна відсутність JS», бо консервує JS-виконавця.

---

### 2.2. `run-detectors.mjs` — 882 рядки. Клас **B** (ядро — **A**)

**Що робить.** Дискавері правил і концернів по всіх rules-каталогах, три
фільтри (capability, rule-level `applies`, enabled з `.n-rules.json`),
побудова плану через native `buildLintPlan`, розбиття плану на сегменти,
виконання (послідовно або двома лейнами), рендер і exit-код. Експорти:
`DEFAULT_RULES_DIR` (:30), `buildDetectPlan` (:409), `loadEnabledLintRules`
(:430), `computeActiveDomains` (:450), `detectAll` (:813).

**Rust-відповідник — найповніший у всій області.** `buildPlan`
(`run-detectors.mjs:487-549`) уже є **фасадом над native**: усі п'ять гілок
кличуть `loadNative().buildLintPlan({mode: …})` (рядки 503, 508, 517, 522, 528).
Дискавері й фільтри портовано в `rules-cli/src/lint_cmd.rs`
(`discover_by_rule` :274, `filter_by_capabilities` :303,
`filter_by_applies` :339), сам план — `rules-core/src/lint_plan.rs`.
Диспатч — `lint_cmd.rs::execute_plan`, рендер — `rules_core::lint_render`.

Тобто станом на сьогодні це **дві повні паралельні реалізації** оркестрації
detect: JS (`detectAll`) і Rust (`run_native`), і хто кого кличе залежить від
прапорця. Обидві кличуть один і той самий `rules-core` для плану й рендеру.

**Хто кличе `detectAll` (JS-шлях):** `npm/scripts/hook.mjs:21`,
`npm/scripts/post-tool-use-check.mjs:17`,
`npm/bin/n-rules-cli.mjs:1924` (динамічний `import`).

**Що ще НЕ портовано з цього файлу:**
- `effectiveRulesDirs`/`filterByCapabilities` вхід — резолв плагінів
  (`plugin-slots.mjs` 670 рядків + `resolve-plugins.mjs` 455 = 1125; саме це
  `ci_cmd.rs:9-15` називає «~1200 рядків JS, окремий зріз»). Це **не в моїй
  області**, але це єдиний блокер `discover`-операції мосту;
- `resolveSlotGlobs` (:319), `slotExtensions` (:294) — розширення глобів зі
  slot-графа;
- `warnAboutRulesWithoutConcerns` (:259) — `console.error`-побічний ефект,
  який `lint_plan.rs:44-50` називає причиною лишити `enabledRuleIds` у JS;
  у Rust-шляху це вже робить `rules_core::config` (`lint_cmd.rs:20`);
- двохлейновий scheduler (див. 2.18) і progress (2.11).

**Клас.** Ядро (дискавері, фільтри, план, диспатч, рендер) — **A**, доказово:
воно вже портоване й працює під прапорцем. Хвіст (резолв плагінів) — **B**,
і борг лежить поза цією областю.

---

### 2.3. `wasm-plugins.mjs` — 713 рядків. Клас **B**

**Що робить.** Резолвер wasm-плагінів контракту `n-rules:plugin@4.0.0`: читає
секцію `wasmPlugins` з `.n-rules.json` консюмера, зливає її з вбудованою
таблицею first-party пінів `npm/wasm-plugins/builtin-pins.json`
(`mergeWithBuiltinEntries` :277), для кожного запису резолвить `.wasm`
(dev-`path` / канонічний `url`+`sha256` з кешем і перевіркою хешу /
builtin-`file`), питає napi `wasmPluginManifest()`, резолвить задекларовані
зовнішні тули через `ensureToolAsync` і будує дві мапи:
`ruleId/concernId → {wasmPath, toolPaths}` для detect (`resolveWasmConcernMap`
:629) і окрему для fix-only (`resolveWasmFixOnlyConcernMap` :647).

**Rust-відповідник — немає.** Виконання wasm є (`crates/rules-plugin-host`:
`host.rs`, `loaded_plugin.rs`, `tool_resolver.rs`, і napi-обгортки
`wasm_plugin_manifest` `rules-napi/src/lib.rs:640`, `run_wasm_concern` :1474,
`run_wasm_concern_fix` :1172), але **резолв — ні**. Пошук `wasmPlugins` по
`crates/` дає одне влучання, і те в коментарі `plugin-lang-js/plugin.toml:14`.
Прямий наслідок: `lint_cmd.rs:234-241` гейтить native-шлях і делегує в JS,
щойно план зачепив wasm-концерн.

**Чому B і що саме за канал.** Це не «портувати як є» — це перенесення
дистрибуційної відповідальності. Файл робить мережевий retrieval, керує
кешем (`~/.cache/@7n/rules/plugins/`), звіряє sha256, атомарно публікує в
кеш. План міграції вже призначив цьому інший канал:
`docs/plans/2026-08-29-js-rust-migration-completion-plan.md:80` — рядок **Д3**:
«`npm/wasm-plugins/` видаляється; `builtin-pins.json` переродити в
lock-формат `oci-dist`, не заводити другий». Тобто порт цього файлу = не
переписати 713 рядків на Rust, а замінити їх споживанням
`oci-dist-package`/`oci-dist-oci`.

**Контракт, який треба назвати.** `resolveWasmConcernMap` віддає
`toolPaths`, які `run_wasm_concern` перетворює на host-бічний `ToolResolver`
(`crates/rules-plugin-host/src/tool_resolver.rs`). Після порту резолву в Rust
napi-межа `run_wasm_concern(wasmPath, key, cwd, files, toolPaths)`
(`rules-napi/src/lib.rs:1474`) стає внутрішньою — `toolPaths` більше не
переїжджає через JSON. Це зміна napi-контракту (`contractVersion` 2 → 3).

---

### 2.4. `detect.mjs` — 333 рядки. Клас **B**

**Що робить.** Запуск detector-а одного концерну й нормалізація результату.
Диспатч чотириступеневий, порядок важливий (`runConcernDetector` :225):
native-реєстр (`NATIVE_CONCERNS`) → wasm-мапа → чистий policy-концерн
(`evaluatePolicyConcern`) → `main.mjs` через динамічний `import()`.
Плюс `normalizeResult`/`normalizeViolation` (:130, :81),
`toolProvisionSkipResult` (:165, fail-open на `ToolProvisionError`),
`isBuiltinNativeConcern` (:54) для батчингу сегментів.

**Rust-відповідник — частковий.** Гілки 1 і 2 в Rust є
(`rules_core::concerns::run_concern` / `batch`, 47 ключів у
`NATIVE_CONCERNS`, `rules-core/src/concerns/mod.rs:230`; wasm — через
`rules-plugin-host`). Гілки 3 і 4 — ні; саме вони й є вмістом
операції `detect` мосту (`bridge-host.mjs:168-210`), яка кличе цю ж
`runConcernDetector` — жодної другої реалізації detect-семантики Rust не
заводив (це прямо задекларовано в `bridge-host.mjs:161-166`).

**Скільки коду ще за цією межею.** Живих `main.mjs`-детекторів у дереві —
**23**: 12 у `npm/rules/` (усі `doc-files/*` — 11, плюс `test/coverage`) і
11 у `plugins/` (`lang-js` — 9, `ci-github`, `ci-azure`).

**Чому B.** Гілка `main.mjs` — динамічний `import()` (`detect.mjs:311`), і сама
по собі вона класу C. Але вона **порожніє**: залишок скупчений у трьох
відомих місцях, і для них уже названо вихід —
`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md:920-930`: «Реальні виходи —
лише два: дотягнути порт (`crates/rules-docs` уже несе контур
`package_knowledge`) або винести ці поверхні в wasm-гостей». Тобто канал —
**WIT-гість**, а не новий host-канал; C-шка тут не структурна, а тимчасова.

Що справді потребує уваги при порті: `normalizeViolation` (:81) валідує форму
violation (posix-relative `file` тощо), і `lint_cmd.rs:57-63` фіксує свідому
розбіжність — для native-концернів Rust цієї валідації **не** робить,
покладаючись на типізацію.

---

### 2.5. `lint-lock.mjs` — 332 рядки. Клас **A**

**Що робить.** Глобальна черга `lint --full`: один full-прогін на машину,
решта чекає з видимістю (позиція в черзі, список черги, живий прогрес-бар
активного прогону, ETA). Стан — у `os.tmpdir()/n-rules/lint-full/`
(`lint-lock.mjs:41`): `lock/owner.json`, `queue/<ts>-<pid>.json`,
`progress.json`. Механіка поверх `npm/scripts/utils/with-lock.mjs` з
відмінностями від per-rule використання: machine-wide `cacheDir`,
fingerprint домішує варіант виклику, `staleThreshold` 6 год,
`waitTimeout` 45 хв, `onWaitTimeout: 'fail'` (`lint-lock.mjs:316-332`).

**Rust-відповідник — немає.** `crates/rules-cli/src/tool_lock.rs` — це **інший**
лок (ключ `ensure-tool/<toolId>`, `<git-common-dir>/n-rules/<key>`,
`tool_lock.rs:1-27`), не цей. `lint_cmd.rs:41-43` прямо визнає розбіжність:
«Глобальна черга `--full` (`lint-lock.mjs`) і worktree-ізоляція: detect-only
прогін нічого не мутує, тож чергу native-шлях не бере».

**Чому A.** `tool_lock.rs` доводить, що mkdir-лок із `owner.json` і
PID-перевіркою відтворюється в Rust byte-compatible з JS-стороною. Тут
потрібен лише другий екземпляр тієї самої машинерії плюс TTY-рендер черги
(`renderWaitLine` :236, `createWaitUi` :272) — жодного нового каналу.
Єдина умова: доки існують обидва шляхи (`lint --full` через JS-CLI і через
Rust), лок мусить бути **тим самим** локом, інакше два прогони не побачать
один одного — рівно та пастка, яку `tool_lock.rs:6-13` описує для ensure-tool.

---

### 2.6. `bridge-host.mjs` — 298 рядків. Клас **C**

**Що робить.** JS-бік зворотного мосту: підключається до unix-сокета, який
слухає `rules-cli`, і обслуговує NDJSON request→response.
Чотири операції (`dispatch` :224): `discover`, `applies`, `detect`, `ensureTool`.
`BRIDGE_PROTOCOL_VERSION = 2` (:61), fail-closed звірка на `hello`
(`bridge.rs:37, 143-149`).

**Rust-відповідник.** `crates/rules-cli/src/bridge.rs` — це не порт, а
**протилежний бік того самого каналу**. Порт тут не має сенсу за визначенням.

**Чому C — і що це насправді означає.** Файл не портується, бо він **зникає**
разом із рештою: він існує рівно для того, щоб виконувати JS, якого в Rust
немає. Клас C тут — не блокер, а індикатор: `bridge-host.mjs` — останній
файл області, який має бути видалений, і його видалення — це і є критерій
завершення міграції `lint-surface`.

**Знахідка про поточний стан операції `applies`.** Гілка `Dynamic`
(`bridge-host.mjs:129-159`, `opApplies`) **не має жодного живого споживача в
дереві**: `find … -path "*/applies/main.mjs"` по `npm/rules` і `plugins` дає
нуль файлів, а всі три декларації `applies` у `main.json`
(`plugins/lang-js/rules/npm-module/main.json:3`,
`plugins/lang-rust/rules/rust/main.json:3`,
`plugins/lang-python/rules/python/main.json:3`) — декларативні
(`pathExists`/`globMatches`/`jsonFieldContains`/`any`). Наслідок:
`opApplies` і JS-двійник `evaluateDynamicApplies`
(`run-detectors.mjs:138-166`) сьогодні мертві на цьому дереві. Вони
лишаються аварійним клапаном для сторонніх правил — але **не є причиною
тримати JS**.

---

### 2.7. `ci-plan.mjs` — 276 рядків. Клас **A**

**Що робить.** Обчислює CI-план для `--path <service>` або всього репо:
резолвить дельту, рахує активні домени (правило активне, якщо хоч один його
per-file концерн тригериться на файлах дельти — `computeCiPlan` :112),
перевіряє колізії ключів output, статично визначає наявність тест-файлів у
піддереві. Рендерери: human (:165), GitHub (:188), Azure (:215), JSON.
CLI-обгортка `runCiPlanCli` (:232).

**Rust-відповідник — повний порт, і він уже дефолтний за умов.**
`crates/rules-core/src/ci_plan.rs` (472 рядки: `build_ci_plan`,
`compute_active_domains`, `render_human`, `render_github_lines`,
`render_azure_lines`, `render_json`, `TEST_FILE_GLOBS`) +
`crates/rules-cli/src/ci_cmd.rs` (634 рядки) — заголовок `ci_cmd.rs:1-5`
називає себе «порт `runCiPlanCli`/`computeCiPlan`».

**Хто кого кличе.** `n-rules ci plan` заходить у Rust; Rust делегує назад у
JS (`ci_cmd.rs:100-115`), якщо конфіг битий, корінь пакета не резолвиться,
або `native_eligible` = false (плагіни присутні / битий предикат `applies`).
JS-шлях лишається каноном текстів помилок — це записано в `ci_cmd.rs:29-34`
свідомо.

**Чому A.** Порт зроблено; лишається зняти умову `native_eligible`, а вона
впирається в резолв плагінів (поза областю). Жодної власної перешкоди файл
не має. Дрібниця, на яку варто глянути при видаленні JS-двійника:
`ci-plan.mjs:118` кличе `resolveChangedBase(cwd, baseRef)` без `await`, тоді
як `run-detectors.mjs:527` — з `await`. Обидва працюють (функція синхронна,
napi), але це різне трактування однієї межі.

---

### 2.8. `path-scope.mjs` — 104 рядки. Клас **A**

**Що робить.** Резолвер explicit-files для `n-rules lint --path <dir>`:
перевіряє, що ціль всередині cwd (`assertWithinCwd` :31), і повертає або
перетин піддерева з дельтою (`collectPathScopedChangedFiles` :66), або весь
файловий набір піддерева (`collectPathScopedFiles` :91). На відміну від
`--cwd`, корінь прогону не змінює.

**Rust-відповідник — немає.** Саме через це `lint_cmd.rs:157` делегує
`lint --path` у JS: «з `--path` (перетин піддерева з дельтою живе в
`path-scope.mjs`)». При цьому `ci-plan.mjs:24` імпортує обидві функції — тобто
Rust-`ci plan` уже має власну реалізацію тієї ж логіки
(`ci_cmd.rs` + `cursor_ignore`), а `lint --path` — ще ні.

**Чому A.** Усі будівельні блоки в Rust є: `rules_core::changed_files`,
`changed_base`, `scan::walk_dir`, `concerns::cursor_ignore::walk_repo`
(останній цитується в `rules-fix/src/lib.rs:63-70` як канон порядку
«конфіг → обхід → фільтр»). Нового каналу не треба.

---

### 2.9. `policy-lint-adapter.mjs` — 104 рядки. Клас **B**

**Що робить.** Перетворює policy-поверхню концерну (Rego через `conftest`
або template deep-subset) на уніфікований `LintResult` — `evaluatePolicyConcern`
(:45). Кличеться напряму з `detect.mjs:16`, без генерованого `main.mjs`.

**Rust-відповідник — частковий.** `crates/rules-core/src/conftest.rs`
(523 рядки) + `rules_core::rules_package::rules_root` дають Rust-виклик
`conftest`. Але Rust-гілка працює для **портованих** концернів
(`k8s_hasura_configmap`, `k8s_manifests_rego`, `tauri_tooling`,
`graphql_tooling`, `nginx_default_tpl_template`, `text_markdownlint` —
перелік у `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md:824-830`),
а не як загальний адаптер «будь-який policy-концерн із `concern.json`».

**Чому B, і який саме контракт.** Ключове обмеження названо в тій самій
специфікації, §12.4.1, Факт 2: `run_conftest_batch(&policy_abs, …)` бере
**КАТАЛОГ** полісі, порахований як `rules_root(cwd)` =
`<корінь пакета>/rules/…` (`crates/rules-core/src/rules_package.rs:88-90`).
Тобто доки `.rego` лежать на диску, порт можливий; щойно зріз 6 вшиває їх у
бінар — `conftest` не має що читати. Обраний вихід записано там-таки
(рядки 852-863): **порт на `regorus`** через `crates/rules-rego-engine`, зразок
уже працює в гостях (`crates/plugin-ci-github/src/lib.rs:687-708`,
`crates/plugin-lang-js/src/lib.rs:9654-9716`). Це зміна контракту виконання
полісі, не переписування 104 рядків.

Живих rego-концернів у `npm/rules/` — 4 (`grep -rl '"engine": "rego"'`).

---

### 2.10. `mt-tail.mjs` — 216 рядків. Клас **B**

**Що робить.** Матеріалізує невиправлений хвіст lint-у у вузли MT-графа
(`mt/<node>/task.md` + `a.md`) за контрактом `graph.md`. Кластеризація
(`clusterTail`), сигнатура вузла для ідемпотентності (`fixNodeSignature`),
`materializeTail`. Fail-open наскрізь: MT недоступний → `{materialized:false}`,
lint ніколи не падає.

**Rust-відповідник — немає.**

**Чому B.** MT — зовнішня система з власним контрактом файлів і власною
конфігурацією (`.mt.json`, ENV `MT_AGENT_CLI*`). Порт означає, що Rust-бінар
починає писати чужий формат — це нова інтеграційна поверхня, не перенесення
логіки. Оскільки виклик уже за `await import()` (`run-fix.mjs:1190`), розумний
хід — винести його з `lint-surface` цілком.

---

### 2.11. `progress.mjs` — 210 рядків. Клас **A**

**Що робить.** Спільний ProgressReporter довгих прогонів: монотонний бар по
концернах + тикер «знайдено/виправлено», TTY/не-TTY розгалуження всередині
(`createProgressReporter` :84), і `renderProgressLine` (:28) — рядок, який
читає черга `lint --full`. Єдина зовнішня залежність — `cli-progress`.

**Rust-відповідник — немає.** `lint_cmd.rs:44` фіксує це як свідому
розбіжність native-шляху: «Progress-бар TTY (`progress.mjs`) — вивід прогресу
не відтворюється».

**Чому A.** Чиста presentation-логіка над лічильниками; `cli-progress`
має прямі аналоги в Rust. Один нюанс: `renderProgressLine` — це **контракт
між процесами** (`lint-lock.mjs:38` імпортує його, щоб намалювати чужий
прогрес зі `progress.json`), тож формат знімка треба зафіксувати разом із
портом `lint-lock.mjs`.

---

### 2.12. `scheduler.mjs` — 96 рядків. Клас **A**

**Що робить.** Bounded two-lane конкурентний планувальник для `detectAll`
(`runPlanConcurrently` :43): serial-лейн (послідовний runner для концернів,
що блокують event loop) і parallel-лейн (пул до `concurrency` слотів);
перший виняток зупиняє нові старти в обох лейнах через `AbortController`.

**Rust-відповідник — немає.** `lint_cmd.rs:46-47`: «`N_RULES_LINT_CONCURRENCY>1`
(experimental two-lane scheduler) — native-шлях завжди послідовний, як і
дефолт JS».

**Чому A.** Логіка чиста й невелика; у Rust вона природніша (справжні
потоки замість «структурної конкурентності», яку доккомент файлу
(`scheduler.mjs:6-13`) сам називає ілюзорною для serial-лейну). Разом із
портом зникає й потреба в `blocking-inventory.mjs` (2.24).

---

### 2.13. `codegen-opa-wrapper.mjs` — 30 рядків. Клас **A**

`isGeneratedFile` (:16) — відрізняє застарілий codegen-артефакт `main.mjs` від
ручного (маркер `// @generated — do not edit`); `hasResolvableFiles` (:27) —
чи `policy.files` резолвиться в конкретні таргети. Обидві — чисті предикати
без стану. Rust-відповідника немає; портуються тривіально разом із
диспатчем `detect.mjs`.

---

### 2.14. `ladder.mjs` — 101 рядок. Клас **D**

`buildLadder` (:59), `classifyFixError` (:81), `decideAfterFailure` (:95) —
чисті хелпери тир-драбини з per-tier таймаутами й env-override
(`N_LOCAL_FIX_TIMEOUT_MS` тощо).

**Порт уже існує, поза цим репо.** `n7n-harness-0.3.0/src/ladder.rs:7`:
«Rust-порт `npm/scripts/lib/lint-surface/ladder.mjs`». Крейт підключено —
`crates/rules-fix/Cargo.toml:25` (`harness = { version = "0.3", package = "n7n-harness" }`).

**D**, бо портувати нема чого: залишається лише зняти JS-споживача
(`run-fix.mjs:40`).

---

### 2.15. `snapshot.mjs` — 89 рядків. Клас **D**

Pre-image snapshot/rollback (`createSnapshot` :45): rollback відновлює
pre-image змінених файлів і видаляє лише ті, яких не існувало на момент
знімка. Порт: `n7n-harness-0.3.0/src/snapshot.rs:3` — «Rust-порт
`npm/scripts/lib/lint-surface/snapshot.mjs`».

---

### 2.16. `collateral-veto.mjs` — 131 рядок. Клас **D**

Veto семантичних колатеральних правок: rung не приймається, якщо змінив
наявний файл поза target-set (`findCollateralEdits` :74) або зробив правку
всередині таргет-файлу далі ніж `HUNK_WINDOW = 20` рядків від порушення
(`findInFileCollateralEdits` :124). Порт:
`n7n-harness-0.3.0/src/collateral.rs:5` — «Rust-порт
`npm/scripts/lib/lint-surface/collateral-veto.mjs`», `HUNK_WINDOW: usize = 20`
там-таки (:51).

---

### 2.17. `test-gate.mjs` — 87 рядків. Клас **D**

Пошук sibling-тестів (`findSiblingTestFiles` :34) і їх прогін після LLM-rung-а
(`findBrokenSiblingTests` :79) — ловить правки, які canonical re-detect не
бачить. Порт: `n7n-harness-0.3.0/src/test_gate.rs:3`; споживач у цьому репо —
`crates/rules-fix/src/verify.rs:12` (`use harness::test_gate::compose_verify_report`).

---

### 2.18. `render.mjs` — 40 рядків. Клас **D**

`renderViolations` (:28) і `renderDiagnostics` (:37) — **уже тонкі фасади над
native**. Доккомент файлу (`render.mjs:6-13`) прямо каже: «JS-реалізацію
видалено після parity-гейту», порт — `crates/rules-core/src/lint_render.rs`
(548 рядків). Файл зникає разом зі своїми JS-викликачами.

---

### 2.19. `types.mjs` — 163 рядки. Клас **D**

Тільки JSDoc-typedef-и (`export {}` на :11 — жодного runtime-коду).
Rust-еквіваленти типів живуть у `crates/rules-contract` і
`harness::pipeline`. Зникає механічно.

---

### 2.20. `violation-reporter.mjs` — 46 рядків. Клас **D**

`createViolationReporter` — drop-in заміна старого `createCheckReporter` для
міграції check-концернів у detector-и (доккомент :1-8). Це **міграційна
підпора для JS-детекторів**: він потрібен рівно доти, доки існують
`main.mjs`. Зникає разом із ними, портувати нема сенсу.

---

### 2.21. `default-worker.mjs` — 67 рядків. Клас **B**

Адаптер `runPiAgentFix` під контракт `fixWorker(violations, ctx)`;
`anchoredEnabled` (:26) вирішує, чи вмикати anchored-режим за моделлю.
Використовується, коли у концерну немає власного `fix-worker.mjs`
(`run-fix.mjs:536-541`).

Rust-відповідник — `crates/rules-fix/src/attempt.rs` (обгортка над
`llm_lib::fix::runner::run_attempt`) плюс агентна драбина `harness::pipeline`.
Це не порт «рядок у рядок»: `rules-fix/src/workers.rs:2-10` описує поділ
«агентна драбина проти воркера» як дзеркало JS-архітектури
(`agent-fix.mjs` проти `fix-worker.mjs`).

**B**, бо `anchoredEnabled` — це рішення про формат правок, яке в Rust
приймає інший шар (`EditPlan`/`AnchoredEdit`, `rules-fix/src/t0.rs:16-27`).
Перенесення вимагає узгодити, хто володіє цим прапорцем.

---

### 2.22. `policy-test-step.mjs` — 149 рядків. Клас **D**

**Що робить.** Знаходить rego-концерни з `<concern>_test.rego` і ганяє
`conftest verify` по їхніх теках, нормалізуючи падіння
(`runPolicyUnitTests` :128).

**Знахідка: живих викликів немає.** `grep -rn "policy-test-step\|runPolicyUnitTests"`
по всьому дереву (без `node_modules`/`.git`/`target`) дає рівно чотири
влучання, і всі — у власному тесті модуля
(`lint-surface/tests/policy-codegen.test.mjs:6,73,94,109`) плюс два в
файловій доці. Жоден продуктивний модуль його не імпортує.

**D**, з застереженням: це не «зникне зі зрізом 6», а «вже мертве». Перед
видаленням варто перевірити, чи це не регресія (крок мав бути частиною
`n-rules test`) — але як борг порту він не існує.

---

### 2.23. `tier-sampling-experiment.mjs` (290) і `tier-sampling-bench.mjs` (457). Клас **D**

747 рядків — **11% усієї області**. Обидва — експериментальний harness
sampling/consensus поверх fix-драбини. `tier-sampling-experiment.mjs:4-6`
каже про себе прямо: «Модуль не підключений до production `runFixPipeline`».
`tier-sampling-bench.mjs` створює тимчасові git-fixtures, ганяє `runAgentFix`
і пише JSON-результат у `docs/specs/2026-06-30-lint-tier-sampling-consensus-results.json`.

Поза власними тестами (`lint-surface/tests/tier-sampling-experiment.test.mjs`)
і файловою докою жодних споживачів у дереві немає.

**D.** Це bench-інструмент разової перевірки гіпотези, а не поверхня продукту.
Портувати не треба; питання — видаляти чи лишати як archived, і воно не
інженерне.

---

### 2.24. `blocking-inventory.mjs` — 31 рядок. Клас **D**

`SERIAL_LANE_CONCERNS` (:20) — **порожня множина** (доккомент :9-14: «усі 22
концерни … мігровано на `spawnAsync`»). Живий guard: тест
`lint-surface/tests/blocking-inventory.test.mjs` сканує дерево й падає, якщо
з'явиться новий `spawnSync`-концерн. Реєстр існує лише для JS-шляху
scheduler-а — зникає разом із ним.

---

## 3. Залежності між файлами й можливий порядок

### 3.1. Граф імпортів усередині області

```
run-fix.mjs ──┬─> run-detectors.mjs ──┬─> detect.mjs ──┬─> wasm-plugins.mjs
              │                       │                ├─> policy-lint-adapter.mjs
              │                       │                └─> codegen-opa-wrapper.mjs
              │                       ├─> blocking-inventory.mjs
              │                       ├─> scheduler.mjs
              │                       ├─> render.mjs
              │                       └─> progress.mjs
              ├─> wasm-plugins.mjs
              ├─> detect.mjs
              ├─> snapshot.mjs
              ├─> collateral-veto.mjs
              ├─> test-gate.mjs
              ├─> ladder.mjs
              ├─> render.mjs
              ├─> progress.mjs
              ├─> default-worker.mjs   (динамічно, run-fix.mjs:540)
              └─> mt-tail.mjs          (динамічно, run-fix.mjs:1190)

ci-plan.mjs ──┬─> run-detectors.mjs   (loadEnabledLintRules, computeActiveDomains)
              └─> path-scope.mjs

lint-lock.mjs ──> progress.mjs        (renderProgressLine)

bridge-host.mjs ─(динамічно)─> run-detectors.mjs, detect.mjs, wasm-plugins.mjs

types.mjs — лише typedef-и, runtime-ребер не має
policy-test-step.mjs, tier-sampling-*.mjs, violation-reporter.mjs — ізольовані
```

Зовнішні споживачі області: `npm/bin/n-rules-cli.mjs:1862` (path-scope),
`:1916` (lint-lock), `:1924` (run-detectors), `:1929` (run-fix),
`:1968` (ci-plan); `npm/scripts/hook.mjs:21` і
`npm/scripts/post-tool-use-check.mjs:17` (обидва — `detectAll`).

### 3.2. Порядок, який граф допускає

Порядок нижче — висновок автора з графа, а не запис із чинного плану.

**Крок 0 — «безкоштовні» видалення** (10 файлів, ~1030 рядків, нуль
Rust-роботи): `ladder.mjs`, `snapshot.mjs`, `collateral-veto.mjs`,
`test-gate.mjs`, `render.mjs` — порт уже існує (`n7n-harness`,
`rules-core::lint_render`); `types.mjs`, `blocking-inventory.mjs`,
`violation-reporter.mjs` — не мають самостійного змісту;
`policy-test-step.mjs`, `tier-sampling-*.mjs` — без живих споживачів.
Ці 10 файлів блокуються не портом, а лише видаленням JS-споживачів.

**Крок 1 — листя без залежностей:** `codegen-opa-wrapper.mjs`,
`path-scope.mjs`, `progress.mjs`, `scheduler.mjs`, `lint-lock.mjs`
(усі класу A). Розблоковують `lint --path` і `lint --full` на native-шляху,
тобто знімають два з трьох `Delegate` у `lint_cmd.rs`.

**Крок 2 — `wasm-plugins.mjs`** через `oci-dist` (Д3 плану). Знімає третій
`Delegate` (`lint_cmd.rs:234-241`) і розблоковує `detect.mjs`, `run-fix.mjs`.

**Крок 3 — резолв плагінів** (`plugin-slots.mjs`/`resolve-plugins.mjs`, поза
цією областю). Знімає операцію `discover` мосту й умову `native_eligible`
для `ci plan` → `ci-plan.mjs` і ядро `run-detectors.mjs` можна видаляти.

**Крок 4 — залишок `main.mjs`/`fix-*.mjs`** у гостей або в `rules-core`
(`doc-files/*` — 11, `test/coverage` — 1, плагіни — 11+7).
Знімає операцію `detect` мосту → `detect.mjs`, `policy-lint-adapter.mjs`,
`default-worker.mjs`, `run-fix.mjs`.

**Крок 5 — `bridge-host.mjs`** видаляється останнім; його зникнення і є
критерій завершення.

`mt-tail.mjs` не має місця в цьому ланцюжку — його доля вирішується окремо
(2.10).

---

## 4. Обов'язкові перевірки

### 4.1. `crates/rules-core/src/lint_plan.rs:9-27` — що це означає для порту

Доккомент стверджує (рядки 9-11): дискавері й **обидва** фільтри
(`filterByCapabilities`, `filterByRuleApplies`) лишаються в JS **ЦІЛКОМ**;
причина (рядки 12-17) — `filterByRuleApplies` робить
`await import(pathToFileURL(appliesPath))` довільного
`<rule>/applies/main.mjs`, а «dynamic import JS-модуля принципово не
портується в native».

**Це твердження описує конкретний контур і сьогодні звужене до кількох
відсотків його первісного радіуса.** Що перевірено:

1. `lint_plan.rs` — модуль, що обслуговує **napi-напрям** (JS-оркестратор
   кличе Rust за планом). Для нього твердження чинне: `build_lint_plan`
   справді приймає вже відфільтрований мінімальний зріз `ConcernPlanInput`.
2. Але **інший** контур — `rules-cli/src/lint_cmd.rs` — уже робить і
   дискавері (`discover_by_rule` :274), і capability-фільтр
   (`filter_by_capabilities` :303), і applies-фільтр (`filter_by_applies` :339)
   **в Rust**. Доккомент цього фільтра (`lint_cmd.rs:328-337`) пояснює чому:
   гейт став декларативним у зрізі 3 контракту плагінів v3.1, і на міст іде
   лише `AppliesSpec::Dynamic`.
3. `ci_cmd.rs:17-24` каже те саме ще різкіше: «**Rule-level гейт більше в
   цьому списку не значиться.** Він був другим блокером, доки лишався
   виконуваним модулем `<rule>/applies/main.mjs`».
4. У дереві **нуль** файлів `*/applies/main.mjs` (`npm/rules` + `plugins`), і
   всі три наявні `applies` — декларативні (див. 2.6).

**Висновок.** Це **обхідне** — і вже обійдене. Обхід має ім'я: декларативний
предикат `main.json:applies` + літерал `"dynamic"` як аварійний клапан
(`rules_core::rule_applies::APPLIES_DYNAMIC`, `rule_applies.rs:37`).
Реальний блокер дискавері — **не** dynamic import, а резолв плагінів
(`resolveRulesDirs`/`getActiveCapabilities`, ~1125 рядків у
`npm/scripts/lib/plugin-slots.mjs` + `resolve-plugins.mjs`), і його
`ci_cmd.rs:9-15` називає єдиним недосяжним кроком із чотирьох.

Формулювання в `lint_plan.rs:9-27` **застаріле в частині причини** і його
варто виправити — інакше воно й далі буде цитуватись як доказ структурної
неможливості (що вже сталося, розділ 6).

### 4.2. `js_fallback.rs` і `bridge.rs` — чинна межа

Викладено в розділі 1. Стисло: `js_fallback` віддає **цілу команду**
(argv-passthrough, exit-код 1:1, `js_fallback.rs:121-176`); `bridge` віддає
**вузькі запити** всередині Rust-оркестрованого прогону. Ще делегуються
цілком: `skill` (`main.rs:270`), `hook --post-tool-use` для непортованих
гілок (`hook_cmd.rs:87,97`), `ci plan` за умов (`ci_cmd.rs:100-115`),
`lint` без `--native-detect`/з `--path`/без `--no-fix`/з wasm у плані
(`lint_cmd.rs:147,153,157,173`), і будь-який argv, який clap не розібрав
(`main.rs:184`).

### 4.3. `npm/scripts/lib/native.mjs` — дзеркало в протилежний бік

Викладено в 1.1. Дзеркальність задекларована обома сторонами:
`js_fallback.rs:13` («порядок за зразком `npm/scripts/lib/native.mjs`»)
і `native.mjs:1-3` («за зразком `llm-lib/lib/internal/native.mjs`»).
Точка, на яку варто дивитися при кожній зміні контракту:
`EXPECTED_CONTRACT_VERSION = 2` (`native.mjs:78`) звіряється з
`addon.contractVersion()` **до** кешування — розбіжність кидає щоразу.
Симетрична точка на мосту — `PROTOCOL_VERSION = 2` (`bridge.rs:37`)
vs `BRIDGE_PROTOCOL_VERSION = 2` (`bridge-host.mjs:61`).

---

## 5. Знахідки: документ проти коду

Три випадки, де записана в документах причина не звіряється з деревом.

### 5.1. «Дискавері лишається в JS ЦІЛКОМ, бо dynamic import» — застаріла причина, і вона процитована сьогодні

`crates/rules-core/src/lint_plan.rs:9-17` — джерело. Спека
`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md:824-831` (розділ 12.4.1,
датований **2026-08-31**, тобто написаний того ж дня) цитує його як Факт 2:

> «Дискавері концернів — це `readdir` … плюс `await import(pathToFileURL(appliesPath))`
> довільного `<rule>/applies/main.mjs` (доккоментар `crates/rules-core/src/lint_plan.rs:9-27`,
> який прямо фіксує: дискавері й обидва фільтри лишаються в JS ЦІЛКОМ, бо dynamic
> import принципово не портується в native)»

І далі (`:928-930`) робить із цього висновок про блокер зрізу 6:
«Плюс дискавері, яке за доккоментом `lint_plan.rs` **лишається в JS ЦІЛКОМ**».

Проти коду: `lint_cmd.rs:274-352` портує дискавері + обидва фільтри;
`ci_cmd.rs:17-24` явно знімає applies з переліку блокерів; у дереві нуль
`applies/main.mjs`. Реальний блокер — резолв плагінів, а не dynamic import.

Це не косметика: два різні документи будують на цій причині висновок про
неможливість самодостатнього бінаря, і причина названа неправильно.

### 5.2. Env-гейт `N_LINT_MT_TAIL` — у спеці є, у коді немає

`docs/specs/2026-07-11-phase-b-lint-mt-adapter-dev-design.md:50,57,86` описує
матеріалізацію MT-хвоста як opt-in за `N_LINT_MT_TAIL=1`:
«Env-гейт `N_LINT_MT_TAIL=1` — opt-in, поки не зрілий»;
«B1 БЕЗ B2 у продакшн НЕ вмикається … пишемо як фундамент за env-гейтом».

Проти коду: `run-fix.mjs:1188-1196` (`materializeTailToMt`) жодного env не
читає — єдиний гейт `remaining.length === 0`, далі відразу
`await import('./mt-tail.mjs')`. Гейт справді колапснуто —
`npm/CHANGELOG.md:2807`: «прибрано env-прапорець N_LINT_MT_TAIL, єдиний гейт
тепер наявність `.mt.json`». Тобто CHANGELOG звірений, а спека — ні. Через
`grep N_LINT_MT_TAIL` спека виглядає як чинне джерело правди й дає хибну
відповідь на питання «чи це вимкнено».

### 5.3. `bridge-host.mjs:19` — «96 із 224 концернів»

Доккомент операції `detect` (`bridge-host.mjs:17-19`) каже: «виконання
концернів, що мають `main.mjs`/policy-adapter (96 із 224 концернів репо на
момент зрізу)».

Проти дерева: `find npm/rules -name concern.json | wc -l` → **97**;
живих `main.mjs` поза тестами — 12 у `npm/rules` + 11 у `plugins` = **23**.
Число «224» не відтворюється з `npm/rules` (можливо, рахувались усі
концерни разом із плагінами й іншим зрізом), і «96» точно не відповідає
поточним 23.

Формулювання «на момент зрізу» рятує від звинувачення в брехні, але не
рятує читача: цифра в доккоменті — єдина кількісна оцінка обсягу мосту в
коді, і вона розходиться з деревом у чотири рази. Це саме той клас
застарілості, який просив виносити окремо.

---

## 6. Зведення

Кожен файл зарахований рівно до одного класу; сума — 6576 рядків, 25 файлів.

| Клас | Файлів | Рядків | Частка |
|---|---:|---:|---:|
| **A** — портовне як є | 6 | 1048 | 16% |
| **B** — потрібен новий канал / зміна контракту | 7 | 3646 | 55% |
| **C** — структурно не портовне | 1 | 298 | 5% |
| **D** — зникає, портувати не треба | 11 | 1584 | 24% |

**A** (1048): `lint-lock` 332, `ci-plan` 276, `progress` 210, `path-scope` 104,
`scheduler` 96, `codegen-opa-wrapper` 30.

**B** (3646): `run-fix` 1331, `run-detectors` 882, `wasm-plugins` 713,
`detect` 333, `mt-tail` 216, `policy-lint-adapter` 104, `default-worker` 67.
`run-detectors.mjs` зарахований сюди цілком, хоча його ядро (дискавері,
фільтри, план, диспатч, рендер) класу A і вже портоване — файл тримає
хвіст, що впирається в резолв плагінів.

**C** (298): `bridge-host` — і він зникає разом із рештою, а не лишається
назавжди.

**D** (1584): `tier-sampling-bench` 457, `tier-sampling-experiment` 290,
`types` 163, `policy-test-step` 149, `collateral-veto` 131, `ladder` 101,
`snapshot` 89, `test-gate` 87, `violation-reporter` 46, `render` 40,
`blocking-inventory` 31.

З них **448 рядків уже мають готовий Rust-порт** і чекають лише на зняття
JS-споживача: `collateral-veto`+`ladder`+`snapshot`+`test-gate` = 408
(`n7n-harness` 0.3.0) і `render` 40 (`rules_core::lint_render`).
Ще **747 рядків (11% області)** — bench-інструментарій `tier-sampling-*`
без жодного продуктивного виклику.

### Головний висновок

**Структурно не портовним у цій області є нуль рядків.** Єдиний C — це
JS-бік мосту, який існує заради інших JS-файлів і зникає разом із ними.

Справжніх залежностей, що тримають область у JS, три, і **дві з них лежать
поза нею**:

1. **резолв плагінів** (`npm/scripts/lib/plugin-slots.mjs` 670 +
   `resolve-plugins.mjs` 455) — тримає операцію `discover` мосту
   (`bridge-host.mjs:86-109`) і умову `native_eligible` для `ci plan`
   (`ci_cmd.rs:9-15`). Поза цією областю;
2. **резолв wasm-плагінів** (`wasm-plugins.mjs`, 713 рядків) — тримає гейт
   `lint_cmd.rs:234-241`. Вихід уже призначено: Д3 плану
   `docs/plans/2026-08-29-js-rust-migration-completion-plan.md:80` —
   `builtin-pins.json` → lock-формат `oci-dist`;
3. **залишок виконуваного JS у правилах** — 23 `main.mjs`, 7 `fix-<concern>.mjs`,
   3 непортовані `fix-worker.mjs`. Тримає операцію `detect` мосту
   (`bridge-host.mjs:168-210`). Поза цією областю; вихід названо в
   `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md:920-930` (порт або
   wasm-гості).

Тобто `lint-surface` **не є вузьким місцем міграції**: 40% його рядків
знімаються без жодної Rust-роботи, 16% портуються прямо, а решта чекає на
три залежності, дві з яких належать сусіднім областям.
