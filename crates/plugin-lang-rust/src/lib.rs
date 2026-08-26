//! wasm-компонент `n-rules:plugin@3.1.0` — `rust/wasm-concerns`, ТРЕТІЙ
//! first-party wasm-гість репозиторію (перший — `crates/plugin-lang-js`,
//! другий — `crates/plugin-lang-python`, доккомент того `src/lib.rs`
//! пояснює саму форму), створений за тим самим флоу скіла
//! `npm/skills/wasm-plugin/`. ПЕРША ХВИЛЯ порту: рівно три концерни
//! `rust/*` (`plugins/lang-rust/rules/rust/*`):
//!
//! - `rust/applies` (full-scope) — порт
//!   `plugins/lang-rust/rules/rust/applies/main.mjs`: чистий context-pass,
//!   реальний гейт застосовності декларативний (`rust/main.json:applies`),
//!   цей концерн НІКОЛИ не видає діагностику ([`detect_applies`]).
//! - `rust/doc_comments` (per-file) — порт
//!   `plugins/lang-rust/rules/rust/doc_comments/main.mjs`: рекомендовані
//!   вимоги до rustdoc-коментарів (провідний `//!`-header + `///` над кожним
//!   top-level `pub`-елементом). T0-фіксер (`fix-doc_comments.mjs`, JS)
//!   СВІДОМО поза обсягом цієї хвилі — `Guest::fix` повертає порожній план
//!   для цього концерну, як і для решти ([`Guest::fix`]).
//! - `rust/workspace_root` (full-scope) — порт
//!   `plugins/lang-rust/rules/rust/workspace_root/main.mjs`: репозиторій має
//!   мати рівно один кореневий Cargo workspace. Єдиний концерн цього крейта,
//!   що сам обходить УСЕ дерево репозиторію (JS-оригінал ігнорує `ctx.files`
//!   і ходить `readdirSync` напряму замість делти — той самий мотив, що
//!   `python/workspace_root`, доккомент `crates/plugin-lang-python/src/lib.rs`).
//!
//! # Обхід дерева — чому в гості немає обходу файлової системи
//!
//! Той самий принцип, що вже живе в `plugin-lang-js`/`plugin-lang-python`:
//! обхід файлової системи робить ВИКЛЮЧНО хост. `rust/doc_comments` —
//! `ConcernContribution { scope: PerFile, glob: ["**/*.rs"] }` у
//! [`build_manifest`]: коли виклик не передає явний список файлів, хост сам
//! будує `detect-batch.files` за цим glob-ом — [`detect_doc_comments`] лише
//! фільтрує вже надані host-ом файли через [`is_doc_comment_target`] (порт
//! `EXCLUDED_FILE_RE`), точнісінько як `.rs`-розширення й тестові каталоги
//! фільтрує JS-оригінал ПІСЛЯ `globby`.
//!
//! `rust/workspace_root` — `ConcernContribution { scope: Full, glob:
//! ["**/Cargo.toml"] }`: host-бік full-scope збору
//! (`crates/rules-napi::build_full_scope_files`) будує whole-repo batch
//! через `rules_core::scan::walk_dir` (`.gitignore` + дефолтний
//! `.git`/`node_modules`/worktrees-набір), відфільтрований цим glob-ом.
//! Решту `RUST_WORKSPACE_ROOT_IGNORED_DIR_NAMES` (доккомент константи)
//! JS-оригінал ігнорує ЗАВЖДИ, незалежно від `.gitignore`, тож гість
//! повторює той самий фільтр вручну ([`workspace_root_path_ignored`]) — той
//! самий «фільтр поверх host-глобу» дух, що [`is_doc_comment_target`].
//!
//! # Regex-lookahead: `PLAIN_COMMENT_RE` без regex-крейта
//!
//! JS-оригінал `rust/doc_comments` (`main.mjs`) має ОДИН патерн із
//! негативним lookahead — `PLAIN_COMMENT_RE = /^\s*\/\/(?![/!])/` («рядок —
//! `//`-коментар, але НЕ `///` і НЕ `//!»). Rust `regex`-крейт lookahead не
//! підтримує (`npm/skills/wasm-plugin/SKILL.md`, розділ «Parity-дисципліна»,
//! п.4) — порт БЕЗ регекса, ручна перевірка символу одразу після `//`
//! ([`is_plain_comment_line`]): семантично ідентично («//» матчить, «///» і
//! «//!» — ні), жодної апроксимації. Решта патернів канону (`EXCLUDED_FILE_RE`,
//! `EXTERN_PREFIX_RE`, `KIND_NAME_RE`) — БЕЗ lookaround/backreference, портовані
//! напряму в `regex`-крейт ([`DOC_COMMENTS_EXCLUDED_PATTERN`],
//! [`DOC_COMMENTS_EXTERN_PREFIX_PATTERN`], [`DOC_COMMENTS_KIND_NAME_PATTERN`]).
//! `DOC_LINE_RE`/`ATTR_LINE_RE`/`CFG_TEST_RE` теж без лукараунду, але настільки
//! тривіальні (просто префікс після `trim_start()`), що портовані як прості
//! рядкові перевірки ([`is_doc_line`]/[`is_attr_line`]/[`is_cfg_test_line`]) —
//! без зайвого regex-компайлу на кожен виклик, поведінково ідентично.
//!
//! # Unicode-фічі regex
//!
//! Той самий скорочений набір, що `crates/plugin-lang-python/Cargo.toml`:
//! `unicode-perl` ОБОВ'ЯЗКОВИЙ (не опційна size-оптимізація) — без неї
//! `\w`/`\s` у `KIND_NAME_RE`/`EXTERN_PREFIX_RE` не компілюються взагалі
//! (`regex::Regex::new` повертає `Syntax`-помилку `Unicode-aware Perl class
//! not found`). `unicode-case` не потрібен — жоден патерн цього крейта не
//! має `(?i)`.
//!
//! # `rust/workspace_root` vs `python/workspace_root` — дві реальні розбіжності
//!
//! 1. **Немає перевірки вкладеного lockfile**: JS-канон
//!    (`main.mjs`) взагалі не читає `Cargo.lock` — `findAllCargoManifests`
//!    шукає лише `Cargo.toml`. На відміну від `python/workspace_root`
//!    (`NESTED_LOCKFILE`-порушення на вкладений `uv.lock`), тут немає ні
//!    такого `reason`, ні такого гілки логіки — НЕ забутий крок, а точний
//!    порт (доккомент секції `main.mjs` підтверджує: `readdirSync`-обхід
//!    шукає лише `entry.name === 'Cargo.toml'`).
//! 2. **Є перевірка `[profile.*]`**: `NESTED_PROFILE` — Cargo мовчки
//!    ігнорує/варнить на `[profile.*]` у не-кореневих маніфестах, чого
//!    python-сусід (без аналогічної Cargo-специфічної секції) не має.
//!    [`WORKSPACE_ROOT_NESTED_WORKSPACE_REASON`] і
//!    [`WORKSPACE_ROOT_NESTED_PROFILE_REASON`] перевіряються НЕЗАЛЕЖНО —
//!    один не-кореневий маніфест може отримати ОБИДВА порушення одночасно
//!    (`main.mjs::reportNestedTables`, два окремі `if`, не `else if`).
//!
//! # ДРУГА ХВИЛЯ: `rust/check`, `rust/cargo_mutants_config`, `rust/wasm_component`
//!
//! Три контрибуції першої хвилі не спавнили жодного зовнішнього тула. Ця
//! хвиля додає ОДНУ `exec-tool`-контрибуцію (`rust/check`, пілот
//! `exec_tool` цього крейта — той самий host-mediated контур, що
//! `python/mypy`+`python/ruff`, `crates/plugin-lang-python/src/lib.rs`) і
//! дві T0-контрибуції (`rust/cargo_mutants_config`, `rust/wasm_component`).
//!
//! - `rust/check` (full-scope) — порт `plugins/lang-rust/rules/rust/check/main.mjs`:
//!   `cargo fmt --check` → `cargo clippy -D warnings` → `cargo deny check
//!   licenses` (доккомент секції «`rust/check` — ланцюжок НЕ уніформний»
//!   нижче).
//! - `rust/cargo_mutants_config` (full-scope) — порт
//!   `plugins/lang-rust/rules/rust/cargo_mutants_config/main.mjs`:
//!   presence-перевірка `<cargoDir>/.cargo/mutants.toml` для КОЖНОГО
//!   резолвленого Cargo-маніфесту. Т0-фіксер лишається JS (доккомент секції
//!   нижче).
//! - `rust/wasm_component` (per-file) — порт
//!   `plugins/lang-rust/rules/rust/wasm_component/main.mjs`: забороняє
//!   `wasm-bindgen`, вимагає явний `component-model` у `wasmtime` з
//!   вимкненими дефолтами (доккомент секції нижче).
//!
//! # `rust/check` — ланцюжок НЕ уніформний, на відміну від `run_ruff_step`
//!
//! `python/ruff`-порт (`run_ruff_step`, `crates/plugin-lang-python/src/lib.rs`)
//! мав ОДНУ форму: кожен крок або проходить, або одразу повертає готову
//! діагностику. `rust/check` (`main.mjs`, рядки 44–90) — НЕ такий, кожен
//! крок має СВОЮ реакцію на провал:
//! 1. Кореневий `Cargo.toml` відсутній у батчі → рання порожня відповідь
//!    (Rust-кроки взагалі пропущено).
//! 2. `cargo` не резолвиться (`exec_tool`'s `status: none` на ПЕРШОМУ
//!    виклику — `cargo fmt --check`, немає окремого пробного виклику, на
//!    відміну від `python`-сусіда) → ОДНА діагностика `cargo-missing`,
//!    RETURN.
//! 3. `cargo fmt --all -- --check` провалюється → діагностика
//!    `cargo-fmt-violation`, RETURN (решта кроків НЕ виконуються).
//! 4. `cargo clippy --all-targets --all-features -- -D warnings`
//!    провалюється → діагностика `cargo-clippy-violation`, ПРОДОВЖУЄ (не
//!    return).
//! 5. `deny.toml` відсутній у батчі → діагностика `deny-config-missing`,
//!    RETURN.
//! 6. `cargo deny --version` non-zero — ДО §2.33 ТИХИЙ skip (fail-open,
//!    єдина fail-open гілка цього ланцюжка) — `cargo-deny` не встановлено,
//!    ліцензійну перевірку пропущено БЕЗ діагностики. ПІСЛЯ §2.33
//!    ([`cargo_deny_unavailable_diagnostic`]) — видима діагностика
//!    `cargo-deny-unavailable`, RETURN: `cargo-deny` — опційний тул
//!    (`n-rust.mdc`), але «опційний» ≠ «мовчазно не перевірено» — якщо
//!    перевірка не виконалась, користувач має це бачити (задача §2.33).
//!    Код виходу НЕ відрізняє «`cargo-deny` свідомо не встановлено» від
//!    «встановлено, але зламано» (обидва дають ненульовий/`None` статус
//!    без надійної ознаки в тексті помилки, залежної від cargo-версії/
//!    локалі) — тож канал вибирає ГУЧНІШИЙ варіант і сигналить в ОБОХ
//!    випадках однаково, ЗАМІСТЬ спроби роздвоїти на «інсталюй» і «полагодь»
//!    за крихким текстовим патерном.
//! 7. `cargo deny check licenses` провалюється → діагностика
//!    `cargo-deny-violation` (останній крок, нічого далі).
//!
//! Помилка тут — не косметична: неправильна форма змінює, ЯКІ порушення
//! співіснують в одному прогоні (напр. невірний early-return на кроці 4
//! приховав би `cargo-deny-violation` кожного разу, коли clippy теж
//! провалюється, хоча канон видає ОБИДВІ діагностики одночасно).
//!
//! # `rust/cargo_mutants_config` — дві СВІДОМІ поведінкові відмінності
//!
//! (a) **Немає in-detector self-gate `.n-rules.json`.** JS-канон читає
//!     `readNRulesConfigLite(cwd)` і рано виходить, якщо `rust` не в
//!     `config.rules`/є в `config.disableRules`. Верифіковано незалежно
//!     (не здогад): `enabledRuleIds`
//!     (`npm/scripts/lib/lint-surface/run-detectors.mjs:280`) фільтрує за
//!     `isRuleEnabled` ДО `buildLintPlan` у ВСІХ трьох режимах виклику, і
//!     обидва предикати (in-detector і pre-filter) погоджуються НАВІТЬ на
//!     межовому `!config.exists` — pre-filter повертає `[]`, концерн
//!     узагалі не диспатчиться. In-detector перевірка існує ЛИШЕ для
//!     окремого debug-entrypoint-у, якого в гостя немає (WIT-контракт не
//!     несе такого виклику) — видалення тут не змінює жодної реальної
//!     поведінки продакшн-виклику, лише прибирає мертвий для гостя код.
//! (b) **Немає перевірки існування `BASELINE_PATH`.** JS-канон читає
//!     шаблон `data/cargo_mutants_config/mutants.toml.baseline` ВСЕРЕДИНІ
//!     власного npm-пакета через `dirname(fileURLToPath(import.meta.url))`
//!     — шлях, недосяжний для гостя (wasm-компонент не має доступу до
//!     файлової системи хост-пакета, доккомент `Capabilities` нижче).
//!     Детектор НІКОЛИ не читає ВМІСТ baseline — лише факт існування;
//!     вміст споживає ВИКЛЮЧНО T0-фіксер (`fix-cargo_mutants_config.mjs`),
//!     який лишається JS. Чесна ціна: зламаний npm-пакет (без
//!     `data/cargo_mutants_config/mutants.toml.baseline`) дає діагностику
//!     в JS і мовчання в гостя — жодна parity-фікстура це не покриє (не
//!     забутий крок, задокументована межа).
//! (c) **`resolveAllCargoManifests` — `workspaces`-записи ТЕПЕР
//!     glob-розкриваються, латентний баг джерела ВИПРАВЛЕНО.** Раніше
//!     [`resolve_all_cargo_manifests`] буквально відтворювала баг
//!     `resolveAllCargoManifests` (`npm/scripts/utils/resolve-cargo-manifest.mjs:42-60`,
//!     деталь ДЕТЕКТОРА `rust/cargo_mutants_config` `main.mjs`, вже
//!     ВИДАЛЕНОГО разом із цією хвилею порту): `workspaces`-запис
//!     використовувався як ЛІТЕРАЛЬНИЙ сегмент шляху, тож типовий
//!     `"workspaces": ["packages/*"]` шукав каталог, буквально названий
//!     `*`, і НІЧОГО не знаходив — концерн тихо не перевіряв жоден пакет із
//!     найпоширенішої npm/bun-конвенції монорепо. Єдиним обґрунтуванням
//!     цієї консервації була байт-у-байт парність із JS-ДЕТЕКТОРОМ; після
//!     видалення `main.mjs` цей аргумент зник — «парність із неіснуючою
//!     реалізацією» не аргумент. [`expand_workspace_entry_dirs`] тепер
//!     розкриває `*`(в межах сегмента)/`**`(крізь сегменти)-glob проти вже
//!     наданого host-батчу (той самий «жодного FS-обходу» принцип, що решта
//!     крейта, і той самий стиль regex-компіляції, що
//!     [`workspace_root_pattern_regex`] для `members`/`exclude` — БЕЗ нового
//!     крейта: `globset` (`crates/rules-napi`, host-бік) роздув би
//!     wasm-бюджет, а вже підключений `regex` цього крейта — досить). ЛІТЕРАЛЬНІ
//!     (без `*`) записи йдуть коротким шляхом БЕЗ regex-компайлу — той самий
//!     код-шлях, що й раніше (регресія неможлива). Tauri-перевага
//!     (`<dir>/src-tauri/Cargo.toml` над `<dir>/Cargo.toml`) застосовується
//!     до КОЖНОГО розкритого каталогу окремо, а не до патерна. Розкриття
//!     явно сортується (`sort_unstable`+`dedup`) — обхід батчу не гарантує
//!     стабільного порядку, а порядок маніфестів впливає на порядок
//!     діагностик.
//!
//!     Симетрія з T0-фіксером: `npm/scripts/utils/resolve-cargo-manifest.mjs`
//!     (детектор `main.mjs` видалено, але сам файл ЖИВИЙ — його
//!     `resolveAllCargoManifests`/`resolveCargoManifest` досі споживає T0-фіксер
//!     `fix-cargo_mutants_config.mjs`) отримав ТОЙ САМИЙ фікс ОКРЕМО, тим самим
//!     PR: `expandWorkspaceEntryDirs` там — дзеркало [`expand_workspace_entry_dirs`]
//!     тут, інше джерело кандидатів (`scanGlob` по реальному диску, а не
//!     host-батч), той самий результат для того самого дерева файлів.
//!     Без цього другого фікса детектор (гість) знаходив би
//!     `packages/a/.cargo/mutants.toml` як відсутній, а фіксер — ні (досі
//!     шукав би буквальний каталог `*`), тобто видавав би діагностику, яку
//!     `npx @7n/rules lint rust` не міг би закрити. Перевірено дією:
//!     `wasm-plugin-parity-rust.test.mjs`, T0-цикл `cargo_mutants_config:
//!     glob-workspaces (packages/*) — фіксер створює baseline у РОЗКРИТОМУ
//!     каталозі` — гість детектує, JS-фіксер застосовує, повторний детект
//!     гостя чистий.
//!
//! # `rust/wasm_component` — межа `{ workspace = true }`-успадкування
//!
//! Канон резолвить `{ workspace = true }`-успадковані `wasm-bindgen`/
//! `wasmtime` через `findAncestorWorkspaceRoot`
//! (`npm/scripts/utils/cargo-workspace.mjs`) — РЕАЛЬНИЙ обхід диска вгору
//! від каталогу крейту до кореня репо, незалежно від того, що прийшло в
//! `ctx.files`. Гість читає ЛИШЕ вже наданий host-батч
//! ([`wasm_component_resolve_workspace_dependency`]) — жодного
//! FS-обходу.
//!
//! Контрибуція `rust/wasm_component` — per-file, той самий глоб
//! (`**/Cargo.toml`), що й `concern.json` цього концерну: власний
//! ЦІЛЬОВИЙ файл (Cargo.toml, що перевіряється на `wasm-bindgen`/
//! `wasmtime`) завжди в батчі — анкер-розрив тут неможливий В ПРИНЦИПІ.
//! АЛЕ анкера для АНЦЕСТОРА (де живе `[workspace.dependencies]`) свідомо
//! НЕМАЄ: єдиний кандидат — корінь (`Cargo.toml`), і додавання його як
//! `lint.anchors`-запису зіткнулося б із тим, що анкер СПІВПАДАЄ з ЦІЛЬОВИМ
//! глобом цього ж концерну (на відміну від `python/mypy`, де анкер
//! `pyproject.toml` НЕ `.py`-файл і природно відфільтровується від
//! `targets`) — синтетично додана анкер-копія кореневого `Cargo.toml` сама
//! стала б ЗАЙВОЮ ціллю перевірки, якої в реальному delta-прогоні
//! JS-канону немає, тобто новий розрив parity замість старого. Свідомо НЕ
//! додано.
//!
//! Наслідок — ЧЕСНО задокументована різниця покриття, не мовчазна
//! апроксимація: у full-scope прогоні (`lint --full`, ВЕСЬ `**/Cargo.toml`
//! у батчі — JS-оркестрація сама будує повний список per-file-концерну,
//! доккомент `crates/rules-napi::run_wasm_concern`) резолв
//! ІДЕНТИЧНИЙ канону — предок завжди в батчі. У вузькому delta-прогоні,
//! що зачіпає ЛИШЕ Cargo.toml не-кореневого крейту (корінь НЕ змінювався,
//! отже НЕ в делта-батчі), [`wasm_component_resolve_workspace_dependency`]
//! не знайде предка й поверне `None` — ТОЙ САМИЙ канал, що канон уже
//! свідомо використовує для «предка не знайдено» («навмисно тихо —
//! уникаємо хибних спрацювань на успадкуванні, яке не вдалось розв'язати»,
//! коментар `checkWasmBindgen`/`checkWasmtime`). Тобто деградація ЗАВЖДИ
//! в бік ТИШІ (пропущена діагностика), НІКОЛИ в бік хибного
//! спрацювання — але це РЕАЛЬНЕ звуження покриття в delta-режимі, якого
//! в канону (що завжди читає реальний диск) немає. Порт додатково передбачає
//! єдиний кореневий workspace (те саме обмеження, що вже забезпечує сусідній
//! концерн [`detect_workspace_root`]) — вкладений (не кореневий) workspace
//! root, який `cargo-workspace.mjs` як спільна утиліта в принципі підтримує
//! (Tauri-подібні шари), тут не резолвиться взагалі: лише кореневий
//! `Cargo.toml` — кандидат в ancestor-пошуку по батчу.

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

