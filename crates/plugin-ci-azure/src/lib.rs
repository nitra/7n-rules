//! wasm-компонент `n-rules:plugin@3.2.0` — `ci-azure/wasm-concerns`, ШОСТИЙ
//! first-party wasm-гість репозиторію (перший — `crates/plugin-lang-js`,
//! другий — `crates/plugin-lang-python`, третій — `crates/plugin-lang-rust`,
//! четвертий — `crates/plugin-lang-php`, п'ятий — `crates/plugin-ci-github`,
//! доккомент того `src/lib.rs` пояснює форму), створений за тим самим
//! флоу скіла `npm/skills/wasm-plugin/`. Плагін-джерело — `@7n/rules-ci-azure`
//! (`plugins/ci-azure/`), другий НЕ-lang first-party гість (перший —
//! `plugin-ci-github`).
//!
//! # Чому цей гість зʼявився щойно (реєстр §2.55/§2.66)
//!
//! До реєстру відкритих питань `docs/plans/2026-08-05-open-questions-register.md`
//! §2.55/§2.66 окремий гість для `ci-azure` вважався непропорційним: `regorus`
//! коштував ~1 МБ у КОЖНОМУ гості, і десять концернів платили б за нього
//! ВДРУГЕ при тодішній стелі 2,5 MiB. Обидві підстави зникли того самого дня
//! — §2.55 підняла стелю до 10 MiB, §2.66 винесла `regorus` із wasm-гостя на
//! хост (перший imported resource контракту, `rego-engine`). Цей крейт —
//! ПЕРШИЙ гість, створений ПІСЛЯ обох змін: на відміну від `plugin-ci-github`
//! (де стару пряму `regorus`-залежність довелось прибирати заднім числом),
//! тут rego-двигун дістається БЕЗКОШТОВНО через host-import із самого
//! початку — жодної прямої `regorus`-залежності в `wasm32-wasip2`
//! build graph НІКОЛИ не існувало (доккомент `Cargo.toml`).
//!
//! # ПЕРША хвиля: два з десяти концернів — доказ каркасу, не повний порт
//!
//! `plugins/ci-azure/rules/` несе десять концернів (девʼять `.rego`-політик +
//! `ci_artifact/consume_azure`). Ця хвиля бере ДВА, обраних як представники
//! ОБОХ форм, не два зручних однакових:
//!
//! - [`detect_lint_pipeline`] (`azure-pipelines/lint_pipeline`) — чистий
//!   rego-детект, БЕЗ T0-фіксатора (`concern.json` не декларує `fixability`):
//!   один обовʼязковий `azure-pipelines.yml`, substring-перевірка
//!   `n-rules lint`/`--no-fix` по сукупному тексту всіх `script`-кроків
//!   (`walk()`-обхід на будь-якій глибині — плоскі steps, jobs, stages).
//! - [`detect_vscode_extensions`]/[`fix_vscode_extensions`]
//!   (`azure-pipelines/vscode_extensions`) — rego-детект (subset-перевірка
//!   `recommendations`) + T0-фіксатор: ТОЙ САМИЙ спільний рушій
//!   `npm/scripts/lib/fix/vscode-ext-add.mjs`, що `ga/vscode_extensions` у
//!   `plugin-ci-github` (union `recommendations` за рядковим значенням, файл
//!   регенерується цілком — коментарі НЕ переживають фікс, той самий
//!   контракт, що канон, доккомент [`fix_vscode_extensions`]).
//!
//! Решта вісім концернів (`pipeline_common`, `service_deploy_pipeline`,
//! `docker/lint_pipeline_docker`, `k8s/lint_pipeline_k8s`,
//! `security/lint_pipeline_security`, `style/lint_pipeline_style`,
//! `text/lint_pipeline_text`, `ci_artifact/consume_azure`) — СВІДОМО поза
//! обсягом ТІЄЇ хвилі. Не чіпай їх у цьому крейті без нової задачі.
//! JS-канон УСІХ десяти лишається недоторканим — парність доводиться перед
//! видаленням JS, не одночасно з ним.
//!
//! # ДРУГА хвиля (§2.81): `azure-pipelines/service_deploy_pipeline`
//!
//! Третій концерн крейта — і ПЕРШИЙ walkGlob (набір
//! `.azurepipelines/**/*.yml` без `templates/**`, не один обовʼязковий
//! таргет). Портовано ЛИШЕ detect: T0-фікс потребує реєстру ввімкнених
//! правил, якого гість не має жодним каналом контракту — розгорнутий
//! доккомент нижче, розділ «ДРУГА хвиля». `ci_artifact/consume_azure`
//! лишається поза портом ПРИНЦИПОВО (host-side інтегратор слот-механізму,
//! §2.81), а не «до наступної хвилі».
//!
//! # `%q` — пастка, перевірена ДО порту
//!
//! `regorus` відхиляє Go-формат-верб `%q` (`sprintf`) як HARD RUNTIME ERROR,
//! не тихий деградейшн (уже двічі виловлено в `plugin-ci-github` в різних
//! теках, реєстр §2.66). Усі девʼять `.rego`-політик `plugins/ci-azure/rules/`
//! перевірені: РІВНО ОДНЕ входження `%q` у всьому плагіні
//! (`azure-pipelines/vscode_extensions/vscode_extensions.rego`) — замінено
//! на `\"%v\"` (доккомент того `.rego`-файлу: біт-у-біт той самий рядок під
//! `conftest`, `sprintf("%q", s)` для ASCII-рядка без спецсимволів — це рівно
//! `"` + s + `"`). Жоден з двох `.rego`-пакетів цієї хвилі не читає голий
//! `on:`-ключ (на відміну від `ga/workflows` у `plugin-ci-github`, де три
//! `gha_on := object.get(…)`-гілки лишились через YAML 1.1/1.2-розбіжність
//! conftest/regorus) — жодної правки цього класу тут не знадобилось.
//!
//! # Друга пастка: `walk()` — не в `.rego`, а у фітах `regorus`
//!
//! `azure-pipelines/lint_pipeline` кличе built-in `walk(input, [_, node])`
//! (обхід усього дерева pipeline на будь-якій глибині). Під пiновим фіт-
//! набором `rules-rego-engine` мав ДО цієї задачі (`regex`+`std`+`arc`,
//! успадковано від `plugin-ci-github`, де жоден з пʼяти вшитих `.rego` не
//! кличе `walk`) — той самий policy-текст ЕВАЛЮЮЄТЬСЯ з оманливою помилкою
//! `use of undefined variable 'node' is unsafe`, що виглядає як баг
//! Rego-безпеки, а насправді — відсутній builtin (`walk` живе у фіті
//! `"graph"`, частина `full-opa`-бандла, який `default-features = false`
//! свідомо не бере). Підтверджено мінімальним репро ПОЗА цим крейтом
//! (`crates/rules-rego-engine`): та сама policy падає на КОЖНІЙ формі
//! виклику `walk` без фіту (bound/unbound path, plain rule, set
//! comprehension), з фітом — працює БУКВАЛЬНО без жодної зміни
//! `.rego`-тексту. Фікс — доккомент `rules-rego-engine/Cargo.toml`
//! (додано `"graph"` до фіт-набору, чисто адитивно, безпечно для решти
//! споживачів того крейта).
//!
//! # YAML і JSON через ОДИН `saphyr`-парсер — свідомо без JSONC-крейта
//!
//! На відміну від `plugin-ci-github` (`jsonc-parser`, справжня підтримка
//! `//`/`/* */`-коментарів у `.vscode/*.json`) — ЦЕЙ крейт читає ОБИДВА
//! target-файли (`azure-pipelines.yml`, `.vscode/extensions.json`) через
//! `saphyr` (JSON — валідна підмножина YAML 1.2, [`parse_yaml_document`]
//! обслуговує обидва розширення тим самим кодом). Свідоме спрощення обсягу
//! цієї хвилі, не прихована регресія: [`fix_vscode_extensions`] — ПОВНА
//! регенерація файлу (доккомент функції) — той самий контракт, що канонічний
//! `vscode-ext-add.mjs` (`JSON.stringify`), тож JSONC-коментарі в
//! `.vscode/extensions.json` НЕ переживають фікс НАВІТЬ у каноні — жодного
//! comment-preserving шляху тут нема, який JSONC-парсер міг би зберегти.
//! Ціна: `.vscode/extensions.json` із `//`-коментарем читається як YAML,
//! не як JSONC — комент зливається з сусіднім ключем у сміттєвий рядковий
//! ключ (той самий канал, що `plugin-ci-github` мав ДО §2.5x-хвилі,
//! задокументований floor, не прихована втрата даних: жодне поле не
//! зникає мовчки, `deny`-повідомлення просто не бачить `recommendations`
//! і дає `policy-file-missing`-подібну діагностику).

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

