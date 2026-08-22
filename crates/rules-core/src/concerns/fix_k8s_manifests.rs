//! Native fix-поверхня концерну `k8s/manifests` — Rust-порт T0-патернів
//! `fix-manifests.mjs`.
//!
//! # Чим редагується YAML і чому саме ним
//!
//! Фікси мусять зберігати коментарі: маніфести під `k8s/` їх несуть
//! (`# yaml-language-server:`-модлайни, пояснення біля ресурсних лімітів), і
//! serde-серіалізація знищила б їх мовчки. Доккоментар [`super::fix`]
//! фіксував, що Rust не має format-preserving YAML-редактора рівня
//! `toml_edit`, — станом на цей зріз має.
//!
//! Обрано **`yamlpatch`** (той самий крейт, на якому стоїть zizmor). Його
//! операції (`Add`, `Replace`, `MergeInto`) лягають на JS-`setIn` майже
//! дослівно, а `MergeInto` сам створює вкладену мапу, якої ще немає.
//!
//! **`yaml-edit` перевірено й відхилено.** Він побудований на rowan (тобто НЕ додав би
//! нового дерева залежностей — `rowan` уже в графі через `apollo-parser`) і
//! бездоганний на round-trip. Але додавання ключа у ВКЛАДЕНУ блокову мапу
//! (`Mapping::set` і навіть цільовий `modify_mapping`) кладе його на нульову
//! колонку:
//!
//! ```yaml
//! spec:
//!   ports:
//!     - port: 80
//! type: ClusterIP   # ← мало бути всередині spec
//! ```
//!
//! Тобто мовчки інший маніфест. Для фікс-поверхні це найгірший можливий
//! режим відмови, тож ціна важчого дерева залежностей прийнята свідомо.
//!
//! # Мультидок
//!
//! `yamlpath::Document` бачить потік цілком, але маршрут застосовується лише
//! до ПЕРШОГО збігу, а JS править КОЖЕН документ. Тому потік ріжеться по
//! рядках-роздільниках самотужки, кожен шматок патчиться окремо, і
//! роздільники повертаються на місце дослівно.
//!
//! Це водночас точніше за JS: там мультидок перезбирається через
//! `join('\n---\n')`, що з'їдає провідний `---` і нормалізує хвіст. Порт
//! зберігає файл як є — семантику це не міняє, а diff робить чесним.

use std::path::Path;

use rules_contract::fix::{FileEdit, FixPlan, WriteFile};

use crate::diagnostics::Violation;

/// Модлайн `# yaml-language-server: $schema=…`.
fn is_schema_modeline(line: &str) -> bool {
    let trimmed = line.trim_start();
    let Some(rest) = trimmed.strip_prefix('#') else {
        return false;
    };
    let rest = rest.trim_start();
    let Some(rest) = rest.strip_prefix("yaml-language-server:") else {
        return false;
    };
    let rest = rest.trim_start();
    rest.strip_prefix("$schema=")
        .is_some_and(|value| !value.is_empty() && !value.starts_with(char::is_whitespace))
}

/// Переміщує модлайн у перший рядок файла — порт `moveSchemaModelineFirst`.
///
/// `None`, якщо модлайна немає або він УЖЕ перший: обидва випадки —
/// штатний no-op, а не помилка.
#[must_use]
pub fn move_schema_modeline_first(content: &str) -> Option<String> {
    let mut lines: Vec<&str> = content.split('\n').collect();
    let index = lines.iter().position(|line| is_schema_modeline(line))?;
    if index == 0 {
        return None;
    }
    let modeline = lines.remove(index).trim_start().to_string();
    let mut out = String::with_capacity(content.len());
    out.push_str(&modeline);
    for line in lines {
        out.push('\n');
        out.push_str(line);
    }
    Some(out)
}

/// Перемикач одного рядка `apiVersion:` зі старої версії на нову.
///
/// Рядки, що після trim починаються з `#`, не чіпаються — це коментар, а не
/// поле.
fn rewrite_api_version_line(line: &str, from: &str, to: &str) -> Option<String> {
    if line.trim_start().starts_with('#') {
        return None;
    }
    let indent_len = line.len() - line.trim_start().len();
    let (indent, body) = line.split_at(indent_len);
    let value = body.strip_prefix("apiVersion:")?;
    let trailing_len = value.len() - value.trim_end().len();
    let (value, trailing) = value.split_at(value.len() - trailing_len);
    let leading_len = value.len() - value.trim_start().len();
    let (spacing, value) = value.split_at(leading_len);
    // Лапки НЕОБОВʼЯЗКОВІ й знімаються незалежно — дзеркало `["']?…["']?`
    // канонічної регулярки, яка приймає навіть непарну пару.
    let value = value.strip_prefix(['"', '\'']).unwrap_or(value);
    let value = value.strip_suffix(['"', '\'']).unwrap_or(value);
    if value != from {
        return None;
    }
    Some(format!("{indent}apiVersion:{spacing}{to}{trailing}"))
}

/// Застосовує порядкову заміну до всього файла, зберігаючи стиль кінця рядка.
fn rewrite_lines(content: &str, mut rewrite: impl FnMut(&str) -> Option<String>) -> Option<String> {
    let eol = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut changed = false;
    let out: Vec<String> = content
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .map(|line| match rewrite(line) {
            Some(next) => {
                changed = true;
                next
            }
            None => line.to_string(),
        })
        .collect();
    changed.then(|| out.join(eol))
}

/// `apiVersion: gateway.networking.k8s.io/v1beta1` → `/v1` разом із
/// `$schema`-модлайном — порт
/// `replaceGatewayHttpRouteV1beta1ApiVersionInYamlText`.
///
/// Модлайн переписується В ТОМУ Ж проході: інакше маніфест лишився б із
/// схемою, яка описує вже неіснуючу версію.
#[must_use]
pub fn replace_gateway_httproute_v1beta1(content: &str) -> Option<String> {
    rewrite_lines(content, |line| {
        let rewritten = rewrite_api_version_line(
            line,
            "gateway.networking.k8s.io/v1beta1",
            "gateway.networking.k8s.io/v1",
        );
        let base = rewritten.as_deref().unwrap_or(line);
        if base.contains("httproute_v1beta1.json") {
            return Some(base.replace("httproute_v1beta1.json", "httproute_v1.json"));
        }
        rewritten
    })
}

