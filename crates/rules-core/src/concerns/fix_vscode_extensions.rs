//! T0-фікси ядрової пʼятірки родини `vscode_extensions` — `doc-files`,
//! `graphql`, `rego`, `tauri`, `text` (§2.75 реєстру
//! `docs/plans/2026-08-05-open-questions-register.md`, розділ §1 плану
//! `docs/plans/2026-08-29-js-rust-migration-completion-plan.md`).
//!
//! Усі пʼять — тонкі шими над ОДНИМ JS-рушієм
//! (`npm/scripts/lib/fix/vscode-ext-add.mjs`; кожен `fix-vscode_extensions.mjs`
//! — рівно один рядок `export { patterns } from …`), тож і порт — ОДИН
//! рушій ([`vscode_extensions_fix`]) плюс пʼять записів конфігурації
//! ([`VscodeExtCfg`], таблиця [`CONFIGS`]), а не пʼять реалізацій. Ціль у
//! всіх одна — `.vscode/extensions.json`
//! ([`VSCODE_EXTENSIONS_TARGET`]), різниця вичерпується вшитим
//! канонічним снапшотом (`template/extensions.json.snippet.json` свого
//! концерну, `include_str!`).
//!
//! # Семантика (точний порт `vscode-ext-add.mjs`)
//!
//! - **Застосовність** ([`is_applicable`]) — хоча б одна violation із
//!   `reason == "policy-file-missing"` АБО з `message`, що містить
//!   `recommendations має містити` чи `extensions.json` (порт
//!   `REC_REQUIRE_RE`). Обидва reason-и policy-адаптера
//!   (`policy-lint-adapter.mjs`: `policy-file-missing` і `policy-deny` з
//!   текстом rego-повідомлення) сюди потрапляють.
//! - **Мерж** — union `recommendations` за РЯДКОВИМ значенням: наявні
//!   записи лишаються на місці й у своєму порядку, канонічні відсутні
//!   дописуються в хвіст. Решта файлу (`unwantedRecommendations` та
//!   будь-які локальні ключі) — недоторкана. Це свідомо ІНШИЙ, простіший
//!   рушій, ніж `template-deep-merge.mjs` (структурний `merge_json_value`),
//!   доккомент обох JS-файлів.
//! - **Файл відсутній** — створюється з самим `recommendations`.
//! - **Нічого додавати й файл існує** — порожній план (no-op).
//! - **Запис** — ПОВНА регенерація ([`json_to_pretty_string`], 2 пробіли +
//!   кінцевий `\n`), точний відповідник `JSON.stringify(parsed, null, 2) +
//!   '\n'` канону. Коментарі вхідного JSONC запис НЕ переживають — чесна,
//!   задокументована межа простого рушія (той самий контракт, що
//!   `fix_vscode_extensions` у `crates/plugin-ci-github/src/lib.rs`), не
//!   тиха: втрачається ФОРМАТУВАННЯ, жоден ключ і жодна рекомендація не
//!   зникають.
//!
//! # Дефекти канону, полагоджені тут (не відтворені заради парності)
//!
//! 1. **JSONC-вхід.** `.vscode/*.json` у продакшн-конвенції VS Code часто
//!    містить `//`-коментарі; канон читав його `JSON.parse` → виняток →
//!    `return { touchedFiles: [] }`, тобто МОВЧАЗНИЙ no-op на цілком
//!    легальному для VS Code файлі. Тут читання йде
//!    [`parse_jsonc_document`] (справжній JSONC: `//`, `/* */`,
//!    trailing-кома) — union бачить РЕАЛЬНИЙ `recommendations`. Той самий
//!    фікс, що вже зроблено на гостьовій колії (§2.5x, доккомент
//!    `plugin-ci-github`).
//! 2. **`graphql`/`tauri` не мали канонічного снапшота взагалі.** Їхній
//!    `.rego` тримає список розширень літералом, а `template/` теки не
//!    існувало — тобто `snippetPath` не резолвився, і JS-фікс цих двох
//!    концернів ЗАВЖДИ повертав порожній результат: концерн оголошений
//!    `"fixability": "config"`, лінт світив порушення, а `--fix` мовчки не
//!    робив нічого. Полагоджено В ДЖЕРЕЛІ, а не лише в native-копії:
//!    додано `npm/rules/{graphql,tauri}/vscode_extensions/template/extensions.json.snippet.json`
//!    з тим самим списком, що літерал у `.rego`. Detect не змінюється (обидва
//!    `.rego` не читають `data.template.snippet` — снапшот для них лише
//!    джерело канону фіксу), а працювати починають ОБИДВА шляхи — і native,
//!    і JS-канон, який лишається на місці за політикою «спершу парність».
//! 3. **Не-обʼєктний корінь.** Канон робив `parsed.recommendations = …` на
//!    будь-якому результаті `JSON.parse` — для масиву чи скаляра
//!    властивість або губилась при `JSON.stringify` (масив), або кидала
//!    (скаляр). Тут не-обʼєктний корінь — явний no-op.
//!
//! Свідомо ЗБЕРЕЖЕНА поведінка канону: справді побитий (не-JSONC) вміст
//! цілі → порожній план. Детермінованому фіксу нема з чого будувати мерж,
//! а перезаписати сміття «канонічним» файлом означало б знищити дані
//! користувача; порушення при цьому лишається видимим у звіті лінту.

