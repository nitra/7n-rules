//! Native-порт `nginx-default-tpl/template` (`npm/rules/nginx-default-tpl/template/main.mjs`,
//! 539 рядків) — nginx-default-tpl.mdc: структура `default.conf.template`,
//! парність `*.ini` ⇄ `$KEY` у шаблоні, стиснення статики й `envsubst` у
//! Dockerfile, рекомендації VS Code для nginx-конфігів.
//!
//! # Reuse-межа
//!
//! - `loadCursorIgnorePaths` + `walkDir` (`main.mjs:517`, і кожен приватний
//!   `find*`) → [`crate::concerns::cursor_ignore`] + [`crate::scan::walk_dir`] —
//!   той самий двоетапний виклик, що вже прийнятий у [`super::graphql_tooling`]
//!   / [`super::env_dns`] (full-scope native concern сам читає repo-локальний
//!   конфіг, бо `run_concern` не має per-concern знань).
//! - `runConftestBatch` (`checkVscodeNginx`, `main.mjs:417-449`) →
//!   [`crate::conftest::run_conftest_batch`] — два окремі виклики (окремі
//!   `policyDir`/`namespace`/ціль для `.vscode/extensions.json` і
//!   `.vscode/settings.json`), той самий підхід, що
//!   [`super::graphql_tooling::check_extensions_recommendation`].
//! - `isDockerfileName`/`findDockerfilePaths` — канон (`main.mjs:28-41,50-61`)
//!   тримає **локальну копію** цих гелперів (не імпортує з
//!   `docker/lint`, бо той концерн уже native і без `main.mjs`, доккомент
//!   там-таки). Порт відтворює той самий вибір — локальні
//!   [`is_dockerfile_name`]/[`find_dockerfile_paths`], не reuse
//!   [`super::docker_lint`] (той модуль своїх гелперів не експортує назовні
//!   crate — той самий поділ, що в JS-каноні).
//! - Обчислення `relative(root, abs) || abs` (`main.mjs:344,470,498` тощо) —
//!   через [`super::docker_lint_hadolint::posix_rel`], спільний
//!   `concerns`-рівня гелпер (`pub(super)`), яким уже користується
//!   [`super::docker_lint::check_dockerfile`] поза власне hadolint-контуром;
//!   тут — [`rel_or_abs`] додає лише JS-специфічний fallback на повний
//!   абсолютний шлях при порожньому `rel` (сам JS не робить fallback на
//!   basename, на відміну від [`super::docker_lint`] — буквальний порт цієї
//!   відмінності).
//!
//! # `ctx.files` ігнорується, сигнатура без `files`
//!
//! `concern.json` цього концерну — `"lint": { "scope": "full" }`
//! (`npm/rules/nginx-default-tpl/template/concern.json`), і `lint(ctx)`
//! ніколи не читає `ctx.files`. Той самий прецедент, що
//! [`super::graphql_tooling::graphql_tooling`] і [`super::docker_lint`]
//! (для останнього `files`-параметр лишили заради єдиної сигнатури — тут
//! обрано форму [`graphql_tooling`]: параметр відсутній узагалі, диспетчер
//! (`mod.rs::concern_violations`) просто не прокидає `files` у виклик).
//!
//! # `pass()` — завжди no-op, діагностик немає
//!
//! `createViolationReporter` (`violation-reporter.mjs:29-32`) робить
//! `pass()` **буквальним no-op** незалежно від concern-а: `result()` віддає
//! лише `{ violations }`. Жоден із `pass(...)` викликів `main.mjs`
//! (рядки 350, 365, 396, 401, 425, 444, 525, 529) не дає жодного
//! спостережуваного ефекту. Тому порт, як і [`super::graphql_tooling`], не
//! заводить жодного [`crate::diagnostics::ConcernDiagnostic`] і повертає
//! просто `Vec<Violation>` (не [`crate::diagnostics::ConcernReport`]) —
//! `run_concern` (`mod.rs`) конвертує безкоштовно через `concern_violations`.
//!
//! # Канал помилок — по кожній гілці окремо
//!
//! - [`detect_default_tpl_conf_files`] (`main.mjs:459-477`) — walkDir без
//!   `try/catch`, кожна знахідка одразу `fail(...)` з явним
//!   `reason: 'default-tpl-conf-legacy-name'` → [`Violation`] з тим самим
//!   `reason` і `data.kind`.
//! - [`detect_error_log_off_directive`] (`main.mjs:488-505`) — `readFile`
//!   всередині цикла **загорнутий** у `try { } catch { continue }`
//!   (`main.mjs:492-496`): помилка читання одного шаблону — тихий пропуск
//!   САМЕ цього файла, не violation і не [`RulesError`]. Порт: `Err(_) =>
//!   continue`, буквально те саме.
//! - [`check_template_file`] (`checkTemplateFile`, `main.mjs:343-377`):
//!   - `readFile` основного шаблону (`:345`) — **без** `try/catch` →
//!     виняток летить із `lint()` некатчений → [`RulesError::Concern`];
//!   - `readdir(dir)` для збору `*.ini` (`:355-360`) — **загорнутий** у
//!     `try/catch`, `catch` перетворює помилку на `iniNames = []` (не
//!     violation сама по собі — та сама гілка, що й «немає *.ini»,
//!     `iniNames.length === 0` нижче дає ОДНУ й ту саму violation-повідомлення
//!     для обох причин: каталог зник чи там просто нема `*.ini`);
//!   - `readFile` кожного `*.ini` (`:370-375`) — **загорнутий** у
//!     `try/catch`, помилка стає violation з текстом помилки всередині
//!     повідомлення (не [`RulesError`], не мовчазний пропуск).
//! - [`check_dockerfiles`] (`main.mjs:386-405`):
//!   - `findDockerfilePaths` (`:387`) — без `try/catch`, але
//!     [`crate::scan::walk_dir`] сам fail-safe (повертає `[]` на помилку
//!     обходу) — той самий контракт, що й `walkDir.mjs`, тож у native теж
//!     немає звідси реального `Err`;
//!   - `Promise.all(dockerPaths.map(readFile))` (`:394`) — **без**
//!     `try/catch` → одна невдача читання Dockerfile валить весь `lint()` →
//!     [`RulesError::Concern`]. Порт: перший `?` у циклі читання.
//! - [`check_vscode_nginx`] (`checkVscodeNginx`, `main.mjs:417-449`) —
//!   `runConftestBatch` (обидва виклики) без `try/catch` → [`RulesError::Concern`]
//!   (тула не резолвиться / rego-каталог відсутній / conftest впав) —
//!   [`crate::conftest::run_conftest_batch`] уже інкапсулює це як `Result`.
//!
//! # Мутаційна гілка (`rename`/`unlink`/`writeFile`) — НЕ тут
//!
//! `main.mjs` імпортує `rename`, `unlink`, `writeFile` з `node:fs/promises`,
//! але **жодна** з них не викликається з `lint()` — обидві функції, що їх
//! використовують (`migrateDefaultTplConfFiles`, `migrateErrorLogOffDirective`,
//! `main.mjs:94-148`), це T0-autofix-логіка, яку кличе виключно
//! `fix-template.mjs` (окремий T0-патерн-модуль, лишається в JS). `lint()`
//! кличе лише READ-ONLY `detect*`-пари (`detectDefaultTplConfFiles`/
//! `detectErrorLogOffDirective`), які повертають ті самі `reason`-коди
//! (`default-tpl-conf-legacy-name`/`error-log-off-directive`), що
//! `fix-template.mjs` матчить у `violations` для вирішення, чи застосовувати
//! патч. Тому порт сюди мутаційні функції взагалі не переносить — вони
//! перенесені (не портовані) прямо в `fix-template.mjs` разом із приватними
//! залежностями (`findDefaultConfTemplatePaths` для другої), byte-порт без
//! змін поведінки.
//!
//! # `http_route_matches_nginx_default_tpl` — не підключено, як і в каноні
//!
//! `httpRouteMatchesNginxDefaultTpl` (`main.mjs:235-294`) в каноні НЕ
//! викликається з `lint()` — задокументована навмисна пауза
//! (`http-route.mdc`: «реалізовано, але НЕ підключено»). Порт зберігає
//! функцію й документує той самий статус — [`http_route_matches_nginx_default_tpl`]
//! тут теж не викликається з [`nginx_default_tpl_template`].

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::cursor_ignore::{load_cursor_ignore_paths, to_relative_ignore_globs};
use crate::conftest::run_conftest_batch;
use crate::diagnostics::{Severity, Violation};
use crate::rules_package::{missing_package_root_hint, rules_root};
use crate::scan::walk_dir;
use crate::RulesError;

