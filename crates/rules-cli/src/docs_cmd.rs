//! Native-контур `n-rules docs` поверх `crates/rules-docs` — крок 2 плану
//! `docs/specs/2026-08-31-full-rust-migration-plan.md`: 14 410 рядків
//! Rust, які на момент розвідки (`docs/specs/2026-08-31-recon-providers-
//! rules-skills.md:290-330`) не мав жодного споживача — крейт у воркспейсі,
//! а `n-rules docs` ішла в JS (`npm/rules/doc-files/package_knowledge/
//! cli.mjs`).
//!
//! # Що саме нативне, а що ні — і чому
//!
//! JS-CLI (`cli.mjs`) має пʼять підкоманд, і вони НЕ рівноцінні за складом:
//!
//! - `domains`, `index`, `slice`, `validate` — read-only, детерміновані,
//!   БЕЗ ЛЛМ: читають/резолвлять уже ЗАКОМІЧЕНИЙ `docs/.docgen/
//!   manifest.json` і схему. Увесь потрібний код у `rules-docs` уже є
//!   ([`rules_docs::resolve_documentation_domains`],
//!   [`rules_docs::read_previous_manifest`], [`rules_docs::validate_schema`],
//!   [`rules_docs::create_impact_slice`]) — це і є підмножина, підключена
//!   тут, за `--native-docs`;
//! - `build` — оркестратор чотирьох LLM-стадій
//!   ([`rules_docs::build_package_knowledge`]) ПЛЮС мовні екстрактори.
//!   Останні — за власною заявою `rules-docs/src/lib.rs:30-33` — приходять
//!   ззовні як [`rules_docs::KnowledgeExtractor`], а в JS їх матеріалізує
//!   слот-шина (`load-adapters.mjs`), якої в WIT-контракті бінаря НЕМА
//!   (той самий висновок, що для `coverage.provider` — розвідка
//!   §«Що з цього випливає для планування» п. 1). Підключати `build`
//!   native-шляхом зараз означало б мовчки віддати граф БЕЗ мовних
//!   фрагментів — тихий пропуск, який CLAUDE.md проєкту прямо забороняє.
//!   Тому `build` лишається JS-поверхнею УСІМА шляхами, і `--native-docs`
//!   на ній — явна відмова з поясненням, не спроба.
//!
//! # Крок 3 плану: `--native-docs` — дефолт для read-only підкоманд
//!
//! `domains`/`index`/`slice`/`validate` тепер ідуть native-шляхом БЕЗ
//! прапорця — той самий патерн переходу, що `--native-fix`
//! ([`crate::fix_cmd`]) отримав на кроці 3 плану `full-rust-migration`:
//! прапорець `--native-docs` лишається як явний форсер (сумісність зі
//! скриптами, які його вже ставлять), а новий `--no-native-docs` —
//! аварійний люк назад у JS-CLI. `build` — ОКРЕМИЙ випадок і завжди йде в
//! JS: LLM-стадії й мовні екстрактори чекають на slot-канал, якого в
//! WIT-контракті ще нема (нижче).
//!
//! # Розбір argv
//!
//! Ручний (як [`crate::cli::SkillArgs`]), не `clap`-підкоманди: JS-CLI сама
//! розбирає свої флаги через `flagValue` (перше входження, без `=`-форми),
//! і дублювати це в `clap` дало б ДРУГИЙ контракт над тим самим argv.
//! [`flag_value`] тут — той самий алгоритм.
//!
//! # Доведений паритет
//!
//! Раніше (до кроку 3) `domains` була звірена вручну на цьому репозиторії
//! (29 доменів, 0 діагностик), а `index`/`slice`/`validate` — лише читанням
//! коду (дзеркальна побудова JSON з `cli.mjs`), без прогону на реальних
//! даних: жодного закомiченого `docs/.docgen/manifest.json` у цьому
//! репозиторії немає. Перемикання дефолту зробило це недостатнім доказом —
//! перш ніж міняти дефолт, паритет усіх чотирьох команд заведено в
//! byte-exact vitest-гейт `npm/scripts/lib/tests/rules-cli-parity.test.mjs`
//! (`describe('rules-cli parity: docs …')`), який ганяє native-бінар і
//! JS-CLI на ІДЕНТИЧНИХ синтетичних фікстурах (успішний манiфест,
//! відсутній манiфест, невідома тема, відсутній `--topic`, alias-резолв,
//! private-symbol leak) і звіряє stdout/stderr/exit-код byte-у-byte. Гейт
//! зелений — розбіжностей не знайдено.

