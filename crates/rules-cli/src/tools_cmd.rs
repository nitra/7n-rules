//! cspell:ignore рантаймом непортованим kubekonform тулах
//!
//! `n-rules tools list` / `n-rules tools ensure` — інвентар і добування
//! зовнішніх CLI-тулів (мінідизайн
//! `docs/specs/2026-08-04-tools-ensure-design.md`).
//!
//! # Навіщо команда існує
//!
//! Native-концерни, що спавнять зовнішній тул, лінт-рантаймом його НЕ
//! встановлюють: `rules-core` лишається офлайновим ядром і при відсутньому
//! тулі падає fail-closed з install-підказкою (`k8s/kubeconform`, PR #378).
//! Компенсація за домовленістю — ця команда: добування стає ЯВНИМ кроком, а
//! не побічним ефектом перевірки.
//!
//! # Розподіл роботи між Rust і JS
//!
//! - резолв (PATH → керований кеш) — нативно (`rules_core::tool_resolve`);
//! - `brew`/`scoop` — нативно (звичайний спавн пакетного менеджера);
//! - GitHub Release (Linux завжди, Windows як fallback) — **делегується** в
//!   чинний `ensureToolAsync` через зворотний міст ([`crate::bridge`],
//!   операція `ensureTool`). Причина — розділ 4 мінідизайну: писати другу
//!   реалізацію завантаження+розпакування, поки перша все одно потрібна
//!   непортованим JS-споживачам, означало б тримати їх синхронними вручну.
//!
//! # Лок
//!
//! Нативний install іде під тим самим міжпроцесним локом, що бере JS
//! ([`crate::tool_lock`]). Делегований — НЕ бере: лок там візьме сам
//! `ensureToolAsync`, а вкладення дало б самоблокування (доккомент
//! [`crate::tool_lock`]).

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use rules_core::tool_registry::{self, ToolEntry};
use rules_core::tool_resolve::resolve_provisioned_tool;
use serde_json::json;

use crate::bridge::Bridge;
use crate::cli::{ToolsEnsureArgs, ToolsListArgs};

/// Usage-помилка (невідомий тул) — той самий код `2`, що й у `lint` для «не
/// змогли навіть спробувати», і що ним відповідає роутер на невідому
/// підкоманду/прапорець (`crate::describe_parse_error`).
const EXIT_USAGE: u8 = 2;

/// Щось відсутнє (`--check`) або install не вдався.
const EXIT_MISSING: u8 = 1;

/// Спосіб встановлення тула на поточній ОС.
#[derive(Debug, PartialEq, Eq)]
enum Route<'a> {
    /// macOS: `brew install <формула>`.
    Brew(&'a str),
    /// Windows: `scoop install <пакет>`.
    Scoop(&'a str),
    /// Linux (і Windows без scoop-manifest-а): GitHub Release, `owner/repo`.
    Github(&'a str),
}

impl Route<'_> {
    /// Людський опис маршруту — те, що показує `list` і `--check`.
    fn describe(&self) -> String {
        match self {
            Route::Brew(formula) => format!("brew install {formula}"),
            Route::Scoop(package) => format!("scoop install {package}"),
            Route::Github(repo) => format!("https://github.com/{repo}/releases"),
        }
    }
}

/// Маршрут для поточної ОС — порт гілок `autoInstall` (`ensure-tool.mjs`):
/// macOS → brew, Windows → scoop (а без manifest-а — GitHub), решта → GitHub.
fn route_for(entry: &ToolEntry) -> Route<'_> {
    if cfg!(target_os = "macos") {
        return Route::Brew(&entry.brew);
    }
    if cfg!(windows) {
        return match entry.scoop.as_deref() {
            Some(package) => Route::Scoop(package),
            None => Route::Github(&entry.github),
        };
    }
    Route::Github(&entry.github)
}

/// Стан одного тула на цій машині.
struct ToolState {
    id: &'static str,
    version: Option<&'static str>,
    path: Option<PathBuf>,
}

