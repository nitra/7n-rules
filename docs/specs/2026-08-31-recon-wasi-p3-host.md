# Розвідка: що насправді змінює `wasm32-wasip3` на боці хоста

**Дата:** 2026-08-31
**Статус:** розвідка (коду не писано)
**Предмет:** перевірка засновків розділу 10.1 спеки
`docs/specs/2026-08-31-plugin-contract-v5.md`
**Зв'язані:** `docs/plans/2026-08-05-open-questions-register.md` §2.95
(preopen від кореня виклику), §2.55 (стеля розміру гостя), §2.101

## 0. Підсумок за одну сторінку

Розділ 10.1 спеки стоїть на твердженні:

> «`wasmtime` не обмежує… Тобто хост уміє P3 сьогодні — треба лише
> перемкнути прапорець.» (`docs/specs/2026-08-31-plugin-contract-v5.md:280-288`)

**Це твердження хибне в частині «лише перемкнути прапорець».** Перемикання
`wasmtime-wasi` з feature `p2` на `p3` робить хост **асинхронним за
побудовою** — не за бажанням, а за типами: у `wasmtime-wasi` 48 у модулі
`p3` **немає** `add_to_linker_sync`, а кожен p3-інтерфейс реєструє
concurrent-імпорти, після яких wasmtime **відмовляється** виконувати
синхронні виклики. Наш хост синхронний наскрізь — від
`wasmtime_wasi::p2::add_to_linker_sync` (`crates/rules-plugin-host/src/host.rs:82`)
до синхронних `#[napi]`-функцій із `thread_local!`-кешем
(`crates/rules-napi/src/lib.rs:468-488`).

Чотири знахідки, кожна з доказом нижче:

1. **`wasmtime_wasi::p3` у 48.0.1 задокументований як експериментальний і
   «не готовий до продакшена», з явною відмовою від semver і від
   патч-релізів на безпекові фікси.** Спека цього не згадує.
2. **P3 не має синхронного лінкера.** Перехід зачіпає не «перейменування
   API», а форму виклику: `instantiate_async` + `Store::run_concurrent`, і
   далі — усю сходинку до napi.
3. **Preopens — добра новина.** `WasiCtxBuilder`/`FsPerms`/`WasiCtx` у
   `wasmtime-wasi` 48 спільні для p2 і p3; §2.95-семантика («корінь
   ВИКЛИКУ, не процесу») — **наш** код (`host.rs:341-360`), а не WASI, тож
   P3 її не змінює. Але й `r-plugin` її НЕ підтверджує: у сусідньому
   репозиторії preopen-ів немає взагалі (жодного входження в `crates/`).
4. **Пін «WASI 0.3.1» не задовольняється жодною половиною стека.** І
   `wasmtime-wasi` 48.0.1 (`src/p3/wit/deps/`), і `std` пінованого
   `nightly-2026-08-27` (крейт `wasip3 0.7.1+wasi-0.3.0`) везуть
   **`wasi:*@0.3.0`**.

Плюс `wit-bindgen`: пін `0.60` **не** блокер (див. §5).

## 1. Які `wasi:*` імпортує наш компонент сьогодні

Заміряно на артефактах основного чекауту (зібрані 2026-08-31 14:24,
`ls -laT target/wasm32-wasip2/release/*.wasm`), командою
`wasm-tools component wit <файл>.wasm`.

### 1.1. Шість first-party гостей — набір однаковий і `filesystem` у ньому НЕМАЄ

`plugin_lang_php`, `plugin_lang_js`, `plugin_lang_python`,
`plugin_lang_rust`, `plugin_ci_github`, `plugin_ci_azure`:

```
wasi:io/poll@0.2.9
wasi:io/error@0.2.9
wasi:io/streams@0.2.9
wasi:clocks/monotonic-clock@0.2.9
wasi:cli/stdout@0.2.9
wasi:cli/stderr@0.2.9
wasi:cli/stdin@0.2.9
wasi:cli/environment@0.2.9
wasi:cli/exit@0.2.9
wasi:cli/terminal-input@0.2.9
wasi:cli/terminal-output@0.2.9
wasi:cli/terminal-stdin@0.2.9
wasi:cli/terminal-stdout@0.2.9
wasi:cli/terminal-stderr@0.2.9
wasi:random/insecure-seed@0.2.9      (крім plugin_ci_azure — немає)
```