/// `apiVersion: batch/v1beta1` → `batch/v1` — порт
/// `replaceBatchV1beta1ApiVersionInYamlText`.
#[must_use]
pub fn replace_batch_v1beta1(content: &str) -> Option<String> {
    rewrite_lines(content, |line| {
        rewrite_api_version_line(line, "batch/v1beta1", "batch/v1")
    })
}

/// Рядок-роздільник документів (`---` на нульовій колонці).
///
/// Всередині мапи блоковий скаляр завжди має відступ, тож `---` на нульовій
/// колонці не може бути вмістом — саме на цьому стоїть і канонічний
/// `YAML_DOC_SEPARATOR_LINE_RE`.
fn is_document_separator(line: &str) -> bool {
    line.strip_prefix("---")
        .is_some_and(|rest| rest.trim().is_empty())
}

/// Ріже потік на шматки-документи разом із їхніми роздільниками.
///
/// Кожен елемент — `(роздільник, тіло)`; роздільник порожній лише в першого
/// шматка файла без провідного `---`.
fn split_documents(content: &str) -> Vec<(String, String)> {
    let mut chunks: Vec<(String, String)> = Vec::new();
    let mut separator = String::new();
    let mut body: Vec<&str> = Vec::new();
    for line in content.split('\n') {
        if is_document_separator(line.strip_suffix('\r').unwrap_or(line)) {
            if !separator.is_empty() || !body.is_empty() {
                chunks.push((separator, body.join("\n")));
            }
            separator = format!("{line}\n");
            body.clear();
            continue;
        }
        body.push(line);
    }
    if !separator.is_empty() || !body.is_empty() {
        chunks.push((separator, body.join("\n")));
    }
    chunks
}

/// Застосовує патч до КОЖНОГО документа потоку, зберігаючи роздільники.
///
/// `patch` повертає `None`, коли документ чіпати не треба. Помилка розбору
/// БУДЬ-ЯКОГО документа — no-op на весь файл: JS так само не чіпає файли,
/// які парсяться з помилками.
/// Правка одного документа.
enum DocumentEdit {
    /// Операції `yamlpatch`.
    Patches(Vec<yamlpatch::Patch<'static>>),
    /// Готове тіло документа — шлях для випадків, яких `yamlpatch` не вміє
    /// (див. [`insert_block_key`]).
    Body(String),
}

fn patch_documents(
    content: &str,
    mut patch: impl FnMut(&serde_yaml::Value, &yamlpath::Document) -> Option<DocumentEdit>,
) -> Option<String> {
    let chunks = split_documents(content);
    let mut out = String::with_capacity(content.len());
    let mut changed = false;
    for (separator, body) in chunks {
        out.push_str(&separator);
        if body.trim().is_empty() {
            out.push_str(&body);
            continue;
        }
        let Ok(document) = yamlpath::Document::new(&body) else {
            return None;
        };
        // Рішення приймаються по РОЗІБРАНОМУ документу, а не по сирому
        // тексту: JS дивиться на `doc.getIn(...)`, тобто на значення. Інакше
        // `type: "ClusterIP"` у лапках виглядав би неканонічним і файл
        // переписувався б там, де канон уже витримано.
        let Ok(parsed) = serde_yaml::from_str::<serde_yaml::Value>(&body) else {
            return None;
        };
        let Some(edit) = patch(&parsed, &document) else {
            out.push_str(&body);
            continue;
        };
        match edit {
            DocumentEdit::Body(next) => {
                changed = true;
                out.push_str(&next);
            }
            DocumentEdit::Patches(patches) if patches.is_empty() => out.push_str(&body),
            DocumentEdit::Patches(patches) => {
                let Ok(patched) = yamlpatch::apply_yaml_patches(&document, &patches) else {
                    return None;
                };
                changed = true;
                out.push_str(patched.source());
            }
        }
    }
    changed.then_some(out)
}

/// Патчить лише ПЕРШИЙ документ потоку.
///
/// Не спрощення: `ensureHasuraConfigMapRequiredEnv` у JS бере
/// `parseDocument`, а не `parseAllDocuments`, тобто далі першого документа не
/// дивиться. Ця межа тут відтворена свідомо.
fn patch_first_document(
    content: &str,
    patch: impl FnOnce(&serde_yaml::Value, &yamlpath::Document) -> Option<DocumentEdit>,
) -> Option<String> {
    let mut done = false;
    let mut patch = Some(patch);
    patch_documents(content, move |parsed, document| {
        if done {
            return None;
        }
        done = true;
        patch.take()?(parsed, document)
    })
}

/// Знімає спільний відступ блоку, лишаючи його внутрішню структуру.
fn dedent(block: &str) -> String {
    let base = block
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.len() - line.trim_start().len())
        .min()
        .unwrap_or(0);
    block
        .lines()
        .map(|line| line.get(base..).unwrap_or("").to_string())
        .collect::<Vec<String>>()
        .join("\n")
}

