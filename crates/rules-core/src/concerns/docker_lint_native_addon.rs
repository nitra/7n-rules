//! Портований зріз концерну `docker/lint` — антипатерн «нативний
//! `.node`-аддон (sharp/@img/argon2) + `bun build --compile`».
//!
//! 1:1 порт `npm/rules/docker/lib/docker-native-addon.mjs` (93 рядки).
//! Репо-широкий греп (`grep -rn "docker-native-addon" npm/ plugins/
//! scripts/ crates/`) підтверджує єдиного споживача — `docker/lint`
//! (`main.mjs:6`, `import { getNativeAddonDeps, getNativeAddonNoCompileHint
//! } from '../lib/docker-native-addon.mjs'`) плюс власний тест-файл
//! (`docker-native-addon.test.mjs`) — тож увесь модуль переїжджає без
//! JS-копії, що лишається.
//!
//! Чиста логіка (рядки + JSON-форма `dependencies`) без I/O — нема каналу
//! помилок, який треба обирати.

use std::sync::LazyLock;

use regex::Regex;

/// Точні імена нативних `.node`-аддонів — копія `NATIVE_ADDON_PACKAGES`
/// (`docker-native-addon.mjs:27`).
const NATIVE_ADDON_PACKAGES: [&str; 2] = ["sharp", "argon2"];

/// Scope-префікси нативних аддонів — копія `NATIVE_ADDON_SCOPES`
/// (`docker-native-addon.mjs:33`).
const NATIVE_ADDON_SCOPES: [&str; 1] = ["@img/"];

static BUN_BUILD_COMPILE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bbun\s+build\b[^\n]*\s--compile\b").unwrap());
static APK_ADD_VIPS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bapk\s+add\b[^\n]*\bvips\b").unwrap());

/// Чи ім'я пакета — нативний `.node`-аддон зі списку — точний порт
/// `isNativeAddonPackage` (`docker-native-addon.mjs:43-46`).
fn is_native_addon_package(name: &str) -> bool {
    NATIVE_ADDON_PACKAGES.contains(&name)
        || NATIVE_ADDON_SCOPES
            .iter()
            .any(|scope| name.starts_with(scope))
}

/// Повертає імена нативних аддонів, наявних у `dependencies` — точний порт
/// `getNativeAddonDeps` (`docker-native-addon.mjs:53-58`).
///
/// `dependencies` тут — те саме `unknown`, що й у JS: `package.json`
/// парситься в `serde_json::Value` без наперед відомої форми, тож перевірка
/// «є обʼєкт, не масив» — `Value::as_object()` (повертає `None` і для
/// `Null`/`Array`/`String`/`Number`/`Bool`, точно як `typeof !== 'object' ||
/// Array.isArray`).
pub(super) fn get_native_addon_deps(dependencies: &serde_json::Value) -> Vec<String> {
    let Some(obj) = dependencies.as_object() else {
        return Vec::new();
    };
    let mut out: Vec<String> = obj
        .keys()
        .filter(|name| is_native_addon_package(name))
        .cloned()
        .collect();
    out.sort();
    out
}