`plugin_ci_azure` — той самий список без `wasi:random/insecure-seed`.

**Перевірено окремо:**
`wasm-tools component wit … | grep -c "^  import wasi:filesystem"` дає `0`
для всіх чотирьох перевірених (`plugin_lang_python`, `plugin_lang_rust`,
`plugin_ci_github`, `plugin_ci_azure`), і в повних лістингах `php`/`js`
його теж немає.

### 1.2. `wasi:filesystem` імпортує ЛИШЕ тестова фікстура

`test_plugin_guest.wasm` — єдиний компонент у дереві з
`wasi:filesystem/types@0.2.9` і `wasi:filesystem/preopens@0.2.9`
(і додатково `wasi:clocks/wall-clock@0.2.9`).

**Наслідок для оцінки ризику preopen-ів.** Preopen-контур сьогодні має
рівно одного споживача — гейт §2.95
(`crates/rules-plugin-host/tests/fs_read_preopen_root.rs`, чотири тести:
`preopen_resolves_against_call_root_not_process_cwd`,
`two_roots_give_two_different_reads`, `relative_root_is_refused_loudly`,
`rootless_load_refuses_guest_calls_instead_of_reading_nothing`). Це збігається
з тим, що спека вже зафіксувала в §2.1: «усі шість гостей оголошують
`fs_read = []`». Тобто регресія preopen-семантики під P3 не зламала б
жодного продакшн-гостя — вона зламала б (або, гірше, НЕ зламала) саме гейт.

### 1.3. У що це перетворюється під P3

За WIT-деревом `wasmtime-wasi` 48.0.1 (`src/p3/wit/deps/`) — там п'ять
пакетів: `wasi:cli@0.3.0`, `wasi:clocks@0.3.0`, `wasi:filesystem@0.3.0`,
`wasi:random@0.3.0`, `wasi:sockets@0.3.0`.

| сьогодні (P2) | під P3 |
|---|---|
| `wasi:io/poll`, `wasi:io/streams`, `wasi:io/error` | **зникають** — пакета `wasi:io` у 0.3 немає; потоки й ф'ючери стали типами Component Model (`stream<u8>`, `future<…>`) |
| `wasi:cli/stdout`, `stderr`, `stdin` | `wasi:cli@0.3.0` — але сигнатури інші: `write-via-stream: func(data: stream<u8>) -> future<result<_, error-code>>` (`cli.wit:98`), тобто нативні CM-потоки замість ресурсів `wasi:io` |
| `wasi:cli/environment`, `exit`, `terminal-*` | `wasi:cli@0.3.0`, ті самі інтерфейси (`cli.wit:4,27,123,135,144,157,170`) |
| `wasi:clocks/monotonic-clock` | `wasi:clocks@0.3.0`, але `wait-until`/`wait-for` — **`async func`** (`clocks.wit:48,52`) |
| `wasi:random/insecure-seed` | `wasi:random@0.3.0` (`random.wit:8`) |
| `wasi:filesystem/{types,preopens}` (лише фікстура) | `wasi:filesystem@0.3.0`, де **майже кожен метод `descriptor` — `async func`** (`filesystem.wit:358,366,374,386,392,399,421,426,437,446,454,463,477,485,492,497,505,516,524…`) |

Це і є перший рівень «не перейменування»: набір імпортів не просто
перенумеровується з `0.2.9` на `0.3.0` — три інтерфейси зникають, а решта
міняє форму на CM-async.

## 2. Що змінюється в `crates/rules-plugin-host`

### 2.1. Точки, які доведеться чіпати

