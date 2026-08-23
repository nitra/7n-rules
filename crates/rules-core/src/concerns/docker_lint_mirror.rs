//! Портований зріз концерну `docker/lint` — розпізнавання `FROM <image>` і
//! перевірка вимоги `mirror.gcr.io` замість прямого Docker Hub.
//!
//! 1:1 порт `npm/rules/docker/lib/docker-mirror.mjs` (149 рядків) —
//! **єдиний** споживач цього модуля до порту був сам `docker/lint`
//! (`main.mjs:5`, `import { getMirrorGcrHint, getFromImageToken } from
//! '../lib/docker-mirror.mjs'`) плюс власний тест-файл модуля
//! (`check-mirror.test.mjs`, який тестує `docker-mirror.mjs` напряму, а не
//! через `main.mjs`) — репо-широкий греп (`grep -rn "docker-mirror"
//! npm/ plugins/ scripts/ crates/`) не знайшов жодного стороннього
//! імпортера, тож увесь модуль переїжджає без JS-копії, що лишається.
//!
//! [`get_from_image_token`] — спільна база для [`super::docker_lint`]
//! (`parseFromStages`) і [`super::docker_lint_nginx_user`]
//! (`getFinalStage`), точно як у JS-каноні (обидва імпортують саме з
//! `docker-mirror.mjs`).
//!
//! Чиста текстова логіка без I/O — жоден виклик тут не потребує рішення про
//! канал помилок (нема ні `ensureTool`, ні `try/catch`, ні зовнішнього
//! процесу).

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

static FROM_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*FROM\s+(.+)").unwrap());
static TOKEN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?:[^\s"]+|"[^"]*")+"#).unwrap());
static MIRROR_GCR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^mirror\.gcr\.io/").unwrap());
static IP_LIKE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+\.\d+").unwrap());
static HOST_PORT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\S+:\d+$").unwrap());
static DOCKER_IO_PREFIX_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(docker\.io|index\.docker\.io)/").unwrap());

/// Репозиторії Docker Hub, для яких обов'язкове дзеркало `mirror.gcr.io` —
/// точна копія `HUB_REPOS_REQUIRING_MIRROR`/`EXPECTED_MIRROR`
/// (`docker-mirror.mjs:105-115`), обʼєднаних тут в одну мапу (значення =
/// очікуваний mirror-префікс, ключ = і членство, і lookup одночасно).
static EXPECTED_MIRROR: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    HashMap::from([
        ("oven/bun", "mirror.gcr.io/oven/bun"),
        ("library/alpine", "mirror.gcr.io/library/alpine"),
        ("library/nginx", "mirror.gcr.io/library/nginx"),
        ("library/node", "mirror.gcr.io/library/node"),
        (
            "nginxinc/nginx-unprivileged",
            "mirror.gcr.io/nginxinc/nginx-unprivileged",
        ),
    ])
});

/// Знімає зовнішні лапки токена образу — точний порт `stripFromImageQuotes`
/// (`docker-mirror.mjs:26-31`). Перевіряє лише ПЕРШИЙ символ (не звіряє, що
/// останній — та сама лапка) — свідомо відтворена, а не «полагоджена»
/// поведінка канону.
fn strip_from_image_quotes(t: &str) -> String {
    let chars: Vec<char> = t.chars().collect();
    if chars.len() >= 2 && (chars[0] == '"' || chars[0] == '\'') {
        chars[1..chars.len() - 1].iter().collect()
    } else {
        t.to_string()
    }
}

/// Виділяє токен образу з рядка `FROM` — точний порт `getFromImageToken`
/// (`docker-mirror.mjs:39-64`): знімає inline-коментар, парсить `--platform`
/// (обидві форми — `--platform=x` і `--platform x`), пропускає невідомі
/// `--флаги`, зупиняється на `--`/`AS`.
pub(super) fn get_from_image_token(line: &str) -> Option<String> {
    let without_comment = line.split('#').next().unwrap_or("").trim();
    if without_comment.is_empty() {
        return None;
    }
    let caps = FROM_LINE_RE.captures(without_comment)?;
    let raw = caps.get(1)?.as_str().trim();
    let tokens: Vec<String> = TOKEN_RE
        .find_iter(raw)
        .map(|m| m.as_str().to_string())
        .collect();

    let mut i = 0usize;
    while i < tokens.len() {
        let t = &tokens[i];
        if t == "--platform" || t.starts_with("--platform=") {
            if t.starts_with("--platform=") || tokens.get(i + 1).is_none() {
                i += 1;
            } else {
                i += 2;
            }
        } else if t == "--" || t.to_uppercase() == "AS" {
            break;
        } else if t.starts_with("--") {
            i += 1;
        } else {
            return Some(strip_from_image_quotes(t));
        }
    }
    None
}

