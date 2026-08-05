//! Native-порт **per-file циклу** концерну `k8s/manifests`
//! (`npm/rules/k8s/manifests/main.mjs`) — шар 2 з чотирьох, що лишались після
//! зрізу 1 (PR #393).
//!
//! # Обсяг модуля
//!
//! `lint()` крутить `for (const abs of yamlFiles) await checkK8sYamlFile(...)`
//! (`main.mjs:6547-6549`). Уся змістовна частина цього циклу — **modeline
//! `# yaml-language-server: $schema=…`**: чи він узагалі є, чи стоїть першим
//! рядком, чи він один на файл, і чи його URL збігається з тим, який диктує
//! `apiVersion`/`kind` документа. Per-document структурні правила (Ingress,
//! Gateway API, `metadata.namespace`, …) до цього шару не належать — вони ще
//! з Plan B живуть у rego (`runAllK8sRego`, портовано зрізом 1).
//!
//! | Rust | JS |
//! |---|---|
//! | [`check_k8s_yaml_files`] | цикл `checkK8sYamlFile` (`main.mjs:3303-3360`) |
//! | [`expected_schema_url`] | `expectedSchemaUrl` (`main.mjs:3194-3211`) |
//! | [`k8s_yaml_first_doc_is_alb_yc_http_backend_group`] | `k8sYamlFirstDocIsAlbYcHttpBackendGroup` (`main.mjs:1933-1937`) |
//! | [`detect_gateway_http_route_v1beta1`] | `detectGatewayHttpRouteV1beta1InK8sYamlFiles` (`main.mjs:1778-1800`) |
//! | [`detect_batch_v1beta1`] | `detectBatchV1beta1InK8sYamlFiles` (`main.mjs:1806-1830`) |
//!
//! # Полагоджений дефект канону: обидва `detect*` не спрацьовували ніколи
//!
//! `BATCH_V1BETA1_API_VERSION_LINE_RE` і `GATEWAY_HTTPROUTE_V1BETA1_LINE_RE` —
//! **рядкові** якірні регулярні вирази (`^(\s*apiVersion:\s*)…(\s*)$`, без
//! прапорця `m`). Саме так їх застосовує T0-фікс: `rewriteLine*` бере по
//! одному рядку. Але обидва детектори звіряли ту саму regex із **усім**
//! текстом файла (`RE.test(raw)`), а без `m` якорі `^`/`$` означають початок
//! і кінець **рядка-як-цілого**. Збіг був можливий рівно на файлі, що цілком
//! складається з одного рядка `apiVersion: batch/v1beta1` — тобто ніколи на
//! справжньому маніфесті.
//!
//! Наслідок: заборона застарілих `batch/v1beta1` і
//! `gateway.networking.k8s.io/v1beta1` була **мертвою** — попри те, що для
//! неї є повідомлення, T0-патерни `fix-manifests.mjs` і окремі розділи
//! `manifest.mdc` / `gateway.mdc`, які обіцяють автоматичне переписування.
//! Юніт-тести покривали лише `replaceBatchV1beta1ApiVersionInYamlText`
//! (сам rewrite), а не детектор, тож дефект не було видно.
//!
//! Полагоджено в обидві сторони: JS-канон тепер звіряє regex по рядках
//! (`body.split(YAML_LINE_SPLIT_RE)` + звірка кожного рядка — рівно так, як сусідня
//! перевірка `kind: HTTPRoute` робила від початку), і порт відтворює вже
//! полагоджену поведінку. Напрямок зміни fail-closed: під перевірку
//! потрапляють файли, які раніше мовчки проходили.
//!
//! # Чому без YAML-парсера
//!
//! Канон тут навмисно **не** парсить YAML: `extractApiVersionAndKind`
//! (`main.mjs:1898`) і `extractTopLevelManifestType` (`main.mjs:126`) — це
//! regex по окремих рядках тексту першого документа. Порт це відтворює
//! посимвольно, бо будь-який справжній парсер зійшовся б інакше на
//! напівзламаних файлах (а саме там правило й спрацьовує).
//!
//! Побічний наслідок, успадкований разом із каноном: `TYPE_FIELD_RE`
//! (`^\s*type:\s*(\S+)\s*$`) допускає **будь-який** відступ, тож «кореневим»
//! `type:` вважається і вкладений (напр. `spec.type`). Це впливає рівно на
//! пошук у таблиці [`EXPLICIT_K8S_SCHEMAS`] і відтворено як є — інакше порт
//! і канон розійшлися б на Service з `spec.type: ClusterIP`.
//!
//! # Де паритет свідомо не побайтовий
//!
//! Гілка «не вдалося прочитати» (`main.mjs:3317`) вставляє в текст
//! `error.message` рантайму (Node vs `std::io::Error`). Вона недосяжна на
//! нормальному вході — шляхи приходять із `findK8sYamlFiles`, тобто щойно
//! існували, — а решта повідомлень збігається посимвольно (Р11 п. 4).
//!
//! `\s` регулярних виразів JS відтворено через [`char::is_whitespace`]: множини
//! різняться рівно на `U+FEFF` (є в JS, немає в Rust) і `U+0085` (навпаки).
//! BOM зрізається окремо в [`to_lines`], тож розбіжність лишається суто
//! теоретичною.