use std::collections::HashSet;
use std::path::PathBuf;
use std::process::ExitCode;

// `rules_docs::Domain` (реекспорт кореня) — це ІНШИЙ тип (вузол графа,
// `graph::Domain`, з `sourceFingerprint`), не домен резолвера файлової
// системи. Той, що потрібен тут (`root`/`sourceRoots`/…), лишається лише за
// повним шляхом `rules_docs::domains::Domain` — крейт його не реекспортує.
use rules_docs::domains::{Diagnostic as DomainDiagnostic, Domain};
use rules_docs::{
    create_impact_slice, read_previous_manifest, resolve_documentation_domains, validate_schema,
    Topic,
};
use serde_json::{json, Map, Value};

use crate::cli::DocsArgs;
use crate::js_fallback;

/// Прапорець вмикання native-шляху — явний форсер, сумісний із попереднім
/// кроком (коли він був ОБОВʼЯЗКОВИЙ). Після кроку 3 не потрібен для
/// `domains`/`index`/`slice`/`validate` — вони native за замовчуванням.
const NATIVE_FLAG: &str = "--native-docs";

/// Аварійний люк назад у JS-CLI для read-only підкоманд — той самий патерн,
/// що `--no-native-fix` у [`crate::fix_cmd`]. `build` цей прапорець не читає:
/// вона й так завжди JS, окрім явного `--native-docs`, де це жорстка відмова.
const NO_NATIVE_FLAG: &str = "--no-native-docs";

/// Точка входу підкоманди. `args` — ПОВНИЙ argv (з `docs` як `args[0]`), для
/// делегації як є.
pub fn run(parsed: &DocsArgs, args: &[String]) -> ExitCode {
    let Some(subcommand) = parsed.rest.first().map(String::as_str) else {
        // Гола `docs` — той самий usage, що й досі, JS-поверхня.
        return delegate(args);
    };
    let forced = parsed.rest.iter().any(|a| a == NATIVE_FLAG);
    let disabled = parsed.rest.iter().any(|a| a == NO_NATIVE_FLAG);

    match subcommand {
        // `build` НІКОЛИ не йде native-шляхом — навіть за прапорцем: без
        // мовних екстракторів (slot-каналу нема) результат був би графом
        // без фрагментів, тобто мовчазний пропуск, а не паритет.
        "build" if forced => {
            eprintln!(
                "❌ n-rules docs build: {NATIVE_FLAG} не підтримується — LLM-стадії й мовні \
                 екстрактори чекають на slot-канал, якого в WIT-контракті ще нема \
                 (docs/specs/2026-08-31-recon-providers-rules-skills.md). Прибери прапорець: \
                 команда лишається JS-поверхнею."
            );
            ExitCode::FAILURE
        }
        // Крок 3: дефолт — native; `--no-native-docs` — явний відкат у JS.
        "domains" if !disabled => run_domains(),
        "index" if !disabled => run_index(&parsed.rest),
        "slice" if !disabled => run_slice(&parsed.rest),
        "validate" if !disabled => run_validate(&parsed.rest),
        // `--no-native-docs` (read-only підкоманди), `build` без форсу, чи
        // невідома підкоманда — та сама делегація, що й до цього кроку.
        _ => delegate(args),
    }
}

/// Делегація з відрізаними власними прапорцями — JS-CLI про `--native-docs`/
/// `--no-native-docs` не знає (у `build` вона впала б на
/// `unknown-build-option`, бо той валідує argv проти allow-list).
fn delegate(args: &[String]) -> ExitCode {
    let filtered: Vec<String> = args
        .iter()
        .filter(|a| a.as_str() != NATIVE_FLAG && a.as_str() != NO_NATIVE_FLAG)
        .cloned()
        .collect();
    js_fallback::delegate(&filtered)
}