| місце | сьогодні | під P3 |
|---|---|---|
| `Cargo.toml` (`wasmtime-wasi`) | `features = ["p2"]` | `["p3"]` — і це тягне `wasmtime/component-model-async` + `wasmtime/component-model-bytes` (`wasmtime-wasi-48.0.1/Cargo.toml`, `[features]`), а `component-model-async` тягне `async` → `dep:wasmtime-fiber` + `dep:futures` (`wasmtime-48.0.1/Cargo.toml:72-77`) |
| `Cargo.toml` (`wasmtime`) | явний список features із `default-features = false` | доведеться додати `component-model-async`/`component-model-bytes` або покластися на транзитивне вмикання — свідомий вибір, бо список тут навмисно вузький (доккомент `crates/rules-plugin-host/Cargo.toml`) |
| `host.rs:66` | `config.wasm_component_model(true)` | плюс `config.wasm_component_model_async(true)` — того самого вимагають обидва приклади в `wasmtime_wasi::p3` (`p3/mod.rs`, `p3/filesystem/mod.rs`) і робочий код сусіда (`r-plugin/crates/r-plugin-runtime/src/lib.rs:91`) |
| `host.rs:82` | `wasmtime_wasi::p2::add_to_linker_sync(&mut linker)` | `wasmtime_wasi::p3::add_to_linker(&mut linker)` — **синхронного варіанта не існує** (див. §2.2) |
| `host.rs:277`, `host.rs:309` | `wit::Plugin::instantiate(&mut store, …)` | `instantiate_async(…).await` (`linker.rs:334-345`, `T: Send`) |
| `host.rs:281`, `host.rs:313` | `plugin.call_describe(&mut store)` | виклик усередині `store.run_concurrent(async \|accessor\| …)` |
| `loaded_plugin.rs:120`, `:159` | `call_detect` / `call_fix` синхронно | те саме — через `run_concurrent` |
| `src/wit.rs` (`bindgen!`) | без `imports`/`exports`-опцій | доведеться просити async-виклики експортів (пор. `exports: { default: async \| store }` у `wasmtime-wasi-48.0.1/src/p3/bindings.rs`) |
| `crates/rules-napi/src/lib.rs:468-488` | синхронні `#[napi]` + `thread_local! PLUGIN_HOST` | потрібен per-thread async-runtime і `block_on` навколо кожного `detect`/`fix`/`describe` |

**Не змінюється:**

- `host_state.rs:11` — `WasiCtx`/`WasiCtxView`/`WasiView` живуть у корені
  крейта, не в `p2`; `p3::add_to_linker` вимагає рівно `T: WasiView`
  (`p3/mod.rs:170-176`), а всі під-view (`WasiFilesystemView`,
  `WasiCliView`, …) мають blanket-impl від `WasiView`
  (`wasmtime-wasi-48.0.1/src/view.rs`).
- `rego_engine.rs`, `world_linker.rs`, `scratch.rs`, `tool_resolver.rs` —
  наші власні імпорти, WASI-профіль їх не стосується.

### 2.2. Головна семантична розбіжність: P3 не має синхронного контуру

**Доказ 1 — API.** `grep "pub fn add_to_linker" wasmtime-wasi-48.0.1/src/{p2,p3}`:

```
p2/mod.rs:452:  pub fn add_to_linker_sync<T: WasiView>(…)
p2/mod.rs:314:  pub fn add_to_linker_async<T: WasiView>(…)
p3/mod.rs:170:  pub fn add_to_linker<T>(…)          ← єдиний
p3/{cli,clocks,filesystem,random,sockets}/mod.rs:  pub fn add_to_linker<T>(…)
```

У `p3` синонімів `_sync`/`_async` немає взагалі.

**Доказ 2 — механіка відмови.** Ланцюжок у `wasmtime` 48.0.1:

1. `bindgen!` реєструє WIT-`async func` як `func_wrap_concurrent`
   (`wasmtime-internal-wit-bindgen-48.0.1/src/lib.rs:2745`:
   `if func.kind.is_async() { "func_wrap_concurrent" }`).