// =====================================================================
// Мінімальне self-describing dynamic-значення YAML/JSON-документа — той
// самий тип і той самий `saphyr`-обхід, що `plugin-ci-github::Json`
// (доккомент того модуля, розділ «Мінімальне self-describing…»).
// =====================================================================

#[derive(Debug, Clone, PartialEq)]
enum Json {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Array(Vec<Json>),
    /// Порядок вставки збережено (як і `saphyr`'s `MappingOwned`) — не для
    /// коректності Rego, а для детермінованого JSON-тексту й pretty-виводу.
    Object(Vec<(String, Json)>),
}

impl Json {
    fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(items) => Some(items.as_slice()),
            _ => None,
        }
    }
}

fn yaml_owned_to_json(node: &saphyr::YamlOwned) -> Json {
    use saphyr::YamlOwned;
    match node {
        YamlOwned::Value(scalar) => scalar_owned_to_json(scalar),
        YamlOwned::Sequence(items) => Json::Array(items.iter().map(yaml_owned_to_json).collect()),
        YamlOwned::Mapping(map) => Json::Object(
            map.iter()
                .map(|(k, v)| (yaml_key_to_string(k), yaml_owned_to_json(v)))
                .collect(),
        ),
        _ => Json::Null,
    }
}

fn scalar_owned_to_json(scalar: &saphyr::ScalarOwned) -> Json {
    use saphyr::ScalarOwned;
    match scalar {
        ScalarOwned::Null => Json::Null,
        ScalarOwned::Boolean(b) => Json::Bool(*b),
        ScalarOwned::Integer(i) => Json::Int(*i),
        ScalarOwned::FloatingPoint(f) => Json::Float(f.into_inner()),
        ScalarOwned::String(s) => Json::Str(s.clone()),
    }
}

fn yaml_key_to_string(key: &saphyr::YamlOwned) -> String {
    key.as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("{key:?}"))
}

/// Точний відповідник `parseWorkflowYaml`-подібних функцій `plugin-ci-github`:
/// парсить цілий YAML/JSON-документ (JSON — валідний YAML 1.2, доккомент
/// модуля) і повертає `Some` лише коли корінь — обʼєкт; парс-помилка чи
/// не-обʼєктний корінь — `None`.
fn parse_yaml_document(content: &str) -> Option<Json> {
    use saphyr::{LoadableYamlNode, YamlOwned};
    let docs = YamlOwned::load_from_str(content).ok()?;
    let doc = docs.into_iter().next()?;
    match yaml_owned_to_json(&doc) {
        json @ Json::Object(_) => Some(json),
        _ => None,
    }
}

/// Парсить довільний вшитий шаблонний текст (YAML/JSON) у [`Json`]. Панікує
/// на помилці — вшиті template-файли є ЧАСТИНОЮ крейта (не user-вхід):
/// парс-помилка тут означала б зламаний `include_str!`-асет.
fn parse_embedded_template(source_name: &str, content: &str) -> Json {
    use saphyr::{LoadableYamlNode, YamlOwned};
    let docs = YamlOwned::load_from_str(content)
        .unwrap_or_else(|e| panic!("вшитий template {source_name} — валідний YAML/JSON: {e}"));
    let doc = docs
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("вшитий template {source_name} — непорожній"));
    yaml_owned_to_json(&doc)
}

fn json_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn write_json(value: &Json, out: &mut String) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Int(i) => out.push_str(&i.to_string()),
        Json::Float(f) => {
            if f.is_finite() {
                out.push_str(&f.to_string());
            } else {
                out.push('0');
            }
        }
        Json::Str(s) => out.push_str(&json_escape_string(s)),
        Json::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json(item, out);
            }
            out.push(']');
        }
        Json::Object(entries) => {
            out.push('{');
            for (i, (k, v)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&json_escape_string(k));
                out.push(':');
                write_json(v, out);
            }
            out.push('}');
        }
    }
}

/// Компактний JSON-текст — лише для regorus `input`/`data` (не для запису
/// на диск, доккомент [`json_to_pretty_string`]).
fn json_to_string(value: &Json) -> String {
    let mut out = String::new();
    write_json(value, &mut out);
    out
}

fn write_json_pretty(value: &Json, indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    let pad_in = "  ".repeat(indent + 1);
    match value {
        Json::Array(items) if items.is_empty() => out.push_str("[]"),
        Json::Array(items) => {
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                out.push_str(&pad_in);
                write_json_pretty(item, indent + 1, out);
                if i + 1 < items.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&pad);
            out.push(']');
        }
        Json::Object(entries) if entries.is_empty() => out.push_str("{}"),
        Json::Object(entries) => {
            out.push_str("{\n");
            for (i, (k, v)) in entries.iter().enumerate() {
                out.push_str(&pad_in);
                out.push_str(&json_escape_string(k));
                out.push_str(": ");
                write_json_pretty(v, indent + 1, out);
                if i + 1 < entries.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&pad);
            out.push('}');
        }
        scalar => write_json(scalar, out),
    }
}