/// `args.indexOf(name)`-семантика JS `flagValue`: ПЕРШЕ входження, значення
/// не може саме починатись з `--`.
fn flag_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    let index = args.iter().position(|a| a == name)?;
    let value = args.get(index + 1)?;
    (!value.starts_with("--")).then(|| value.as_str())
}

fn print_json(value: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).unwrap_or_default()
    );
}

fn print_json_err(value: &Value) {
    eprintln!(
        "{}",
        serde_json::to_string_pretty(value).unwrap_or_default()
    );
}

/// Портативний опис домену без runtime-шляхів — порт `publicDomain`.
fn public_domain(domain: &Domain) -> Value {
    json!({
        "id": domain.id,
        "ecosystem": domain.ecosystem,
        "name": domain.name,
        "rootManifest": domain.root_manifest,
        "sourceRoots": domain.source_roots,
        "excludedSourceRoots": domain.excluded_source_roots,
    })
}

/// JSON-проєкція блокувальної діагностики резолвера доменів. Ключі присутні
/// умовно — так само, як у JS (`domainId`/`manifests` лише в
/// `duplicate-domain-id`).
fn domain_diagnostic_json(diagnostic: &DomainDiagnostic) -> Value {
    let mut map = Map::new();
    map.insert("severity".to_string(), json!(diagnostic.severity));
    map.insert("code".to_string(), json!(diagnostic.code));
    map.insert("manifest".to_string(), json!(diagnostic.manifest));
    if let Some(domain_id) = &diagnostic.domain_id {
        map.insert("domainId".to_string(), json!(domain_id));
    }
    if let Some(manifests) = &diagnostic.manifests {
        map.insert("manifests".to_string(), json!(manifests));
    }
    map.insert("message".to_string(), json!(diagnostic.message));
    Value::Object(map)
}