2. `func_wrap_concurrent` створює `HostFunc` з `Asyncness::Yes`
   (`wasmtime-48.0.1/src/runtime/component/func/host.rs:133,145`). Обійти
   це «синхронною реалізацією async-імпорту» неможливо за конструкцією:
   `typecheck_async` (`func/host.rs:588-607`) валить `func_wrap`/
   `func_wrap_async` на `async func`-імпорті окремим повідомленням —
   «despite the name, these implement a *sync*-WIT-typed function via
   blocking host code, not an `async func` import».
3. `InstancePre` складає `asyncness` як OR по всіх імпортах лінкера
   (`component/instance.rs:1094-1100`) і на інстанціації робить
   `store.0.set_async_required(self.asyncness)` (`instance.rs:1148,1175`).
4. Після цього будь-який синхронний вхід падає:
   `validate_sync_call` → `bail!("store configuration requires that
   \`*_async\` functions are used instead")` (`runtime/store.rs:2246-2252`),
   і його кличуть саме `Linker::instantiate` (`component/linker.rs:314`),
   `Func::call` (`component/func.rs:240`), `TypedFunc::call`
   (`component/func/typed.rs:150`), `InstancePre::instantiate`
   (`component/instance.rs:1149`).

**Доказ 3 — обійти вибірковим лінкуванням не вийде.** Спокуса «взяти лише
`p3::cli` + `p3::clocks`, без `sockets`» не рятує: `wasi:clocks@0.3.0`
оголошує `wait-until`/`wait-for` як `async func` (`clocks.wit:48,52`), а
`wasi:filesystem@0.3.0` — майже все. `monotonic-clock` імпортують **усі
шість** наших гостей уже сьогодні (§1.1).

**Доказ 4 — канонічний виклик.** Власні тести `wasmtime-wasi` 48.0.1
(`tests/all/p3/mod.rs:28-53`) ганяють p3 так: `Config::wasm_component_model_async(true)`
→ `p3::add_to_linker` → `Command::instantiate_async(…).await` →
`store.run_concurrent(async move |store| …).await`, під
`#[tokio::test(flavor = "multi_thread")]`. Те саме — у сусіда
(`r-plugin/crates/r-plugin-runtime/src/platform_info.rs:38-67`).

**Що це означає в наших термінах.** Це не «інший API того самого» — це
зміна виконавчої моделі, яка не зупиняється на межі
`crates/rules-plugin-host`: публічний trait хоста синхронний, `LoadedPlugin`
тримає `Store` (`loaded_plugin.rs:26`), а napi-міст — синхронний
`thread_local!` (свідомо: доккомент `crates/rules-napi/src/lib.rs:468-482`
пояснює, що саме синхронність уникає `Send`/`Sync`-вимог). Асинхронний хост
або тягне tokio-runtime у napi-потік із `block_on`, або міняє форму
публічного API.

### 2.3. Статус самого модуля `p3` у wasmtime 48

Дослівний заголовок `wasmtime-wasi-48.0.1/src/p3/mod.rs:1-9`:

> Experimental, unstable and incomplete implementation of wasip3 version of
> WASI. This module is under heavy development. It is not compliant with
> semver and is not ready for production use. Bug and security fixes limited
> to wasip3 will not be given patch releases.

Три окремі твердження, кожне з наслідком для нас:

- **не semver** — наш пін `wasmtime-wasi = "48.0"` (caret на patch) може
  зламати збірку на будь-якому патчі; рішення М (пін точного minor) під P3
  треба посилювати до пінування patch, як зробив `r-plugin`
  (`=48.0.1` у його `Cargo.toml:52-53`);
- **безпекові фікси без патч-релізів** — це прямо суперечить мотиву
  «мережа заборонена за замовчуванням» із доккомента `PluginHost::new`
  (`host.rs:71-81`): ми покладаємось на політику `WasiCtx`, реалізовану в
  модулі, який автори не зобов'язуються патчити;
- **incomplete** — обсяг неповноти не описаний, і перевірити його розвідкою
  без реального прогону не можна.