use super::docker_lint_hadolint::posix_rel;

/// `reason` за замовчуванням (`ctx.concernId` = `"template"`, basename
/// каталогу концерну) для кожного `fail(msg)` без явних `opts` — та сама
/// схема, що `REASON` у [`super::docker_lint`]/[`super::graphql_tooling`].
const REASON: &str = "template";

/// `reason` детектора застарілої назви — явний `{ reason:
/// 'default-tpl-conf-legacy-name' }` (`main.mjs:472`). Той самий рядок
/// матчиться `fix-template.mjs::patterns[0].test`.
const LEGACY_NAME_REASON: &str = "default-tpl-conf-legacy-name";

/// `reason` детектора невалідної директиви — явний `{ reason:
/// 'error-log-off-directive' }` (`main.mjs:500`). Той самий рядок матчиться
/// `fix-template.mjs::patterns[1].test`.
const ERROR_LOG_OFF_REASON: &str = "error-log-off-directive";

/// Каталог rego-полісі для `.vscode/extensions.json` — `policyDirRel`
/// (`main.mjs:421`).
const POLICY_DIR_EXTENSIONS: &str = "nginx-default-tpl/vscode_extensions";
/// Namespace rego-пакета для `.vscode/extensions.json` — `namespace`
/// (`main.mjs:422`).
const NAMESPACE_EXTENSIONS: &str = "nginx_default_tpl.vscode_extensions";
/// Каталог rego-полісі для `.vscode/settings.json` — `policyDirRel`
/// (`main.mjs:440`).
const POLICY_DIR_SETTINGS: &str = "nginx-default-tpl/vscode_settings";
/// Namespace rego-пакета для `.vscode/settings.json` — `namespace`
/// (`main.mjs:441`).
const NAMESPACE_SETTINGS: &str = "nginx_default_tpl.vscode_settings";

static RETURN_200_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"return\s+200").expect("valid regex"));
static GZIP_STATIC_ON_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"gzip_static\s+on").expect("valid regex"));
static PROXY_LIKE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(proxy_pass|proxy_redirect|proxy_set_header|proxy_http_version|fastcgi_pass|grpc_pass|uwsgi_pass)\b")
        .expect("valid regex")
});
static ERROR_LOG_OFF_TEST_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"error_log\s+off\s*;").expect("valid regex"));
static INI_KEY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([A-Za-z_]\w*)\s*=").expect("valid regex"));
static FIND_CMD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bfind\b").expect("valid regex"));
static GZIP_CMD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bgzip\b").expect("valid regex"));
static GZIP_EXTENSION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\*\.(?:js|css)").expect("valid regex"));