use std::path::{Path, PathBuf};

use crate::concerns::k8s_manifests_rego::{rel_posix, DEFAULT_REASON};
use crate::diagnostics::{Severity, Violation};

/// Версія набору схем yannh — порт `YANNH_PIN` (`main.mjs:21`).
const YANNH_PIN: &str = "v1.33.9-standalone-strict";

/// Гілка `yannh/kubernetes-json-schema` — порт `YANNH_REF` (`main.mjs:48`).
const YANNH_REF: &str = "master";

/// Схема kustomization — порт `KUSTOMIZATION_SCHEMA` (`main.mjs:50`).
const KUSTOMIZATION_SCHEMA: &str = "https://json.schemastore.org/kustomization.json";

/// Публікація CRDs-catalog на GitHub Pages — порт `DATREE_CRD_BASE`
/// (`main.mjs:55`).
const DATREE_CRD_BASE: &str = "https://datreeio.github.io/CRDs-catalog/";

/// Гілка raw-дерева CRDs-catalog — порт `DATREE_CRD_RAW_REF` (`main.mjs:58`).
const DATREE_CRD_RAW_REF: &str = "main";

/// Базовий URL наборів yannh — порт `YANNH_BASE` (`main.mjs:52`).
fn yannh_base() -> String {
    format!(
        "https://raw.githubusercontent.com/yannh/kubernetes-json-schema/{YANNH_REF}/{YANNH_PIN}/"
    )
}

/// Базовий raw-URL CRDs-catalog — порт `DATREE_CRD_RAW_BASE` (`main.mjs:60`).
fn datree_crd_raw_base() -> String {
    format!("https://raw.githubusercontent.com/datreeio/CRDs-catalog/{DATREE_CRD_RAW_REF}/")
}

/// Групи API Kubernetes зі схемами yannh — порт `YANNH_GROUPS`
/// (`main.mjs:158-181`).
const YANNH_GROUPS: &[&str] = &[
    "admissionregistration.k8s.io",
    "apiextensions.k8s.io",
    "apiregistration.k8s.io",
    "apps",
    "authentication.k8s.io",
    "authorization.k8s.io",
    "autoscaling",
    "batch",
    "certificates.k8s.io",
    "coordination.k8s.io",
    "discovery.k8s.io",
    "events.k8s.io",
    "flowcontrol.apiserver.k8s.io",
    "internal.apiserver.k8s.io",
    "networking.k8s.io",
    "node.k8s.io",
    "policy",
    "rbac.authorization.k8s.io",
    "resource.k8s.io",
    "scheduling.k8s.io",
    "storage.k8s.io",
    "storagemigration.k8s.io",
];

/// «Будь-який / відсутній `type`» у ключі таблиці — порт
/// `K8S_EXPLICIT_SCHEMA_TYPE_ANY` (`main.mjs:69`).
const EXPLICIT_SCHEMA_TYPE_ANY: &str = "*";

/// Один запис таблиці явних схем — порт значення `EXPLICIT_K8S_SCHEMAS`.
struct ExplicitSchema {
    /// `apiVersion` маніфесту.
    api_version: &'static str,
    /// `kind` як у YAML (регістр збережено).
    kind: &'static str,
    /// Значення кореневого `type:` або [`EXPLICIT_SCHEMA_TYPE_ANY`].
    type_key: &'static str,
    /// Хвіст URL після базового префікса.
    schema_suffix: &'static str,
    /// Який базовий префікс приклеїти до [`Self::schema_suffix`].
    base: SchemaBase,
    /// Пояснення для тексту повідомлення.
    reason: &'static str,
}

/// Який базовий URL використовує запис [`ExplicitSchema`].
#[derive(Clone, Copy)]
enum SchemaBase {
    /// [`yannh_base`].
    Yannh,
    /// [`datree_crd_raw_base`].
    DatreeRaw,
}