fn current_dir() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// `n-rules docs domains --native-docs` — порт гілки `command === 'domains'`.
fn run_domains() -> ExitCode {
    match resolve_documentation_domains(&current_dir()) {
        Ok(resolved) => {
            let ok = resolved.diagnostics.is_empty();
            print_json(&json!({
                "domains": resolved.domains.iter().map(public_domain).collect::<Vec<_>>(),
                "diagnostics": resolved.diagnostics.iter().map(domain_diagnostic_json).collect::<Vec<_>>(),
            }));
            if ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Err(error) => {
            print_json_err(&json!({
                "ok": false,
                "code": "domain-resolution-io-error",
                "message": error.to_string(),
            }));
            ExitCode::FAILURE
        }
    }
}

/// Резолвить `--domain <id>` до конкретного [`Domain`] — порт
/// `resolveRequestedDomain`.
fn resolve_requested_domain(domain_id: Option<&str>) -> Result<Domain, Value> {
    let resolved = resolve_documentation_domains(&current_dir()).map_err(|error| {
        json!({
            "ok": false,
            "code": "domain-resolution-io-error",
            "message": error.to_string(),
        })
    })?;
    if !resolved.diagnostics.is_empty() {
        return Err(json!({
            "ok": false,
            "code": "domain-resolution-blocked",
            "message": "Package knowledge domain resolution має blocking diagnostics.",
            "diagnostics": resolved.diagnostics.iter().map(domain_diagnostic_json).collect::<Vec<_>>(),
        }));
    }
    let Some(domain_id) = domain_id else {
        return Err(json!({
            "ok": false,
            "code": "domain-required",
            "message": "Потрібен --domain <id>.",
        }));
    };
    match resolved
        .domains
        .iter()
        .find(|domain| domain.id == domain_id)
    {
        Some(domain) => Ok(domain.clone()),
        // Поле зветься `diagnostics`, хоча тут перелік доменів — так само
        // дивно, як у JS-оригіналі (`cli.mjs`); не виправляю мовчки те, що
        // не моя поверхня цього кроку.
        None => Err(json!({
            "ok": false,
            "code": "domain-not-found",
            "message": format!("Domain \"{domain_id}\" не знайдено."),
            "diagnostics": resolved.domains.iter().map(public_domain).collect::<Vec<_>>(),
        })),
    }
}

/// Читає закомічений `docs/.docgen/manifest.json` — порт `readManifest`.
///
/// # Відома розбіжність (не форсована, задокументована)
///
/// Текст ENOENT-повідомлення НЕ byte-exact із Node (`error.message` у Rust
/// не несе Node-специфічний суфікс `, open '<шлях>'`) — рантайми форматують
/// `io::Error`/`fs.Error` по-різному, і відтворювати чужий формат рядком
/// означало б крихку залежність від конкретної версії Node. `code`/`ok`
/// лишаються тим самим контрактом, тексту — ні.
fn read_manifest(domain: &Domain) -> Result<Value, Value> {
    let manifest_path = domain.root.join("docs/.docgen/manifest.json");
    match read_previous_manifest(&domain.root) {
        Ok(Some(manifest)) => Ok(manifest),
        Ok(None) => Err(json!({
            "ok": false,
            "code": "manifest-unavailable",
            "message": format!(
                "Не вдалося прочитати package knowledge manifest {}: ENOENT: no such file or directory",
                manifest_path.display()
            ),
        })),
        Err(diagnostics) => Err(json!({
            "ok": false,
            "code": "manifest-unavailable",
            "message": format!(
                "Не вдалося прочитати package knowledge manifest {}: {diagnostics:?}",
                manifest_path.display()
            ),
        })),
    }
}

/// Схема + identity домену — порт `validateManifest` (НЕ повний
/// `validate_knowledge_graph`: CLI-читання не кличе семантичні гейти
/// посилань/coverage/privacy, і JS-двійник теж їх тут не кличе).
fn validate_manifest(manifest: &Value, domain: &Domain) -> Result<(), Value> {
    let report = validate_schema(manifest);
    if !report.ok {
        return Err(json!({
            "ok": false,
            "code": "manifest-schema-invalid",
            "message": "Manifest не відповідає knowledge graph schema v1.",
            "errors": report
                .diagnostics
                .iter()
                .map(|d| json!({ "code": d.code, "message": d.message }))
                .collect::<Vec<_>>(),
        }));
    }
    let manifest_domain_id = manifest
        .get("domain")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if manifest_domain_id != domain.id {
        return Err(json!({
            "ok": false,
            "code": "manifest-domain-mismatch",
            "message": format!(
                "Manifest належить {manifest_domain_id}, але requested domain має identity {}.",
                domain.id
            ),
        }));
    }
    Ok(())
}

/// Резолв домену + читання + валідація маніфеста — спільний пролог
/// `index`/`slice`/`validate`.
fn load_validated_manifest(rest: &[String]) -> Result<(Domain, Value), ExitCode> {
    let domain = resolve_requested_domain(flag_value(rest, "--domain")).map_err(|error| {
        print_json_err(&error);
        ExitCode::FAILURE
    })?;
    let manifest = read_manifest(&domain).map_err(|error| {
        print_json_err(&error);
        ExitCode::FAILURE
    })?;
    validate_manifest(&manifest, &domain).map_err(|error| {
        print_json_err(&error);
        ExitCode::FAILURE
    })?;
    Ok((domain, manifest))
}

fn run_validate(rest: &[String]) -> ExitCode {
    let (domain, _manifest) = match load_validated_manifest(rest) {
        Ok(pair) => pair,
        Err(code) => return code,
    };
    print_json(&json!({
        "ok": true,
        "domainId": domain.id,
        "manifest": domain.root.join("docs/.docgen/manifest.json").display().to_string(),
    }));
    ExitCode::SUCCESS
}

fn str_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn str_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Компактний topic-індекс — порт `createIndex`.
fn create_index(manifest: &Value) -> Value {
    let empty: Vec<Value> = Vec::new();
    let gaps = manifest
        .get("gaps")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let gaps_by_status: Map<String, Value> = ["satisfied", "missing", "diverged", "unresolved"]
        .iter()
        .map(|status| {
            let count = gaps
                .iter()
                .filter(|gap| gap.get("status").and_then(Value::as_str) == Some(*status))
                .count();
            ((*status).to_string(), json!(count))
        })
        .collect();
    let topics = manifest
        .get("topics")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let topics_json: Vec<Value> = topics
        .iter()
        .map(|topic| {
            json!({
                "id": str_field(topic, "id"),
                "kind": str_field(topic, "kind"),
                "title": str_field(topic, "title"),
                "aliases": str_array(topic, "aliases"),
            })
        })
        .collect();
    json!({
        "schemaVersion": manifest.get("schemaVersion").cloned().unwrap_or(Value::Null),
        "domain": manifest.get("domain").cloned().unwrap_or(Value::Null),
        "topics": topics_json,
        "gapsByStatus": gaps_by_status,
    })
}

fn run_index(rest: &[String]) -> ExitCode {
    let (_domain, manifest) = match load_validated_manifest(rest) {
        Ok(pair) => pair,
        Err(code) => return code,
    };
    print_json(&create_index(&manifest));
    ExitCode::SUCCESS
}

/// Топіки маніфеста, приведені до [`Topic`] — той самий парсинг, що
/// `render.rs` уже робить над manifest-подібним графом (не публічний там,
/// тож повторено тут для CLI-шару).
fn manifest_topics(manifest: &Value) -> Vec<Topic> {
    let empty: Vec<Value> = Vec::new();
    manifest
        .get("topics")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .map(|item| Topic {
            id: str_field(item, "id"),
            kind: str_field(item, "kind"),
            title: str_field(item, "title"),
            domain_id: str_field(item, "domainId"),
            anchor_ids: str_array(item, "anchorIds"),
            aliases: str_array(item, "aliases"),
        })
        .collect()
}

/// Self-contained topic slice — порт `createSlice`.
fn create_slice(manifest: &Value, topic_id: &str) -> Result<Value, Value> {
    let empty: Vec<Value> = Vec::new();
    let topics_raw = manifest
        .get("topics")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let Some(topic_raw) = topics_raw.iter().find(|topic| {
        topic.get("id").and_then(Value::as_str) == Some(topic_id)
            || topic
                .get("aliases")
                .and_then(Value::as_array)
                .is_some_and(|aliases| aliases.iter().any(|alias| alias.as_str() == Some(topic_id)))
    }) else {
        return Err(json!({
            "ok": false,
            "code": "topic-not-found",
            "message": format!("Topic \"{topic_id}\" не знайдено."),
        }));
    };
    let resolved_topic_id = str_field(topic_raw, "id");

    let topics = manifest_topics(manifest);
    let impact = create_impact_slice(manifest, &topics, &resolved_topic_id).map_err(
        |failure| json!({ "ok": false, "code": failure.code, "message": failure.detail }),
    )?;

    let anchor_ids: HashSet<String> = str_array(topic_raw, "anchorIds").into_iter().collect();
    let claims: Vec<Value> = manifest
        .get("claims")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|claim| {
            claim
                .get("subjectId")
                .and_then(Value::as_str)
                .is_some_and(|subject| anchor_ids.contains(subject))
        })
        .cloned()
        .collect();
    let claim_ids: HashSet<String> = claims
        .iter()
        .filter_map(|claim| claim.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .collect();
    let gaps: Vec<Value> = manifest
        .get("gaps")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|gap| {
            let expected = gap
                .get("expectedClaimId")
                .and_then(Value::as_str)
                .is_some_and(|id| claim_ids.contains(id));
            let implemented = gap
                .get("implementedClaimIds")
                .and_then(Value::as_array)
                .is_some_and(|ids| {
                    ids.iter()
                        .filter_map(Value::as_str)
                        .any(|id| claim_ids.contains(id))
                });
            expected || implemented
        })
        .cloned()
        .collect();

    let mut evidence_ids: HashSet<String> = HashSet::new();
    for claim in &claims {
        evidence_ids.extend(str_array(claim, "evidenceIds"));
    }
    for gap in &gaps {
        evidence_ids.extend(str_array(gap, "evidenceIds"));
    }
    let evidence: Vec<Value> = manifest
        .get("evidence")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|item| {
            item.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| evidence_ids.contains(id))
        })
        .map(|item| {
            let mut object = item.as_object().cloned().unwrap_or_default();
            // `shift_remove`, НЕ `remove`: за фічею `preserve_order` (яку
            // вмикає `rules-template-merge`, §2.87, і яка через
            // feature-уніфікацію Cargo діє на ввесь воркспейс) `Map::remove`
            // — це `swap_remove`, що ламає порядок ключів (останній ключ
            // мапи займає місце видаленого). Parity-гейт
            // (`rules-cli-parity.test.mjs`, `slice (alias-резолв)`) це
            // зловив: native і JS-деструктуризація (`{ symbolId, ...item }`)
            // мають лишати РЕШТУ ключів у вихідному порядку.
            object.shift_remove("symbolId");
            Value::Object(object)
        })
        .collect();

    let nodes: Vec<Value> = manifest
        .get("nodes")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|node| {
            let anchored = node
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| anchor_ids.contains(id));
            let not_private = node.get("visibility").and_then(Value::as_str) != Some("private");
            anchored && not_private
        })
        .cloned()
        .collect();

    let impact_json = json!({
        "files": impact.files,
        "tests": impact.tests,
        "contracts": impact
            .contracts
            .iter()
            .map(|contract| json!({ "id": contract.id, "name": contract.name }))
            .collect::<Vec<_>>(),
        "configs": impact.configs,
    });

    Ok(json!({
        "schemaVersion": manifest.get("schemaVersion").cloned().unwrap_or(Value::Null),
        "domain": manifest.get("domain").cloned().unwrap_or(Value::Null),
        "topic": topic_raw,
        "nodes": nodes,
        "claims": claims,
        "gaps": gaps,
        "evidence": evidence,
        "impact": impact_json,
    }))
}