/// Ключ контрибуції `rust/applies` — точний відповідник
/// `${ctx.ruleId}/${ctx.concernId}` (`runConcernDetector`,
/// `npm/scripts/lib/lint-surface/detect.mjs`).
const CONCERN_APPLIES: &str = "rust/applies";

/// Ключ контрибуції `rust/doc_comments`.
const CONCERN_DOC_COMMENTS: &str = "rust/doc_comments";

/// Ключ контрибуції `rust/workspace_root`.
const CONCERN_WORKSPACE_ROOT: &str = "rust/workspace_root";

/// Ключ контрибуції `rust/check` — друга хвиля порту (доккомент модуля,
/// розділ «ДРУГА ХВИЛЯ»).
const CONCERN_CHECK: &str = "rust/check";

/// Ключ контрибуції `rust/cargo_mutants_config`.
const CONCERN_CARGO_MUTANTS_CONFIG: &str = "rust/cargo_mutants_config";

/// Ключ контрибуції `rust/wasm_component`.
const CONCERN_WASM_COMPONENT: &str = "rust/wasm_component";

/// Шукає файл у батчі за точним posix-relative шляхом — batch-відповідник
/// `existsSync` JS-оригіналу (той самий helper, що
/// `crates/plugin-lang-python/src/lib.rs::batch_file`, продубльований тут:
/// крейти не діляться кодом через wasm-межу). Наразі жоден концерн цієї
/// хвилі не потребує точкового пошуку за шляхом (обидва full-scope концерни
/// аналізують ВЕСЬ батч), лишений як спільний утиліт-примітив на майбутню
/// хвилю (`allow(dead_code)` замість видалення — той самий мотив, що
/// невикористані варіанти `JsonValue` у python-крейті). Друга хвиля вже
/// споживає цей helper ([`detect_check`], [`resolve_all_cargo_manifests`],
/// [`detect_cargo_mutants_config`]) — `allow(dead_code)` знято.
fn batch_file<'a>(files: &'a [SourceFile], path: &str) -> Option<&'a SourceFile> {
    files.iter().find(|f| f.path == path)
}

/// Мінімальне (без сторонніх крейтів) JSON string-екранування — точний
/// набір спецсимволів `JSON.stringify` для рядків (`"`, `\`, control chars),
/// той самий helper, що `crates/plugin-lang-js`/`crates/plugin-lang-python`.
fn json_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Діагностика без `file`/`data` — точний відповідник дефолтної гілки
/// `createViolationReporter.fail` (немає споживача в цій хвилі — `applies`
/// нічого не репортує, `workspace_root`'s bare-повідомлення теж не мають
/// `file`, але будуються прямим `Diagnostic`-літералом нижче для ясності
/// сигнатури; лишено як спільний примітив на майбутнє, той самий мотив, що
/// [`batch_file`]). Друга хвиля вже споживає цей helper ([`detect_check`],
/// [`detect_cargo_mutants_config`]) — `allow(dead_code)` знято.
fn plain_violation(reason: &str, message: String) -> Diagnostic {
    Diagnostic {
        reason: reason.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Точний порт `lint()` `rust/applies`
/// (`plugins/lang-rust/rules/rust/applies/main.mjs`): чистий context-pass —
/// `reporter.pass(...)` `createViolationReporter` завжди no-op (доккомент
/// `npm/scripts/lib/lint-surface/violation-reporter.mjs`), тож цей концерн
/// НІКОЛИ не видає діагностику. Формально full-scope (`glob = ["**/Cargo.toml"]`),
/// але вміст батчу навіть не читається.
fn detect_applies(_files: &[SourceFile]) -> Vec<Diagnostic> {
    Vec::new()
}

// =====================================================================
// `rust/doc_comments`
// =====================================================================

/// `reason` «файл із pub-елементами без провідного `//!`-коментаря» —
/// точний відповідник літерала `'missing-file-header'` (`main.mjs`).
const DOC_COMMENTS_MISSING_FILE_HEADER_REASON: &str = "missing-file-header";

/// `reason` «pub-елемент без `///`-опису» — точний відповідник
/// `'missing-pub-doc'`.
const DOC_COMMENTS_MISSING_PUB_DOC_REASON: &str = "missing-pub-doc";

/// Пояснювальна підказка для `missing-file-header` — точний відповідник
/// `FILE_HEADER_HINT` (`main.mjs`): doc-files копіює цей коментар дослівно.
const DOC_COMMENTS_FILE_HEADER_HINT: &str = "Глобальний сенс: конвеєр doc-files копіює цей коментар ДОСЛІВНО в секцію «Огляд» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього «Огляд» вигадує LLM із самого коду.";

/// Пояснювальна підказка для `missing-pub-doc` — точний відповідник
/// `PUB_DOC_HINT`.
const DOC_COMMENTS_PUB_DOC_HINT: &str = "Глобальний сенс: конвеєр doc-files бере цей опис ДОСЛІВНО в секцію «Публічний API» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього опис вигадує LLM.";

/// Тестові файли/каталоги — поза вимогою doc-коментарів. Точний порт
/// `EXCLUDED_FILE_RE` (`main.mjs`) — БЕЗ lookaround, портується напряму
/// (доккомент модуля, розділ «Regex-lookahead»).
const DOC_COMMENTS_EXCLUDED_PATTERN: &str = r"(?:(?:^|/)tests?/)|(?:_tests?\.rs$)";

/// `extern "C" ` — модифікатор-префікс, який [`parse_pub_item`] зрізає перед
/// пошуком `kind`/`name`. Точний порт `EXTERN_PREFIX_RE` (`main.mjs`).
const DOC_COMMENTS_EXTERN_PREFIX_PATTERN: &str = r#"^extern\s+"[^"]*"\s+"#;

/// `kind name` top-level pub-елемента (`fn`/`struct`/`enum`/`trait`/`mod`/
/// `static`/`type`/`union`/`const`). Точний порт `KIND_NAME_RE` (`main.mjs`)
/// — З ОДНІЄЮ свідомою відмінністю запису: група імені написана як
/// `[0-9A-Za-z_]+`, НЕ `\w+`. Причина — реальна семантична розбіжність,
/// виявлена (не здогад) при написанні parity-тестів: JS `\w` у ECMA-262
/// ЗАВЖДИ ASCII-only (`[A-Za-z0-9_]`, незалежно від прапорця `u`), тоді як
/// Rust `regex`-крейт за замовчуванням (навіть із самою лише фічею
/// `unicode-perl`, яка вмикає ДАНІ для Perl-класів, а не звужує їх до ASCII)
/// компілює `\w` як Unicode-обізнаний клас — літера кирилиці чи інший
/// Unicode word char МАТЧИТЬ Rust `\w`, але НІКОЛИ не матчить JS `\w`. Для
/// `PUBLIC_DEF_RE` python-сусіда цей ризик обмежений (перший символ імені
/// зафіксований у `[A-Za-z]`, доккомент `crates/plugin-lang-python/src/lib.rs`
/// щодо навмисно ASCII `def`-імені), але тут `(\w+)` — ПЕРШИЙ символ імені
/// теж під `\w`, тож без цього фікса `pub fn облік() { … }` матчив би в Rust
/// (captures name="облік"), а в JS — НЕ матчив би взагалі (рядок узагалі не
/// розпізнається як pub-елемент, `parsePubItem` повертає `null`) — тиха
/// розбіжність violation-множини, не лише тексту. Явний ASCII-клас усуває
/// розбіжність повністю, без прапорця `(?-u:...)` (той самий результат,
/// прозоріший запис). Перевірено юніт-тестом
/// [`tests::detect_doc_comments_non_ascii_identifier_is_not_a_pub_item_matching_js_ascii_only_w`].
const DOC_COMMENTS_KIND_NAME_PATTERN: &str =
    r"^(fn|struct|enum|trait|mod|static|type|union|const)\s+([0-9A-Za-z_]+)";

/// Модифікатори, які [`parse_pub_item`] зрізає ІТЕРАТИВНО перед `extern`/
/// `kind name` — точний порт `PUB_MODIFIERS` (`main.mjs`).
const PUB_MODIFIERS: &[&str] = &["async ", "unsafe ", "const "];

/// Один top-level `pub`-елемент. Дзеркало JS-об'єкта `{ kind, name }`
/// (`parsePubItem`, `main.mjs`).
struct PubItem {
    /// `"fn"`/`"struct"`/… — точний захоплений текст групи 1.
    kind: String,
    /// Ім'я символу — точний захоплений текст групи 2.
    name: String,
}

/// Точний порт `parsePubItem` (`main.mjs`): розбирає top-level `pub`-елемент
/// із рядка (колонка 0). Модифікатори (`async `/`unsafe `/`const `) і
/// `extern "…" ` зрізаються ітеративно, ПОКИ рядок ще матчить один з них —
/// той самий цикл, що JS-оригінал (коментар джерела: «зрізаємо ітеративно
/// замість одного складного regex»).
fn parse_pub_item(
    line: &str,
    extern_re: &regex::Regex,
    kind_name_re: &regex::Regex,
) -> Option<PubItem> {
    if !line.starts_with("pub") {
        return None;
    }
    // `line.startsWith('pub ') ? line.slice(4) : ''` JS-оригіналу: рядок без
    // пробілу одразу після `pub` (напр. голий `"pub"` чи `"public"`) —
    // `rest` порожній ⇒ рання `None` нижче.
    let mut rest = line.strip_prefix("pub ")?;
    if rest.is_empty() {
        return None;
    }
    loop {
        if let Some(&modifier) = PUB_MODIFIERS.iter().find(|m| rest.starts_with(**m)) {
            // `pub const NAME` — це kind, а `pub const fn` — модифікатор:
            // зрізаємо `const ` лише якщо далі йде `fn `.
            if modifier == "const " && !rest[modifier.len()..].starts_with("fn ") {
                break;
            }
            rest = &rest[modifier.len()..];
            continue;
        }
        if let Some(m) = extern_re.find(rest) {
            rest = &rest[m.end()..];
            continue;
        }
        break;
    }
    kind_name_re.captures(rest).map(|c| PubItem {
        kind: c[1].to_string(),
        name: c[2].to_string(),
    })
}

/// Чи підпадає файл під вимогу doc-коментарів. Точний порт
/// `isDocCommentTarget` (`main.mjs`).
fn is_doc_comment_target(rel_posix: &str, excluded_re: &regex::Regex) -> bool {
    rel_posix.ends_with(".rs") && !excluded_re.is_match(rel_posix)
}

/// `///`-рядок (rustdoc). Точний порт `DOC_LINE_RE` (`main.mjs`) — без
/// regex, простий префікс після зняття провідних пробілів (доккомент
/// модуля, розділ «Regex-lookahead»). `"////"` теж матчить (JS-регекс не
/// вимагає, щоб ЧЕТВЕРТИЙ символ був не `/` — лише перевіряє префікс
/// `///`), той самий контракт тут.
fn is_doc_line(line: &str) -> bool {
    line.trim_start().starts_with("///")
}

/// `#[...]`-атрибут (колонка 0 після пробілів). Точний порт `ATTR_LINE_RE`.
fn is_attr_line(line: &str) -> bool {
    line.trim_start().starts_with("#[")
}

/// `#[cfg(test)]` РІВНО цей літерал (без варіацій на кшталт
/// `#[cfg(all(test, …))]`) — точний порт `CFG_TEST_RE`.
fn is_cfg_test_line(line: &str) -> bool {
    line.trim_start().starts_with("#[cfg(test)]")
}

/// Звичайний `//`-коментар, ЯКИЙ НЕ `///` і НЕ `//!` — точний семантичний
/// порт `PLAIN_COMMENT_RE = /^\s*\/\/(?![/!])/` (негативний lookahead) БЕЗ
/// regex-крейта: після зняття провідних пробілів і префікса `//` перевіряє,
/// що наступний символ — не `/` і не `!` (доккомент модуля, розділ
/// «Regex-lookahead»). Порожній залишок після `//` (рядок РІВНО `"//"`)
/// проходить — той самий контракт, що негативний lookahead на кінці рядка
/// (успішний, коли дивитись нема на що).
fn is_plain_comment_line(line: &str) -> bool {
    match line.trim_start().strip_prefix("//") {
        Some(rest) => !rest.starts_with('/') && !rest.starts_with('!'),
        None => false,
    }
}

/// Чи починається файл із `//!`-коментаря (перший непорожній рядок — `//!`
/// чи inner-атрибут `#![`). Точний порт `hasInnerDocHeader` (`main.mjs`).
fn has_inner_doc_header(lines: &[&str]) -> bool {
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        return trimmed.starts_with("//!") || trimmed.starts_with("#![");
    }
    false
}

/// Провідний суцільний `//`-блок на початку файлу (кандидат на T0 `//` →
/// `//!`) — точний порт `leadingPlainCommentBlock` (`main.mjs`). Провідні
/// порожні рядки пропускаються ДО старту блоку; порожній рядок ПІСЛЯ старту
/// завершує блок (не матчить [`is_plain_comment_line`]).
fn leading_plain_comment_block(lines: &[&str]) -> Option<(usize, usize)> {
    let mut from: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        if line.trim().is_empty() && from.is_none() {
            continue;
        }
        if is_plain_comment_line(line) {
            if from.is_none() {
                from = Some(i);
            }
            continue;
        }
        return from.map(|f| (f, i - 1));
    }
    from.map(|f| (f, lines.len() - 1))
}

