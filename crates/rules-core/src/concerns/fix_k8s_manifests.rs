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
fn patch_documents(
    content: &str,
    mut patch: impl FnMut(&yamlpath::Document) -> Option<Vec<yamlpatch::Patch<'static>>>,
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
        let Some(patches) = patch(&document) else {
            out.push_str(&body);
            continue;
        };
        if patches.is_empty() {
            out.push_str(&body);
            continue;
        }
        let Ok(patched) = yamlpatch::apply_yaml_patches(&document, &patches) else {
            return None;
        };
        changed = true;
        out.push_str(patched.source());
    }
    changed.then_some(out)
}

/// Значення скалярного поля за маршрутом; `None` — поля немає.
fn scalar_at(document: &yamlpath::Document, route: &yamlpath::Route) -> Option<String> {
    let feature = document.query_exact(route).ok()??;
    Some(document.extract(&feature).trim().to_string())
}

/// Значення скалярного поля верхнього рівня документа.
fn top_level_scalar(document: &yamlpath::Document, key: &str) -> Option<String> {
    scalar_at(document, &yamlpath::route!(key))
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
    patch_documents(content, move |document| {
        if top_level_scalar(document, "kind")? != "Service" {
            return None;
        }
        match scalar_at(document, &yamlpath::route!("spec", key)) {
            // Ідемпотентність: уже канонічне значення — не чіпаємо.
            Some(current) if current == value => None,
            Some(_) => Some(vec![yamlpatch::Patch {
                route: yamlpath::route!("spec", key),
                operation: yamlpatch::Op::Replace(yaml_serde::Value::String(value.to_string())),
            }]),
            None => Some(vec![yamlpatch::Patch {
                route: yamlpath::route!("spec"),
                operation: yamlpatch::Op::Add {
                    key: key.to_string(),
                    value: yaml_serde::Value::String(value.to_string()),
                },
            }]),
        }
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
    patch_documents(content, |document| {
        if top_level_scalar(document, "kind")? != "Deployment" {
            return None;
        }
        // `spec` має бути: JS вимагає `doc.has('spec')` і мовчки пропускає
        // документ без нього.
        document
            .query_exists(&yamlpath::route!("spec"))
            .then_some(())?;
        let canonical = scalar_at(document, &yamlpath::route!("spec", "strategy", "type"))
            .is_some_and(|value| value == STRATEGY_TYPE)
            && scalar_at(
                document,
                &yamlpath::route!("spec", "strategy", "rollingUpdate", "maxUnavailable"),
            )
            .is_some_and(|value| value == "0")
            && scalar_at(
                document,
                &yamlpath::route!("spec", "strategy", "rollingUpdate", "maxSurge"),
            )
            .is_some_and(|value| value == "1");
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
        Some(vec![
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
        ])
    })
}

/// Родина порушення, яку вміє лагодити цей зріз.
fn transform_for(kind: &str) -> Option<fn(&str) -> Option<String>> {
    match kind {
        "gateway-httproute-v1beta1" => Some(replace_gateway_httproute_v1beta1),
        "batch-v1beta1-apiversion" => Some(replace_batch_v1beta1),
        "schema-modeline-first" => Some(move_schema_modeline_first),
        "deployment-strategy" => Some(ensure_deployment_strategy),
        "svc-clusterip-type" => Some(ensure_svc_cluster_ip_type),
        "svc-hl-cluster-ip" => Some(ensure_svc_hl_cluster_ip),
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
        if transform_for(kind).is_none() {
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

    let mut edits: Vec<FileEdit> = Vec::new();
    for (file, kind) in targets {
        let Some(transform) = transform_for(kind) else {
            continue;
        };
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
        let Some(next) = transform(&current) else {
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

    /// Зламаний YAML — no-op на весь файл, а не часткова правка.
    #[test]
    fn unparseable_yaml_is_left_alone() {
        assert_eq!(
            ensure_svc_cluster_ip_type("kind: Service\nspec:\n  - [\n"),
            None
        );
    }
}