Спека 10.1 цього блоку не згадує зовсім. Формулювання «`wasmtime` не
обмежує» треба читати як «`wasmtime` дозволяє», а не «`wasmtime` це
підтримує».

## 3. Чи P3 змінює семантику preopens (§2.95)

**Ні — і це найпевніша добра новина розвідки.**

`WasiCtxBuilder::preopened_dir(host_path, guest_path, perms)` живе у
**корені** крейта (`wasmtime-wasi-48.0.1/src/ctx.rs:297-317`), не в `p2`, і
складає `self.filesystem.preopens`. Реалізація `wasi:filesystem` у p3
читає той самий `crate::filesystem::WasiFilesystem`
(`p3/filesystem/mod.rs:62-68`:
`types::add_to_linker::<_, WasiFilesystem>` + `preopens::add_to_linker::<_, WasiFilesystem>`).
`FsPerms::ReadOnly` теж спільний (`ctx.rs:6` — `use crate::{FsPerms, OpenMode}`).

Головне: **сама §2.95-семантика взагалі не належить WASI.** Резолвинг
«корінь ВИКЛИКУ, не процесу» — це наші три рядки
`preopen_root.expect(…).join(rel)` (`host.rs:346-348`), а WASI отримує вже
готовий абсолютний `host_path`. P3 не має де це змінити.

**Але доказ від сусіда відсутній.** `grep -rn preopen r-plugin/crates/`
не дає **жодного** входження: `r-plugin` будує WASI-контекст як
`WasiCtxBuilder::new().build()` (`platform_info.rs:41`). Тобто «референс уже
є в сусідньому репозиторії» (спека, рядки 319-326) — правда щодо збірки
гостя під P3 і щодо async-виклику, і **неправда** щодо preopen-ів,
`capabilities`, мережевої політики й синхронного контуру. Взірця для тієї
половини хоста, яку ми найбільше боїмось зламати, у сусіда немає.

**Що з гейтом.** Чотири тести `fs_read_preopen_root.rs` ганяють РЕАЛЬНОГО
гостя, зібраного `cargo build --target wasm32-wasip2 --release`
(`fs_read_preopen_root.rs:32`, шлях — `:203`). Під P3 гейт не «зламається
семантикою» — він **перестане збиратися**, доки фікстуру не переведуть на
`wasm32-wasip3` (тобто доки в CI/на машині не буде WASI SDK, §5). Ризик тут
не в тому, що P3 змінить резолвинг, а в тому, що гейт на час міграції
вимкнуть — і §2.95 знову стане недоведеним твердженням у доккоменті.

## 4. Пін «WASI 0.3.1» не задовольняється

Спека пінує WASI **0.3.1** (`plugin-contract-v5.md:304`). Заміряно:

- **Хост.** `grep -rh "^package wasi:" wasmtime-wasi-48.0.1/src/p3/wit/deps/`
  → `wasi:cli@0.3.0`, `wasi:clocks@0.3.0`, `wasi:filesystem@0.3.0`,
  `wasi:random@0.3.0`, `wasi:sockets@0.3.0`.
- **Гість.** Пінований `nightly-2026-08-27` при `-Z build-std` тягне крейт
  **`wasip3 v0.7.1+wasi-0.3.0`** (рядок з реального прогону, §5.1); його
  `wit/deps/` — теж `@0.3.0` (плюс `wasi:http@0.3.0`).

Тобто **обидві** половини стека сьогодні везуть `0.3.0`. Пін `0.3.1` не є
описом того, що ми отримаємо — це або опис наміру на майбутнє, або помилка
переносу. Записувати його як «піновану версію» без вказівки, чим саме він
енфорситься, — рівно той клас «причина пережила свою підставу», який
завдання просило не поповнювати.

Побічне: під P2 наші компоненти імпортують `wasi:*@0.2.9`, тоді як
`wasmtime-wasi` 48 несе WIT `@0.2.12` (`src/p2/wit/deps/`), і це працює —
minor-сумісність усередині `0.2.x`. Чи діє така сама поблажливість між
`0.3.0` і `0.3.1`, розвідкою не перевірено (артефакту `0.3.1` у дереві
немає).