/// Таблиця явних `$schema` — порт `EXPLICIT_K8S_SCHEMAS` (`main.mjs:88-103`).
const EXPLICIT_K8S_SCHEMAS: &[ExplicitSchema] = &[
    ExplicitSchema {
        api_version: "secrets.infisical.com/v1alpha1",
        kind: "InfisicalSecret",
        type_key: EXPLICIT_SCHEMA_TYPE_ANY,
        schema_suffix: "secrets.infisical.com/infisicalsecret_v1alpha1.json",
        base: SchemaBase::DatreeRaw,
        reason: "InfisicalSecret v1alpha1 (явна таблиця схем, datree CRDs-catalog raw)",
    },
    ExplicitSchema {
        api_version: "v1",
        kind: "Secret",
        type_key: "kubernetes.io/basic-auth",
        schema_suffix: "secret-v1.json",
        base: SchemaBase::Yannh,
        reason: "Secret type kubernetes.io/basic-auth (явна таблиця схем, yannh secret-v1.json)",
    },
];

/// Порушення без machine-специфічного `reason` — так їх реєструє `fail(msg)`
/// концерну (`reason` = `ctx.concernId`).
fn violation(message: String) -> Violation {
    Violation {
        reason: DEFAULT_REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

// ─── Текстові примітиви (toLines / modeline / поля документа) ────────────────

/// Рядки файла без BOM — порт `toLines` (`main.mjs:1829-1832`),
/// `split(/\r?\n/u)`: одиночний `\r` роздільником **не** є.
pub(crate) fn to_lines(content: &str) -> Vec<&str> {
    let body = content.strip_prefix('\u{feff}').unwrap_or(content);
    body.split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect()
}

/// URL зі строгого modeline першого рядка — порт `MODELINE_RE`
/// (`main.mjs:185`, `^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$`).
pub(crate) fn modeline_schema_url(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('#')?;
    let rest = rest.trim_start_matches(char::is_whitespace);
    let rest = rest.strip_prefix("yaml-language-server:")?;
    let rest = rest.trim_start_matches(char::is_whitespace);
    let rest = rest.strip_prefix("$schema=")?;
    // `(\S+)\s*$`: хвостові пробіли з'їдає `\s*`, але всередині URL пробілу
    // бути не може — інакше regex не збігається взагалі.
    let url = rest.trim_end_matches(char::is_whitespace);
    if url.is_empty() || url.chars().any(char::is_whitespace) {
        return None;
    }
    Some(url)
}

/// Чи рядок містить modeline у м'якій формі — порт
/// `OXLINT_SCHEMA_MODELINE_RE` (`main.mjs:195`) поверх `l.trim()`
/// (`countSchemaModelines`, `main.mjs:3218-3220`).
fn has_schema_modeline(line: &str) -> bool {
    let trimmed = line.trim();
    let Some(rest) = trimmed.strip_prefix('#') else {
        return false;
    };
    let rest = rest.trim_start_matches(char::is_whitespace);
    let Some(rest) = rest.strip_prefix("yaml-language-server:") else {
        return false;
    };
    let rest = rest.trim_start_matches(char::is_whitespace);
    let Some(rest) = rest.strip_prefix("$schema=") else {
        return false;
    };
    rest.chars().next().is_some_and(|c| !c.is_whitespace())
}

/// Скільки рядків файла містять modeline — порт `countSchemaModelines`.
fn count_schema_modelines(lines: &[&str]) -> usize {
    lines
        .iter()
        .filter(|line| has_schema_modeline(line))
        .count()
}

/// Тіло після першого рядка без провідних порожніх — порт
/// `yamlBodyAfterModeline` (`main.mjs:1839-1843`).
pub(crate) fn yaml_body_after_modeline(lines: &[&str]) -> String {
    let mut i = 1;
    while i < lines.len() && lines[i].trim().is_empty() {
        i += 1;
    }
    lines[i.min(lines.len())..].join("\n")
}

/// Тіло для парсингу першого документа — порт
/// `k8sYamlBodyForDocumentParse` (`main.mjs:1619-1624`).
fn k8s_yaml_body_for_document_parse(lines: &[&str]) -> String {
    if lines
        .first()
        .is_some_and(|line| modeline_schema_url(line).is_some())
    {
        return yaml_body_after_modeline(lines);
    }
    lines.join("\n")
}

/// Перший YAML-документ (до `---` на окремому рядку) — порт
/// `firstYamlDocument` (`main.mjs:1881-1891`).
fn first_yaml_document(body: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for line in to_lines(body) {
        // `YAML_DOC_SEPARATOR_LINE_RE` — `^---\s*$`.
        if line
            .strip_prefix("---")
            .is_some_and(|rest| rest.chars().all(char::is_whitespace))
        {
            break;
        }
        out.push(line);
    }
    out.join("\n").trim().to_string()
}

/// Знімає парні зовнішні лапки — порт `trimYamlScalarQuotes`
/// (`main.mjs:110-119`).
fn trim_yaml_scalar_quotes(raw: &str) -> &str {
    let bytes = raw.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &raw[1..raw.len() - 1];
        }
    }
    raw
}