/// Basename відносного posix-шляху — рядок після останнього `/`.
fn posix_basename(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

/// `relative(root, abs) || abs` (`main.mjs:344,470,498` тощо) — коли
/// [`posix_rel`] дає порожній рядок (той самий шлях), JS-канон фолбечить на
/// ПОВНИЙ абсолютний шлях (не basename, на відміну від
/// [`super::docker_lint::check_dockerfile`]) — буквальний порт цієї
/// відмінності.
fn rel_or_abs(root: &Path, abs: &Path) -> String {
    let rel = posix_rel(root, abs);
    if rel.is_empty() {
        abs.to_string_lossy().into_owned()
    } else {
        rel
    }
}

/// Чи є basename Dockerfile / Containerfile — локальна копія, доккомент
/// модуля пояснює чому (не reuse [`super::docker_lint`]). Точний порт
/// `isDockerfileName` (`main.mjs:37-41`).
fn is_dockerfile_name(name: &str) -> bool {
    let n = name.to_lowercase();
    if n == "dockerfile" || n == "containerfile" {
        return true;
    }
    n.starts_with("dockerfile.") || n.starts_with("containerfile.")
}

/// Точний порт `findDockerfilePaths` (`main.mjs:50-61`).
fn find_dockerfile_paths(root: &Path, ignore_paths: &[String]) -> Vec<PathBuf> {
    let extra_globs = to_relative_ignore_globs(root, ignore_paths);
    let mut files: Vec<PathBuf> = walk_dir(root, &extra_globs)
        .into_iter()
        .filter(|rel| is_dockerfile_name(posix_basename(rel)))
        .map(|rel| root.join(rel))
        .collect();
    // `walk_dir` вже повертає відсортований список — `sort()` тут no-op,
    // лишений як документація інваріанта (той самий прийом, що в
    // `super::docker_lint::find_dockerfile_paths`).
    files.sort();
    files
}

/// Точний порт `findDefaultConfTemplatePaths` (`main.mjs:71-85`): будь-який
/// сегмент шляху `fixtures` виключає файл з результату.
fn find_default_conf_template_paths(root: &Path, ignore_paths: &[String]) -> Vec<PathBuf> {
    let extra_globs = to_relative_ignore_globs(root, ignore_paths);
    let mut files: Vec<PathBuf> = walk_dir(root, &extra_globs)
        .into_iter()
        .filter(|rel| {
            posix_basename(rel) == "default.conf.template"
                && !rel.split('/').any(|seg| seg == "fixtures")
        })
        .map(|rel| root.join(rel))
        .collect();
    files.sort();
    files
}

/// Імена змінних з ini (рядки `KEY=value`, без коментарів і порожніх) —
/// точний порт `parseIniVariableNames` (`main.mjs:155-166`).
fn parse_ini_variable_names(ini_text: &str) -> Vec<String> {
    let mut keys = Vec::new();
    for line in ini_text.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') || t.starts_with(';') {
            continue;
        }
        if let Some(caps) = INI_KEY_RE.captures(t) {
            keys.push(caps[1].to_string());
        }
    }
    keys
}

/// Перевіряє вміст `default.conf.template` на відповідність канону —
/// точний порт `nginxTemplateViolations` (`main.mjs:173-228`). Табличний
/// вигляд JS (масив `{ msg, ok }`) переписаний прямою послідовністю
/// перевірок — той самий порядок і ті самі повідомлення, стилістично як
/// [`super::docker_lint::check_dockerfile`].
fn nginx_template_violations(content: &str) -> Option<String> {
    if !content.contains("server_tokens off") {
        return Some("відсутнє server_tokens off".to_string());
    }
    if !content.contains("port_in_redirect off") {
        return Some("відсутнє port_in_redirect off".to_string());
    }
    if !content.contains("client_max_body_size 0") {
        return Some("відсутнє client_max_body_size 0".to_string());
    }
    if !content.contains("client_body_buffer_size 512M") {
        return Some("відсутнє client_body_buffer_size 512M".to_string());
    }
    if !content.contains("listen 8080") {
        return Some("відсутнє listen 8080".to_string());
    }
    if !content.contains("server_name _") {
        return Some("відсутнє server_name _".to_string());
    }
    if !content.contains("access_log off") {
        return Some("відсутнє access_log off".to_string());
    }
    if !content.contains("error_log /dev/null crit") {
        return Some(
            "відсутнє error_log /dev/null crit (error_log off — НЕ валідний nginx, падає під readOnlyRootFilesystem)"
                .to_string(),
        );
    }
    if !content.contains("root /usr/share/nginx/html") {
        return Some("відсутнє root /usr/share/nginx/html".to_string());
    }
    let healthz_ok = content.contains("/healthz")
        && (content.contains("healthy") || RETURN_200_RE.is_match(content));
    if !healthz_ok {
        return Some(
            "location /healthz має повертати healthy (див. nginx-default-tpl.mdc)".to_string(),
        );
    }
    let static_no_gzip_ok = content.contains("gif|jpe?g|png|ico|woff2|xlsx")
        && content.contains("31536000")
        && content.contains("alias /usr/share/nginx/html/");
    if !static_no_gzip_ok {
        return Some(
            "відсутній location для статики без gzip (gif|jpeg|png|ico|woff2|xlsx) з Cache-Control 31536000"
                .to_string(),
        );
    }
    if !content.contains("svg|js|css|ttf|map|xml|webmanifest|wasm") {
        return Some(
            "відсутній location для svg|js|css|ttf|map|xml|webmanifest|wasm з gzip_static"
                .to_string(),
        );
    }
    if GZIP_STATIC_ON_RE.find_iter(content).count() < 2 {
        return Some(
            "gzip_static on має бути принаймні двічі (два location зі стисненням)".to_string(),
        );
    }
    if !content.contains("$PUBLIC_PATH") {
        return Some("відсутнє використання $PUBLIC_PATH у location".to_string());
    }
    let sendfile_ok = content.contains("sendfile on")
        && content.contains("sendfile_max_chunk 512k")
        && content.contains("tcp_nopush on");
    if !sendfile_ok {
        return Some("відсутні sendfile on; sendfile_max_chunk 512k; tcp_nopush on".to_string());
    }
    if !content.contains("try_files $uri $uri/ /index.html =404") {
        return Some("відсутнє try_files $uri $uri/ /index.html =404".to_string());
    }
    // cspell:ignore fastcgi uwsgi
    if PROXY_LIKE_RE.is_match(content) {
        return Some(
            "знайдено proxy, gRPC або інший *_pass до бекенду — прибери з шаблону, логіку винеси в HTTPRoute (k8s) (див. nginx-default-tpl.mdc)"
                .to_string(),
        );
    }
    None
}

