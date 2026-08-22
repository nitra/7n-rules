//! Cross-language parity фікс-поверхні `k8s/manifests`.
//!
//! Фікстура знята з ЖИВОГО `fix-manifests.mjs`: кожен трансформер прогнано в
//! Node на тих самих входах, і збережено дослівний вихід (`null` — no-op).
//! Тобто звіряється фактичний канон, а не переказ його логіки.

use std::path::{Path, PathBuf};

use rules_core::concerns::fix_k8s_manifests::{
    ensure_deployment_strategy, ensure_hasura_configmap_required_env,
    ensure_hasura_httproute_rule1_filters, ensure_network_policy_egress,
    ensure_svc_cluster_ip_type, ensure_svc_hl_cluster_ip, move_schema_modeline_first,
    replace_batch_v1beta1, replace_gateway_httproute_v1beta1,
};
use serde_json::Value;

/// Корінь пакета правил — сніпети NetworkPolicy лежать саме там, і саме їх
/// читає JS-канон через URL відносно свого модуля.
fn rules_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../npm/rules")
}

const FIXTURE: &str = include_str!("fixtures/js-k8s-manifests-fix.json");

fn transform(kind: &str, input: &str) -> Option<String> {
    match kind {
        "schema-modeline-first" => move_schema_modeline_first(input),
        "gateway-httproute-v1beta1" => replace_gateway_httproute_v1beta1(input),
        "batch-v1beta1-apiversion" => replace_batch_v1beta1(input),
        "deployment-strategy" => ensure_deployment_strategy(input),
        "svc-clusterip-type" => ensure_svc_cluster_ip_type(input),
        "svc-hl-cluster-ip" => ensure_svc_hl_cluster_ip(input),
        "hasura-configmap-env" => ensure_hasura_configmap_required_env(input),
        "hasura-httproute-rule1-filters" => ensure_hasura_httproute_rule1_filters(input),
        "networkpolicy-egress" => ensure_network_policy_egress(input, &rules_root()),
        other => panic!("невідома родина у фікстурі: {other}"),
    }
}

/// Розбіжності, названі поіменно.
///
/// JS перезбирає мультидок через `join('\n---\n')`, тобто зʼїдає провідний
/// `---`. Порт лишає файл як є: семантика та сама, а diff чесніший. Такий
/// випадок мусить мати очікуваний вихід порту ДОСЛІВНО — інакше розбіжність
/// проскочила б непоміченою.
fn verbatim_divergence(kind: &str, label: &str) -> Option<&'static str> {
    match (kind, label) {
        ("svc-clusterip-type", "провідний ---") => {
            Some("---\nkind: Service\nspec:\n  ports: []\n  type: ClusterIP\n")
        }
        _ => None,
    }
}

/// Родини, де єдина дозволена різниця — СИМВОЛ лапок навколо нового
/// рядкового значення.
///
/// Емітер `yaml` бере такі значення в ПОДВІЙНІ лапки, `yamlpatch` — в
/// ОДИНАРНІ; YAML читає їх однаково. Стиль для нового ключа не
/// налаштовується: `yamlpatch` виводить його з наявного вузла, а нового
/// вузла ще немає.
///
/// Нормалізація навмисно вузька — міняє лише лапки. Будь-яка інша різниця
/// (порядок ключів, відступ, зайвий пробіл) далі валить звірку.
fn with_single_quotes(expected: &str) -> String {
    let mut out = String::with_capacity(expected.len());
    for line in expected.split_inclusive('\n') {
        let (head, tail) = match line.split_once(": \"") {
            Some(parts) => parts,
            None => {
                out.push_str(line);
                continue;
            }
        };
        let trimmed = tail.trim_end_matches('\n');
        match trimmed.strip_suffix('"') {
            Some(value) if !value.contains('"') && !value.contains('\'') => {
                out.push_str(head);
                out.push_str(": '");
                out.push_str(value);
                out.push('\'');
                if tail.ends_with('\n') {
                    out.push('\n');
                }
            }
            _ => out.push_str(line),
        }
    }
    out
}

/// Чи родина взагалі підпадає під розбіжність лапок.
fn quotes_differ_for(kind: &str) -> bool {
    kind == "hasura-configmap-env"
}

#[test]
fn every_transform_matches_the_live_js_canon() {
    let fixture: Value = serde_json::from_str(FIXTURE).expect("фікстура — валідний JSON");
    let mut checked = 0;
    for (kind, cases) in fixture.as_object().expect("родини — обʼєкт") {
        for case in cases.as_array().expect("кейси — масив") {
            let label = case["label"].as_str().expect("мітка");
            let input = case["input"].as_str().expect("вхід");
            // JS-`throw` і JS-`null` для T0-обгортки — те саме: вона ловить
            // виняток і робить no-op на весь файл (`catch { next = null }`).
            let expected = case["output"].as_str();
            let actual = transform(kind, input);
            if let Some(ported) = verbatim_divergence(kind, label) {
                assert_eq!(
                    actual.as_deref(),
                    Some(ported),
                    "{kind}/{label}: названа розбіжність змінилась"
                );
                checked += 1;
                continue;
            }
            let expected = match expected {
                Some(text) if quotes_differ_for(kind) => Some(with_single_quotes(text)),
                other => other.map(str::to_string),
            };
            assert_eq!(actual, expected, "{kind}/{label}: розійшлось із JS-каноном");
            checked += 1;
        }
    }
    assert_eq!(checked, 44, "фікстура втратила кейси");
}