/// Коментар-блок безпосередньо над елементом — точний порт
/// `commentBlockAbove` (`main.mjs`): `#[...]`-атрибути між коментарем і
/// елементом пропускаються (rustdoc стоїть НАД атрибутами). `doc: true` —
/// над елементом уже стоїть `///` (одна лінія, без пошуку суцільного
/// блоку — той самий контракт, що JS-оригінал); `doc: false` — суцільний
/// звичайний `//`-блок, кандидат на T0-промоцію.
struct CommentBlock {
    doc: bool,
    from_line: usize,
    to_line: usize,
}

fn comment_block_above(lines: &[&str], item_line: usize) -> Option<CommentBlock> {
    let mut i = item_line as isize - 1;
    while i >= 0 && is_attr_line(lines[i as usize]) {
        i -= 1;
    }
    if i < 0 {
        return None;
    }
    if is_doc_line(lines[i as usize]) {
        let idx = i as usize;
        return Some(CommentBlock {
            doc: true,
            from_line: idx,
            to_line: idx,
        });
    }
    if !is_plain_comment_line(lines[i as usize]) {
        return None;
    }
    let to = i as usize;
    while i >= 1 && is_plain_comment_line(lines[(i - 1) as usize]) {
        i -= 1;
    }
    Some(CommentBlock {
        doc: false,
        from_line: i as usize,
        to_line: to,
    })
}

/// Точний порт `checkFileDocComments` (`main.mjs`): `//!`-header + `///` над
/// кожним top-level pub-елементом. Сканування збору `items` зупиняється на
/// `#[cfg(test)]` (тест-модуль конвенційно наприкінці файлу); файл без
/// pub-елементів — поза вимогою (рання порожня відповідь).
fn check_file_doc_comments(
    src: &str,
    rel_posix: &str,
    extern_re: &regex::Regex,
    kind_name_re: &regex::Regex,
) -> Vec<Diagnostic> {
    let lines: Vec<&str> = src.split('\n').collect();
    let mut items: Vec<(PubItem, usize)> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if is_cfg_test_line(line) {
            break;
        }
        if let Some(item) = parse_pub_item(line, extern_re, kind_name_re) {
            items.push((item, i));
        }
    }
    if items.is_empty() {
        return Vec::new();
    }

    let mut violations = Vec::new();
    if !has_inner_doc_header(&lines) {
        let data = match leading_plain_comment_block(&lines) {
            Some((from_line, to_line)) => format!(
                "{{\"promotable\":true,\"fromLine\":{from_line},\"toLine\":{to_line},\"header\":true}}"
            ),
            None => "{\"header\":true}".to_string(),
        };
        violations.push(Diagnostic {
            reason: DOC_COMMENTS_MISSING_FILE_HEADER_REASON.to_string(),
            message: format!(
                "{rel_posix}: файл із pub-елементами без провідного //!-коментаря. {DOC_COMMENTS_FILE_HEADER_HINT}"
            ),
            file: Some(rel_posix.to_string()),
            severity: Severity::Error,
            data: Some(data),
        });
    }

    for (item, line) in &items {
        let above = comment_block_above(&lines, *line);
        if let Some(CommentBlock { doc: true, .. }) = above {
            continue;
        }
        let data = match &above {
            Some(block) => format!(
                "{{\"promotable\":true,\"fromLine\":{},\"toLine\":{},\"name\":{}}}",
                block.from_line,
                block.to_line,
                json_escape_string(&item.name)
            ),
            None => format!("{{\"name\":{}}}", json_escape_string(&item.name)),
        };
        violations.push(Diagnostic {
            reason: DOC_COMMENTS_MISSING_PUB_DOC_REASON.to_string(),
            message: format!(
                "{rel_posix}: pub {} {} без ///-опису. {DOC_COMMENTS_PUB_DOC_HINT}",
                item.kind, item.name
            ),
            file: Some(rel_posix.to_string()),
            severity: Severity::Error,
            data: Some(data),
        });
    }
    violations
}

/// Точний порт гілки `lint()` `rust/doc_comments` із переданими `files`
/// (`main.mjs`) — PER-FILE (доккомент модуля, розділ «Обхід дерева»): host
/// уже надав batch за `**/*.rs`, [`is_doc_comment_target`] лише повторює
/// `.rs`-фільтр і виняток тестових файлів JS-оригіналу.
fn detect_doc_comments(files: &[SourceFile]) -> Vec<Diagnostic> {
    let excluded_re = regex::Regex::new(DOC_COMMENTS_EXCLUDED_PATTERN)
        .expect("DOC_COMMENTS_EXCLUDED_PATTERN валідний");
    let extern_re = regex::Regex::new(DOC_COMMENTS_EXTERN_PREFIX_PATTERN)
        .expect("DOC_COMMENTS_EXTERN_PREFIX_PATTERN валідний");
    let kind_name_re = regex::Regex::new(DOC_COMMENTS_KIND_NAME_PATTERN)
        .expect("DOC_COMMENTS_KIND_NAME_PATTERN валідний");

    let mut out = Vec::new();
    for file in files {
        if !is_doc_comment_target(&file.path, &excluded_re) {
            continue;
        }
        out.extend(check_file_doc_comments(
            &file.content,
            &file.path,
            &extern_re,
            &kind_name_re,
        ));
    }
    out
}

// =====================================================================
// `rust/workspace_root`
// =====================================================================

use std::collections::{HashMap, HashSet};

/// `reason` вкладеного `[workspace]` поза кореневим `Cargo.toml`. Точний
/// відповідник `NESTED_WORKSPACE` (`main.mjs`).
const WORKSPACE_ROOT_NESTED_WORKSPACE_REASON: &str = "nested-workspace";

/// `reason` `[profile.*]` у не-кореневому `Cargo.toml`. Точний відповідник
/// `NESTED_PROFILE`. Немає python-аналога (доккомент модуля, розділ
/// «`rust/workspace_root` vs `python/workspace_root`»).
const WORKSPACE_ROOT_NESTED_PROFILE_REASON: &str = "nested-profile";

/// `reason` відсутнього/невалідного кореневого workspace root. Точний
/// відповідник `MISSING_ROOT_WORKSPACE`.
const WORKSPACE_ROOT_MISSING_ROOT_REASON: &str = "missing-root-workspace";

/// `reason` package-маніфесту поза `members` кореневого workspace. Точний
/// відповідник `PACKAGE_NOT_WORKSPACE_MEMBER`.
const WORKSPACE_ROOT_PACKAGE_NOT_MEMBER_REASON: &str = "package-not-workspace-member";

/// Спільний хвіст повідомлення кожної діагностики концерну — точний порт
/// `REMEDIATION` (`main.mjs`, конкатенація літералів звужена до одного
/// рядка: сама конкатенація JS — форматування джерела, не семантика).
const WORKSPACE_ROOT_REMEDIATION: &str = "створи/підтверди кореневий [workspace] (resolver = \"2\", members) у кореневому Cargo.toml, перенеси [profile.*] у корінь, видали вкладені [workspace] і їхні Cargo.lock — у репозиторії має лишитись один кореневий workspace і один Cargo.lock (rust/workspace_root.mdc)";

/// Каталоги, які [`detect_workspace_root`] НЕ бачить — точний порт
/// `RUST_WALK_IGNORED_DIR_NAMES` (`plugins/lang-rust/rules/rust/lib/ignored-dirs.mjs`).
/// Host-batch (`ConcernContribution::glob`, [`build_manifest`]) фільтрує
/// лише `.git`/`node_modules`/`.worktrees` + `.gitignore`
/// (`crates/rules-core/src/scan.rs::ALWAYS_IGNORE`) — решту
/// (`target`/`.next`/`.turbo`/`.venv`/`venv`/`.claude`/`vendor`) JS-оригінал
/// ігнорує ЗАВЖДИ, незалежно від `.gitignore`, тож гість повторює той самий
/// фільтр вручну ([`workspace_root_path_ignored`]). На відміну від
/// `python/workspace_root` (`__pycache__` замість `.worktrees` у списку) —
/// тут явно є `.worktrees` (rust-специфічний PR #179: два stale
/// auto-created worktree сипали 12 хибних `NESTED_WORKSPACE`, доккомент
/// JS-джерела).
const WORKSPACE_ROOT_IGNORED_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    ".next",
    ".turbo",
    ".venv",
    "venv",
    ".claude",
    "vendor",
    ".worktrees",
];

/// Мінімальний зріз `Cargo.toml`, потрібний [`detect_workspace_root`]:
/// наявність `[package]` (значення не важливе — `Option<IgnoredAny>` приймає
/// БУДЬ-яку валідну TOML-форму), `[workspace]` з `members`/`exclude`, і
/// наявність `[profile]` (значення теж не важливе — сам факт присутності
/// ключа, той самий контракт, що `parsed.profile` truthy-перевірка
/// JS-оригіналу). `#[serde(default)]` на кожному полі — tolerant-парсинг,
/// той самий дух, що `smol-toml`-виклик JS-оригіналу (без схеми, невідомі
/// ключі мовчки ігноруються). Вибір `basic-toml` замість `toml`/`toml_edit`
/// — той самий обгрунтований вимір, що `crates/plugin-lang-python/Cargo.toml`
/// (доккомент залежності в `Cargo.toml` цього крейта): ідентичний typed-struct
/// probe, той самий крейт, вимірювати вдруге для того самого виклику нема
/// підстав.
#[derive(serde::Deserialize, Default)]
struct WorkspaceRootCargoToml {
    #[serde(default)]
    package: Option<serde::de::IgnoredAny>,
    #[serde(default)]
    workspace: Option<WorkspaceRootWorkspaceTable>,
    #[serde(default)]
    profile: Option<serde::de::IgnoredAny>,
}

/// `[workspace]` — точний зріз `main.mjs`: `members`/`exclude`, відсутність
/// поля = порожній масив (той самий дефолт, що `Array.isArray(workspace.members)
/// ? workspace.members : []`).
#[derive(serde::Deserialize, Default)]
struct WorkspaceRootWorkspaceTable {
    #[serde(default)]
    members: Vec<String>,
    #[serde(default)]
    exclude: Vec<String>,
}

/// Точний порт `readManifest` (`main.mjs`) для вже наданого host-ом вмісту
/// файлу (батч, не диск): `None` на невалідний TOML — той самий catch-null
/// JS-оригіналу.
fn workspace_root_parse_cargo_toml(content: &str) -> Option<WorkspaceRootCargoToml> {
    basic_toml::from_str(content).ok()
}

/// Чи лежить posix-relative шлях усередині одного з
/// [`WORKSPACE_ROOT_IGNORED_DIR_NAMES`].
fn workspace_root_path_ignored(path: &str) -> bool {
    path.split('/')
        .any(|segment| WORKSPACE_ROOT_IGNORED_DIR_NAMES.contains(&segment))
}

/// Posix "dirname": усе до останнього `/` (без нього), чи `""` для кореня.
/// Той самий мотив, що `dirname()`/`relative(cwd, ...)` JS-оригіналу, але
/// без реального FS-виклику — батч-шлях уже posix-relative до `cwd`.
fn workspace_root_dirname(path: &str) -> &str {
    match path.rfind('/') {
        Some(idx) => &path[..idx],
        None => "",
    }
}

/// Компілює `members`/`exclude`-патерн (літерал чи з одинарними `*`, БЕЗ
/// `**`) у прив'язаний regex — `*` не перетинає `/`, точний port
/// `resolveWorkspaceMemberDirs` (`npm/scripts/utils/cargo-workspace.mjs`),
/// той самий обмежений glob, що `scanGlob(pattern/Cargo.toml)` дає для
/// патернів на кшталт `"crates/*"` (доккомент `cargo-workspace.mjs`: «Без
/// повної Cargo glob-семантики — лише `*`-сегменти й літерали»). Символи
/// поза `*` екрануються по одному.
fn workspace_root_pattern_regex(pattern: &str) -> Option<regex::Regex> {
    let mut source = String::from("^");
    for ch in pattern.chars() {
        match ch {
            '*' => source.push_str("[^/]*"),
            c if "\\.+()|[]{}^$?".contains(c) => {
                source.push('\\');
                source.push(c);
            }
            c => source.push(c),
        }
    }
    source.push('$');
    regex::Regex::new(&source).ok()
}

/// Точний порт `resolveWorkspaceMemberDirs` (`cargo-workspace.mjs`),
/// адаптований під wasm-гостя: замість `existsSync`/`scanGlob` по реальному
/// диску матчить `members`/`exclude`-патерни проти вже відомого набору
/// каталогів із знайденими `Cargo.toml` — того самого host-батчу, що
/// [`detect_workspace_root`] уже має (full-scope глоб покрив УСЕ дерево),
/// тож окремий FS-обхід тут не потрібен: дані для «чи існує `Cargo.toml` у
/// цьому каталозі» вже на руках. `pattern.trim_end_matches('/')` — той самий
/// `TRAILING_SLASH_RE`-нормалізатор, що JS-оригінал.
fn workspace_root_resolve_member_dirs<'a>(
    known_dirs: &[&'a str],
    patterns: &[String],
) -> HashSet<&'a str> {
    let mut found = HashSet::new();
    for pattern in patterns {
        let norm = pattern.trim_end_matches('/');
        if norm.contains('*') {
            let Some(re) = workspace_root_pattern_regex(norm) else {
                continue;
            };
            for &dir in known_dirs {
                if re.is_match(dir) {
                    found.insert(dir);
                }
            }
        } else if let Some(&dir) = known_dirs.iter().find(|&&d| d == norm) {
            found.insert(dir);
        }
    }
    found
}

/// Діагностика з `file` (nested-workspace/nested-profile/
/// package-not-workspace-member) — точний відповідник `reporter.fail(msg, {
/// reason, file })`: `data` не встановлюється (`None`).
fn workspace_root_file_violation(reason: &str, message: String, file: &str) -> Diagnostic {
    Diagnostic {
        reason: reason.to_string(),
        message,
        file: Some(file.to_string()),
        severity: Severity::Error,
        data: None,
    }
}

/// Звітує про вкладені `[workspace]`/`[profile.*]` у не-кореневих
/// маніфестах — точний порт `reportNestedTables` (`main.mjs`): ОБИДВІ
/// перевірки незалежні (один маніфест може отримати обидва порушення, два
/// окремі `if`, не `else if` — доккомент модуля).
fn workspace_root_report_nested_tables<'a>(
    manifest_files: &[&'a SourceFile],
    parsed_by_path: &HashMap<&'a str, Option<WorkspaceRootCargoToml>>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    for file in manifest_files {
        let path = file.path.as_str();
        if path == "Cargo.toml" {
            continue;
        }
        let Some(Some(parsed)) = parsed_by_path.get(path) else {
            continue;
        };
        if parsed.workspace.is_some() {
            diagnostics.push(workspace_root_file_violation(
                WORKSPACE_ROOT_NESTED_WORKSPACE_REASON,
                format!(
                    "{path}: вкладений [workspace] поза кореневим Cargo.toml — {WORKSPACE_ROOT_REMEDIATION}"
                ),
                path,
            ));
        }
        if parsed.profile.is_some() {
            diagnostics.push(workspace_root_file_violation(
                WORKSPACE_ROOT_NESTED_PROFILE_REASON,
                format!(
                    "{path}: [profile.*] поза кореневим Cargo.toml — Cargo мовчки ігнорує чи видає попередження на profile-секції у не-кореневих маніфестах. {WORKSPACE_ROOT_REMEDIATION}"
                ),
                path,
            ));
        }
    }
}