/// Значення скалярного поля рядка — спільне тіло `API_VERSION_FIELD_RE`,
/// `KIND_FIELD_RE`, `TYPE_FIELD_RE` (`main.mjs:189-191`), усі формою
/// `^\s*<key>:\s*(\S+)\s*$`.
fn scalar_field<'a>(line: &'a str, key_with_colon: &str) -> Option<&'a str> {
    let rest = line.trim_start_matches(char::is_whitespace);
    let rest = rest.strip_prefix(key_with_colon)?;
    let rest = rest.trim_start_matches(char::is_whitespace);
    let value = rest.trim_end_matches(char::is_whitespace);
    if value.is_empty() || value.chars().any(char::is_whitespace) {
        return None;
    }
    Some(value)
}

/// `apiVersion` і `kind` з тексту документа — порт
/// `extractApiVersionAndKind` (`main.mjs:1898-1925`).
fn extract_api_version_and_kind(doc: &str) -> (Option<String>, Option<String>) {
    let mut api_version: Option<String> = None;
    let mut kind: Option<String> = None;
    for line in to_lines(doc) {
        if api_version.is_none() {
            if let Some(value) = scalar_field(line, "apiVersion:") {
                api_version = Some(trim_yaml_scalar_quotes(value).to_string());
            }
        }
        if kind.is_none() {
            if let Some(value) = scalar_field(line, "kind:") {
                kind = Some(trim_yaml_scalar_quotes(value).to_string());
            }
        }
        if api_version.is_some() && kind.is_some() {
            break;
        }
    }
    (api_version, kind)
}

/// Кореневе поле `type:` — порт `extractTopLevelManifestType`
/// (`main.mjs:126-137`): повертається **перший** збіг, і порожнє після зняття
/// лапок значення дорівнює «поля немає».
fn extract_top_level_manifest_type(doc: &str) -> Option<String> {
    for line in to_lines(doc) {
        if let Some(value) = scalar_field(line, "type:") {
            let unquoted = trim_yaml_scalar_quotes(value);
            if unquoted.is_empty() {
                return None;
            }
            return Some(unquoted.to_string());
        }
    }
    None
}

/// Чи перший документ — `HttpBackendGroup` Yandex ALB — порт
/// `k8sYamlFirstDocIsAlbYcHttpBackendGroup` (`main.mjs:1933-1937`).
pub fn k8s_yaml_first_doc_is_alb_yc_http_backend_group(yaml_body: &str) -> bool {
    let (api_version, kind) = extract_api_version_and_kind(&first_yaml_document(yaml_body));
    api_version.as_deref() == Some("alb.yc.io/v1alpha1")
        && kind.as_deref() == Some("HttpBackendGroup")
}

// ─── expectedSchemaUrl ───────────────────────────────────────────────────────

/// Очікуваний `$schema` і пояснення (порожній `expected` = «схеми немає, це
/// порушення з текстом `reason`») — порт `expectedSchemaUrl`
/// (`main.mjs:3194-3211`).
pub fn expected_schema_url(file_path: &Path, doc: &str) -> (Option<String>, String) {
    let base_lower = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if base_lower == "kustomization.yaml" {
        return (
            Some(KUSTOMIZATION_SCHEMA.to_string()),
            "kustomization (ім’я файлу)".to_string(),
        );
    }
    let (api_version, kind) = extract_api_version_and_kind(doc);
    let (Some(api_version), Some(kind)) = (api_version, kind) else {
        return (
            None,
            "не знайдено apiVersion/kind у першому документі (потрібні для перевірки $schema)"
                .to_string(),
        );
    };
    expected_schema_url_for_typed_manifest(doc, &api_version, &kind)
}