/// Чи HTTPRoute відповідає патерну Exact→RequestRedirect(301, https) +
/// PathPrefix→backendRefs:8080 — точний порт `httpRouteMatchesNginxDefaultTpl`
/// (`main.mjs:235-294`). **Не викликається** з [`nginx_default_tpl_template`]
/// (доккомент модуля, секція «не підключено, як і в каноні») — той самий
/// статус, що й в оригіналі, де функція експортується, але `lint()` її не
/// кличе. `#[allow(dead_code)]` — той самий прецедент, що
/// `super::abie_overlay_paths::is_abie_k8s_base_yaml_path` (портовано для
/// повноти дзеркала канону, не для активного виклику). `manifest` —
/// `serde_json::Value` (той самий носій YAML-документа, що
/// [`super::abie_http_route`] уже використовує для generic YAML-структур).
#[allow(dead_code)]
pub(crate) fn http_route_matches_nginx_default_tpl(manifest: &serde_json::Value) -> bool {
    let Some(m) = manifest.as_object() else {
        return false;
    };
    if m.get("kind").and_then(serde_json::Value::as_str) != Some("HTTPRoute") {
        return false;
    }
    let Some(spec) = m.get("spec").and_then(serde_json::Value::as_object) else {
        return false;
    };
    let Some(rules) = spec.get("rules").and_then(serde_json::Value::as_array) else {
        return false;
    };
    if rules.len() < 2 {
        return false;
    }
    let Some(r0) = rules[0].as_object() else {
        return false;
    };
    let Some(r1) = rules[1].as_object() else {
        return false;
    };

    let has_exact = r0
        .get("matches")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|matches| {
            matches.iter().any(|x| {
                x.as_object()
                    .and_then(|o| o.get("path"))
                    .and_then(serde_json::Value::as_object)
                    .and_then(|p| p.get("type"))
                    .and_then(serde_json::Value::as_str)
                    == Some("Exact")
            })
        });

    let has_redirect = r0
        .get("filters")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|filters| {
            filters.iter().any(|f| {
                let Some(fo) = f.as_object() else {
                    return false;
                };
                if fo.get("type").and_then(serde_json::Value::as_str) != Some("RequestRedirect") {
                    return false;
                }
                let Some(rr) = fo
                    .get("requestRedirect")
                    .and_then(serde_json::Value::as_object)
                else {
                    return false;
                };
                let scheme_ok =
                    rr.get("scheme").and_then(serde_json::Value::as_str) == Some("https");
                let path_ok = rr
                    .get("path")
                    .and_then(serde_json::Value::as_object)
                    .and_then(|p| p.get("type"))
                    .and_then(serde_json::Value::as_str)
                    == Some("ReplaceFullPath");
                let code_ok = match rr.get("statusCode") {
                    Some(serde_json::Value::Number(n)) => n.as_i64() == Some(301),
                    Some(serde_json::Value::String(s)) => s == "301",
                    _ => false,
                };
                scheme_ok && path_ok && code_ok
            })
        });

    let has_prefix = r1
        .get("matches")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|matches| {
            matches.iter().any(|x| {
                x.as_object()
                    .and_then(|o| o.get("path"))
                    .and_then(serde_json::Value::as_object)
                    .and_then(|p| p.get("type"))
                    .and_then(serde_json::Value::as_str)
                    == Some("PathPrefix")
            })
        });

    let has_8080 = r1
        .get("backendRefs")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|backends| {
            backends.iter().any(|b| {
                let Some(bo) = b.as_object() else {
                    return false;
                };
                match bo.get("port") {
                    Some(serde_json::Value::Number(n)) => n.as_i64() == Some(8080),
                    Some(serde_json::Value::String(s)) => s == "8080",
                    _ => false,
                }
            })
        });

    has_exact && has_redirect && has_prefix && has_8080
}

/// Кожен ключ з ini має входити в шаблон як `$KEY` — точний порт
/// `iniKeysMissingInTemplate` (`main.mjs:302-309`).
fn ini_keys_missing_in_template(keys: &[String], template: &str) -> Option<String> {
    for k in keys {
        if !template.contains(&format!("${k}")) {
            return Some(format!(
                "змінна \"{k}\" з *.ini не використовується в шаблоні — вилучи її з ini або додай у шаблон ${k} (див. nginx-default-tpl.mdc)"
            ));
        }
    }
    None
}

/// Чи Dockerfile містить RUN із find/gzip для статики — точний порт
/// `dockerfileHasGzipStaticPipeline` (`main.mjs:316-325`).
fn dockerfile_has_gzip_static_pipeline(content: &str) -> bool {
    FIND_CMD_RE.is_match(content)
        && content.contains("/usr/share/nginx/html")
        && GZIP_CMD_RE.is_match(content)
        && content.contains("-k")
        && GZIP_EXTENSION_RE.is_match(content)
}