/// Збирає стан переданих тулів (резолв PATH → керований кеш, без мутацій).
fn collect_states(ids: &[&'static str]) -> Vec<ToolState> {
    ids.iter()
        .map(|id| ToolState {
            id,
            version: tool_registry::pinned_version(id),
            path: resolve_provisioned_tool(id),
        })
        .collect()
}

/// Валідує перелік імен тулів проти реєстру; порожній перелік = всі тули.
fn resolve_targets(names: &[String]) -> Result<Vec<&'static str>, String> {
    let known = tool_registry::tool_ids();
    if names.is_empty() {
        return Ok(known);
    }
    let mut out = Vec::with_capacity(names.len());
    for name in names {
        match known.iter().find(|id| *id == name) {
            Some(id) => out.push(*id),
            None => {
                return Err(format!(
                    "невідомий тул «{name}». Відомі: {}",
                    known.join(", ")
                ))
            }
        }
    }
    Ok(out)
}

/// Машинна форма `tools list --json` — вона ж предмет крос-мовного
/// parity-тесту (`tools-registry-parity.test.mjs`), тому містить ВЕСЬ запис
/// реєстру, включно з розгорнутими для поточної архітектури `asset`/`binPath`
/// і зібраним `downloadUrl`: інакше збіг `mapArch` обох мов лишався б
/// неперевіреним.
fn list_json(states: &[ToolState]) -> String {
    let tools: Vec<serde_json::Value> = states
        .iter()
        .map(|state| {
            let entry = tool_registry::entry(state.id).expect("тул зі списку реєстру");
            let rendered = state.version.map(|ver| {
                json!({
                    "asset": entry.asset(ver),
                    "binPath": entry.bin_path(ver),
                    "downloadUrl": entry.download_url(ver),
                })
            });
            json!({
                "id": state.id,
                "version": state.version,
                "present": state.path.is_some(),
                "path": state.path.as_ref().map(|p| p.to_string_lossy()),
                "route": route_for(entry).describe(),
                "entry": {
                    "brew": entry.brew,
                    "scoop": entry.scoop,
                    "github": entry.github,
                    "archStyle": entry.arch_style,
                    "archive": entry.archive,
                    "tagPrefix": entry.tag_prefix,
                },
                "rendered": rendered,
            })
        })
        .collect();
    format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({ "tools": tools }))
            .expect("серіалізація власного JSON не падає")
    )
}

/// Людська форма `tools list` — вирівняні колонки «стан · тул · пін · шлях
/// або маршрут».
fn list_text(states: &[ToolState]) -> String {
    let id_width = states.iter().map(|s| s.id.len()).max().unwrap_or(0);
    let version_width = states
        .iter()
        .map(|s| s.version.unwrap_or("—").len())
        .max()
        .unwrap_or(0);
    let mut out = format!("Зовнішні CLI-тули @7n/rules — {}:\n", states.len());
    for state in states {
        let entry = tool_registry::entry(state.id).expect("тул зі списку реєстру");
        let (mark, tail) = match &state.path {
            Some(path) => ("✓", path.to_string_lossy().into_owned()),
            None => ("✗", format!("немає · {}", route_for(entry).describe())),
        };
        out.push_str(&format!(
            "  {mark} {:id_width$}  {:version_width$}  {tail}\n",
            state.id,
            state.version.unwrap_or("—"),
        ));
    }
    out
}

/// `tools list [--json]`.
pub fn run_list(parsed: &ToolsListArgs) -> ExitCode {
    let states = collect_states(&tool_registry::tool_ids());
    print!(
        "{}",
        if parsed.json {
            list_json(&states)
        } else {
            list_text(&states)
        }
    );
    ExitCode::SUCCESS
}

/// Лінива обгортка мосту: піднімається щонайбільше раз на прогін команди і
/// лише якщо реально дійшло до делегованого install.
struct LazyBridge {
    package_root: PathBuf,
    bridge: Option<Bridge>,
}

impl LazyBridge {
    /// Делегує добування тула JS-боку (`ensureToolAsync`) і повертає шлях до
    /// готового бінарника.
    fn ensure(&mut self, tool_id: &str) -> Result<PathBuf, String> {
        if self.bridge.is_none() {
            // `N_CURSOR_NO_AUTO_INSTALL` знімається саме для цього дочірнього
            // процесу: змінна означає «не став нічого за моєю спиною», а
            // `tools ensure` — прямий запит користувача (розділ 7 мінідизайну).
            self.bridge = Some(Bridge::start_with_env(
                &self.package_root,
                &[("N_CURSOR_NO_AUTO_INSTALL", None)],
            )?);
        }
        let bridge = self.bridge.as_mut().expect("міст щойно піднято");
        let result = bridge.call("ensureTool", json!({ "toolId": tool_id }))?;
        result
            .get("path")
            .and_then(|value| value.as_str())
            .map(PathBuf::from)
            .ok_or_else(|| format!("міст не повернув шлях до {tool_id}"))
    }
}