/// Ставить ключ із БЛОКОВИМ значенням у мапу, зберігаючи блоковий стиль.
///
/// Чому текстом, а не операцією `yamlpatch`: обидва його шляхи псують вигляд
/// саме тут. `Op::Add` для послідовності жорстко серіалізує її у flow
/// (`[{ … }]`) — валідний YAML, але однорядкова каша замість списку, і
/// жоден сусідній ресурс так не записаний. `Op::Replace` бере значення з
/// `yaml_serde`, а той не робить відступу елементам ВКЛАДЕНОЇ послідовності
/// (`ports:` під `- to:`), тобто дає інший вигляд, ніж канон.
///
/// Точка вставки й відступ рахуються ДВОМА публічними помічниками самого
/// `yamlpatch`, тобто тією ж логікою, що і в нього.
fn set_block_key(
    document: &yamlpath::Document,
    parent: &yamlpath::Route,
    key: &str,
    block: &str,
) -> Option<String> {
    let source = document.source();
    let feature = document.query_exact(parent).ok()??;
    let indent = yamlpatch::extract_leading_indentation_for_block_item(document, &feature);
    let padding = " ".repeat(indent);
    let mut rendered = String::new();
    for line in dedent(block).lines() {
        rendered.push('\n');
        if !line.trim().is_empty() {
            rendered.push_str(&padding);
            rendered.push_str("  ");
            rendered.push_str(line);
        }
    }

    let mut route = parent.clone();
    route = route.with_key(key);
    if let Ok(Some(existing)) = document.query_exact(&route) {
        // Ключ уже є — міняємо САМЕ ЙОГО значення, не чіпаючи ні ключа, ні
        // сусідів.
        let (start, end) = existing.location.byte_span;
        let mut out = String::with_capacity(source.len() + rendered.len());
        out.push_str(source.get(..start)?);
        out.push_str(rendered.trim_start_matches('\n'));
        out.push_str(source.get(end..)?);
        return Some(out);
    }

    // Точка вставки приходить ПІСЛЯ переводу рядка останнього рядка вузла.
    // Вставляти там означало б лишити порожній рядок перед новим ключем і
    // зʼїсти кінцевий перевід рядка файла, тож відступаємо за нього.
    let mut insertion = yamlpatch::find_content_end(&feature, document);
    if source[..insertion].ends_with('\n') {
        insertion -= 1;
        if source[..insertion].ends_with('\r') {
            insertion -= 1;
        }
    }
    let mut out = String::with_capacity(source.len() + rendered.len());
    out.push_str(source.get(..insertion)?);
    out.push_str(&format!("\n{padding}{key}:"));
    out.push_str(&rendered);
    out.push_str(source.get(insertion..)?);
    Some(out)
}

/// Значення за шляхом у розібраному документі.
fn value_at<'a>(parsed: &'a serde_yaml::Value, path: &[&str]) -> Option<&'a serde_yaml::Value> {
    let mut current = parsed;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

/// Рядкове значення за шляхом; не-рядок (число, булеве) — `None`, як і
/// `=== 'ClusterIP'` у JS.
fn string_at(parsed: &serde_yaml::Value, path: &[&str]) -> Option<String> {
    value_at(parsed, path)?.as_str().map(str::to_string)
}

/// `kind` документа.
fn document_kind(parsed: &serde_yaml::Value) -> Option<String> {
    string_at(parsed, &["kind"])
}

/// Проставляє `spec.type: ClusterIP` у кожен `kind: Service` — порт
/// `ensureSvcClusterIpType`.
#[must_use]
pub fn ensure_svc_cluster_ip_type(content: &str) -> Option<String> {
    ensure_service_spec_field(content, "type", "ClusterIP")
}

/// Проставляє `spec.clusterIP: None` у кожен `kind: Service` — порт
/// `ensureSvcHlClusterIp`.
///
/// `metadata.name` НЕ чіпається: суфікс `-hl` — це перейменування ресурсу, на
/// яке посилаються інші файли, тобто не T0.
#[must_use]
pub fn ensure_svc_hl_cluster_ip(content: &str) -> Option<String> {
    ensure_service_spec_field(content, "clusterIP", "None")
}

/// Спільне тіло двох сервісних фіксів: одне скалярне поле в `spec`.
fn ensure_service_spec_field(
    content: &str,
    key: &'static str,
    value: &'static str,
) -> Option<String> {
    patch_documents(content, move |parsed, _| {
        if document_kind(parsed)? != "Service" {
            return None;
        }
        let patch = match string_at(parsed, &["spec", key]) {
            // Ідемпотентність: уже канонічне значення — не чіпаємо.
            Some(current) if current == value => return None,
            Some(_) => yamlpatch::Patch {
                route: yamlpath::route!("spec", key),
                operation: yamlpatch::Op::Replace(yaml_serde::Value::String(value.to_string())),
            },
            None => yamlpatch::Patch {
                route: yamlpath::route!("spec"),
                operation: yamlpatch::Op::Add {
                    key: key.to_string(),
                    value: yaml_serde::Value::String(value.to_string()),
                },
            },
        };
        Some(DocumentEdit::Patches(vec![patch]))
    })
}

/// Канонічна стратегія оновлення Deployment.
const STRATEGY_TYPE: &str = "RollingUpdate";

/// Проставляє канонічний `spec.strategy` у кожен `kind: Deployment` — порт
/// `ensureDeploymentStrategy`.
///
/// Ідемпотентність перевіряється за ТРЬОМА листками, а не за рівністю всього
/// обʼєкта, як у JS. Різниці у наслідку немає: коли листки збігаються, а під
/// `strategy` є ще щось, JS теж переписує файл тими самими значеннями й
/// отримує байт-у-байт той самий текст, тобто запису не робить.
#[must_use]
pub fn ensure_deployment_strategy(content: &str) -> Option<String> {
    patch_documents(content, |parsed, _| {
        if document_kind(parsed)? != "Deployment" {
            return None;
        }
        // `spec` має бути: JS вимагає `doc.has('spec')` і мовчки пропускає
        // документ без нього.
        value_at(parsed, &["spec"])?;
        let number_is = |path: &[&str], expected: u64| {
            value_at(parsed, path).and_then(serde_yaml::Value::as_u64) == Some(expected)
        };
        let canonical = string_at(parsed, &["spec", "strategy", "type"])
            .is_some_and(|value| value == STRATEGY_TYPE)
            && number_is(&["spec", "strategy", "rollingUpdate", "maxUnavailable"], 0)
            && number_is(&["spec", "strategy", "rollingUpdate", "maxSurge"], 1);
        if canonical {
            return None;
        }
        // ДВА кроки, а не один вкладений `MergeInto`: значення-мапа в
        // `updates` виводиться з відступом БАТЬКА, тобто
        // `rollingUpdate:` лишається порожнім, а його поля стають
        // сусідами. Скалярні `updates` на кожному рівні цього не мають.
        let mut strategy = indexmap::IndexMap::new();
        strategy.insert(
            "type".to_string(),
            yaml_serde::Value::String(STRATEGY_TYPE.to_string()),
        );
        let mut rolling = indexmap::IndexMap::new();
        rolling.insert(
            "maxUnavailable".to_string(),
            yaml_serde::Value::Number(0.into()),
        );
        rolling.insert("maxSurge".to_string(), yaml_serde::Value::Number(1.into()));
        Some(DocumentEdit::Patches(vec![
            yamlpatch::Patch {
                route: yamlpath::route!("spec"),
                operation: yamlpatch::Op::MergeInto {
                    key: "strategy".to_string(),
                    updates: strategy,
                },
            },
            yamlpatch::Patch {
                route: yamlpath::route!("spec", "strategy"),
                operation: yamlpatch::Op::MergeInto {
                    key: "rollingUpdate".to_string(),
                    updates: rolling,
                },
            },
        ]))
    })
}