/// Чи Dockerfile містить envsubst для шаблону — точний порт
/// `dockerfileHasEnvsSubstTemplate` (`main.mjs:332-334`).
fn dockerfile_has_envsubst_template(content: &str) -> bool {
    content.contains("envsubst") && content.contains("default.conf.template")
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

/// Read-only детектор `default.tpl.conf` — точний порт
/// `detectDefaultTplConfFiles` (`main.mjs:459-477`). T0-фікс (перейменування)
/// лишається в `fix-template.mjs` — доккомент модуля, секція «Мутаційна
/// гілка».
fn detect_default_tpl_conf_files(
    root: &Path,
    ignore_paths: &[String],
    violations: &mut Vec<Violation>,
) {
    let extra_globs = to_relative_ignore_globs(root, ignore_paths);
    let old_paths: Vec<PathBuf> = walk_dir(root, &extra_globs)
        .into_iter()
        .filter(|rel| posix_basename(rel) == "default.tpl.conf")
        .map(|rel| root.join(rel))
        .collect();
    for abs in &old_paths {
        let rel = rel_or_abs(root, abs);
        violations.push(Violation {
            reason: LEGACY_NAME_REASON.to_string(),
            message: format!(
                "{rel}: застарілий файл default.tpl.conf — перейменуй на default.conf.template (nginx-default-tpl.mdc)"
            ),
            file: Some(rel.clone()),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "kind": LEGACY_NAME_REASON })),
        });
    }
}

/// Read-only детектор `error_log off;` — точний порт
/// `detectErrorLogOffDirective` (`main.mjs:488-505`). `readFile`-помилка
/// одного шаблону — тихий `continue` (доккомент модуля, секція «Канал
/// помилок»). T0-фікс лишається в `fix-template.mjs`.
fn detect_error_log_off_directive(
    root: &Path,
    ignore_paths: &[String],
    violations: &mut Vec<Violation>,
) {
    let templates = find_default_conf_template_paths(root, ignore_paths);
    for abs in &templates {
        let body = match std::fs::read_to_string(abs) {
            Ok(b) => b,
            Err(_) => continue,
        };
        if !body.contains("error_log") || !ERROR_LOG_OFF_TEST_RE.is_match(&body) {
            continue;
        }
        let rel = rel_or_abs(root, abs);
        violations.push(Violation {
            reason: ERROR_LOG_OFF_REASON.to_string(),
            message: format!(
                "{rel}: невалідна директива error_log off; — замінити на error_log /dev/null crit; (nginx-default-tpl.mdc)"
            ),
            file: Some(rel.clone()),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "kind": ERROR_LOG_OFF_REASON })),
        });
    }
}

/// Перевіряє один template-файл і поруч `*.ini` — точний порт
/// `checkTemplateFile` (`main.mjs:343-377`). Канал помилок кожної гілки —
/// доккомент модуля.
fn check_template_file(
    abs: &Path,
    root: &Path,
    violations: &mut Vec<Violation>,
) -> Result<(), RulesError> {
    let rel = rel_or_abs(root, abs);
    // `readFile` без `try/catch` у JS (`main.mjs:345`) — некатчена помилка
    // летить із `lint()`.
    let content = std::fs::read_to_string(abs).map_err(|error| {
        RulesError::Concern(format!("{rel}: не вдалося прочитати шаблон ({error})"))
    })?;

    if let Some(v) = nginx_template_violations(&content) {
        violations.push(plain_violation(format!("{rel}: {v}")));
    }

    let dir = abs.parent().unwrap_or(root);
    // `readdir` загорнутий у `try/catch` у JS (`:355-360`) — помилка стає
    // порожнім списком, не окремою violation/[`RulesError`].
    let ini_names: Vec<String> = match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(std::result::Result::ok)
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| n.ends_with(".ini"))
            .collect(),
        Err(_) => Vec::new(),
    };

    if ini_names.is_empty() {
        violations.push(plain_violation(format!(
            "{rel}: поруч немає жодного *.ini — додай values-*.ini для середовищ (див. nginx-default-tpl.mdc)"
        )));
        return Ok(());
    }

    for ini_name in &ini_names {
        let ini_path = dir.join(ini_name);
        let ini_rel = rel_or_abs(root, &ini_path);
        // `readFile` загорнутий у `try/catch` у JS (`:369-375`) — помилка
        // стає violation з текстом помилки всередині повідомлення.
        match std::fs::read_to_string(&ini_path) {
            Ok(ini_raw) => {
                let keys = parse_ini_variable_names(&ini_raw);
                if let Some(miss) = ini_keys_missing_in_template(&keys, &content) {
                    violations.push(plain_violation(format!("{ini_rel}: {miss}")));
                }
            }
            Err(error) => {
                violations.push(plain_violation(format!(
                    "{ini_rel}: не вдалося прочитати ({error})"
                )));
            }
        }
    }
    Ok(())
}

/// Перевіряє Dockerfile-и на наявність gzip та envsubst — точний порт
/// `checkDockerfiles` (`main.mjs:386-405`). Канал помилок — доккомент
/// модуля.
fn check_dockerfiles(
    root: &Path,
    ignore_paths: &[String],
    violations: &mut Vec<Violation>,
) -> Result<(), RulesError> {
    let docker_paths = find_dockerfile_paths(root, ignore_paths);
    if docker_paths.is_empty() {
        violations.push(plain_violation(
            "Є default.conf.template, але немає Dockerfile / Containerfile — додай gzip для статики та envsubst (див. nginx-default-tpl.mdc)"
                .to_string(),
        ));
        return Ok(());
    }

    // `Promise.all(dockerPaths.map(readFile))` без `try/catch` у JS
    // (`main.mjs:394`) — перша невдача читання валить увесь `lint()`.
    let mut bodies = Vec::with_capacity(docker_paths.len());
    for p in &docker_paths {
        let content = std::fs::read_to_string(p).map_err(|error| {
            RulesError::Concern(format!(
                "{}: не вдалося прочитати Dockerfile ({error})",
                rel_or_abs(root, p)
            ))
        })?;
        bodies.push(content);
    }

    if !bodies
        .iter()
        .any(|b| dockerfile_has_gzip_static_pipeline(b))
    {
        violations.push(plain_violation(
            "Dockerfile: потрібен RUN find … /usr/share/nginx/html … gzip -k (див. nginx-default-tpl.mdc)".to_string(),
        ));
    }
    if !bodies.iter().any(|b| dockerfile_has_envsubst_template(b)) {
        violations.push(plain_violation(
            "Dockerfile: потрібен envsubst з default.conf.template (див. nginx-default-tpl.mdc)"
                .to_string(),
        ));
    }
    Ok(())
}