/// Схоже на звернення до Docker Hub — точний порт `isDockerHubStyleImageRef`
/// (`docker-mirror.mjs:72-84`).
pub(super) fn is_docker_hub_style_image_ref(image_token: &str) -> bool {
    if image_token.is_empty() {
        return false;
    }
    if MIRROR_GCR_RE.is_match(image_token) {
        return false;
    }
    let no_digest = image_token.split('@').next().unwrap_or("");
    if !no_digest.contains('/') {
        return true;
    }
    let first = no_digest.split('/').next().unwrap_or("");
    if first == "docker.io" || first == "index.docker.io" {
        return true;
    }
    if first.contains('.') {
        return false;
    }
    if first == "localhost" || IP_LIKE_RE.is_match(first) {
        return false;
    }
    !(first.contains(':') && HOST_PORT_RE.is_match(first))
}

/// Нормалізує шлях репозиторію (без тега/digest) — точний порт
/// `normalizeHubRepoPath` (`docker-mirror.mjs:91-103`).
pub(super) fn normalize_hub_repo_path(image_token: &str) -> String {
    let s = image_token.split('@').next().unwrap_or("").to_lowercase();
    let mut s = DOCKER_IO_PREFIX_RE.replace(&s, "").into_owned();
    if !s.contains('/') {
        let name = s.split(':').next().unwrap_or("");
        return format!("library/{name}");
    }
    let last_sl = s.rfind('/').map_or(-1isize, |i| i as isize);
    let last_col = s.rfind(':').map_or(-1isize, |i| i as isize);
    if last_col > last_sl {
        s.truncate(last_col as usize);
    }
    s
}

/// Якщо образ тягнеться з Hub і підлягає дзеркалу — рекомендована заміна,
/// інакше `None` — точний порт `getRequiredMirrorGcrImage`
/// (`docker-mirror.mjs:122-131`).
pub(super) fn get_required_mirror_gcr_image(image_token: &str) -> Option<String> {
    if image_token.is_empty() {
        return None;
    }
    if MIRROR_GCR_RE.is_match(image_token) {
        return None;
    }
    if !is_docker_hub_style_image_ref(image_token) {
        return None;
    }
    let norm = normalize_hub_repo_path(image_token);
    EXPECTED_MIRROR.get(norm.as_str()).map(|s| s.to_string())
}

