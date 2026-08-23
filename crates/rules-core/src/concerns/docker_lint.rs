//! Native-порт `docker/lint` (`npm/rules/docker/lint/main.mjs`, 384 рядки) —
//! Dockerfile/Containerfile: mirror.gcr.io, multistage/runtime, compile
//! (bun/native-addon), non-root, nginx-теги + зовнішній `hadolint`.
//!
//! Найбільший концерн цієї хвилі — розкладений на шари, той самий патерн,
//! що [`super::k8s_manifests`] + сусідні `k8s_manifests_*`:
//!
//! | Шар JS-канону | Native |
//! |---|---|
//! | `docker-mirror.mjs` (mirror.gcr.io) | [`super::docker_lint_mirror`] |
//! | `docker-native-addon.mjs` (sharp/@img/argon2 antipattern) | [`super::docker_lint_native_addon`] |
//! | `docker-nginx-user.mjs` (nginx-unprivileged non-root) | [`super::docker_lint_nginx_user`] |
//! | `docker-hadolint.mjs` (зовнішній hadolint) | [`super::docker_lint_hadolint`] |
//! | `main.mjs` (обхід, парсинг stage-ів, multistage/compile/non-root/nginx-tag хінти, оркестрація) | цей модуль |
//!
//! Репо-широкий греп (`grep -rn "docker/lint" npm/ plugins/ scripts/
//! crates/`) підтверджує, що всі чотири `lib/*.mjs`-файли мали ЄДИНОГО
//! споживача — сам цей концерн (плюс власні тест-файли) — тож жодна JS-копія
//! не лишається: увесь `npm/rules/docker/lib/` і `npm/rules/docker/lint/`
//! видалені разом із портом (`npm/tests/check-mjs-contract.test.mjs` це й
//! вимагає — native-концерну заборонено мати `main.mjs`).
//!
//! # `ctx.files` ігнорується
//!
//! `concern.json` цього концерну — `"lint": { "scope": "full" }`
//! (`npm/rules/docker/lint/concern.json`), і `lint(ctx)` (`main.mjs:299-310`)
//! справді ніколи не читає `ctx.files` — завжди повний обхід від `ctx.cwd`.
//! Той самий випадок, що [`super::k8s_manifests`] («`ctx.files`
//! ігнорується»); `files`-параметр тут лишається лише заради єдиної
//! сигнатури диспетчера [`super::run_concern`].
//!
//! # Канал помилок по гілках `checkDockerfile`
//!
//! `checkDockerfile` (`main.mjs:345-384`) сама НЕ має `try/catch` — і `lint`
//! (`main.mjs:299-310`) теж. Це визначає канал за замовчуванням:
//!
//! - `readFile(abs, 'utf8')` (`main.mjs:348`) — **без** `try/catch`. Якщо
//!   Dockerfile зник/недоступний між обходом і читанням, виняток летить
//!   назовні `lint()` некатчений → [`RulesError::Concern`] (не тиха
//!   пропущена перевірка, не violation). Порт: [`check_dockerfile`] мапує
//!   помилку `std::fs::read_to_string` на `RulesError::Concern` і `?`-пропагує.
//! - шість чистих хінтів (`getMirrorGcrHint`, `getMultistageAndRuntimeHint`,
//!   `getNativeAddonNoCompileHint`/`getBunCompileHint`,
//!   `getNonRootRuntimeHint`, `getNginxAlpineSlimTagHint`,
//!   `getNginxUnprivilegedUserHint`) — чисті функції без I/O, кожна дає
//!   `fail(msg)` **без** explicit `reason`. `createViolationReporter`
//!   (`violation-reporter.mjs:29`) тоді бере `defaultReason =
//!   ctx?.concernId ?? 'violation'`; `ctx.concernId` для цього концерну —
//!   рядок `"lint"` (basename каталогу концерну, той самий принцип, що в
//!   [`super::forbidden_prettier`] doc-комент). Тобто всі шість дають
//!   violation з `reason: "lint"` (буквально), НЕ `"docker/lint"` і НЕ
//!   якийсь per-check код — легко переплутати з ключем registry.
//! - hadolint-виклик (`main.mjs:378-383`) — окремий канал, розписаний
//!   докладно в doc-коменті [`super::docker_lint_hadolint`] (два різні
//!   під-канали в одному виклику: резолв тула → violation, сам спавн →
//!   `Err`).
//! - `readNearestDependencies` (`main.mjs:319-336`) — **має** `try/catch`,
//!   але це НЕ канал помилок користувачеві: `catch` тут суто керує
//!   ітерацією («немає package.json у цьому каталозі — піднімаємось
//!   вище»), жодного `fail`/кидка не породжує. Порт: [`read_nearest_dependencies`]
//!   так само ковтає будь-яку помилку читання/парсингу і йде до батьківського
//!   каталогу — не violation, не `Err`.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::cursor_ignore::{load_cursor_ignore_paths, to_relative_ignore_globs};
use crate::diagnostics::{ConcernReport, Severity, Violation};
use crate::scan::walk_dir;
use crate::RulesError;