/// Один прогін `runConftestBatch` + збір violations — спільне тіло для обох
/// `.vscode/*.json` перевірок у `checkVscodeNginx`.
fn run_vscode_conftest(
    cwd: &Path,
    policy_dir_rel: &str,
    namespace: &str,
    target: &Path,
    violations: &mut Vec<Violation>,
) -> Result<(), RulesError> {
    let root = rules_root(cwd).ok_or_else(|| RulesError::Concern(missing_package_root_hint()))?;
    let policy_abs = root.join(policy_dir_rel);
    let failures = run_conftest_batch(&policy_abs, namespace, &[target.to_path_buf()])?;
    for failure in failures {
        violations.push(plain_violation(failure.message));
    }
    Ok(())
}

/// Делегує валідацію `.vscode/extensions.json` і `.vscode/settings.json` —
/// точний порт `checkVscodeNginx` (`main.mjs:417-449`). Викликається лише
/// після того, як [`nginx_default_tpl_template`] виявив хоча б один
/// `default.conf.template` (умовне правило, як у JS-каноні).
fn check_vscode_nginx(cwd: &Path, violations: &mut Vec<Violation>) -> Result<(), RulesError> {
    let ext_path = cwd.join(".vscode/extensions.json");
    if ext_path.exists() {
        run_vscode_conftest(
            cwd,
            POLICY_DIR_EXTENSIONS,
            NAMESPACE_EXTENSIONS,
            &ext_path,
            violations,
        )?;
    } else {
        violations.push(plain_violation(
            "Очікується .vscode/extensions.json з ahmadalli.vscode-nginx-conf (див. nginx-default-tpl.mdc)".to_string(),
        ));
    }

    let set_path = cwd.join(".vscode/settings.json");
    if !set_path.exists() {
        violations.push(plain_violation(
            "Очікується .vscode/settings.json з форматером nginx і formatOnSave (див. nginx-default-tpl.mdc)"
                .to_string(),
        ));
        return Ok(());
    }
    run_vscode_conftest(
        cwd,
        POLICY_DIR_SETTINGS,
        NAMESPACE_SETTINGS,
        &set_path,
        violations,
    )
}