/// Обовʼязкові `HASURA_GRAPHQL_*` — порт `HASURA_REQUIRED_ENV_VALUES`
/// (дзеркалить `k8s.hasura_configmap.rego`).
///
/// `None` як очікування означає «значення довільне»: ключ лише не має бути
/// відсутнім.
const HASURA_REQUIRED_ENV_VALUES: &[(&str, Option<&str>)] = &[
    (
        "HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS",
        Some("true"),
    ),
    ("HASURA_GRAPHQL_ENABLE_RELAY", Some("false")),
    ("HASURA_GRAPHQL_ENABLE_TELEMETRY", Some("false")),
    ("HASURA_GRAPHQL_ENABLED_LOG_TYPES", Some("startup,http-log")),
    (
        "HASURA_GRAPHQL_ENABLED_APIS",
        Some("metadata,graphql,pgdump"),
    ),
    ("HASURA_GRAPHQL_DISABLE_EVENTING", None),
];

/// Чи значення читається як логічне `true` — дзеркалить `is_value_true` в
/// rego: булеве `true` АБО рядок `"true"` у будь-якому регістрі.
fn is_truthy_bool(value: Option<&serde_yaml::Value>) -> bool {
    match value {
        Some(serde_yaml::Value::Bool(flag)) => *flag,
        Some(serde_yaml::Value::String(text)) => text.trim().eq_ignore_ascii_case("true"),
        _ => false,
    }
}

/// Чи значення читається як логічне `false` — дзеркалить `is_value_false`.
fn is_falsy_bool(value: Option<&serde_yaml::Value>) -> bool {
    match value {
        Some(serde_yaml::Value::Bool(flag)) => !*flag,
        Some(serde_yaml::Value::String(text)) => text.trim().eq_ignore_ascii_case("false"),
        _ => false,
    }
}

/// Значення для одного `HASURA_GRAPHQL_*` ключа — порт
/// `resolveHasuraEnvValue`. `None` — змін не потрібно.
fn resolve_hasura_env_value(
    expected: Option<&str>,
    current: Option<&serde_yaml::Value>,
) -> Option<String> {
    match expected {
        // Довільне значення: проставляємо, лише коли ключа немає взагалі.
        None => current.is_none().then(|| "true".to_string()),
        Some("true") => (!is_truthy_bool(current)).then(|| "true".to_string()),
        Some("false") => (!is_falsy_bool(current)).then(|| "false".to_string()),
        Some(expected) => (current.and_then(serde_yaml::Value::as_str) != Some(expected))
            .then(|| expected.to_string()),
    }
}

/// Проставляє обовʼязкові `HASURA_GRAPHQL_*` у `data` ConfigMap — порт
/// `ensureHasuraConfigMapRequiredEnv`.
#[must_use]
pub fn ensure_hasura_configmap_required_env(content: &str) -> Option<String> {
    patch_first_document(content, |parsed, _| {
        if document_kind(parsed)? != "ConfigMap" {
            return None;
        }
        let mut patches = Vec::new();
        for (key, expected) in HASURA_REQUIRED_ENV_VALUES {
            let current = value_at(parsed, &["data", key]);
            let Some(value) = resolve_hasura_env_value(*expected, current) else {
                continue;
            };
            let value = yaml_serde::Value::String(value);
            patches.push(if current.is_some() {
                yamlpatch::Patch {
                    route: yamlpath::route!("data", *key),
                    operation: yamlpatch::Op::Replace(value),
                }
            } else {
                yamlpatch::Patch {
                    route: yamlpath::route!("data"),
                    operation: yamlpatch::Op::Add {
                        key: (*key).to_string(),
                        value,
                    },
                }
            });
        }
        (!patches.is_empty()).then_some(DocumentEdit::Patches(patches))
    })
}

/// Початок Hasura-канона в `spec.rules` — порт `findHasuraCanonStart`.
///
/// Канон починається з правила з РІВНО одним `matches`, без `headers`, і зі
/// шляхом `Exact`, що закінчується на `/ql`. Повертає префікс і індекс.
fn find_hasura_canon_start(rules: &[serde_yaml::Value]) -> Option<(String, usize)> {
    for (index, rule) in rules.iter().enumerate() {
        let Some(matches) = rule.get("matches").and_then(serde_yaml::Value::as_sequence) else {
            continue;
        };
        if matches.len() != 1 {
            continue;
        }
        let first = &matches[0];
        if !first.is_mapping() || first.get("headers").is_some() {
            continue;
        }
        let Some(path) = first.get("path") else {
            continue;
        };
        if path.get("type").and_then(serde_yaml::Value::as_str) != Some("Exact") {
            continue;
        }
        let Some(value) = path.get("value").and_then(serde_yaml::Value::as_str) else {
            continue;
        };
        if let Some(prefix) = value.strip_suffix("/ql") {
            return Some((prefix.to_string(), index));
        }
    }
    None
}