/// Спавнить пакетний менеджер (`brew`/`scoop`) з успадкованим stdio — вивід
/// менеджера користувач бачить дослівно, як і в JS (`stdio: 'inherit'`).
fn run_package_manager(manager: &str, package: &str, tool_id: &str) -> Result<(), String> {
    let Some(bin) = rules_core::tool_resolve::resolve_cmd(manager) else {
        let site = if manager == "brew" {
            "https://brew.sh"
        } else {
            "https://scoop.sh"
        };
        return Err(format!(
            "{manager} не знайдено в PATH. Встанови {manager}: {site}"
        ));
    };
    let status = Command::new(bin)
        .arg("install")
        .arg(package)
        .status()
        .map_err(|error| format!("{manager} install {tool_id} не запустився: {error}"))?;
    if !status.success() {
        return Err(format!(
            "{manager} install {tool_id} завершився з кодом {}",
            status.code().unwrap_or(-1)
        ));
    }
    Ok(())
}

/// Нативний install під міжпроцесним локом. Після взяття лока кеш
/// перевіряється ПОВТОРНО — інший процес міг встановити тул, поки ми чекали
/// (та сама послідовність, що в `installWithCrossProcessLock`).
fn install_natively(
    tool_id: &'static str,
    manager: &str,
    package: &str,
    cwd: &Path,
) -> Result<PathBuf, String> {
    let _lock = crate::tool_lock::acquire(&format!("ensure-tool/{tool_id}"), cwd)?;
    if let Some(path) = resolve_provisioned_tool(tool_id) {
        return Ok(path);
    }
    run_package_manager(manager, package, tool_id)?;
    resolve_provisioned_tool(tool_id)
        .ok_or_else(|| format!("{tool_id} не знайдено в PATH після {manager} install"))
}

/// Встановлює один тул відповідно до маршруту поточної ОС.
///
/// Windows-гілка дзеркалить `try/catch` JS-версії: збій scoop (немає самого
/// scoop, немає manifest-а, впав install) НЕ фатальний — робота падає на
/// GitHub Release fallback.
fn install(tool_id: &'static str, cwd: &Path, bridge: &mut LazyBridge) -> Result<PathBuf, String> {
    let entry = tool_registry::entry(tool_id).expect("тул зі списку реєстру");
    match route_for(entry) {
        Route::Brew(formula) => install_natively(tool_id, "brew", formula, cwd),
        Route::Scoop(package) => match install_natively(tool_id, "scoop", package, cwd) {
            Ok(path) => Ok(path),
            Err(error) => {
                eprintln!("⚠️ {tool_id}: scoop не спрацював ({error}) — пробую GitHub Release");
                bridge.ensure(tool_id)
            }
        },
        Route::Github(_) => bridge.ensure(tool_id),
    }
}

