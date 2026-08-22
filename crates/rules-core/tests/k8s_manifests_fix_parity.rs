//! Cross-language parity фікс-поверхні `k8s/manifests`.
//!
//! Фікстура знята з ЖИВОГО `fix-manifests.mjs`: кожен трансформер прогнано в
//! Node на тих самих входах, і збережено дослівний вихід (`null` — no-op).
//! Тобто звіряється фактичний канон, а не переказ його логіки.

use rules_core::concerns::fix_k8s_manifests::{
    ensure_deployment_strategy, ensure_svc_cluster_ip_type, ensure_svc_hl_cluster_ip,
    move_schema_modeline_first, replace_batch_v1beta1, replace_gateway_httproute_v1beta1,
};
use serde_json::Value;

const FIXTURE: &str = include_str!("fixtures/js-k8s-manifests-fix.json");

fn transform(kind: &str) -> fn(&str) -> Option<String> {
    match kind {
        "schema-modeline-first" => move_schema_modeline_first,
        "gateway-httproute-v1beta1" => replace_gateway_httproute_v1beta1,
        "batch-v1beta1-apiversion" => replace_batch_v1beta1,
        "deployment-strategy" => ensure_deployment_strategy,
        "svc-clusterip-type" => ensure_svc_cluster_ip_type,
        "svc-hl-cluster-ip" => ensure_svc_hl_cluster_ip,
        other => panic!("невідома родина у фікстурі: {other}"),
    }
}

/// Розбіжності, названі поіменно.
///
/// JS перезбирає мультидок через `join('\n---\n')`, тобто зʼїдає провідний
/// `---`. Порт лишає файл як є: семантика та сама, а diff чесніший. Кожен
/// такий випадок мусить бути ТУТ і мати очікуваний вихід порту — інакше
/// розбіжність проскочила б непоміченою.
fn known_divergence(kind: &str, label: &str) -> Option<&'static str> {
    match (kind, label) {
        ("svc-clusterip-type", "провідний ---") => {
            Some("---\nkind: Service\nspec:\n  ports: []\n  type: ClusterIP\n")
        }
        _ => None,
    }
}

#[test]
fn every_transform_matches_the_live_js_canon() {
    let fixture: Value = serde_json::from_str(FIXTURE).expect("фікстура — валідний JSON");
    let mut checked = 0;
    for (kind, cases) in fixture.as_object().expect("родини — обʼєкт") {
        for case in cases.as_array().expect("кейси — масив") {
            let label = case["label"].as_str().expect("мітка");
            let input = case["input"].as_str().expect("вхід");
            let expected = case["output"].as_str();
            let actual = transform(kind)(input);
            if let Some(ported) = known_divergence(kind, label) {
                assert_eq!(
                    actual.as_deref(),
                    Some(ported),
                    "{kind}/{label}: названа розбіжність змінилась"
                );
                checked += 1;
                continue;
            }
            assert_eq!(
                actual.as_deref(),
                expected,
                "{kind}/{label}: розійшлось із JS-каноном"
            );
            checked += 1;
        }
    }
    assert_eq!(checked, 28, "фікстура втратила кейси");
}
