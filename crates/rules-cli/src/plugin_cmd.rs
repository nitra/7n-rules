//! Native-контур `n-rules plugin embed-manifest`/`n-rules plugin publish` —
//! задача Д2 плану `docs/specs/2026-08-31-full-rust-migration-plan.md`
//! (третя колія дистрибуції): вбудувати авторитетний маніфест
//! (`oci_dist_package::embed_manifest`) у кожного з шести first-party
//! wasm-гостей і дати команду публікації поверх
//! `oci_dist_oci::publish_plugin_component`. Третя спроба (перші дві —
//! §2.101 і §2.117 реєстру `docs/plans/2026-08-05-open-questions-register.md`
//! — упирались у структурні блокери самого `oci-dist`, обидва зняті у
//! `0.3.1`).
//!
//! Поверхні в JS-CLI немає взагалі — команда нативна цілком (той самий
//! мотив, що [`crate::tools_cmd`]), тож `plugin` — власна поверхня бінаря:
//! невідомий аргумент тут usage-помилка, не делегація (`OWNED_SURFACES` у
//! `main.rs`).
//!
//! # Ідентичність — з наявних джерел, не вигадана
//!
//! - `publisher_id` — namespace world-пакета контракту
//!   (`package n-rules:plugin@5.0.0;`, `crates/rules-contract/wit/world.wit`)
//!   → `n-rules`. Читається з файлу, а не константа тут, щоб дрейф namespace
//!   контракту вивалився гучно, а не мовчки розійшовся з реальністю;
//! - `package` — короткий суфікс, переданий `--package` (той самий рядок,
//!   що `FIRST_PARTY_WASM_PLUGINS[].name` у
//!   `npm/scripts/build-wasm-plugins.mjs` — саме той скрипт володіє мапою
//!   crateDir→name, дублювати її тут значило б завести другу таблицю, яка
//!   розійдеться на першому ж новому гості);
//! - `version` — `version = "..."` з `<--crate-dir>/Cargo.toml` гостя;
//! - `component_profile` — `oci_dist_package::COMPONENT_PROFILE`
//!   (`wasm32-wasip3`) — реальний профіль збірки, той самий `WASM_TARGET`,
//!   що в `build-wasm-plugins.mjs` (перевіряється, не постулюється: сам
//!   `embed_manifest` відмовляє невідповідному компоненту нижче за течією);
//! - `entrypoints` — `describe`/`detect`/`fix`, world-функції
//!   `world.wit:647,650,667`, спільні для всіх шести гостей РІВНО тому, що
//!   кожен `plugin.toml` заявляє `domains = ["lint"]` і нічого понад це
//!   ([`ONLY_SUPPORTED_DOMAIN`]) — команда звіряє це явно й гучно відмовляє
//!   для гіпотетичного сьомого гостя з іншим доменом, а не мовчки вішає ті
//!   самі три entrypoints на контракт, якого не перевіряла.
//!
//! # Реєстр — обов'язковий параметр виклику, не константа
//!
//! `n-rules plugin publish --registry <реєстр>` передає рядок як є в
//! `oci_dist_oci::publish_plugin_component` — жодного дефолту, жодного
//! вшитого імені. Гібридна вимога обсягу Д2 (ядро публічно з анонімним
//! pull, плагіни можуть бути приватними) задоволена самою формою виклику:
//! той самий реєстр, куди пушить `crates-7n` (`.cargo/config.toml`), тут
//! ніде не постулюється — виклик приймає БУДЬ-ЯКИЙ реєстр.
//!
//! # Async — той самий прийом, що `fix_cmd`
//!
//! `publish_plugin_component` асинхронна (мережевий push); [`run_blocking`]
//! — односторінковий `tokio::runtime::Builder::new_multi_thread().build().
//! block_on(...)`, ідентичний прийом до `fix_cmd::run_blocking` і
//! `crates/rules-plugin-host` після хвилі `#610` — жодного нового способу
//! заводити рантайм тут не винаходилось. `embed-manifest` лишається
//! повністю синхронною: `oci_dist_package::embed_manifest` не async.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::Context;
use oci_dist_oci::{OciLockEntry, OciPluginLock, fetch_plugin_component, publish_plugin_component};
use oci_dist_package::{COMPONENT_PROFILE, MANIFEST_SCHEMA, PluginManifest, embed_manifest, inspect_component};

use crate::cli::{PluginEmbedManifestArgs, PluginFetchArgs, PluginPublishArgs};