/// Точний порт `lint()` `rust/workspace_root` (`main.mjs`) — WHOLE-BATCH
/// (glob `["**/Cargo.toml"]`, [`build_manifest`]), єдиний концерн цього
/// крейта, що сам обходить УСЕ дерево репозиторію. Host уже надав batch за
/// глобом (`build_full_scope_files`, `crates/rules-napi/src/lib.rs`), але
/// той поважає лише `.gitignore` + `ALWAYS_IGNORE`
/// (`.git`/`node_modules`/`.worktrees`) — решту
/// [`WORKSPACE_ROOT_IGNORED_DIR_NAMES`] гість фільтрує сам
/// ([`workspace_root_path_ignored`]). На відміну від `python/workspace_root`
/// — НЕМАЄ перевірки вкладеного lockfile (доккомент модуля, розділ
/// «vs python/workspace_root»).
fn detect_workspace_root(files: &[SourceFile]) -> Vec<Diagnostic> {
    let manifest_files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| {
            (f.path == "Cargo.toml" || f.path.ends_with("/Cargo.toml"))
                && !workspace_root_path_ignored(&f.path)
        })
        .collect();

    let parsed_by_path: HashMap<&str, Option<WorkspaceRootCargoToml>> = manifest_files
        .iter()
        .map(|f| (f.path.as_str(), workspace_root_parse_cargo_toml(&f.content)))
        .collect();

    let package_manifest_paths: Vec<&str> = manifest_files
        .iter()
        .map(|f| f.path.as_str())
        .filter(|p| {
            parsed_by_path
                .get(p)
                .and_then(|opt| opt.as_ref())
                .is_some_and(|parsed| parsed.package.is_some())
        })
        .collect();
    // жодного Rust-пакета (з [package]) у дереві — концерн не застосовний.
    if package_manifest_paths.is_empty() {
        return Vec::new();
    }

    let mut diagnostics = Vec::new();
    workspace_root_report_nested_tables(&manifest_files, &parsed_by_path, &mut diagnostics);

    let root_parsed = parsed_by_path
        .get("Cargo.toml")
        .and_then(|opt| opt.as_ref());
    let Some(root_parsed) = root_parsed else {
        diagnostics.push(plain_violation(
            WORKSPACE_ROOT_MISSING_ROOT_REASON,
            format!(
                "Cargo.toml відсутній у корені репозиторію, але знайдено {} package-маніфест(и). {WORKSPACE_ROOT_REMEDIATION}",
                package_manifest_paths.len()
            ),
        ));
        return diagnostics;
    };

    let other_package_manifest_paths: Vec<&str> = package_manifest_paths
        .iter()
        .copied()
        .filter(|&p| p != "Cargo.toml")
        .collect();

    let Some(root_workspace) = root_parsed.workspace.as_ref() else {
        if root_parsed.package.is_some() && other_package_manifest_paths.is_empty() {
            // Єдиний кореневий package — Cargo неявно робить його власним
            // workspace root. `pass(...)` — no-op; уже накопичені
            // nested-workspace/nested-profile діагностики вище лишаються в
            // результаті — точна калька раннього `return reporter.result()`
            // JS-оригіналу.
            return diagnostics;
        }
        diagnostics.push(plain_violation(
            WORKSPACE_ROOT_MISSING_ROOT_REASON,
            format!(
                "Кореневий Cargo.toml не є workspace root (немає [workspace]), а в репозиторії {} package-маніфест(и). {WORKSPACE_ROOT_REMEDIATION}",
                package_manifest_paths.len()
            ),
        ));
        return diagnostics;
    };

    let manifest_dirs: Vec<&str> = manifest_files
        .iter()
        .map(|f| workspace_root_dirname(&f.path))
        .collect();
    let member_dirs = workspace_root_resolve_member_dirs(&manifest_dirs, &root_workspace.members);
    let exclude_dirs = workspace_root_resolve_member_dirs(&manifest_dirs, &root_workspace.exclude);

    for &path in &other_package_manifest_paths {
        let dir = workspace_root_dirname(path);
        if exclude_dirs.contains(dir) || member_dirs.contains(dir) {
            continue;
        }
        diagnostics.push(workspace_root_file_violation(
            WORKSPACE_ROOT_PACKAGE_NOT_MEMBER_REASON,
            format!(
                "{path}: package не покритий members кореневого workspace — додай шлях у [workspace].members кореневого Cargo.toml (або відобрази у workspace.exclude). {WORKSPACE_ROOT_REMEDIATION}"
            ),
            path,
        ));
    }

    diagnostics
}

// =====================================================================
// `rust/check` — друга хвиля порту, ПІЛОТ `exec-tool` цього крейта
// (доккомент модуля, розділ «ДРУГА ХВИЛЯ» і «`rust/check` — ланцюжок НЕ
// уніформний»).
// =====================================================================

/// Декларація тула `rust/check` — схема `path:` (та сама, що [`UV_TOOL`]
/// `crates/plugin-lang-python/src/lib.rs`): резолв по `PATH`, точний
/// відповідник `resolveCmd('cargo')` JS-оригіналу.
const CHECK_TOOL: &str = "path:cargo";

/// `reason` «`cargo` не резолвиться» — точний відповідник літерала
/// `fail(msg, 'cargo-missing')` (`main.mjs`).
const CHECK_CARGO_MISSING_REASON: &str = "cargo-missing";

/// Повідомлення «`cargo` не знайдено» — точний відповідник рядкового
/// літерала `main.mjs`.
const CHECK_CARGO_MISSING_MESSAGE: &str =
    "lint-rust: `cargo` не знайдено в PATH (Rust toolchain через rustup, rust.mdc)";

/// `reason` провалу `cargo fmt --all -- --check` — точний відповідник
/// `runCargo(..., 'cargo-fmt-violation')`.
const CHECK_CARGO_FMT_VIOLATION_REASON: &str = "cargo-fmt-violation";

/// `reason` провалу `cargo clippy --all-targets --all-features -- -D
/// warnings` — точний відповідник `runCargo(..., 'cargo-clippy-violation')`.
const CHECK_CARGO_CLIPPY_VIOLATION_REASON: &str = "cargo-clippy-violation";

/// `reason` відсутнього `deny.toml` — точний відповідник `fail(msg,
/// 'deny-config-missing')`.
const CHECK_DENY_CONFIG_MISSING_REASON: &str = "deny-config-missing";

/// Повідомлення «немає `deny.toml`» — точний відповідник рядкового
/// літерала `main.mjs`.
const CHECK_DENY_CONFIG_MISSING_MESSAGE: &str = "lint-rust: cargo deny — немає deny.toml; запустіть `npx @7n/rules fix rust` локально для генерації (rust.mdc)";

/// `reason` провалу `cargo deny check licenses` — точний відповідник
/// `runCargo(..., 'cargo-deny-violation')`.
const CHECK_CARGO_DENY_VIOLATION_REASON: &str = "cargo-deny-violation";

/// `reason` видимої діагностики «`cargo deny` недоступний» — НЕМАЄ
/// канонічного JS-відповідника (§2.33, доккомент модуля, розділ
/// «`rust/check` — ланцюжок НЕ уніформний», крок 6): до фіксу ця гілка була
/// мовчазною, `reason` навмисно ІНШИЙ, ніж
/// [`CHECK_CARGO_DENY_VIOLATION_REASON`] (той ловить провал ЛІЦЕНЗІЙНОЇ
/// перевірки при доступному тулі, цей — недоступність самого тула).
const CHECK_CARGO_DENY_UNAVAILABLE_REASON: &str = "cargo-deny-unavailable";

/// Ліміт довжини вставки чужого stdout/stderr у повідомлення — точний
/// відповідник `.slice(0, 2000)` (`runCargo`, `main.mjs`).
const CHECK_DETAIL_LIMIT: usize = 2000;

/// Обрізає рядок до `limit` СИМВОЛІВ (не байтів) — той самий helper, що
/// `crates/plugin-lang-python/src/lib.rs::truncate_chars` (продубльований
/// тут: крейти не діляться кодом через wasm-межу, доккомент [`batch_file`]).
fn truncate_chars(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        Some((index, _)) => text[..index].to_string(),
        None => text.to_string(),
    }
}

/// Формує повідомлення провалу кроку `cargo` — точний хвіст `runCargo`
/// (`main.mjs`): stdout+stderr, trim, зріз до [`CHECK_DETAIL_LIMIT`], з
/// провідним `\n` лише якщо непорожньо.
fn check_step_message(label: &str, code: i32, stdout: &str, stderr: &str) -> String {
    let combined = format!("{stdout}{stderr}");
    let out = truncate_chars(combined.trim(), CHECK_DETAIL_LIMIT);
    let suffix = if out.is_empty() {
        String::new()
    } else {
        format!("\n{out}")
    };
    format!("lint-rust: {label} — помилка (код {code}, rust.mdc){suffix}")
}

/// Спавнить `cargo <args>` через `exec-tool` — спільний нижній рівень усіх
/// кроків [`detect_check`].
fn exec_cargo(args: Vec<String>) -> ToolResult {
    exec_tool(&ToolRequest {
        tool: CHECK_TOOL.to_string(),
        args,
        stdin: None,
        // `None` — корінь репо, рівно `cwd: undefined` (успадкований
        // `ctx.cwd`) JS-оригіналу (`spawnAsync(cargo, args, { cwd })`, де
        // `cwd = ctx.cwd`).
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    })
}

/// Крок `cargo <args>` ПІСЛЯ вже підтвердженого резолву `cargo` (перший
/// крок — `cargo fmt --check` — пройшов, доккомент [`detect_check`]).
/// `status: None` тут структурно неможливий (той самий `ToolResolver`, той
/// самий виклик у межах одного `detect()`), тож трактується як звичайна
/// відмова з кодом 1 (`unwrap_or(1)`) — той самий підхід, що друга-і-далі
/// `exec_tool`-виклики `detect_mypy`/`run_ruff_step`
/// (`crates/plugin-lang-python/src/lib.rs`, коментар «після успішного
/// preflight будь-яка аномалія другого спавну трактується як ПОРУШЕННЯ, НЕ
/// як `uv-missing` вдруге»). Повертає `true` — крок пройшов
/// (`exitCode === 0`).
fn run_cargo_step(
    label: &str,
    args: Vec<String>,
    reason: &str,
    diagnostics: &mut Vec<Diagnostic>,
) -> bool {
    let result = exec_cargo(args);
    let code = result.status.unwrap_or(1);
    if code == 0 {
        return true;
    }
    diagnostics.push(plain_violation(
        reason,
        check_step_message(label, code, &result.stdout, &result.stderr),
    ));
    false
}

/// Чиста перевірка результату `cargo deny --version` (§2.33, доккомент
/// модуля, розділ «`rust/check` — ланцюжок НЕ уніформний», крок 6):
/// `status != Some(0)` — `cargo-deny` недоступний (не встановлено ЧИ
/// зламаний — код виходу не відрізняє ці два випадки надійно, доккомент
/// модуля), `Some(diagnostic)`; `status == Some(0)` — доступний, `None`.
/// Винесена окремо (не inline у [`detect_check`]), щоб канал можна було
/// юніт-тестувати БЕЗ `exec_tool` — той сам `status: Option<i32>`
/// конструюється тестом напряму (той самий прийом, що
/// `crates/plugin-lang-python/src/lib.rs::pip_licenses_availability_diagnostic`).
fn cargo_deny_unavailable_diagnostic(status: Option<i32>) -> Option<Diagnostic> {
    if status == Some(0) {
        return None;
    }
    Some(plain_violation(
        CHECK_CARGO_DENY_UNAVAILABLE_REASON,
        "lint-rust: cargo deny — `cargo deny --version` провалюється, ліцензійну перевірку \
         ПРОПУЩЕНО, а не пройдено. Найімовірніше — `cargo-deny` не встановлено (встанови: \
         `cargo install cargo-deny --locked`); якщо він уже встановлений, перевір `cargo deny \
         --version` вручну — можливо, встановлення зламане (rust.mdc)"
            .to_string(),
    ))
}

/// Точний порт `lint()` `rust/check` (`main.mjs`, рядки 44–90) —
/// НЕ-уніформний ланцюжок, доккомент модуля, розділ «`rust/check` —
/// ланцюжок НЕ уніформний» (7 гілок, КОЖНА зі своєю реакцією на провал —
/// НЕ копіюй форму `run_ruff_step`).
fn detect_check(files: &[SourceFile]) -> Vec<Diagnostic> {
    // (1) Кореневий Cargo.toml відсутній у батчі → Rust-кроки пропущено.
    if batch_file(files, "Cargo.toml").is_none() {
        return Vec::new();
    }

    let mut diagnostics = Vec::new();

    // (2)+(3) `cargo fmt --all -- --check` — ПЕРШИЙ виклик: `status: None`
    // ⇒ `cargo` не резолвиться (немає окремого пробного виклику, на
    // відміну від `python`-сусіда — `resolveCmd('cargo')` JS-оригіналу теж
    // не спавнить процес, лише шукає бінарник у PATH).
    let fmt_result = exec_cargo(vec![
        "fmt".to_string(),
        "--all".to_string(),
        "--".to_string(),
        "--check".to_string(),
    ]);
    let Some(fmt_code) = fmt_result.status else {
        diagnostics.push(plain_violation(
            CHECK_CARGO_MISSING_REASON,
            CHECK_CARGO_MISSING_MESSAGE.to_string(),
        ));
        return diagnostics;
    };
    if fmt_code != 0 {
        diagnostics.push(plain_violation(
            CHECK_CARGO_FMT_VIOLATION_REASON,
            check_step_message(
                "cargo fmt --check",
                fmt_code,
                &fmt_result.stdout,
                &fmt_result.stderr,
            ),
        ));
        return diagnostics;
    }

    // (4) `cargo clippy -D warnings` — провал ПРОДОВЖУЄ (не return).
    run_cargo_step(
        "cargo clippy -D warnings",
        vec![
            "clippy".to_string(),
            "--all-targets".to_string(),
            "--all-features".to_string(),
            "--".to_string(),
            "-D".to_string(),
            "warnings".to_string(),
        ],
        CHECK_CARGO_CLIPPY_VIOLATION_REASON,
        &mut diagnostics,
    );

    // (5) `deny.toml` відсутній у батчі → RETURN.
    if batch_file(files, "deny.toml").is_none() {
        diagnostics.push(plain_violation(
            CHECK_DENY_CONFIG_MISSING_REASON,
            CHECK_DENY_CONFIG_MISSING_MESSAGE.to_string(),
        ));
        return diagnostics;
    }

    // (6) `cargo deny --version` non-zero → §2.33: видима діагностика
    // ЗАМІСТЬ тихого skip-у (доккомент модуля, розділ «`rust/check` —
    // ланцюжок НЕ уніформний», крок 6), RETURN — без доступного тула крок
    // 7 не має що виконувати.
    let deny_version = exec_cargo(vec!["deny".to_string(), "--version".to_string()]);
    if let Some(diagnostic) = cargo_deny_unavailable_diagnostic(deny_version.status) {
        diagnostics.push(diagnostic);
        return diagnostics;
    }

    // (7) `cargo deny check licenses` — останній крок.
    run_cargo_step(
        "cargo deny check licenses",
        vec![
            "deny".to_string(),
            "check".to_string(),
            "licenses".to_string(),
        ],
        CHECK_CARGO_DENY_VIOLATION_REASON,
        &mut diagnostics,
    );

    diagnostics
}

// =====================================================================
// `rust/cargo_mutants_config` — друга хвиля порту, доккомент модуля,
// розділ «`rust/cargo_mutants_config` — дві СВІДОМІ поведінкові
// відмінності».
// =====================================================================

/// `reason` відсутнього `<cargoDir>/.cargo/mutants.toml` — точний
/// відповідник `MUTANTS_CONFIG_MISSING` (`main.mjs`, T0-фіксер матчиться за
/// цим reason).
const CARGO_MUTANTS_CONFIG_MISSING_REASON: &str = "mutants-config-missing";