/// Pretty JSON — точний відповідник `JSON.stringify(x, null, 2) + '\n'`
/// (`vscode-ext-add.mjs`). Лише для `.vscode/extensions.json`-запису
/// ([`fix_vscode_extensions`]) — на відміну від [`json_to_string`]
/// (компактний, лише для regorus `input`/`data`).
fn json_to_pretty_string(value: &Json) -> String {
    let mut out = String::new();
    write_json_pretty(value, 0, &mut out);
    out.push('\n');
    out
}

/// Обгортає розпарсений шаблонний снапшот у `{"template":{"snippet": …}}` —
/// точна JSON-форма, яку канон пише у `--data <tmpfile>` через
/// `runConftestBatch` (той самий контракт, що `plugin-ci-github::wrap_template_data`).
fn wrap_template_data(snippet: Json) -> String {
    json_to_string(&Json::Object(vec![(
        "template".to_string(),
        Json::Object(vec![("snippet".to_string(), snippet)]),
    )]))
}

fn batch_file<'a>(files: &'a [SourceFile], path: &str) -> Option<&'a SourceFile> {
    files.iter().find(|f| f.path == path)
}

// =====================================================================
// rego-двигун — той самий `RegoEngineHandle`-мотив, що `plugin-ci-github`
// (реєстр §2.66): wasm32 кличе host-import resource `rego-engine`, будь-який
// інший таргет (нативні `cargo test`) кличе `rules_rego_engine::RegoEngine`
// in-process. Точний перенос — доккомент `plugin-ci-github::RegoEngineHandle`
// пояснює обидва шляхи детально, тут — лише сама конструкція.
// =====================================================================

#[cfg(target_arch = "wasm32")]
type RegoEngineHandle = RegoEngine;
#[cfg(not(target_arch = "wasm32"))]
type RegoEngineHandle = rules_rego_engine::RegoEngine;

#[cfg(target_arch = "wasm32")]
fn rego_error_stage_message(err: RegoError) -> (&'static str, String) {
    let stage = match err.stage {
        RegoStage::Compile => "compile",
        RegoStage::Input => "set_input",
        RegoStage::Eval => "eval",
    };
    (stage, err.message)
}

#[cfg(not(target_arch = "wasm32"))]
fn rego_error_stage_message(err: rules_rego_engine::RegoError) -> (&'static str, String) {
    (err.stage.as_str(), err.message)
}

/// Один rego-виклик: новий [`RegoEngineHandle`], один `add_policy`, опційний
/// `add_data_json`, один `eval_rule` — точний відповідник ОДНОГО спавну
/// `conftest test <file> -p <policyDir> --namespace <namespace> [--data …]`
/// (той самий контракт, що `plugin-ci-github::eval_deny_rule`). `data_json`
/// — `None` для концернів без `data.template.*` (лише [`detect_lint_pipeline`]
/// цієї хвилі — `lint_pipeline.rego` читає ЛИШЕ `input`).
#[allow(unused_mut)] // wasm32: resource-хендл методи беруть `&self`, `mut` потрібен лише нативній гілці.
fn eval_deny_rule(
    rego_source: &str,
    namespace: &str,
    data_json: Option<&str>,
    input_json: &str,
) -> Result<Vec<String>, (&'static str, String)> {
    let mut engine = RegoEngineHandle::new();
    engine
        .add_policy(&format!("{namespace}.rego"), rego_source)
        .map_err(rego_error_stage_message)?;
    if let Some(data) = data_json {
        engine.add_data_json(data).map_err(rego_error_stage_message)?;
    }
    engine
        .eval_rule(input_json, &format!("data.{namespace}.deny"))
        .map_err(rego_error_stage_message)
}

const REGO_ENGINE_ERROR_REASON: &str = "rego-engine-error";

/// Видима діагностика про провал самого regorus-виклику (compile/set_input/
/// eval) — точний відповідник `plugin-ci-github::push_rego_engine_error`:
/// fail loud, НЕ мовчазний fail-open (живий rego верифікований
/// `conftest verify`-тестами, тож продакшн-шлях сюди не потрапляє сьогодні,
/// але регресія — апгрейд regorus у хості, зламаний вшитий `.rego` — має
/// дати видиму діагностику, не тишу).
fn push_rego_engine_error(
    diagnostics: &mut Vec<Diagnostic>,
    file: Option<&str>,
    namespace: &str,
    stage: &str,
    err: &str,
) {
    let location = file.unwrap_or("azure-pipelines");
    diagnostics.push(Diagnostic {
        reason: REGO_ENGINE_ERROR_REASON.to_string(),
        message: format!(
            "{location}: regorus-виклик policy-пакета {namespace} провалився на етапі \
             {stage}: {err} — це має бути структурно недосяжно (живий rego верифікований \
             conftest verify-тестами); якщо бачиш це в реальному прогоні, перевір недавні \
             зміни в .rego чи версію regorus"
        ),
        file: file.map(str::to_string),
        severity: Severity::Error,
        data: Some(format!(
            "{{\"kind\":\"rego-engine-error\",\"namespace\":\"{namespace}\",\"stage\":\"{stage}\"}}"
        )),
    });
}

// =====================================================================
// `azure-pipelines/lint_pipeline` — чистий rego-детект, БЕЗ фіксатора.
// =====================================================================

const CONCERN_LINT_PIPELINE: &str = "azure-pipelines/lint_pipeline";

const LINT_PIPELINE_TARGET: &str = "azure-pipelines.yml";
const LINT_PIPELINE_NAMESPACE: &str = "azure_pipelines.lint_pipeline";
const LINT_PIPELINE_MISSING_MESSAGE: &str =
    "azure-pipelines.yml не існує — створи за каноном azure-pipelines.mdc (обов'язковий lint-степ n-rules)";

const LINT_PIPELINE_REGO: &str =
    include_str!("../../../plugins/ci-azure/rules/azure-pipelines/lint_pipeline/lint_pipeline.rego");

const POLICY_FILE_MISSING_REASON: &str = "policy-file-missing";
const POLICY_DENY_REASON: &str = "policy-deny";
const POLICY_INPUT_INVALID_REASON: &str = "policy-input-invalid";