use super::docker_lint_hadolint::{lint_dockerfile_with_hadolint, posix_rel};
use super::docker_lint_mirror::get_from_image_token;
use super::docker_lint_mirror::get_mirror_gcr_hint;
use super::docker_lint_native_addon::{get_native_addon_deps, get_native_addon_no_compile_hint};
use super::docker_lint_nginx_user::get_nginx_unprivileged_user_hint;

/// `reason` за замовчуванням шести чистих хінтів — `ctx.concernId` цього
/// концерну (basename каталогу `lint/`), доккомент модуля вище.
const REASON: &str = "lint";

/// `reason` hadolint-порушення — явний `{ reason: 'hadolint' }`
/// (`main.mjs:382`).
const HADOLINT_REASON: &str = "hadolint";

/// Спільний mirror-префікс nginx-unprivileged — копія
/// `NGINX_UNPRIVILEGED_MIRROR_PREFIX` (`main.mjs:20`), яку JS оголошує
/// прямо в `main.mjs` (не в `lib/`), тож тут — своя константа, не
/// реекспорт із `docker_lint_mirror`/`docker_lint_nginx_user` (ті мають
/// власні копії того самого рядка — так само дубльовано в каноні).
const NGINX_UNPRIVILEGED_MIRROR_PREFIX: &str = "mirror.gcr.io/nginxinc/nginx-unprivileged";

const BUN_RUNTIME_IMAGE: &str = "mirror.gcr.io/oven/bun";

const RUNTIME_IMAGES: [&str; 5] = [
    "mirror.gcr.io/library/alpine",
    "mirror.gcr.io/library/php",
    "mirror.gcr.io/library/python",
    "mirror.gcr.io/nginxinc/nginx-unprivileged",
    "mirror.gcr.io/openresty/openresty",
];