/// Мінімальне (без `serde_json`) представлення JSON-значення для читання
/// `package.json` — потрібне ЛИШЕ поле `workspaces` (масив рядків) на
/// верхньому рівні; решта структури лише ПРОПУСКАЄТЬСЯ без семантичного
/// розбору (`PkgJsonValue::Other` для чисел/bool/null). Той самий скорочений
/// мотив, що `JsonValue`/`JsonParser` `crates/plugin-lang-python/src/lib.rs`
/// (`pip-licenses`/Blue Oak), звужений до РІВНО того, що споживає
/// [`resolve_all_cargo_manifests`].
enum PkgJsonValue {
    Str(String),
    Array(Vec<PkgJsonValue>),
    Object(Vec<(String, PkgJsonValue)>),
    /// Число/bool/null — значення НЕ зберігається, лише коректно
    /// пропускається (позиція парсера рухається на довжину токена).
    Other,
}

/// Рекурсивно-спусковий парсер [`PkgJsonValue`] по байтах UTF-8 рядка.
struct PkgJsonParser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> PkgJsonParser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            bytes: input.as_bytes(),
            pos: 0,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn parse(mut self) -> Result<PkgJsonValue, ()> {
        self.skip_ws();
        self.parse_value()
    }

    fn parse_value(&mut self) -> Result<PkgJsonValue, ()> {
        self.skip_ws();
        match self.peek() {
            Some(b'"') => self.parse_string().map(PkgJsonValue::Str),
            Some(b'{') => self.parse_object(),
            Some(b'[') => self.parse_array(),
            Some(b't') => self.skip_literal("true"),
            Some(b'f') => self.skip_literal("false"),
            Some(b'n') => self.skip_literal("null"),
            Some(c) if c == b'-' || c.is_ascii_digit() => self.skip_number(),
            _ => Err(()),
        }
    }

    fn skip_literal(&mut self, lit: &str) -> Result<PkgJsonValue, ()> {
        let end = self.pos + lit.len();
        if self.bytes.get(self.pos..end) == Some(lit.as_bytes()) {
            self.pos = end;
            Ok(PkgJsonValue::Other)
        } else {
            Err(())
        }
    }

    fn skip_number(&mut self) -> Result<PkgJsonValue, ()> {
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        let mut saw_digit = false;
        while matches!(self.peek(), Some(c) if c.is_ascii_digit() || matches!(c, b'.' | b'e' | b'E' | b'+' | b'-'))
        {
            if self.peek().is_some_and(|c| c.is_ascii_digit()) {
                saw_digit = true;
            }
            self.pos += 1;
        }
        if saw_digit {
            Ok(PkgJsonValue::Other)
        } else {
            Err(())
        }
    }

    fn parse_string(&mut self) -> Result<String, ()> {
        // Викликається лише коли `self.peek() == Some(b'"')`.
        self.pos += 1;
        let mut out = String::new();
        loop {
            match self.peek() {
                None => return Err(()),
                Some(b'"') => {
                    self.pos += 1;
                    break;
                }
                Some(b'\\') => {
                    self.pos += 1;
                    match self.peek() {
                        Some(b'"') => {
                            out.push('"');
                            self.pos += 1;
                        }
                        Some(b'\\') => {
                            out.push('\\');
                            self.pos += 1;
                        }
                        Some(b'/') => {
                            out.push('/');
                            self.pos += 1;
                        }
                        Some(b'n') => {
                            out.push('\n');
                            self.pos += 1;
                        }
                        Some(b'r') => {
                            out.push('\r');
                            self.pos += 1;
                        }
                        Some(b't') => {
                            out.push('\t');
                            self.pos += 1;
                        }
                        Some(b'b') => {
                            out.push('\u{8}');
                            self.pos += 1;
                        }
                        Some(b'f') => {
                            out.push('\u{c}');
                            self.pos += 1;
                        }
                        Some(b'u') => {
                            self.pos += 1;
                            let slice = self.bytes.get(self.pos..self.pos + 4).ok_or(())?;
                            let text = std::str::from_utf8(slice).map_err(|_| ())?;
                            let code = u16::from_str_radix(text, 16).map_err(|_| ())?;
                            self.pos += 4;
                            // Best-effort: BMP-only (без сурогатних пар) —
                            // досить для звичайних ASCII-шляхів `workspaces`
                            // (доккомент [`PkgJsonValue`]).
                            out.push(char::from_u32(u32::from(code)).unwrap_or('\u{FFFD}'));
                        }
                        _ => return Err(()),
                    }
                }
                Some(_) => {
                    let rest = std::str::from_utf8(&self.bytes[self.pos..]).map_err(|_| ())?;
                    let ch = rest.chars().next().ok_or(())?;
                    out.push(ch);
                    self.pos += ch.len_utf8();
                }
            }
        }
        Ok(out)
    }

    fn parse_array(&mut self) -> Result<PkgJsonValue, ()> {
        self.pos += 1; // `[`
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(PkgJsonValue::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b']') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err(()),
            }
        }
        Ok(PkgJsonValue::Array(items))
    }

    fn parse_object(&mut self) -> Result<PkgJsonValue, ()> {
        self.pos += 1; // `{`
        let mut entries = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(PkgJsonValue::Object(entries));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(());
            }
            let key = self.parse_string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(());
            }
            self.pos += 1;
            let value = self.parse_value()?;
            entries.push((key, value));
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b'}') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err(()),
            }
        }
        Ok(PkgJsonValue::Object(entries))
    }
}

