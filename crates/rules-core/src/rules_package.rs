//! Резолв кореня встановленого пакета `@7n/rules` — тобто каталогу, у якому
//! лежать РЕСУРСИ пакета (`rules/`, `scripts/`, `skills/`). Потрібен
//! native-концернам, які читають вбудовані rego-полісі: JS-канон бере їх від
//! `import.meta.url` (`PACKAGE_ROOT` у `npm/scripts/lib/run-conftest-batch.mjs:30`),
//! а native-код розташування власного модуля не знає — ані `current_exe`
//! (для napi-аддона це `node`/`bun`), ані шляху `.dylib`.
//!
//! # Каскад
//!
//! 1. `N_RULES_PACKAGE_ROOT` — явний override (тести, нестандартні layout-и);
//! 2. вгору від `cwd`: `node_modules/@7n/rules/package.json` — consumer-репо
//!    (саме звідти й завантажився аддон, тож пакет там гарантовано є);
//! 3. вгору від `cwd`: `npm/package.json`, що оголошує `"name": "@7n/rules"` —
//!    dev-репо самого пакета;
//! 4. `None` — викликач падає fail-closed із підказкою про override.
//!
//! Кроки 2–3 — той самий каскад, що вже прийнятий у репо для тієї ж задачі на
//! боці CLI (`crates/rules-cli/src/js_fallback.rs::package_root`, доккомент
//! там-таки: «Потрібен native-командам, що читають РЕСУРСИ пакета»). Різниця
//! у якорі: там шукається сам entrypoint `bin/n-rules.js` і корінь рахується
//! від нього, тут — маркер-`package.json`, бо концернам entrypoint не
//! потрібен взагалі. Спільний модуль з `rules-cli` тут навмисно не заводиться:
//! напрямок залежності `rules-cli` → `rules-core`, тож зведення відбудеться
//! на боці CLI (перейде на цей резолвер), а не навпаки.
//!
//! # Чому НЕ `N_RULES_RULES_DIR`
//!
//! `N_RULES_RULES_DIR` — тестовий seam **discovery** (який каталог правил
//! сканувати), і JS-канон його для rego-шляху не читає: `runConftestBatch`
//! завжди резолвить полісі від кореня встановленого пакета, незалежно від
//! `opts.rulesDir`. Дзеркалимо цей поділ буквально — інакше синтетичний
//! rules-каталог parity-тестів мовчки змінив би ще й джерело rego.

use std::path::{Path, PathBuf};

/// Ім'я npm-пакета — маркер у `package.json`.
const PACKAGE_NAME: &str = "@7n/rules";

/// Відносний шлях пакета у consumer-репо.
const INSTALLED_REL: &str = "node_modules/@7n/rules";

/// Каталог пакета в dev-репо самого `@7n/rules`.
const DEV_REL: &str = "npm";

/// Змінна явного override.
const ENV_OVERRIDE: &str = "N_RULES_PACKAGE_ROOT";

/// Чи `dir/package.json` оголошує `"name": "@7n/rules"`.
fn declares_package(dir: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(dir.join("package.json")) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|pkg| {
            pkg.get("name")
                .and_then(serde_json::Value::as_str)
                .map(String::from)
        })
        .is_some_and(|name| name == PACKAGE_NAME)
}

/// Корінь пакета `@7n/rules` за каскадом із доккоменту модуля.
pub fn package_root(cwd: &Path) -> Option<PathBuf> {
    if let Ok(override_dir) = std::env::var(ENV_OVERRIDE) {
        if !override_dir.is_empty() {
            return Some(PathBuf::from(override_dir));
        }
    }
    package_root_from_tree(cwd)
}

/// Кроки 2–3 каскаду без читання оточення — «чисте» ядро для тестів
/// (мутувати процес-глобальний `N_RULES_PACKAGE_ROOT` у паралельному
/// тест-процесі не можна: змінну читають інші тести цього ж модуля).
fn package_root_from_tree(cwd: &Path) -> Option<PathBuf> {
    for dir in cwd.ancestors() {
        let installed = dir.join(INSTALLED_REL);
        if declares_package(&installed) {
            return Some(installed);
        }
        let dev = dir.join(DEV_REL);
        if declares_package(&dev) {
            return Some(dev);
        }
    }
    None
}