## 5. `wit-bindgen`: пін `0.60` — не блокер

Порівняно `wit-bindgen-0.60.0` (наш пін, `crates/plugin-lang-php/Cargo.toml`
та решта гостей) з `wit-bindgen-0.61.1` (`r-plugin/Cargo.toml:55`,
`features = ["async-spawn"]`):

- **`[features]` збігаються рядок у рядок** (`async`, `async-spawn`,
  `bitflags`, `default`, `futures-stream`, `inter-task-wakeup`,
  `macro-string`, `macros`, `realloc`, `rustc-dep-of-std`, `std`).
  `async` входить у `default` **обох**, тож `r-plugin`-івський
  `async-spawn` додає лише `dep:futures` — фічу для async-гостя, не для
  сумісності з P3.
- **wasip3-рантайм є вже в 0.60**: `src/rt/wit_bindgen_cabi_wasip3.c`,
  `src/rt/async_support.rs` із `cabi::wasip3_task`/`wasip3_task_v2`
  (`async_support.rs:314-342`).
- **Дельта 0.60 → 0.61.1** (`diff -rq`): доданий
  `src/rt/async_support/wasip3_context.rs`, розділені прекомпільовані
  архіви (`libwit_bindgen_cabi.a` → `libwit_bindgen_cabi_realloc.a` +
  `libwit_bindgen_cabi_wasip3.a`), правки `lib.rs`/`rt/mod.rs`.

Наші світи (`describe`/`detect`/`fix`) синхронні за формою, тож async-гілка
`wit-bindgen` нам не потрібна. **Оновлення до `0.61.1` — не передумова
переходу.** Якщо його все одно робити, то з окремої причини (єдиний пін із
сусідом), а не як «0.60 не вміє p3».

Дрібниця, помічена при прогоні: `std` пінованого nightly сам тягне
`wit-bindgen` — лінкер отримав `--export cabi_realloc_wit_bindgen_0_57_1`
(вивід §5.1). Тобто у графі гостя під P3 співіснуватимуть **дві** версії
рантайму `wit-bindgen` (наша й та, що всередині `std`).

## 6. Розмір і час збірки

### 6.1. Що вдалось заміряти

Зонд: мінімальний крейт (`[lib] crate-type = ["cdylib"]`, одна функція,
жодної залежності) у скретч-теці поза репозиторієм.

**`-Z build-std` під `wasm32-wasip3` доходить до лінкування й падає там:**

```
$ cargo +nightly-2026-08-27 build -Z build-std=std,panic_abort \
      --target wasm32-wasip3 --release
   Compiling wasip3 v0.7.1+wasi-0.3.0
   …
error: linking with `wasm-component-ld` failed: exit status: 1
  = note: rust-lld: error: unable to find library -lc
          error: failed to invoke LLD: exit status: 1
```

Тобто **компіляція `std` під wasip3 працює** (`rust-src` встановлений на
`nightly-2026-08-27` — перевірено `rustup component list --toolchain
nightly-2026-08-27 --installed`), а бракує рівно **wasi-sysroot**:
`<sysroot>/lib/rustlib/wasm32-wasip3/lib/self-contained` не існує, і
`-lc` нема звідки взяти. Це той самий `-L native=${wasi_libdir}`, який
`r-plugin` підставляє зі свого WASI SDK
(`scripts/test-component-spike.sh:83-89`).

**Ціна `-Z build-std` за часом, зміряно на тому самому зонді (чистий
`target/` обидва рази):**

| збірка | `real` |
|---|---|
| `cargo build --target wasm32-wasip2 --release` (precompiled std) | **0,26 с** |
| `cargo +nightly-2026-08-27 build -Z build-std=std,panic_abort --target wasm32-wasip3 --release` | **16,62 с** (до падіння на лінкуванні) |