/// Єдиний домен, для якого ця команда знає відповідність entrypoints
/// (`describe`/`detect`/`fix`, world-функції `world.wit:647,650,667`).
/// Кожен із шести first-party `plugin.toml` заявляє рівно цей домен —
/// перевірено `grep '^domains' crates/plugin-*/plugin.toml` на момент
/// написання команди. Інший домен (`ecosystem-outdated`/`docgen-render`) —
/// інші world-функції, яких ця команда не заявляє, щоб не вигадати
/// entrypoints для контракту, якого не перевіряла.
const ONLY_SUPPORTED_DOMAIN: &str = "lint";

/// Entrypoints лінт-домену — дослівно world-функції `world.wit`, логічне
/// ім'я збігається з іменем експорту (жодного перейменування).
const LINT_ENTRYPOINTS: [&str; 3] = ["describe", "detect", "fix"];

/// `n-rules plugin embed-manifest --crate-dir <dir> --package <name> \
/// --component <шлях> [--out <шлях>]`.
pub fn run_embed_manifest(args: &PluginEmbedManifestArgs) -> ExitCode {
    match embed_manifest_component(args) {
        Ok((out_path, manifest)) => {
            println!(
                "✅ маніфест вбудовано: {} → {} ({}, {})",
                args.component.display(),
                out_path.display(),
                manifest.package_identity(),
                manifest.version
            );
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("❌ n-rules plugin embed-manifest: {message}");
            ExitCode::FAILURE
        }
    }
}