/// Чи правило вже несе канонічний `RequestRedirect` — порт
/// `hasuraRuleHasExactRedirect`.
fn hasura_rule_has_exact_redirect(rule: &serde_yaml::Value, to_path: &str) -> bool {
    let Some(filters) = rule.get("filters").and_then(serde_yaml::Value::as_sequence) else {
        return false;
    };
    if filters.len() != 1 {
        return false;
    }
    let filter = &filters[0];
    if filter.get("type").and_then(serde_yaml::Value::as_str) != Some("RequestRedirect") {
        return false;
    }
    let Some(redirect) = filter.get("requestRedirect") else {
        return false;
    };
    if redirect
        .get("statusCode")
        .and_then(serde_yaml::Value::as_u64)
        != Some(302)
    {
        return false;
    }
    let Some(path) = redirect.get("path") else {
        return false;
    };
    path.get("type").and_then(serde_yaml::Value::as_str) == Some("ReplaceFullPath")
        && path
            .get("replaceFullPath")
            .and_then(serde_yaml::Value::as_str)
            == Some(to_path)
}

/// Проставляє канонічний `RequestRedirect` у правило 1 Hasura-канона — порт
/// `ensureHasuraHttpRouteRule1Filters`.
///
/// Лагодить ЛИШЕ наявне правило (перезапис `filters`). Правила 2-4
/// потребують синтезу нового правила з `backendRef`, якого нізвідки
/// достовірно вивести, — це рішення про інфраструктуру, не T0.
#[must_use]
pub fn ensure_hasura_httproute_rule1_filters(content: &str) -> Option<String> {
    patch_documents(content, |parsed, document| {
        if document_kind(parsed)? != "HTTPRoute" {
            return None;
        }
        let rules = value_at(parsed, &["spec", "rules"])?.as_sequence()?;
        if rules.is_empty() {
            return None;
        }
        let (prefix, index) = find_hasura_canon_start(rules)?;
        let console_path = format!("{prefix}/ql/console");
        if hasura_rule_has_exact_redirect(&rules[index], &console_path) {
            return None; // вже канонічно
        }
        let quoted = serde_yaml::to_string(&serde_yaml::Value::String(console_path))
            .ok()?
            .trim()
            .to_string();
        let filters = format!(
            "- type: RequestRedirect\n  requestRedirect:\n    statusCode: 302\n    path:\n      type: ReplaceFullPath\n      replaceFullPath: {quoted}"
        );
        set_block_key(
            document,
            &yamlpath::route!("spec", "rules", index),
            "filters",
            &filters,
        )
        .map(DocumentEdit::Body)
    })
}

/// Snippet NetworkPolicy для workload-kind — порт `KIND_TO_SNIPPET` +
/// `snippetNameForKind`.
///
/// `None` — невідомий kind. У JS тут `throw`, який ловить обгортка фіксу й
/// перетворює на no-op ДЛЯ ВСЬОГО ФАЙЛА; порт тримає ту саму межу.
fn snippet_file_for_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "Deployment" | "Job" | "CronJob" | "DaemonSet" => {
            Some("k8s/network_policy/template/deployment.snippet.yaml")
        }
        "StatefulSet" => Some("k8s/network_policy/template/stateful-set.snippet.yaml"),
        _ => None,
    }
}

/// Читає `spec.egress` сніпета NetworkPolicy — порт `loadSnippetSpec`.
///
/// Повертає і РОЗІБРАНЕ значення (для перевірки на ідемпотентність), і його
/// СИРИЙ текст: канон — це сам файл сніпета, тож переносити його дослівно
/// точніше, ніж пересеріалізовувати.
fn load_snippet_egress(rules_root: &Path, kind: &str) -> Option<(serde_yaml::Value, String)> {
    let rel = snippet_file_for_kind(kind)?;
    let raw = std::fs::read_to_string(rules_root.join(rel)).ok()?;
    let parsed = serde_yaml::from_str::<serde_yaml::Value>(&raw).ok()?;
    let value = parsed.get("spec")?.get("egress")?.clone();
    if !value.is_sequence() {
        return None;
    }
    let document = yamlpath::Document::new(&raw).ok()?;
    let feature = document
        .query_exact(&yamlpath::route!("spec", "egress"))
        .ok()??;
    // `extract` віддає ПЕРШИЙ рядок від позиції значення, тобто без
    // відступу, а решту — з їхнім початковим. Повертаємо першому рядку його
    // відступ, щоб блок був однорідним.
    let extracted = document.extract(&feature);
    let base = extracted
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.len() - line.trim_start().len())
        .min()
        .unwrap_or(0);
    let mut block = String::new();
    for line in extracted.lines() {
        // Рядки-коментарі сніпета лишаються в сніпеті. Вони пояснюють САМ
        // канон («matchLabels:{} лишається без JS-substitution»), а не
        // маніфест, у який його переносять; JS їх теж не переносить, бо
        // пересеріалізовує значення. Припущення вузьке й перевірене: у
        // блоці egress немає блокових скалярів, де `#` був би вмістом.
        if line.trim_start().starts_with('#') {
            continue;
        }
        if block.is_empty() {
            block.push_str(&" ".repeat(base));
        } else {
            block.push('\n');
        }
        block.push_str(line);
    }
    Some((value, dedent(&block)))
}

/// Проставляє канонічний `spec.egress` у кожен `kind: NetworkPolicy` — порт
/// `ensureNetworkPolicyEgress`.
///
/// Джерело egress — ТОЙ САМИЙ сніпет, яким rego темплейтить перевірку, тож
/// збіг із очікуванням re-detect гарантований конструкцією, а не звіркою.
#[must_use]
pub fn ensure_network_policy_egress(content: &str, rules_root: &Path) -> Option<String> {
    let mut unknown_kind = false;
    let patched = patch_documents(content, |parsed, document| {
        if unknown_kind || document_kind(parsed)? != "NetworkPolicy" {
            return None;
        }
        value_at(parsed, &["spec"])?;
        let workload = value_at(
            parsed,
            &["metadata", "annotations", "nitra.dev/workload-kind"],
        )
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or("Deployment")
        .to_string();
        if snippet_file_for_kind(&workload).is_none() {
            unknown_kind = true;
            return None;
        }
        let (egress_value, egress_block) = load_snippet_egress(rules_root, &workload)?;
        if value_at(parsed, &["spec", "egress"]) == Some(&egress_value) {
            return None; // ідемпотентність
        }
        set_block_key(document, &yamlpath::route!("spec"), "egress", &egress_block)
            .map(DocumentEdit::Body)
    });
    // Невідомий workload-kind — no-op на весь файл, як `throw` у JS.
    if unknown_kind {
        return None;
    }
    patched
}