/// Т0-детект `azure-pipelines/lint_pipeline` — точний функціональний
/// відповідник `evaluatePolicyConcern` (`policy-lint-adapter.mjs`) для
/// `engine !== 'template'` (rego), БЕЗ `data.template.*` (доккомент
/// [`eval_deny_rule`]): `files.length === 0` → `policy-file-missing`;
/// інакше — ОДИН `eval_deny_rule` виклик, `input` — розпарсений YAML
/// `azure-pipelines.yml`. `.rego` уже вбудовує `azure-pipelines.yml: ` у
/// свій `sprintf`, тож `message` тут НЕ префіксується Rust-боком.
fn detect_lint_pipeline(files: &[SourceFile]) -> Vec<Diagnostic> {
    let Some(source) = batch_file(files, LINT_PIPELINE_TARGET) else {
        return vec![Diagnostic {
            reason: POLICY_FILE_MISSING_REASON.to_string(),
            message: LINT_PIPELINE_MISSING_MESSAGE.to_string(),
            file: Some(LINT_PIPELINE_TARGET.to_string()),
            severity: Severity::Error,
            data: None,
        }];
    };
    let Some(actual) = parse_yaml_document(&source.content) else {
        return vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: format!(
                "{LINT_PIPELINE_TARGET}: невалідний YAML — виправ синтаксис ({LINT_PIPELINE_NAMESPACE})"
            ),
            file: Some(LINT_PIPELINE_TARGET.to_string()),
            severity: Severity::Error,
            data: None,
        }];
    };
    let input_json = json_to_string(&actual);
    match eval_deny_rule(LINT_PIPELINE_REGO, LINT_PIPELINE_NAMESPACE, None, &input_json) {
        Ok(messages) => messages
            .into_iter()
            .map(|message| Diagnostic {
                reason: POLICY_DENY_REASON.to_string(),
                message,
                file: Some(LINT_PIPELINE_TARGET.to_string()),
                severity: Severity::Error,
                data: None,
            })
            .collect(),
        Err((stage, err)) => {
            let mut diagnostics = Vec::new();
            push_rego_engine_error(
                &mut diagnostics,
                Some(LINT_PIPELINE_TARGET),
                LINT_PIPELINE_NAMESPACE,
                stage,
                &err,
            );
            diagnostics
        }
    }
}

// =====================================================================
// ДРУГА хвиля — `azure-pipelines/service_deploy_pipeline` (ПЕРШИЙ
// walkGlob-концерн цього крейта: не ОДИН обовʼязковий таргет, а НАБІР
// файлів `.azurepipelines/**/*.yml` мінус `templates/**`).
//
// # Портовано ЛИШЕ detect — fix свідомо лишається JS-каноном
//
// `fix-service_deploy_pipeline.mjs` кличе `relevantDomains(cwd, servicePath)`
// (`npm/scripts/lib/lint-surface/ci-plan.mjs`), а та — `loadEnabledLintRules`
// (резолв УСЬОГО graph-у плагінів + `.n-rules.json`) і
// `collectPathScopedFiles` (обхід піддерева сервісу на диску). Гість не має
// ні того, ні того: `capabilities.fs_read = []`, а реєстру ввімкнених
// правил у контракті НЕМАЄ ЖОДНОГО host-каналу (`host-context` знає лише
// `repo-root@1`/`scratch-dir@1`, `wit/world.wit`). Без цього списку не
// побудувати ні `outputs`-мапінг нової `plan`-джоби, ні per-domain
// `lint_<domain>`-джоби — тобто ЯДРО фіксу, а не його край.
//
// ЧАСТКОВИЙ порт тут був би ГІРШИМ за відсутність порту: `wasmFixPattern`
// (`npm/scripts/lib/lint-surface/run-fix.mjs`) несе `guestFix: true` —
// щойно гість повертає непорожній план і той застосовується, `applyT0`
// ЗУПИНЯЄ подальші патерни концерну, тобто JS-канон із міграцією plan/lint
// джоб не запустився б узагалі. Тож [`Guest::fix`] НЕ реєструє цей ключ:
// порожній план → `edits.length > 0` не проходить → JS T0-фікс лишається
// єдиним і повним (задокументований перехідний контракт `loadT0Patterns`:
// «плагін із fix-заглушкою не має мовчки вимикати чинний JS T0-фікс»).
//
// # `!`-виключення walkGlob-у — фільтр ТУТ, не лише в глобі контрибуції
//
// `concern.json` цього концерну декларує
// `walkGlob: [".azurepipelines/**/*.yml", "!.azurepipelines/templates/**"]`.
// Хост будує full-scope batch через `globset` (`build_full_scope_files`,
// `crates/rules-napi`), і `!`-заперечення там до цієї задачі не існувало як
// поняття: `globset::Glob::new("!…")` компілює `!` як ЗВИЧАЙНИЙ символ
// шляху, тож патерн не матчив нічого — і виключення мовчки не працювало
// (файли `templates/` потрапляли б у batch і оцінювались як сервісні
// pipeline-и). Хост полагоджено тією самою задачею
// (`build_full_scope_files` тепер розуміє `!`-префікс), але гість НЕ
// покладається на це: [`is_service_pipeline_path`] відсіює `templates/**`
// САМ — і у full-batch-і, і в дельта-списку від JS-планувальника.
// =====================================================================

const CONCERN_SERVICE_DEPLOY_PIPELINE: &str = "azure-pipelines/service_deploy_pipeline";

/// Позитивний патерн `walkGlob` концерну (`concern.json`) — дослівно.
const SERVICE_DEPLOY_PIPELINE_GLOB: &str = ".azurepipelines/**/*.yml";

/// Префікс, який `walkGlob` виключає `!`-патерном (`concern.json`).
const SERVICE_DEPLOY_PIPELINE_EXCLUDED_PREFIX: &str = ".azurepipelines/templates/";

const SERVICE_DEPLOY_PIPELINE_NAMESPACE: &str = "azure_pipelines.service_deploy_pipeline";

const SERVICE_DEPLOY_PIPELINE_REGO: &str = include_str!(
    "../../../plugins/ci-azure/rules/azure-pipelines/service_deploy_pipeline/service_deploy_pipeline.rego"
);

/// Чи шлях із batch-у підпадає під walkGlob концерну — позитивний патерн
/// `.azurepipelines/**/*.yml` МІНУС `!.azurepipelines/templates/**`
/// (доккомент розділу вище). `**` матчить будь-яку глибину, тож достатньо
/// префікса й розширення.
fn is_service_pipeline_path(path: &str) -> bool {
    path.starts_with(".azurepipelines/")
        && path.ends_with(".yml")
        && !path.starts_with(SERVICE_DEPLOY_PIPELINE_EXCLUDED_PREFIX)
}

/// Один двигун на весь batch (policy компілюється РАЗ, `eval_rule` — у циклі
/// по файлах) — той самий batch-контракт, що `plugin-ci-github`'s
/// `build_workflow_common_engine`, і той самий, що ОДИН спавн
/// `conftest test <files...>` канону.
#[allow(unused_mut)] // доккомент над `eval_deny_rule`
fn build_service_deploy_pipeline_engine() -> Result<RegoEngineHandle, (&'static str, String)> {
    let mut engine = RegoEngineHandle::new();
    engine
        .add_policy(
            &format!("{SERVICE_DEPLOY_PIPELINE_NAMESPACE}.rego"),
            SERVICE_DEPLOY_PIPELINE_REGO,
        )
        .map_err(rego_error_stage_message)?;
    Ok(engine)
}