/// `n-rules plugin publish --registry <реєстр> --component <шлях> [--dry-run]`.
pub fn run_publish(args: &PluginPublishArgs) -> ExitCode {
    match run_blocking(publish_plugin_component(
        &args.registry,
        &args.component,
        args.dry_run,
    )) {
        Ok(release) => {
            let verb = if args.dry_run { "розраховано" } else { "опубліковано" };
            println!(
                "✅ {verb}: {} ({}) → {}",
                release.release.package, release.release.version, release.reference
            );
            if !release.release.digest.is_empty() {
                println!("   digest {}", release.release.digest);
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("❌ n-rules plugin publish: {error:#}");
            ExitCode::FAILURE
        }
    }
}

/// `n-rules plugin fetch --lock <шлях> --registry <реєстр> --package <ідентичність>
/// --requirement <=X.Y.Z> [--cache-root <тека>]` — задача Д1 третьої колії
/// дистрибуції (`docs/specs/2026-09-01-wasm-plugin-lock-resolve.md`): єдине
/// місце `n-rules`, де відбувається мережевий OCI-виклик заради
/// консюмерського резолву `wasmPlugins` (`npm/scripts/lib/lint-surface/wasm-plugins.mjs`,
/// форма `{name,package,requirement}` — читає лише lock+кеш, БЕЗ мережі).
pub fn run_fetch(args: &PluginFetchArgs) -> ExitCode {
    match run_blocking(fetch_and_lock(args)) {
        Ok((path, cache_hit)) => {
            let verb = if cache_hit { "вже закешовано" } else { "завантажено й закешовано" };
            println!(
                "✅ {} {} → {} ({verb})",
                args.package,
                args.requirement,
                path.display()
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("❌ n-rules plugin fetch: {error:#}");
            ExitCode::FAILURE
        }
    }
}

/// Реалізація `plugin fetch` — окрема async-функція, щоб `run_fetch`
/// лишався тонким адаптером до `ExitCode` (той самий прийом, що
/// `run_publish`/`publish_plugin_component`).
///
/// Дзеркалить `DirectOciResolutionBackend::resolve_dependency`/
/// `resolve_locked_dependency` (`oci_dist_oci::graph`, приватні там) на
/// рівні ОДНОГО пакета без графу залежностей (доккомент модуля §Д1,
/// розділ 2 спеки — `collect_graph` розв'язує граф WIT-залежностей ОДНОГО
/// компонента, не плоский список незалежних `wasmPlugins`):
/// 1. Lock уже пінить `package`+`requirement` → кеш-хіт за digest без
///    мережі; кеш-промах чи пошкоджений кеш → мережевий фетч, звірений
///    ПРОТИ вже запінованого digest (fail loud на дрейфі — ніколи не
///    довіряти мовчки новому вмісту під тим самим піном).
/// 2. Lock ще не має запису → trust-on-first-use фетч (той самий мотив, що
///    `resolve_dependency` при першому резолві): digest із embedded-релізу
///    йде в кеш і в lock без звірки — звіряти нема з чим, це саме той
///    виклик, що встановлює пін.
async fn fetch_and_lock(args: &PluginFetchArgs) -> anyhow::Result<(std::path::PathBuf, bool)> {
    let version = args
        .requirement
        .strip_prefix('=')
        .filter(|rest| !rest.is_empty())
        .context("--requirement має бути точним `=X.Y.Z` (те саме M0-обмеження, що oci-dist-oci валідує)")?;
    let cache_root = resolve_plugin_cache_dir(args.cache_root.as_deref())?;
    std::fs::create_dir_all(&cache_root)
        .with_context(|| format!("не вдалось створити кеш-теку `{}`", cache_root.display()))?;

    let mut lock = OciPluginLock::load_or_empty(&args.lock)?;
    let pinned = lock
        .packages
        .iter()
        .find(|entry| entry.package == args.package && entry.requirement == args.requirement)
        .cloned();

    if let Some(entry) = pinned {
        let cache_path = cache_path_for_digest(&cache_root, &entry.digest)?;
        if let Some(hit) = read_valid_cache_hit(&cache_path, &entry.digest) {
            return Ok((hit, true));
        }
        let fetched = fetch_plugin_component(&args.registry, &args.package, version).await?;
        let digest = fetched.release.release.digest.clone();
        if digest != entry.digest {
            anyhow::bail!(
                "digest дрейфонув: lock `{}` пінить `{}` для `{} {}`, реєстр щойно віддав `{digest}` — \
                 можлива компрометація реєстру чи lock застарів, не довіряю мовчки",
                args.lock.display(),
                entry.digest,
                args.package,
                args.requirement
            );
        }
        publish_to_cache(&cache_path, fetched.component())?;
        return Ok((cache_path, false));
    }

    // Trust-on-first-use: немає попереднього піна, звіряти нема з чим —
    // цей виклик його встановлює (той самий мотив, що
    // `DirectOciResolutionBackend::resolve_dependency` при першому резолві).
    let fetched = fetch_plugin_component(&args.registry, &args.package, version).await?;
    let digest = fetched.release.release.digest.clone();
    let cache_path = cache_path_for_digest(&cache_root, &digest)?;
    publish_to_cache(&cache_path, fetched.component())?;
    lock.packages.push(OciLockEntry {
        package: args.package.clone(),
        requirement: args.requirement.clone(),
        version: fetched.release.release.version.clone(),
        digest,
        reference: fetched.release.reference.clone(),
        signature: None,
    });
    lock.write(&args.lock)?;
    Ok((cache_path, false))
}

/// Кеш-директорія `.wasm`-компонентів — дзеркало `resolvePluginCacheDir`
/// (`wasm-plugins.mjs`, JS-бік): `--cache-root` явний, інакше
/// `N_RULES_PLUGIN_CACHE_DIR` (той самий канал ізоляції тестів, що JS),
/// інакше платформна конвенція (`~/.cache/@7n/rules/plugins` mac/linux,
/// `%LOCALAPPDATA%\@7n\rules\plugins` win32). Той самий кеш-неймспейс, що
/// JS читає для `url`+`sha256`- і lock-форм — обидва боки звіряють один
/// вміст за одним `sha256`-hex іменем файлу, джерело піна значення не має.
fn resolve_plugin_cache_dir(explicit: Option<&std::path::Path>) -> anyhow::Result<std::path::PathBuf> {
    if let Some(dir) = explicit {
        return Ok(dir.to_path_buf());
    }
    if let Ok(over) = std::env::var("N_RULES_PLUGIN_CACHE_DIR") {
        if !over.is_empty() {
            return Ok(std::path::PathBuf::from(over));
        }
    }
    if cfg!(windows) {
        let local_app_data =
            std::env::var("LOCALAPPDATA").context("LOCALAPPDATA не встановлено — потрібен для дефолтної кеш-теки на Windows")?;
        Ok(std::path::PathBuf::from(local_app_data).join("@7n").join("rules").join("plugins"))
    } else {
        let home = std::env::var("HOME").context("HOME не встановлено — потрібен для дефолтної кеш-теки")?;
        Ok(std::path::PathBuf::from(home)
            .join(".cache")
            .join("@7n")
            .join("rules")
            .join("plugins"))
    }
}

/// `sha256:<hex>` → `<cacheDir>/<hex>.wasm` — той самий файл-неймспейс, що
/// `wasm-plugins.mjs` (`<cacheDir>/${sha256}.wasm`), лише без префікса
/// `sha256:` у файловому імені (JS-бік теж не несе префікс, доккомент
/// `resolveLockEntryPath`).
fn cache_path_for_digest(cache_root: &std::path::Path, digest: &str) -> anyhow::Result<std::path::PathBuf> {
    let hex = digest
        .strip_prefix("sha256:")
        .with_context(|| format!("digest `{digest}` не має префікса `sha256:` — пошкоджений lock чи реліз"))?;
    Ok(cache_root.join(format!("{hex}.wasm")))
}

/// Кеш-хіт — це наявний файл, чия ВБУДОВАНА ідентичність
/// (`inspect_component(bytes).release.digest`, той самий authoritative
/// digest, що обчислює сам `oci-dist-package` при публікації) збігається з
/// очікуваним — ім'я файлу саме по собі не є довірою (той самий мотив, що
/// `readValidCacheHit` у `wasm-plugins.mjs`).
fn read_valid_cache_hit(cache_path: &std::path::Path, expected_digest: &str) -> Option<std::path::PathBuf> {
    let bytes = std::fs::read(cache_path).ok()?;
    let inspected = inspect_component(&bytes).ok()?;
    (inspected.release.digest == expected_digest).then(|| cache_path.to_path_buf())
}

/// Атомарно публікує завантажені байти в кеш — tmp-файл у тій самій теці
/// (спільний filesystem, без EXDEV на `rename`) + rename на фінальне ім'я,
/// той самий патерн, що JS-бік (`publishToCache`, `wasm-plugins.mjs`).
fn publish_to_cache(cache_path: &std::path::Path, bytes: &[u8]) -> anyhow::Result<()> {
    let parent = cache_path
        .parent()
        .context("шлях кешу без батьківської теки")?;
    std::fs::create_dir_all(parent)
        .with_context(|| format!("не вдалось створити кеш-теку `{}`", parent.display()))?;
    let tmp_path = parent.join(format!(".tmp-{}", std::process::id()));
    std::fs::write(&tmp_path, bytes)
        .with_context(|| format!("не вдалось записати тимчасовий кеш-файл `{}`", tmp_path.display()))?;
    std::fs::rename(&tmp_path, cache_path).with_context(|| {
        format!(
            "не вдалось опублікувати кеш `{}` → `{}`",
            tmp_path.display(),
            cache_path.display()
        )
    })
}

/// Заводить односторінковий multi-thread рантайм і виконує один async-виклик
/// до завершення — той самий прийом, що `fix_cmd::run_blocking`.
fn run_blocking<T>(future: impl std::future::Future<Output = anyhow::Result<T>>) -> anyhow::Result<T> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("не вдалось завести tokio-рантайм для plugin publish");
    runtime.block_on(future)
}

fn embed_manifest_component(
    args: &PluginEmbedManifestArgs,
) -> Result<(PathBuf, PluginManifest), String> {
    let publisher_id = read_world_publisher_id(&args.crate_dir)?;
    let version = read_cargo_version(&args.crate_dir)?;
    validate_lint_only_domain(&args.crate_dir)?;
    let worlds = read_declared_worlds(&args.crate_dir)?;

    let manifest_toml = render_manifest_toml(&publisher_id, &args.package, &version, &worlds);
    let manifest = PluginManifest::from_toml(&manifest_toml)
        .map_err(|error| format!("маніфест не пройшов валідацію: {error}"))?;

    let component = std::fs::read(&args.component).map_err(|error| {
        format!(
            "не вдалось прочитати компонент `{}`: {error}",
            args.component.display()
        )
    })?;
    let embedded = embed_manifest(&component, &manifest)
        .map_err(|error| format!("не вдалось вбудувати маніфест: {error}"))?;

    let out_path = args.out.clone().unwrap_or_else(|| args.component.clone());
    std::fs::write(&out_path, &embedded).map_err(|error| {
        format!(
            "не вдалось записати результат `{}`: {error}",
            out_path.display()
        )
    })?;

    Ok((out_path, manifest))
}

/// Рендерить authoring-TOML для `PluginManifest::from_toml` — єдиний
/// публічний шлях побудувати валідний маніфест (`ComponentProfile`/
/// `WitExportRef` мають приватні поля, конструктор лише через
/// `from_toml`/`from_json`, доккомент `oci-dist-package`).
///
/// `worlds` — п'ятий top-level рядок, серед полів, яких `PluginManifest`
/// СТРУКТУРНО не знає (`schema`/`component_profile`/`publisher_id`/
/// `package`/`version`/`entrypoints`/`dependencies`/`triggers` — вичерпний
/// список typed-полів `0.3.1`): `#[serde(flatten)] extensions` крейта ловить
/// довільні top-level ключі й везе їх крізь TOML → JSON custom-section
/// незмінними (доккомент `render_manifest_toml`, тест
/// `preserves_unknown_additive_metadata_in_embedded_json` у `oci-dist-package`).
/// Це навмисно ТОЙ САМИЙ канал, а не новий формат — `worlds` матеріалізується
/// в embedded JSON як `manifest.worlds` (масив рядків), який `declared_worlds`
/// у `crates/rules-napi/src/lib.rs` читає назад через
/// `oci_dist_package::inspect_component` БЕЗ інстанціації (доккомент там,
/// секція «Custom-section дискавері»).
fn render_manifest_toml(publisher_id: &str, package: &str, version: &str, worlds: &[String]) -> String {
    let worlds_array = worlds
        .iter()
        .map(|world| format!("\"{world}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let mut toml = format!(
        "schema = \"{MANIFEST_SCHEMA}\"\n\
         component_profile = \"{COMPONENT_PROFILE}\"\n\
         publisher_id = \"{publisher_id}\"\n\
         package = \"{package}\"\n\
         version = \"{version}\"\n\
         worlds = [{worlds_array}]\n\n\
         [entrypoints]\n"
    );
    for entrypoint in LINT_ENTRYPOINTS {
        toml.push_str(&format!("{entrypoint} = \"{entrypoint}\"\n"));
    }
    toml
}

/// `package n-rules:plugin@5.0.0;` → `n-rules` — namespace world-пакета
/// контракту, спільного для всіх шести гостей
/// (`<crate-dir>/../rules-contract/wit/world.wit`, сусідній крейт).
fn read_world_publisher_id(crate_dir: &Path) -> Result<String, String> {
    let wit_path = crate_dir.join("../rules-contract/wit/world.wit");
    let source = std::fs::read_to_string(&wit_path).map_err(|error| {
        format!(
            "не вдалось прочитати контракт `{}`: {error}",
            wit_path.display()
        )
    })?;
    for line in source.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("package ") else {
            continue;
        };
        let identity = rest.trim_end_matches(';').trim();
        let Some((namespace, _)) = identity.split_once(':') else {
            continue;
        };
        return Ok(namespace.to_owned());
    }
    Err(format!(
        "не знайшов `package <namespace>:...;` у `{}`",
        wit_path.display()
    ))
}

/// `version = "..."` з `<crate-dir>/Cargo.toml` — той самий парсинг, що
/// `build-wasm-plugins.mjs` (`CARGO_PACKAGE_NAME_RE`) застосовує до `name`.
fn read_cargo_version(crate_dir: &Path) -> Result<String, String> {
    let cargo_toml_path = crate_dir.join("Cargo.toml");
    let source = std::fs::read_to_string(&cargo_toml_path).map_err(|error| {
        format!(
            "не вдалось прочитати `{}`: {error}",
            cargo_toml_path.display()
        )
    })?;
    for line in source.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("version") else {
            continue;
        };
        let rest = rest.trim_start();
        let Some(rest) = rest.strip_prefix('=') else {
            continue;
        };
        let value = rest.trim();
        if let Some(value) = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
            return Ok(value.to_owned());
        }
    }
    Err(format!(
        "не знайшов `version = \"...\"` у `{}`",
        cargo_toml_path.display()
    ))
}