/// Очікуваний URL за `apiVersion`/`kind` — порт
/// `expectedSchemaUrlForTypedManifest` (`main.mjs:3148-3186`).
fn expected_schema_url_for_typed_manifest(
    doc: &str,
    api_version: &str,
    kind: &str,
) -> (Option<String>, String) {
    let manifest_type = extract_top_level_manifest_type(doc);
    if let Some(explicit) = lookup_explicit_k8s_schema(api_version, kind, manifest_type.as_deref())
    {
        let base = match explicit.base {
            SchemaBase::Yannh => yannh_base(),
            SchemaBase::DatreeRaw => datree_crd_raw_base(),
        };
        return (
            Some(format!("{base}{}", explicit.schema_suffix)),
            explicit.reason.to_string(),
        );
    }

    if api_version == "v1" {
        let k = kind_to_schema_file_part(kind);
        return (
            Some(format!("{}{k}-v1.json", yannh_base())),
            "core v1 (yannh)".to_string(),
        );
    }

    let Some(slash) = api_version.find('/') else {
        return (
            None,
            format!("нестандартний apiVersion \"{api_version}\" — очікується v1 або group/version"),
        );
    };

    let group = &api_version[..slash];
    let version = &api_version[slash + 1..];
    let kind_part = kind_to_schema_file_part(kind);

    if YANNH_GROUPS.contains(&group) {
        // yannh лишає в імені файла лише перший сегмент group до крапки:
        // `networking.k8s.io` → `networking` (`main.mjs:3173-3177`).
        let group_part = group.split('.').next().unwrap_or(group);
        return (
            Some(format!(
                "{}{kind_part}-{group_part}-{version}.json",
                yannh_base()
            )),
            "вбудований API Kubernetes (yannh)".to_string(),
        );
    }

    (
        Some(format!(
            "{DATREE_CRD_BASE}{group}/{kind_part}_{version}.json"
        )),
        "CRD / група поза yannh (datree CRDs-catalog)".to_string(),
    )
}

/// Пошук у таблиці явних схем — порт `lookupExplicitK8sSchema`
/// (`main.mjs:146-152`): спершу точний `type`, далі `*`.
fn lookup_explicit_k8s_schema(
    api_version: &str,
    kind: &str,
    manifest_type: Option<&str>,
) -> Option<&'static ExplicitSchema> {
    if let Some(manifest_type) = manifest_type {
        let exact = EXPLICIT_K8S_SCHEMAS.iter().find(|entry| {
            entry.api_version == api_version
                && entry.kind == kind
                && entry.type_key == manifest_type
        });
        if exact.is_some() {
            return exact;
        }
    }
    EXPLICIT_K8S_SCHEMAS.iter().find(|entry| {
        entry.api_version == api_version
            && entry.kind == kind
            && entry.type_key == EXPLICIT_SCHEMA_TYPE_ANY
    })
}

/// `kind` у частину імені файла схеми — порт `kindToSchemaFilePart`
/// (`main.mjs:3130-3139`): лише ASCII-літери й цифри, нижній регістр.
fn kind_to_schema_file_part(kind: &str) -> String {
    kind.chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_lowercase()
}

// ─── Застарілі apiVersion (detect* + T0 fix-hint) ────────────────────────────

/// Чи рядок — `apiVersion:` із заданим значенням (з опційними лапками) — порт
/// спільної форми `BATCH_V1BETA1_API_VERSION_LINE_RE` (`main.mjs:210`) і
/// `GATEWAY_HTTPROUTE_V1BETA1_LINE_RE` (`main.mjs:211`):
/// `^(\s*apiVersion:\s*)["']?<value>["']?(\s*)$`.
fn api_version_line_is(line: &str, expected: &str) -> bool {
    let Some(rest) = line.trim_start().strip_prefix("apiVersion:") else {
        return false;
    };
    // `\s*` після двокрапки, далі опційна відкривна лапка `["']?`.
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(['"', '\'']).unwrap_or(rest);
    let Some(tail) = rest.strip_prefix(expected) else {
        return false;
    };
    // Закривна лапка теж опційна й **незалежна** від відкривної — regex
    // дозволяє непарні лапки, і порт відтворює це як є.
    let tail = tail.strip_prefix(['"', '\'']).unwrap_or(tail);
    tail.trim().is_empty()
}

/// Чи рядок — `kind: HTTPRoute` — порт `HTTPROUTE_KIND_LINE_RE`
/// (`main.mjs:213`, `^\s*kind:\s*HTTPRoute\s*$`).
fn line_is_http_route_kind(line: &str) -> bool {
    line.trim_start()
        .strip_prefix("kind:")
        .is_some_and(|rest| rest.trim() == "HTTPRoute")
}

/// Застарілий `apiVersion: gateway.networking.k8s.io/v1beta1` у HTTPRoute —
/// порт `detectGatewayHttpRouteV1beta1InK8sYamlFiles` (`main.mjs:1778-1800`)
/// **з полагодженим** застосуванням рядкової regex (див. секцію «Полагоджений
/// дефект канону» в доккоменті модуля).
pub fn detect_gateway_http_route_v1beta1(root: &Path, yaml_files: &[PathBuf]) -> Vec<Violation> {
    let mut out = Vec::new();
    for abs in yaml_files {
        let rel = rel_posix(root, abs);
        let Ok(raw) = std::fs::read_to_string(abs) else {
            continue;
        };
        let lines = to_lines(&raw);
        if !lines
            .iter()
            .any(|line| api_version_line_is(line, "gateway.networking.k8s.io/v1beta1"))
        {
            continue;
        }
        if !lines.iter().any(|line| line_is_http_route_kind(line)) {
            continue;
        }
        out.push(Violation {
            reason: "gateway-httproute-v1beta1".to_string(),
            message: format!(
                "{rel}: apiVersion: gateway.networking.k8s.io/v1beta1 заборонено для HTTPRoute — оновіть до gateway.networking.k8s.io/v1 (k8s.mdc)"
            ),
            file: Some(rel.clone()),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "kind": "gateway-httproute-v1beta1" })),
        });
    }
    out
}