/// Сканує вміст Dockerfile — точний порт `getMirrorGcrHint`
/// (`docker-mirror.mjs:138-148`). `NEWLINE_SPLIT_RE`-семантика (`/\r?\n/`)
/// відтворена через `str::lines()`: трейлінговий порожній рядок, який JS
/// `split` додав би, а `lines()` — ні, ніколи не матчить `FROM`, тож на
/// номерацію реальних знахідок не впливає.
pub(super) fn get_mirror_gcr_hint(file_content: &str) -> Option<String> {
    for (n, line) in file_content.lines().enumerate() {
        let Some(image) = get_from_image_token(line) else {
            continue;
        };
        if let Some(expected) = get_required_mirror_gcr_image(&image) {
            return Some(format!(
                "рядок {}: FROM має тягнути {expected} (замість {image})",
                n + 1
            ));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- getFromImageToken (check-mirror.test.mjs) ---

    #[test]
    fn from_image_token_extracts_after_variants() {
        assert_eq!(
            get_from_image_token("FROM node:20-alpine AS build"),
            Some("node:20-alpine".to_string())
        );
        assert_eq!(
            get_from_image_token("FROM --platform=linux/amd64 oven/bun:alpine AS x"),
            Some("oven/bun:alpine".to_string())
        );
        assert_eq!(
            get_from_image_token("  from   alpine:3.20  "),
            Some("alpine:3.20".to_string())
        );
    }

    #[test]
    fn from_image_token_strips_inline_comment() {
        assert_eq!(
            get_from_image_token("FROM nginx:1  # comm"),
            Some("nginx:1".to_string())
        );
    }

    #[test]
    fn from_image_token_unquotes() {
        assert_eq!(
            get_from_image_token(r#"FROM "alpine:latest""#),
            Some("alpine:latest".to_string())
        );
        assert_eq!(
            get_from_image_token("FROM 'node:20'"),
            Some("node:20".to_string())
        );
    }

    #[test]
    fn from_image_token_platform_as_separate_token() {
        assert_eq!(
            get_from_image_token("FROM --platform linux/amd64 alpine:3.19 AS build"),
            Some("alpine:3.19".to_string())
        );
    }

    #[test]
    fn from_image_token_unknown_flag_with_value_is_skipped() {
        assert_eq!(
            get_from_image_token("FROM --foo=bar alpine:latest"),
            Some("alpine:latest".to_string())
        );
    }

    #[test]
    fn from_image_token_unknown_flag_without_value_is_skipped() {
        assert_eq!(
            get_from_image_token("FROM --foo alpine:latest"),
            Some("alpine:latest".to_string())
        );
    }

    #[test]
    fn from_image_token_as_only_gives_none() {
        assert_eq!(get_from_image_token("FROM AS build"), None);
    }

    #[test]
    fn from_image_token_double_dash_breaks() {
        assert_eq!(get_from_image_token("FROM --"), None);
    }

    // --- normalizeHubRepoPath ---

    #[test]
    fn normalize_hub_repo_path_short_library_names() {
        assert_eq!(normalize_hub_repo_path("node:20-bullseye"), "library/node");
        assert_eq!(normalize_hub_repo_path("alpine:3.20"), "library/alpine");
    }

    #[test]
    fn normalize_hub_repo_path_explicit_docker_io() {
        assert_eq!(
            normalize_hub_repo_path("docker.io/library/node:20"),
            "library/node"
        );
    }

    #[test]
    fn normalize_hub_repo_path_oven_bun() {
        assert_eq!(normalize_hub_repo_path("oven/bun:alpine"), "oven/bun");
    }

    // --- isDockerHubStyleImageRef ---

    #[test]
    fn is_docker_hub_style_image_ref_short_names() {
        assert!(is_docker_hub_style_image_ref("node:20"));
    }

    #[test]
    fn is_docker_hub_style_image_ref_excludes_foreign_registries() {
        assert!(!is_docker_hub_style_image_ref("gcr.io/foo/bar:1"));
        assert!(!is_docker_hub_style_image_ref("reg.example.com/oven/bun:1"));
    }

    #[test]
    fn is_docker_hub_style_image_ref_mirror_gcr_is_not_hub() {
        assert!(!is_docker_hub_style_image_ref(
            "mirror.gcr.io/library/node:20"
        ));
    }

    #[test]
    fn is_docker_hub_style_image_ref_localhost_with_port_is_private() {
        assert!(!is_docker_hub_style_image_ref("localhost:5000/myimage"));
    }

    // --- getRequiredMirrorGcrImage ---

    #[test]
    fn required_mirror_gcr_image_for_hub_without_mirror() {
        assert_eq!(
            get_required_mirror_gcr_image("node:20"),
            Some("mirror.gcr.io/library/node".to_string())
        );
        assert_eq!(
            get_required_mirror_gcr_image("alpine:3.20"),
            Some("mirror.gcr.io/library/alpine".to_string())
        );
        assert_eq!(
            get_required_mirror_gcr_image("nginx:1"),
            Some("mirror.gcr.io/library/nginx".to_string())
        );
        assert_eq!(
            get_required_mirror_gcr_image("oven/bun:alpine"),
            Some("mirror.gcr.io/oven/bun".to_string())
        );
        assert_eq!(
            get_required_mirror_gcr_image("nginxinc/nginx-unprivileged:alpine-slim"),
            Some("mirror.gcr.io/nginxinc/nginx-unprivileged".to_string())
        );
    }

    #[test]
    fn required_mirror_gcr_image_for_mirror_is_none() {
        assert_eq!(
            get_required_mirror_gcr_image("mirror.gcr.io/library/node:20"),
            None
        );
        assert_eq!(
            get_required_mirror_gcr_image("mirror.gcr.io/oven/bun:alpine"),
            None
        );
        assert_eq!(
            get_required_mirror_gcr_image("mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim"),
            None
        );
    }

    #[test]
    fn required_mirror_gcr_image_for_other_hub_images_is_none() {
        assert_eq!(get_required_mirror_gcr_image("ubuntu:22.04"), None);
    }

    // --- getMirrorGcrHint ---

    #[test]
    fn mirror_gcr_hint_flags_direct_hub() {
        let h = get_mirror_gcr_hint("FROM node:20\nRUN echo\n").unwrap();
        assert!(h.contains("library/node"));
        assert!(h.contains("mirror.gcr.io"));
    }

    #[test]
    fn mirror_gcr_hint_ok_for_mirror() {
        assert_eq!(
            get_mirror_gcr_hint("FROM mirror.gcr.io/library/node:20\n"),
            None
        );
    }

    #[test]
    fn mirror_gcr_hint_flags_nginx_unprivileged_without_mirror() {
        let h = get_mirror_gcr_hint("FROM nginxinc/nginx-unprivileged:alpine-slim\n").unwrap();
        assert!(h.contains("mirror.gcr.io/nginxinc/nginx-unprivileged"));
    }

    #[test]
    fn mirror_gcr_hint_ok_for_nginx_unprivileged_mirror() {
        assert_eq!(
            get_mirror_gcr_hint("FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\n"),
            None
        );
    }
}