use std::path::Path;

use rules_template_merge::{json_to_pretty_string, parse_jsonc_document, Json};

use crate::{diagnostics::Violation, RulesError};

use super::fix::{FileEdit, FixPlan, WriteFile};

/// Ціль усіх пʼятьох концернів — posix-relative шлях від cwd (порт
/// `join(ctx.cwd, '.vscode/extensions.json')`; `WriteFile::path` —
/// relative, розгортає його виконавець плану).
const VSCODE_EXTENSIONS_TARGET: &str = ".vscode/extensions.json";

/// `reason`, яким policy-адаптер (`policy-lint-adapter.mjs`) позначає
/// відсутній обовʼязковий `files.single`.
const POLICY_FILE_MISSING_REASON: &str = "policy-file-missing";

/// Дві альтернативи `REC_REQUIRE_RE`
/// (`/recommendations має містити|extensions\.json/u`) — літеральні
/// підрядки, регулярка тут не потрібна (жодного метасимвола, крім
/// екранованої крапки).
const REC_REQUIRE_NEEDLES: [&str; 2] = ["recommendations має містити", "extensions.json"];

/// Ключ `recommendations` — єдине поле, яке цей рушій читає й пише.
const RECOMMENDATIONS_KEY: &str = "recommendations";

/// Конфігурація одного концерну родини — усе, чим вони відрізняються один
/// від одного.
struct VscodeExtCfg {
    /// `ruleId/concernId` — ключ [`super::fix::NATIVE_FIXES`].
    key: &'static str,
    /// Шлях снапшота в дереві репо — тільки для тексту помилки, якщо
    /// вшитий снапшот виявиться невалідним.
    snippet_source_name: &'static str,
    /// Вміст `template/extensions.json.snippet.json`, вшитий у бінарник на
    /// етапі компіляції (той самий мотив, що `MARKSMAN_BASELINE`: файл стає
    /// частиною cdylib, його неможливо «загубити» при встановленні
    /// npm-пакета).
    snippet_raw: &'static str,
}