/// `tools ensure [<tool>…] [--check]`.
pub fn run_ensure(parsed: &ToolsEnsureArgs) -> ExitCode {
    let targets = match resolve_targets(&parsed.names) {
        Ok(targets) => targets,
        Err(message) => {
            eprintln!("❌ tools ensure: {message}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let package_root = crate::js_fallback::package_root(&cwd);
    let mut bridge = LazyBridge {
        // Корінь пакета потрібен лише делегованому шляху — його відсутність
        // тут ще не помилка (brew/scoop працюють і без нього), тому вона
        // «дозріває» до помилки в момент реальної делегації.
        package_root: package_root.clone().unwrap_or_default(),
        bridge: None,
    };

    let mut failed = 0_usize;
    for state in collect_states(&targets) {
        let entry = tool_registry::entry(state.id).expect("тул зі списку реєстру");
        if let Some(path) = state.path {
            println!("✓ {} — уже є: {}", state.id, path.display());
            continue;
        }
        if parsed.check {
            failed += 1;
            println!(
                "✗ {} — не встановлено · {}",
                state.id,
                route_for(entry).describe()
            );
            continue;
        }
        println!(
            "⬇️ {} — встановлюю ({})…",
            state.id,
            route_for(entry).describe()
        );
        // Делегований шлях без резолвленого кореня пакета не злетить — краще
        // сказати це прямо тут, ніж чекати на помилку старту мосту.
        if let (Route::Github(_), Err(message)) = (route_for(entry), &package_root) {
            failed += 1;
            eprintln!("❌ {}: {message}", state.id);
            continue;
        }
        match install(state.id, &cwd, &mut bridge) {
            Ok(path) => println!("✓ {} — встановлено: {}", state.id, path.display()),
            Err(error) => {
                failed += 1;
                eprintln!("❌ {} — install не вдався: {error}", state.id);
            }
        }
    }

    if failed == 0 {
        return ExitCode::SUCCESS;
    }
    if parsed.check {
        eprintln!(
            "❌ бракує {failed} з {} тулів — запусти `n-rules tools ensure` без --check",
            targets.len()
        );
    }
    ExitCode::from(EXIT_MISSING)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Порожній перелік = всі тули реєстру; названі — саме вони й у тому
    /// порядку, як просили.
    #[test]
    fn targets_default_to_whole_registry() {
        assert_eq!(resolve_targets(&[]).unwrap(), tool_registry::tool_ids());
        assert_eq!(
            resolve_targets(&["opa".to_string(), "hk".to_string()]).unwrap(),
            vec!["opa", "hk"]
        );
    }

    /// Невідомий тул — usage-помилка з переліком відомих, а не мовчазний
    /// пропуск (мовчазний означав би «нічого не бракує» на друкарській
    /// помилці в CI-кроці).
    #[test]
    fn unknown_tool_is_rejected_with_known_list() {
        let error = resolve_targets(&["kubekonform".to_string()]).unwrap_err();
        assert!(error.contains("kubekonform"), "{error}");
        assert!(error.contains("kubeconform"), "{error}");
    }

    /// Маршрут відповідає ОС збірки й підказує РЕАЛЬНУ команду.
    #[test]
    fn route_matches_current_os() {
        let hk = tool_registry::entry("hk").unwrap();
        let route = route_for(hk);
        if cfg!(target_os = "macos") {
            assert_eq!(route, Route::Brew("hk"));
            assert_eq!(route.describe(), "brew install hk");
        } else if cfg!(windows) {
            assert_eq!(route, Route::Scoop("hk"));
        } else {
            assert_eq!(route, Route::Github("jdx/hk"));
            assert!(route.describe().contains("github.com/jdx/hk"));
        }
    }

    /// Тул без scoop-manifest-а на Windows іде GitHub-маршрутом; на решті
    /// платформ маршрут той самий, що й у решти тулів.
    #[test]
    fn tool_without_scoop_manifest_falls_back_to_github() {
        let regal = tool_registry::entry("regal").unwrap();
        if cfg!(windows) {
            assert_eq!(route_for(regal), Route::Github("StyraInc/regal"));
        } else if cfg!(target_os = "macos") {
            assert_eq!(route_for(regal), Route::Brew("regal"));
        } else {
            assert_eq!(route_for(regal), Route::Github("StyraInc/regal"));
        }
    }

    /// JSON-форма містить усі поля запису й розгорнуті шаблони — саме те, що
    /// звіряє крос-мовний parity-тест.
    #[test]
    fn json_form_carries_full_entry() {
        let states = collect_states(&["shellcheck"]);
        let value: serde_json::Value = serde_json::from_str(&list_json(&states)).unwrap();
        let tool = &value["tools"][0];
        assert_eq!(tool["id"], "shellcheck");
        assert_eq!(tool["entry"]["github"], "koalaman/shellcheck");
        assert_eq!(tool["entry"]["archive"], true);
        assert!(tool["rendered"]["asset"]
            .as_str()
            .unwrap()
            .starts_with("shellcheck-v"));
        assert!(tool["rendered"]["binPath"]
            .as_str()
            .unwrap()
            .ends_with("/shellcheck"));
    }

    /// Текстова форма показує стан кожного тула рядком і не падає на тулах,
    /// яких на машині немає.
    #[test]
    fn text_form_lists_every_tool() {
        let ids = tool_registry::tool_ids();
        let text = list_text(&collect_states(&ids));
        for id in &ids {
            assert!(text.contains(id), "у виводі немає {id}:\n{text}");
        }
        assert!(text.lines().count() == ids.len() + 1);
    }
}