/// Т0-детект `azure-pipelines/service_deploy_pipeline` — функціональний
/// відповідник `evaluatePolicyConcern` (`policy-lint-adapter.mjs`, гілка
/// rego) для walkGlob-набору: порожній набір НЕ дає `policy-file-missing`
/// (`cfg.files.single` порожній — гілка `if (cfg.files.required &&
/// cfg.files.single)` не спрацьовує), кожен файл набору оцінюється окремим
/// `eval_rule` ТОГО САМОГО двигуна, кожен `deny`-рядок → ОДНА діагностика
/// `policy-deny` з `file` цього файлу. `message` НЕ префіксується (rego
/// цього пакета не вбудовує шлях — повідомлення починаються з імені джоби,
/// атрибуцію несе `file`, точно як `add('policy-deny', d.message,
/// toRel(d.filename))` канону).
///
/// Побитий YAML → видима `policy-input-invalid`, НЕ мовчазний skip: під
/// `conftest` (канон) такий файл валив би батч помилкою парсера, а тут вхід
/// парситься заздалегідь ([`parse_yaml_document`]) — мовчазний `continue`
/// зробив би концерн зеленим на нечитабельному pipeline-і (той самий мотив,
/// що [`POLICY_INPUT_INVALID_REASON`] у [`detect_lint_pipeline`]).
#[allow(unused_mut)] // доккомент над `eval_deny_rule`
fn detect_service_deploy_pipeline(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut targets: Vec<&SourceFile> = files
        .iter()
        .filter(|f| is_service_pipeline_path(&f.path))
        .collect();
    if targets.is_empty() {
        return Vec::new();
    }
    targets.sort_by(|a, b| a.path.cmp(&b.path));

    let mut diagnostics = Vec::new();
    let mut engine = match build_service_deploy_pipeline_engine() {
        Ok(engine) => engine,
        Err((stage, err)) => {
            push_rego_engine_error(
                &mut diagnostics,
                None,
                SERVICE_DEPLOY_PIPELINE_NAMESPACE,
                stage,
                &err,
            );
            return diagnostics;
        }
    };
    for file in targets {
        let Some(actual) = parse_yaml_document(&file.content) else {
            diagnostics.push(Diagnostic {
                reason: POLICY_INPUT_INVALID_REASON.to_string(),
                message: format!(
                    "{}: невалідний YAML — виправ синтаксис ({SERVICE_DEPLOY_PIPELINE_NAMESPACE})",
                    file.path
                ),
                file: Some(file.path.clone()),
                severity: Severity::Error,
                data: None,
            });
            continue;
        };
        let input_json = json_to_string(&actual);
        match engine.eval_rule(
            &input_json,
            &format!("data.{SERVICE_DEPLOY_PIPELINE_NAMESPACE}.deny"),
        ) {
            Ok(messages) => {
                for message in messages {
                    diagnostics.push(Diagnostic {
                        reason: POLICY_DENY_REASON.to_string(),
                        message,
                        file: Some(file.path.clone()),
                        severity: Severity::Error,
                        data: None,
                    });
                }
            }
            Err(err) => {
                let (stage, message) = rego_error_stage_message(err);
                push_rego_engine_error(
                    &mut diagnostics,
                    Some(&file.path),
                    SERVICE_DEPLOY_PIPELINE_NAMESPACE,
                    stage,
                    &message,
                );
            }
        }
    }
    diagnostics
}

// =====================================================================
// `azure-pipelines/vscode_extensions` — rego-детект (subset) + T0-фіксатор
// (union-merge, точний порт `vscode-ext-add.mjs`).
// =====================================================================

const CONCERN_VSCODE_EXTENSIONS: &str = "azure-pipelines/vscode_extensions";

const VSCODE_EXTENSIONS_TARGET: &str = ".vscode/extensions.json";
const VSCODE_EXTENSIONS_NAMESPACE: &str = "azure_pipelines.vscode_extensions";
const VSCODE_EXTENSIONS_MISSING_MESSAGE: &str =
    ".vscode/extensions.json не існує — додай ms-azure-devops.azure-pipelines (azure-pipelines.mdc)";

const VSCODE_EXTENSIONS_REGO: &str = include_str!(
    "../../../plugins/ci-azure/rules/azure-pipelines/vscode_extensions/vscode_extensions.rego"
);
const VSCODE_EXTENSIONS_SNIPPET_JSON: &str = include_str!(
    "../../../plugins/ci-azure/rules/azure-pipelines/vscode_extensions/template/extensions.json.snippet.json"
);

/// Т0-детект `azure-pipelines/vscode_extensions` — той самий контракт, що
/// [`detect_lint_pipeline`], ПЛЮС `data.template.snippet` (доккомент
/// [`eval_deny_rule`]/[`wrap_template_data`]) — rego перевіряє, що
/// `recommendations` містить кожен елемент вшитого snippet-а (subset-of, НЕ
/// exact-match — додаткові рекомендації від інших правил дозволені).
fn detect_vscode_extensions(files: &[SourceFile]) -> Vec<Diagnostic> {
    let Some(source) = batch_file(files, VSCODE_EXTENSIONS_TARGET) else {
        return vec![Diagnostic {
            reason: POLICY_FILE_MISSING_REASON.to_string(),
            message: VSCODE_EXTENSIONS_MISSING_MESSAGE.to_string(),
            file: Some(VSCODE_EXTENSIONS_TARGET.to_string()),
            severity: Severity::Error,
            data: None,
        }];
    };
    let Some(actual) = parse_yaml_document(&source.content) else {
        return vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: format!(
                "{VSCODE_EXTENSIONS_TARGET}: невалідний JSON — виправ синтаксис ({VSCODE_EXTENSIONS_NAMESPACE})"
            ),
            file: Some(VSCODE_EXTENSIONS_TARGET.to_string()),
            severity: Severity::Error,
            data: None,
        }];
    };
    let snippet = parse_embedded_template("extensions.json.snippet.json", VSCODE_EXTENSIONS_SNIPPET_JSON);
    let data_json = wrap_template_data(snippet);
    let input_json = json_to_string(&actual);
    match eval_deny_rule(
        VSCODE_EXTENSIONS_REGO,
        VSCODE_EXTENSIONS_NAMESPACE,
        Some(&data_json),
        &input_json,
    ) {
        Ok(messages) => messages
            .into_iter()
            .map(|message| Diagnostic {
                reason: POLICY_DENY_REASON.to_string(),
                message,
                file: Some(VSCODE_EXTENSIONS_TARGET.to_string()),
                severity: Severity::Error,
                data: None,
            })
            .collect(),
        Err((stage, err)) => {
            let mut diagnostics = Vec::new();
            push_rego_engine_error(
                &mut diagnostics,
                Some(VSCODE_EXTENSIONS_TARGET),
                VSCODE_EXTENSIONS_NAMESPACE,
                stage,
                &err,
            );
            diagnostics
        }
    }
}