/// Звіряє, що гість заявляє РІВНО `domains = ["lint"]` — єдиний домен, для
/// якого ця команда знає мапу entrypoints. Гучна відмова замість мовчазного
/// припущення (правило проєкту, CLAUDE.md): майбутній гість з іншим доменом
/// мусить дістати свою мапу, не успадкувати цю.
fn validate_lint_only_domain(crate_dir: &Path) -> Result<(), String> {
    let plugin_toml_path = crate_dir.join("plugin.toml");
    let source = std::fs::read_to_string(&plugin_toml_path).map_err(|error| {
        format!(
            "не вдалось прочитати `{}`: {error}",
            plugin_toml_path.display()
        )
    })?;
    for line in source.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("domains") else {
            continue;
        };
        let rest = rest.trim_start();
        let Some(rest) = rest.strip_prefix('=') else {
            continue;
        };
        let declared = rest.trim();
        let expected = format!("[\"{ONLY_SUPPORTED_DOMAIN}\"]");
        return if declared == expected {
            Ok(())
        } else {
            Err(format!(
                "`{}` заявляє `domains = {declared}`, а ця команда знає entrypoints лише для \
                 `{expected}` — додай мапу для нового домену, перш ніж embed-manifest",
                plugin_toml_path.display()
            ))
        };
    }
    Err(format!(
        "не знайшов `domains = [...]` у `{}`",
        plugin_toml_path.display()
    ))
}