≈ **+16 с фіксованої вартості** на кожну чисту збірку кожного гостя (і на
кожну зміну профілю/фіч, що інвалідує кеш `std`). Множимо на шістьох гостей
плюс фікстуру — і на CI, де `target/` типово холодний.

### 6.2. Чого бракує для заміру РОЗМІРУ

Нічого заміряти не вдалось, і це не «не встиг», а відсутня передумова:

- **WASI SDK не встановлено ніде на машині**: `/opt/wasi-sdk` не існує,
  `which wasm-component-ld` → not found (є лише той, що всередині
  toolchain-а, див. нижче).
- **Ціль не роздається rustup-ом**: `rustup target list --toolchain
  nightly-2026-08-27 --installed` → лише `aarch64-apple-darwin`. (Це
  підтверджує вимір спеки, рядки 290-298.)

Щоб заміряти, треба рівно одне: розпакований `wasi-sdk-34` (архів на
~200 МБ із GitHub Releases) і `-L native=<sysroot>/lib/wasm32-wasip3` +
`-C link-arg=<sysroot>/lib/wasm32-wasip3/crt1-reactor.o`. Завантаження
зовнішнього архіву — дія, яку розвідка не робить без окремого дозволу;
тому тут чесний нуль, а не оцінка.

**Що при цьому відомо про запас.** Стеля — 10 MiB
(`npm/scripts/lib/lint-surface/tests/wasm-size-budget.mjs:46`,
`WASM_SIZE_BUDGET_BYTES = 10 * 1024 * 1024`). Поточні розміри під P2
(`ls -laT`, байти):

| гість | байти | % стелі |
|---|---|---|
| `plugin_lang_js` | 2 449 475 | 23,4 % |
| `plugin_ci_github` | 1 646 957 | 15,7 % |
| `plugin_lang_rust` | 1 476 743 | 14,1 % |
| `plugin_lang_python` | 1 432 632 | 13,7 % |
| `plugin_ci_azure` | 269 339 | 2,6 % |
| `plugin_lang_php` | 249 171 | 2,4 % |
| `test_plugin_guest` | 140 628 | 1,3 % |

Запас великий: навіть подвоєння найбільшого гостя лишає ~53 % стелі. Тож
**розмір — найменш імовірний блокер переходу**, і саме тому невиміряність
цього пункту найдешевша з усього списку.

### 6.3. Побічна знахідка: версія `wasm-component-ld` розійдеться з гейтом сусіда

`r-plugin` жорстко вимагає `wasm-component-ld 0.5.27` з WASI SDK 34.0-rc.2
(`scripts/test-component-spike.sh:74-76`, `!=` → `exit 1`) і підставляє
його через `CARGO_TARGET_WASM32_WASIP3_LINKER`. Наш пінований toolchain
несе свій:

```
$ ~/.rustup/toolchains/nightly-2026-08-27-aarch64-apple-darwin/lib/rustlib/\
aarch64-apple-darwin/bin/wasm-component-ld --version
wasm-component-ld 0.5.30
```

Тобто скрипт, перенесений дослівно, відхилив би **новіший** лінкер. Спека
вже попереджає про перенесення «за формою, не дослівно» (рядки 308-317) — це
конкретний, заміряний випадок того ж класу, плюс відкрите питання: чи
підставляти лінкер із SDK взагалі, коли toolchain уже везе свіжіший.

## 7. Обсяг механічної роботи поза хостом

`grep -rln "wasm32-wasip2"` (без `target/`, `node_modules/`, `.git/`) —
**60 файлів**. Серед них не лише рядки-шляхи, а й контракти:

- сім тестів `crates/rules-plugin-host/tests/*.rs` (зокрема гейт §2.95);
- шість `crates/plugin-*/build.sh` + `crates/test-plugin-guest/build.sh`;
- `npm/scripts/build-wasm-plugins.mjs`, `npm/scripts/lib/lint-surface/wasm-plugins.mjs`
  і десяток parity/e2e-тестів навколо них;
- шаблон скіла `npm/skills/wasm-plugin/template/build.sh`,
  `template/Cargo.toml.tpl`, `SKILL.md` (це область паралельної хвилі);