/// Т0-фіксер `azure-pipelines/vscode_extensions` — точний порт
/// `npm/scripts/lib/fix/vscode-ext-add.mjs`: union
/// `.vscode/extensions.json#recommendations` із канонічним
/// `template/extensions.json.snippet.json#recommendations` за РЯДКОВИМ
/// значенням (не структурний deep-merge). Той самий контракт, що
/// `plugin-ci-github::fix_vscode_extensions` (доккомент тієї функції
/// пояснює точний перенос по кроках) — ПОВНА регенерація файлу
/// (`json_to_pretty_string`), не хірургічний comment-preserving merge:
/// канон сам робить `JSON.stringify(parsed, null, 2)`, коментарі НЕ
/// переживають фікс НАВІТЬ у JS-оригіналі.
fn fix_vscode_extensions(request: &FixRequest) -> FixPlan {
    if request.diagnostics.is_empty() {
        return FixPlan { edits: vec![] };
    }
    let snippet = parse_embedded_template("extensions.json.snippet.json", VSCODE_EXTENSIONS_SNIPPET_JSON);
    let canonical: Vec<String> = snippet
        .get("recommendations")
        .and_then(Json::as_array)
        .map(|arr| arr.iter().filter_map(Json::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    if canonical.is_empty() {
        return FixPlan { edits: vec![] };
    }

    let existing = batch_file(&request.files, VSCODE_EXTENSIONS_TARGET);
    let (existing_entries, recs): (Vec<(String, Json)>, Vec<String>) = match existing {
        None => (Vec::new(), Vec::new()),
        Some(source) => match parse_yaml_document(&source.content) {
            Some(Json::Object(entries)) => {
                let recs = entries
                    .iter()
                    .find(|(k, _)| k == "recommendations")
                    .and_then(|(_, v)| v.as_array())
                    .map(|arr| arr.iter().filter_map(Json::as_str).map(str::to_string).collect())
                    .unwrap_or_default();
                (entries, recs)
            }
            // Невалідний JSON — не чіпаємо (той самий `catch { return
            // {touchedFiles: []} }`, що `vscode-ext-add.mjs`).
            _ => return FixPlan { edits: vec![] },
        },
    };

    let to_add: Vec<&String> = canonical.iter().filter(|c| !recs.contains(c)).collect();
    if to_add.is_empty() && existing.is_some() {
        return FixPlan { edits: vec![] };
    }

    let mut new_recs: Vec<Json> = recs.into_iter().map(Json::Str).collect();
    new_recs.extend(to_add.into_iter().cloned().map(Json::Str));

    let mut new_entries = existing_entries;
    match new_entries.iter_mut().find(|(k, _)| k == "recommendations") {
        Some(entry) => entry.1 = Json::Array(new_recs),
        None => new_entries.push(("recommendations".to_string(), Json::Array(new_recs))),
    }
    let content = json_to_pretty_string(&Json::Object(new_entries));
    FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: VSCODE_EXTENSIONS_TARGET.to_string(),
            content,
        })],
    }
}

// =====================================================================
// Manifest + Guest.
// =====================================================================

fn build_manifest() -> Manifest {
    Manifest {
        id: "ci-azure/wasm-concerns".to_string(),
        version: "0.1.0".to_string(),
        world_version: "3.2.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![
            ConcernContribution {
                key: CONCERN_LINT_PIPELINE.to_string(),
                scope: ConcernScope::Full,
                glob: vec![LINT_PIPELINE_TARGET.to_string()],
            },
            ConcernContribution {
                key: CONCERN_VSCODE_EXTENSIONS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![VSCODE_EXTENSIONS_TARGET.to_string()],
            },
            // ДРУГА хвиля — ПЕРША `per-file` контрибуція цього гостя:
            // `concern.json` не декларує `lint.scope`, тобто дельта-прогін
            // дає лише змінені pipeline-файли, а `--full` хост добудовує
            // глобом (`build_detect_batch_files`, §2.65). Глоб — обидва
            // патерни walkGlob-у дослівно, включно з `!`-виключенням
            // (`build_full_scope_files` розуміє його з цієї задачі);
            // додатковий гість-фільтр — [`is_service_pipeline_path`].
            ConcernContribution {
                key: CONCERN_SERVICE_DEPLOY_PIPELINE.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec![
                    SERVICE_DEPLOY_PIPELINE_GLOB.to_string(),
                    format!("!{SERVICE_DEPLOY_PIPELINE_EXCLUDED_PREFIX}**"),
                ],
            },
        ],
        ci_artifacts: vec![],
        capabilities: Capabilities {
            fs_read: vec![],
            network: false,
        },
        tools: vec![],
    }
}

/// Guest-реалізація `n-rules:plugin@3.2.0` для `ci-azure/wasm-concerns` —
/// два концерни, перша хвиля (доккомент модуля).
struct CiAzure;

impl Guest for CiAzure {
    fn describe() -> Manifest {
        log(LogLevel::Info, "plugin-ci-azure: describe()");
        build_manifest()
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        let total = batch.files.len() as u32;
        let diagnostics = match batch.concern_id.as_str() {
            CONCERN_LINT_PIPELINE => {
                report_progress(total, total);
                detect_lint_pipeline(&batch.files)
            }
            CONCERN_VSCODE_EXTENSIONS => {
                report_progress(total, total);
                detect_vscode_extensions(&batch.files)
            }
            CONCERN_SERVICE_DEPLOY_PIPELINE => {
                report_progress(total, total);
                detect_service_deploy_pipeline(&batch.files)
            }
            _ => Vec::new(),
        };
        log(
            LogLevel::Info,
            &format!(
                "plugin-ci-azure: detect({}) опрацював {total} файл(ів)",
                batch.concern_id
            ),
        );
        diagnostics
    }

    /// `azure-pipelines/service_deploy_pipeline` тут СВІДОМО відсутній —
    /// його T0-фікс потребує реєстру ввімкнених правил, якого гість не має,
    /// а частковий фікс вимкнув би JS-канон через `guestFix` (доккомент
    /// розділу «ДРУГА хвиля» вище за текстом). Порожній план →
    /// `edits.length > 0` не проходить → чинний
    /// `fix-service_deploy_pipeline.mjs` лишається єдиним фіксером.
    fn fix(request: FixRequest) -> FixPlan {
        match request.concern_id.as_str() {
            CONCERN_VSCODE_EXTENSIONS => fix_vscode_extensions(&request),
            _ => FixPlan { edits: vec![] },
        }
    }

    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

export!(CiAzure);

#[cfg(test)]
mod tests {
    //! Юніт-тести на host-таргеті (`cargo test -p plugin-ci-azure`, без
    //! wasm-збірки) — regorus виконується IN-PROCESS через `RegoEngineHandle`
    //! (`cfg(not(target_arch = "wasm32"))`, доккомент модуля), тож обидва
    //! `detect_*` тестуються НАПРЯМУ (жодного host-імпорту в цій хвилі — ні
    //! `exec-tool`, ні `fs_read`). Golden-тест на РЕАЛЬНОМУ `.wasm`
    //! (`crates/rules-plugin-host/tests/plugin_ci_azure.rs`) і
    //! `wasm-plugin-parity-ci-azure.test.mjs` (РЕАЛЬНИЙ napi-міст) — окремі
    //! рівні покриття, доккомент тих файлів.
    use super::*;