/// `worlds = [...]` з кореня `plugin.toml` — та сама декларація, яку
/// anti-drift тест кожного гостя (`crates/plugin-lang-rust/src/lib.rs`,
/// секція «Крок 6 спеки §12») звіряє проти `build_manifest().worlds`, тож
/// джерело правди тут — те саме, що вже перевірене там: якщо `plugin.toml`
/// розійдеться з `describe()`, той тест впаде раніше, ніж ця команда встигне
/// вбудувати застарілий знімок.
///
/// Формат — той самий однорядковий TOML-масив рядків, що `worlds = []`/
/// `worlds = ["n-rules:caps/…@1.0.0"]` у шести чинних `plugin.toml`
/// (доккомент `[render_manifest_toml]`): парсер тут навмисно ручний
/// (той самий прийом, що [`validate_lint_only_domain`]/[`read_cargo_version`]
/// — `rules-cli` не тягне `toml`-крейт як пряму залежність лише заради
/// однієї команди), а не через `toml::Value`, тож приймає рівно ту форму,
/// яку самі автори `plugin.toml` й пишуть: список `"..."`-літералів у
/// квадратних дужках на одному рядку.
fn read_declared_worlds(crate_dir: &Path) -> Result<Vec<String>, String> {
    let plugin_toml_path = crate_dir.join("plugin.toml");
    let source = std::fs::read_to_string(&plugin_toml_path).map_err(|error| {
        format!(
            "не вдалось прочитати `{}`: {error}",
            plugin_toml_path.display()
        )
    })?;
    for line in source.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("worlds") else {
            continue;
        };
        let rest = rest.trim_start();
        let Some(rest) = rest.strip_prefix('=') else {
            continue;
        };
        let declared = rest.trim();
        let Some(inner) = declared.strip_prefix('[').and_then(|v| v.strip_suffix(']')) else {
            return Err(format!(
                "`worlds` у `{}` має бути однорядковим масивом (`worlds = [...]`), отримано: `{declared}`",
                plugin_toml_path.display()
            ));
        };
        let inner = inner.trim();
        if inner.is_empty() {
            return Ok(Vec::new());
        }
        return inner
            .split(',')
            .map(|entry| {
                let entry = entry.trim();
                entry
                    .strip_prefix('"')
                    .and_then(|v| v.strip_suffix('"'))
                    .map(str::to_owned)
                    .ok_or_else(|| {
                        format!(
                            "елемент `worlds` у `{}` має бути рядком у лапках, отримано: `{entry}`",
                            plugin_toml_path.display()
                        )
                    })
            })
            .collect();
    }
    Err(format!(
        "не знайшов `worlds = [...]` у `{}`",
        plugin_toml_path.display()
    ))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{
        cache_path_for_digest, embed_manifest_component, fetch_and_lock, publish_to_cache,
        read_cargo_version, read_declared_worlds, read_valid_cache_hit, read_world_publisher_id,
        render_manifest_toml, resolve_plugin_cache_dir, run_blocking, validate_lint_only_domain,
    };
    use crate::cli::{PluginEmbedManifestArgs, PluginFetchArgs};

    fn repo_root() -> PathBuf {
        // `crates/rules-cli` — двічі вгору до кореня workspace.
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    #[test]
    fn reads_publisher_id_from_shared_contract() {
        let crate_dir = repo_root().join("crates/plugin-lang-js");
        assert_eq!(read_world_publisher_id(&crate_dir).unwrap(), "n-rules");
    }

    #[test]
    fn reads_cargo_version_of_each_guest() {
        for crate_name in [
            "plugin-lang-js",
            "plugin-lang-python",
            "plugin-lang-rust",
            "plugin-lang-php",
            "plugin-ci-github",
            "plugin-ci-azure",
        ] {
            let crate_dir = repo_root().join("crates").join(crate_name);
            let version = read_cargo_version(&crate_dir)
                .unwrap_or_else(|error| panic!("{crate_name}: {error}"));
            assert!(!version.is_empty(), "{crate_name}: порожня версія");
        }
    }

    #[test]
    fn every_first_party_guest_declares_lint_only_domain() {
        for crate_name in [
            "plugin-lang-js",
            "plugin-lang-python",
            "plugin-lang-rust",
            "plugin-lang-php",
            "plugin-ci-github",
            "plugin-ci-azure",
        ] {
            let crate_dir = repo_root().join("crates").join(crate_name);
            validate_lint_only_domain(&crate_dir)
                .unwrap_or_else(|error| panic!("{crate_name}: {error}"));
        }
    }

    #[test]
    fn rendered_manifest_toml_parses_and_validates() {
        let worlds = vec!["n-rules:caps/file-reader@1.0.0".to_string()];
        let toml = render_manifest_toml("n-rules", "lang-js", "0.1.0", &worlds);
        let manifest = oci_dist_package::PluginManifest::from_toml(&toml).expect("валідний TOML");

        assert_eq!(manifest.package_identity(), "n-rules:lang-js");
        assert_eq!(manifest.version, "0.1.0");
        assert_eq!(manifest.entrypoints.len(), 3);
        for key in ["describe", "detect", "fix"] {
            assert_eq!(manifest.entrypoints[key].as_str(), key);
        }
        assert_eq!(
            manifest.extensions["worlds"],
            serde_json::json!(["n-rules:caps/file-reader@1.0.0"])
        );
    }

    #[test]
    fn rendered_manifest_toml_carries_empty_worlds_array() {
        let toml = render_manifest_toml("n-rules", "lang-python", "0.1.0", &[]);
        let manifest = oci_dist_package::PluginManifest::from_toml(&toml).expect("валідний TOML");

        assert_eq!(manifest.extensions["worlds"], serde_json::json!([]));
    }

    #[test]
    fn declared_worlds_of_every_guest_parse_and_are_well_formed_contract_ids() {
        // Свідомо НЕ знімок «який гість які worlds несе»: така таблиця лише
        // дублює шість `plugin.toml` і зобов'язує правити тест щоразу, коли
        // будь-яка хвиля дає гостеві новий world (саме так вона й зламалась
        // після §2.123). Що world реально працює — доводять наскрізні гейти
        // `crates/rules-plugin-host/tests/{caps_file_reader_gate,
        // surfaces_coverage_provider_*_gate}.rs`, кожен на справжньому
        // компоненті; тут лишається рівно той факт, якого більше ніде немає:
        // парсер не падає на жодному з шести, а кожен оголошений world —
        // валідний ідентифікатор контракту `ns:pkg/world@major.minor.patch`,
        // а не довільний рядок.
        let guests = [
            "plugin-lang-js",
            "plugin-lang-python",
            "plugin-lang-rust",
            "plugin-lang-php",
            "plugin-ci-github",
            "plugin-ci-azure",
        ];
        for crate_name in guests {
            let crate_dir = repo_root().join("crates").join(crate_name);
            let worlds = read_declared_worlds(&crate_dir)
                .unwrap_or_else(|error| panic!("{crate_name}: {error}"));
            for world in &worlds {
                assert!(
                    is_well_formed_world_id(world),
                    "{crate_name}: world «{world}» не має форми ns:pkg/world@major.minor.patch"
                );
            }
        }
    }

    /// Розбирає `ns:pkg/world@major.minor.patch` без regex-залежності:
    /// три сегменти імен (непорожні, лише `[a-z0-9-]`) і тричастинна
    /// числова версія.
    fn is_well_formed_world_id(world: &str) -> bool {
        let name_ok = |segment: &str| {
            !segment.is_empty()
                && segment
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        };
        let Some((path, version)) = world.split_once('@') else {
            return false;
        };
        let version_parts: Vec<&str> = version.split('.').collect();
        if version_parts.len() != 3
            || !version_parts
                .iter()
                .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
        {
            return false;
        }
        let Some((namespace, rest)) = path.split_once(':') else {
            return false;
        };
        let Some((package, name)) = rest.split_once('/') else {
            return false;
        };
        name_ok(namespace) && name_ok(package) && name_ok(name)
    }

    /// Наскрізний прогін embed-manifest на РЕАЛЬНОМУ (мінімальному)
    /// Component Model `.wasm` — той самий фікстур, що тести `oci-dist`
    /// самі використовують (`wasm_encoder::Component::new().finish()`),
    /// щоб не тягнути реальну збірку в юніт-тест.
    #[test]
    fn embeds_manifest_into_a_minimal_component() {
        let bytes = wasm_encoder::Component::new().finish();
        let dir = tempfile::tempdir().expect("temp dir");
        let component_path = dir.path().join("guest.wasm");
        std::fs::write(&component_path, &bytes).unwrap();

        let args = PluginEmbedManifestArgs {
            crate_dir: repo_root().join("crates/plugin-lang-js"),
            package: "lang-js".to_owned(),
            component: component_path.clone(),
            out: None,
        };

        let (out_path, manifest) = embed_manifest_component(&args).expect("embed succeeds");
        assert_eq!(out_path, component_path);
        assert_eq!(manifest.package_identity(), "n-rules:lang-js");

        let packaged = std::fs::read(&out_path).unwrap();
        let inspected = oci_dist_package::inspect_component(&packaged).expect("inspects");
        assert_eq!(inspected.manifest, manifest);
    }

    /// Мінімальний манiфестований компонент — той самий фікстур, що
    /// [`embeds_manifest_into_a_minimal_component`], без файлової системи
    /// (`render_manifest_toml`+`embed_manifest` напряму, без `crate_dir` з
    /// реального гостя) — тести `plugin fetch` нижче потребують лише
    /// байтів із валідною embedded-ідентичністю, не конкретного гостя.
    fn manifested_component_and_digest() -> (Vec<u8>, String) {
        let bytes = wasm_encoder::Component::new().finish();
        let toml = render_manifest_toml("n-rules", "test-plugin", "0.1.0", &[]);
        let manifest = oci_dist_package::PluginManifest::from_toml(&toml).expect("валідний TOML");
        let component = oci_dist_package::embed_manifest(&bytes, &manifest).expect("embed succeeds");
        let digest = oci_dist_package::inspect_component(&component)
            .expect("inspects")
            .release
            .digest;
        (component, digest)
    }

    #[test]
    fn cache_path_for_digest_strips_sha256_prefix_and_rejects_missing_one() {
        let root = std::path::Path::new("/cache/root");
        let path = cache_path_for_digest(root, &format!("sha256:{}", "a".repeat(64))).unwrap();
        assert_eq!(path, root.join(format!("{}.wasm", "a".repeat(64))));

        let error = cache_path_for_digest(root, "not-a-sha256-digest").unwrap_err();
        assert!(format!("{error:#}").contains("sha256:"));
    }

    #[test]
    fn publish_to_cache_and_read_valid_cache_hit_roundtrip() {
        let (component, digest) = manifested_component_and_digest();
        let dir = tempfile::tempdir().expect("temp dir");
        let cache_path = cache_path_for_digest(dir.path(), &digest).unwrap();

        // Кеш-промах до публікації.
        assert!(read_valid_cache_hit(&cache_path, &digest).is_none());

        publish_to_cache(&cache_path, &component).expect("publish succeeds");
        assert_eq!(read_valid_cache_hit(&cache_path, &digest), Some(cache_path.clone()));

        // Підмінений вміст під правильним ім'ям — ім'я саме по собі не є
        // довірою (той самий мотив, що JS-бік, доккомент `readValidCacheHit`).
        std::fs::write(&cache_path, "підмінений вміст, не справжній wasm").unwrap();
        assert!(read_valid_cache_hit(&cache_path, &digest).is_none());
    }

    #[test]
    fn resolve_plugin_cache_dir_prefers_explicit_argument() {
        let explicit = std::path::Path::new("/explicit/cache/root");
        assert_eq!(resolve_plugin_cache_dir(Some(explicit)).unwrap(), explicit);
    }

    #[test]
    fn fetch_and_lock_rejects_non_exact_requirement_without_any_network_call() {
        let dir = tempfile::tempdir().expect("temp dir");
        let args = PluginFetchArgs {
            lock: dir.path().join(".oci-dist.lock"),
            registry: "unreachable.invalid".to_owned(),
            package: "n-rules:test-plugin".to_owned(),
            requirement: "^1.0.0".to_owned(),
            cache_root: Some(dir.path().join("cache")),
        };
        let error = run_blocking(fetch_and_lock(&args)).unwrap_err();
        assert!(format!("{error:#}").contains("=X.Y.Z"));
        // Жодного lock-файлу не мало з'явитись — валідація вимоги стається
        // ДО будь-якого читання/запису lock чи мережевого виклику.
        assert!(!args.lock.exists());
    }

    /// Lock уже пінить пакет за digest'ом реального кеш-файлу — резолв
    /// мусить взяти кеш-хіт і НІКОЛИ не дійти до мережі (реєстр
    /// `unreachable.invalid` це б підтвердив падінням, якби дійшло).
    #[test]
    fn fetch_and_lock_uses_cache_hit_without_touching_the_network() {
        let (component, digest) = manifested_component_and_digest();
        let dir = tempfile::tempdir().expect("temp dir");
        let cache_root = dir.path().join("cache");
        let cache_path = cache_path_for_digest(&cache_root, &digest).unwrap();
        publish_to_cache(&cache_path, &component).unwrap();

        let lock_path = dir.path().join(".oci-dist.lock");
        let mut lock = oci_dist_oci::OciPluginLock::empty();
        lock.packages.push(oci_dist_oci::OciLockEntry {
            package: "n-rules:test-plugin".to_owned(),
            requirement: "=0.1.0".to_owned(),
            version: "0.1.0".to_owned(),
            digest: digest.clone(),
            reference: "registry.invalid/n-rules/test-plugin:0.1.0".to_owned(),
            signature: None,
        });
        lock.write(&lock_path).unwrap();

        let args = PluginFetchArgs {
            lock: lock_path,
            registry: "unreachable.invalid".to_owned(),
            package: "n-rules:test-plugin".to_owned(),
            requirement: "=0.1.0".to_owned(),
            cache_root: Some(cache_root),
        };
        let (resolved_path, cache_hit) = run_blocking(fetch_and_lock(&args)).expect("cache-hit resolve succeeds");
        assert_eq!(resolved_path, cache_path);
        assert!(cache_hit);
    }
}
