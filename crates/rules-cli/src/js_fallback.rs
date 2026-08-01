//! Транзитна делегація непортованих команд у чинний JS-entrypoint
//! (`npm/bin/n-rules.js`) — рішення В/Г мінідизайну
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`.
//!
//! Субпроцес із тим самим argv, stdio inherited, exit-код 1:1 — дзеркало
//! чинної межі JS → native у протилежний бік: делегується цілісна команда
//! верхнього рівня, тож argv-passthrough дає byte-exact поведінку за
//! конструкцією, без нового протоколу. Перелік делегованих команд
//! скорочується по зрізах фази 8.
//!
//! Резолюція entrypoint (порядок за зразком `npm/scripts/lib/native.mjs`,
//! без мовчазних fallback-ів — Р1-дисципліна):
//! 1. `N_RULES_JS_ENTRY` — явний override (dev/CI/тести);
//! 2. вгору від cwd: `node_modules/@7n/rules/bin/n-rules.js` (consumer-репо);
//! 3. вгору від cwd: `npm/bin/n-rules.js`, якщо `npm/package.json` поруч
//!    оголошує `"name": "@7n/rules"` (dev-репо самого пакета);
//! 4. hard error з підказкою.
//!
//! Runtime: `N_RULES_JS_RUNTIME` (тести/примус) → `bun` (канон репо) →
//! `node` (bun відсутній у PATH) → hard error.

use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

/// Відносний шлях entrypoint у встановленому пакеті (consumer-репо).
const INSTALLED_ENTRY: &str = "node_modules/@7n/rules/bin/n-rules.js";
/// Відносний шлях entrypoint у dev-репо самого пакета.
const DEV_ENTRY: &str = "npm/bin/n-rules.js";
/// Ім'я npm-пакета — маркер dev-репо в `npm/package.json`.
const PACKAGE_NAME: &str = "@7n/rules";

/// Чи `npm/package.json` у `root` оголошує пакет `@7n/rules` (маркер
/// dev-репо; захист від чужих `npm/bin/n-rules.js` у сторонніх layout).
fn is_dev_repo(root: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(root.join("npm/package.json")) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|pkg| pkg.get("name").and_then(|n| n.as_str().map(String::from)))
        .is_some_and(|name| name == PACKAGE_NAME)
}

/// Резолвить шлях до JS-entrypoint (порядок — доккомент модуля).
fn resolve_entry(cwd: &Path) -> Result<PathBuf, String> {
    if let Ok(entry) = std::env::var("N_RULES_JS_ENTRY") {
        if !entry.is_empty() {
            return Ok(PathBuf::from(entry));
        }
    }
    for dir in cwd.ancestors() {
        let installed = dir.join(INSTALLED_ENTRY);
        if installed.is_file() {
            return Ok(installed);
        }
        let dev = dir.join(DEV_ENTRY);
        if dev.is_file() && is_dev_repo(dir) {
            return Ok(dev);
        }
    }
    Err(format!(
        "rules-cli: не знайдено JS-entrypoint @7n/rules для делегації команди. \
         Постав N_RULES_JS_ENTRY=/шлях/до/n-rules.js, або запусти з репозиторію, \
         де встановлено {PACKAGE_NAME} (є {INSTALLED_ENTRY})."
    ))
}

/// Корінь установленого пакета `@7n/rules` — каталог, у якому лежать
/// `skills/`, `rules/`, `scripts/`. Резолвиться через той самий каскад, що й
/// entrypoint ([`resolve_entry`]), бо entrypoint завжди `<root>/bin/n-rules.js`
/// — це Rust-відповідник `resolveBundledPackageRoot`
/// (`npm/scripts/skills-cli.mjs`), який теж рахує корінь від розташування
/// власного модуля, а не від cwd. Потрібен native-командам, що читають
/// РЕСУРСИ пакета (наразі `skill list`).
pub fn package_root(cwd: &Path) -> Result<PathBuf, String> {
    let entry = resolve_entry(cwd)?;
    entry
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            format!(
                "rules-cli: не вдалося визначити корінь пакета {PACKAGE_NAME} зі шляху \
                 entrypoint «{}» (очікується <корінь>/bin/n-rules.js).",
                entry.display()
            )
        })
}

/// Запускає entrypoint заданим runtime; stdio успадковується (дефолт
/// `Command::status`), argv передається без змін.
fn spawn_status(
    runtime: &str,
    entry: &Path,
    args: &[String],
) -> io::Result<std::process::ExitStatus> {
    Command::new(runtime).arg(entry).args(args).status()
}

/// Делегує команду в JS-entrypoint і повертає його exit-код (сигнальне
/// завершення без коду → 1). Порядок runtime — доккомент модуля.
pub fn delegate(args: &[String]) -> ExitCode {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let entry = match resolve_entry(&cwd) {
        Ok(entry) => entry,
        Err(message) => {
            eprintln!("❌ {message}");
            return ExitCode::FAILURE;
        }
    };

    let forced_runtime = std::env::var("N_RULES_JS_RUNTIME")
        .ok()
        .filter(|v| !v.is_empty());
    let runtimes: Vec<String> = match forced_runtime {
        Some(runtime) => vec![runtime],
        None => vec!["bun".to_string(), "node".to_string()],
    };

    for (i, runtime) in runtimes.iter().enumerate() {
        match spawn_status(runtime, &entry, args) {
            Ok(status) => {
                return match status.code() {
                    Some(code) => ExitCode::from(u8::try_from(code.clamp(0, 255)).unwrap_or(1)),
                    None => ExitCode::FAILURE,
                };
            }
            // Runtime відсутній у PATH — пробуємо наступний; інші помилки
            // spawn (права, зламаний бінар) — одразу назовні.
            Err(error) if error.kind() == io::ErrorKind::NotFound && i + 1 < runtimes.len() => {}
            Err(error) => {
                eprintln!("❌ rules-cli: не вдалося запустити {runtime} для делегації: {error}");
                return ExitCode::FAILURE;
            }
        }
    }
    eprintln!(
        "❌ rules-cli: ані bun, ані node не знайдено в PATH — делегація JS-команди неможлива. \
         Установи bun (канон репо) або постав N_RULES_JS_RUNTIME."
    );
    ExitCode::FAILURE
}