- три CI-workflow (`.github/workflows/{lint-rust,test,npm-publish}.yml`);
- правило `plugins/lang-rust/rules/rust/wasm_component/wasm_component.mdc:11`
  — тобто ціль зафіксована ще й як **лінт-правило для користувачів**, не
  лише як внутрішній шлях.

## 8. Висновок і рекомендація

Переоцінка розділу 10.1, по пунктах:

| твердження спеки | вирок |
|---|---|
| «хост уміє P3 сьогодні — треба лише перемкнути прапорець» (280-288) | **хибне.** Прапорець тягне асинхронний хост і зміни аж до `crates/rules-napi` |
| «ціль існує в компіляторі, але не роздається… вимагає `-Z build-std` або WASI SDK» (290-298) | **правда, і вужче:** треба `-Z build-std` **і** WASI SDK (лише `-Z build-std` падає на `-lc`) |
| «референс уже є в сусідньому репозиторії» (319-326) | **половина правди.** Є взірець збірки гостя й async-виклику; **немає** взірця preopen-ів, capabilities, синхронного контуру |
| WASI пін `0.3.1` (304) | **не задовольняється:** і `wasmtime-wasi` 48.0.1, і `std` nightly-2026-08-27 везуть `0.3.0` |
| «`r-plugin` на `wasi-sdk-34.0-rc.2`, ми пінимо фінальний 34» (308-317) | **правда, і є конкретний приклад:** гейт версії `wasm-component-ld` (0.5.27 проти наших 0.5.30) |
| «сьогодні async не покращує нічого» (350-358) | **правда щодо потреби, хибне щодо вибору:** async настане примусово разом із P3, незалежно від того, чи він нам корисний |

**Що з цього не випливає.** Не випливає, що переходу не треба: §2.101
(`oci-dist-package` приймав лише wasip3) і рішення 1/4 контракту v5 лишаються
чинними мотивами, а розмір гостя блокером не є (§6.2).

**Що випливає.** Пункт 5 складу мажора («перехід гостей на `wasm32-wasip3` і
хоста на feature `p3`», `plugin-contract-v5.md:369-370`) сформульований як
одна зміна, а фактично містить три незалежні:

1. **гість** — інша ціль, `-Z build-std`, WASI SDK, пін toolchain
   (механічно велика, ризиково мала);
2. **хост** — перехід на асинхронну виконавчу модель до самого napi
   (ризиково велика, і саме вона не має взірця в `r-plugin`);
3. **прийняття експериментального модуля** `wasmtime_wasi::p3` у
   продакшн-граф із його явною відмовою від semver і безпекових патчів
   (рішення, яке спека не ухвалювала, бо не знала про нього).

Ці три варто розділити хоча б на рівні порядку робіт (§12 спеки) і оцінки —
інакше «перезбирати всіх удруге» (аргумент рядків 274-276) обмінюється на
ризик того, що мажор упреться в асинхронізацію napi-мосту з уже зламаними
гостями.

## 9. Відкриті питання, які ця розвідка не закрила

- **Чи `p3` у wasmtime 48 узагалі проводить наш світ.** Не перевірено
  прогоном: немає WASI SDK, тож немає P3-гостя, тож немає що інстанціювати.
  Це єдиний спосіб перевірити «incomplete» з §2.3.
- **Чи `run_concurrent` сумісний із пулом інстансів** (`Store` живе між
  викликами, `LoadedPlugin` кешується per-path, `rules-napi`).
- **Чи потрібен `p2` паралельно з `p3`** на час міграції — власні тести
  `wasmtime-wasi` лінкують обидва
  (`tests/all/p3/mod.rs:31-34`: `p2::add_to_linker_async` + `p3::add_to_linker`),
  але тоді й p2-контур стає асинхронним.
- **Сумісність `0.3.0` ⇄ `0.3.1`** — чи діє minor-поблажливість, як у
  `0.2.x` (§4).
- **Реальний розмір P3-гостя** — §6.2.