/// Ключ упорядкування одного запису `patches[]` — порт
/// `kustomizationPatchSortKey`.
///
/// Порядок полів контрактний: `target.kind` → `target.name` →
/// `target.namespace` → `path`. Відсутнє чи не-рядкове поле — порожній
/// рядок, і він сортується ПЕРШИМ.
fn kustomization_patch_sort_key(item: &serde_yaml::Value) -> [String; 4] {
    let field = |parent: &serde_yaml::Value, key: &str| {
        parent
            .get(key)
            .and_then(serde_yaml::Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let empty = serde_yaml::Value::Null;
    let target = item
        .get("target")
        .filter(|t| t.is_mapping())
        .unwrap_or(&empty);
    [
        field(target, "kind"),
        field(target, "name"),
        field(target, "namespace"),
        field(item, "path"),
    ]
}

/// Порівняння tuple-ключів — порт `compareStringTuplesEn`
/// (`localeCompare(…, 'en', { sensitivity: 'base' })`).
fn compare_string_tuples_en(left: &[String; 4], right: &[String; 4]) -> std::cmp::Ordering {
    for (left, right) in left.iter().zip(right.iter()) {
        let order = crate::locale::locale_compare_base(left, right);
        if order != std::cmp::Ordering::Equal {
            return order;
        }
    }
    std::cmp::Ordering::Equal
}

/// Один запис `patches[]` разом із коментарями, які йому передують.
struct PatchBlock {
    lines: Vec<String>,
}

/// Ріже рядки послідовності на блоки «коментарі + елемент».
///
/// Рядок-коментар перед елементом належить ЙОМУ — це та сама прив'язка,
/// що `commentBefore` у CST пакета `yaml`. Саме вона дає коментарям
/// їхати разом зі своїм записом.
fn split_patch_blocks(
    lines: &[&str],
    item_indent: usize,
) -> Option<(Vec<PatchBlock>, Vec<String>)> {
    let is_item_start = |line: &str| {
        let trimmed = line.trim_start();
        line.len() - trimmed.len() == item_indent && (trimmed == "-" || trimmed.starts_with("- "))
    };
    let mut blocks: Vec<PatchBlock> = Vec::new();
    let mut pending: Vec<String> = Vec::new();
    for line in lines {
        if is_item_start(line) {
            let mut own = std::mem::take(&mut pending);
            own.push((*line).to_string());
            blocks.push(PatchBlock { lines: own });
            continue;
        }
        if line.trim_start().starts_with('#') || line.trim().is_empty() {
            pending.push((*line).to_string());
            continue;
        }
        blocks.last_mut()?.lines.push((*line).to_string());
    }
    Some((blocks, pending))
}

/// Упорядковує `patches[]` Kustomization — порт `sortKustomizationPatches`.
///
/// Ключі й порядок ті самі, що в детектора, тож re-detect бачить рівно те,
/// чого чекає.
///
/// # Розбіжність із JS — свідома
///
/// У JS коментарі при перестановці НЕ їдуть за своїм записом: `yaml` друкує
/// коментар перед першим елементом як власний коментар послідовності, тож
/// після сортування пояснення до Service опиняється над записом Deployment.
/// Тобто фікс лишає в файлі оману. Порт возить коментар разом із його
/// записом; rego-звірка від цього не залежить (коментарі їй байдужі), а
/// файл лишається правдивим.
#[must_use]
pub fn sort_kustomization_patches(content: &str) -> Option<String> {
    patch_first_document(content, |parsed, document| {
        let items = parsed.get("patches")?.as_sequence()?;
        if items.len() < 2 {
            return None;
        }
        let mut order: Vec<usize> = (0..items.len()).collect();
        order.sort_by(|left, right| {
            compare_string_tuples_en(
                &kustomization_patch_sort_key(&items[*left]),
                &kustomization_patch_sort_key(&items[*right]),
            )
            .then(left.cmp(right))
        });
        if order.iter().enumerate().all(|(index, item)| index == *item) {
            return None; // вже відсортовано
        }

        let source = document.source();
        let feature = document.query_exact(&yamlpath::route!("patches")).ok()??;
        let (start, end) = feature.location.byte_span;
        let mut start = source[..start].rfind('\n').map_or(0, |index| index + 1);
        let end = source[end..]
            .find('\n')
            .map_or(source.len(), |index| end + index);
        let item_indent = source
            .get(start..end)?
            .split('\n')
            .next()
            .map(|line| line.len() - line.trim_start().len())?;
        // Коментарі ПЕРЕД першим елементом теж належать йому, тож регіон
        // розширюється вгору по суцільних рядках-коментарях з тим самим (або
        // глибшим) відступом. Коментар над самим ключем `patches:` має
        // менший відступ і лишається на місці.
        while start > 0 {
            let previous_end = start - 1;
            let previous_start = source[..previous_end].rfind('\n').map_or(0, |i| i + 1);
            let line = source.get(previous_start..previous_end)?;
            let indent = line.len() - line.trim_start().len();
            if !line.trim_start().starts_with('#') || indent < item_indent {
                break;
            }
            start = previous_start;
        }
        let region: Vec<&str> = source.get(start..end)?.split('\n').collect();
        let (blocks, trailing) = split_patch_blocks(&region, item_indent)?;
        if blocks.len() != items.len() {
            return None; // розмітка не збіглася з розібраним — не чіпаємо
        }

        let mut rebuilt: Vec<String> = Vec::new();
        for index in order {
            rebuilt.extend(blocks[index].lines.iter().cloned());
        }
        rebuilt.extend(trailing);
        let mut out = String::with_capacity(source.len());
        out.push_str(source.get(..start)?);
        out.push_str(&rebuilt.join("\n"));
        out.push_str(source.get(end..)?);
        Some(DocumentEdit::Body(out))
    })
}

/// Чи вміє цей зріз лагодити родину порушення.
fn handles(kind: &str) -> bool {
    matches!(
        kind,
        "gateway-httproute-v1beta1"
            | "batch-v1beta1-apiversion"
            | "schema-modeline-first"
            | "deployment-strategy"
            | "svc-clusterip-type"
            | "svc-hl-cluster-ip"
            | "hasura-configmap-env"
            | "hasura-httproute-rule1-filters"
            | "networkpolicy-egress"
            | "kustomization-patches-sort"
    )
}

/// Застосовує трансформер родини до вмісту файла.
///
/// `rules_root` потрібен лише `networkpolicy-egress`: канонічний egress
/// береться з того самого сніпета, яким rego темплейтить перевірку. Коли
/// корінь пакета не знайдено, ця родина стає no-op — вигадати канон
/// самотужки означало б розійтися з re-detect.
fn apply_transform(kind: &str, content: &str, rules_root: Option<&Path>) -> Option<String> {
    match kind {
        "gateway-httproute-v1beta1" => replace_gateway_httproute_v1beta1(content),
        "batch-v1beta1-apiversion" => replace_batch_v1beta1(content),
        "schema-modeline-first" => move_schema_modeline_first(content),
        "deployment-strategy" => ensure_deployment_strategy(content),
        "svc-clusterip-type" => ensure_svc_cluster_ip_type(content),
        "svc-hl-cluster-ip" => ensure_svc_hl_cluster_ip(content),
        "hasura-configmap-env" => ensure_hasura_configmap_required_env(content),
        "hasura-httproute-rule1-filters" => ensure_hasura_httproute_rule1_filters(content),
        "networkpolicy-egress" => ensure_network_policy_egress(content, rules_root?),
        "kustomization-patches-sort" => sort_kustomization_patches(content),
        _ => None,
    }
}

/// Будує [`FixPlan`] для `k8s/manifests` — порт `patterns` із
/// `fix-manifests.mjs`.
///
/// Родина порушення береться з `data.kind` детектора (#3 fix-hints), як і в
/// JS. Незнайома родина просто не має трансформера — це не помилка, а
/// «цей зріз її ще не лагодить».
///
/// Порядок правок стабільний за шляхом: план — детермінований артефакт, який
/// іде в JSON, і нестабільний порядок робив би diff шумним.
#[must_use]
pub fn k8s_manifests_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    let mut targets: Vec<(String, &str)> = Vec::new();
    for violation in violations {
        let Some(file) = violation.file.as_deref() else {
            continue;
        };
        let Some(kind) = violation
            .data
            .as_ref()
            .and_then(|data| data.get("kind"))
            .and_then(serde_json::Value::as_str)
        else {
            continue;
        };
        if !handles(kind) {
            continue;
        }
        if !targets
            .iter()
            .any(|(seen, seen_kind)| seen == file && *seen_kind == kind)
        {
            targets.push((file.to_string(), kind));
        }
    }
    targets.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(right.1)));

    let rules_root = crate::rules_package::rules_root(cwd);
    let mut edits: Vec<FileEdit> = Vec::new();
    for (file, kind) in targets {
        // Наступний трансформер тієї ж родини мусить бачити вже
        // застосовану правку — інакше два порушення в одному файлі
        // затирали б одне одного.
        let current = edits
            .iter()
            .rev()
            .find_map(|edit| match edit {
                FileEdit::Write(write) if write.path == file => Some(write.content.clone()),
                _ => None,
            })
            .or_else(|| std::fs::read_to_string(cwd.join(&file)).ok());
        let Some(current) = current else {
            continue; // файл відсутній/нечитабельний — пропустити, як у JS
        };
        let Some(next) = apply_transform(kind, &current, rules_root.as_deref()) else {
            continue;
        };
        if next == current {
            continue;
        }
        edits.push(FileEdit::Write(WriteFile {
            path: file,
            content: next,
        }));
    }
    FixPlan { edits }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Severity;

    fn violation(file: Option<&str>, kind: Option<&str>) -> Violation {
        Violation {
            reason: "k8s-manifests".to_string(),
            message: "порушення".to_string(),
            file: file.map(str::to_string),
            severity: Severity::Error,
            data: kind.map(|kind| serde_json::json!({ "kind": kind })),
        }
    }

    fn temp_root(label: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("rules-core-k8s-fix-{}-{label}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("корінь створюється");
        root
    }

    /// Порушення без файла, без `data.kind` або з незнайомою родиною не дають
    /// правок — і жодне з них не є помилкою.
    #[test]
    fn unusable_violations_produce_an_empty_plan() {
        let root = temp_root("empty");
        let plan = k8s_manifests_fix(
            &root,
            &[
                violation(None, Some("svc-clusterip-type")),
                violation(Some("k8s/base/svc.yaml"), None),
                violation(Some("k8s/base/svc.yaml"), Some("hasura-configmap-env")),
            ],
        );
        assert!(plan.edits.is_empty());
    }

    /// Відсутній на диску файл просто пропускається — план лишається
    /// застосовним.
    #[test]
    fn missing_file_is_skipped() {
        let root = temp_root("missing");
        let plan = k8s_manifests_fix(
            &root,
            &[violation(
                Some("k8s/base/svc.yaml"),
                Some("svc-clusterip-type"),
            )],
        );
        assert!(plan.edits.is_empty());
    }

    /// Кілька порушень тієї самої родини в одному файлі — ОДНА правка.
    #[test]
    fn duplicate_violations_collapse_into_one_edit() {
        let root = temp_root("dedup");
        std::fs::create_dir_all(root.join("k8s/base")).expect("тека");
        std::fs::write(
            root.join("k8s/base/svc.yaml"),
            "kind: Service\nspec:\n  ports: []\n",
        )
        .expect("запис");
        let plan = k8s_manifests_fix(
            &root,
            &[
                violation(Some("k8s/base/svc.yaml"), Some("svc-clusterip-type")),
                violation(Some("k8s/base/svc.yaml"), Some("svc-clusterip-type")),
            ],
        );
        assert_eq!(plan.edits.len(), 1);
    }

    /// Дві РІЗНІ родини в одному файлі складаються, а не затирають одна одну:
    /// друга правка мусить бачити результат першої.
    #[test]
    fn two_families_in_one_file_compose() {
        let root = temp_root("compose");
        std::fs::create_dir_all(root.join("k8s/base")).expect("тека");
        std::fs::write(
            root.join("k8s/base/svc.yaml"),
            "kind: Service\nspec:\n  ports: []\n# yaml-language-server: $schema=https://x/y.json\n",
        )
        .expect("запис");
        let plan = k8s_manifests_fix(
            &root,
            &[
                violation(Some("k8s/base/svc.yaml"), Some("svc-clusterip-type")),
                violation(Some("k8s/base/svc.yaml"), Some("schema-modeline-first")),
            ],
        );
        let FileEdit::Write(last) = plan.edits.last().expect("є правки") else {
            panic!("очікувався запис");
        };
        assert!(
            last.content.starts_with("# yaml-language-server:"),
            "модлайн мав переїхати вгору: {:?}",
            last.content
        );
        assert!(
            last.content.contains("  type: ClusterIP"),
            "перша правка мала вціліти: {:?}",
            last.content
        );
    }

    /// Ідемпотентність: уже канонічний файл не дає правки взагалі.
    #[test]
    fn canonical_file_produces_no_edit() {
        let root = temp_root("idempotent");
        std::fs::create_dir_all(root.join("k8s/base")).expect("тека");
        std::fs::write(
            root.join("k8s/base/svc.yaml"),
            "kind: Service\nspec:\n  type: ClusterIP\n",
        )
        .expect("запис");
        let plan = k8s_manifests_fix(
            &root,
            &[violation(
                Some("k8s/base/svc.yaml"),
                Some("svc-clusterip-type"),
            )],
        );
        assert!(plan.edits.is_empty());
    }

    /// Порядок правок — за шляхом, а не за порядком порушень: план іде в
    /// JSON, і нестабільний порядок робив би diff шумним.
    #[test]
    fn edits_are_ordered_by_path() {
        let root = temp_root("order");
        std::fs::create_dir_all(root.join("k8s/base")).expect("тека");
        for name in ["b.yaml", "a.yaml"] {
            std::fs::write(
                root.join("k8s/base").join(name),
                "kind: Service\nspec:\n  ports: []\n",
            )
            .expect("запис");
        }
        let plan = k8s_manifests_fix(
            &root,
            &[
                violation(Some("k8s/base/b.yaml"), Some("svc-clusterip-type")),
                violation(Some("k8s/base/a.yaml"), Some("svc-clusterip-type")),
            ],
        );
        let paths: Vec<&str> = plan
            .edits
            .iter()
            .map(|edit| {
                let FileEdit::Write(write) = edit else {
                    panic!("очікувався запис");
                };
                write.path.as_str()
            })
            .collect();
        assert_eq!(paths, ["k8s/base/a.yaml", "k8s/base/b.yaml"]);
    }

    /// `networkpolicy-egress` без кореня пакета правил — no-op, а не
    /// вигаданий канон: джерело egress мусить бути тим самим сніпетом, який
    /// темплейтить перевірку.
    #[test]
    fn egress_without_the_rules_package_is_a_no_op() {
        let root = temp_root("no-package");
        std::fs::create_dir_all(root.join("k8s/base")).expect("тека");
        std::fs::write(
            root.join("k8s/base/np.yaml"),
            "kind: NetworkPolicy\nspec:\n  podSelector: {}\n",
        )
        .expect("запис");
        let plan = k8s_manifests_fix(
            &root,
            &[violation(
                Some("k8s/base/np.yaml"),
                Some("networkpolicy-egress"),
            )],
        );
        assert!(plan.edits.is_empty());
    }

    /// Невідомий workload-kind — no-op на ВЕСЬ файл, як `throw` у JS.
    #[test]
    fn unknown_workload_kind_stops_the_whole_file() {
        let rules_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../npm/rules");
        let content = concat!(
            "kind: NetworkPolicy\nspec:\n  podSelector: {}\n",
            "---\n",
            "kind: NetworkPolicy\nmetadata:\n  annotations:\n",
            "    nitra.dev/workload-kind: Unknown\nspec:\n  podSelector: {}\n"
        );
        assert_eq!(
            ensure_network_policy_egress(content, &rules_root),
            None,
            "перший документ полагодився б, але другий зупиняє весь файл"
        );
    }

    /// Перестановка возить коментар РАЗОМ із його записом — саме те, чого
    /// не робить JS-канон.
    #[test]
    fn sorting_moves_comments_with_their_entry() {
        let sorted = sort_kustomization_patches(concat!(
            "patches:\n",
            "  # сервіс\n  - target:\n      kind: Service\n      name: b\n",
            "  # деплоймент\n  - target:\n      kind: Deployment\n      name: a\n"
        ))
        .expect("порядок міняється");
        assert_eq!(
            sorted,
            concat!(
                "patches:\n",
                "  # деплоймент\n  - target:\n      kind: Deployment\n      name: a\n",
                "  # сервіс\n  - target:\n      kind: Service\n      name: b\n"
            )
        );
    }

    /// Розмітка, яка не збіглася з розібраним документом, — no-op: краще
    /// нічого, ніж переставити не те.
    #[test]
    fn sorting_bails_out_when_layout_does_not_match() {
        // Потік-послідовність: розібраних елементів два, рядків-елементів
        // жодного.
        assert_eq!(
            sort_kustomization_patches("patches: [{ path: b.yaml }, { path: a.yaml }]\n"),
            None
        );
    }

    /// Зламаний YAML — no-op на весь файл, а не часткова правка.
    #[test]
    fn unparseable_yaml_is_left_alone() {
        assert_eq!(
            ensure_svc_cluster_ip_type("kind: Service\nspec:\n  - [\n"),
            None
        );
    }
}