/// Застарілий `apiVersion: batch/v1beta1` — порт
/// `detectBatchV1beta1InK8sYamlFiles` (`main.mjs:1806-1830`) **з полагодженим**
/// застосуванням рядкової regex.
pub fn detect_batch_v1beta1(root: &Path, yaml_files: &[PathBuf]) -> Vec<Violation> {
    let mut out = Vec::new();
    for abs in yaml_files {
        let rel = rel_posix(root, abs);
        let Ok(raw) = std::fs::read_to_string(abs) else {
            continue;
        };
        if !to_lines(&raw)
            .iter()
            .any(|line| api_version_line_is(line, "batch/v1beta1"))
        {
            continue;
        }
        out.push(Violation {
            reason: "batch-v1beta1-apiversion".to_string(),
            message: format!(
                "{rel}: apiVersion: batch/v1beta1 застаріло — оновіть до batch/v1 (k8s.mdc)"
            ),
            file: Some(rel.clone()),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "kind": "batch-v1beta1-apiversion" })),
        });
    }
    out
}

// ─── checkK8sYamlFile ────────────────────────────────────────────────────────

/// Per-file цикл `lint()` — порт `for (const abs of yamlFiles) await
/// checkK8sYamlFile(...)` (`main.mjs:6547-6549`).
pub fn check_k8s_yaml_files(root: &Path, yaml_files: &[PathBuf]) -> Vec<Violation> {
    let mut out = Vec::new();
    for abs in yaml_files {
        check_k8s_yaml_file(root, abs, &mut out);
    }
    out
}

/// Один YAML у дереві k8s — порт `checkK8sYamlFile` (`main.mjs:3303-3360`).
fn check_k8s_yaml_file(root: &Path, abs: &Path, out: &mut Vec<Violation>) {
    let rel = rel_posix(root, abs);
    let base_lower = abs
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if base_lower.ends_with(".yml") {
        out.push(violation(format!(
            "{rel}: розширення .yml — перейменуй на .yaml (див. k8s.mdc)"
        )));
        return;
    }

    let raw = match std::fs::read_to_string(abs) {
        Ok(raw) => raw,
        Err(error) => {
            out.push(violation(format!("{rel}: не вдалося прочитати ({error})")));
            return;
        }
    };

    let lines = to_lines(&raw);
    let first_line_is_modeline = lines
        .first()
        .is_some_and(|line| modeline_schema_url(line).is_some());
    let body_for_first_doc = k8s_yaml_body_for_document_parse(&lines);

    if k8s_yaml_first_doc_is_alb_yc_http_backend_group(&body_for_first_doc) {
        if first_line_is_modeline {
            out.push(violation(format!(
                "{rel}: для kind HttpBackendGroup (apiVersion alb.yc.io/v1alpha1) не задавай # yaml-language-server: $schema — прибери перший рядок modeline (k8s.mdc)"
            )));
            return;
        }
        if count_schema_modelines(&lines) > 0 {
            out.push(violation(format!(
                "{rel}: для kind HttpBackendGroup (apiVersion alb.yc.io/v1alpha1) не використовуй # yaml-language-server: $schema у файлі (k8s.mdc)"
            )));
        }
        // `checkK8sYamlHttpBackendGroupFile` реєструє лише `pass` — у
        // detector-поверхні це no-op (`violation-reporter.mjs:29-31`).
        return;
    }

    if !first_line_is_modeline {
        // Modeline опційний, але **лише** у першому рядку: нижче по файлу
        // yaml-language-server його не бачить (`main.mjs:3344-3354`).
        if count_schema_modelines(&lines) > 0 {
            out.push(Violation {
                reason: "schema-modeline-first".to_string(),
                message: format!(
                    "{rel}: рядок # yaml-language-server: $schema=… має бути першим у файлі (без префіксів перед #; k8s.mdc)"
                ),
                file: Some(rel.clone()),
                severity: Severity::Error,
                data: Some(serde_json::json!({ "kind": "schema-modeline-first" })),
            });
        }
        return;
    }

    check_k8s_yaml_file_with_schema_modeline(abs, &rel, &lines, out);
}

