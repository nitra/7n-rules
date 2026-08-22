//! Структуровані джерела домену — порт `structured-sources.mjs`.
//!
//! Модуль не читає код і НЕ має text/regex-фолбеку: кожен розпізнаний
//! артефакт проходить рідний структурний парсер, а зламаний вхід стає
//! блокувальною діагностикою ДО побудови candidate. Регексом «майже
//! розібраний» OpenAPI дав би контрактні твердження, яких у файлі немає.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::{json, Map, Value};

use crate::claims::create_implemented_claim_id;
use crate::deterministic::js_locale_cmp;
use crate::paths::{is_within, nested_domain_ignores, to_posix};

/// Що взагалі вважається структурованим артефактом домену.
const ARTIFACT_PATTERNS: [&str; 9] = [
    "**/openapi.{json,yaml,yml}",
    "**/asyncapi.{json,yaml,yml}",
    "**/*.{graphql,gql}",
    "**/*.schema.json",
    "**/schema.json",
    "**/config/**/*.{json,yaml,yml,toml}",
    "**/configs/**/*.{json,yaml,yml,toml}",
    ".n-rules.json",
    "tsconfig.json",
];

const DEFAULT_IGNORES: [&str; 9] = [
    "**/.git/**",
    "**/.worktrees/**",
    "**/node_modules/**",
    "**/vendor/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.venv/**",
    "**/venv/**",
];

const NODE_KINDS: [&str; 2] = ["config", "integration"];
const VISIBILITIES: [&str; 3] = ["public", "package", "external"];
const EVIDENCE_KINDS: [&str; 2] = ["config", "schema"];
const EDGE_KINDS: [&str; 2] = ["contains", "implements"];
const OPENAPI_METHODS: [&str; 8] = [
    "delete", "get", "head", "options", "patch", "post", "put", "trace",
];

/// Види визначень GraphQL, які стають твердженнями.
const GRAPHQL_TYPE_DEFINITIONS: [&str; 6] = [
    "EnumTypeDefinition",
    "InputObjectTypeDefinition",
    "InterfaceTypeDefinition",
    "ObjectTypeDefinition",
    "ScalarTypeDefinition",
    "UnionTypeDefinition",
];

/// Предикати, дозволені структурованим твердженням.
const STRUCTURED_CLAIM_PREDICATES: [&str; 5] = [
    "declares-artifact",
    "declares-asyncapi-channel",
    "declares-graphql-definition",
    "declares-json-schema",
    "declares-openapi-operation",
];

/// Блокувальна діагностика.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub detail: String,
    pub path: Option<String>,
}

impl Diagnostic {
    fn new(code: &str, detail: &str, path: Option<&str>) -> Self {
        Self {
            code: code.to_string(),
            detail: detail.to_string(),
            path: path.map(str::to_string),
        }
    }

    fn sort_key(&self) -> String {
        format!("{}:{}", self.path.as_deref().unwrap_or(""), self.code)
    }
}

fn sort_diagnostics(mut diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic> {
    diagnostics.sort_by(|left, right| js_locale_cmp(&left.sort_key(), &right.sort_key()));
    diagnostics
}

/// Домен у частині, потрібній цьому модулю.
pub struct DomainScope<'a> {
    pub id: &'a str,
    pub root: &'a Path,
    /// POSIX-шлях кореневого маніфеста домену.
    pub root_manifest: &'a str,
    pub source_root: &'a str,
    pub excluded_source_roots: &'a [String],
}

/// Проєкція одного артефакта у фрагмент графа.
#[derive(Debug, Clone, PartialEq)]
pub struct Fragment {
    pub path: String,
    pub content_hash: String,
    pub nodes: Vec<Value>,
    pub edges: Vec<Value>,
    pub evidence: Vec<Value>,
    pub claims: Vec<Value>,
}

/// Результат завантаження.
#[derive(Debug, Clone)]
pub struct LoadedSources {
    pub fragments: Vec<Fragment>,
    /// Текст кожного evidence — за його ідентифікатором.
    pub evidence_content_by_id: BTreeMap<String, String>,
}

