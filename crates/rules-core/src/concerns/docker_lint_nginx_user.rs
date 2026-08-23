//! Портований зріз концерну `docker/lint` — non-root правило для фінального
//! `nginxinc/nginx-unprivileged` stage-у.
//!
//! 1:1 порт `npm/rules/docker/lib/docker-nginx-user.mjs` (123 рядки).
//! Репо-широкий греп (`grep -rn "docker-nginx-user" npm/ plugins/ scripts/
//! crates/`) підтверджує єдиного споживача — `docker/lint` (`main.mjs:7`,
//! `import { getNginxUnprivilegedUserHint } from
//! '../lib/docker-nginx-user.mjs'`) плюс власний тест-файл
//! (`docker-nginx-user.test.mjs`) — тож увесь модуль переїжджає без
//! JS-копії, що лишається.
//!
//! Base-image-специфічний чек: канон свідомо — навпаки generic non-root
//! правила ([`super::docker_lint::get_non_root_runtime_hint`]) — вимагає
//! **відсутності** явного `USER` у фінальному nginx-unprivileged stage-і
//! (образ уже успадковує `USER 101`).
//!
//! Чиста текстова логіка без I/O — жоден виклик тут не потребує рішення про
//! канал помилок.

use std::sync::LazyLock;

use regex::Regex;

use super::docker_lint_mirror::get_from_image_token;

static USER_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*USER\s+([^\s#]+)").unwrap());
static COPY_ADD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*(COPY|ADD)\b(.*)$").unwrap());
static CHOWN_FLAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|\s)--chown=").unwrap());
static NGINX_UNPRIVILEGED_REPO_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|/)nginxinc/nginx-unprivileged(?::|@|$)").unwrap());

/// Чи базується ref `FROM` на `nginxinc/nginx-unprivileged` — точний порт
/// `isNginxUnprivilegedImage` (`docker-nginx-user.mjs:42-44`).
pub(super) fn is_nginx_unprivileged_image(image: &str) -> bool {
    NGINX_UNPRIVILEGED_REPO_RE.is_match(image.trim())
}

/// Фінальний (останній `FROM` … кінець файла) stage з номерами рядків —
/// дзеркало `FinalStage` (`docker-nginx-user.mjs:47`).
struct FinalStage {
    image: String,
    lines: Vec<(usize, String)>,
}

/// Виділяє фінальний stage — точний порт `getFinalStage`
/// (`docker-nginx-user.mjs:55-66`). `NEWLINE_RE`-семантика (`/\r?\n/`)
/// відтворена через `str::lines()` (та сама обгрунтованість, що в
/// [`super::docker_lint_mirror::get_mirror_gcr_hint`]).
fn get_final_stage(file_content: &str) -> Option<FinalStage> {
    let lines: Vec<&str> = file_content.lines().collect();
    let mut last_from: Option<(String, usize)> = None;
    for (idx, line) in lines.iter().enumerate() {
        if let Some(image) = get_from_image_token(line) {
            last_from = Some((image, idx));
        }
    }
    let (image, idx) = last_from?;
    let stage_lines: Vec<(usize, String)> = lines[idx..]
        .iter()
        .enumerate()
        .map(|(i, text)| (idx + i + 1, (*text).to_string()))
        .collect();
    Some(FinalStage {
        image,
        lines: stage_lines,
    })
}

/// Нормалізує токен `USER` — точний порт `normalizeUserToken`
/// (`docker-nginx-user.mjs:73-75`).
fn normalize_user_token(token: &str) -> String {
    token.replace(['"', '\''], "").trim().to_lowercase()
}