/// Читає `workspaces` (масив рядків) з верхнього рівня `package.json` —
/// невалідний JSON чи відсутнє/нетипове поле дає ПОРОЖНІЙ список (той самий
/// `Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []` fail-open
/// JS-оригіналу).
fn read_package_json_workspaces(content: &str) -> Vec<String> {
    let Ok(PkgJsonValue::Object(entries)) = PkgJsonParser::new(content).parse() else {
        return Vec::new();
    };
    let workspaces_value = entries
        .iter()
        .find(|(k, _)| k == "workspaces")
        .map(|(_, v)| v);
    match workspaces_value {
        Some(PkgJsonValue::Array(items)) => items
            .iter()
            .filter_map(|v| match v {
                PkgJsonValue::Str(s) => Some(s.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Компілює `workspaces`-запис `package.json` (з `*`, у межах ОДНОГО
/// сегмента шляху, чи `**`, крізь довільну кількість сегментів) у
/// прив'язаний regex — той самий стиль, що [`workspace_root_pattern_regex`]
/// для `members`/`exclude`-патернів `[workspace]` (`Cargo.toml`), розширений
/// підтримкою `**`: npm/bun-конвенція іноді використовує `"workspaces":
/// ["**"]` («усі каталоги, будь-яка глибина»), на відміну від Cargo
/// `members`, де `**` не трапляється. Викликається ЛИШЕ коли `pattern`
/// містить `*` — [`expand_workspace_entry_dirs`] коротким шляхом обходить
/// цей виклик для літеральних записів. Символи поза `*` екрануються по
/// одному, той самий скорочений набір метасимволів, що
/// [`workspace_root_pattern_regex`].
fn workspace_entry_pattern_regex(pattern: &str) -> Option<regex::Regex> {
    let mut source = String::from("^");
    let mut chars = pattern.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '*' {
            if chars.peek() == Some(&'*') {
                chars.next();
                source.push_str(".*");
            } else {
                source.push_str("[^/]*");
            }
        } else if "\\.+()|[]{}^$?".contains(ch) {
            source.push('\\');
            source.push(ch);
        } else {
            source.push(ch);
        }
    }
    source.push('$');
    regex::Regex::new(&source).ok()
}

/// Розкриває ОДИН glob-`workspaces`-запис (`ws.contains('*')` — виклик
/// [`resolve_all_cargo_manifests`] бере короткий шлях для літеральних
/// записів і сюди взагалі не заходить, доккомент виклику) у відсортований
/// (без дублікатів) список конкретних каталогів. Джерело кандидатів — САМ
/// host-batch (уже повний `**/Cargo.toml` для full-scope контрибуції,
/// доккомент [`build_manifest`]), а не файлова система: гість НІКОЛИ не
/// обходить диск сам (доккомент модуля, розділ «Обхід дерева»). Для
/// кожного файлу батчу, що закінчується на `Cargo.toml`, каталог-кандидат —
/// усе до `/Cargo.toml` чи `/src-tauri/Cargo.toml` (Tauri-варіант
/// перевіряється ПЕРШИМ: `strip_suffix` шукає ТОЧНИЙ суфікс, тож
/// `src-tauri/Cargo.toml`-шлях не сплутати з рештою `Cargo.toml`-суфіксом).
fn expand_workspace_entry_dirs<'a>(files: &'a [SourceFile], ws: &str) -> Vec<&'a str> {
    let Some(re) = workspace_entry_pattern_regex(ws) else {
        return Vec::new();
    };
    let mut dirs: Vec<&'a str> = files
        .iter()
        .filter_map(|f| {
            let dir = f
                .path
                .strip_suffix("/src-tauri/Cargo.toml")
                .or_else(|| f.path.strip_suffix("/Cargo.toml"))?;
            (!dir.is_empty() && re.is_match(dir)).then_some(dir)
        })
        .collect();
    dirs.sort_unstable();
    dirs.dedup();
    dirs
}

/// Порт `resolveAllCargoManifests`
/// (`npm/scripts/utils/resolve-cargo-manifest.mjs:42-60`), адаптований під
/// вже наданий host-batch: кореневий `Cargo.toml`, якщо є, тоді за кожним
/// (можливо glob-) записом `workspaces` кореневого `package.json` — для
/// КОЖНОГО розкритого каталогу `<dir>/src-tauri/Cargo.toml` пріоритетніше
/// за `<dir>/Cargo.toml` (Tauri-патерн). ЛАТЕНТНИЙ баг джерела (`ws` як
/// ЛІТЕРАЛЬНИЙ сегмент шляху, glob НІКОЛИ не розкривався) ВИПРАВЛЕНО —
/// доккомент модуля, розділ «`rust/cargo_mutants_config` — дві СВІДОМІ
/// поведінкові відмінності», пункт (c), пояснює чому парність із JS-багом
/// перестала бути аргументом.
fn resolve_all_cargo_manifests(files: &[SourceFile]) -> Vec<String> {
    let mut manifests = Vec::new();
    if batch_file(files, "Cargo.toml").is_some() {
        manifests.push("Cargo.toml".to_string());
    }

    if let Some(pkg) = batch_file(files, "package.json") {
        for ws in read_package_json_workspaces(&pkg.content) {
            let dirs = if ws.contains('*') {
                expand_workspace_entry_dirs(files, &ws)
            } else {
                vec![ws.as_str()]
            };
            for dir in dirs {
                let tauri = format!("{dir}/src-tauri/Cargo.toml");
                if batch_file(files, &tauri).is_some() {
                    manifests.push(tauri);
                    continue;
                }
                let flat = format!("{dir}/Cargo.toml");
                if batch_file(files, &flat).is_some() {
                    manifests.push(flat);
                }
            }
        }
    }

    manifests
}

/// Точний порт `lint()` `rust/cargo_mutants_config` (`main.mjs`) МІНУС дві
/// свідомо відкинуті гілки (доккомент модуля, розділ
/// «`rust/cargo_mutants_config` — дві СВІДОМІ поведінкові відмінності»,
/// пункти (a)/(b)): БЕЗ self-gate `.n-rules.json`, БЕЗ перевірки
/// `BASELINE_PATH`. `pass(...)`-гілка канону — no-op (`continue` нижче), той
/// самий контракт, що решта `pass`-виразів цього крейта.
fn detect_cargo_mutants_config(files: &[SourceFile]) -> Vec<Diagnostic> {
    let manifests = resolve_all_cargo_manifests(files);
    // rust enabled (гейт відкинуто, доккомент модуля), але Cargo.toml ще
    // немає — silently skip (manifest може з'явитися пізніше), точний порт
    // `manifests.length === 0` гілки.
    if manifests.is_empty() {
        return Vec::new();
    }

    let mut diagnostics = Vec::new();
    for manifest_path in &manifests {
        let cargo_dir = workspace_root_dirname(manifest_path);
        let target = if cargo_dir.is_empty() {
            ".cargo/mutants.toml".to_string()
        } else {
            format!("{cargo_dir}/.cargo/mutants.toml")
        };

        if batch_file(files, &target).is_some() {
            continue;
        }

        diagnostics.push(workspace_root_file_violation(
            CARGO_MUTANTS_CONFIG_MISSING_REASON,
            format!(
                ".cargo/mutants.toml відсутній ({target}) — запусти `npx @7n/rules lint rust` для генерації canonical baseline (rust.mdc)"
            ),
            &target,
        ));
    }
    diagnostics
}

// =====================================================================
// `rust/wasm_component` — друга хвиля порту, доккомент модуля, розділ
// «`rust/wasm_component` — межа `{ workspace = true }`-успадкування».
// =====================================================================

/// `reason` забороненої залежності від `wasm-bindgen` — точний відповідник
/// `WASM_BINDGEN_FORBIDDEN` (`main.mjs`).
const WASM_COMPONENT_WASM_BINDGEN_FORBIDDEN_REASON: &str = "wasm-bindgen-forbidden";

/// `reason` `wasmtime` без `component-model` при вимкнених дефолтах —
/// точний відповідник `WASMTIME_MISSING_COMPONENT_MODEL`.
const WASM_COMPONENT_WASMTIME_MISSING_COMPONENT_MODEL_REASON: &str =
    "wasmtime-missing-component-model";

/// Пояснювальна підказка `wasm-bindgen` — точний відповідник
/// `WASM_BINDGEN_HINT` (`main.mjs`, конкатенація літералів звужена до
/// одного рядка).
const WASM_COMPONENT_WASM_BINDGEN_HINT: &str = "`wasm-bindgen` — це старий режим (браузерний cdylib під wasm32-unknown-unknown, без WASI, без Component Model ABI). Порт на Component Model: `wit-bindgen` + ціль wasm32-wasip2 (rust/wasm_component.mdc).";

/// Пояснювальна підказка `wasmtime` — точний відповідник `WASMTIME_HINT`.
const WASM_COMPONENT_WASMTIME_HINT: &str = "`component-model` — дефолтна feature `wasmtime`, але цей маніфест вимкнув дефолти (`default-features = false`) і не додав її назад явно у `features`. Без неї хост не зможе вантажити wasm-компоненти (`Component::from_binary`) — лише старі core-модулі (rust/wasm_component.mdc).";

/// Значення одного запису depend-таблиці — коротка форма (`"1.0"`) чи
/// таблиця (`{ version = "1", workspace = true, ... }`). Точний зріз
/// `main.mjs`: лише поля, які реально читає [`wasm_component_is_workspace_inherited`]/
/// [`wasm_component_wasmtime_missing_component_model`] — `workspace`/
/// `default-features`/`features`; решта полів (`version`/`path`/`optional`/…)
/// мовчки ігнорується (serde default без `deny_unknown_fields`, той самий
/// tolerant-парсинг, що решта TOML-структур цього крейта).
#[derive(serde::Deserialize, Clone, Default)]
struct WasmComponentDependencyTable {
    #[serde(default)]
    workspace: Option<bool>,
    #[serde(rename = "default-features", default)]
    default_features: Option<bool>,
    #[serde(default)]
    features: Option<Vec<String>>,
}

/// Один запис depend-таблиці — `#[serde(untagged)]` між короткою формою
/// (рядок) і таблицею, той самий контракт, що TOML-специфікація сама дає
/// (`dep = "1.0"` чи `dep = { version = "1.0" }`).
#[derive(serde::Deserialize, Clone)]
#[serde(untagged)]
enum WasmComponentDependency {
    Table(WasmComponentDependencyTable),
    // Значення короткої форми (`dep = "1.0"`) ніде НЕ читається (короткий
    // рядок НІКОЛИ не несе `workspace = true`/`default-features = false`,
    // обидва прапорці цього концерну), тримається лише щоб serde
    // untagged-варіант коректно матчив ЦЮ TOML-форму й не падав в `Err`.
    #[allow(dead_code)]
    Simple(String),
}

/// `[dependencies]`/`[build-dependencies]`/`[dev-dependencies]` — ім'я
/// крейта → запис.
type WasmComponentDepsTable = HashMap<String, WasmComponentDependency>;

/// `[target.'cfg(...)'.*]` — одна cfg-гілка, той самий зріз
/// `DEP_TABLE_KEYS`, що кореневий рівень.
#[derive(serde::Deserialize, Default)]
struct WasmComponentTargetTable {
    #[serde(default)]
    dependencies: Option<WasmComponentDepsTable>,
    #[serde(rename = "build-dependencies", default)]
    build_dependencies: Option<WasmComponentDepsTable>,
    #[serde(rename = "dev-dependencies", default)]
    dev_dependencies: Option<WasmComponentDepsTable>,
}

/// `[workspace]` — лише `members`/`exclude` (переперевикористовує ту саму
/// форму, що [`WorkspaceRootWorkspaceTable`], АЛЕ окрема struct — крейти й
/// секції цього файлу не діляться типами навмисно, той самий tolerant-парсинг
/// дух) плюс `[workspace.dependencies]`, потрібний
/// [`wasm_component_resolve_workspace_dependency`].
#[derive(serde::Deserialize, Default)]
struct WasmComponentWorkspaceTable {
    #[serde(default)]
    members: Vec<String>,
    #[serde(default)]
    exclude: Vec<String>,
    #[serde(default)]
    dependencies: Option<WasmComponentDepsTable>,
}

/// Мінімальний зріз `Cargo.toml`, потрібний `rust/wasm_component`.
#[derive(serde::Deserialize, Default)]
struct WasmComponentCargoToml {
    #[serde(default)]
    dependencies: Option<WasmComponentDepsTable>,
    #[serde(rename = "build-dependencies", default)]
    build_dependencies: Option<WasmComponentDepsTable>,
    #[serde(rename = "dev-dependencies", default)]
    dev_dependencies: Option<WasmComponentDepsTable>,
    #[serde(default)]
    target: Option<HashMap<String, WasmComponentTargetTable>>,
    #[serde(default)]
    workspace: Option<WasmComponentWorkspaceTable>,
}

/// Точний порт `readCargoManifest` (`cargo-workspace.mjs`) для вже наданого
/// host-ом вмісту файлу: `None` на невалідний TOML — той самий catch-null
/// JS-оригіналу.
fn wasm_component_parse_cargo_toml(content: &str) -> Option<WasmComponentCargoToml> {
    basic_toml::from_str(content).ok()
}

/// Точний порт `allDependencyTables` (`main.mjs`): кореневі
/// depend-таблиці + такі самі під кожним `[target.'cfg(...)'.*]`.
fn wasm_component_all_dependency_tables(
    parsed: &WasmComponentCargoToml,
) -> Vec<&WasmComponentDepsTable> {
    let mut tables = Vec::new();
    if let Some(t) = &parsed.dependencies {
        tables.push(t);
    }
    if let Some(t) = &parsed.build_dependencies {
        tables.push(t);
    }
    if let Some(t) = &parsed.dev_dependencies {
        tables.push(t);
    }
    if let Some(target) = &parsed.target {
        for cfg in target.values() {
            if let Some(t) = &cfg.dependencies {
                tables.push(t);
            }
            if let Some(t) = &cfg.build_dependencies {
                tables.push(t);
            }
            if let Some(t) = &cfg.dev_dependencies {
                tables.push(t);
            }
        }
    }
    tables
}

/// Точний порт `findDependency` (`main.mjs`): значення запису `name` з
/// будь-якої depend-таблиці маніфесту, чи `None`.
fn wasm_component_find_dependency<'a>(
    parsed: &'a WasmComponentCargoToml,
    name: &str,
) -> Option<&'a WasmComponentDependency> {
    wasm_component_all_dependency_tables(parsed)
        .into_iter()
        .find_map(|t| t.get(name))
}

/// Точний порт `isWorkspaceInherited` (`main.mjs`).
fn wasm_component_is_workspace_inherited(value: &WasmComponentDependency) -> bool {
    matches!(value, WasmComponentDependency::Table(t) if t.workspace == Some(true))
}

/// Чи покриває `[workspace].members` (мінус `.exclude`) `crate_dir` —
/// точний порт `isWorkspaceMemberDir` (`cargo-workspace.mjs`), адаптований
/// під `known_dirs` уже наявних у батчі маніфестів
/// ([`workspace_root_resolve_member_dirs`], перевикористаний із секції
/// `rust/workspace_root` — та сама функція, без дублювання). `crate_dir`
/// ЗАВЖДИ у `known_dirs` (він — dirname маніфесту, що обробляється), тож
/// перевірка коректна навіть коли batch не несе ІНШИХ sibling-крейтів
/// (доккомент модуля, розділ «межа `{ workspace = true }`-успадкування»).
fn wasm_component_is_workspace_member(
    known_dirs: &[&str],
    crate_dir: &str,
    members: &[String],
    excludes: &[String],
) -> bool {
    let member_dirs = workspace_root_resolve_member_dirs(known_dirs, members);
    if !member_dirs.contains(crate_dir) {
        return false;
    }
    if excludes.is_empty() {
        return true;
    }
    let exclude_dirs = workspace_root_resolve_member_dirs(known_dirs, excludes);
    !exclude_dirs.contains(crate_dir)
}

/// Точний функціональний порт `resolveWorkspaceDependency`
/// (`main.mjs`) — З РЕАЛЬНОГО диска на вже наданий per-file batch
/// (доккомент модуля, розділ «межа `{ workspace = true }`-успадкування»):
/// йде від `dirname(crate_dir)` вгору по предках, шукаючи найближчий
/// Cargo.toml З `[workspace]`, чиї `members`/`exclude` покривають
/// `crate_dir`. `None` — предок НЕ знайдено в батчі (за конструкцією
/// `ConcernContribution`, доккомент модуля) чи запису `name` там нема —
/// той самий «навмисно тихо» fail-open, що JS-оригінал.
fn wasm_component_resolve_workspace_dependency(
    files: &[SourceFile],
    crate_dir: &str,
    name: &str,
) -> Option<WasmComponentDependency> {
    let known_dirs: Vec<&str> = files
        .iter()
        .filter(|f| f.path == "Cargo.toml" || f.path.ends_with("/Cargo.toml"))
        .map(|f| workspace_root_dirname(&f.path))
        .collect();

    let mut dir = workspace_root_dirname(crate_dir).to_string();
    loop {
        let manifest_path = if dir.is_empty() {
            "Cargo.toml".to_string()
        } else {
            format!("{dir}/Cargo.toml")
        };
        if let Some(file) = files.iter().find(|f| f.path == manifest_path) {
            if let Some(parsed) = wasm_component_parse_cargo_toml(&file.content) {
                if let Some(workspace) = parsed.workspace {
                    if wasm_component_is_workspace_member(
                        &known_dirs,
                        crate_dir,
                        &workspace.members,
                        &workspace.exclude,
                    ) {
                        return workspace
                            .dependencies
                            .and_then(|deps| deps.get(name).cloned());
                    }
                }
            }
        }
        if dir.is_empty() {
            return None;
        }
        dir = workspace_root_dirname(&dir).to_string();
    }
}

/// Точний порт `checkWasmBindgen` (`main.mjs`).
fn wasm_component_check_wasm_bindgen(
    diagnostics: &mut Vec<Diagnostic>,
    parsed: &WasmComponentCargoToml,
    rel: &str,
    crate_dir: &str,
    files: &[SourceFile],
) {
    let Some(value) = wasm_component_find_dependency(parsed, "wasm-bindgen") else {
        return;
    };
    if wasm_component_is_workspace_inherited(value)
        && wasm_component_resolve_workspace_dependency(files, crate_dir, "wasm-bindgen").is_none()
    {
        return;
    }
    diagnostics.push(workspace_root_file_violation(
        WASM_COMPONENT_WASM_BINDGEN_FORBIDDEN_REASON,
        format!(
            "{rel}: залежність від `wasm-bindgen` заборонена — старий режим wasm. {WASM_COMPONENT_WASM_BINDGEN_HINT}"
        ),
        rel,
    ));
}

/// Точний порт `wasmtimeMissingComponentModel` (`main.mjs`).
fn wasm_component_wasmtime_missing_component_model(value: &WasmComponentDependency) -> bool {
    match value {
        WasmComponentDependency::Table(t) => {
            if t.default_features != Some(false) {
                return false;
            }
            !t.features
                .as_ref()
                .is_some_and(|features| features.iter().any(|f| f == "component-model"))
        }
        WasmComponentDependency::Simple(_) => false,
    }
}

/// Точний порт `checkWasmtime` (`main.mjs`).
fn wasm_component_check_wasmtime(
    diagnostics: &mut Vec<Diagnostic>,
    parsed: &WasmComponentCargoToml,
    rel: &str,
    crate_dir: &str,
    files: &[SourceFile],
) {
    let Some(mut value) = wasm_component_find_dependency(parsed, "wasmtime").cloned() else {
        return;
    };
    if wasm_component_is_workspace_inherited(&value) {
        let Some(resolved) =
            wasm_component_resolve_workspace_dependency(files, crate_dir, "wasmtime")
        else {
            return;
        };
        value = resolved;
    }
    if !wasm_component_wasmtime_missing_component_model(&value) {
        return;
    }
    diagnostics.push(workspace_root_file_violation(
        WASM_COMPONENT_WASMTIME_MISSING_COMPONENT_MODEL_REASON,
        format!(
            "{rel}: `wasmtime` без `component-model` у features. {WASM_COMPONENT_WASMTIME_HINT}"
        ),
        rel,
    ));
}

/// Точний порт `lint()` `rust/wasm_component` (`main.mjs`) — PER-FILE, весь
/// переданий батч ОДНИМ викликом (НЕ по одному файлу за раз, як
/// `detect_doc_comments`): [`wasm_component_resolve_workspace_dependency`]
/// потребує видимості sibling-маніфестів того самого батчу (доккомент
/// [`Guest::detect`]).
fn detect_wasm_component(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for file in files {
        if !file.path.ends_with("Cargo.toml") {
            continue;
        }
        let Some(parsed) = wasm_component_parse_cargo_toml(&file.content) else {
            continue;
        };
        let crate_dir = workspace_root_dirname(&file.path);
        wasm_component_check_wasm_bindgen(&mut diagnostics, &parsed, &file.path, crate_dir, files);
        wasm_component_check_wasmtime(&mut diagnostics, &parsed, &file.path, crate_dir, files);
    }
    diagnostics
}

/// Чиста (без host-імпортів `log`/`report-progress`) конструктор
/// маніфеста — винесений з [`Guest::describe`] окремо, щоб host-таргет
/// unit-тести могли звірити форму маніфеста без реального wasmtime-хоста
/// (той самий мотив, що `crates/plugin-lang-python/src/lib.rs::build_manifest`).
fn build_manifest() -> Manifest {
    Manifest {
        id: "rust/wasm-concerns".to_string(),
        version: "0.1.0".to_string(),
        world_version: "3.1.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![
            ConcernContribution {
                key: CONCERN_APPLIES.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/Cargo.toml".to_string()],
            },
            ConcernContribution {
                key: CONCERN_DOC_COMMENTS.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.rs".to_string()],
            },
            ConcernContribution {
                key: CONCERN_WORKSPACE_ROOT.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/Cargo.toml".to_string()],
            },
            // `rust/check` — WHOLE-BATCH, ШИРШИЙ за `concern.json`-глоб
            // канону (`**/*.rs`, `Cargo.toml`, `Cargo.lock`, не читаються
            // взагалі — реальний вердикт дає `exec-tool`-ланцюжок): лише
            // ДВА root-only presence-сигнали (`Cargo.toml` — Rust-проєкт чи
            // ні, `deny.toml` — чи спавнити `cargo deny`), доккомент модуля,
            // розділ «ДРУГА ХВИЛЯ».
            ConcernContribution {
                key: CONCERN_CHECK.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["Cargo.toml".to_string(), "deny.toml".to_string()],
            },
            // `rust/cargo_mutants_config` — WHOLE-BATCH: `**/Cargo.toml` +
            // `package.json` ([`resolve_all_cargo_manifests`]) +
            // `**/.cargo/mutants.toml` (presence-ціль самої перевірки).
            ConcernContribution {
                key: CONCERN_CARGO_MUTANTS_CONFIG.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/Cargo.toml".to_string(),
                    "package.json".to_string(),
                    "**/.cargo/mutants.toml".to_string(),
                ],
            },
            // `rust/wasm_component` — PER-FILE, той самий глоб, що
            // `concern.json` (`**/Cargo.toml`) — власний цільовий файл
            // ЗАВЖДИ у батчі (доккомент модуля, розділ «межа `{ workspace =
            // true }`-успадкування»).
            ConcernContribution {
                key: CONCERN_WASM_COMPONENT.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/Cargo.toml".to_string()],
            },
        ],
        ci_artifacts: vec![],
        // Вміст файлів хост передає inline (per-file чи host-побудований
        // full-scope batch) — плагін не читає диск сам (той самий мотив, що
        // `crates/plugin-lang-js`/`crates/plugin-lang-python`).
        capabilities: Capabilities {
            fs_read: vec![],
            network: false,
        },
        // `rust/check` — ПІЛОТ `exec-tool` цього крейта (доккомент модуля,
        // розділ «ДРУГА ХВИЛЯ»), одна декларація [`CHECK_TOOL`].
        tools: vec![CHECK_TOOL.to_string()],
    }
}

/// Guest-реалізація `n-rules:plugin@3.1.0` для `rust/wasm-concerns` — три
/// контрибуції першої хвилі (доккомент модуля).
struct LangRust;

impl Guest for LangRust {
    fn describe() -> Manifest {
        log(LogLevel::Info, "plugin-lang-rust: describe()");
        build_manifest()
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        let total = batch.files.len() as u32;
        let diagnostics = match batch.concern_id.as_str() {
            CONCERN_APPLIES => {
                report_progress(total, total);
                detect_applies(&batch.files)
            }
            // PER-FILE: кожен файл — свій крок прогресу (той самий мотив,
            // що `python/doc_comments`/дефолтна гілка `plugin-lang-js`).
            CONCERN_DOC_COMMENTS => {
                let mut diagnostics = Vec::new();
                for (index, file) in batch.files.iter().enumerate() {
                    report_progress(index as u32 + 1, total);
                    diagnostics.extend(detect_doc_comments(std::slice::from_ref(file)));
                }
                diagnostics
            }
            CONCERN_WORKSPACE_ROOT => {
                report_progress(total, total);
                detect_workspace_root(&batch.files)
            }
            CONCERN_CHECK => {
                report_progress(total, total);
                detect_check(&batch.files)
            }
            CONCERN_CARGO_MUTANTS_CONFIG => {
                report_progress(total, total);
                detect_cargo_mutants_config(&batch.files)
            }
            // PerFile, АЛЕ весь переданий batch ОДНИМ викликом, не по
            // одному файлу за раз — [`detect_wasm_component`] потребує
            // видимості sibling-маніфестів того самого батчу (той самий
            // мотив, що `CONCERN_MYPY`/`CONCERN_RUFF` у
            // `crates/plugin-lang-python/src/lib.rs`).
            CONCERN_WASM_COMPONENT => {
                report_progress(total, total);
                detect_wasm_component(&batch.files)
            }
            _ => Vec::new(),
        };
        log(
            LogLevel::Info,
            &format!(
                "plugin-lang-rust: detect({}) опрацював {total} файл(ів)",
                batch.concern_id
            ),
        );
        diagnostics
    }

    /// Перша хвиля не портує жодного fix-контуру (T0 `rust/doc_comments` —
    /// `fix-doc_comments.mjs` — лишається JS, доккомент модуля): порожній
    /// план для КОЖНОГО концерну, сумісна заглушка.
    fn fix(_request: FixRequest) -> FixPlan {
        FixPlan { edits: vec![] }
    }

    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

export!(LangRust);

#[cfg(test)]
mod tests {
    //! Юніт-тести на host-таргеті (`cargo test -p plugin-lang-rust`, без
    //! wasm-збірки) — лише чисті helper-и, НЕ `Guest::describe`/
    //! `Guest::detect` напряму (host-імпорти `log`/`report-progress`
    //! абортують поза реальним wasmtime-хостом — той самий мотив, що
    //! `crates/plugin-lang-js`/`crates/plugin-lang-python`). Живий
    //! end-to-end прогін через `PluginHost` — поза обсягом цієї хвилі;
    //! JS-vs-wasm parity —
    //! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-rust.test.mjs`.
    use super::*;