/// Файл із modeline у першому рядку — порт
/// `checkK8sYamlFileWithSchemaModeline` (`main.mjs:3248-3293`).
fn check_k8s_yaml_file_with_schema_modeline(
    abs: &Path,
    rel: &str,
    lines: &[&str],
    out: &mut Vec<Violation>,
) {
    let Some(schema_url) = lines.first().and_then(|line| modeline_schema_url(line)) else {
        // Недосяжна гілка: викликач заходить сюди лише коли modeline вже
        // збігся. Лишена заради дзеркальності (`main.mjs:3250-3253`).
        out.push(violation(format!(
            "{rel}: некоректний modeline $schema у першому рядку"
        )));
        return;
    };
    if count_schema_modelines(lines) > 1 {
        out.push(violation(format!(
            "{rel}: кілька рядків yaml-language-server $schema — лиш один modeline на файл (див. k8s.mdc)"
        )));
        return;
    }

    if schema_url.starts_with("file:") {
        out.push(violation(format!(
            "{rel}: $schema=file:… заборонено (фальшива валідація без публічної схеми). Якщо публічної схеми для цього apiVersion/kind немає — прибери modeline зовсім (k8s.mdc)"
        )));
        return;
    }

    // `HTTPS_SCHEMA_RE` — `/^https:/iu`, тобто без урахування регістру.
    if !schema_url.to_lowercase().starts_with("https:") {
        out.push(violation(format!(
            "{rel}: $schema має бути https URL (file: і інші схеми заборонені — якщо публічної схеми немає, прибери modeline; k8s.mdc)"
        )));
        return;
    }

    let body = yaml_body_after_modeline(lines);
    let doc = first_yaml_document(&body);
    let (expected, reason) = expected_schema_url(abs, &doc);

    let Some(expected) = expected else {
        out.push(violation(format!("{rel}: {reason}")));
        return;
    };

    if schema_url != expected {
        out.push(violation(format!(
            "{rel}: $schema не відповідає правилу ({reason}). Очікується:\n     {expected}\n     Зараз: {schema_url}"
        )));
    }
    // Збіг → лише `pass`, тобто нічого (див. коментар вище).
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    /// Проганяє цикл по одному файлу і повертає тексти порушень.
    fn messages(tmp: &TempDir, rel: &str) -> Vec<String> {
        let abs = tmp.path().join(rel);
        check_k8s_yaml_files(tmp.path(), &[abs])
            .into_iter()
            .map(|v| v.message)
            .collect()
    }

    #[test]
    fn yml_extension_is_reported_before_reading_the_file() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/svc.yml", "kind: Service\n");
        assert_eq!(
            messages(&tmp, "k8s/base/svc.yml"),
            vec!["k8s/base/svc.yml: розширення .yml — перейменуй на .yaml (див. k8s.mdc)"]
        );
    }

    #[test]
    fn missing_modeline_is_allowed_when_no_modeline_anywhere() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/svc.yaml", "apiVersion: v1\nkind: Service\n");
        assert!(messages(&tmp, "k8s/base/svc.yaml").is_empty());
    }

    #[test]
    fn modeline_below_first_line_carries_machine_reason_and_data() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/svc.yaml",
            "apiVersion: v1\n# yaml-language-server: $schema=https://example.test/s.json\nkind: Service\n",
        );
        let abs = tmp.path().join("k8s/base/svc.yaml");
        let violations = check_k8s_yaml_files(tmp.path(), &[abs]);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "schema-modeline-first");
        assert_eq!(violations[0].file.as_deref(), Some("k8s/base/svc.yaml"));
        assert_eq!(
            violations[0].data,
            Some(serde_json::json!({ "kind": "schema-modeline-first" }))
        );
    }

    #[test]
    fn core_v1_schema_url_matches_yannh_layout() {
        let tmp = TempDir::new().unwrap();
        let url = format!("{}service-v1.json", yannh_base());
        write(
            &tmp,
            "k8s/base/svc.yaml",
            &format!("# yaml-language-server: $schema={url}\napiVersion: v1\nkind: Service\n"),
        );
        assert!(messages(&tmp, "k8s/base/svc.yaml").is_empty());
    }

    #[test]
    fn grouped_api_version_drops_everything_after_first_dot() {
        let (expected, reason) = expected_schema_url(
            Path::new("/repo/k8s/base/np.yaml"),
            "apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy",
        );
        assert_eq!(
            expected,
            Some(format!("{}networkpolicy-networking-v1.json", yannh_base()))
        );
        assert_eq!(reason, "вбудований API Kubernetes (yannh)");
    }

    #[test]
    fn group_outside_yannh_falls_back_to_datree_catalog() {
        let (expected, reason) = expected_schema_url(
            Path::new("/repo/k8s/base/route.yaml"),
            "apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute",
        );
        assert_eq!(
            expected,
            Some(format!(
                "{DATREE_CRD_BASE}gateway.networking.k8s.io/httproute_v1.json"
            ))
        );
        assert_eq!(reason, "CRD / група поза yannh (datree CRDs-catalog)");
    }

    #[test]
    fn kustomization_is_detected_by_file_name_not_by_content() {
        let (expected, reason) = expected_schema_url(
            Path::new("/repo/k8s/base/kustomization.yaml"),
            "resources: []",
        );
        assert_eq!(expected, Some(KUSTOMIZATION_SCHEMA.to_string()));
        assert_eq!(reason, "kustomization (ім’я файлу)");
    }

    #[test]
    fn api_version_without_slash_has_no_expected_schema() {
        let (expected, reason) = expected_schema_url(
            Path::new("/repo/k8s/base/x.yaml"),
            "apiVersion: weird\nkind: Thing",
        );
        assert_eq!(expected, None);
        assert_eq!(
            reason,
            "нестандартний apiVersion \"weird\" — очікується v1 або group/version"
        );
    }

    #[test]
    fn explicit_table_prefers_exact_type_over_wildcard() {
        let (expected, reason) = expected_schema_url(
            Path::new("/repo/k8s/base/secret.yaml"),
            "apiVersion: v1\nkind: Secret\ntype: kubernetes.io/basic-auth",
        );
        assert_eq!(expected, Some(format!("{}secret-v1.json", yannh_base())));
        assert_eq!(
            reason,
            "Secret type kubernetes.io/basic-auth (явна таблиця схем, yannh secret-v1.json)"
        );
    }

    #[test]
    fn infisical_secret_uses_datree_raw_base() {
        let (expected, _) = expected_schema_url(
            Path::new("/repo/k8s/base/inf.yaml"),
            "apiVersion: secrets.infisical.com/v1alpha1\nkind: InfisicalSecret",
        );
        assert_eq!(
            expected,
            Some(format!(
                "{}secrets.infisical.com/infisicalsecret_v1alpha1.json",
                datree_crd_raw_base()
            ))
        );
    }

    #[test]
    fn file_scheme_modeline_is_forbidden() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/svc.yaml",
            "# yaml-language-server: $schema=file:///tmp/s.json\napiVersion: v1\nkind: Service\n",
        );
        assert_eq!(messages(&tmp, "k8s/base/svc.yaml").len(), 1);
        assert!(messages(&tmp, "k8s/base/svc.yaml")[0].contains("$schema=file:… заборонено"));
    }

    #[test]
    fn two_modelines_short_circuit_before_url_comparison() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/svc.yaml",
            "# yaml-language-server: $schema=https://a.test/s.json\n# yaml-language-server: $schema=https://b.test/s.json\napiVersion: v1\nkind: Service\n",
        );
        assert_eq!(
            messages(&tmp, "k8s/base/svc.yaml"),
            vec![
                "k8s/base/svc.yaml: кілька рядків yaml-language-server $schema — лиш один modeline на файл (див. k8s.mdc)"
            ]
        );
    }

    #[test]
    fn alb_http_backend_group_forbids_modeline_in_first_line() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/bg.yaml",
            "# yaml-language-server: $schema=https://a.test/s.json\napiVersion: alb.yc.io/v1alpha1\nkind: HttpBackendGroup\n",
        );
        let msgs = messages(&tmp, "k8s/base/bg.yaml");
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].contains("не задавай # yaml-language-server: $schema"));
    }

    #[test]
    fn alb_http_backend_group_without_modeline_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/bg.yaml",
            "apiVersion: alb.yc.io/v1alpha1\nkind: HttpBackendGroup\n",
        );
        assert!(messages(&tmp, "k8s/base/bg.yaml").is_empty());
    }

    #[test]
    fn nested_type_field_is_seen_as_top_level_like_in_canon() {
        // `TYPE_FIELD_RE` допускає відступ — успадкована особливість канону.
        assert_eq!(
            extract_top_level_manifest_type("kind: Service\nspec:\n  type: ClusterIP"),
            Some("ClusterIP".to_string())
        );
    }

    #[test]
    fn quoted_scalars_lose_their_quotes() {
        let (api_version, kind) =
            extract_api_version_and_kind("apiVersion: \"v1\"\nkind: 'Secret'");
        assert_eq!(api_version.as_deref(), Some("v1"));
        assert_eq!(kind.as_deref(), Some("Secret"));
    }

    #[test]
    fn crlf_and_bom_do_not_break_line_splitting() {
        let lines = to_lines("\u{feff}a\r\nb\n");
        assert_eq!(lines, vec!["a", "b", ""]);
    }

    #[test]
    fn first_document_stops_at_separator() {
        assert_eq!(first_yaml_document("kind: A\n---\nkind: B\n"), "kind: A");
    }
}