static DEBIAN_VIA_MIRROR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^mirror\.gcr\.io/library/debian:(.+)$").unwrap());
static BUN_NO_COMPILE_MARKER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^#\s*n-rules:bun-no-compile:(.*)$").unwrap());
static BUN_INSTALL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bbun\s+(?:install|i)\b").unwrap());
static BUN_BUILD_COMPILE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bbun\s+build\b[^\n]*\s--compile\b").unwrap());
static BUN_WORD_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bbun\b").unwrap());
static USER_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*USER\s+([^\s#]+)").unwrap());

/// Один знайдений `FROM <image>` — точний порт `FromStage` (`main.mjs:23-27`).
#[derive(Debug, Clone, PartialEq, Eq)]
struct FromStage {
    line: usize,
    image: String,
}

/// Один stage (від свого `FROM` до наступного `FROM`/кінця файла).
struct Stage {
    from: FromStage,
    stage_content: String,
}

/// Чи є basename Dockerfile / Containerfile — точний порт `isDockerfileName`
/// (`main.mjs:34-38`). Зауваж: `Dockerfile.txt` дає `true` (будь-який суфікс
/// після `dockerfile.`/`containerfile.` минає) — буквально відтворена
/// поведінка канону (сам JS-тест `discover.test.mjs` це підтверджує, попри
/// назву `'відсікає сторонні файли'`), не «полагоджена».
fn is_dockerfile_name(name: &str) -> bool {
    let n = name.to_lowercase();
    if n == "dockerfile" || n == "containerfile" {
        return true;
    }
    n.starts_with("dockerfile.") || n.starts_with("containerfile.")
}

/// Basename відносного posix-шляху — рядок після останнього `/`.
fn posix_basename(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

/// Збирає абсолютні шляхи до Dockerfile/Containerfile від кореня `root` —
/// точний семантичний порт `findDockerfilePaths` (`main.mjs:46-57`).
/// Двигун обходу — [`crate::scan::walk_dir`] (те саме native-ядро, яке
/// JS-`walkDir.mjs` уже викликає під капотом, доккомент
/// `crate::scan` модуля) — тож поведінка .gitignore/`ignorePaths`
/// ідентична, порт лише додає фільтр [`is_dockerfile_name`] і абсолютизує
/// шлях.
fn find_dockerfile_paths(root: &Path, ignore_paths: &[String]) -> Vec<PathBuf> {
    let extra_globs = to_relative_ignore_globs(root, ignore_paths);
    let mut files: Vec<PathBuf> = walk_dir(root, &extra_globs)
        .into_iter()
        .filter(|rel| is_dockerfile_name(posix_basename(rel)))
        .map(|rel| root.join(rel))
        .collect();
    // `walk_dir` уже повертає байтово-лексикографічно відсортований список
    // (`scan.rs`), і `root.join(..)` зі спільним префіксом порядок не
    // ламає — повторне сортування було б no-op; лишаємо `sort()` явно як
    // документацію інваріанта, а не тому, що він щось змінює.
    files.sort();
    files
}

/// Витягує всі `FROM <image>` — точний порт `parseFromStages`
/// (`main.mjs:64-72`). `NEWLINE_RE`-семантика (`/\r?\n/`) відтворена через
/// `str::lines()` (обгрунтування — доккомент
/// [`super::docker_lint_mirror::get_mirror_gcr_hint`]).
fn parse_from_stages(content: &str) -> Vec<FromStage> {
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        if let Some(image) = get_from_image_token(line) {
            out.push(FromStage { line: i + 1, image });
        }
    }
    out
}

/// Розбиває Dockerfile на stages за `FROM` — точний порт
/// `splitDockerfileStages` (`main.mjs:132-147`).
fn split_dockerfile_stages(content: &str) -> Vec<Stage> {
    let stages = parse_from_stages(content);
    if stages.is_empty() {
        return Vec::new();
    }
    let lines: Vec<&str> = content.lines().collect();
    let mut out = Vec::new();
    for (idx, from) in stages.iter().enumerate() {
        let start = from.line.saturating_sub(1).min(lines.len());
        let end = stages
            .get(idx + 1)
            .map(|next| next.line.saturating_sub(1))
            .unwrap_or(lines.len())
            .min(lines.len());
        let stage_content = lines[start..end].join("\n");
        out.push(Stage {
            from: from.clone(),
            stage_content,
        });
    }
    out
}

/// Явний opt-in «compile неможливий» — точний порт `hasBunNoCompileMarker`
/// (`main.mjs:97-102`).
fn has_bun_no_compile_marker(content: &str) -> bool {
    content.lines().any(|line| {
        BUN_NO_COMPILE_MARKER_RE
            .captures(line.trim())
            .is_some_and(|caps| !caps[1].trim().is_empty())
    })
}

/// Чи ref фінального `FROM` дозволений — точний порт
/// `isAllowedFinalRuntimeImage` (`main.mjs:110-125`).
fn is_allowed_final_runtime_image(last_lower: &str, allow_bun_runtime: bool) -> bool {
    if last_lower == "scratch" || last_lower.starts_with("scratch:") {
        return true;
    }
    if allow_bun_runtime
        && (last_lower == BUN_RUNTIME_IMAGE
            || last_lower.starts_with(&format!("{BUN_RUNTIME_IMAGE}:")))
    {
        return true;
    }
    if let Some(caps) = DEBIAN_VIA_MIRROR_RE.captures(last_lower) {
        return caps[1].to_lowercase().contains("slim");
    }
    RUNTIME_IMAGES
        .iter()
        .any(|img| last_lower.starts_with(&format!("{img}:")) || last_lower == *img)
}

/// Перевіряє multistage + дозволений фінальний runtime — точний порт
/// `getMultistageAndRuntimeHint` (`main.mjs:159-177`).
fn get_multistage_and_runtime_hint(content: &str, has_native_addon: bool) -> Option<String> {
    let stages = parse_from_stages(content);
    if stages.is_empty() {
        return None;
    }
    if stages.len() < 2 {
        return Some(
            "має бути multistage build: мінімум 2 інструкції FROM (build stage + runtime stage)"
                .to_string(),
        );
    }
    let last = stages.last().unwrap();
    let last_image = last.image.split('@').next().unwrap_or("");
    let last_lower = last_image.to_lowercase();
    let allow_bun_runtime = has_native_addon || has_bun_no_compile_marker(content);

    if !is_allowed_final_runtime_image(&last_lower, allow_bun_runtime) {
        return Some(format!(
            "фінальний FROM має бути дозволеним runtime-образом (див. docker.mdc: multistage), зараз: {} (рядок {})",
            last.image, last.line
        ));
    }
    None
}

/// Вимога "compile в бінарник" для bun-backend — точний порт
/// `getBunCompileHint` (`main.mjs:194-226`).
fn get_bun_compile_hint(content: &str) -> Option<String> {
    if has_bun_no_compile_marker(content) {
        return None;
    }
    let stages = split_dockerfile_stages(content);
    if stages.is_empty() {
        return None;
    }
    let last = stages.last().unwrap();
    let last_image = last.from.image.split('@').next().unwrap_or("");
    let last_lower = last_image.to_lowercase();

    if !BUN_INSTALL_RE.is_match(content) {
        return None;
    }

    let is_final_alpine = last_lower.starts_with("mirror.gcr.io/library/alpine:");
    if !is_final_alpine {
        return None;
    }

    let is_final_frontend = last_lower.starts_with(&format!("{NGINX_UNPRIVILEGED_MIRROR_PREFIX}:"))
        || last_lower.starts_with("mirror.gcr.io/openresty/openresty:");
    if is_final_frontend {
        return None;
    }

    if !BUN_BUILD_COMPILE_RE.is_match(content) {
        return Some(
            "є `bun install`, але немає `bun build --compile` — для backend-образу потрібно компілювати застосунок у бінарник (docker.mdc: компіляція)"
                .to_string(),
        );
    }

    if BUN_WORD_RE.is_match(&last.stage_content) {
        return Some(
            "фінальний stage не має містити Bun (RUN/CMD/ENTRYPOINT з `bun`) — залиш у runtime stage лише бінарник і runtime libs (docker.mdc: компіляція)"
                .to_string(),
        );
    }

    None
}

/// Вимога тега `alpine-slim` для nginx-unprivileged — точний порт
/// `getNginxAlpineSlimTagHint` (`main.mjs:234-251`).
fn get_nginx_alpine_slim_tag_hint(content: &str) -> Option<String> {
    let prefix = NGINX_UNPRIVILEGED_MIRROR_PREFIX;
    for stage in parse_from_stages(content) {
        let no_digest = stage.image.split('@').next().unwrap_or("").trim();
        let d = no_digest.to_lowercase();
        let matches_prefix = d == prefix || d.starts_with(&format!("{prefix}:"));
        if !matches_prefix {
            continue;
        }
        if d == prefix {
            return Some(format!(
                "рядок {}: `FROM {prefix}` має явний тег `alpine-slim` (docker.mdc: мінімальні образи), зараз без тега (типово latest)",
                stage.line
            ));
        }
        let tag = &no_digest[prefix.len() + 1..];
        if tag.to_lowercase() != "alpine-slim" {
            return Some(format!(
                "рядок {}: для nginx потрібен тег `alpine-slim` (docker.mdc: мінімальні образи), зараз: `{tag}`",
                stage.line
            ));
        }
    }
    None
}

/// Вимога non-root у фінальному runtime stage — точний порт
/// `getNonRootRuntimeHint` (`main.mjs:262-292`).
fn get_non_root_runtime_hint(content: &str) -> Option<String> {
    let stages = split_dockerfile_stages(content);
    if stages.is_empty() {
        return None;
    }
    let last = stages.last().unwrap();
    let last_image = last.from.image.split('@').next().unwrap_or("");
    let last_lower = last_image.to_lowercase();

    let mut last_user_token: Option<String> = None;
    for line in last.stage_content.lines() {
        if let Some(caps) = USER_LINE_RE.captures(line) {
            let raw = caps.get(1).unwrap().as_str();
            last_user_token = Some(raw.replace(['"', '\''], ""));
        }
    }

    let Some(token) = last_user_token else {
        if last_lower.starts_with(&format!("{NGINX_UNPRIVILEGED_MIRROR_PREFIX}:")) {
            return None;
        }
        return Some(
            "у фінальному stage має бути `USER <non-root>` (наприклад `USER app`) — принцип non-root (docker.mdc: не превілейований образ)"
                .to_string(),
        );
    };

    let normalized = token.trim().to_lowercase();
    if normalized == "root" || normalized == "0" {
        return Some(format!(
            "фінальний stage має запускатися не від root: зараз `USER {token}` (docker.mdc: не превілейований образ)"
        ));
    }
    None
}

/// Читає `dependencies` найближчого `package.json` (від каталогу Dockerfile
/// вгору до `root`) — точний порт `readNearestDependencies`
/// (`main.mjs:319-336`). `catch` тут — керування ітерацією, НЕ канал
/// помилок (доккомент модуля вище): будь-яка помилка читання/парсингу
/// мовчки веде до батьківського каталогу.
fn read_nearest_dependencies(abs: &Path, root: &Path) -> serde_json::Value {
    let mut dir = match abs.parent() {
        Some(p) => p.to_path_buf(),
        None => return serde_json::Value::Null,
    };
    loop {
        let candidate = dir.join("package.json");
        if let Ok(raw) = std::fs::read_to_string(&candidate) {
            if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&raw) {
                return pkg
                    .get("dependencies")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
            }
        }
        if dir == root {
            break;
        }
        let Some(parent) = dir.parent() else { break };
        if parent == dir {
            break;
        }
        dir = parent.to_path_buf();
    }
    serde_json::Value::Null
}

fn plain_violation(message: String) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Перевіряє один Dockerfile/Containerfile — точний порт `checkDockerfile`
/// (`main.mjs:345-384`). Канал помилок кожної гілки — доккомент модуля вище.
fn check_dockerfile(root: &Path, abs: &Path) -> Result<Vec<Violation>, RulesError> {
    let rel_computed = posix_rel(root, abs);
    let rel = if rel_computed.is_empty() {
        abs.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string()
    } else {
        rel_computed
    };

    // `readFile` без `try/catch` у JS — некатчена помилка летить із `lint()`.
    let content = std::fs::read_to_string(abs).map_err(|error| {
        RulesError::Concern(format!("{rel}: не вдалося прочитати Dockerfile ({error})"))
    })?;

    let deps = read_nearest_dependencies(abs, root);
    let native_addons = get_native_addon_deps(&deps);
    let has_native_addon = !native_addons.is_empty();

    let mut violations = Vec::new();

    if let Some(hint) = get_mirror_gcr_hint(&content) {
        violations.push(plain_violation(format!("{rel} (mirror.gcr.io): {hint}")));
    }

    if let Some(hint) = get_multistage_and_runtime_hint(&content, has_native_addon) {
        violations.push(plain_violation(format!("{rel} (multistage): {hint}")));
    }

    if has_native_addon {
        if let Some(hint) = get_native_addon_no_compile_hint(&content, &native_addons) {
            violations.push(plain_violation(format!("{rel} (native-addon): {hint}")));
        }
    } else if let Some(hint) = get_bun_compile_hint(&content) {
        violations.push(plain_violation(format!("{rel} (compile): {hint}")));
    }

    if let Some(hint) = get_non_root_runtime_hint(&content) {
        violations.push(plain_violation(format!("{rel} (non-root): {hint}")));
    }

    if let Some(hint) = get_nginx_alpine_slim_tag_hint(&content) {
        violations.push(plain_violation(format!("{rel} (nginx tag): {hint}")));
    }

    if let Some(hint) = get_nginx_unprivileged_user_hint(&content) {
        violations.push(plain_violation(format!("{rel} (nginx non-root): {hint}")));
    }

    let outcome = lint_dockerfile_with_hadolint(root, &rel)?;
    if !outcome.ok {
        let tail = format!("{}{}", outcome.stdout, outcome.stderr);
        let tail = tail.trim();
        let detail = if tail.is_empty() {
            String::new()
        } else {
            format!(":\n{tail}")
        };
        violations.push(Violation {
            reason: HADOLINT_REASON.to_string(),
            message: format!("{rel} ({HADOLINT_REASON}){detail}"),
            file: Some(rel.clone()),
            severity: Severity::Error,
            data: None,
        });
    }

    Ok(violations)
}

/// Detector `docker/lint` — точний порт `lint(ctx)` (`main.mjs:299-310`).
/// `files` ігнорується (доккомент модуля вище — `"scope": "full"`).
pub fn docker_lint(cwd: &Path, _files: Option<&[String]>) -> Result<ConcernReport, RulesError> {
    let ignore_paths = load_cursor_ignore_paths(cwd);
    let files = find_dockerfile_paths(cwd, &ignore_paths);

    let mut violations = Vec::new();
    for abs in &files {
        violations.extend(check_dockerfile(cwd, abs)?);
    }
    Ok(ConcernReport::from(violations))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn write(tmp: &TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    // --- isDockerfileName (discover.test.mjs) ---

    #[test]
    fn dockerfile_name_canonical_forms() {
        assert!(is_dockerfile_name("Dockerfile"));
        assert!(is_dockerfile_name("dockerfile"));
        assert!(is_dockerfile_name("Dockerfile.prod"));
        assert!(is_dockerfile_name("Containerfile"));
        assert!(is_dockerfile_name("containerfile.dev"));
    }

    /// Буквальна поведінка канону: суфікс після `Dockerfile.` не звужує
    /// збіг (навіть `.txt`) — see doc-комент `is_dockerfile_name`.
    #[test]
    fn dockerfile_name_matches_js_literal_behaviour() {
        assert!(is_dockerfile_name("Dockerfile.txt"));
        assert!(!is_dockerfile_name("not-docker"));
        assert!(is_dockerfile_name("Dockerfile"));
    }

    // --- findDockerfilePaths ---

    #[test]
    fn find_dockerfile_paths_collects_dockerfile_and_containerfile() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "Dockerfile", "FROM scratch\n");
        write(&tmp, "a/Dockerfile.dev", "FROM scratch\n");
        write(&tmp, "a/Containerfile", "FROM scratch\n");
        // "App.Dockerfile" НЕ рахується (basename не починається з
        // "dockerfile."/"containerfile.") — той самий кейс, що в
        // discover.test.mjs (4 записаних файли, 3 знайдених).
        write(&tmp, "b/App.Dockerfile", "FROM scratch\n");

        let ignore_paths = load_cursor_ignore_paths(tmp.path());
        let found = find_dockerfile_paths(tmp.path(), &ignore_paths);
        assert_eq!(found.len(), 3);
    }

    // --- parseFromStages (check-multistage.test.mjs) ---

    #[test]
    fn parse_from_stages_collects_all_from_with_line_numbers() {
        let content = "ARG X=1\nFROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun i\nFROM mirror.gcr.io/library/alpine:latest\nCMD [\"./app\"]";
        let stages = parse_from_stages(content);
        assert_eq!(
            stages,
            vec![
                FromStage {
                    line: 2,
                    image: "mirror.gcr.io/oven/bun:alpine".to_string()
                },
                FromStage {
                    line: 4,
                    image: "mirror.gcr.io/library/alpine:latest".to_string()
                },
            ]
        );
    }

    // --- getMultistageAndRuntimeHint ---

    #[test]
    fn multistage_hint_ok_for_final_alpine() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun build --compile --outfile app ./src/index.js\nFROM mirror.gcr.io/library/alpine:latest\nCMD [\"./app\"]",
            false,
        );
        assert_eq!(h, None);
    }

    #[test]
    fn multistage_hint_fails_for_library_nginx() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun x\nFROM mirror.gcr.io/library/nginx:alpine-slim\nCOPY --from=build-env /app/dist /usr/share/nginx/html",
            false,
        )
        .unwrap();
        assert!(h.contains("дозволеним runtime-образом"));
        assert!(h.contains("library/nginx"));
    }

    #[test]
    fn multistage_hint_ok_for_nginx_unprivileged() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun run build\nFROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nUSER root\nCOPY --from=build-env /app/dist /usr/share/nginx/html\nRUN chown -R nginx:nginx /usr/share/nginx/html\nUSER nginx",
            false,
        );
        assert_eq!(h, None);
    }

    #[test]
    fn multistage_hint_ok_for_php_exception() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/library/php:8.3-cli AS build-env\nRUN composer install\nFROM mirror.gcr.io/library/php:8.3-fpm\nCOPY --from=build-env /app /var/www/html",
            false,
        );
        assert_eq!(h, None);
    }

    #[test]
    fn multistage_hint_ok_for_python_exception() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/library/python:3.12 AS build-env\nRUN pip install -r requirements.txt\nFROM mirror.gcr.io/library/python:3.12-slim\nCOPY --from=build-env /app /app",
            false,
        );
        assert_eq!(h, None);
    }

    #[test]
    fn multistage_hint_ok_for_scratch() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun build --compile --outfile /app/a ./x.js\nFROM scratch\nCOPY --from=build-env /app/a /a",
            false,
        );
        assert_eq!(h, None);
    }

    #[test]
    fn multistage_hint_ok_for_debian_bookworm_slim() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun build --compile --outfile /app/a ./x.js\nFROM mirror.gcr.io/library/debian:bookworm-slim\nRUN apt-get update\nCOPY --from=build-env /app/a /usr/local/bin/a",
            false,
        );
        assert_eq!(h, None);
    }

    #[test]
    fn multistage_hint_fails_for_debian_without_slim() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun x\nFROM mirror.gcr.io/library/debian:bookworm\nCOPY --from=build-env /x /x",
            false,
        )
        .unwrap();
        assert!(h.contains("дозволеним runtime-образом"));
    }

    #[test]
    fn multistage_hint_fails_for_single_stage() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine\nRUN bun run start",
            false,
        )
        .unwrap();
        assert!(h.contains("мінімум 2 інструкції FROM"));
    }

    #[test]
    fn multistage_hint_fails_for_final_bun() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun build\nFROM mirror.gcr.io/oven/bun:alpine\nCMD [\"bun\",\"./app\"]",
            false,
        )
        .unwrap();
        assert!(h.contains("дозволеним runtime-образом"));
        assert!(h.contains("oven/bun"));
    }

    #[test]
    fn multistage_hint_fails_for_final_bun_without_addon_or_marker() {
        let h = get_multistage_and_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun install --production\nFROM mirror.gcr.io/oven/bun:alpine\nCMD [\"bun\",\"src/index.js\"]",
            false,
        )
        .unwrap();
        assert!(h.contains("дозволеним runtime-образом"));
    }

    #[test]
    fn multistage_hint_ok_for_final_bun_with_no_compile_marker() {
        let h = get_multistage_and_runtime_hint(
            "# n-rules:bun-no-compile: gateway.config.js вантажиться через динамічний import()\nFROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun install --production\nFROM mirror.gcr.io/oven/bun:alpine\nCMD [\"bun\",\"src/index.js\"]",
            false,
        );
        assert_eq!(h, None);
    }

    const NATIVE_ADDON_CANON_DOCKERFILE: &str = "FROM mirror.gcr.io/oven/bun:alpine AS build-env\n\
WORKDIR /app\n\
ENV NODE_ENV=production\n\
COPY package.json .\n\
RUN bun install --production\n\
COPY ./src ./src\n\
FROM mirror.gcr.io/oven/bun:alpine\n\
RUN apk add --no-cache tzdata\n\
WORKDIR /app\n\
COPY --from=build-env --chown=bun:bun /app/node_modules ./node_modules\n\
COPY --from=build-env --chown=bun:bun /app/src ./src\n\
COPY --from=build-env --chown=bun:bun /app/package.json ./package.json\n\
USER bun\n\
CMD [\"bun\", \"src/index.js\"]";

    #[test]
    fn multistage_hint_allows_final_bun_with_native_addon() {
        let h = get_multistage_and_runtime_hint(NATIVE_ADDON_CANON_DOCKERFILE, true);
        assert_eq!(h, None);
    }

    #[test]
    fn multistage_hint_forbids_final_bun_without_native_addon_flag() {
        let h = get_multistage_and_runtime_hint(NATIVE_ADDON_CANON_DOCKERFILE, false).unwrap();
        assert!(h.contains("дозволеним runtime-образом"));
        assert!(h.contains("oven/bun"));
    }

    // --- getBunCompileHint / hasBunNoCompileMarker (check-compile.test.mjs) ---

    #[test]
    fn bun_compile_hint_ok_when_compiled_and_final_alpine_clean() {
        let h = get_bun_compile_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nWORKDIR /app\nCOPY package.json .\nCOPY bunfig.toml .\nRUN bun install --production\nCOPY ./src ./src\nRUN bun build --compile --outfile app ./src/index.js\nFROM mirror.gcr.io/library/alpine:latest\nRUN apk add --no-cache libstdc++ libgcc tzdata\nWORKDIR /app\nCOPY --from=build-env /app/app ./app\nCMD [\"./app\"]",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn bun_compile_hint_fails_without_compile_step() {
        let h = get_bun_compile_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun install --production\nFROM mirror.gcr.io/library/alpine:latest\nCMD [\"./app\"]",
        )
        .unwrap();
        assert!(h.contains("bun build --compile"));
    }

    #[test]
    fn bun_compile_hint_fails_when_final_stage_still_has_bun() {
        let h = get_bun_compile_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun install --production\nRUN bun build --compile --outfile app ./src/index.js\nFROM mirror.gcr.io/library/alpine:latest\nCMD [\"bun\",\"./app\"]",
        )
        .unwrap();
        assert!(h.contains("фінальний stage"));
        assert!(h.contains("Bun"));
    }

    #[test]
    fn bun_compile_hint_skips_frontend_nginx() {
        let h = get_bun_compile_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun install\nRUN bun run build\nFROM mirror.gcr.io/library/nginx:alpine-slim",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn bun_compile_hint_skips_frontend_nginx_unprivileged() {
        let h = get_bun_compile_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun install\nRUN bun run build\nFROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nUSER root\nCOPY --from=build-env /app/dist /usr/share/nginx/html\nRUN chown -R nginx:nginx /usr/share/nginx/html\nUSER nginx",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn bun_compile_hint_skips_with_no_compile_marker() {
        let h = get_bun_compile_hint(
            "# n-rules:bun-no-compile: gateway.config.js вантажиться через динамічний import(), compile не трейсить його\nFROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun install --production\nFROM mirror.gcr.io/library/alpine:latest\nCMD [\"bun\", \"src/index.js\"]",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn has_bun_no_compile_marker_true_with_reason() {
        assert!(has_bun_no_compile_marker(
            "# n-rules:bun-no-compile: причина\nFROM mirror.gcr.io/oven/bun:alpine"
        ));
    }

    #[test]
    fn has_bun_no_compile_marker_true_with_leading_whitespace() {
        assert!(has_bun_no_compile_marker(
            "  # n-rules:bun-no-compile: причина"
        ));
    }

    #[test]
    fn has_bun_no_compile_marker_false_without_reason() {
        assert!(!has_bun_no_compile_marker("# n-rules:bun-no-compile:"));
    }

    #[test]
    fn has_bun_no_compile_marker_false_when_absent() {
        assert!(!has_bun_no_compile_marker(
            "FROM mirror.gcr.io/oven/bun:alpine\nRUN bun install"
        ));
    }

    // --- getNginxAlpineSlimTagHint (check-nginx-slim.test.mjs) ---

    #[test]
    fn nginx_slim_tag_hint_ok_with_alpine_slim() {
        let h = get_nginx_alpine_slim_tag_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nFROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn nginx_slim_tag_hint_ok_case_insensitive_tag() {
        let h = get_nginx_alpine_slim_tag_hint(
            "FROM mirror.gcr.io/nginxinc/nginx-unprivileged:Alpine-Slim\n",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn nginx_slim_tag_hint_ignores_lookalike_image() {
        let h = get_nginx_alpine_slim_tag_hint("FROM mirror.gcr.io/library/nginx2:latest\n");
        assert_eq!(h, None);
    }

    #[test]
    fn nginx_slim_tag_hint_fails_for_latest() {
        let h = get_nginx_alpine_slim_tag_hint(
            "FROM mirror.gcr.io/nginxinc/nginx-unprivileged:latest\n",
        )
        .unwrap();
        assert!(h.contains("alpine-slim"));
        assert!(h.contains("latest"));
    }

    #[test]
    fn nginx_slim_tag_hint_fails_without_tag() {
        let h = get_nginx_alpine_slim_tag_hint("FROM mirror.gcr.io/nginxinc/nginx-unprivileged\n")
            .unwrap();
        assert!(h.contains("без тега"));
    }

    // --- getNonRootRuntimeHint (check-nonroot.test.mjs) ---

    #[test]
    fn non_root_hint_ok_with_user_app() {
        let h = get_non_root_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun build --compile --outfile app ./src/index.js\nFROM mirror.gcr.io/library/alpine:latest\nRUN addgroup -g 1000 app && adduser -D -u 1000 -G app app\nCOPY --from=build-env --chown=app:app /app/app ./app\nUSER app\nCMD [\"./app\"]",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn non_root_hint_fails_without_user() {
        let h = get_non_root_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun build --compile --outfile app ./src/index.js\nFROM mirror.gcr.io/library/alpine:latest\nCMD [\"./app\"]",
        )
        .unwrap();
        assert!(h.contains("USER"));
        assert!(h.contains("non-root"));
    }

    #[test]
    fn non_root_hint_fails_for_user_root() {
        let h = get_non_root_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun build --compile --outfile app ./src/index.js\nFROM mirror.gcr.io/library/alpine:latest\nUSER root\nCMD [\"./app\"]",
        )
        .unwrap();
        assert!(h.contains("root"));
    }

    #[test]
    fn non_root_hint_fails_for_user_zero() {
        let h = get_non_root_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun build --compile --outfile app ./src/index.js\nFROM mirror.gcr.io/library/alpine:latest\nUSER 0\nCMD [\"./app\"]",
        )
        .unwrap();
        assert!(h.contains("USER 0"));
    }

    #[test]
    fn non_root_hint_ok_nginx_unprivileged_without_user() {
        let h = get_non_root_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun run build\nFROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nCOPY --from=build-env /app/dist /usr/share/nginx/html",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn non_root_hint_ok_nginx_unprivileged_root_then_nginx() {
        let h = get_non_root_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun run build\nFROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nUSER root\nCOPY --from=build-env /app/dist /usr/share/nginx/html\nRUN chown -R nginx:nginx /usr/share/nginx/html\nUSER nginx",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn non_root_hint_fails_nginx_unprivileged_root_as_final() {
        let h = get_non_root_runtime_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nRUN bun run build\nFROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nUSER root",
        )
        .unwrap();
        assert!(h.contains("root"));
    }

    // --- check_dockerfile / docker_lint integration (check-integration.test.mjs, check-native-addon.test.mjs) ---

    const CLEAN_MULTISTAGE: &str = "FROM mirror.gcr.io/library/alpine:3.19 AS build\nRUN echo build\n\nFROM mirror.gcr.io/library/alpine:3.19\nUSER nobody\nCOPY --from=build /etc/alpine-release /app/\nCMD [\"/bin/sh\"]\n";
    const SINGLE_STAGE: &str = "FROM mirror.gcr.io/library/alpine:latest\nCMD [\"/bin/sh\"]\n";

    #[test]
    fn empty_dir_has_no_dockerfile_is_clean() {
        let tmp = TempDir::new().unwrap();
        let report = docker_lint(tmp.path(), None).unwrap();
        assert!(report.violations.is_empty());
    }

    #[test]
    fn single_stage_dockerfile_yields_violations() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "Dockerfile", SINGLE_STAGE);
        let report = docker_lint(tmp.path(), None).unwrap();
        assert!(!report.violations.is_empty());
        // Усі "чисті" хінти (тут — тільки multistage, бо hadolint може бути
        // відсутній на CI-машині — окремо перевіряється hadolint-модулем)
        // мають `reason: "lint"`.
        assert!(report
            .violations
            .iter()
            .any(|v| v.reason == "lint" && v.message.contains("multistage")));
    }

    #[test]
    fn multiple_dockerfiles_one_clean_one_violating() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "Dockerfile", CLEAN_MULTISTAGE);
        write(&tmp, "Dockerfile.app", SINGLE_STAGE);
        let report = docker_lint(tmp.path(), None).unwrap();
        assert!(!report.violations.is_empty());
    }

    const ANTIPATTERN_DOCKERFILE: &str = "FROM mirror.gcr.io/oven/bun:alpine AS build-env\nWORKDIR /app\nCOPY package.json .\nRUN bun install --production\nCOPY ./src ./src\nRUN bun build --compile --outfile app ./src/index.js\nFROM mirror.gcr.io/library/alpine:latest\nRUN apk add --no-cache libstdc++ libgcc vips tzdata\nCOPY --from=build-env --chown=app:app /app/app ./app\nUSER app\nCMD [\"./app\"]\n";

    #[test]
    fn native_addon_antipattern_via_lint_yields_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "package.json",
            r#"{"dependencies":{"sharp":"^0.34.5"}}"#,
        );
        write(&tmp, "Dockerfile", ANTIPATTERN_DOCKERFILE);
        let report = docker_lint(tmp.path(), None).unwrap();
        assert!(report
            .violations
            .iter()
            .any(|v| v.message.contains("native-addon")));
    }

    #[test]
    fn native_addon_canon_via_lint_has_no_native_addon_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "package.json",
            r#"{"dependencies":{"sharp":"^0.34.5"}}"#,
        );
        write(&tmp, "Dockerfile", NATIVE_ADDON_CANON_DOCKERFILE);
        let report = docker_lint(tmp.path(), None).unwrap();
        assert!(!report
            .violations
            .iter()
            .any(|v| v.message.contains("native-addon") || v.message.contains("(compile)")));
    }

    #[test]
    fn without_native_addon_deps_compile_rule_is_silent_via_lint() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"dependencies":{"pino":"^9"}}"#);
        write(&tmp, "Dockerfile", ANTIPATTERN_DOCKERFILE);
        let report = docker_lint(tmp.path(), None).unwrap();
        assert!(!report
            .violations
            .iter()
            .any(|v| v.message.contains("native-addon") || v.message.contains("(compile)")));
    }
}