/// Каталог вбудованих правил (`<корінь пакета>/rules`) — Rust-відповідник
/// `RULES_ROOT` (`run-conftest-batch.mjs:33`).
pub fn rules_root(cwd: &Path) -> Option<PathBuf> {
    package_root(cwd).map(|root| root.join("rules"))
}

/// Текст fail-closed помилки, коли корінь пакета не резолвиться. Окремо від
/// [`package_root`], щоб кожен викликач не переписував підказку своїми
/// словами.
pub fn missing_package_root_hint() -> String {
    format!(
        "не вдалося знайти корінь пакета {PACKAGE_NAME} (ні {INSTALLED_REL}/, ні {DEV_REL}/ \
         з відповідним package.json вище за робочим каталогом).\n   \
         Постав {ENV_OVERRIDE}=/шлях/до/@7n/rules, якщо layout нестандартний."
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Створює `dir/package.json` із заданим іменем пакета.
    fn write_package_json(dir: &Path, name: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("package.json"),
            format!("{{ \"name\": \"{name}\" }}\n"),
        )
        .unwrap();
    }

    /// Consumer-репо: пакет під `node_modules/@7n/rules` знаходиться навіть із
    /// вкладеного підкаталогу (обхід угору по предках).
    #[test]
    fn finds_installed_package_from_nested_cwd() {
        let tmp = TempDir::new().unwrap();
        let pkg = tmp.path().join(INSTALLED_REL);
        write_package_json(&pkg, PACKAGE_NAME);
        let nested = tmp.path().join("apps").join("web");
        fs::create_dir_all(&nested).unwrap();

        assert_eq!(package_root_from_tree(&nested), Some(pkg));
    }

    /// Dev-репо самого пакета: корінь — `npm/`.
    #[test]
    fn finds_dev_repo_package() {
        let tmp = TempDir::new().unwrap();
        let pkg = tmp.path().join(DEV_REL);
        write_package_json(&pkg, PACKAGE_NAME);

        assert_eq!(package_root_from_tree(tmp.path()), Some(pkg));
    }

    /// Чужий `npm/package.json` (інше ім'я) — не збіг: маркер саме `@7n/rules`,
    /// інакше будь-який моно-репо з текою `npm/` дав би хибний корінь.
    #[test]
    fn foreign_npm_dir_is_not_a_match() {
        let tmp = TempDir::new().unwrap();
        write_package_json(&tmp.path().join(DEV_REL), "@acme/other");

        assert_eq!(package_root_from_tree(tmp.path()), None);
    }

    /// Встановлений пакет виграє над dev-каталогом на тому самому рівні —
    /// той самий порядок кроків, що в `js_fallback::resolve_entry`.
    #[test]
    fn installed_package_wins_over_dev_dir() {
        let tmp = TempDir::new().unwrap();
        write_package_json(&tmp.path().join(INSTALLED_REL), PACKAGE_NAME);
        write_package_json(&tmp.path().join(DEV_REL), PACKAGE_NAME);

        assert_eq!(
            package_root_from_tree(tmp.path()),
            Some(tmp.path().join(INSTALLED_REL))
        );
    }

    /// Порожнє дерево → `None` (сигнал «падай fail-closed із підказкою»).
    #[test]
    fn empty_tree_resolves_to_none() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(package_root_from_tree(tmp.path()), None);
    }

    /// Битий `package.json` не валить резолв — просто не збіг.
    #[test]
    fn malformed_package_json_is_not_a_match() {
        let tmp = TempDir::new().unwrap();
        let pkg = tmp.path().join(DEV_REL);
        fs::create_dir_all(&pkg).unwrap();
        fs::write(pkg.join("package.json"), "{ not json").unwrap();

        assert_eq!(package_root_from_tree(tmp.path()), None);
    }

    /// Підказка називає і змінну-override, і обидва очікувані layout-и —
    /// це той мінімум, за яким повідомлення лишається дієвим.
    #[test]
    fn hint_names_override_and_layouts() {
        let hint = missing_package_root_hint();
        assert!(hint.contains(ENV_OVERRIDE), "{hint}");
        assert!(hint.contains(INSTALLED_REL), "{hint}");
        assert!(hint.contains(PACKAGE_NAME), "{hint}");
    }
}