    fn sf(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    // --- rust/applies ---

    #[test]
    fn detect_applies_never_reports_anything() {
        let files = vec![sf("Cargo.toml", "[package]\nname = \"demo\"\n")];
        assert!(detect_applies(&files).is_empty());
        assert!(detect_applies(&[]).is_empty());
    }

    // --- rust/doc_comments ---

    #[test]
    fn detect_doc_comments_file_without_pub_items_is_not_applicable() {
        let files = vec![sf("src/a.rs", "fn private_only() {}\n")];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_header_and_pub_doc_present_is_clean() {
        let src = "//! Намір файлу.\n\n/// Робить X.\npub fn go() {}\n";
        let files = vec![sf("src/a.rs", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_missing_header_and_pub_doc_gives_two_violations() {
        let files = vec![sf("src/a.rs", "pub fn go() {}\n")];
        let mut reasons: Vec<String> = detect_doc_comments(&files)
            .into_iter()
            .map(|d| d.reason)
            .collect();
        reasons.sort_unstable();
        assert_eq!(reasons, vec!["missing-file-header", "missing-pub-doc"]);
    }

    #[test]
    fn detect_doc_comments_plain_comment_block_above_pub_item_is_promotable_attrs_skipped() {
        let src = "//! H.\n\n// робить X\n#[derive(Debug)]\npub struct S {}\n";
        let files = vec![sf("src/a.rs", src)];
        let violations = detect_doc_comments(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "missing-pub-doc");
        assert!(violations[0]
            .data
            .as_deref()
            .unwrap()
            .contains("\"promotable\":true"));
        assert!(violations[0]
            .data
            .as_deref()
            .unwrap()
            .contains("\"fromLine\":2"));
        assert!(violations[0]
            .data
            .as_deref()
            .unwrap()
            .contains("\"toLine\":2"));
    }

    #[test]
    fn detect_doc_comments_leading_plain_comment_block_is_promotable_header() {
        let src = "// намір\n/// X.\npub fn go() {}\n";
        let files = vec![sf("src/a.rs", src)];
        let violations = detect_doc_comments(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "missing-file-header");
        let data = violations[0].data.as_deref().unwrap();
        assert!(data.contains("\"promotable\":true"));
        assert!(data.contains("\"header\":true"));
        assert!(data.contains("\"fromLine\":0"));
        assert!(data.contains("\"toLine\":0"));
    }

    #[test]
    fn detect_doc_comments_items_after_cfg_test_are_not_scanned() {
        let src = "//! H.\n#[cfg(test)]\npub fn helper_in_tests() {}\n";
        let files = vec![sf("src/a.rs", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_const_name_is_const_kind_const_fn_is_fn_kind() {
        let src = "//! H.\npub const MAX: u32 = 1;\npub const fn calc() {}\n";
        let files = vec![sf("src/a.rs", src)];
        let mut names: Vec<(String, String)> = detect_doc_comments(&files)
            .iter()
            .map(|d| {
                let data = d.data.as_deref().unwrap();
                let kind = if data.contains("MAX") { "const" } else { "fn" };
                (kind.to_string(), data.to_string())
            })
            .collect();
        names.sort_unstable();
        assert_eq!(names.len(), 2);
        assert!(names[0].1.contains("\"name\":\"MAX\""));
        assert!(names[1].1.contains("\"name\":\"calc\""));
    }

    #[test]
    fn detect_doc_comments_excludes_tests_dir_and_test_suffix_files() {
        for path in ["tests/helpers.rs", "src/a_test.rs", "src/a_tests.rs"] {
            let files = vec![sf(path, "pub fn go() {}\n")];
            assert!(
                detect_doc_comments(&files).is_empty(),
                "{path} мав бути поза вимогою"
            );
        }
        let files = vec![sf("src/a.rs", "pub fn go() {}\n")];
        assert_eq!(detect_doc_comments(&files).len(), 2);
    }

    #[test]
    fn detect_doc_comments_ignores_non_rust_files() {
        let files = vec![sf("src/a.py", "pub fn go() {}\n")];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_doc_line_directly_above_item_is_clean_not_promotable() {
        let src = "//! H.\n\n/// вже є опис\npub fn go() {}\n";
        let files = vec![sf("src/a.rs", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_quadruple_slash_counts_as_existing_doc_not_plain_comment() {
        // `"////"` матчить DOC_LINE_RE (`^\s*///`, будь-що після трьох
        // `/`), а НЕ PLAIN_COMMENT_RE (наступний символ після `//` — `/`,
        // виключено) — доккомент модуля, розділ «Regex-lookahead».
        let src = "//! H.\n\n////\npub fn go() {}\n";
        let files = vec![sf("src/a.rs", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_no_comment_block_gives_name_only_data() {
        let src = "//! H.\n\npub fn go() {}\n";
        let files = vec![sf("src/a.rs", src)];
        let violations = detect_doc_comments(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].data.as_deref().unwrap(), "{\"name\":\"go\"}");
    }

    #[test]
    fn detect_doc_comments_extern_and_modifier_prefixes_stripped_in_any_order() {
        let src = "//! H.\npub unsafe extern \"C\" fn foo() {}\npub async fn bar() {}\n";
        let files = vec![sf("src/a.rs", src)];
        let violations = detect_doc_comments(&files);
        assert_eq!(violations.len(), 2);
        assert!(violations
            .iter()
            .any(|v| v.message.contains("pub fn foo без")));
        assert!(violations
            .iter()
            .any(|v| v.message.contains("pub fn bar без")));
    }

    #[test]
    fn detect_doc_comments_class_like_struct_message_uses_struct_keyword() {
        let src = "//! H.\npub struct Foo {}\n";
        let files = vec![sf("src/a.rs", src)];
        let violations = detect_doc_comments(&files);
        assert_eq!(violations.len(), 1);
        assert!(violations[0]
            .message
            .contains("pub struct Foo без ///-опису"));
    }

    #[test]
    fn detect_doc_comments_non_ascii_identifier_is_not_a_pub_item_matching_js_ascii_only_w() {
        // Доккомент `DOC_COMMENTS_KIND_NAME_PATTERN`: JS `\w` — ЗАВЖДИ
        // ASCII-only, тож `pub fn облік()` у JS-каноні взагалі не
        // розпізнається як pub-елемент (файл без жодного виявленого
        // pub-елемента — поза вимогою, рання порожня відповідь). Без
        // явного ASCII-класу в `DOC_COMMENTS_KIND_NAME_PATTERN` Rust
        // `regex`-крейт (Unicode `\w` за замовчуванням) розпізнав би
        // кириличне ім'я — тиха розбіжність.
        let src = "//! H.\npub fn облік() {}\n";
        let files = vec![sf("src/a.rs", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    // --- rust/workspace_root ---

    #[test]
    fn detect_workspace_root_a_root_workspace_covers_all_members_is_clean() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\", \"crates/b\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf("crates/b/Cargo.toml", "[package]\nname = \"b\"\n"),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_a2_glob_members_pattern_is_clean() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/*\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf("crates/b/Cargo.toml", "[package]\nname = \"b\"\n"),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_b_nested_workspace_below_root_is_flagged() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf("nested/Cargo.toml", "[workspace]\nmembers = [\"sub\"]\n"),
            sf("nested/sub/Cargo.toml", "[package]\nname = \"sub\"\n"),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations
            .iter()
            .any(|v| v.reason == "nested-workspace"
                && v.file.as_deref() == Some("nested/Cargo.toml")));
    }

    #[test]
    fn detect_workspace_root_c_solo_root_package_without_children_is_clean() {
        let files = vec![sf("Cargo.toml", "[package]\nname = \"solo\"\n")];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_d_nested_profile_in_non_root_manifest_is_flagged() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf(
                "crates/a/Cargo.toml",
                "[package]\nname = \"a\"\n\n[profile.release]\nopt-level = 3\n",
            ),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations
            .iter()
            .any(|v| v.reason == "nested-profile"
                && v.file.as_deref() == Some("crates/a/Cargo.toml")));
    }

    #[test]
    fn detect_workspace_root_nested_workspace_and_nested_profile_both_reported_independently() {
        // Один не-кореневий маніфест з ОБОМА порушеннями одночасно —
        // доккомент [`workspace_root_report_nested_tables`]: два незалежні
        // `if`, не `else if`.
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"nested\"]\n",
            ),
            sf(
                "nested/Cargo.toml",
                "[package]\nname = \"nested\"\n\n[workspace]\nmembers = [\"x\"]\n\n[profile.release]\nopt-level = 3\n",
            ),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations.iter().any(|v| v.reason == "nested-workspace"));
        assert!(violations.iter().any(|v| v.reason == "nested-profile"));
    }

    #[test]
    fn detect_workspace_root_e_package_not_covered_by_members_is_flagged() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf("crates/orphan/Cargo.toml", "[package]\nname = \"orphan\"\n"),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations.iter().any(|v| {
            v.reason == "package-not-workspace-member"
                && v.file.as_deref() == Some("crates/orphan/Cargo.toml")
        }));
    }

    #[test]
    fn detect_workspace_root_exclude_removes_member_requirement() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/*\"]\nexclude = [\"crates/experimental\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf(
                "crates/experimental/Cargo.toml",
                "[package]\nname = \"experimental\"\n",
            ),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_no_cargo_toml_with_package_is_not_applicable() {
        let files = vec![sf("package.json", "{}")];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_missing_root_manifest_but_packages_exist_is_missing_root() {
        let files = vec![sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n")];
        let violations = detect_workspace_root(&files);
        assert!(violations
            .iter()
            .any(|v| v.reason == "missing-root-workspace" && v.file.is_none()));
    }

    #[test]
    fn detect_workspace_root_root_package_without_workspace_and_multiple_packages_is_missing_root()
    {
        let files = vec![
            sf("Cargo.toml", "[package]\nname = \"root\"\n"),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations
            .iter()
            .any(|v| v.reason == "missing-root-workspace"));
    }

    #[test]
    fn detect_workspace_root_ignores_target_and_node_modules_directories() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf(
                "target/debug/build/whatever/Cargo.toml",
                "[package]\nname = \"ignored\"\n",
            ),
            sf(
                "node_modules/pkg/Cargo.toml",
                "[package]\nname = \"ignored2\"\n",
            ),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_ignores_worktrees_directory() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf(
                ".worktrees/main-lint/Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf(
                ".worktrees/main-lint/crates/a/Cargo.toml",
                "[package]\nname = \"a\"\n",
            ),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_unparseable_root_toml_is_treated_as_missing_root() {
        let files = vec![
            sf("Cargo.toml", "this is not = [valid toml"),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations
            .iter()
            .any(|v| v.reason == "missing-root-workspace"));
    }

    // --- rust/check ---
    // Лише гілка ДО будь-якого `exec_tool`-виклику тестована на host-таргеті
    // (той самий мотив, що `prepare_python_run_skips_*`
    // `crates/plugin-lang-python/src/lib.rs`: `exec_tool` — host-імпорт,
    // абортує поза реальним wasmtime-хостом), ПЛЮС `cargo_deny_unavailable_diagnostic`
    // — ЧИСТА функція (§2.33), тестована окремо від `detect_check`/`exec_cargo`.
    // Решта ланцюжка — лише parity-тест (`wasm-plugin-parity-rust.test.mjs`,
    // спільний фейковий `cargo`).

    #[test]
    fn detect_check_skips_when_no_root_cargo_toml_in_batch() {
        let files = vec![sf("package.json", "{}")];
        assert!(detect_check(&files).is_empty());
    }

    // --- §2.33: `cargo deny --version` non-zero тепер гучний ---

    #[test]
    fn cargo_deny_unavailable_diagnostic_none_when_status_zero() {
        assert!(cargo_deny_unavailable_diagnostic(Some(0)).is_none());
    }

    #[test]
    fn cargo_deny_unavailable_diagnostic_visible_on_nonzero_status() {
        let Some(diagnostic) = cargo_deny_unavailable_diagnostic(Some(1)) else {
            panic!("ненульовий статус мав дати Some(diagnostic) після §2.33");
        };
        assert_eq!(diagnostic.reason, CHECK_CARGO_DENY_UNAVAILABLE_REASON);
        assert_eq!(diagnostic.severity, Severity::Error);
        assert!(diagnostic.message.contains("cargo-deny"));
        assert!(diagnostic.message.contains("ПРОПУЩЕНО"));
    }

    #[test]
    fn cargo_deny_unavailable_diagnostic_visible_on_none_status_too() {
        // `status: None` (probe взагалі не дав exit-коду) — теж
        // недоступність, не окрема мовчазна гілка (той самий підхід, що
        // `pip_licenses_availability_diagnostic`
        // `crates/plugin-lang-python/src/lib.rs`).
        assert!(cargo_deny_unavailable_diagnostic(None).is_some());
    }

    #[test]
    fn cargo_deny_unavailable_diagnostic_action_check_old_code_was_silent() {
        // §2.33, перевірка дією: ДО фіксу `detect_check` мав
        // `if deny_version.status == Some(0) { … }` БЕЗ `else` — крок 6
        // мовчки пропускав ліцензійну перевірку. Пряме відтворення старої
        // форми на тому самому вході доводить твердження задачі: стара
        // гілка мовчить, нова — РІВНО одна діагностика.
        let status = Some(1);

        // СТАРА форма (буквальне відтворення коду до §2.33): діагностика
        // додається лише у гілці `status == Some(0)`, інакше — нічого.
        let mut old_style: Vec<Diagnostic> = Vec::new();
        if status == Some(0) {
            old_style.push(plain_violation(
                CHECK_CARGO_DENY_VIOLATION_REASON,
                String::new(),
            ));
        }
        assert!(
            old_style.is_empty(),
            "стара гілка мовчки ковтає недоступний cargo-deny — саме це й є fail-open баг"
        );

        // НОВА форма — актуальна функція, що тепер стоїть у `detect_check`.
        let new_diagnostic = cargo_deny_unavailable_diagnostic(status);
        assert!(new_diagnostic.is_some());
        assert_eq!(
            new_diagnostic.unwrap().reason,
            CHECK_CARGO_DENY_UNAVAILABLE_REASON
        );
    }

    // --- rust/cargo_mutants_config ---

    #[test]
    fn resolve_all_cargo_manifests_root_only_no_package_json() {
        let files = vec![sf("Cargo.toml", "[package]\nname = \"a\"\n")];
        assert_eq!(
            resolve_all_cargo_manifests(&files),
            vec!["Cargo.toml".to_string()]
        );
    }

    #[test]
    fn resolve_all_cargo_manifests_empty_batch_is_empty() {
        let files = vec![sf("README.md", "hi")];
        assert!(resolve_all_cargo_manifests(&files).is_empty());
    }

    #[test]
    fn resolve_all_cargo_manifests_prefers_tauri_manifest_over_flat() {
        let files = vec![
            sf("Cargo.toml", "[workspace]\n"),
            sf("package.json", "{\"workspaces\":[\"owner\"]}"),
            sf(
                "owner/src-tauri/Cargo.toml",
                "[package]\nname = \"tauri\"\n",
            ),
            sf("owner/Cargo.toml", "[package]\nname = \"flat\"\n"),
        ];
        let manifests = resolve_all_cargo_manifests(&files);
        assert_eq!(
            manifests,
            vec![
                "Cargo.toml".to_string(),
                "owner/src-tauri/Cargo.toml".to_string()
            ]
        );
    }

    #[test]
    fn resolve_all_cargo_manifests_falls_back_to_flat_manifest_without_tauri() {
        // РЕГРЕСІЯ: літеральний (без `*`) запис — короткий шлях
        // [`expand_workspace_entry_dirs`] взагалі не викликається (доккомент
        // [`resolve_all_cargo_manifests`]), той самий код-шлях, що ДО фіксу.
        let files = vec![
            sf("Cargo.toml", "[workspace]\n"),
            sf("package.json", "{\"workspaces\":[\"owner\"]}"),
            sf("owner/Cargo.toml", "[package]\nname = \"flat\"\n"),
        ];
        let manifests = resolve_all_cargo_manifests(&files);
        assert_eq!(
            manifests,
            vec!["Cargo.toml".to_string(), "owner/Cargo.toml".to_string()]
        );
    }

    #[test]
    fn resolve_all_cargo_manifests_expands_glob_workspaces_entry() {
        // Баг ВИПРАВЛЕНО (доккомент модуля, розділ «дві СВІДОМІ поведінкові
        // відмінності», пункт (c)): `"workspaces": ["packages/*"]` тепер
        // РОЗКРИВАЄТЬСЯ проти host-батчу — `packages/a` і `packages/b`
        // обидва знайдені, відсортовано.
        let files = vec![
            sf("Cargo.toml", "[workspace]\n"),
            sf("package.json", "{\"workspaces\":[\"packages/*\"]}"),
            sf("packages/b/Cargo.toml", "[package]\nname = \"b\"\n"),
            sf("packages/a/Cargo.toml", "[package]\nname = \"a\"\n"),
        ];
        let manifests = resolve_all_cargo_manifests(&files);
        assert_eq!(
            manifests,
            vec![
                "Cargo.toml".to_string(),
                "packages/a/Cargo.toml".to_string(),
                "packages/b/Cargo.toml".to_string(),
            ]
        );
    }

    #[test]
    fn resolve_all_cargo_manifests_glob_entry_applies_tauri_preference_per_dir() {
        // Tauri-перевага застосовується до КОЖНОГО розкритого каталогу
        // окремо, не до патерна: `packages/a` має src-tauri-варіант,
        // `packages/b` — лише плаский.
        let files = vec![
            sf("package.json", "{\"workspaces\":[\"packages/*\"]}"),
            sf(
                "packages/a/src-tauri/Cargo.toml",
                "[package]\nname = \"a-tauri\"\n",
            ),
            sf("packages/a/Cargo.toml", "[package]\nname = \"a-flat\"\n"),
            sf("packages/b/Cargo.toml", "[package]\nname = \"b-flat\"\n"),
        ];
        let manifests = resolve_all_cargo_manifests(&files);
        assert_eq!(
            manifests,
            vec![
                "packages/a/src-tauri/Cargo.toml".to_string(),
                "packages/b/Cargo.toml".to_string(),
            ]
        );
    }

    #[test]
    fn resolve_all_cargo_manifests_glob_entry_with_no_matching_dirs_is_empty_contribution() {
        // Glob, що нічого не матчить у батчі — коректний порожній результат
        // (не `*`-як-літерал, не помилка).
        let files = vec![
            sf("Cargo.toml", "[workspace]\n"),
            sf("package.json", "{\"workspaces\":[\"packages/*\"]}"),
            sf("apps/a/Cargo.toml", "[package]\nname = \"a\"\n"),
        ];
        let manifests = resolve_all_cargo_manifests(&files);
        assert_eq!(manifests, vec!["Cargo.toml".to_string()]);
    }

    #[test]
    fn detect_cargo_mutants_config_no_manifests_is_not_applicable() {
        let files = vec![sf("README.md", "hi")];
        assert!(detect_cargo_mutants_config(&files).is_empty());
    }

    #[test]
    fn detect_cargo_mutants_config_root_baseline_present_is_clean() {
        let files = vec![
            sf("Cargo.toml", "[package]\nname = \"a\"\n"),
            sf(".cargo/mutants.toml", "[[exclude_globs]]\n"),
        ];
        assert!(detect_cargo_mutants_config(&files).is_empty());
    }

    #[test]
    fn detect_cargo_mutants_config_root_baseline_missing_flags_root_target() {
        let files = vec![sf("Cargo.toml", "[package]\nname = \"a\"\n")];
        let violations = detect_cargo_mutants_config(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, CARGO_MUTANTS_CONFIG_MISSING_REASON);
        assert_eq!(violations[0].file.as_deref(), Some(".cargo/mutants.toml"));
        assert!(violations[0].message.contains(".cargo/mutants.toml"));
    }

    #[test]
    fn detect_cargo_mutants_config_checks_each_resolved_manifest_independently() {
        let files = vec![
            sf("Cargo.toml", "[workspace]\n"),
            sf("package.json", "{\"workspaces\":[\"owner\"]}"),
            sf("owner/Cargo.toml", "[package]\nname = \"owner\"\n"),
            sf("owner/.cargo/mutants.toml", "[[exclude_globs]]\n"),
        ];
        // Кореневий baseline відсутній, `owner/.cargo/mutants.toml` — є.
        let violations = detect_cargo_mutants_config(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].file.as_deref(), Some(".cargo/mutants.toml"));
    }

    // --- rust/wasm_component ---

    #[test]
    fn detect_wasm_component_no_wasm_bindgen_or_wasmtime_is_clean() {
        let files = vec![sf(
            "Cargo.toml",
            "[package]\nname = \"a\"\n\n[dependencies]\nserde = \"1\"\n",
        )];
        assert!(detect_wasm_component(&files).is_empty());
    }

    #[test]
    fn detect_wasm_component_direct_wasm_bindgen_dependency_is_forbidden() {
        let files = vec![sf(
            "Cargo.toml",
            "[package]\nname = \"a\"\n\n[dependencies]\nwasm-bindgen = \"0.2\"\n",
        )];
        let violations = detect_wasm_component(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].reason,
            WASM_COMPONENT_WASM_BINDGEN_FORBIDDEN_REASON
        );
        assert_eq!(violations[0].file.as_deref(), Some("Cargo.toml"));
    }

    #[test]
    fn detect_wasm_component_wasm_bindgen_in_dev_dependencies_is_forbidden_too() {
        let files = vec![sf(
            "Cargo.toml",
            "[package]\nname = \"a\"\n\n[dev-dependencies]\nwasm-bindgen = \"0.2\"\n",
        )];
        let violations = detect_wasm_component(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].reason,
            WASM_COMPONENT_WASM_BINDGEN_FORBIDDEN_REASON
        );
    }

    #[test]
    fn detect_wasm_component_wasm_bindgen_under_target_cfg_is_forbidden() {
        let files = vec![sf(
            "Cargo.toml",
            "[package]\nname = \"a\"\n\n[target.'cfg(target_arch = \"wasm32\")'.dependencies]\nwasm-bindgen = \"0.2\"\n",
        )];
        let violations = detect_wasm_component(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].reason,
            WASM_COMPONENT_WASM_BINDGEN_FORBIDDEN_REASON
        );
    }

    #[test]
    fn detect_wasm_component_wasmtime_default_features_true_is_clean() {
        let files = vec![sf(
            "Cargo.toml",
            "[package]\nname = \"a\"\n\n[dependencies]\nwasmtime = \"27\"\n",
        )];
        assert!(detect_wasm_component(&files).is_empty());
    }

    #[test]
    fn detect_wasm_component_wasmtime_no_default_features_without_component_model_is_flagged() {
        let files = vec![sf(
            "Cargo.toml",
            "[package]\nname = \"a\"\n\n[dependencies]\nwasmtime = { version = \"27\", default-features = false, features = [\"cranelift\"] }\n",
        )];
        let violations = detect_wasm_component(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].reason,
            WASM_COMPONENT_WASMTIME_MISSING_COMPONENT_MODEL_REASON
        );
    }

    #[test]
    fn detect_wasm_component_wasmtime_no_default_features_with_component_model_is_clean() {
        let files = vec![sf(
            "Cargo.toml",
            "[package]\nname = \"a\"\n\n[dependencies]\nwasmtime = { version = \"27\", default-features = false, features = [\"component-model\"] }\n",
        )];
        assert!(detect_wasm_component(&files).is_empty());
    }

    #[test]
    fn detect_wasm_component_workspace_inherited_resolved_via_ancestor_in_batch_is_forbidden() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n\n[workspace.dependencies]\nwasm-bindgen = \"0.2\"\n",
            ),
            sf(
                "crates/a/Cargo.toml",
                "[package]\nname = \"a\"\n\n[dependencies]\nwasm-bindgen = { workspace = true }\n",
            ),
        ];
        let violations = detect_wasm_component(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].reason,
            WASM_COMPONENT_WASM_BINDGEN_FORBIDDEN_REASON
        );
        assert_eq!(violations[0].file.as_deref(), Some("crates/a/Cargo.toml"));
    }

    #[test]
    fn detect_wasm_component_workspace_inherited_unresolved_ancestor_missing_from_batch_is_silent()
    {
        // Доккомент модуля, розділ «межа `{ workspace = true }`-успадкування»:
        // делта БЕЗ кореневого Cargo.toml у батчі — навмисно тихий fail-open,
        // не хибне спрацювання.
        let files = vec![sf(
            "crates/a/Cargo.toml",
            "[package]\nname = \"a\"\n\n[dependencies]\nwasm-bindgen = { workspace = true }\n",
        )];
        assert!(detect_wasm_component(&files).is_empty());
    }

    #[test]
    fn detect_wasm_component_workspace_inherited_wasmtime_component_model_from_root() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n\n[workspace.dependencies]\nwasmtime = { version = \"27\", default-features = false, features = [\"cranelift\"] }\n",
            ),
            sf(
                "crates/a/Cargo.toml",
                "[package]\nname = \"a\"\n\n[dependencies]\nwasmtime = { workspace = true }\n",
            ),
        ];
        let violations = detect_wasm_component(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].reason,
            WASM_COMPONENT_WASMTIME_MISSING_COMPONENT_MODEL_REASON
        );
    }

    #[test]
    fn detect_wasm_component_non_cargo_toml_files_are_ignored() {
        let files = vec![sf("src/main.rs", "wasm-bindgen = true\n")];
        assert!(detect_wasm_component(&files).is_empty());
    }

    #[test]
    fn detect_wasm_component_unparseable_toml_is_skipped_not_panicking() {
        let files = vec![sf("Cargo.toml", "this is not = [valid toml")];
        assert!(detect_wasm_component(&files).is_empty());
    }

    // --- маніфест ---

    #[test]
    fn build_manifest_declares_all_concerns_with_expected_scopes() {
        let manifest = build_manifest();
        assert_eq!(manifest.id, "rust/wasm-concerns");
        assert_eq!(manifest.world_version, "3.1.0");
        assert_eq!(manifest.domains, vec![Domain::Lint]);
        assert_eq!(manifest.concerns.len(), 6);
        assert_eq!(manifest.tools, vec![CHECK_TOOL.to_string()]);
        assert!(manifest.ci_artifacts.is_empty());

        let check = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_CHECK)
            .expect("rust/check contribution має бути в маніфесті");
        assert_eq!(check.scope, ConcernScope::Full);
        assert_eq!(
            check.glob,
            vec!["Cargo.toml".to_string(), "deny.toml".to_string()]
        );

        let cargo_mutants_config = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_CARGO_MUTANTS_CONFIG)
            .expect("rust/cargo_mutants_config contribution має бути в маніфесті");
        assert_eq!(cargo_mutants_config.scope, ConcernScope::Full);
        assert_eq!(
            cargo_mutants_config.glob,
            vec![
                "**/Cargo.toml".to_string(),
                "package.json".to_string(),
                "**/.cargo/mutants.toml".to_string()
            ]
        );

        let wasm_component = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_WASM_COMPONENT)
            .expect("rust/wasm_component contribution має бути в маніфесті");
        assert_eq!(wasm_component.scope, ConcernScope::PerFile);
        assert_eq!(wasm_component.glob, vec!["**/Cargo.toml".to_string()]);

        let applies = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_APPLIES)
            .expect("rust/applies contribution має бути в маніфесті");
        assert_eq!(applies.scope, ConcernScope::Full);
        assert_eq!(applies.glob, vec!["**/Cargo.toml".to_string()]);

        let doc_comments = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_DOC_COMMENTS)
            .expect("rust/doc_comments contribution має бути в маніфесті");
        assert_eq!(doc_comments.scope, ConcernScope::PerFile);
        assert_eq!(doc_comments.glob, vec!["**/*.rs".to_string()]);

        let workspace_root = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_WORKSPACE_ROOT)
            .expect("rust/workspace_root contribution має бути в маніфесті");
        assert_eq!(workspace_root.scope, ConcernScope::Full);
        assert_eq!(workspace_root.glob, vec!["**/Cargo.toml".to_string()]);

        assert!(manifest.capabilities.fs_read.is_empty());
        assert!(!manifest.capabilities.network);
    }

    /// Anti-drift ignore-списку: [`WORKSPACE_ROOT_IGNORED_DIR_NAMES`] проти
    /// `globMatches.ignoreDirs` декларативного гейта правила
    /// (`plugins/lang-rust/rules/rust/main.json`) — той самий прийом
    /// `include_str!`-на-те-саме-джерело, що `BLUE_OAK_SNAPSHOT_JSON`
    /// у `crates/plugin-lang-python`.
    ///
    /// Навіщо саме тепер. До зняття JS-детекторів копій списку було дві —
    /// гейт у `main.json` і `RUST_WALK_IGNORED_DIR_NAMES`
    /// (`rules/rust/lib/ignored-dirs.mjs`), — і їхню тотожність стеріг
    /// `rules/rust/tests/applies.test.mjs`. Порт додав ТРЕТЮ копію (ця
    /// константа), яку не стеріг ніхто: доккомент лише посилався на
    /// JS-джерело. Розбіжність тиха й дорога — `detect_workspace_root`
    /// почав би бачити каталоги, які гейт правила виключає (прецедент:
    /// два stale worktree давали 12 хибних `nested-workspace`, PR #179).
    /// Через гейт список пінується транзитивно: гість ⇄ `main.json` тут,
    /// `main.json` ⇄ JS-константа — в `applies.test.mjs`.
    #[test]
    fn ignored_dir_names_match_declarative_rule_gate() {
        const RULE_MAIN_JSON: &str =
            include_str!("../../../plugins/lang-rust/rules/rust/main.json");
        let Ok(PkgJsonValue::Object(root)) = PkgJsonParser::new(RULE_MAIN_JSON).parse() else {
            panic!("main.json правила rust — валідний JSON-обʼєкт");
        };
        let applies = root
            .iter()
            .find(|(k, _)| k == "applies")
            .map(|(_, v)| v)
            .expect("main.json має ключ applies");
        let PkgJsonValue::Object(applies) = applies else {
            panic!("applies — обʼєкт");
        };
        let glob_matches = applies
            .iter()
            .find(|(k, _)| k == "globMatches")
            .map(|(_, v)| v)
            .expect("applies має globMatches");
        let PkgJsonValue::Object(glob_matches) = glob_matches else {
            panic!("globMatches — обʼєкт");
        };
        let ignore_dirs = glob_matches
            .iter()
            .find(|(k, _)| k == "ignoreDirs")
            .map(|(_, v)| v)
            .expect("globMatches має ignoreDirs");
        let PkgJsonValue::Array(items) = ignore_dirs else {
            panic!("ignoreDirs — масив");
        };
        let gate: Vec<&str> = items
            .iter()
            .map(|v| match v {
                PkgJsonValue::Str(s) => s.as_str(),
                _ => panic!("ignoreDirs містить лише рядки"),
            })
            .collect();

        // Порівняння як МНОЖИН: порядок у двох джерелах семантично не
        // значущий (обидва боки роблять membership-перевірку сегмента).
        let mut gate_sorted = gate.clone();
        gate_sorted.sort_unstable();
        let mut guest_sorted = WORKSPACE_ROOT_IGNORED_DIR_NAMES.to_vec();
        guest_sorted.sort_unstable();
        assert_eq!(
            guest_sorted, gate_sorted,
            "ignore-список гостя розійшовся з гейтом правила (main.json)"
        );
        // Негативний контроль: тест не мав би сенсу на порожньому списку.
        assert!(gate.contains(&"target"));
        assert!(gate.contains(&".worktrees"));
    }

    /// `plugin.toml` — статичний дублікат `describe()` (той самий anti-drift
    /// мотив, що `crates/plugin-lang-js`/`crates/plugin-lang-python`).
    #[test]
    fn plugin_toml_concern_keys_match_describe() {
        let manifest: toml::Table = include_str!("../plugin.toml")
            .parse()
            .expect("plugin.toml має бути валідним TOML");
        let runtime = build_manifest();

        let mut declared: Vec<&str> = manifest
            .get("concerns")
            .and_then(|v| v.as_array())
            .expect("`concerns` — array of tables у корені маніфеста")
            .iter()
            .map(|c| c["key"].as_str().expect("`key` — рядок"))
            .collect();
        declared.sort_unstable();
        let mut runtime_keys: Vec<&str> = runtime.concerns.iter().map(|c| c.key.as_str()).collect();
        runtime_keys.sort_unstable();
        assert_eq!(
            declared, runtime_keys,
            "plugin.toml розійшовся з describe() по concerns — синхронізуй маніфест-довідник"
        );

        let declared_tools: Vec<&str> = manifest
            .get("tools")
            .and_then(|v| v.as_array())
            .expect("`tools` мусить бути top-level масивом маніфеста")
            .iter()
            .map(|t| t.as_str().expect("елемент `tools` — рядок"))
            .collect();
        assert_eq!(
            declared_tools,
            runtime.tools.iter().map(String::as_str).collect::<Vec<_>>(),
            "plugin.toml розійшовся з describe() по tools"
        );
    }
}