    fn wf(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    // --- lint_pipeline ---

    #[test]
    fn lint_pipeline_missing_file_gives_policy_file_missing() {
        let diagnostics = detect_lint_pipeline(&[]);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POLICY_FILE_MISSING_REASON);
        assert_eq!(diagnostics[0].file.as_deref(), Some(LINT_PIPELINE_TARGET));
    }

    #[test]
    fn lint_pipeline_flat_steps_with_lint_and_no_fix_passes() {
        let files = [wf(
            LINT_PIPELINE_TARGET,
            "steps:\n  - script: bunx n-rules lint --no-fix --full\n    displayName: Lint\n",
        )];
        assert!(detect_lint_pipeline(&files).is_empty());
    }

    #[test]
    fn lint_pipeline_nested_stages_with_lint_passes() {
        let files = [wf(
            LINT_PIPELINE_TARGET,
            "stages:\n  - stage: ci\n    jobs:\n      - job: lint\n        steps:\n          - script: bun install --frozen-lockfile\n          - script: npx @7n/rules lint text --no-fix\n",
        )];
        assert!(detect_lint_pipeline(&files).is_empty());
    }

    #[test]
    fn lint_pipeline_missing_lint_step_denied() {
        let files = [wf(LINT_PIPELINE_TARGET, "steps:\n  - script: echo build\n")];
        let diagnostics = detect_lint_pipeline(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POLICY_DENY_REASON);
        assert!(diagnostics[0].message.contains("n-rules lint"));
    }

    #[test]
    fn lint_pipeline_without_no_fix_denied() {
        let files = [wf(LINT_PIPELINE_TARGET, "steps:\n  - script: bunx n-rules lint\n")];
        let diagnostics = detect_lint_pipeline(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POLICY_DENY_REASON);
        assert!(diagnostics[0].message.contains("--no-fix"));
    }

    // --- vscode_extensions: detect ---

    #[test]
    fn vscode_extensions_missing_file_gives_policy_file_missing() {
        let diagnostics = detect_vscode_extensions(&[]);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POLICY_FILE_MISSING_REASON);
    }

    #[test]
    fn vscode_extensions_present_passes() {
        let files = [wf(
            VSCODE_EXTENSIONS_TARGET,
            "{\"recommendations\": [\"ms-azure-devops.azure-pipelines\", \"other.ext\"]}",
        )];
        assert!(detect_vscode_extensions(&files).is_empty());
    }

    #[test]
    fn vscode_extensions_missing_recommendation_denied() {
        let files = [wf(VSCODE_EXTENSIONS_TARGET, "{\"recommendations\": [\"other.ext\"]}")];
        let diagnostics = detect_vscode_extensions(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POLICY_DENY_REASON);
        assert!(diagnostics[0].message.contains("ms-azure-devops.azure-pipelines"));
        // `%q` → `\"%v\"`-фікс (доккомент модуля) дає БІТ-У-БІТ той самий
        // подвійно-лапковий рядок, що conftest/Go `%q`.
        assert!(diagnostics[0].message.contains("\"ms-azure-devops.azure-pipelines\""));
    }