/// Detector `nginx-default-tpl/template` — точний порт `lint(ctx)`
/// (`main.mjs:512-539`). `files` відсутній у сигнатурі (доккомент модуля,
/// секція «`ctx.files` ігнорується»).
pub fn nginx_default_tpl_template(cwd: &Path) -> Result<Vec<Violation>, RulesError> {
    let ignore_paths = load_cursor_ignore_paths(cwd);
    let mut violations = Vec::new();

    detect_default_tpl_conf_files(cwd, &ignore_paths, &mut violations);
    detect_error_log_off_directive(cwd, &ignore_paths, &mut violations);

    let templates = find_default_conf_template_paths(cwd, &ignore_paths);
    if templates.is_empty() {
        return Ok(violations);
    }

    for abs in &templates {
        check_template_file(abs, cwd, &mut violations)?;
    }

    check_dockerfiles(cwd, &ignore_paths, &mut violations)?;
    check_vscode_nginx(cwd, &mut violations)?;

    Ok(violations)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    const CANON_TEMPLATE: &str = "server_tokens off;\nport_in_redirect off;\nclient_max_body_size 0;\nclient_body_buffer_size 512M;\n\nserver {\n    listen 8080;\n    server_name _;\n\n    access_log off;\n    error_log /dev/null crit;\n\n    root /usr/share/nginx/html;\n\n    location /healthz {\n        add_header Content-Type text/plain;\n        access_log off;\n        return 200 \"healthy\";\n    }\n\n    location ~ ^$PUBLIC_PATH/(.+\\.(?:gif|jpe?g|png|ico|woff2|xlsx))$ {\n        alias /usr/share/nginx/html/$1;\n        add_header 'Cache-Control' \"public,max-age=31536000,immutable\";\n    }\n\n    location ~ ^$PUBLIC_PATH/(.+\\.(?:svg|js|css|ttf|map|xml|webmanifest|wasm))$ {\n        alias /usr/share/nginx/html/$1;\n        add_header 'Cache-Control' \"public,max-age=31536000,immutable\";\n        gzip_static on;\n    }\n\n    location $PUBLIC_PATH/ {\n        index index.html;\n        alias /usr/share/nginx/html/;\n        sendfile on;\n        sendfile_max_chunk 512k;\n        tcp_nopush on;\n        gzip_static on;\n        try_files $uri $uri/ /index.html =404;\n    }\n}\n";

    // --- is_dockerfile_name / find_dockerfile_paths ---

    #[test]
    fn dockerfile_name_matches_canonical_and_suffixed_forms() {
        assert!(is_dockerfile_name("Dockerfile"));
        assert!(is_dockerfile_name("containerfile.dev"));
        assert!(!is_dockerfile_name("App.Dockerfile"));
    }

    #[test]
    fn find_dockerfile_paths_collects_dockerfile_and_containerfile() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "Dockerfile", "FROM scratch\n");
        write(&tmp, "a/Containerfile.dev", "FROM scratch\n");
        let found = find_dockerfile_paths(tmp.path(), &[]);
        assert_eq!(found.len(), 2);
    }

    // --- find_default_conf_template_paths: fixtures виключені ---

    #[test]
    fn find_default_conf_template_paths_skips_fixtures_segment() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "default.conf.template", "x");
        write(&tmp, "tests/fixtures/default.conf.template", "y");
        write(
            &tmp,
            "rules/x/js/concern/fixtures/default.conf.template",
            "z",
        );
        let found = find_default_conf_template_paths(tmp.path(), &[]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0], tmp.path().join("default.conf.template"));
    }

    // --- parse_ini_variable_names ---

    #[test]
    fn parse_ini_variable_names_skips_comments_and_blanks() {
        let ini = "PUBLIC_PATH=/app\n# comment\n; also comment\n\nSERVICE_NAME=my-frontend\n";
        assert_eq!(
            parse_ini_variable_names(ini),
            vec!["PUBLIC_PATH".to_string(), "SERVICE_NAME".to_string()]
        );
    }

    #[test]
    fn parse_ini_variable_names_empty_for_no_matches() {
        assert!(parse_ini_variable_names("# only comments\n\n").is_empty());
    }

    // --- ini_keys_missing_in_template ---

    #[test]
    fn ini_keys_missing_in_template_none_when_all_used() {
        let keys = vec!["PUBLIC_PATH".to_string()];
        assert_eq!(
            ini_keys_missing_in_template(&keys, "location $PUBLIC_PATH/ {}"),
            None
        );
    }

    #[test]
    fn ini_keys_missing_in_template_reports_first_missing() {
        let keys = vec!["PUBLIC_PATH".to_string(), "SERVICE_NAME".to_string()];
        let msg = ini_keys_missing_in_template(&keys, "location $PUBLIC_PATH/ {}").unwrap();
        assert!(msg.contains("SERVICE_NAME"));
    }

    // --- nginx_template_violations: дзеркало rules-масиву main.mjs ---

    #[test]
    fn canon_template_has_no_violations() {
        assert_eq!(nginx_template_violations(CANON_TEMPLATE), None);
    }

    #[test]
    fn missing_server_tokens_off_is_first_violation() {
        let broken = CANON_TEMPLATE.replace("server_tokens off;\n", "");
        let msg = nginx_template_violations(&broken).unwrap();
        assert!(msg.contains("server_tokens off"));
    }

    #[test]
    fn error_log_off_directive_is_reported_as_missing_canonical_form() {
        let broken = CANON_TEMPLATE.replace("error_log /dev/null crit;", "error_log off;");
        let msg = nginx_template_violations(&broken).unwrap();
        assert!(msg.contains("error_log /dev/null crit"));
    }

    #[test]
    fn single_gzip_static_on_occurrence_fails_the_pair_requirement() {
        let broken = CANON_TEMPLATE.replacen("gzip_static on;\n", "", 1);
        let msg = nginx_template_violations(&broken).unwrap();
        assert!(msg.contains("gzip_static on"));
        assert!(msg.contains("двічі"));
    }

    #[test]
    fn proxy_pass_is_forbidden_even_when_everything_else_is_canonical() {
        let with_proxy = format!("{CANON_TEMPLATE}\n# proxy_pass http://backend;\n");
        let msg = nginx_template_violations(&with_proxy).unwrap();
        assert!(msg.contains("proxy"));
    }

    #[test]
    fn fastcgi_pass_is_also_forbidden() {
        let with_fastcgi = format!("{CANON_TEMPLATE}\nfastcgi_pass 127.0.0.1:9000;\n");
        let msg = nginx_template_violations(&with_fastcgi).unwrap();
        assert!(msg.contains("proxy"));
    }

    // --- dockerfile_has_gzip_static_pipeline / dockerfile_has_envsubst_template ---

    #[test]
    fn gzip_static_pipeline_detected() {
        let df = "RUN find /usr/share/nginx/html -type f -name '*.js' -exec gzip -k {} +\n";
        assert!(dockerfile_has_gzip_static_pipeline(df));
    }

    #[test]
    fn gzip_static_pipeline_missing_flag_k_is_false() {
        let df = "RUN find /usr/share/nginx/html -type f -name '*.js' -exec gzip {} +\n";
        assert!(!dockerfile_has_gzip_static_pipeline(df));
    }

    #[test]
    fn envsubst_template_detected() {
        assert!(dockerfile_has_envsubst_template(
            "RUN envsubst < default.conf.template > /app/default.conf\n"
        ));
        assert!(!dockerfile_has_envsubst_template("RUN echo hi\n"));
    }

    // --- http_route_matches_nginx_default_tpl ---

    fn canonical_http_route() -> serde_json::Value {
        serde_json::json!({
            "kind": "HTTPRoute",
            "spec": {
                "rules": [
                    {
                        "matches": [{ "path": { "type": "Exact", "value": "/app" } }],
                        "filters": [{
                            "type": "RequestRedirect",
                            "requestRedirect": {
                                "scheme": "https",
                                "path": { "type": "ReplaceFullPath", "replaceFullPath": "/app/" },
                                "statusCode": 301
                            }
                        }]
                    },
                    {
                        "matches": [{ "path": { "type": "PathPrefix", "value": "/app/" } }],
                        "backendRefs": [{ "name": "svc", "port": 8080 }]
                    }
                ]
            }
        })
    }

    #[test]
    fn http_route_canonical_shape_matches() {
        assert!(http_route_matches_nginx_default_tpl(&canonical_http_route()));
    }

    #[test]
    fn http_route_wrong_kind_does_not_match() {
        let mut manifest = canonical_http_route();
        manifest["kind"] = serde_json::json!("Ingress");
        assert!(!http_route_matches_nginx_default_tpl(&manifest));
    }

    #[test]
    fn http_route_string_status_code_and_port_also_match() {
        let mut manifest = canonical_http_route();
        manifest["spec"]["rules"][0]["filters"][0]["requestRedirect"]["statusCode"] =
            serde_json::json!("301");
        manifest["spec"]["rules"][1]["backendRefs"][0]["port"] = serde_json::json!("8080");
        assert!(http_route_matches_nginx_default_tpl(&manifest));
    }

    #[test]
    fn http_route_missing_second_rule_does_not_match() {
        let mut manifest = canonical_http_route();
        manifest["spec"]["rules"] = serde_json::json!([manifest["spec"]["rules"][0].clone()]);
        assert!(!http_route_matches_nginx_default_tpl(&manifest));
    }

    #[test]
    fn http_route_non_object_manifest_does_not_match() {
        assert!(!http_route_matches_nginx_default_tpl(&serde_json::json!(
            null
        )));
        assert!(!http_route_matches_nginx_default_tpl(&serde_json::json!([
            1, 2
        ])));
    }

    // --- detect_default_tpl_conf_files / detect_error_log_off_directive ---

    #[test]
    fn detect_default_tpl_conf_files_reports_legacy_name_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "default.tpl.conf", "server {}");
        let mut violations = Vec::new();
        detect_default_tpl_conf_files(tmp.path(), &[], &mut violations);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, LEGACY_NAME_REASON);
        assert_eq!(violations[0].file.as_deref(), Some("default.tpl.conf"));
        assert_eq!(
            violations[0].data.as_ref().unwrap()["kind"],
            serde_json::json!(LEGACY_NAME_REASON)
        );
    }

    #[test]
    fn detect_default_tpl_conf_files_silent_when_absent() {
        let tmp = TempDir::new().unwrap();
        let mut violations = Vec::new();
        detect_default_tpl_conf_files(tmp.path(), &[], &mut violations);
        assert!(violations.is_empty());
    }

    #[test]
    fn detect_error_log_off_directive_reports_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "default.conf.template", "server { error_log off; }");
        let mut violations = Vec::new();
        detect_error_log_off_directive(tmp.path(), &[], &mut violations);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, ERROR_LOG_OFF_REASON);
    }

    #[test]
    fn detect_error_log_off_directive_silent_for_canonical_directive() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "default.conf.template",
            "server { error_log /dev/null crit; }",
        );
        let mut violations = Vec::new();
        detect_error_log_off_directive(tmp.path(), &[], &mut violations);
        assert!(violations.is_empty());
    }

    // --- nginx_default_tpl_template(cwd): дзеркало check-rule-fixtures.test.mjs ---

    /// «0 — немає default.conf.template → перевірку пропущено» (JS: рядки
    /// 234-238).
    #[test]
    fn no_template_yields_no_violations() {
        let tmp = TempDir::new().unwrap();
        assert!(nginx_default_tpl_template(tmp.path()).unwrap().is_empty());
    }

    /// «1 — є шаблон, немає *.ini і Dockerfile» (JS: рядки 240-245): в цьому
    /// сценарії `.vscode/*.json` теж відсутні, тож `check_vscode_nginx` не
    /// доходить до `run_conftest_batch` (просто `fail`) — не потребує
    /// `N_RULES_PACKAGE_ROOT`.
    #[test]
    fn template_without_ini_and_dockerfile_yields_violations() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "default.conf.template", CANON_TEMPLATE);
        let violations = nginx_default_tpl_template(tmp.path()).unwrap();
        assert!(!violations.is_empty());
        assert!(violations.iter().any(|v| v.message.contains("*.ini")));
        assert!(violations
            .iter()
            .any(|v| v.message.contains("Dockerfile / Containerfile")));
        assert!(violations.iter().all(|v| v.reason == REASON));
    }

    /// «1 — шаблон + ini + Dockerfile без gzip і envsubst» (JS: рядки
    /// 247-253).
    #[test]
    fn template_with_ini_and_bare_dockerfile_yields_violations() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "default.conf.template", CANON_TEMPLATE);
        write(&tmp, "values-dev.ini", "PUBLIC_PATH=/app\n");
        write(&tmp, "Dockerfile", "FROM nginx:alpine\n");
        let violations = nginx_default_tpl_template(tmp.path()).unwrap();
        assert!(violations.iter().any(|v| v.message.contains("gzip -k")));
        assert!(violations.iter().any(|v| v.message.contains("envsubst")));
    }

    /// Гейт відкритий (шаблон валідний, `.vscode/extensions.json` є), але
    /// корінь пакета `@7n/rules` не резолвиться з tmp-дерева поза репо →
    /// fail-closed з підказкою — той самий прийом, що
    /// `graphql_tooling::open_extensions_gate_without_package_root_fails_closed`.
    /// Тест свідомо НЕ мутує `N_RULES_PACKAGE_ROOT` (паралельні тести крейта).
    #[test]
    fn vscode_gate_without_package_root_fails_closed() {
        if std::env::var("N_RULES_PACKAGE_ROOT").is_ok() {
            return; // оточення з явним override — сценарій недосяжний
        }
        let tmp = TempDir::new().unwrap();
        write(&tmp, "default.conf.template", CANON_TEMPLATE);
        write(&tmp, "values-dev.ini", "PUBLIC_PATH=/app\n");
        write(
            &tmp,
            "Dockerfile",
            "FROM nginx:alpine-slim\nRUN find /usr/share/nginx/html -name '*.js' -exec gzip -k {} +\nRUN envsubst < default.conf.template > /app/default.conf\n",
        );
        write(&tmp, ".vscode/extensions.json", r#"{"recommendations":[]}"#);
        let err = nginx_default_tpl_template(tmp.path()).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("N_RULES_PACKAGE_ROOT"), "{err}");
    }

    /// Обидва `detect*`-порушення (legacy name + error_log off) співіснують
    /// у результаті з рештою перевірок, коли шаблонів декілька.
    #[test]
    fn legacy_name_and_error_log_violations_coexist_with_template_checks() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "default.tpl.conf", "server { error_log off; }");
        write(
            &tmp,
            "sub/default.conf.template",
            "server { error_log off; }",
        );
        let violations = nginx_default_tpl_template(tmp.path()).unwrap();
        assert!(violations.iter().any(|v| v.reason == LEGACY_NAME_REASON));
        assert!(violations.iter().any(|v| v.reason == ERROR_LOG_OFF_REASON));
        assert!(violations.iter().any(|v| v.reason == REASON));
    }
}