/// Перевіряє антипатерн «нативний аддон + `bun build --compile`» — точний
/// порт `getNativeAddonNoCompileHint` (`docker-native-addon.mjs:73-93`).
pub(super) fn get_native_addon_no_compile_hint(
    file_content: &str,
    native_addons: &[String],
) -> Option<String> {
    if native_addons.is_empty() {
        return None;
    }
    if !BUN_BUILD_COMPILE_RE.is_match(file_content) {
        return None;
    }

    let mut problems = vec![format!(
        "проєкт залежить від нативного .node-аддона ({}) з динамічним require — \
         `bun build --compile` не вшиває нативний біндинг, тож бінарник падає в рантаймі. \
         Прибери compile-крок: ship node_modules + `bun <entry>` на базі mirror.gcr.io/oven/bun:alpine \
         (docker.mdc: компіляція). Entry бери з наявного --outfile-таргета / package.json#main / \
         scripts.start; якщо не визначити — лиши TODO-маркер, не вгадуй",
        native_addons.join(", ")
    )];

    if APK_ADD_VIPS_RE.is_match(file_content) {
        problems.push(
            "зайвий `apk add ... vips` — системний libvips не лікує брак `sharp.node`; прибери разом із compile-кроком"
                .to_string(),
        );
    }

    Some(problems.join("\n     - "))
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- NATIVE_ADDON_* / isNativeAddonPackage (docker-native-addon.test.mjs) ---

    #[test]
    fn native_addon_packages_contain_sharp_and_argon2() {
        assert!(is_native_addon_package("sharp"));
        assert!(is_native_addon_package("argon2"));
    }

    #[test]
    fn native_addon_scope_prefix_matches() {
        assert!(is_native_addon_package("@img/sharp-linuxmusl-arm64"));
    }

    #[test]
    fn ordinary_package_is_not_native_addon() {
        assert!(!is_native_addon_package("express"));
        assert!(!is_native_addon_package("sharpen"));
    }

    // --- getNativeAddonDeps ---

    #[test]
    fn native_addon_deps_returns_sorted_found_addons() {
        let deps = serde_json::json!({
            "sharp": "^0.34.5",
            "express": "^4",
            "@img/sharp-darwin-arm64": "1"
        });
        assert_eq!(
            get_native_addon_deps(&deps),
            vec!["@img/sharp-darwin-arm64".to_string(), "sharp".to_string()]
        );
    }

    #[test]
    fn native_addon_deps_none_found_is_empty() {
        let deps = serde_json::json!({ "express": "^4", "pino": "^9" });
        assert!(get_native_addon_deps(&deps).is_empty());
    }

    #[test]
    fn native_addon_deps_invalid_input_is_empty() {
        assert!(get_native_addon_deps(&serde_json::Value::Null).is_empty());
        assert!(get_native_addon_deps(&serde_json::json!(["sharp"])).is_empty());
        assert!(get_native_addon_deps(&serde_json::json!("sharp")).is_empty());
    }

    // --- getNativeAddonNoCompileHint ---

    const COMPILE_DOCKERFILE: &str = "FROM mirror.gcr.io/oven/bun:alpine AS build-env\n\
RUN bun install --production\n\
RUN bun build --compile --outfile app ./src/index.js\n\
FROM mirror.gcr.io/library/alpine:latest\n\
RUN apk add --no-cache libstdc++ libgcc vips tzdata\n\
COPY --from=build-env --chown=app:app /app/app ./app\n\
USER app\n\
CMD [\"./app\"]";

    #[test]
    fn no_compile_hint_flags_native_addon_with_compile() {
        let h =
            get_native_addon_no_compile_hint(COMPILE_DOCKERFILE, &["sharp".to_string()]).unwrap();
        assert!(h.contains("нативного .node-аддона (sharp)"));
        assert!(h.contains("bun <entry>"));
        assert!(h.contains("mirror.gcr.io/oven/bun:alpine"));
    }

    #[test]
    fn no_compile_hint_also_flags_extra_apk_vips() {
        let h =
            get_native_addon_no_compile_hint(COMPILE_DOCKERFILE, &["sharp".to_string()]).unwrap();
        assert!(h.contains("vips"));
        assert!(h.contains("sharp.node"));
    }

    #[test]
    fn no_compile_hint_ok_for_canon_without_compile() {
        let canon = "FROM mirror.gcr.io/oven/bun:alpine AS build-env\n\
RUN bun install --production\n\
FROM mirror.gcr.io/oven/bun:alpine\n\
COPY --from=build-env --chown=bun:bun /app/node_modules ./node_modules\n\
USER bun\n\
CMD [\"bun\", \"src/index.js\"]";
        assert_eq!(
            get_native_addon_no_compile_hint(canon, &["sharp".to_string()]),
            None
        );
    }

    #[test]
    fn no_compile_hint_skips_without_native_addons() {
        assert_eq!(
            get_native_addon_no_compile_hint(COMPILE_DOCKERFILE, &[]),
            None
        );
    }

    #[test]
    fn no_compile_hint_without_apk_vips_has_no_vips_line() {
        let no_vips = "RUN bun build --compile --outfile app ./src/index.js\n\
FROM mirror.gcr.io/library/alpine:latest\n\
CMD [\"./app\"]";
        let h = get_native_addon_no_compile_hint(no_vips, &["sharp".to_string()]).unwrap();
        assert!(h.contains("нативного .node-аддона"));
        assert!(!h.contains("vips"));
    }
}