fn run_slice(rest: &[String]) -> ExitCode {
    let (_domain, manifest) = match load_validated_manifest(rest) {
        Ok(pair) => pair,
        Err(code) => return code,
    };
    let Some(topic_id) = flag_value(rest, "--topic") else {
        // БЕЗ `"ok"` — JS (`cli.mjs:280`) теж його тут не пише; на відміну
        // від інших відмов цього файлу, це не структурована `{ ok, code,
        // message }`-форма. Parity-гейт зловив зайве поле, коли додав його
        // порт «про всяк випадок».
        print_json_err(&json!({
            "code": "topic-required",
            "message": "Потрібен --topic <id>.",
        }));
        return ExitCode::FAILURE;
    };
    match create_slice(&manifest, topic_id) {
        Ok(slice) => {
            print_json(&slice);
            ExitCode::SUCCESS
        }
        Err(error) => {
            print_json_err(&error);
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOMAIN: &str = "npm:@fixture/orders";
    const SUBMIT: &str = "code-unit:npm:@fixture/orders:js:src/orders.mjs#submitOrder";
    const PRIVATE: &str = "code-unit:npm:@fixture/orders:js:src/orders.mjs#persistOrder";

    /// Мінімальний манiфест — БЕЗ схемної валідації (тестуються лише
    /// [`create_index`]/[`create_slice`], які на схему не зважають; реальні
    /// дані для end-to-end паритету в цьому репозиторії відсутні — жоден
    /// `docs/.docgen/manifest.json` тут ще не публікувався, доккомент
    /// модуля).
    fn manifest() -> Value {
        json!({
            "schemaVersion": "1",
            "domain": {"id": DOMAIN},
            "nodes": [
                {"id": SUBMIT, "kind": "code-unit", "name": "submitOrder", "visibility": "public",
                 "domainId": DOMAIN, "attributes": {"sourcePath": "src/orders.mjs"}},
                {"id": PRIVATE, "kind": "code-unit", "name": "persistOrder", "visibility": "private",
                 "domainId": DOMAIN, "attributes": {"sourcePath": "src/persistence.mjs"}}
            ],
            "edges": [
                {"id": "edge:submit-private", "fromId": SUBMIT, "toId": PRIVATE, "evidenceIds": ["e:code"]}
            ],
            "claims": [
                {"id": "claim:1", "subjectId": SUBMIT, "evidenceIds": ["e:code"]}
            ],
            "topics": [
                {"id": "topic:orders", "kind": "process", "title": "Orders", "domainId": DOMAIN,
                 "anchorIds": [SUBMIT], "aliases": ["orders-alias"]}
            ],
            "gaps": [
                {"id": "gap:1", "status": "satisfied", "expectedClaimId": "claim:1",
                 "implementedClaimIds": ["claim:1"], "evidenceIds": []},
                {"id": "gap:2", "status": "missing", "expectedClaimId": "claim:missing",
                 "implementedClaimIds": [], "evidenceIds": []}
            ],
            "evidence": [
                {"id": "e:code", "kind": "code", "path": "src/orders.mjs", "symbolId": SUBMIT}
            ]
        })
    }

    /// `createIndex` — topics compact projection + gapsByStatus.
    #[test]
    fn index_counts_gaps_by_status_and_projects_topics() {
        let index = create_index(&manifest());
        assert_eq!(index["gapsByStatus"]["satisfied"], json!(1));
        assert_eq!(index["gapsByStatus"]["missing"], json!(1));
        assert_eq!(index["gapsByStatus"]["diverged"], json!(0));
        assert_eq!(index["gapsByStatus"]["unresolved"], json!(0));
        assert_eq!(
            index["topics"],
            json!([{"id": "topic:orders", "kind": "process", "title": "Orders", "aliases": ["orders-alias"]}])
        );
    }

    /// `createSlice` — resolve за id ЧИ alias, claims/gaps/evidence звужені
    /// до anchorIds теми, private-вузли поза anchorIds не потрапляють.
    #[test]
    fn slice_resolves_by_alias_and_scopes_claims_gaps_evidence() {
        let slice = create_slice(&manifest(), "orders-alias").expect("known alias");
        assert_eq!(slice["topic"]["id"], json!("topic:orders"));
        assert_eq!(
            slice["claims"],
            json!([{"id": "claim:1", "subjectId": SUBMIT, "evidenceIds": ["e:code"]}])
        );
        assert_eq!(slice["gaps"].as_array().unwrap().len(), 1);
        assert_eq!(slice["gaps"][0]["id"], json!("gap:1"));
        // Evidence без `symbolId` — CLI не повертає private symbol linkage.
        assert_eq!(
            slice["evidence"],
            json!([{"id": "e:code", "kind": "code", "path": "src/orders.mjs"}])
        );
        // SUBMIT — anchor і public, лишається; PRIVATE поза anchorIds теми.
        let node_ids: Vec<&str> = slice["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| node["id"].as_str().unwrap())
            .collect();
        assert_eq!(node_ids, vec![SUBMIT]);
    }

    /// Невідома тема — структурована відмова, `ok:false`.
    #[test]
    fn slice_reports_topic_not_found() {
        let error = create_slice(&manifest(), "no-such-topic").unwrap_err();
        assert_eq!(error["code"], json!("topic-not-found"));
        assert_eq!(error["ok"], json!(false));
    }

    /// `flagValue` — перше входження, значення не може саме бути прапорцем.
    #[test]
    fn flag_value_takes_first_occurrence_and_rejects_dashed_value() {
        let args = vec![
            "--domain".to_string(),
            "a".to_string(),
            "--domain".to_string(),
            "b".to_string(),
        ];
        assert_eq!(flag_value(&args, "--domain"), Some("a"));
        let dangling = vec!["--domain".to_string(), "--topic".to_string()];
        assert_eq!(flag_value(&dangling, "--domain"), None);
    }
}