/// Пʼять ядрових концернів, що стоять на рушії `vscode-ext-add`.
const CONFIGS: &[VscodeExtCfg] = &[
    VscodeExtCfg {
        key: "doc-files/vscode_extensions",
        snippet_source_name:
            "npm/rules/doc-files/vscode_extensions/template/extensions.json.snippet.json",
        snippet_raw: include_str!(
            "../../../../npm/rules/doc-files/vscode_extensions/template/extensions.json.snippet.json"
        ),
    },
    VscodeExtCfg {
        key: "graphql/vscode_extensions",
        snippet_source_name:
            "npm/rules/graphql/vscode_extensions/template/extensions.json.snippet.json",
        snippet_raw: include_str!(
            "../../../../npm/rules/graphql/vscode_extensions/template/extensions.json.snippet.json"
        ),
    },
    VscodeExtCfg {
        key: "rego/vscode_extensions",
        snippet_source_name:
            "npm/rules/rego/vscode_extensions/template/extensions.json.snippet.json",
        snippet_raw: include_str!(
            "../../../../npm/rules/rego/vscode_extensions/template/extensions.json.snippet.json"
        ),
    },
    VscodeExtCfg {
        key: "tauri/vscode_extensions",
        snippet_source_name:
            "npm/rules/tauri/vscode_extensions/template/extensions.json.snippet.json",
        snippet_raw: include_str!(
            "../../../../npm/rules/tauri/vscode_extensions/template/extensions.json.snippet.json"
        ),
    },
    VscodeExtCfg {
        key: "text/vscode_extensions",
        snippet_source_name:
            "npm/rules/text/vscode_extensions/template/extensions.json.snippet.json",
        snippet_raw: include_str!(
            "../../../../npm/rules/text/vscode_extensions/template/extensions.json.snippet.json"
        ),
    },
];

/// Ключі всіх пʼятьох концернів — для [`super::fix::NATIVE_FIXES`] і для
/// тесту, що звіряє реєстр із таблицею (розходження двох списків було б
/// тихим: ключ у реєстрі без конфігу дав би `RulesError` у рантаймі).
#[cfg(test)]
pub(super) const VSCODE_EXTENSIONS_FIX_KEYS: &[&str] = &[
    "doc-files/vscode_extensions",
    "graphql/vscode_extensions",
    "rego/vscode_extensions",
    "tauri/vscode_extensions",
    "text/vscode_extensions",
];

/// Порт `T0Pattern.test` рушія: чи є серед violations хоч одна, що
/// стосується `recommendations`/`.vscode/extensions.json`.
fn is_applicable(violations: &[Violation]) -> bool {
    violations.iter().any(|v| {
        v.reason == POLICY_FILE_MISSING_REASON
            || REC_REQUIRE_NEEDLES.iter().any(|n| v.message.contains(n))
    })
}

/// Канонічні розширення зі вшитого снапшота. Снапшот — артефакт цього ж
/// репо, вшитий на етапі компіляції: невалідний JSON тут — не рантайм-стан
/// консюмера, а зламана збірка, тож гучний `panic` замість мовчазного
/// `unwrap_or_default` (принцип «мовчазний skip — вада»).
fn canonical_recommendations(cfg: &VscodeExtCfg) -> Vec<String> {
    let snippet = parse_jsonc_document(cfg.snippet_raw).unwrap_or_else(|| {
        panic!(
            "вшитий снапшот {} має бути валідним JSON/JSONC",
            cfg.snippet_source_name
        )
    });
    let recs = string_array(&snippet, RECOMMENDATIONS_KEY);
    assert!(
        !recs.is_empty(),
        "вшитий снапшот {} має непорожній «{RECOMMENDATIONS_KEY}»",
        cfg.snippet_source_name
    );
    recs
}