/// Перевіряє фінальний nginx-unprivileged stage на зайві `USER` і
/// `COPY`/`ADD` без `--chown` — точний порт `getNginxUnprivilegedUserHint`
/// (`docker-nginx-user.mjs:85-122`).
pub(super) fn get_nginx_unprivileged_user_hint(file_content: &str) -> Option<String> {
    let stage = get_final_stage(file_content)?;
    if !is_nginx_unprivileged_image(&stage.image) {
        return None;
    }

    let mut problems: Vec<String> = Vec::new();
    for (line_no, text) in &stage.lines {
        if let Some(caps) = USER_LINE_RE.captures(text) {
            let raw = caps.get(1).unwrap().as_str();
            let token = normalize_user_token(raw);
            if token == "root" || token == "0" {
                problems.push(format!(
                    "рядок {line_no}: прибери `USER {raw}` — у nginx-unprivileged не можна перемикатися на root (інакше фінальний образ лишиться root і k8s із runAsNonRoot впаде)"
                ));
            } else if token == "101" || token == "nginx" {
                problems.push(format!(
                    "рядок {line_no}: прибери зайвий `USER {raw}` — база nginx-unprivileged вже працює від uid=101 (повернення USER назад — симптом зайвого USER root)"
                ));
            } else {
                problems.push(format!(
                    "рядок {line_no}: прибери явний `USER {raw}` — база nginx-unprivileged вже працює від non-root (uid=101), окремий USER не потрібен"
                ));
            }
            continue;
        }
        if let Some(caps) = COPY_ADD_RE.captures(text) {
            if !CHOWN_FLAG_RE.is_match(text) {
                let instr = caps.get(1).unwrap().as_str().to_uppercase();
                problems.push(format!(
                    "рядок {line_no}: додай `--chown=nginx:nginx` до `{instr}` — статику має читати non-root користувач (uid=101)"
                ));
            }
        }
    }

    if problems.is_empty() {
        None
    } else {
        Some(problems.join("\n     - "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANON: &str = "FROM mirror.gcr.io/oven/bun:alpine AS build\n\
WORKDIR /app\n\
COPY . ./\n\
RUN bun install && bun vite build --mode prod --base=/\n\
FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\n\
COPY --chown=nginx:nginx ./k8s/nginx.conf /etc/nginx/conf.d/default.conf\n\
WORKDIR /usr/share/nginx/html\n\
COPY --from=build --chown=nginx:nginx /app/dist ./\n\
RUN find ./ -type f -name \"*.js\" -exec gzip -k {} \\;";

    const ANTIPATTERN: &str = "FROM mirror.gcr.io/oven/bun:alpine AS build\n\
RUN bun install && bun vite build\n\
FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\n\
USER root\n\
COPY ./k8s/nginx.conf /etc/nginx/conf.d/default.conf\n\
COPY --from=build /app/dist ./\n\
RUN find ./ -type f -name \"*.js\" -exec gzip -k {} \\;\n\
USER 101\n\
EXPOSE 8080";

    // --- isNginxUnprivilegedImage (docker-nginx-user.test.mjs) ---

    #[test]
    fn is_nginx_unprivileged_image_mirror_with_tag() {
        assert!(is_nginx_unprivileged_image(
            "mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim"
        ));
    }

    #[test]
    fn is_nginx_unprivileged_image_bare_repo_with_tag() {
        assert!(is_nginx_unprivileged_image(
            "nginxinc/nginx-unprivileged:latest"
        ));
    }

    #[test]
    fn is_nginx_unprivileged_image_without_tag() {
        assert!(is_nginx_unprivileged_image(
            "mirror.gcr.io/nginxinc/nginx-unprivileged"
        ));
    }

    #[test]
    fn is_nginx_unprivileged_image_digest() {
        assert!(is_nginx_unprivileged_image(
            "mirror.gcr.io/nginxinc/nginx-unprivileged@sha256:abc"
        ));
    }

    #[test]
    fn is_nginx_unprivileged_image_does_not_confuse_lookalikes() {
        assert!(!is_nginx_unprivileged_image(
            "mycustomnginxinc/nginx-unprivileged:latest"
        ));
        assert!(!is_nginx_unprivileged_image(
            "mirror.gcr.io/library/nginx:alpine-slim"
        ));
    }

    // --- getNginxUnprivilegedUserHint ---

    #[test]
    fn hint_ok_for_canon_no_user_with_chown() {
        assert_eq!(get_nginx_unprivileged_user_hint(CANON), None);
    }

    #[test]
    fn hint_not_applicable_when_final_stage_is_not_nginx() {
        let h = get_nginx_unprivileged_user_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build\nFROM mirror.gcr.io/library/alpine:latest\nUSER root\nCOPY a b",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn hint_flags_antipattern_root_switchback_and_missing_chown() {
        let h = get_nginx_unprivileged_user_hint(ANTIPATTERN).unwrap();
        assert!(h.contains("USER root"));
        assert!(h.contains("USER 101"));
        assert!(h.contains("--chown=nginx:nginx"));
        assert!(h.contains("COPY"));
        assert_eq!(h.split('\n').count(), 4);
    }

    #[test]
    fn hint_flags_user_zero_as_root_switch() {
        let h = get_nginx_unprivileged_user_hint(
            "FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nUSER 0\nCOPY --chown=nginx:nginx a b",
        )
        .unwrap();
        assert!(h.contains("USER 0"));
        assert!(h.contains("root"));
    }

    #[test]
    fn hint_flags_switchback_by_name_too() {
        let h = get_nginx_unprivileged_user_hint(
            "FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nUSER root\nCOPY --chown=nginx:nginx a b\nUSER nginx",
        )
        .unwrap();
        assert!(h.contains("USER root"));
        assert!(h.contains("USER nginx"));
    }

    #[test]
    fn hint_flags_any_other_explicit_user() {
        let h = get_nginx_unprivileged_user_hint(
            "FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nUSER appuser\nCOPY --chown=nginx:nginx a b",
        )
        .unwrap();
        assert!(h.contains("USER appuser"));
        assert!(h.contains("non-root"));
    }

    #[test]
    fn hint_normalizes_quoted_user() {
        let h = get_nginx_unprivileged_user_hint(
            "FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nUSER \"root\"\nCOPY --chown=nginx:nginx a b",
        )
        .unwrap();
        assert!(h.contains("root"));
    }

    #[test]
    fn hint_flags_add_without_chown() {
        let h = get_nginx_unprivileged_user_hint(
            "FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nADD ./site.tar /usr/share/nginx/html",
        )
        .unwrap();
        assert!(h.contains("ADD"));
        assert!(h.contains("--chown=nginx:nginx"));
    }

    #[test]
    fn hint_ignores_build_stage_user_root() {
        let h = get_nginx_unprivileged_user_hint(
            "FROM mirror.gcr.io/oven/bun:alpine AS build\nUSER root\nRUN bun install\nFROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nCOPY --from=build --chown=nginx:nginx /app/dist ./",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn hint_ok_for_numeric_chown_uid() {
        let h = get_nginx_unprivileged_user_hint(
            "FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\nCOPY --from=build --chown=101:101 /app/dist ./",
        );
        assert_eq!(h, None);
    }

    #[test]
    fn hint_none_without_from() {
        assert_eq!(get_nginx_unprivileged_user_hint("RUN echo hi"), None);
    }
}