/// Короткий стабільний digest ідентичностей — від РЯДКА, не від JSON.
fn digest(value: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(value.as_bytes());
    let mut hex = String::with_capacity(24);
    for byte in digest.iter().take(12) {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// Точний відбиток вмісту.
fn content_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(content.as_bytes());
    let mut hex = String::with_capacity(64);
    for byte in digest.iter() {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("sha256:{hex}")
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Одне детерміноване твердження, підперте артефактом.
fn structured_claim(
    domain_id: &str,
    subject_id: &str,
    predicate: &str,
    value: Value,
    evidence_id: &str,
    source_fingerprint: &str,
) -> Value {
    let evidence_ids = vec![evidence_id.to_string()];
    json!({
        "id": create_implemented_claim_id(domain_id, subject_id, predicate, &value, &evidence_ids),
        "subjectId": subject_id,
        "layer": "implemented",
        "predicate": predicate,
        "value": value,
        "evidenceIds": evidence_ids,
        "confidence": 1,
        "sourceFingerprint": source_fingerprint,
    })
}

/// Операції OpenAPI — БЕЗ вмісту самих операцій.
fn open_api_claims(
    domain_id: &str,
    subject_id: &str,
    value: &Value,
    evidence_id: &str,
    fingerprint: &str,
) -> Vec<Value> {
    let Some(paths) = value.get("paths").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut names: Vec<&String> = paths
        .iter()
        .filter(|(_, item)| item.is_object())
        .map(|(path, _)| path)
        .collect();
    names.sort_by(|left, right| js_locale_cmp(left, right));
    names
        .into_iter()
        .flat_map(|path| {
            let item = &paths[path];
            OPENAPI_METHODS
                .iter()
                .filter(|method| item.get(**method).is_some_and(Value::is_object))
                .map(|method| {
                    structured_claim(
                        domain_id,
                        subject_id,
                        "declares-openapi-operation",
                        json!({"path": path, "method": method}),
                        evidence_id,
                        fingerprint,
                    )
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Канали AsyncAPI — без повідомлень і біндингів.
fn async_api_claims(
    domain_id: &str,
    subject_id: &str,
    value: &Value,
    evidence_id: &str,
    fingerprint: &str,
) -> Vec<Value> {
    let Some(channels) = value.get("channels").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut names: Vec<&String> = channels.keys().collect();
    names.sort_unstable();
    names
        .into_iter()
        .map(|channel| {
            structured_claim(
                domain_id,
                subject_id,
                "declares-asyncapi-channel",
                json!({"channel": channel}),
                evidence_id,
                fingerprint,
            )
        })
        .collect()
}

/// Верхньорівневі визначення GraphQL.
///
/// Береться рівно поверхня контракту — вид визначення й імʼя; тіла типів і
/// операцій у твердження не потрапляють.
fn graphql_claims(
    domain_id: &str,
    subject_id: &str,
    definitions: &[GraphqlDefinition],
    evidence_id: &str,
    fingerprint: &str,
) -> Vec<Value> {
    let mut claims: Vec<Value> = definitions
        .iter()
        .filter_map(|definition| {
            let (kind, name, operation) =
                (&definition.kind, &definition.name, &definition.operation);
            if kind == "OperationDefinition" {
                let mut value = Map::new();
                value.insert("definition".to_string(), json!("operation"));
                value.insert(
                    "operation".to_string(),
                    json!(operation.clone().unwrap_or_else(|| "query".to_string())),
                );
                if let Some(name) = name {
                    value.insert("name".to_string(), json!(name));
                }
                return Some(structured_claim(
                    domain_id,
                    subject_id,
                    "declares-graphql-definition",
                    Value::Object(value),
                    evidence_id,
                    fingerprint,
                ));
            }
            let name = name.as_ref()?;
            GRAPHQL_TYPE_DEFINITIONS.contains(&kind.as_str()).then(|| {
                structured_claim(
                    domain_id,
                    subject_id,
                    "declares-graphql-definition",
                    json!({"definition": kind, "name": name}),
                    evidence_id,
                    fingerprint,
                )
            })
        })
        .collect();
    claims.sort_by(|left, right| {
        js_locale_cmp(
            string_field(left, "id").unwrap_or_default(),
            string_field(right, "id").unwrap_or_default(),
        )
    });
    claims
}

/// `title`/`type` JSON Schema — без проєкції довільних значень схеми.
fn json_schema_claims(
    domain_id: &str,
    subject_id: &str,
    value: &Value,
    evidence_id: &str,
    fingerprint: &str,
) -> Vec<Value> {
    let mut claim_value = Map::new();
    if let Some(title) = string_field(value, "title") {
        claim_value.insert("title".to_string(), json!(title));
    }
    match value.get("type") {
        Some(Value::String(kind)) => {
            claim_value.insert("type".to_string(), json!(kind));
        }
        Some(Value::Array(kinds)) => {
            let names: Vec<&str> = kinds.iter().filter_map(Value::as_str).collect();
            if names.len() == kinds.len() {
                let mut sorted: Vec<&str> = names;
                sorted.sort_unstable();
                claim_value.insert("type".to_string(), json!(sorted));
            }
        }
        _ => {}
    }
    if claim_value.is_empty() {
        return Vec::new();
    }
    vec![structured_claim(
        domain_id,
        subject_id,
        "declares-json-schema",
        Value::Object(claim_value),
        evidence_id,
        fingerprint,
    )]
}

/// Верхньорівневе визначення GraphQL — рівно те, що стає твердженням.
struct GraphqlDefinition {
    kind: String,
    name: Option<String>,
    /// Лише для операцій: `query` | `mutation` | `subscription`.
    operation: Option<String>,
}

/// Розібраний артефакт.
struct Parsed {
    value: Value,
    format: String,
    /// Верхньорівневі визначення GraphQL.
    graphql: Vec<GraphqlDefinition>,
}

/// Вид артефакта за його шляхом.
fn artifact_kind(path: &str, manifest_name: &str) -> &'static str {
    let name = path.rsplit('/').next().unwrap_or_default().to_lowercase();
    if name == manifest_name.to_lowercase() {
        return "manifest";
    }
    if name.starts_with("openapi.") {
        return "openapi";
    }
    if name.starts_with("asyncapi.") {
        return "asyncapi";
    }
    if path.ends_with(".graphql") || path.ends_with(".gql") {
        return "graphql";
    }
    if path.ends_with(".schema.json") || name == "schema.json" {
        return "json-schema";
    }
    "config"
}

/// Розбирає GraphQL-документ ЦІЛКОМ — типи й операції разом, як `parse()`.
fn parse_graphql(content: &str) -> Result<Vec<GraphqlDefinition>, String> {
    use apollo_parser::cst::Definition;
    use apollo_parser::Parser;

    let tree = Parser::new(content).parse();
    // apollo-parser толерантний до помилок і повертає дерево разом із їх
    // списком; JS `parse()` кидає на першій. Тому будь-яка помилка тут —
    // провал розбору.
    if let Some(error) = tree.errors().next() {
        return Err(error.message().to_string());
    }
    let name_of = |name: Option<apollo_parser::cst::Name>| {
        name.and_then(|name| name.ident_token())
            .map(|token| token.text().to_string())
    };
    Ok(tree
        .document()
        .definitions()
        .map(|definition| match definition {
            Definition::OperationDefinition(node) => {
                let operation = node.operation_type().map(|kind| {
                    if kind.mutation_token().is_some() {
                        "mutation".to_string()
                    } else if kind.subscription_token().is_some() {
                        "subscription".to_string()
                    } else {
                        "query".to_string()
                    }
                });
                GraphqlDefinition {
                    kind: "OperationDefinition".to_string(),
                    name: name_of(node.name()),
                    operation,
                }
            }
            Definition::ObjectTypeDefinition(node) => GraphqlDefinition {
                kind: "ObjectTypeDefinition".to_string(),
                name: name_of(node.name()),
                operation: None,
            },
            Definition::InterfaceTypeDefinition(node) => GraphqlDefinition {
                kind: "InterfaceTypeDefinition".to_string(),
                name: name_of(node.name()),
                operation: None,
            },
            Definition::EnumTypeDefinition(node) => GraphqlDefinition {
                kind: "EnumTypeDefinition".to_string(),
                name: name_of(node.name()),
                operation: None,
            },
            Definition::UnionTypeDefinition(node) => GraphqlDefinition {
                kind: "UnionTypeDefinition".to_string(),
                name: name_of(node.name()),
                operation: None,
            },
            Definition::ScalarTypeDefinition(node) => GraphqlDefinition {
                kind: "ScalarTypeDefinition".to_string(),
                name: name_of(node.name()),
                operation: None,
            },
            Definition::InputObjectTypeDefinition(node) => GraphqlDefinition {
                kind: "InputObjectTypeDefinition".to_string(),
                name: name_of(node.name()),
                operation: None,
            },
            other => GraphqlDefinition {
                kind: format!("{other:?}"),
                name: None,
                operation: None,
            },
        })
        .collect())
}

/// Перетворює YAML-значення на `serde_json::Value` — еквівалент `doc.toJS()`.
fn yaml_to_json(text: &str) -> Result<Value, String> {
    let value: serde_yaml::Value = serde_yaml::from_str(text).map_err(|error| error.to_string())?;
    serde_json::to_value(value).map_err(|error| error.to_string())
}

/// Розбирає артефакт ЛИШЕ його рідним парсером — порт `parseArtifact`.
fn parse_artifact(kind: &str, path: &str, content: &str) -> Result<Parsed, Diagnostic> {
    let failure = |error: String| {
        Diagnostic::new(
            "structured-parse-failed",
            &format!("Не вдалося розібрати recognized {kind} artifact: {error}"),
            Some(path),
        )
    };
    if kind == "graphql" {
        return parse_graphql(content)
            .map_err(failure)
            .map(|graphql| Parsed {
                value: Value::Null,
                format: "graphql".to_string(),
                graphql,
            });
    }
    let (value, format) = if path.ends_with(".json") {
        (
            serde_json::from_str::<Value>(content).map_err(|error| failure(error.to_string()))?,
            "json",
        )
    } else if path.ends_with(".toml") {
        let table = content
            .parse::<toml::Table>()
            .map_err(|error| failure(error.to_string()))?;
        (
            serde_json::to_value(table).map_err(|error| failure(error.to_string()))?,
            "toml",
        )
    } else {
        (yaml_to_json(content).map_err(failure)?, "yaml")
    };
    Ok(Parsed {
        value,
        format: format.to_string(),
        graphql: Vec::new(),
    })
}

/// Читає артефакт, не даючи symlink-у вийти за межу домену.
fn read_owned_artifact(root: &Path, path: &str) -> Result<String, Diagnostic> {
    let absolute = root.join(path);
    let resolved = std::fs::canonicalize(&absolute).map_err(|error| {
        Diagnostic::new("structured-read-failed", &error.to_string(), Some(path))
    })?;
    if !is_within(root, &resolved) {
        return Err(Diagnostic::new(
            "structured-outside-domain",
            &format!("Artifact {path} виходить за domain boundary."),
            Some(path),
        ));
    }
    std::fs::read_to_string(&resolved)
        .map_err(|error| Diagnostic::new("structured-read-failed", &error.to_string(), Some(path)))
}

/// Семантика, якої синтаксис не виражає — порт `validateArtifact`.
fn validate_artifact(kind: &str, parsed: &Parsed, path: &str) -> Result<(), Diagnostic> {
    if kind == "graphql" {
        return Ok(());
    }
    if !parsed.value.is_object() {
        return Err(Diagnostic::new(
            "structured-root-invalid",
            &format!("{kind} має бути structured object."),
            Some(path),
        ));
    }
    let required = match kind {
        "openapi" => Some((
            "openapi",
            "openapi-version-missing",
            "OpenAPI artifact не має string openapi version.",
        )),
        "asyncapi" => Some((
            "asyncapi",
            "asyncapi-version-missing",
            "AsyncAPI artifact не має string asyncapi version.",
        )),
        "json-schema" => Some((
            "$schema",
            "json-schema-id-missing",
            "JSON Schema не має string $schema.",
        )),
        _ => None,
    };
    if let Some((field, code, detail)) = required {
        if string_field(&parsed.value, field).is_none() {
            return Err(Diagnostic::new(code, detail, Some(path)));
        }
    }
    Ok(())
}

/// Твердження поверхні контракту для розібраної схеми.
/// Контекст одного артефакта для побудови його тверджень.
struct ArtifactContext<'a> {
    domain_id: &'a str,
    kind: &'a str,
    format: &'a str,
    hash: &'a str,
    parsed: &'a Parsed,
    schema_id: &'a str,
    contract_id: &'a str,
    evidence_id: &'a str,
}

fn schema_claims(context: &ArtifactContext<'_>) -> Vec<Value> {
    let ArtifactContext {
        domain_id,
        kind,
        format,
        hash,
        parsed,
        schema_id,
        contract_id,
        evidence_id,
    } = *context;
    let mut claims = vec![structured_claim(
        domain_id,
        schema_id,
        "declares-artifact",
        json!({"artifact": kind, "format": format}),
        evidence_id,
        hash,
    )];
    match kind {
        "openapi" => claims.extend(open_api_claims(
            domain_id,
            contract_id,
            &parsed.value,
            evidence_id,
            hash,
        )),
        "asyncapi" => claims.extend(async_api_claims(
            domain_id,
            contract_id,
            &parsed.value,
            evidence_id,
            hash,
        )),
        "graphql" => claims.extend(graphql_claims(
            domain_id,
            contract_id,
            &parsed.graphql,
            evidence_id,
            hash,
        )),
        "json-schema" => claims.extend(json_schema_claims(
            domain_id,
            schema_id,
            &parsed.value,
            evidence_id,
            hash,
        )),
        _ => {}
    }
    claims.sort_by(|left, right| {
        js_locale_cmp(
            string_field(left, "id").unwrap_or_default(),
            string_field(right, "id").unwrap_or_default(),
        )
    });
    claims
}

/// Вузол, evidence і твердження одного артефакта — порт `sourceNode`.
fn source_node(
    domain_id: &str,
    path: &str,
    kind: &str,
    format: &str,
    hash: &str,
    parsed: &Parsed,
) -> Fragment {
    let token = digest(&format!("{kind}:{path}"));
    let evidence_kind = if kind == "manifest" || kind == "config" {
        "config"
    } else {
        "schema"
    };
    let evidence_id = format!(
        "evidence:{}",
        digest(&format!("{evidence_kind}:{path}:{hash}"))
    );
    let attributes = json!({"sourcePath": path, "artifact": kind, "format": format});

    if kind == "manifest" || kind == "config" {
        let id = format!("config:{domain_id}:{token}");
        return Fragment {
            path: path.to_string(),
            content_hash: hash.to_string(),
            nodes: vec![json!({
                "id": id, "kind": "config", "name": path, "visibility": "package",
                "domainId": domain_id, "attributes": attributes, "sourceFingerprint": hash,
            })],
            edges: Vec::new(),
            evidence: vec![json!({
                "id": evidence_id, "kind": evidence_kind, "path": path,
                "contentHash": hash, "role": "syntax", "symbolId": id,
            })],
            claims: vec![structured_claim(
                domain_id,
                &id,
                "declares-artifact",
                json!({"artifact": kind, "format": format}),
                &evidence_id,
                hash,
            )],
        };
    }

    // Людський підпис контракту береться з самого артефакта, а не з імені
    // файла, коли артефакт його оголошує.
    let label = parsed
        .value
        .get("info")
        .and_then(|info| string_field(info, "title"))
        .or_else(|| string_field(&parsed.value, "name"))
        .map_or_else(
            || path.rsplit('/').next().unwrap_or(path).to_string(),
            str::to_string,
        );
    let schema_id = format!("schema:{domain_id}:{token}");
    let contract_id = format!("contract:{domain_id}:{token}");
    let edge_id = format!(
        "edge:{}",
        digest(&format!(
            "{schema_id}:implements:{contract_id}:{evidence_id}"
        ))
    );
    let mut schema_attributes = attributes.clone();
    schema_attributes["artifact"] = json!("schema");
    let mut contract_attributes = attributes;
    contract_attributes["boundary"] = json!("contract");

    Fragment {
        path: path.to_string(),
        content_hash: hash.to_string(),
        nodes: vec![
            json!({
                "id": schema_id, "kind": "config", "name": format!("{label} schema"),
                "visibility": "public", "domainId": domain_id,
                "attributes": schema_attributes, "sourceFingerprint": hash,
            }),
            json!({
                "id": contract_id, "kind": "integration", "name": label,
                "visibility": "external", "domainId": domain_id,
                "attributes": contract_attributes, "sourceFingerprint": hash,
            }),
        ],
        edges: vec![json!({
            "id": edge_id, "kind": "implements", "fromId": schema_id,
            "toId": contract_id, "evidenceIds": [evidence_id],
        })],
        evidence: vec![json!({
            "id": evidence_id, "kind": evidence_kind, "path": path,
            "contentHash": hash, "role": "syntax", "symbolId": schema_id,
        })],
        claims: schema_claims(&ArtifactContext {
            domain_id,
            kind,
            format,
            hash,
            parsed,
            schema_id: &schema_id,
            contract_id: &contract_id,
            evidence_id: &evidence_id,
        }),
    }
}

/// Знаходить артефакти домену, поважаючи `.gitignore` і не йдучи за symlink.
fn discover_artifacts(root: &Path, domain: &DomainScope<'_>) -> Vec<String> {
    use ignore::overrides::OverrideBuilder;
    use ignore::WalkBuilder;

    let mut overrides = OverrideBuilder::new(root);
    for pattern in ARTIFACT_PATTERNS {
        let _ = overrides.add(pattern);
    }
    for pattern in DEFAULT_IGNORES
        .iter()
        .map(|pattern| (*pattern).to_string())
        .chain(nested_domain_ignores(
            domain.source_root,
            domain.excluded_source_roots,
        ))
    {
        let _ = overrides.add(&format!("!{pattern}"));
    }
    let Ok(overrides) = overrides.build() else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .follow_links(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .overrides(overrides)
        .build();
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        if let Ok(relative) = entry.path().strip_prefix(root) {
            paths.push(to_posix(&relative.to_string_lossy()));
        }
    }
    paths
}

/// Знаходить і розбирає структуровані джерела домену — порт
/// `loadStructuredSources`.
///
/// # Errors
/// Недоступний корінь, зламаний артефакт, вихід за межу домену або
/// порушення семантики розпізнаного формату.
pub fn load_structured_sources(domain: &DomainScope<'_>) -> Result<LoadedSources, Vec<Diagnostic>> {
    if !domain.root.is_absolute() || domain.root_manifest.is_empty() {
        return Err(vec![Diagnostic::new(
            "invalid-structured-domain",
            "Domain має містити absolute root і rootManifest.",
            None,
        )]);
    }
    let root = std::fs::canonicalize(domain.root).map_err(|error| {
        vec![Diagnostic::new(
            "structured-domain-unavailable",
            &error.to_string(),
            domain.root.to_str(),
        )]
    })?;
    let manifest_name = domain
        .root_manifest
        .rsplit('/')
        .next()
        .unwrap_or(domain.root_manifest)
        .to_string();

    // Кореневий маніфест — завжди джерело, навіть якщо його не видно
    // патернами: він визначає сам домен.
    let mut unique: BTreeSet<String> = discover_artifacts(&root, domain).into_iter().collect();
    unique.insert(manifest_name.clone());
    let mut paths: Vec<String> = unique.into_iter().collect();
    paths.sort_by(|left, right| js_locale_cmp(left, right));

    let mut fragments = Vec::new();
    let mut evidence_content_by_id = BTreeMap::new();
    let mut diagnostics = Vec::new();
    for path in paths {
        let content = match read_owned_artifact(&root, &path) {
            Ok(content) => content,
            Err(diagnostic) => {
                diagnostics.push(diagnostic);
                continue;
            }
        };
        let kind = artifact_kind(&path, &manifest_name);
        let parsed = match parse_artifact(kind, &path, &content) {
            Ok(parsed) => parsed,
            Err(diagnostic) => {
                diagnostics.push(diagnostic);
                continue;
            }
        };
        if let Err(diagnostic) = validate_artifact(kind, &parsed, &path) {
            diagnostics.push(diagnostic);
            continue;
        }
        let hash = content_hash(&content);
        let fragment = source_node(domain.id, &path, kind, &parsed.format, &hash, &parsed);
        for item in &fragment.evidence {
            if let Some(id) = string_field(item, "id") {
                evidence_content_by_id.insert(id.to_string(), content.clone());
            }
        }
        fragments.push(fragment);
    }
    if !diagnostics.is_empty() {
        return Err(sort_diagnostics(diagnostics));
    }
    fragments.sort_by(|left, right| js_locale_cmp(&left.path, &right.path));
    Ok(LoadedSources {
        fragments,
        evidence_content_by_id,
    })
}

/// Чи значення твердження може містити ЛИШЕ публічні метадані артефакта.
///
/// Це головний privacy-гейт модуля: він не дає структурованому артефакту
/// протягнути в граф довільний свій вміст під виглядом твердження.
fn is_safe_claim_value(predicate: &str, value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    let is_string = |key: &str| object.get(key).is_some_and(Value::is_string);

    match predicate {
        "declares-artifact" => {
            keys == ["artifact", "format"] && is_string("artifact") && is_string("format")
        }
        "declares-openapi-operation" => {
            keys == ["method", "path"] && is_string("method") && is_string("path")
        }
        "declares-asyncapi-channel" => keys == ["channel"] && is_string("channel"),
        "declares-graphql-definition" => {
            keys.contains(&"definition")
                && keys
                    .iter()
                    .all(|key| ["definition", "name", "operation"].contains(key))
                && is_string("definition")
                && object.get("name").is_none_or(Value::is_string)
                && object.get("operation").is_none_or(Value::is_string)
        }
        "declares-json-schema" => {
            !keys.is_empty()
                && keys.iter().all(|key| ["title", "type"].contains(key))
                && object.get("title").is_none_or(Value::is_string)
                && object.get("type").is_none_or(|kind| {
                    kind.is_string()
                        || kind
                            .as_array()
                            .is_some_and(|items| items.iter().all(Value::is_string))
                })
        }
        _ => false,
    }
}

/// Чи твердження детерміноване й локальне — порт `validStructuredClaim`.
fn valid_structured_claim(
    claim: &Value,
    domain_id: &str,
    node_ids: &BTreeSet<String>,
    evidence_ids: &BTreeSet<String>,
    content_hash: &str,
) -> bool {
    if string_field(claim, "layer") != Some("implemented") {
        return false;
    }
    let Some(predicate) = string_field(claim, "predicate") else {
        return false;
    };
    if !STRUCTURED_CLAIM_PREDICATES.contains(&predicate) {
        return false;
    }
    let Some(subject_id) = string_field(claim, "subjectId") else {
        return false;
    };
    let ids: Vec<String> = claim
        .get("evidenceIds")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let unique = ids.iter().collect::<BTreeSet<_>>().len() == ids.len();
    let value = claim.get("value").cloned().unwrap_or(Value::Null);
    if !node_ids.contains(subject_id)
        || ids.is_empty()
        || !unique
        || ids.iter().any(|id| !evidence_ids.contains(id))
        || claim.get("confidence") != Some(&json!(1))
        || string_field(claim, "sourceFingerprint") != Some(content_hash)
        || !is_safe_claim_value(predicate, &value)
    {
        return false;
    }
    // Останнє: ідентичність мусить БУТИ обчислена з полів, а не подана.
    string_field(claim, "id")
        == Some(&create_implemented_claim_id(
            domain_id, subject_id, predicate, &value, &ids,
        ))
}

/// Валідує один інʼєктований фрагмент — порт `validateFragment`.
fn validate_fragment(fragment: &Fragment, domain_id: &str) -> Result<(), Vec<Diagnostic>> {
    let path = fragment.path.as_str();
    let mut diagnostics = Vec::new();
    for node in &fragment.nodes {
        let ok = string_field(node, "id").is_some()
            && string_field(node, "kind").is_some_and(|kind| NODE_KINDS.contains(&kind))
            && string_field(node, "visibility")
                .is_some_and(|visibility| VISIBILITIES.contains(&visibility))
            && string_field(node, "domainId") == Some(domain_id);
        if !ok {
            diagnostics.push(Diagnostic::new(
                "invalid-structured-node",
                "Structured node має known kind, visibility і owning domain.",
                Some(path),
            ));
        }
    }
    for item in &fragment.evidence {
        let ok = string_field(item, "id").is_some()
            && string_field(item, "kind").is_some_and(|kind| EVIDENCE_KINDS.contains(&kind))
            && string_field(item, "path") == Some(path)
            && string_field(item, "contentHash").is_some();
        if !ok {
            diagnostics.push(Diagnostic::new(
                "invalid-structured-evidence",
                "Structured evidence має exact source path/content hash і known kind.",
                Some(path),
            ));
        }
    }
    let node_ids: BTreeSet<String> = fragment
        .nodes
        .iter()
        .filter_map(|node| string_field(node, "id"))
        .map(str::to_string)
        .collect();
    let evidence_ids: BTreeSet<String> = fragment
        .evidence
        .iter()
        .filter_map(|item| string_field(item, "id"))
        .map(str::to_string)
        .collect();
    for edge in &fragment.edges {
        let inside = |key: &str| string_field(edge, key).is_some_and(|id| node_ids.contains(id));
        let ok = string_field(edge, "id").is_some()
            && string_field(edge, "kind").is_some_and(|kind| EDGE_KINDS.contains(&kind))
            && inside("fromId")
            && inside("toId")
            && edge
                .get("evidenceIds")
                .and_then(Value::as_array)
                .is_some_and(|ids| {
                    ids.iter()
                        .all(|id| id.as_str().is_some_and(|id| evidence_ids.contains(id)))
                });
        if !ok {
            diagnostics.push(Diagnostic::new(
                "invalid-structured-edge",
                "Structured edge має local nodes і evidence provenance.",
                Some(path),
            ));
        }
    }
    let mut seen: BTreeSet<String> = BTreeSet::new();
    for claim in &fragment.claims {
        if !valid_structured_claim(
            claim,
            domain_id,
            &node_ids,
            &evidence_ids,
            &fragment.content_hash,
        ) {
            diagnostics.push(Diagnostic::new(
                "invalid-structured-claim",
                "Structured claim має бути deterministic, local та metadata-only.",
                Some(path),
            ));
            continue;
        }
        let id = string_field(claim, "id").unwrap_or_default().to_string();
        if !seen.insert(id.clone()) {
            diagnostics.push(Diagnostic::new(
                "duplicate-structured-claim",
                &id,
                Some(path),
            ));
        }
    }
    if diagnostics.is_empty() {
        Ok(())
    } else {
        Err(diagnostics)
    }
}

/// Вливає перевірені фрагменти в нормалізований граф — порт
/// `mergeStructuredFragments`.
///
/// # Errors
/// Невалідний фрагмент або зіткнення ідентичностей: повторний ID означає, що
/// два різні артефакти претендують на один вузол графа.
pub fn merge_structured_fragments(
    graph: &Value,
    domain_id: &str,
    fragments: &[Fragment],
) -> Result<Value, Vec<Diagnostic>> {
    let mut diagnostics = Vec::new();
    for fragment in fragments {
        if let Err(fragment_diagnostics) = validate_fragment(fragment, domain_id) {
            diagnostics.extend(fragment_diagnostics);
        }
    }
    if !diagnostics.is_empty() {
        return Err(sort_diagnostics(diagnostics));
    }
    let mut sorted: Vec<&Fragment> = fragments.iter().collect();
    sorted.sort_by(|left, right| js_locale_cmp(&left.path, &right.path));

    let collection = |key: &str| -> Vec<Value> {
        graph
            .get(key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let mut nodes = collection("nodes");
    let mut edges = collection("edges");
    let mut evidence = collection("evidence");
    let mut claims = collection("claims");
    let seen = |items: &[Value]| -> BTreeSet<String> {
        items
            .iter()
            .filter_map(|item| string_field(item, "id"))
            .map(str::to_string)
            .collect()
    };
    let mut node_ids = seen(&nodes);
    let mut edge_ids = seen(&edges);
    let mut evidence_ids = seen(&evidence);
    let mut claim_ids = seen(&claims);

    for fragment in sorted {
        for (items, ids, target, code) in [
            (
                &fragment.nodes,
                &mut node_ids,
                &mut nodes,
                "duplicate-structured-node",
            ),
            (
                &fragment.evidence,
                &mut evidence_ids,
                &mut evidence,
                "duplicate-structured-evidence",
            ),
            (
                &fragment.edges,
                &mut edge_ids,
                &mut edges,
                "duplicate-structured-edge",
            ),
            (
                &fragment.claims,
                &mut claim_ids,
                &mut claims,
                "duplicate-structured-claim",
            ),
        ] {
            for item in items {
                let id = string_field(item, "id").unwrap_or_default().to_string();
                if ids.contains(&id) {
                    diagnostics.push(Diagnostic::new(code, &id, Some(&fragment.path)));
                } else {
                    ids.insert(id);
                    target.push(item.clone());
                }
            }
        }
    }
    if !diagnostics.is_empty() {
        return Err(sort_diagnostics(diagnostics));
    }

    let sort_by_id = |items: &mut Vec<Value>| {
        items.sort_by(|left, right| {
            js_locale_cmp(
                string_field(left, "id").unwrap_or_default(),
                string_field(right, "id").unwrap_or_default(),
            )
        });
    };
    sort_by_id(&mut nodes);
    sort_by_id(&mut edges);
    sort_by_id(&mut evidence);
    sort_by_id(&mut claims);

    let mut merged = graph.clone();
    merged["nodes"] = Value::Array(nodes);
    merged["edges"] = Value::Array(edges);
    merged["evidence"] = Value::Array(evidence);
    merged["claims"] = Value::Array(claims);
    Ok(merged)
}