/// `obj[key]` як вектор рядків: не-масив, не-обʼєкт і не-рядкові елементи
/// дають порожній/відфільтрований результат — той самий контракт, що
/// `Array.isArray(parsed.recommendations) ? … : []` канону.
fn string_array(value: &Json, key: &str) -> Vec<String> {
    let Json::Object(entries) = value else {
        return Vec::new();
    };
    entries
        .iter()
        .find(|(k, _)| k == key)
        .and_then(|(_, v)| match v {
            Json::Array(items) => Some(items),
            _ => None,
        })
        .map(|items| {
            items
                .iter()
                .filter_map(|i| match i {
                    Json::Str(s) => Some(s.clone()),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Будує [`FixPlan`] для одного концерну родини за ключем.
///
/// `cwd` — абсолютний корінь consumer-репо; читання `.vscode/extensions.json`
/// звідти — той самий read-only мандат, що в решти T2+-фіксів.
pub(super) fn vscode_extensions_fix(
    key: &str,
    cwd: &Path,
    violations: &[Violation],
) -> Result<FixPlan, RulesError> {
    let cfg = CONFIGS.iter().find(|c| c.key == key).ok_or_else(|| {
        RulesError::Concern(format!("невідомий концерн родини vscode_extensions: {key}"))
    })?;
    if !is_applicable(violations) {
        return Ok(FixPlan::default());
    }
    let canonical = canonical_recommendations(cfg);

    // Нечитабельний файл (відсутній, немає прав, не-UTF-8) — той самий
    // шлях, що `existsSync === false` канону: цілі немає, будуємо з нуля.
    let existing_text = std::fs::read_to_string(cwd.join(VSCODE_EXTENSIONS_TARGET)).ok();
    let (mut entries, recs): (Vec<(String, Json)>, Vec<String>) = match &existing_text {
        None => (Vec::new(), Vec::new()),
        Some(text) => match parse_jsonc_document(text) {
            Some(parsed @ Json::Object(_)) => {
                let recs = string_array(&parsed, RECOMMENDATIONS_KEY);
                let Json::Object(entries) = parsed else {
                    unreachable!("щойно зматчений Json::Object")
                };
                (entries, recs)
            }
            // Побитий вміст або не-обʼєктний корінь — доккомент модуля
            // («Свідомо ЗБЕРЕЖЕНА поведінка канону»).
            _ => return Ok(FixPlan::default()),
        },
    };

    let to_add: Vec<&String> = canonical.iter().filter(|c| !recs.contains(c)).collect();
    if to_add.is_empty() && existing_text.is_some() {
        return Ok(FixPlan::default());
    }

    let mut new_recs: Vec<Json> = recs.into_iter().map(Json::Str).collect();
    new_recs.extend(to_add.into_iter().cloned().map(Json::Str));
    match entries.iter_mut().find(|(k, _)| k == RECOMMENDATIONS_KEY) {
        Some(entry) => entry.1 = Json::Array(new_recs),
        None => entries.push((RECOMMENDATIONS_KEY.to_string(), Json::Array(new_recs))),
    }

    Ok(FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: VSCODE_EXTENSIONS_TARGET.to_string(),
            content: json_to_pretty_string(&Json::Object(entries)),
        })],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Severity;
    use std::fs;

    fn violation(reason: &str, message: &str) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: message.to_string(),
            file: Some(VSCODE_EXTENSIONS_TARGET.to_string()),
            severity: Severity::Error,
            data: None,
        }
    }

    /// Типова violation policy-rego («recommendations має містити …»).
    fn deny(ext: &str) -> Violation {
        violation(
            "policy-deny",
            &format!(".vscode/extensions.json: recommendations має містити \"{ext}\" (text.mdc)"),
        )
    }

    fn write_target(dir: &Path, content: &str) {
        fs::create_dir_all(dir.join(".vscode")).unwrap();
        fs::write(dir.join(VSCODE_EXTENSIONS_TARGET), content).unwrap();
    }

    fn written(plan: &FixPlan) -> &str {
        assert_eq!(plan.edits.len(), 1, "очікували рівно один write");
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, VSCODE_EXTENSIONS_TARGET);
                &w.content
            }
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    fn recs_of(content: &str) -> Vec<String> {
        string_array(
            &parse_jsonc_document(content).expect("валідний JSON"),
            RECOMMENDATIONS_KEY,
        )
    }

    #[test]
    fn kozhen_kluch_reestru_maie_konfih() {
        for key in VSCODE_EXTENSIONS_FIX_KEYS {
            assert!(
                CONFIGS.iter().any(|c| &c.key == key),
                "ключ {key} без конфігу"
            );
        }
        assert_eq!(CONFIGS.len(), VSCODE_EXTENSIONS_FIX_KEYS.len());
    }

    /// Усі пʼять вшитих снапшотів валідні й непорожні (панікуючий шлях
    /// [`canonical_recommendations`] — саме той гучний гейт).
    #[test]
    fn vsi_vshyti_snapshoty_validni() {
        for cfg in CONFIGS {
            assert!(!canonical_recommendations(cfg).is_empty(), "{}", cfg.key);
        }
        // Дефект №2 доккоменту: у graphql/tauri снапшота НЕ БУЛО — фікс був
        // вічним no-op. Тепер канон є й у них.
        let graphql = CONFIGS
            .iter()
            .find(|c| c.key.starts_with("graphql/"))
            .unwrap();
        assert_eq!(
            canonical_recommendations(graphql),
            vec!["graphql.vscode-graphql".to_string()]
        );
        let tauri = CONFIGS
            .iter()
            .find(|c| c.key.starts_with("tauri/"))
            .unwrap();
        assert_eq!(
            canonical_recommendations(tauri),
            vec!["tauri-apps.tauri-vscode".to_string()]
        );
    }

    #[test]
    fn nevidomyi_kluch_ie_pomylka() {
        let dir = tempfile::tempdir().unwrap();
        let err = vscode_extensions_fix("js/vscode_extensions", dir.path(), &[deny("x")]);
        assert!(err.is_err());
    }

    #[test]
    fn bez_relevantnykh_violations_plan_porozhnii() {
        let dir = tempfile::tempdir().unwrap();
        let plan = vscode_extensions_fix("text/vscode_extensions", dir.path(), &[]).unwrap();
        assert!(plan.edits.is_empty());
        let plan = vscode_extensions_fix(
            "text/vscode_extensions",
            dir.path(),
            &[violation("other", "щось геть інше")],
        )
        .unwrap();
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn policy_file_missing_stvoriuie_fail_z_kanonom() {
        let dir = tempfile::tempdir().unwrap();
        let plan = vscode_extensions_fix(
            "rego/vscode_extensions",
            dir.path(),
            &[violation(
                POLICY_FILE_MISSING_REASON,
                ".vscode/extensions.json не існує — створи згідно rego.mdc",
            )],
        )
        .unwrap();
        let content = written(&plan);
        assert_eq!(recs_of(content), vec!["tsandall.opa".to_string()]);
        assert!(
            content.ends_with("\n"),
            "кінцевий перевід рядка, як у канону"
        );
        assert!(
            content.contains("  \"recommendations\""),
            "відступ 2 пробіли"
        );
    }

    #[test]
    fn naiavnyi_fail_dopysuie_lyshe_vidsutnie_i_zberihaie_reshtu() {
        let dir = tempfile::tempdir().unwrap();
        write_target(
            dir.path(),
            r#"{"unwantedRecommendations":["foo.bar"],"recommendations":["local.ext","oxc.oxc-vscode"]}"#,
        );
        let plan = vscode_extensions_fix(
            "text/vscode_extensions",
            dir.path(),
            &[deny("DavidAnson.vscode-markdownlint")],
        )
        .unwrap();
        let content = written(&plan);
        assert_eq!(
            recs_of(content),
            vec![
                // порядок наявних збережений, канонічні відсутні — у хвіст
                "local.ext".to_string(),
                "oxc.oxc-vscode".to_string(),
                "DavidAnson.vscode-markdownlint".to_string(),
                "timonwong.shellcheck".to_string(),
            ]
        );
        assert!(
            content.contains("unwantedRecommendations"),
            "локальні ключі недоторкані"
        );
    }

    #[test]
    fn vzhe_kanonichnyi_fail_no_op() {
        let dir = tempfile::tempdir().unwrap();
        write_target(
            dir.path(),
            r#"{"recommendations":["DavidAnson.vscode-markdownlint","oxc.oxc-vscode","timonwong.shellcheck"]}"#,
        );
        let plan = vscode_extensions_fix("text/vscode_extensions", dir.path(), &[deny("байдуже")])
            .unwrap();
        assert!(plan.edits.is_empty());
    }

    /// Дефект №1 доккоменту: канон падав на `JSON.parse` і мовчки нічого не
    /// робив; native читає JSONC — локальні дані виживають, канон домержено.
    #[test]
    fn jsonc_komentari_chytaiutsia_bez_vtraty_danykh() {
        let dir = tempfile::tempdir().unwrap();
        write_target(
            dir.path(),
            "{\n  // локальний коментар\n  \"recommendations\": [\"local.ext\"], // хвостовий\n}\n",
        );
        let plan = vscode_extensions_fix(
            "doc-files/vscode_extensions",
            dir.path(),
            &[deny("arr.marksman")],
        )
        .unwrap();
        let content = written(&plan);
        assert_eq!(
            recs_of(content),
            vec!["local.ext".to_string(), "arr.marksman".to_string()],
            "локальний запис вижив, канонічний додано"
        );
        assert!(
            !content.contains("локальний коментар"),
            "повна регенерація: коментар НЕ переживає запис — задокументована межа"
        );
    }

    #[test]
    fn pobytyi_vmist_ne_chipaiemo() {
        let dir = tempfile::tempdir().unwrap();
        write_target(dir.path(), "{ not valid json");
        let plan =
            vscode_extensions_fix("text/vscode_extensions", dir.path(), &[deny("x")]).unwrap();
        assert!(plan.edits.is_empty());
    }

    /// Дефект №3 доккоменту: канон робив `parsed.recommendations = …` на
    /// масиві й губив правку при `JSON.stringify`; тут — явний no-op.
    #[test]
    fn ne_obiektnyi_korin_no_op() {
        let dir = tempfile::tempdir().unwrap();
        write_target(dir.path(), "[]\n");
        let plan =
            vscode_extensions_fix("text/vscode_extensions", dir.path(), &[deny("x")]).unwrap();
        assert!(plan.edits.is_empty());
    }

    /// `recommendations` не-масив (напр. рядок) — канон бере `[]` і
    /// ПЕРЕЗАПИСУЄ поле канонічним списком; порт робить те саме.
    #[test]
    fn ne_masyvni_recommendations_perezapysuiutsia() {
        let dir = tempfile::tempdir().unwrap();
        write_target(dir.path(), r#"{"recommendations":"oops","other":1}"#);
        let plan = vscode_extensions_fix(
            "graphql/vscode_extensions",
            dir.path(),
            &[deny("graphql.vscode-graphql")],
        )
        .unwrap();
        let content = written(&plan);
        assert_eq!(recs_of(content), vec!["graphql.vscode-graphql".to_string()]);
        assert!(content.contains("\"other\""));
    }

    /// Повторний прогін на щойно записаному вмісті — чистий (idempotent).
    #[test]
    fn povtornyi_prohin_idempotentnyi() {
        let dir = tempfile::tempdir().unwrap();
        let plan = vscode_extensions_fix(
            "tauri/vscode_extensions",
            dir.path(),
            &[violation(POLICY_FILE_MISSING_REASON, "немає файлу")],
        )
        .unwrap();
        let content = written(&plan).to_string();
        write_target(dir.path(), &content);
        let again = vscode_extensions_fix(
            "tauri/vscode_extensions",
            dir.path(),
            &[violation(POLICY_FILE_MISSING_REASON, "немає файлу")],
        )
        .unwrap();
        assert!(again.edits.is_empty());
    }
}