    #[test]
    fn vscode_extensions_empty_input_denied() {
        let files = [wf(VSCODE_EXTENSIONS_TARGET, "{}")];
        let diagnostics = detect_vscode_extensions(&files);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("recommendations"));
    }

    // --- vscode_extensions: fix ---

    fn fix_request(diagnostics: Vec<Diagnostic>, files: Vec<SourceFile>) -> FixRequest {
        FixRequest {
            concern_id: CONCERN_VSCODE_EXTENSIONS.to_string(),
            files,
            diagnostics,
        }
    }

    #[test]
    fn fix_empty_diagnostics_gives_empty_plan() {
        let plan = fix_vscode_extensions(&fix_request(vec![], vec![]));
        assert_eq!(plan.edits.len(), 0);
    }

    #[test]
    fn fix_missing_file_creates_recommendations() {
        let before = detect_vscode_extensions(&[]);
        let plan = fix_vscode_extensions(&fix_request(before, vec![]));
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікував write");
        };
        assert_eq!(w.path, VSCODE_EXTENSIONS_TARGET);
        assert!(w.content.contains("ms-azure-devops.azure-pipelines"));

        // Замикання циклу: застосувати план і повторно детектити — чисто.
        let after = detect_vscode_extensions(&[wf(VSCODE_EXTENSIONS_TARGET, &w.content)]);
        assert!(after.is_empty());
    }

    #[test]
    fn fix_existing_file_unions_recommendations_keeps_extras() {
        let files = vec![wf(
            VSCODE_EXTENSIONS_TARGET,
            "{\"recommendations\": [\"other.ext\"]}",
        )];
        let before = detect_vscode_extensions(&files);
        assert_eq!(before.len(), 1);
        let plan = fix_vscode_extensions(&fix_request(before, files));
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікував write");
        };
        assert!(w.content.contains("other.ext"));
        assert!(w.content.contains("ms-azure-devops.azure-pipelines"));

        let after = detect_vscode_extensions(&[wf(VSCODE_EXTENSIONS_TARGET, &w.content)]);
        assert!(after.is_empty());
    }

    #[test]
    fn fix_already_satisfied_gives_empty_plan() {
        let files = vec![wf(
            VSCODE_EXTENSIONS_TARGET,
            "{\"recommendations\": [\"ms-azure-devops.azure-pipelines\"]}",
        )];
        // Немає діагностик (файл уже задовольняє policy) — порожній план.
        let plan = fix_vscode_extensions(&fix_request(vec![], files));
        assert_eq!(plan.edits.len(), 0);
    }

    // --- manifest / describe ---

    #[test]
    fn build_manifest_declares_three_concerns() {
        let manifest = build_manifest();
        assert_eq!(manifest.id, "ci-azure/wasm-concerns");
        assert_eq!(manifest.world_version, "3.2.0");
        assert_eq!(manifest.domains, vec![Domain::Lint]);
        assert_eq!(manifest.concerns.len(), 3);
        for c in &manifest.concerns {
            // Жодна контрибуція без глоба: хост інакше не має з чого
            // побудувати batch `--full` (§2.65), а на fix-боці — ще й
            // порожній план замість реальних правок (§2.72).
            assert!(!c.glob.is_empty());
        }
        let keys: Vec<&str> = manifest.concerns.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(
            keys,
            vec![
                CONCERN_LINT_PIPELINE,
                CONCERN_VSCODE_EXTENSIONS,
                CONCERN_SERVICE_DEPLOY_PIPELINE
            ]
        );
    }

    /// Anti-drift: `plugin.toml`'s `[[concerns]].key` мусить 1:1 збігатись із
    /// `build_manifest()` — той самий тест, що решта п�ʼяти гостей.
    #[test]
    fn plugin_toml_concern_keys_match_describe() {
        let raw = include_str!("../plugin.toml");
        let parsed: toml::Value = raw.parse().expect("plugin.toml — валідний TOML");
        let toml_keys: Vec<String> = parsed["concerns"]
            .as_array()
            .expect("concerns — масив")
            .iter()
            .map(|c| c["key"].as_str().expect("key — рядок").to_string())
            .collect();
        let manifest = build_manifest();
        let describe_keys: Vec<String> = manifest.concerns.iter().map(|c| c.key.clone()).collect();
        assert_eq!(toml_keys, describe_keys);
    }

    #[test]
    fn rego_engine_error_reason_used_on_malformed_input() {
        // `set_input_json` провалюється на побитому JSON — [`eval_deny_rule`]
        // повертає `Err`, [`push_rego_engine_error`] дає видиму діагностику
        // замість тиші (fail loud, доккомент функції).
        let mut diagnostics = Vec::new();
        push_rego_engine_error(&mut diagnostics, Some("x.yml"), "ns", "set_input", "boom");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, REGO_ENGINE_ERROR_REASON);
        assert!(diagnostics[0].message.contains("boom"));
    }

    // --- ДРУГА хвиля: azure-pipelines/service_deploy_pipeline (detect-порт) ---

    /// Гейт §2.81 (той самий прийом, що
    /// `vsi_shist_rego_polityk_evaliuiutsia_pid_regorus` у
    /// `crates/plugin-lang-js`): КОЖНА вшита `.rego`-політика цього крейта
    /// реально компілюється Й еваліюється під `regorus`, а не лише під
    /// Go-шним `conftest` — гейт трьох відомих пасток міграції (`%q`,
    /// builtin поза фітами — `walk`/`graph.reachable`, безтілий факт
    /// `f("літерал")`) на чистому вході.
    #[test]
    fn vsi_vshyti_rego_polityky_evaliuiutsia_pid_regorus() {
        let cases: [(&str, &str); 3] = [
            (LINT_PIPELINE_REGO, LINT_PIPELINE_NAMESPACE),
            (VSCODE_EXTENSIONS_REGO, VSCODE_EXTENSIONS_NAMESPACE),
            (
                SERVICE_DEPLOY_PIPELINE_REGO,
                SERVICE_DEPLOY_PIPELINE_NAMESPACE,
            ),
        ];
        for (rego, namespace) in cases {
            let result = eval_deny_rule(rego, namespace, None, "{}");
            assert!(
                result.is_ok(),
                "policy {namespace} не еваліюється під regorus: {:?}",
                result.err()
            );
        }
    }

    /// walkGlob концерну — `.azurepipelines/**/*.yml` МІНУС
    /// `!.azurepipelines/templates/**` (`concern.json`).
    #[test]
    fn service_deploy_pipeline_path_filter_excludes_templates() {
        assert!(is_service_pipeline_path(".azurepipelines/deploy-nexus.yml"));
        assert!(is_service_pipeline_path(
            ".azurepipelines/nexus/deploy.yml"
        ));
        assert!(!is_service_pipeline_path(
            ".azurepipelines/templates/steps.yml"
        ));
        assert!(!is_service_pipeline_path("azure-pipelines.yml"));
    }

    /// Сервісний pipeline (`trigger.paths.include`) без `plan`-джоби —
    /// `policy-deny`, атрибутована ФАЙЛОМ.
    #[test]
    fn detect_service_deploy_pipeline_missing_plan_denies() {
        let files = [wf(
            ".azurepipelines/deploy-nexus.yml",
            "trigger:\n  paths:\n    include:\n      - run/nexus/**\njobs:\n  - job: lint\n    steps:\n      - script: bunx n-rules lint js --path run/nexus --no-fix\n  - job: deploy\n    dependsOn:\n      - lint\n    steps:\n      - script: echo x\n",
        )];
        let diagnostics = detect_service_deploy_pipeline(&files);
        assert!(
            diagnostics
                .iter()
                .any(|d| d.message.contains("немає job `plan`")),
            "{diagnostics:?}"
        );
        for d in &diagnostics {
            assert_eq!(d.reason, POLICY_DENY_REASON);
            assert_eq!(d.file.as_deref(), Some(".azurepipelines/deploy-nexus.yml"));
        }
    }

    /// Pipeline БЕЗ `trigger.paths.include` (repo-wide) — не сервісний,
    /// жодної `deny`.
    #[test]
    fn detect_service_deploy_pipeline_non_service_is_clean() {
        let files = [wf(
            ".azurepipelines/ci.yml",
            "trigger:\n  - main\njobs:\n  - job: build\n    steps:\n      - script: echo x\n",
        )];
        assert!(detect_service_deploy_pipeline(&files).is_empty());
    }

    /// Файл із виключеної теки `templates/` НЕ оцінюється, навіть якщо
    /// хост поклав його в batch (гість фільтрує сам — доккомент розділу).
    #[test]
    fn detect_service_deploy_pipeline_ignores_templates_dir() {
        let files = [wf(
            ".azurepipelines/templates/deploy.yml",
            "trigger:\n  paths:\n    include:\n      - run/nexus/**\njobs:\n  - job: lint\n    steps:\n      - script: bunx n-rules lint js --path run/nexus\n",
        )];
        assert!(detect_service_deploy_pipeline(&files).is_empty());
    }

    /// Порожній набір — НЕ `policy-file-missing` (walkGlob-концерн без
    /// `files.single`).
    #[test]
    fn detect_service_deploy_pipeline_empty_batch_is_silent() {
        assert!(detect_service_deploy_pipeline(&[]).is_empty());
    }

    /// Побитий YAML — ГУЧНА `policy-input-invalid`, не мовчазний skip.
    #[test]
    fn detect_service_deploy_pipeline_broken_yaml_is_loud() {
        let files = [wf(".azurepipelines/deploy.yml", "jobs: [a, b\n  - broken\n")];
        let diagnostics = detect_service_deploy_pipeline(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POLICY_INPUT_INVALID_REASON);
    }

    /// Контрибуція заявлена в `describe()` ОБОМА патернами walkGlob-у,
    /// включно з `!`-виключенням.
    #[test]
    fn service_deploy_pipeline_contribution_declared() {
        let manifest = build_manifest();
        let contribution = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_SERVICE_DEPLOY_PIPELINE)
            .expect("контрибуція має бути в describe()");
        assert_eq!(contribution.scope, ConcernScope::PerFile);
        assert_eq!(
            contribution.glob,
            vec![
                ".azurepipelines/**/*.yml".to_string(),
                "!.azurepipelines/templates/**".to_string()
            ]
        );
    }

    /// `fix()` цього концерну СВІДОМО порожній — гість не глушить JS-канон
    /// (доккомент розділу «ДРУГА хвиля»).
    #[test]
    fn fix_service_deploy_pipeline_zalyshaietsia_za_js_kanonom() {
        let plan = CiAzure::fix(FixRequest {
            concern_id: CONCERN_SERVICE_DEPLOY_PIPELINE.to_string(),
            files: vec![],
            diagnostics: vec![],
        });
        assert!(plan.edits.is_empty());
    }

}
